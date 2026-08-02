package manifest

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

const SchemaVersion = 1

type Target struct {
	OS   string `json:"os"`
	Arch string `json:"arch"`
}

type File struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	Mode   uint32 `json:"mode"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	SchemaVersion   int    `json:"schemaVersion"`
	Name            string `json:"name"`
	Version         string `json:"version"`
	SourceCommit    string `json:"sourceCommit"`
	SourceDateEpoch int64  `json:"sourceDateEpoch"`
	Target          Target `json:"target"`
	NodeVersion     string `json:"nodeVersion"`
	NPMVersion      string `json:"npmVersion"`
	GoVersion       string `json:"goVersion"`
	RuntimeNodePath string `json:"runtimeNodePath"`
	SystemdUnitPath string `json:"systemdUnitPath"`
	Files           []File `json:"files"`
}

func (m Manifest) Validate() error {
	if m.SchemaVersion != SchemaVersion || m.Name != "atlas-manager" || m.Target.OS != "linux" || m.Target.Arch != "amd64" {
		return fmt.Errorf("manifest_contract_invalid")
	}
	if len(m.SourceCommit) != 40 || strings.ToLower(m.SourceCommit) != m.SourceCommit || !isHex(m.SourceCommit) {
		return fmt.Errorf("manifest_source_commit_invalid")
	}
	if m.SourceDateEpoch < 0 || m.RuntimeNodePath != "/usr/bin/node" || m.SystemdUnitPath != "/etc/systemd/system/atlas-manager.service" {
		return fmt.Errorf("manifest_metadata_invalid")
	}
	seen := make(map[string]struct{}, len(m.Files))
	last := ""
	for _, file := range m.Files {
		if !safePath(file.Path) || file.Path <= last {
			return fmt.Errorf("manifest_file_order_invalid")
		}
		last = file.Path
		if _, exists := seen[file.Path]; exists || file.Size < 0 || file.SHA256 == "" || len(file.SHA256) != 64 || strings.ToLower(file.SHA256) != file.SHA256 || !isHex(file.SHA256) {
			return fmt.Errorf("manifest_file_invalid")
		}
		seen[file.Path] = struct{}{}
	}
	return nil
}

func Encode(m Manifest) ([]byte, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return json.MarshalIndent(m, "", "  ")
}

func Decode(data []byte) (Manifest, error) {
	if err := rejectDuplicateKeys(data); err != nil {
		return Manifest{}, err
	}
	var value Manifest
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return Manifest{}, fmt.Errorf("manifest_json_invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return Manifest{}, fmt.Errorf("manifest_trailing_data")
	}
	if err := value.Validate(); err != nil {
		return Manifest{}, err
	}
	return value, nil
}

func rejectDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return fmt.Errorf("manifest_json_invalid")
		}
		delimiter, isDelimiter := token.(json.Delim)
		if !isDelimiter || (delimiter != '{' && delimiter != '[') {
			return nil
		}
		if delimiter == '{' {
			seen := map[string]struct{}{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return fmt.Errorf("manifest_json_invalid")
				}
				name, ok := key.(string)
				if !ok {
					return fmt.Errorf("manifest_json_invalid")
				}
				if _, exists := seen[name]; exists {
					return fmt.Errorf("manifest_duplicate_field")
				}
				seen[name] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
		} else {
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(delimiter+2) {
			return fmt.Errorf("manifest_json_invalid")
		}
		return nil
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("manifest_trailing_data")
	}
	return nil
}

func Inventory(root string, paths []string) ([]File, error) {
	sort.Strings(paths)
	result := make([]File, 0, len(paths))
	for _, path := range paths {
		if !safePath(path) {
			return nil, fmt.Errorf("manifest_path_invalid")
		}
		full := filepath.Join(root, filepath.FromSlash(path))
		info, err := os.Lstat(full)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || nlink(info) != 1 {
			return nil, fmt.Errorf("manifest_file_type_invalid")
		}
		data, err := os.ReadFile(full)
		if err != nil {
			return nil, fmt.Errorf("manifest_file_read_failed")
		}
		digest := sha256.Sum256(data)
		result = append(result, File{Path: path, Size: int64(len(data)), Mode: uint32(info.Mode().Perm()), SHA256: hex.EncodeToString(digest[:])})
	}
	return result, nil
}

func Files(root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root || entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(paths)
	return paths, err
}

func Verify(root string, value Manifest) error {
	if err := value.Validate(); err != nil {
		return err
	}
	allPaths, err := Files(root)
	if err != nil {
		return fmt.Errorf("manifest_walk_failed")
	}
	paths := make([]string, 0, len(allPaths))
	for _, path := range allPaths {
		if path != "MANIFEST.json" && path != "SHA256SUMS" {
			paths = append(paths, path)
		}
	}
	expected := make([]string, 0, len(value.Files))
	for _, file := range value.Files {
		expected = append(expected, file.Path)
	}
	sort.Strings(expected)
	if !sameStrings(paths, expected) {
		return fmt.Errorf("manifest_file_set_invalid")
	}
	actual, err := Inventory(root, paths)
	if err != nil {
		return err
	}
	for index := range actual {
		if actual[index] != value.Files[index] {
			return fmt.Errorf("manifest_file_mismatch")
		}
	}
	return nil
}

func nlink(info os.FileInfo) uint64 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(stats.Nlink)
	}
	return 0
}

func SHA256File(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func safePath(value string) bool {
	if value == "" || filepath.IsAbs(value) || strings.ContainsRune(value, '\\') || strings.ContainsRune(value, 0) {
		return false
	}
	for _, component := range strings.Split(value, "/") {
		if component == "" || component == "." || component == ".." {
			return false
		}
	}
	return true
}

func isHex(value string) bool {
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
