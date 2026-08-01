package bundle

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

const (
	Name                 = "atlas-manager-power-helper"
	TargetOS             = "linux"
	TargetArch           = "amd64"
	InstallPath          = "/usr/local/libexec/atlas-manager-power-helper"
	InstallOwner         = "root"
	InstallGroup         = "atlas-manager-power"
	InstallMode          = "04750"
	ProtocolVersion      = 1
	SchemaVersion        = 1
	MaxPackageVersionLen = 64
	MaxManifestBytes     = 8192
)

var (
	versionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$`)
	hex40Pattern   = regexp.MustCompile(`^[0-9a-f]{40}$`)
	hex64Pattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

var (
	ErrInvalidVersion       = errors.New("invalid package version")
	ErrInvalidSourceDate    = errors.New("invalid source date epoch")
	ErrInvalidManifest      = errors.New("invalid bundle manifest")
	ErrInvalidChecksums     = errors.New("invalid bundle checksums")
	ErrBundleStructure      = errors.New("invalid bundle structure")
	ErrUnexpectedBundleFile = errors.New("unexpected bundle file")
)

// Manifest is deliberately a closed, value-based representation of the
// release metadata. Its field order is also the canonical JSON field order.
type Manifest struct {
	SchemaVersion             int      `json:"schemaVersion"`
	Name                      string   `json:"name"`
	PackageVersion            string   `json:"packageVersion"`
	ProtocolVersion           int      `json:"protocolVersion"`
	SourceCommit              string   `json:"sourceCommit"`
	SourceDateEpoch           uint64   `json:"sourceDateEpoch"`
	GoVersion                 string   `json:"goVersion"`
	GOOS                      string   `json:"goos"`
	GOARCH                    string   `json:"goarch"`
	CGOEnabled                bool     `json:"cgoEnabled"`
	InstallPath               string   `json:"installPath"`
	Owner                     string   `json:"owner"`
	Group                     string   `json:"group"`
	Mode                      string   `json:"mode"`
	AutomaticInstallation     bool     `json:"automaticInstallation"`
	ProductionActivation      bool     `json:"productionActivation"`
	ApplicationUserEnrollment bool     `json:"applicationUserEnrollment"`
	HelperSHA256              string   `json:"helperSha256"`
	InstallerSHA256           string   `json:"installerSha256"`
	DirectGoModules           []string `json:"directGoModules"`
	TransitiveGoModules       []string `json:"transitiveGoModules"`
}

func ValidatePackageVersion(value string) error {
	if len(value) == 0 || len(value) > MaxPackageVersionLen || !versionPattern.MatchString(value) {
		return ErrInvalidVersion
	}
	return nil
}

func ParseSourceDateEpoch(value string) (uint64, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, ErrInvalidSourceDate
	}
	var result uint64
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, ErrInvalidSourceDate
		}
		if result > (uint64(^uint64(0)>>1)-uint64(character-'0'))/10 {
			return 0, ErrInvalidSourceDate
		}
		result = result*10 + uint64(character-'0')
	}
	return result, nil
}

func ValidateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != SchemaVersion || manifest.Name != Name || manifest.ProtocolVersion != ProtocolVersion ||
		manifest.GoVersion == "" || manifest.GOOS != TargetOS || manifest.GOARCH != TargetArch || manifest.CGOEnabled ||
		manifest.InstallPath != InstallPath || manifest.Owner != InstallOwner || manifest.Group != InstallGroup || manifest.Mode != InstallMode ||
		manifest.AutomaticInstallation || manifest.ProductionActivation || manifest.ApplicationUserEnrollment {
		return ErrInvalidManifest
	}
	if err := ValidatePackageVersion(manifest.PackageVersion); err != nil || !hex40Pattern.MatchString(manifest.SourceCommit) ||
		!hex64Pattern.MatchString(manifest.HelperSHA256) || !hex64Pattern.MatchString(manifest.InstallerSHA256) {
		return ErrInvalidManifest
	}
	if len(manifest.DirectGoModules) != 1 || manifest.DirectGoModules[0] != "github.com/godbus/dbus/v5 v5.2.2" ||
		len(manifest.TransitiveGoModules) != 1 || manifest.TransitiveGoModules[0] != "golang.org/x/sys v0.27.0" {
		return ErrInvalidManifest
	}
	return nil
}

func CanonicalManifest(manifest Manifest) ([]byte, error) {
	if err := ValidateManifest(manifest); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return nil, ErrInvalidManifest
	}
	return append(encoded, '\n'), nil
}

func ParseManifest(data []byte) (Manifest, error) {
	if len(data) == 0 || len(data) > MaxManifestBytes || data[len(data)-1] != '\n' || strings.ContainsRune(string(data), '\r') {
		return Manifest{}, ErrInvalidManifest
	}
	var manifest Manifest
	decoder := json.NewDecoder(strings.NewReader(string(data[:len(data)-1])))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, ErrInvalidManifest
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return Manifest{}, ErrInvalidManifest
	}
	canonical, err := CanonicalManifest(manifest)
	if err != nil || string(canonical) != string(data) {
		return Manifest{}, ErrInvalidManifest
	}
	return manifest, nil
}

func HashBytes(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func HashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type BundleFiles struct {
	Root            string
	Helper          []byte
	Installer       []byte
	InstallationDoc []byte
}

var expectedFiles = []string{
	"bin/atlas-manager-power-helper",
	"bin/atlas-manager-power-helper-installer",
	"manifest.json",
	"SHA256SUMS",
	"README-installation.md",
	"LICENSES/github.com-godbus-dbus-v5.txt",
	"LICENSES/golang.org-x-sys.txt",
}

func ExpectedFiles() []string { return append([]string(nil), expectedFiles...) }

func BuildManifest(packageVersion, sourceCommit, goVersion string, sourceDateEpoch uint64, helper, installer []byte) Manifest {
	return Manifest{
		SchemaVersion: SchemaVersion, Name: Name, PackageVersion: packageVersion, ProtocolVersion: ProtocolVersion,
		SourceCommit: sourceCommit, SourceDateEpoch: sourceDateEpoch, GoVersion: goVersion,
		GOOS: TargetOS, GOARCH: TargetArch, CGOEnabled: false, InstallPath: InstallPath,
		Owner: InstallOwner, Group: InstallGroup, Mode: InstallMode, AutomaticInstallation: false,
		ProductionActivation: false, ApplicationUserEnrollment: false, HelperSHA256: HashBytes(helper),
		InstallerSHA256: HashBytes(installer), DirectGoModules: []string{"github.com/godbus/dbus/v5 v5.2.2"},
		TransitiveGoModules: []string{"golang.org/x/sys v0.27.0"},
	}
}

func CanonicalChecksums(manifest Manifest) []byte {
	return []byte(manifest.HelperSHA256 + "  bin/atlas-manager-power-helper\n" + manifest.InstallerSHA256 + "  bin/atlas-manager-power-helper-installer\n")
}

func CreateDirectoryBundle(root string, manifest Manifest, helper, installer, installationDoc []byte) error {
	if err := ValidateManifest(manifest); err != nil {
		return err
	}
	if HashBytes(helper) != manifest.HelperSHA256 || HashBytes(installer) != manifest.InstallerSHA256 {
		return ErrInvalidManifest
	}
	for _, directory := range []string{root, filepath.Join(root, "bin"), filepath.Join(root, "LICENSES")} {
		if err := os.MkdirAll(directory, 0755); err != nil {
			return err
		}
	}
	files := map[string][]byte{
		"bin/atlas-manager-power-helper":           helper,
		"bin/atlas-manager-power-helper-installer": installer,
		"manifest.json":                            mustCanonicalManifest(manifest),
		"SHA256SUMS":                               CanonicalChecksums(manifest),
		"README-installation.md":                   installationDoc,
		"LICENSES/github.com-godbus-dbus-v5.txt":   []byte(GodbusLicense),
		"LICENSES/golang.org-x-sys.txt":            []byte(XSysLicense),
	}
	for name, data := range files {
		mode := os.FileMode(0644)
		if name == "bin/atlas-manager-power-helper" {
			mode = 0750
		} else if name == "bin/atlas-manager-power-helper-installer" {
			mode = 0755
		}
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.WriteFile(path, data, mode); err != nil {
			return err
		}
		if err := os.Chmod(path, mode); err != nil {
			return err
		}
	}
	return nil
}

func mustCanonicalManifest(manifest Manifest) []byte {
	data, _ := CanonicalManifest(manifest)
	return data
}

func CreateArchive(bundleRoot, archivePath string, sourceDateEpoch uint64) error {
	if sourceDateEpoch > uint64(^uint64(0)>>1) {
		return ErrInvalidSourceDate
	}
	manifestData, err := os.ReadFile(filepath.Join(bundleRoot, "manifest.json"))
	if err != nil {
		return err
	}
	manifest, err := ParseManifest(manifestData)
	if err != nil || manifest.SourceDateEpoch != sourceDateEpoch {
		return ErrInvalidManifest
	}
	if err := ValidateBundleDirectory(bundleRoot, manifest); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(archivePath), 0755); err != nil {
		return err
	}
	file, err := os.Create(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipWriter := gzip.NewWriter(file)
	gzipWriter.Header.ModTime = time.Unix(int64(sourceDateEpoch), 0).UTC()
	gzipWriter.Header.Name = ""
	tarWriter := tar.NewWriter(gzipWriter)
	top := filepath.Base(bundleRoot)
	entries := []struct {
		name string
		mode int64
	}{
		{top, 0755}, {top + "/bin", 0755}, {top + "/LICENSES", 0755},
		{top + "/bin/atlas-manager-power-helper", 0750},
		{top + "/bin/atlas-manager-power-helper-installer", 0755},
		{top + "/LICENSES/github.com-godbus-dbus-v5.txt", 0644},
		{top + "/LICENSES/golang.org-x-sys.txt", 0644},
		{top + "/README-installation.md", 0644}, {top + "/SHA256SUMS", 0644}, {top + "/manifest.json", 0644},
	}
	for _, entry := range entries {
		relative := strings.TrimPrefix(entry.name, top+"/")
		path := bundleRoot
		if relative != entry.name {
			path = filepath.Join(bundleRoot, filepath.FromSlash(relative))
		}
		data, err := os.ReadFile(path)
		if err != nil && entry.mode&0111 == 0 {
			return err
		}
		header := &tar.Header{Name: entry.name, Mode: entry.mode, Size: int64(len(data)), ModTime: time.Unix(int64(sourceDateEpoch), 0).UTC(), Uid: 0, Gid: 0, Uname: "root", Gname: "root"}
		if entry.mode == 0755 && (strings.HasSuffix(entry.name, "/bin") || strings.HasSuffix(entry.name, "/LICENSES") || entry.name == top) {
			header.Typeflag = tar.TypeDir
			header.Size = 0
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}
		if header.Typeflag != tar.TypeDir {
			if _, err := tarWriter.Write(data); err != nil {
				return err
			}
		}
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	archiveHash, err := HashFile(archivePath)
	if err != nil {
		return err
	}
	return os.WriteFile(archivePath+".sha256", []byte(archiveHash+"  "+filepath.Base(archivePath)+"\n"), 0644)
}

func ValidateBundleDirectory(root string, manifest Manifest) error {
	if err := ValidateManifest(manifest); err != nil {
		return err
	}
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 || rootInfo.Mode().Perm() != 0755 {
		return ErrBundleStructure
	}
	for _, directory := range []string{"bin", "LICENSES"} {
		info, err := os.Lstat(filepath.Join(root, directory))
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0755 {
			return ErrBundleStructure
		}
	}
	allowedPaths := map[string]struct{}{"bin": {}, "LICENSES": {}}
	for _, name := range expectedFiles {
		allowedPaths[name] = struct{}{}
	}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return ErrBundleStructure
		}
		if path == root {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return ErrBundleStructure
		}
		relative = filepath.ToSlash(relative)
		if _, ok := allowedPaths[relative]; !ok {
			return ErrUnexpectedBundleFile
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrBundleStructure
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, name := range expectedFiles {
		info, err := os.Lstat(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return ErrBundleStructure
		}
		want := os.FileMode(0644)
		if name == "bin/atlas-manager-power-helper" {
			want = 0750
		} else if name == "bin/atlas-manager-power-helper-installer" {
			want = 0755
		}
		if info.Mode().Perm() != want {
			return ErrBundleStructure
		}
		if links, ok := fileLinks(info); !ok || links > 1 {
			return ErrBundleStructure
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() != "bin" && entry.Name() != "LICENSES" && entry.Name() != "manifest.json" && entry.Name() != "SHA256SUMS" && entry.Name() != "README-installation.md" {
			return ErrUnexpectedBundleFile
		}
	}
	checksums, err := os.ReadFile(filepath.Join(root, "SHA256SUMS"))
	if err != nil || string(checksums) != string(CanonicalChecksums(manifest)) {
		return ErrInvalidChecksums
	}
	for _, executable := range []string{"bin/atlas-manager-power-helper", "bin/atlas-manager-power-helper-installer"} {
		hash, err := HashFile(filepath.Join(root, filepath.FromSlash(executable)))
		if err != nil {
			return ErrBundleStructure
		}
		if (executable == "bin/atlas-manager-power-helper" && hash != manifest.HelperSHA256) || (executable == "bin/atlas-manager-power-helper-installer" && hash != manifest.InstallerSHA256) {
			return ErrInvalidChecksums
		}
	}
	return nil
}

func fileLinks(info os.FileInfo) (uint64, bool) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, false
	}
	return uint64(stat.Nlink), true
}

func ArchiveName(version string) string {
	return fmt.Sprintf("%s_%s_linux_amd64.tar.gz", Name, version)
}

func SortedExpectedFiles() []string {
	result := append([]string(nil), expectedFiles...)
	sort.Strings(result)
	return result
}
