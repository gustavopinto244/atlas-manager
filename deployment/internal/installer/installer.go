package installer

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
	"github.com/atlas-manager/atlas-manager/deployment/internal/systemdunit"
)

type Action string

const (
	InspectBundle     Action = "inspect-bundle"
	InstallDisabled   Action = "install-disabled"
	VerifyDisabled    Action = "verify-disabled"
	RollbackDisabled  Action = "rollback-disabled"
	UninstallDisabled Action = "uninstall-disabled"
)

type Paths struct {
	ReleaseRoot                string
	Current                    string
	Unit                       string
	ConfigDir                  string
	Template                   string
	Environment                string
	StateHome                  string
	StateFile                  string
	Lock                       string
	RuntimeDir                 string
	EnableLink                 string
	Node                       string
	IdentityPreparationState   string
	IdentityPreparationJournal string
}

func ProductionPaths() Paths {
	return Paths{
		ReleaseRoot: "/opt/atlas-manager/releases", Current: "/opt/atlas-manager/current",
		Unit: "/etc/systemd/system/atlas-manager.service", ConfigDir: "/etc/atlas-manager",
		Template: "/etc/atlas-manager/atlas-manager.env.example", Environment: "/etc/atlas-manager/atlas-manager.env",
		StateHome: "/var/lib/atlas-manager-deployment", StateFile: "/var/lib/atlas-manager-deployment/state.json",
		Lock: "/run/atlas-manager-deployment.lock", RuntimeDir: "/run/atlas-manager", EnableLink: "/etc/systemd/system/multi-user.target.wants/atlas-manager.service", Node: "/usr/bin/node",
		IdentityPreparationState: "/var/lib/atlas-manager-identity-preparation/state.json", IdentityPreparationJournal: "/var/lib/atlas-manager-identity-preparation/transaction.json",
	}
}

type ProcessIdentityProvider func() (runtimeidentity.Process, error)
type IdentityProvider func() error
type NodeVersionChecker func(context.Context) error

type Config struct {
	Paths            Paths
	BundleRoot       string
	EffectiveUID     func() int
	ResolveIdentity  func() (runtimeidentity.Identity, error)
	ValidateIdentity IdentityProvider
	CheckNode        NodeVersionChecker
	ApplyOwnership   bool
	Now              func() time.Time
}

type State struct {
	SchemaVersion int             `json:"schemaVersion"`
	Version       string          `json:"version"`
	Previous      string          `json:"previous,omitempty"`
	Files         []manifest.File `json:"files"`
	PreviousFiles []manifest.File `json:"previousFiles,omitempty"`
}

type Installer struct{ config Config }

func New(config Config) *Installer {
	if config.Paths.ReleaseRoot == "" {
		config.Paths = ProductionPaths()
	}
	if config.EffectiveUID == nil {
		config.EffectiveUID = os.Geteuid
	}
	if config.ValidateIdentity == nil {
		config.ValidateIdentity = func() error { _, err := validateProductionIdentity(); return err }
	}
	if config.ResolveIdentity == nil {
		config.ResolveIdentity = validateProductionIdentity
	}
	if config.CheckNode == nil {
		config.CheckNode = defaultNodeCheck(config.Paths.Node)
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Installer{config: config}
}

func (installer *Installer) Run(ctx context.Context, action Action) error {
	if action != InspectBundle && action != InstallDisabled && action != VerifyDisabled && action != RollbackDisabled && action != UninstallDisabled {
		return fmt.Errorf("action_invalid")
	}
	if err := inspectBundle(installer.config.BundleRoot); err != nil {
		return err
	}
	if action == InspectBundle {
		return nil
	}
	if installer.config.EffectiveUID() != 0 {
		return fmt.Errorf("root_required")
	}
	if err := validateFixedParentMetadata(installer.config); err != nil {
		return err
	}
	if installer.config.ApplyOwnership {
		if err := validateNodeMetadata(installer.config.Paths.Node, true); err != nil {
			return err
		}
	}
	if err := installer.activeDeployment(); err != nil {
		return err
	}
	identity, err := installer.config.ResolveIdentity()
	if err != nil {
		return fmt.Errorf("runtime_identity_invalid")
	}
	if err := validateIdentityPreparationState(installer.config, identity); err != nil {
		return err
	}
	if err := installer.config.CheckNode(ctx); err != nil {
		return fmt.Errorf("node_runtime_invalid")
	}
	lock, err := acquireLock(installer.config.Paths.Lock, installer.config.ApplyOwnership)
	if err != nil {
		return err
	}
	defer func() {
		_ = lock.Close()
		_ = os.Remove(installer.config.Paths.Lock)
	}()
	if err := validateStateMetadata(installer.config); err != nil {
		return err
	}
	switch action {
	case InstallDisabled:
		return installer.install(ctx, identity)
	case VerifyDisabled:
		return installer.verify(identity)
	case RollbackDisabled:
		return installer.rollback(ctx)
	case UninstallDisabled:
		return installer.uninstall()
	}
	return fmt.Errorf("action_invalid")
}

func validateIdentityPreparationState(config Config, identity runtimeidentity.Identity) error {
	if config.Paths.IdentityPreparationJournal != "" {
		_, seen, err := identitystate.ReadJournal(config.Paths.IdentityPreparationJournal)
		if seen || err != nil {
			return fmt.Errorf("identity_preparation_interrupted")
		}
	}
	if config.Paths.IdentityPreparationState == "" || !exists(config.Paths.IdentityPreparationState) {
		return nil
	}
	state, seen, err := identitystate.ReadState(config.Paths.IdentityPreparationState)
	if err != nil || !seen || state == nil || state.RuntimeUser.ID != identity.UserID || state.PrimaryGroup.ID != identity.PrimaryGroupID || state.HelperGroup.ID != identity.HelperGroupID {
		return fmt.Errorf("identity_preparation_invalid")
	}
	return nil
}

func inspectBundle(root string) error {
	if root == "" {
		return fmt.Errorf("bundle_root_missing")
	}
	data, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return fmt.Errorf("manifest_missing")
	}
	value, err := manifest.Decode(data)
	if err != nil {
		return fmt.Errorf("manifest_invalid")
	}
	if err := manifest.Verify(root, value); err != nil {
		return fmt.Errorf("bundle_files_invalid")
	}
	if err := verifyChecksums(root, value); err != nil {
		return err
	}
	unit, err := os.ReadFile(filepath.Join(root, "systemd", "atlas-manager.service"))
	if err != nil || !systemdunit.Validate(string(unit)) {
		return fmt.Errorf("systemd_unit_invalid")
	}
	if _, err := os.Stat(filepath.Join(root, "atlas-manager-installer")); err != nil {
		return fmt.Errorf("installer_missing")
	}
	if _, err := os.Stat(filepath.Join(root, "atlas-manager-host-qualification")); err != nil {
		return fmt.Errorf("qualification_missing")
	}
	if _, err := os.Stat(filepath.Join(root, "atlas-manager-runtime-identity-installer")); err != nil {
		return fmt.Errorf("identity_installer_missing")
	}
	if _, err := os.Stat(filepath.Join(root, "atlas-manager-runtime-configuration")); err != nil {
		return fmt.Errorf("runtime_configuration_missing")
	}
	if _, err := os.Stat(filepath.Join(root, "atlas-manager-service-lifecycle")); err != nil {
		return fmt.Errorf("service_lifecycle_missing")
	}
	return nil
}

// InspectBundle validates a bundle without acquiring locks or changing state.
func InspectBundleReadOnly(root string) error { return inspectBundle(root) }

// ReadState reads managed deployment state without creating or mutating files.
func ReadState(path string) (State, bool, error) { return readState(path) }

// VerifyManagedDisabled validates an existing disabled installation without
// acquiring the deployment lock. Qualification uses it for evidence only.
func VerifyManagedDisabled(paths Paths, identity runtimeidentity.Identity, enforceOwnership bool) error {
	state, existsState, err := readState(paths.StateFile)
	if err != nil || !existsState || state.Version == "" {
		return fmt.Errorf("state_invalid")
	}
	config := Config{Paths: paths, ApplyOwnership: enforceOwnership}
	if err := verifyReleaseSet(paths.ReleaseRoot, state); err != nil {
		return err
	}
	if err := verifyCurrent(paths.Current, paths.ReleaseRoot, state.Version, state.Files); err != nil {
		return err
	}
	if err := verifyStatic(config, identity); err != nil {
		return err
	}
	return nil
}

func verifyChecksums(root string, value manifest.Manifest) error {
	data, err := os.ReadFile(filepath.Join(root, "SHA256SUMS"))
	if err != nil {
		return fmt.Errorf("checksums_missing")
	}
	want := make(map[string]string, len(value.Files)+1)
	for _, file := range value.Files {
		want[file.Path] = file.SHA256
	}
	manifestHash, err := manifest.SHA256File(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return fmt.Errorf("checksums_invalid")
	}
	want["MANIFEST.json"] = manifestHash
	got := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 66 || line[64:66] != "  " {
			return fmt.Errorf("checksums_invalid")
		}
		digest, path := line[:64], line[66:]
		if strings.ToLower(digest) != digest || !isHex(digest) || path == "" {
			return fmt.Errorf("checksums_invalid")
		}
		if _, exists := got[path]; exists {
			return fmt.Errorf("checksums_duplicate")
		}
		got[path] = digest
	}
	if scanner.Err() != nil || len(got) != len(want) {
		return fmt.Errorf("checksums_invalid")
	}
	for path, expected := range want {
		if got[path] != expected {
			return fmt.Errorf("checksum_mismatch")
		}
	}
	return nil
}

func (installer *Installer) activeDeployment() error {
	if exists(installer.config.Paths.RuntimeDir) {
		return fmt.Errorf("active_runtime")
	}
	if exists(installer.config.Paths.EnableLink) {
		return fmt.Errorf("service_enabled")
	}
	return nil
}

func (installer *Installer) install(ctx context.Context, identity runtimeidentity.Identity) error {
	value, err := readBundleManifest(installer.config.BundleRoot)
	if err != nil {
		return err
	}
	state, stateExists, err := readState(installer.config.Paths.StateFile)
	if err != nil {
		return err
	}
	if stateExists && state.Version == "" {
		return fmt.Errorf("state_invalid")
	}
	if stateExists {
		if err := verifyReleaseSet(installer.config.Paths.ReleaseRoot, state); err != nil {
			return err
		}
		if err := verifyCurrent(installer.config.Paths.Current, installer.config.Paths.ReleaseRoot, state.Version, state.Files); err != nil {
			return err
		}
		if err := verifyStatic(installer.config, identity); err != nil {
			return err
		}
	} else if exists(installer.config.Paths.Current) || exists(installer.config.Paths.Unit) || exists(installer.config.Paths.Template) {
		return fmt.Errorf("unknown_current")
	} else if hasReleaseDirectory(installer.config.Paths.ReleaseRoot) {
		return fmt.Errorf("unknown_release")
	}
	if err := verifyEnvironmentMetadata(installer.config, identity); err != nil {
		return err
	}
	if err := ensureDirectory(installer.config.Paths.ReleaseRoot, 0o755); err != nil {
		return err
	}
	candidate, err := os.MkdirTemp(installer.config.Paths.ReleaseRoot, ".candidate-")
	if err != nil {
		return fmt.Errorf("candidate_create_failed")
	}
	defer os.RemoveAll(candidate)
	if err := copyTree(filepath.Join(installer.config.BundleRoot, "application"), candidate); err != nil {
		return err
	}
	if err := verifyApplication(candidate, value); err != nil {
		return err
	}
	if err := applyTreeOwner(installer.config, candidate, 0, 0); err != nil {
		return err
	}
	release := filepath.Join(installer.config.Paths.ReleaseRoot, value.Version)
	if _, err := os.Stat(release); err == nil {
		return fmt.Errorf("release_exists")
	}
	if err := os.Rename(candidate, release); err != nil {
		return fmt.Errorf("release_commit_failed")
	}
	if err := atomicCurrent(installer.config.Paths.Current, release); err != nil {
		return err
	}
	if err := applyOwner(installer.config, installer.config.Paths.Current, 0, 0, true); err != nil {
		return err
	}
	if err := installStatic(installer.config, identity); err != nil {
		return err
	}
	newState := State{SchemaVersion: 1, Version: value.Version, Files: releaseFiles(value)}
	oldPrevious := ""
	if stateExists {
		newState.Previous = state.Version
		newState.PreviousFiles = state.Files
		oldPrevious = state.Previous
	}
	if err := writeState(installer.config.Paths.StateHome, installer.config.Paths.StateFile, newState); err != nil {
		return err
	}
	if oldPrevious != "" && oldPrevious != newState.Version && oldPrevious != newState.Previous {
		if err := os.RemoveAll(filepath.Join(installer.config.Paths.ReleaseRoot, oldPrevious)); err != nil {
			return fmt.Errorf("previous_release_cleanup_failed")
		}
	}
	return nil
}

func (installer *Installer) verify(identity runtimeidentity.Identity) error {
	state, existsState, err := readState(installer.config.Paths.StateFile)
	if err != nil || !existsState || state.Version == "" {
		return fmt.Errorf("state_invalid")
	}
	if err := verifyCurrent(installer.config.Paths.Current, installer.config.Paths.ReleaseRoot, state.Version, state.Files); err != nil {
		return err
	}
	if err := verifyReleaseSet(installer.config.Paths.ReleaseRoot, state); err != nil {
		return err
	}
	if err := verifyStatic(installer.config, identity); err != nil {
		return err
	}
	return nil
}

func (installer *Installer) rollback(ctx context.Context) error {
	state, existsState, err := readState(installer.config.Paths.StateFile)
	if err != nil || !existsState || state.Previous == "" {
		return fmt.Errorf("rollback_unavailable")
	}
	previous := filepath.Join(installer.config.Paths.ReleaseRoot, state.Previous)
	if err := verifyReleaseDirectory(previous); err != nil {
		return err
	}
	if err := verifyReleaseSet(installer.config.Paths.ReleaseRoot, state); err != nil {
		return err
	}
	if err := verifyReleaseFiles(previous, state.PreviousFiles); err != nil {
		return err
	}
	if err := atomicCurrent(installer.config.Paths.Current, previous); err != nil {
		return err
	}
	state.Version, state.Previous = state.Previous, state.Version
	state.Files, state.PreviousFiles = state.PreviousFiles, state.Files
	return writeState(installer.config.Paths.StateHome, installer.config.Paths.StateFile, state)
}

func (installer *Installer) uninstall() error {
	state, existsState, err := readState(installer.config.Paths.StateFile)
	if err != nil || !existsState {
		return fmt.Errorf("state_invalid")
	}
	if err := verifyCurrent(installer.config.Paths.Current, installer.config.Paths.ReleaseRoot, state.Version, state.Files); err != nil {
		return err
	}
	if err := verifyReleaseSet(installer.config.Paths.ReleaseRoot, state); err != nil {
		return err
	}
	if err := os.Remove(installer.config.Paths.Current); err != nil {
		return fmt.Errorf("current_remove_failed")
	}
	for _, version := range []string{state.Version, state.Previous} {
		if version == "" {
			continue
		}
		if err := os.RemoveAll(filepath.Join(installer.config.Paths.ReleaseRoot, version)); err != nil {
			return fmt.Errorf("release_remove_failed")
		}
	}
	for _, path := range []string{installer.config.Paths.Unit, installer.config.Paths.Template} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("managed_file_remove_failed")
		}
	}
	if err := os.Remove(installer.config.Paths.StateFile); err != nil {
		return fmt.Errorf("state_remove_failed")
	}
	return nil
}

func readBundleManifest(root string) (manifest.Manifest, error) {
	data, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return manifest.Manifest{}, fmt.Errorf("manifest_missing")
	}
	value, err := manifest.Decode(data)
	if err != nil {
		return manifest.Manifest{}, fmt.Errorf("manifest_invalid")
	}
	return value, nil
}

func installStatic(config Config, identity runtimeidentity.Identity) error {
	if err := ensureDirectory(config.Paths.ConfigDir, 0o750); err != nil {
		return err
	}
	if err := applyOwner(config, config.Paths.ConfigDir, 0, identity.PrimaryGroupID, false); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(config.BundleRoot, "systemd", "atlas-manager.service"), config.Paths.Unit, 0o644); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(config.BundleRoot, "config", "atlas-manager.env.example"), config.Paths.Template, 0o640); err != nil {
		return err
	}
	if err := applyOwner(config, config.Paths.Unit, 0, 0, false); err != nil {
		return err
	}
	if err := applyOwner(config, config.Paths.Template, 0, identity.PrimaryGroupID, false); err != nil {
		return err
	}
	return nil
}

func verifyStatic(config Config, identity runtimeidentity.Identity) error {
	unit, err := os.ReadFile(config.Paths.Unit)
	if err != nil || !systemdunit.Validate(string(unit)) || !managedFileMetadata(config, config.Paths.Unit, 0o644, 0, 0) {
		return fmt.Errorf("systemd_unit_invalid")
	}
	if !managedFileMetadata(config, config.Paths.Template, 0o640, 0, identity.PrimaryGroupID) {
		return fmt.Errorf("template_invalid")
	}
	return verifyEnvironmentMetadata(config, identity)
}

func managedFileMetadata(config Config, path string, mode os.FileMode, uid, gid int) bool {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != mode || fileNlink(info) != 1 {
		return false
	}
	return !config.ApplyOwnership || (fileUID(info) == uid && fileGID(info) == gid)
}

func verifyEnvironmentMetadata(config Config, identity runtimeidentity.Identity) error {
	if !exists(config.Paths.Environment) {
		return nil
	}
	info, err := os.Lstat(config.Paths.Environment)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o640 || fileNlink(info) != 1 {
		return fmt.Errorf("environment_metadata_invalid")
	}
	if config.ApplyOwnership && (fileUID(info) != 0 || fileGID(info) != identity.PrimaryGroupID) {
		return fmt.Errorf("environment_metadata_invalid")
	}
	return nil
}

func verifyCurrent(current, releases, version string, files []manifest.File) error {
	target, err := os.Readlink(current)
	if err != nil || filepath.Clean(target) != filepath.Join(releases, version) {
		return fmt.Errorf("current_invalid")
	}
	info, err := os.Lstat(current)
	if err != nil || info.Mode()&os.ModeSymlink == 0 || fileNlink(info) != 1 {
		return fmt.Errorf("current_invalid")
	}
	release := filepath.Join(releases, version)
	if err := verifyReleaseDirectory(release); err != nil {
		return err
	}
	return verifyReleaseFiles(release, files)
}

func verifyReleaseDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("release_invalid")
	}
	return nil
}

func verifyReleaseSet(root string, state State) error {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return fmt.Errorf("release_set_invalid")
	}
	if err != nil {
		return fmt.Errorf("release_set_invalid")
	}
	allowed := map[string]struct{}{state.Version: {}}
	if state.Previous != "" {
		allowed[state.Previous] = struct{}{}
	}
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if _, ok := allowed[name]; !ok || entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() {
			return fmt.Errorf("release_set_invalid")
		}
		seen[name] = struct{}{}
	}
	if _, ok := seen[state.Version]; !ok {
		return fmt.Errorf("release_set_invalid")
	}
	if state.Previous != "" {
		if _, ok := seen[state.Previous]; !ok {
			return fmt.Errorf("release_set_invalid")
		}
	}
	return nil
}

func hasReleaseDirectory(root string) bool {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return false
	}
	if err != nil {
		return true
	}
	for _, entry := range entries {
		if entry.Name() == "." || entry.Name() == ".." {
			continue
		}
		return true
	}
	return false
}

func verifyReleaseFiles(root string, expected []manifest.File) error {
	paths, err := manifest.Files(root)
	if err != nil {
		return fmt.Errorf("release_files_invalid")
	}
	actual := make([]manifest.File, 0, len(paths))
	for _, path := range paths {
		files, inventoryErr := manifest.Inventory(root, []string{path})
		if inventoryErr != nil {
			return fmt.Errorf("release_files_invalid")
		}
		actual = append(actual, files[0])
	}
	if len(actual) != len(expected) {
		return fmt.Errorf("release_files_invalid")
	}
	for index := range actual {
		if actual[index] != expected[index] {
			return fmt.Errorf("release_files_invalid")
		}
	}
	return nil
}

func verifyApplication(path string, value manifest.Manifest) error {
	if err := verifyReleaseDirectory(path); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(path, "dist", "main.js")); err != nil {
		return fmt.Errorf("application_entry_missing")
	}
	if _, err := os.Stat(filepath.Join(path, "node_modules")); err != nil {
		return fmt.Errorf("runtime_dependencies_missing")
	}
	return nil
}

func writeState(directory, path string, state State) error {
	if err := ensureDirectory(directory, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".candidate"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return fmt.Errorf("state_write_failed")
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("state_commit_failed")
	}
	return nil
}

func readState(path string) (State, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return State{}, false, nil
	}
	if err != nil {
		return State{}, false, fmt.Errorf("state_read_failed")
	}
	var state State
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&state) != nil || state.SchemaVersion != 1 || !safeVersion(state.Version) || (state.Previous != "" && !safeVersion(state.Previous)) || !validStateFiles(state.Files) || (state.Previous != "" && !validStateFiles(state.PreviousFiles)) {
		return State{}, true, fmt.Errorf("state_invalid")
	}
	return state, true, nil
}

func validStateFiles(files []manifest.File) bool {
	if len(files) == 0 {
		return false
	}
	previous := ""
	for _, file := range files {
		if !safeManifestPath(file.Path) {
			return false
		}
		if file.Path <= previous || file.Size < 0 || len(file.SHA256) != 64 || strings.ToLower(file.SHA256) != file.SHA256 || !isHex(file.SHA256) {
			return false
		}
		previous = file.Path
	}
	return true
}

func safeManifestPath(value string) bool {
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

func releaseFiles(value manifest.Manifest) []manifest.File {
	files := make([]manifest.File, 0)
	for _, file := range value.Files {
		if strings.HasPrefix(file.Path, "application/") {
			file.Path = strings.TrimPrefix(file.Path, "application/")
			files = append(files, file)
		}
	}
	return files
}

func validateStateMetadata(config Config) error {
	info, err := os.Lstat(config.Paths.StateFile)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 || fileNlink(info) != 1 || (config.ApplyOwnership && (fileUID(info) != 0 || fileGID(info) != 0)) {
		return fmt.Errorf("state_invalid")
	}
	return nil
}

func safeVersion(value string) bool {
	if value == "" || value == "." || value == ".." {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._+-", char)) {
			return false
		}
	}
	return true
}

func atomicCurrent(current, release string) error {
	temporary := current + ".candidate"
	_ = os.Remove(temporary)
	if err := os.Symlink(release, temporary); err != nil {
		return fmt.Errorf("current_create_failed")
	}
	if err := os.Rename(temporary, current); err != nil {
		return fmt.Errorf("current_commit_failed")
	}
	return nil
}

func acquireLock(path string, enforceOwner bool) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("lock_parent_failed")
	}
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 || fileNlink(info) != 1 || (enforceOwner && (fileUID(info) != 0 || fileGID(info) != 0)) {
			return nil, fmt.Errorf("lock_invalid")
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("lock_invalid")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("lock_failed")
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return nil, fmt.Errorf("lock_invalid")
	}
	if enforceOwner {
		if err := file.Chown(0, 0); err != nil {
			file.Close()
			return nil, fmt.Errorf("lock_invalid")
		}
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("lock_busy")
	}
	return file, nil
}

func ensureDirectory(path string, mode os.FileMode) error {
	if err := os.MkdirAll(path, mode); err != nil {
		return fmt.Errorf("directory_failed")
	}
	return os.Chmod(path, mode)
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return fmt.Errorf("release_file_type_invalid")
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return fmt.Errorf("release_file_type_invalid")
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}

func copyFile(source, target string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("managed_file_read_failed")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("managed_parent_failed")
	}
	if err := os.WriteFile(target, data, mode); err != nil {
		return fmt.Errorf("managed_file_write_failed")
	}
	return os.Chmod(target, mode)
}

func exists(path string) bool { _, err := os.Lstat(path); return err == nil }

func fileNlink(info os.FileInfo) uint64 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(stats.Nlink)
	}
	return 0
}

func fileUID(info os.FileInfo) int {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(stats.Uid)
	}
	return -1
}

func fileGID(info os.FileInfo) int {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(stats.Gid)
	}
	return -1
}

func defaultNodeCheck(path string) NodeVersionChecker {
	return func(ctx context.Context) error {
		commandContext, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		command := exec.CommandContext(commandContext, path, "--version")
		command.Stdin = strings.NewReader("")
		command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TZ=UTC"}
		stdout := &boundedWriter{limit: 1024}
		stderr := &boundedWriter{limit: 1024}
		command.Stdout = stdout
		command.Stderr = stderr
		if err := command.Run(); err != nil || stdout.overflow || stderr.overflow || strings.TrimSpace(string(stdout.data)) != "v24.18.0" {
			return fmt.Errorf("node_version_invalid")
		}
		return nil
	}
}

type boundedWriter struct {
	data     []byte
	limit    int
	overflow bool
}

func (writer *boundedWriter) Write(value []byte) (int, error) {
	if len(writer.data)+len(value) > writer.limit {
		writer.overflow = true
		return len(value), nil
	}
	writer.data = append(writer.data, value...)
	return len(value), nil
}

func validateProductionIdentity() (runtimeidentity.Identity, error) {
	if err := validateFixedAccountMetadata(); err != nil {
		return runtimeidentity.Identity{}, err
	}
	passwd, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return runtimeidentity.Identity{}, err
	}
	group, err := os.ReadFile("/etc/group")
	if err != nil {
		return runtimeidentity.Identity{}, err
	}
	return runtimeidentity.ValidateAccountContract(string(passwd), string(group))
}

func validateFixedAccountMetadata() error {
	etc, err := os.Lstat("/etc")
	if err != nil || !etc.IsDir() || etc.Mode()&os.ModeSymlink != 0 || fileUID(etc) != 0 || etc.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("runtime_identity_files_unsafe")
	}
	for _, path := range []string{"/etc/passwd", "/etc/group"} {
		info, statErr := os.Lstat(path)
		if statErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || fileUID(info) != 0 || info.Mode().Perm()&0o022 != 0 || fileNlink(info) != 1 || info.Size() > runtimeidentity.MaxAccountBytes {
			return fmt.Errorf("runtime_identity_files_unsafe")
		}
	}
	return nil
}

func validateFixedParentMetadata(config Config) error {
	if !config.ApplyOwnership {
		return nil
	}
	for _, path := range []string{"/opt", "/etc", "/etc/systemd", "/etc/systemd/system", "/var", "/run"} {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || fileUID(info) != 0 || info.Mode().Perm()&0o022 != 0 {
			return fmt.Errorf("parent_directory_unsafe")
		}
	}
	return nil
}

func validateNodeMetadata(path string, enforceOwner bool) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o111 == 0 || (enforceOwner && fileUID(info) != 0) {
		return fmt.Errorf("node_runtime_invalid")
	}
	return nil
}

func applyOwner(config Config, path string, uid, gid int, link bool) error {
	if !config.ApplyOwnership {
		return nil
	}
	var err error
	if link {
		err = os.Lchown(path, uid, gid)
	} else {
		err = os.Chown(path, uid, gid)
	}
	if err != nil {
		return fmt.Errorf("ownership_apply_failed")
	}
	return nil
}

func applyTreeOwner(config Config, root string, uid, gid int) error {
	if !config.ApplyOwnership {
		return nil
	}
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if err := applyOwner(config, path, uid, gid, false); err != nil {
			return err
		}
		return nil
	})
}

func isHex(value string) bool {
	_, err := hex.DecodeString(value)
	return err == nil
}
