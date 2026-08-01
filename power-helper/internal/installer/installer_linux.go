//go:build linux

package installer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/bundle"
)

const (
	productionGroupFile = "/etc/group"
	productionUsr       = "/usr"
	productionUsrLocal  = "/usr/local"
	productionLibexec   = "/usr/local/libexec"
	productionStateDir  = "/var/lib/atlas-manager-power-helper"
	productionLock      = "/var/lib/atlas-manager-power-helper/.installation.lock"
	productionState     = "/var/lib/atlas-manager-power-helper/installation.json"
	productionHelper    = "/usr/local/libexec/atlas-manager-power-helper"
	maxGroupFileBytes   = 65536
	maxGroupLineBytes   = 1024
	maxStateBytes       = 4096
)

type Status string

const (
	StatusValid               Status = "valid"
	StatusNotInstalled        Status = "not_installed"
	StatusBundleInvalid       Status = "bundle_invalid"
	StatusInstallationInvalid Status = "installation_invalid"
	StatusGroupUnavailable    Status = "group_unavailable"
	StatusGroupNotEmpty       Status = "group_not_empty"
	StatusStateRecheck        Status = "state_recheck_required"
	StatusBusy                Status = "busy"
)

var (
	ErrInvalidAction       = errors.New("invalid installer action")
	ErrRequiresRoot        = errors.New("installer root required")
	ErrUnsupportedPlatform = errors.New("unsupported installer platform")
	ErrBundleInvalid       = errors.New("bundle_invalid")
	ErrInstallationInvalid = errors.New("installation_invalid")
	ErrGroupUnavailable    = errors.New("group_unavailable")
	ErrGroupNotEmpty       = errors.New("group_not_empty")
	ErrStateRecheck        = errors.New("state_recheck_required")
	ErrBusy                = errors.New("busy")
)

type Paths struct {
	Usr        string
	UsrLocal   string
	Libexec    string
	GroupFile  string
	StateDir   string
	LockFile   string
	StateFile  string
	HelperPath string
}

func ProductionPaths() Paths {
	return Paths{Usr: productionUsr, UsrLocal: productionUsrLocal, Libexec: productionLibexec, GroupFile: productionGroupFile, StateDir: productionStateDir, LockFile: productionLock, StateFile: productionState, HelperPath: productionHelper}
}

// SandboxPaths exists only for tests. The production CLI never accepts a root
// or destination path.
func SandboxPaths(root string) Paths {
	return Paths{
		Usr: filepath.Join(root, "usr"), UsrLocal: filepath.Join(root, "usr", "local"),
		Libexec: filepath.Join(root, "usr", "local", "libexec"), GroupFile: filepath.Join(root, "etc", "group"),
		StateDir:   filepath.Join(root, "var", "lib", "atlas-manager-power-helper"),
		LockFile:   filepath.Join(root, "var", "lib", "atlas-manager-power-helper", ".installation.lock"),
		StateFile:  filepath.Join(root, "var", "lib", "atlas-manager-power-helper", "installation.json"),
		HelperPath: filepath.Join(root, "usr", "local", "libexec", "atlas-manager-power-helper"),
	}
}

type SecurityContext struct {
	ExpectedUID uint32
	ExpectedGID uint32
	EUID        func() int
	Chown       func(string, int, int) error
}

func ProductionSecurity() SecurityContext {
	return SecurityContext{ExpectedUID: 0, ExpectedGID: 0, EUID: os.Geteuid, Chown: os.Chown}
}

func TestSecurity() SecurityContext {
	uid := uint32(os.Geteuid())
	gid := uint32(os.Getegid())
	return SecurityContext{ExpectedUID: uid, ExpectedGID: gid, EUID: func() int { return 0 }, Chown: func(string, int, int) error { return nil }}
}

type Installer struct {
	paths      Paths
	security   SecurityContext
	goos       string
	goarch     string
	bundleRoot string
}

func NewProduction(bundleRoot string) Installer {
	return Installer{paths: ProductionPaths(), security: ProductionSecurity(), goos: runtime.GOOS, goarch: runtime.GOARCH, bundleRoot: bundleRoot}
}

func NewSandbox(paths Paths, bundleRoot string) Installer {
	return Installer{paths: paths, security: TestSecurity(), goos: "linux", goarch: "amd64", bundleRoot: bundleRoot}
}

func (installer Installer) Run(action string) (Status, error) {
	switch action {
	case "inspect-bundle":
		if _, err := installer.validateBundle(); err != nil {
			return StatusBundleInvalid, ErrBundleInvalid
		}
		return StatusValid, nil
	case "verify":
		return installer.Verify()
	case "install":
		if err := installer.requireMutationPrivileges(); err != nil {
			return StatusInstallationInvalid, err
		}
		return installer.install()
	case "uninstall":
		if err := installer.requireMutationPrivileges(); err != nil {
			return StatusInstallationInvalid, err
		}
		return installer.uninstall()
	default:
		return StatusInstallationInvalid, ErrInvalidAction
	}
}

func (installer Installer) requireMutationPrivileges() error {
	if installer.goos != "linux" || installer.goarch != "amd64" {
		return ErrUnsupportedPlatform
	}
	if installer.security.EUID() != 0 {
		return ErrRequiresRoot
	}
	return nil
}

func (installer Installer) validateBundle() (bundle.Manifest, error) {
	root := installer.bundleRoot
	if root == "" {
		return bundle.Manifest{}, ErrBundleInvalid
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return bundle.Manifest{}, ErrBundleInvalid
	}
	manifestData, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return bundle.Manifest{}, ErrBundleInvalid
	}
	manifest, err := bundle.ParseManifest(manifestData)
	if err != nil || bundle.ValidateBundleDirectory(root, manifest) != nil {
		return bundle.Manifest{}, ErrBundleInvalid
	}
	return manifest, nil
}

func (installer Installer) Verify() (Status, error) {
	if installer.goos != "linux" || installer.goarch != "amd64" {
		return StatusInstallationInvalid, ErrUnsupportedPlatform
	}
	if _, err := installer.validateBundle(); err != nil {
		return StatusBundleInvalid, ErrBundleInvalid
	}
	group, err := installer.validateGroup(false)
	if err != nil {
		if errors.Is(err, ErrGroupNotEmpty) {
			return StatusGroupNotEmpty, err
		}
		return StatusGroupUnavailable, ErrGroupUnavailable
	}
	if _, err := os.Lstat(installer.paths.HelperPath); errors.Is(err, os.ErrNotExist) {
		return StatusNotInstalled, nil
	} else if err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	release, err := installer.acquireInstallLock(true)
	if err != nil {
		return StatusBusy, ErrBusy
	}
	defer release()
	if err := installer.validateStateAndHelper(); err != nil {
		if errors.Is(err, ErrStateRecheck) {
			return StatusStateRecheck, err
		}
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := installer.validateTargetGroup(group.GID); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	return StatusValid, nil
}

func (installer Installer) install() (Status, error) {
	if _, err := installer.validateBundle(); err != nil {
		return StatusBundleInvalid, ErrBundleInvalid
	}
	if err := installer.ensureStateDirectory(); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	release, err := installer.acquireInstallLock(false)
	if err != nil {
		return StatusBusy, ErrBusy
	}
	defer release()
	manifest, err := installer.validateBundle()
	if err != nil {
		return StatusBundleInvalid, ErrBundleInvalid
	}
	group, err := installer.validateGroup(true)
	if err != nil {
		if errors.Is(err, ErrGroupNotEmpty) {
			return StatusGroupNotEmpty, err
		}
		return StatusGroupUnavailable, ErrGroupUnavailable
	}
	if err := installer.validateParents(true); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if _, targetErr := os.Lstat(installer.paths.HelperPath); targetErr == nil {
		if _, stateErr := os.Lstat(installer.paths.StateFile); errors.Is(stateErr, os.ErrNotExist) {
			if err := installer.reconcileState(manifest, group.GID, installer.paths.HelperPath); err != nil {
				if errors.Is(err, ErrStateRecheck) {
					return StatusStateRecheck, ErrStateRecheck
				}
				return StatusInstallationInvalid, ErrInstallationInvalid
			}
			return StatusValid, nil
		}
	}
	if err := installer.validateExistingTarget(); err != nil {
		return StatusInstallationInvalid, err
	}
	if err := installer.validateTargetGroup(group.GID); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := installer.installCandidate(manifest, group.GID); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	return StatusValid, nil
}

func (installer Installer) uninstall() (Status, error) {
	release, err := installer.acquireInstallLock(false)
	if err != nil {
		return StatusBusy, ErrBusy
	}
	defer release()
	group, err := installer.validateGroup(false)
	if err != nil {
		if errors.Is(err, ErrGroupNotEmpty) {
			return StatusGroupNotEmpty, err
		}
		return StatusGroupUnavailable, ErrGroupUnavailable
	}
	if err := installer.validateStateAndHelper(); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := installer.validateTargetGroup(group.GID); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := os.Remove(installer.paths.HelperPath); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := syncDirectory(installer.paths.Libexec); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := os.Remove(installer.paths.StateFile); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := syncDirectory(installer.paths.StateDir); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := os.Remove(installer.paths.LockFile); err != nil {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	if err := os.Remove(installer.paths.StateDir); err != nil && !errors.Is(err, os.ErrNotExist) {
		return StatusInstallationInvalid, ErrInstallationInvalid
	}
	return StatusNotInstalled, nil
}

type Group struct {
	GID uint32
}

func (installer Installer) validateGroup(requireEmpty bool) (Group, error) {
	info, err := os.Lstat(installer.paths.GroupFile)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return Group{}, ErrGroupUnavailable
	}
	file, err := os.Open(installer.paths.GroupFile)
	if err != nil {
		return Group{}, ErrGroupUnavailable
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxGroupFileBytes+1))
	if err != nil || len(data) > maxGroupFileBytes || strings.ContainsRune(string(data), '\x00') {
		return Group{}, ErrGroupUnavailable
	}
	seen := map[string]struct{}{}
	var result Group
	found := false
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		if len(line) > maxGroupLineBytes || strings.ContainsAny(line, "\r\x00") {
			return Group{}, ErrGroupUnavailable
		}
		fields := strings.Split(line, ":")
		if len(fields) != 4 || fields[0] == "" {
			return Group{}, ErrGroupUnavailable
		}
		if _, exists := seen[fields[0]]; exists {
			return Group{}, ErrGroupUnavailable
		}
		seen[fields[0]] = struct{}{}
		if fields[1] != "x" && fields[1] != "!" && fields[1] != "*" {
			return Group{}, ErrGroupUnavailable
		}
		gid, parseErr := parseCanonicalUint(fields[2])
		if parseErr != nil || gid > uint64(^uint32(0)) {
			return Group{}, ErrGroupUnavailable
		}
		if fields[0] == bundle.InstallGroup {
			if found {
				return Group{}, ErrGroupUnavailable
			}
			if gid == 0 {
				return Group{}, ErrGroupUnavailable
			}
			found = true
			result = Group{GID: uint32(gid)}
			if fields[3] != "" {
				return Group{}, ErrGroupNotEmpty
			}
		} else if strings.Contains(fields[3], ",") {
			for _, member := range strings.Split(fields[3], ",") {
				if member == "" || strings.ContainsAny(member, " \t") {
					return Group{}, ErrGroupUnavailable
				}
			}
		}
	}
	if !found {
		return Group{}, ErrGroupUnavailable
	}
	return result, nil
}

func parseCanonicalUint(value string) (uint64, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, errors.New("invalid integer")
	}
	var parsed uint64
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, errors.New("invalid integer")
		}
		parsed = parsed*10 + uint64(character-'0')
	}
	return parsed, nil
}

func (installer Installer) ensureStateDirectory() error {
	if err := installer.validateFixedDirectory(filepath.Dir(installer.paths.StateDir), installer.security.ExpectedUID); err != nil {
		return err
	}
	info, err := os.Lstat(installer.paths.StateDir)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.Mkdir(installer.paths.StateDir, 0700); err != nil {
			return err
		}
		return installer.security.Chown(installer.paths.StateDir, int(installer.security.ExpectedUID), int(installer.security.ExpectedGID))
	}
	if err != nil {
		return ErrInstallationInvalid
	}
	stateStat, stateOK := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0700 || !stateOK || uint32(stateStat.Uid) != installer.security.ExpectedUID || uint32(stateStat.Gid) != installer.security.ExpectedGID {
		return ErrInstallationInvalid
	}
	return nil
}

func (installer Installer) acquireInstallLock(shared bool) (func(), error) {
	fd, err := syscall.Open(installer.paths.LockFile, syscall.O_RDWR|syscall.O_CREAT|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, ErrBusy
	}
	valid := false
	defer func() {
		if !valid {
			_ = syscall.Close(fd)
		}
	}()
	var stat syscall.Stat_t
	if err := syscall.Fstat(fd, &stat); err != nil || stat.Mode&syscall.S_IFMT != syscall.S_IFREG || uint32(stat.Uid) != installer.security.ExpectedUID || uint32(stat.Gid) != installer.security.ExpectedGID || stat.Mode&07777 != 0600 || stat.Nlink != 1 {
		return nil, ErrBusy
	}
	lockMode := syscall.LOCK_EX
	if shared {
		lockMode = syscall.LOCK_SH
	}
	if err := syscall.Flock(fd, lockMode|syscall.LOCK_NB); err != nil {
		return nil, ErrBusy
	}
	valid = true
	var once bool
	return func() {
		if once {
			return
		}
		once = true
		_ = syscall.Flock(fd, syscall.LOCK_UN)
		_ = syscall.Close(fd)
	}, nil
}

func (installer Installer) validateParents(createLibexec bool) error {
	if err := installer.validateFixedDirectory(installer.paths.Usr, installer.security.ExpectedUID); err != nil {
		return err
	}
	if err := installer.validateFixedDirectory(installer.paths.UsrLocal, installer.security.ExpectedUID); err != nil {
		return err
	}
	info, err := os.Lstat(installer.paths.Libexec)
	if errors.Is(err, os.ErrNotExist) && createLibexec {
		if err := os.Mkdir(installer.paths.Libexec, 0755); err != nil {
			return err
		}
		return installer.security.Chown(installer.paths.Libexec, int(installer.security.ExpectedUID), int(installer.security.ExpectedGID))
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0755 || uint32(info.Sys().(*syscall.Stat_t).Uid) != installer.security.ExpectedUID {
		return ErrInstallationInvalid
	}
	return nil
}

func (installer Installer) validateFixedDirectory(path string, uid uint32) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 || uint32(info.Sys().(*syscall.Stat_t).Uid) != uid {
		return ErrInstallationInvalid
	}
	return nil
}

func (installer Installer) validateExistingTarget() error {
	info, err := os.Lstat(installer.paths.HelperPath)
	if errors.Is(err, os.ErrNotExist) {
		if _, stateErr := os.Lstat(installer.paths.StateFile); stateErr == nil {
			return ErrStateRecheck
		}
		return nil
	}
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ErrInstallationInvalid
	}
	if err := installer.validateStateAndHelper(); err != nil {
		return err
	}
	return nil
}

func (installer Installer) validateTargetGroup(expectedGID uint32) error {
	info, err := os.Lstat(installer.paths.HelperPath)
	if err != nil {
		return nil
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint32(stat.Gid) != expectedGID {
		return ErrInstallationInvalid
	}
	return nil
}

type InstallationState struct {
	SchemaVersion  int    `json:"schemaVersion"`
	PackageVersion string `json:"packageVersion"`
	SourceCommit   string `json:"sourceCommit"`
	HelperSHA256   string `json:"helperSha256"`
	InstalledPath  string `json:"installedPath"`
	InstalledOwner string `json:"installedOwner"`
	InstalledGroup string `json:"installedGroup"`
	InstalledMode  string `json:"installedMode"`
}

func (installer Installer) validateStateAndHelper() error {
	stateInfo, stateErr := os.Lstat(installer.paths.StateFile)
	if stateErr != nil || !stateInfo.Mode().IsRegular() || stateInfo.Mode()&os.ModeSymlink != 0 {
		return ErrStateRecheck
	}
	data, err := os.ReadFile(installer.paths.StateFile)
	if err != nil || len(data) > maxStateBytes || len(data) == 0 || data[len(data)-1] != '\n' {
		return ErrStateRecheck
	}
	var state InstallationState
	decoder := json.NewDecoder(strings.NewReader(string(data[:len(data)-1])))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || state.SchemaVersion != 1 || state.InstalledPath != bundle.InstallPath || state.InstalledOwner != "root" || state.InstalledGroup != bundle.InstallGroup || state.InstalledMode != bundle.InstallMode || bundle.ValidatePackageVersion(state.PackageVersion) != nil {
		return ErrStateRecheck
	}
	if info, err := os.Lstat(installer.paths.StateDir); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0700 || !hasOwnerAndGroup(info, installer.security.ExpectedUID, installer.security.ExpectedGID) {
		return ErrStateRecheck
	}
	if info, err := os.Lstat(installer.paths.StateFile); err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0600 || fileLinks(info) != 1 {
		return ErrStateRecheck
	}
	stateStat, ok := infoStat(installer.paths.StateFile)
	if !ok || stateStat.Uid != installer.security.ExpectedUID || stateStat.Gid != installer.security.ExpectedGID {
		return ErrStateRecheck
	}
	canonical, _ := json.Marshal(state)
	if string(append(canonical, '\n')) != string(data) || !validLowerHex(state.SourceCommit, 40) || !validLowerHex(state.HelperSHA256, 64) {
		return ErrStateRecheck
	}
	info, err := os.Lstat(installer.paths.HelperPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || !hasExactMode(info, 04750) || fileLinks(info) != 1 {
		return ErrStateRecheck
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint32(stat.Uid) != installer.security.ExpectedUID {
		return ErrStateRecheck
	}
	hash, err := fileHash(installer.paths.HelperPath)
	if err != nil || hash != state.HelperSHA256 {
		return ErrStateRecheck
	}
	return nil
}

func (installer Installer) installCandidate(manifest bundle.Manifest, gid uint32) error {
	helperSource := filepath.Join(installer.bundleRoot, "bin", "atlas-manager-power-helper")
	data, err := os.ReadFile(helperSource)
	if err != nil {
		return err
	}
	candidate := filepath.Join(installer.paths.Libexec, ".atlas-manager-power-helper.candidate")
	if err := installer.removeSafeCandidate(candidate, 0750); err != nil {
		return err
	}
	temporary, err := openExclusive(candidate, 0750)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(candidate)
		}
	}()
	if _, err := temporary.Write(data); err != nil || temporary.Sync() != nil || temporary.Close() != nil {
		return ErrInstallationInvalid
	}
	if err := installer.security.Chown(candidate, int(installer.security.ExpectedUID), int(gid)); err != nil {
		return err
	}
	if err := os.Chmod(candidate, os.ModeSetuid|0750); err != nil {
		return err
	}
	if err := installer.verifyCandidate(candidate, manifest.HelperSHA256, gid); err != nil {
		return err
	}
	if err := os.Rename(candidate, installer.paths.HelperPath); err != nil {
		return err
	}
	keep = true
	if err := syncDirectory(installer.paths.Libexec); err != nil {
		return err
	}
	if err := installer.writeInstallationState(manifest); err != nil {
		return err
	}
	return installer.validateStateAndHelper()
}

func (installer Installer) writeInstallationState(manifest bundle.Manifest) error {
	state := InstallationState{SchemaVersion: 1, PackageVersion: manifest.PackageVersion, SourceCommit: manifest.SourceCommit, HelperSHA256: manifest.HelperSHA256, InstalledPath: bundle.InstallPath, InstalledOwner: "root", InstalledGroup: bundle.InstallGroup, InstalledMode: bundle.InstallMode}
	encoded, _ := json.Marshal(state)
	encoded = append(encoded, '\n')
	stateCandidate := filepath.Join(installer.paths.StateDir, ".installation.json.candidate")
	if err := installer.removeSafeCandidate(stateCandidate, 0600); err != nil {
		return err
	}
	stateCandidateFile, err := openExclusive(stateCandidate, 0600)
	if err != nil {
		return err
	}
	defer stateCandidateFile.Close()
	defer os.Remove(stateCandidate)
	if _, err := stateCandidateFile.Write(encoded); err != nil || stateCandidateFile.Sync() != nil || stateCandidateFile.Close() != nil {
		return ErrInstallationInvalid
	}
	if err := installer.security.Chown(stateCandidate, int(installer.security.ExpectedUID), int(installer.security.ExpectedGID)); err != nil || os.Chmod(stateCandidate, 0600) != nil {
		return ErrInstallationInvalid
	}
	if err := os.Rename(stateCandidate, installer.paths.StateFile); err != nil {
		return err
	}
	if err := syncDirectory(installer.paths.StateDir); err != nil {
		return err
	}
	return nil
}

func (installer Installer) reconcileState(manifest bundle.Manifest, gid uint32, path string) error {
	if err := installer.verifyCandidate(path, manifest.HelperSHA256, gid); err != nil {
		return err
	}
	return installer.writeInstallationState(manifest)
}

func (installer Installer) removeSafeCandidate(path string, expectedMode uint32) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || !hasExactMode(info, expectedMode) || fileLinks(info) != 1 || !hasOwnerAndGroup(info, installer.security.ExpectedUID, installer.security.ExpectedGID) {
		return ErrInstallationInvalid
	}
	return os.Remove(path)
}

func (installer Installer) verifyCandidate(path, expectedHash string, gid uint32) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || !hasExactMode(info, 04750) || fileLinks(info) != 1 {
		return ErrInstallationInvalid
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint32(stat.Uid) != installer.security.ExpectedUID || uint32(stat.Gid) != gid {
		return ErrInstallationInvalid
	}
	hash, err := fileHash(path)
	if err != nil || hash != expectedHash {
		return ErrInstallationInvalid
	}
	return nil
}

func openExclusive(path string, mode uint32) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, mode)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = syscall.Close(fd)
		return nil, ErrInstallationInvalid
	}
	return file, nil
}

func fileHash(path string) (string, error) {
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

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func DiscoverBundleRoot() (string, error) {
	executable := os.Args[0]
	if executable == "" {
		return "", ErrBundleInvalid
	}
	if !filepath.IsAbs(executable) {
		cwd, err := os.Getwd()
		if err != nil {
			return "", ErrBundleInvalid
		}
		executable = filepath.Join(cwd, executable)
	}
	if info, err := os.Lstat(executable); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return "", ErrBundleInvalid
	}
	resolved, err := filepath.Abs(executable)
	if err != nil {
		return "", ErrBundleInvalid
	}
	return filepath.Dir(filepath.Dir(resolved)), nil
}

func SafeStatus(err error) Status {
	switch {
	case errors.Is(err, ErrBusy):
		return StatusBusy
	case errors.Is(err, ErrGroupNotEmpty):
		return StatusGroupNotEmpty
	case errors.Is(err, ErrGroupUnavailable):
		return StatusGroupUnavailable
	case errors.Is(err, ErrStateRecheck):
		return StatusStateRecheck
	case errors.Is(err, ErrBundleInvalid):
		return StatusBundleInvalid
	default:
		return StatusInstallationInvalid
	}
}

func FormatStatus(status Status) string { return string(status) }

func fileLinks(info os.FileInfo) uint64 {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0
	}
	return uint64(stat.Nlink)
}

func infoStat(path string) (*syscall.Stat_t, bool) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return stat, ok
}

func validLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func hasExactMode(info os.FileInfo, expected uint32) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && uint32(stat.Mode&07777) == expected
}

func hasOwnerAndGroup(info os.FileInfo, uid, gid uint32) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && uint32(stat.Uid) == uid && uint32(stat.Gid) == gid
}
