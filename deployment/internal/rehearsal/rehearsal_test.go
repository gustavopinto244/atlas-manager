package rehearsal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/bundle"
	"github.com/atlas-manager/atlas-manager/deployment/internal/hostinspection"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identitycommand"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identitypreparation"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identityreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualification"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const (
	baselineCommit = "41614fc8c9b757ffa4a4a1264d2baec7f9b1b93b"
	commitA        = "0123456789abcdef0123456789abcdef01234567"
	commitB        = "fedcba9876543210fedcba9876543210fedcba98"
)

type buildRunner struct{}

func (buildRunner) Run(_ context.Context, name string, args []string, directory string, _ []string) (string, error) {
	joined := strings.Join(args, " ")
	switch {
	case name == "node" && len(args) == 1 && args[0] == "--version":
		return "v24.18.0\n", nil
	case name == "npm" && len(args) == 1 && args[0] == "--version":
		return "11.16.0\n", nil
	case name == "go" && len(args) == 1 && args[0] == "version":
		return "go version go1.23.0 linux/amd64\n", nil
	case name == "npm" && strings.Contains(joined, "--omit=dev"):
		return "", writeFile(filepath.Join(directory, "node_modules/runtime/index.js"), "export {};\n", 0o644)
	case name == "npm" && joined == "run build:deployment":
		// Stand in for tsc plus the dashboard bundling step: the served
		// entrypoint must arrive already bundled, as an IIFE with no module
		// statements.
		if err := writeFile(filepath.Join(directory, "dist/main.js"), "export default {};\n", 0o644); err != nil {
			return "", err
		}
		if err := writeFile(filepath.Join(directory, "dist/dashboard/main.js"), "\"use strict\";\n(() => {})();\n", 0o644); err != nil {
			return "", err
		}
		return "", writeFile(filepath.Join(directory, "dist/dashboard/styles.css"), "body{margin:0}\n", 0o644)
	case name == "npm":
		return "", writeFile(filepath.Join(directory, "node_modules/typescript/bin/tsc"), "fixture compiler\n", 0o755)
	case name == "node":
		return "", writeFile(filepath.Join(directory, "dist/main.js"), "export default {};\n", 0o644)
	default:
		return "", nil
	}
}

type accountExecutor struct {
	paths       identitypreparation.Paths
	seen        []string
	failPath    string
	failCommand string
}

func (executor *accountExecutor) Run(_ context.Context, path string, args []string) identitycommand.Result {
	if path == identitycommand.UserTool && len(args) == 1 && args[0] == "--help" {
		return identitycommand.Result{Stdout: []byte("--system --no-create-home --no-user-group --gid --home-dir --shell\n")}
	}
	if path == identitycommand.UserTool && len(args) == 1 && args[0] == "-D" {
		return identitycommand.Result{Stdout: []byte("CREATE_MAIL_SPOOL=no\n")}
	}
	if path == identitycommand.DpkgQueryTool {
		return identitycommand.Result{Stdout: []byte("passwd\n1:4.17.4-2ubuntu3\nshadow\n1:4.17.4-2ubuntu3\namd64\n")}
	}
	executor.seen = append(executor.seen, path+" "+strings.Join(args, " "))
	if path == executor.failPath || path+" "+strings.Join(args, " ") == executor.failCommand {
		return identitycommand.Result{ExitCode: 1}
	}
	if path == identitycommand.PrimaryGroupTool {
		if strings.Join(args, " ") == strings.Join(identitycommand.PrimaryGroupArguments(), " ") {
			if err := executor.appendGroup("atlas-manager:x:1001:\n"); err != nil {
				return identitycommand.Result{ExitCode: 2}
			}
		} else if strings.Join(args, " ") == strings.Join(identitycommand.HelperGroupArguments(), " ") {
			if err := executor.appendGroup("atlas-manager-power:x:1002:\n"); err != nil {
				return identitycommand.Result{ExitCode: 2}
			}
		} else {
			return identitycommand.Result{ExitCode: 2}
		}
	} else if path == identitycommand.UserTool {
		if strings.Join(args, " ") != strings.Join(identitycommand.UserArguments(identitycommand.UserAddCapabilities{System: true, NoCreateHome: true, NoUserGroup: true, GID: true, HomeDir: true, Shell: true}), " ") {
			return identitycommand.Result{ExitCode: 2}
		}
		if err := executor.appendPasswd("atlas-manager:x:1003:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
		if err := executor.appendShadow("atlas-manager:!:19793:0:99999:7:::\n"); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
	} else if path == identitycommand.UserDeleteTool {
		if strings.Join(args, " ") != strings.Join(identitycommand.UserDeleteArguments(), " ") {
			return identitycommand.Result{ExitCode: 2}
		}
		if err := executor.removePasswd(); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
		if err := executor.removeShadow(); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
	} else if path == identitycommand.GroupDeleteTool {
		if strings.Join(args, " ") != strings.Join(identitycommand.HelperGroupDeleteArguments(), " ") && strings.Join(args, " ") != strings.Join(identitycommand.PrimaryGroupDeleteArguments(), " ") {
			return identitycommand.Result{ExitCode: 2}
		}
		if err := executor.removeGroup(args[0]); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
	} else {
		return identitycommand.Result{ExitCode: 2}
	}
	return identitycommand.Result{}
}

func (executor *accountExecutor) appendPasswd(line string) error {
	data, err := os.ReadFile(executor.paths.Passwd)
	if err != nil {
		return err
	}
	return os.WriteFile(executor.paths.Passwd, append(data, []byte(line)...), 0o644)
}

func (executor *accountExecutor) appendGroup(line string) error {
	data, err := os.ReadFile(executor.paths.Group)
	if err != nil {
		return err
	}
	return os.WriteFile(executor.paths.Group, append(data, []byte(line)...), 0o644)
}

func (executor *accountExecutor) appendShadow(line string) error {
	data, err := os.ReadFile(executor.paths.Shadow)
	if err != nil {
		return err
	}
	return os.WriteFile(executor.paths.Shadow, append(data, []byte(line)...), 0o644)
}

func (executor *accountExecutor) removePasswd() error {
	return filterLines(executor.paths.Passwd, runtimeidentity.RuntimeUser)
}

func (executor *accountExecutor) removeGroup(name string) error {
	return filterLines(executor.paths.Group, name)
}

func (executor *accountExecutor) removeShadow() error {
	return filterLines(executor.paths.Shadow, runtimeidentity.RuntimeUser)
}

func filterLines(path, name string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	kept := lines[:0]
	for _, line := range lines {
		fields := strings.Split(line, ":")
		if len(fields) > 0 && fields[0] == name {
			continue
		}
		kept = append(kept, line)
	}
	return os.WriteFile(path, []byte(strings.Join(kept, "\n")), 0o644)
}

type fixture struct {
	root       string
	host       string
	bundleA    string
	bundleB    string
	hostPaths  hostinspection.Paths
	identity   identitypreparation.Paths
	deployment installer.Paths
	inspector  hostinspection.Inspector
	executor   *accountExecutor
	identityID runtimeidentity.Identity
}

func TestSuccessfulDisabledDeploymentRehearsalIsDeterministic(t *testing.T) {
	first := runLifecycle(t)
	second := runLifecycle(t)
	if string(first) != string(second) {
		t.Fatal("equivalent sandbox rehearsals produced different evidence")
	}
	if digest := sha256.Sum256(first); hex.EncodeToString(digest[:]) == "" {
		t.Fatal("evidence digest missing")
	}
}

func runLifecycle(t *testing.T) []byte {
	t.Helper()
	root := t.TempDir()
	bundleA, archiveA, repeatedA := buildRelease(t, root, "0.1.0", commitA)
	bundleB, archiveB, repeatedB := buildRelease(t, root, "0.1.1", commitB)
	if archiveA == archiveB || repeatedA != archiveA || repeatedB != archiveB {
		t.Fatal("release reproducibility contract failed")
	}
	f := newFixture(t, root, bundleA)
	f.bundleB = bundleB
	ctx := context.Background()
	evidence := Evidence{SchemaVersion: SchemaVersion, Result: "passed", BaselineCommit: baselineCommit, ReleaseA: Release{Version: "0.1.0", SourceCommit: commitA, ArchiveSHA256: archiveA, RepeatedBuildSHA256: repeatedA}, ReleaseB: Release{Version: "0.1.1", SourceCommit: commitB, ArchiveSHA256: archiveB, RepeatedBuildSHA256: repeatedB}, FinalState: "managed_prepared"}
	chain := ""
	sequence := 0
	run := func(action, expected, observed, mutation string, allowed []string, operation func() error) {
		t.Helper()
		sequence++
		before, err := Snapshot(f.host)
		if err != nil {
			t.Fatal(err)
		}
		if err := operation(); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		after, err := Snapshot(f.host)
		if err != nil {
			t.Fatal(err)
		}
		changed := Changed(before, after)
		if err := AssertAllowedEntries(changed, before, after, allowed); err != nil {
			t.Fatalf("%s changed %v: %v", action, changed, err)
		}
		if mutation == "none" && len(changed) != 0 {
			t.Fatalf("%s was not read-only: %v", action, changed)
		}
		reportDigest := ReportDigest(action, observed, mutation)
		chain = Chain(chain, reportDigest)
		evidence.Steps = append(evidence.Steps, Step{Sequence: sequence, Action: action, ExpectedResult: expected, ObservedResult: observed, ReportSHA256: reportDigest, MutationClassification: mutation})
	}

	run("qualify", "preparation_required", "preparation_required", "none", nil, func() error {
		return expectQualification(ctx, f.inspector, qualification.Qualify, "preparation_required")
	})
	run("identity inspect", "absent", "absent", "none", nil, func() error {
		report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(ctx, identitypreparation.Inspect, "")
		return expectIdentity(report, err, "absent")
	})
	run("identity prepare-disabled", "prepared", "prepared", "identity_account_database", []string{"etc/passwd", "etc/group", "etc/shadow", "var/lib"}, func() error {
		report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(ctx, identitypreparation.PrepareDisabled, identitypreparation.Confirmation)
		return expectIdentity(report, err, "prepared")
	})
	run("identity verify-managed", "managed_prepared", "managed_prepared", "none", nil, func() error {
		report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(ctx, identitypreparation.VerifyManaged, "")
		return expectIdentity(report, err, "managed_prepared")
	})
	run("verify-prepared", "prepared", "prepared", "none", nil, func() error { return expectQualification(ctx, f.inspector, qualification.VerifyPrepared, "prepared") })
	run("install-disabled A", "installed_disabled", "installed_disabled", "deployment_release", []string{"opt/atlas-manager", "etc/systemd/system/atlas-manager.service", "etc/atlas-manager/atlas-manager.env.example", "var/lib/atlas-manager-deployment", "run"}, func() error { return installerFor(f, f.bundleA).Run(ctx, installer.InstallDisabled) })
	run("verify-disabled A", "verified_disabled", "verified_disabled", "none", nil, func() error { return installerFor(f, f.bundleA).Run(ctx, installer.VerifyDisabled) })
	run("verify-disabled-installation", "disabled_installation_verified", "disabled_installation_verified", "none", nil, func() error {
		return expectQualification(ctx, f.inspector, qualification.VerifyDisabledInstallation, "disabled_installation_verified")
	})
	run("install-disabled B", "upgraded_disabled", "upgraded_disabled", "deployment_release", []string{"opt/atlas-manager", "var/lib/atlas-manager-deployment", "run"}, func() error { return installerFor(f, f.bundleB).Run(ctx, installer.InstallDisabled) })
	run("verify-disabled B", "verified_disabled", "verified_disabled", "none", nil, func() error { return installerFor(f, f.bundleB).Run(ctx, installer.VerifyDisabled) })
	run("rollback-disabled", "rolled_back_disabled", "rolled_back_disabled", "deployment_current_link", []string{"opt/atlas-manager/current", "var/lib/atlas-manager-deployment", "run"}, func() error { return installerFor(f, f.bundleB).Run(ctx, installer.RollbackDisabled) })
	run("verify-disabled A after rollback", "verified_disabled", "verified_disabled", "none", nil, func() error { return installerFor(f, f.bundleA).Run(ctx, installer.VerifyDisabled) })
	run("uninstall-disabled", "uninstalled_disabled", "uninstalled_disabled", "deployment_release", []string{"opt/atlas-manager", "etc/systemd/system/atlas-manager.service", "etc/atlas-manager/atlas-manager.env.example", "var/lib/atlas-manager-deployment", "run"}, func() error { return installerFor(f, f.bundleA).Run(ctx, installer.UninstallDisabled) })
	run("verify-removed", "removed", "removed", "none", nil, func() error { return expectQualification(ctx, f.inspector, qualification.VerifyRemoved, "removed") })
	run("identity verify-managed after uninstall", "managed_prepared", "managed_prepared", "none", nil, func() error {
		report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(ctx, identitypreparation.VerifyManaged, "")
		return expectIdentity(report, err, "managed_prepared")
	})
	for _, path := range []string{f.identity.Lock, f.deployment.Lock} {
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			t.Fatalf("successful rehearsal left stale lock %q", path)
		}
	}
	evidence.EvidenceChain = chain
	evidence.MutationSummary = []string{"identity_account_database", "identity_managed_state", "deployment_release", "deployment_current_link", "deployment_systemd_unit", "deployment_environment_template", "deployment_managed_state"}
	data, err := evidence.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	evidenceDigest := sha256.Sum256(data)
	t.Logf("release_a=%s release_b=%s evidence=%s", evidence.ReleaseA.ArchiveSHA256, evidence.ReleaseB.ArchiveSHA256, hex.EncodeToString(evidenceDigest[:]))
	return data
}

func buildRelease(t *testing.T, root, version, commit string) (string, string, string) {
	t.Helper()
	source := filepath.Join(root, "source-"+version)
	for _, path := range []string{"src", "src/dashboard", "dashboard-assets", "tools", "docs/contracts"} {
		if err := os.MkdirAll(filepath.Join(source, path), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"tsconfig.json", "tsconfig.build.json", "tsconfig.deployment.json"} {
		if err := writeFile(filepath.Join(source, name), "{}\n", 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeFile(filepath.Join(source, "src/main.ts"), "export {};\n", 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(source, "src/dashboard/styles.css"), "body{}\n", 0o644); err != nil {
		t.Fatal(err)
	}
	// build:deployment runs from the copied source tree.
	if err := writeFile(filepath.Join(source, "scripts/generate-dashboard-assets.mjs"), "// fixture\n", 0o644); err != nil {
		t.Fatal(err)
	}
	for _, asset := range []string{"app.js", "index.html", "styles.css"} {
		if err := writeFile(filepath.Join(source, "dashboard-assets", asset), asset+"\n", 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeFile(filepath.Join(source, "package.json"), `{"name":"atlas-manager","version":"`+version+`"}`, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(source, "package-lock.json"), `{"name":"atlas-manager","version":"`+version+`","lockfileVersion":3,"requires":true,"packages":{}}`, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"atlas-manager-administrative-api.json", "atlas-manager-release-contract.json"} {
		if err := writeFile(filepath.Join(source, "docs/contracts", name), "{}\n", 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tools := map[string]string{"atlas-manager-installer": "installer", "atlas-manager-server-installer": "server-installer", "atlas-manager-host-qualification": "qualification", "atlas-manager-runtime-identity-installer": "identity", "atlas-manager-runtime-configuration": "configuration", "atlas-manager-administrative-runtime-configuration": "administrative-configuration", "atlas-manager-service-lifecycle": "lifecycle"}
	toolPaths := map[string]string{}
	for name, content := range tools {
		path := filepath.Join(source, "tools", name)
		if err := writeFile(path, content, 0o755); err != nil {
			t.Fatal(err)
		}
		toolPaths[name] = path
	}
	buildOnce := func(output string) string {
		result, err := bundle.Build(context.Background(), bundle.Config{Version: version, SourceCommit: commit, SourceDateEpoch: 0, SourceRoot: source, OutputDir: output, DashboardAssetsRoot: filepath.Join(source, "dashboard-assets"), NodeVersion: bundle.PinnedNode, NPMVersion: bundle.PinnedNPM, GoVersion: bundle.PinnedGo, InstallerPath: toolPaths["atlas-manager-installer"], ServerInstallerPath: toolPaths["atlas-manager-server-installer"], QualificationPath: toolPaths["atlas-manager-host-qualification"], IdentityInstallerPath: toolPaths["atlas-manager-runtime-identity-installer"], RuntimeConfigurationPath: toolPaths["atlas-manager-runtime-configuration"], AdministrativeRuntimeConfigurationPath: toolPaths["atlas-manager-administrative-runtime-configuration"], ServiceLifecyclePath: toolPaths["atlas-manager-service-lifecycle"], Runner: buildRunner{}})
		if err != nil {
			t.Fatal(err)
		}
		digest, err := manifest.SHA256File(result.Archive)
		if err != nil {
			t.Fatal(err)
		}
		return digest
	}
	firstOutput := filepath.Join(root, "build-"+version+"-a")
	secondOutput := filepath.Join(root, "build-"+version+"-b")
	firstDigest := buildOnce(firstOutput)
	secondDigest := buildOnce(secondOutput)
	return filepath.Join(firstOutput, "atlas-manager_"+version+"_linux_amd64"), firstDigest, secondDigest
}

func newFixture(t *testing.T, root, bundleRoot string) *fixture {
	t.Helper()
	host := filepath.Join(root, "host")
	for _, path := range []string{"opt", "etc/systemd/system/multi-user.target.wants", "var", "var/log", "var/lib", "run/systemd/system", "usr/bin", "usr/sbin", "usr/local/libexec"} {
		if err := os.MkdirAll(filepath.Join(host, path), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(host, "var/log"), 0o775); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("usr/sbin", filepath.Join(host, "sbin")); err != nil {
		t.Fatal(err)
	}
	passwd := "root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n"
	group := "root:x:0:\nnobody:x:65534:\nsyslog:x:100:\nutmp:x:101:\n"
	if err := writeFile(filepath.Join(host, "etc/passwd"), passwd, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(host, "etc/group"), group, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(host, "etc/shadow"), "", 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(host, "usr/bin/node"), "synthetic node\n", 0o755); err != nil {
		t.Fatal(err)
	}
	f := &fixture{root: root, host: host, bundleA: bundleRoot, identityID: runtimeidentity.Identity{UserID: 1003, PrimaryGroupID: 1001, HelperGroupID: 1002}}
	f.hostPaths = hostPaths(host, bundleRoot)
	f.identity = identityPaths(host, bundleRoot)
	f.deployment = f.hostPaths.Deployment
	f.executor = &accountExecutor{paths: f.identity}
	f.inspector = hostinspection.New(f.hostPaths, hostinspection.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }, CheckNode: func(context.Context, string) error { return nil }, Capacity: func(string) (hostinspection.Capacity, error) { return hostinspection.Capacity{Available: 1 << 40}, nil }})
	return f
}

func (f *fixture) identityDependencies() identitypreparation.Dependencies {
	return identitypreparation.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }, ValidateTool: func(string) error { return nil }, ValidateDirectory: func(string) error { return nil }, ValidateAccountFile: func(string) error { return nil }, ValidatePrivatePath: func(string) error { return nil }, Executor: f.executor, HostQualify: func(ctx context.Context) (qualificationreport.Report, error) {
		return qualification.Run(ctx, qualification.Qualify, f.inspector)
	}}
}

func installerFor(f *fixture, bundleRoot string) *installer.Installer {
	return installer.New(installer.Config{Paths: f.deployment, BundleRoot: bundleRoot, EffectiveUID: func() int { return 0 }, ResolveIdentity: func() (runtimeidentity.Identity, error) { return f.identityID, nil }, CheckNode: func(context.Context) error { return nil }, ApplyOwnership: false})
}

func expectQualification(ctx context.Context, inspector hostinspection.Inspector, action qualification.Action, expected string) error {
	report, err := qualification.Run(ctx, action, inspector)
	if err != nil {
		return err
	}
	if report.Result != expected {
		return &expectedError{want: expected, got: report.Result}
	}
	return nil
}

func expectIdentity(report identityreport.Report, err error, expected string) error {
	if err != nil {
		return err
	}
	if report.Result != expected {
		return &expectedError{want: expected, got: report.Result}
	}
	return nil
}

type expectedError struct{ want, got string }

func (err *expectedError) Error() string { return "expected " + err.want + ", got " + err.got }

func hostPaths(root, bundleRoot string) hostinspection.Paths {
	paths := hostinspection.ProductionPaths(bundleRoot)
	paths.Opt = filepath.Join(root, "opt")
	paths.Usr = filepath.Join(root, "usr")
	paths.UsrBin = filepath.Join(root, "usr/bin")
	paths.Etc = filepath.Join(root, "etc")
	paths.Systemd = filepath.Join(root, "etc/systemd")
	paths.SystemdSystem = filepath.Join(root, "etc/systemd/system")
	paths.SystemdWants = filepath.Join(root, "etc/systemd/system/multi-user.target.wants")
	paths.Var = filepath.Join(root, "var")
	paths.VarLib = filepath.Join(root, "var/lib")
	paths.Run = filepath.Join(root, "run")
	paths.SystemdRun = filepath.Join(root, "run/systemd/system")
	paths.Passwd = filepath.Join(root, "etc/passwd")
	paths.Group = filepath.Join(root, "etc/group")
	paths.ApplicationState = filepath.Join(root, "var/lib/atlas-manager")
	paths.IdentityStateFile = filepath.Join(root, "var/lib/atlas-manager-identity-preparation/state.json")
	paths.IdentityJournalFile = filepath.Join(root, "var/lib/atlas-manager-identity-preparation/transaction.json")
	paths.Deployment = deploymentPaths(root)
	return paths
}

func deploymentPaths(root string) installer.Paths {
	paths := installer.ProductionPaths()
	paths.ReleaseRoot = filepath.Join(root, "opt/atlas-manager/releases")
	paths.Current = filepath.Join(root, "opt/atlas-manager/current")
	paths.Unit = filepath.Join(root, "etc/systemd/system/atlas-manager.service")
	paths.ConfigDir = filepath.Join(root, "etc/atlas-manager")
	paths.Template = filepath.Join(root, "etc/atlas-manager/atlas-manager.env.example")
	paths.Environment = filepath.Join(root, "etc/atlas-manager/atlas-manager.env")
	paths.StateHome = filepath.Join(root, "var/lib/atlas-manager-deployment")
	paths.StateFile = filepath.Join(root, "var/lib/atlas-manager-deployment/state.json")
	paths.Lock = filepath.Join(root, "run/atlas-manager-deployment.lock")
	paths.RuntimeDir = filepath.Join(root, "run/atlas-manager")
	paths.EnableLink = filepath.Join(root, "etc/systemd/system/multi-user.target.wants/atlas-manager.service")
	paths.Node = filepath.Join(root, "usr/bin/node")
	paths.IdentityPreparationState = filepath.Join(root, "var/lib/atlas-manager-identity-preparation/state.json")
	paths.IdentityPreparationJournal = filepath.Join(root, "var/lib/atlas-manager-identity-preparation/transaction.json")
	return paths
}

func identityPaths(root, bundleRoot string) identitypreparation.Paths {
	paths := identitypreparation.ProductionPaths(bundleRoot)
	paths.Passwd = filepath.Join(root, "etc/passwd")
	paths.Group = filepath.Join(root, "etc/group")
	paths.Shadow = filepath.Join(root, "etc/shadow")
	paths.GShadow = filepath.Join(root, "etc/gshadow")
	paths.Etc = filepath.Join(root, "etc")
	paths.Usr = filepath.Join(root, "usr")
	paths.UsrSbin = filepath.Join(root, "usr/sbin")
	paths.PamTally2 = filepath.Join(root, "sbin/pam_tally2")
	paths.Helper = filepath.Join(root, "usr/local/libexec/atlas-manager-power-helper")
	paths.RuntimeHome = filepath.Join(root, "var/lib/atlas-manager")
	paths.ApplicationState = paths.RuntimeHome
	paths.DeploymentCurrent = filepath.Join(root, "opt/atlas-manager/current")
	paths.DeploymentReleases = filepath.Join(root, "opt/atlas-manager/releases")
	paths.DeploymentUnit = filepath.Join(root, "etc/systemd/system/atlas-manager.service")
	paths.DeploymentEnable = filepath.Join(root, "etc/systemd/system/multi-user.target.wants/atlas-manager.service")
	paths.DeploymentState = filepath.Join(root, "var/lib/atlas-manager-deployment/state.json")
	paths.DeploymentLock = filepath.Join(root, "run/atlas-manager-deployment.lock")
	paths.RuntimeActivity = filepath.Join(root, "run/atlas-manager")
	paths.Configuration = filepath.Join(root, "etc/atlas-manager/atlas-manager.env")
	paths.StateDirectory = filepath.Join(root, "var/lib/atlas-manager-identity-preparation")
	paths.StateFile = filepath.Join(paths.StateDirectory, "state.json")
	paths.Journal = filepath.Join(paths.StateDirectory, "transaction.json")
	paths.Lock = filepath.Join(root, "run/atlas-manager-identity-preparation.lock")
	paths.MailSpoolPaths = []string{filepath.Join(root, "var/mail/atlas-manager"), filepath.Join(root, "var/spool/mail/atlas-manager")}
	paths.LoginLogPaths = []string{filepath.Join(root, "var/log/lastlog"), filepath.Join(root, "var/log/faillog"), filepath.Join(root, "var/log/tallylog")}
	return paths
}

func writeFile(path, content string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), mode)
}

func TestIdentityFailureRollsBackWithoutDeployment(t *testing.T) {
	root := t.TempDir()
	bundleRoot, _, _ := buildRelease(t, root, "0.1.0", commitA)
	f := newFixture(t, root, bundleRoot)
	f.executor.failPath = identitycommand.UserTool
	report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(context.Background(), identitypreparation.PrepareDisabled, identitypreparation.Confirmation)
	if err != nil || report.Result != "preparation_failed_rolled_back" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(f.identity.StateFile); !os.IsNotExist(err) {
		t.Fatal("managed state created after rollback")
	}
	if _, err := os.Stat(f.hostPaths.Deployment.Current); !os.IsNotExist(err) {
		t.Fatal("deployment exposed after identity failure")
	}
	if reportData, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(context.Background(), identitypreparation.Inspect, ""); err != nil || reportData.Result != "absent" {
		t.Fatalf("post-rollback state=%+v err=%v", reportData, err)
	}
}

func TestIncompleteIdentityRollbackPreservesJournalAndBlocksNextMutation(t *testing.T) {
	root := t.TempDir()
	bundleRoot, _, _ := buildRelease(t, root, "0.1.0", commitA)
	f := newFixture(t, root, bundleRoot)
	f.executor.failPath = identitycommand.UserTool
	f.executor.failCommand = identitycommand.GroupDeleteTool + " " + strings.Join(identitycommand.HelperGroupDeleteArguments(), " ")
	report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(context.Background(), identitypreparation.PrepareDisabled, identitypreparation.Confirmation)
	if err != nil || report.Result != "preparation_failed_recovery_required" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(f.identity.Journal); err != nil {
		t.Fatalf("transaction journal was not preserved: %v", err)
	}
	inspect, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(context.Background(), identitypreparation.Inspect, "")
	if err != nil || inspect.Result != "interrupted" {
		t.Fatalf("interrupted state=%+v err=%v", inspect, err)
	}
	if err := expectQualification(context.Background(), f.inspector, qualification.Qualify, "blocked"); err != nil {
		t.Fatal(err)
	}
	if len(f.executor.seen) != 4 {
		t.Fatalf("unexpected command ledger: %v", f.executor.seen)
	}
}

func TestIdentityLockConflictDoesNotMutate(t *testing.T) {
	root := t.TempDir()
	bundleRoot, _, _ := buildRelease(t, root, "0.1.0", commitA)
	f := newFixture(t, root, bundleRoot)
	if err := writeFile(f.identity.Lock, "busy\n", 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := identitypreparation.New(f.identity, f.identityDependencies()).Run(context.Background(), identitypreparation.PrepareDisabled, identitypreparation.Confirmation)
	if err != nil || report.Result != "blocked" || len(f.executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, f.executor.seen)
	}
}

func TestRehearsalEvidenceRejectsOversizedCollection(t *testing.T) {
	evidence := Evidence{SchemaVersion: SchemaVersion, Result: "passed", BaselineCommit: baselineCommit, FinalState: "managed_prepared", Steps: make([]Step, 65)}
	if _, err := evidence.Marshal(); err == nil {
		t.Fatal("oversized evidence accepted")
	}
}

func TestSnapshotRejectsSandboxEscapes(t *testing.T) {
	root := t.TempDir()
	if err := os.Symlink("/etc", filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, err := Snapshot(root); err == nil {
		t.Fatal("escaping symlink accepted")
	}
}

func TestSnapshotRejectsHardLinks(t *testing.T) {
	root := t.TempDir()
	original := filepath.Join(root, "original")
	link := filepath.Join(root, "link")
	if err := os.WriteFile(original, []byte("fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(original, link); err != nil {
		t.Fatal(err)
	}
	if _, err := Snapshot(root); err == nil {
		t.Fatal("hard link accepted")
	}
}
