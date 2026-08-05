package bundle

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/administrativeconfiguration"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/systemdunit"
)

const (
	PinnedNode = "24.18.0"
	PinnedNPM  = "11.16.0"
	PinnedGo   = "1.23.0"
	MaxOutput  = 64 * 1024
)

type Config struct {
	Version                                string
	SourceCommit                           string
	SourceDateEpoch                        int64
	SourceRoot                             string
	OutputDir                              string
	DashboardAssetsRoot                    string
	NodeVersion                            string
	NPMVersion                             string
	GoVersion                              string
	InstallerPath                          string
	QualificationPath                      string
	IdentityInstallerPath                  string
	RuntimeConfigurationPath               string
	ServiceLifecyclePath                   string
	AdministrativeRuntimeConfigurationPath string
	Runner                                 Runner
}

type Runner interface {
	Run(context.Context, string, []string, string, []string) (string, error)
}

type Result struct {
	Directory string
	Archive   string
	Manifest  manifest.Manifest
}

type ToolRunner struct{}

func (ToolRunner) Run(ctx context.Context, name string, args []string, dir string, environment []string) (string, error) {
	toolContext, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	resolved, err := exec.LookPath(name)
	if err != nil && name == "go" {
		if _, statErr := os.Stat("/usr/local/go/bin/go"); statErr == nil {
			resolved = "/usr/local/go/bin/go"
			err = nil
		}
	}
	if err != nil {
		return "", fmt.Errorf("build_tool_missing")
	}
	command := exec.CommandContext(toolContext, resolved, args...)
	command.Dir = dir
	command.Env = withToolPath(environment, filepath.Dir(resolved))
	stdout := &boundedBuffer{limit: MaxOutput}
	stderr := &boundedBuffer{limit: MaxOutput}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return "", fmt.Errorf("build_tool_failed")
	}
	if stdout.overflow || stderr.overflow {
		return "", fmt.Errorf("build_tool_output_oversized")
	}
	return string(stdout.data), nil
}

func withToolPath(environment []string, toolDirectory string) []string {
	result := make([]string, 0, len(environment)+1)
	for _, value := range environment {
		if strings.HasPrefix(value, "PATH=") {
			continue
		}
		result = append(result, value)
	}
	result = append(result, "PATH="+toolDirectory+":/usr/local/go/bin:/usr/bin:/bin")
	return result
}

func Build(ctx context.Context, config Config) (Result, error) {
	if err := validateConfig(config); err != nil {
		return Result{}, err
	}
	if config.Runner == nil {
		config.Runner = ToolRunner{}
	}
	if err := verifyPackageVersion(config.SourceRoot, config.Version); err != nil {
		return Result{}, err
	}
	if err := verifyTools(ctx, config); err != nil {
		return Result{}, err
	}
	work, err := os.MkdirTemp("", "atlas-manager-bundle-")
	if err != nil {
		return Result{}, fmt.Errorf("build_workspace_failed")
	}
	defer os.RemoveAll(work)
	buildHome := filepath.Join(work, "home")
	if err := os.MkdirAll(buildHome, 0o700); err != nil {
		return Result{}, fmt.Errorf("build_workspace_failed")
	}
	buildRoot := filepath.Join(work, "build")
	runtimeRoot := filepath.Join(work, "runtime")
	if err := copyBuildInputs(config.SourceRoot, buildRoot); err != nil {
		return Result{}, err
	}
	environment := controlledEnvironment(config.SourceDateEpoch, buildHome)
	if _, err := config.Runner.Run(ctx, "npm", []string{"ci", "--ignore-scripts"}, buildRoot, environment); err != nil {
		return Result{}, err
	}
	if _, err := config.Runner.Run(ctx, "node", []string{"node_modules/typescript/bin/tsc", "-p", "tsconfig.deployment.json"}, buildRoot, environment); err != nil {
		return Result{}, err
	}
	if err := copyFile(filepath.Join(config.SourceRoot, "src", "dashboard", "styles.css"), filepath.Join(buildRoot, "dist", "dashboard", "styles.css"), 0o644); err != nil {
		return Result{}, err
	}
	if err := copyFile(filepath.Join(buildRoot, "package.json"), filepath.Join(runtimeRoot, "package.json"), 0o644); err != nil {
		return Result{}, err
	}
	if err := copyFile(filepath.Join(buildRoot, "package-lock.json"), filepath.Join(runtimeRoot, "package-lock.json"), 0o644); err != nil {
		return Result{}, err
	}
	if _, err := config.Runner.Run(ctx, "npm", []string{"ci", "--omit=dev", "--ignore-scripts"}, runtimeRoot, environment); err != nil {
		return Result{}, err
	}
	if err := rejectDevelopmentDependencies(filepath.Join(runtimeRoot, "node_modules")); err != nil {
		return Result{}, err
	}

	bundleName := fmt.Sprintf("atlas-manager_%s_linux_amd64", config.Version)
	root := filepath.Join(config.OutputDir, bundleName)
	archive := filepath.Join(config.OutputDir, bundleName+".tar.gz")
	if _, err := os.Stat(root); err == nil {
		return Result{}, fmt.Errorf("output_exists")
	}
	if _, err := os.Stat(archive); err == nil {
		return Result{}, fmt.Errorf("output_exists")
	}
	if err := assemble(root, buildRoot, runtimeRoot, config); err != nil {
		return Result{}, err
	}
	if err := writeMetadata(root, config); err != nil {
		return Result{}, err
	}
	if config.DashboardAssetsRoot != "" {
		if err := copyDashboardAssets(root, config.DashboardAssetsRoot); err != nil {
			return Result{}, err
		}
	}
	paths, err := manifest.Files(filepath.Join(root, "application"))
	if err != nil {
		return Result{}, err
	}
	for index := range paths {
		paths[index] = filepath.ToSlash(filepath.Join("application", paths[index]))
	}
	metadataPaths := []string{"INSTALLATION.md", "LICENSE", "atlas-manager-installer", "atlas-manager-host-qualification", "atlas-manager-runtime-identity-installer", "atlas-manager-runtime-configuration", "atlas-manager-service-lifecycle", "atlas-manager.mock-admin.input.example.json", "dashboard/index.html", "dashboard/styles.css", "dashboard/app.js", "dashboard/backup.js", "dashboard/event-history.js", "config/atlas-manager.env.example", "systemd/atlas-manager.service", "contracts/atlas-manager-administrative-api.json"}
	if config.AdministrativeRuntimeConfigurationPath != "" {
		metadataPaths = append(metadataPaths, "atlas-manager-administrative-runtime-configuration")
	}
	if err := copyFile(filepath.Join(config.SourceRoot, "docs", "contracts", "atlas-manager-administrative-api.json"), filepath.Join(root, "contracts", "atlas-manager-administrative-api.json"), 0o644); err != nil {
		return Result{}, err
	}
	if err := canonicalizeTree(root); err != nil {
		return Result{}, err
	}
	paths = append(paths, metadataPaths...)
	files, err := manifest.Inventory(root, paths)
	if err != nil {
		return Result{}, err
	}
	sort.Slice(files, func(left, right int) bool { return files[left].Path < files[right].Path })
	value := manifest.Manifest{
		SchemaVersion: SchemaVersion(), Name: "atlas-manager", Version: config.Version,
		SourceCommit: config.SourceCommit, SourceDateEpoch: config.SourceDateEpoch,
		Target: manifest.Target{OS: "linux", Arch: "amd64"}, NodeVersion: config.NodeVersion,
		NPMVersion: config.NPMVersion, GoVersion: config.GoVersion,
		RuntimeNodePath: "/usr/bin/node", SystemdUnitPath: "/etc/systemd/system/atlas-manager.service", Files: files,
	}
	encoded, err := manifest.Encode(value)
	if err != nil {
		return Result{}, err
	}
	if err := os.WriteFile(filepath.Join(root, "MANIFEST.json"), append(encoded, '\n'), 0o644); err != nil {
		return Result{}, fmt.Errorf("manifest_write_failed")
	}
	if err := writeChecksums(root, value); err != nil {
		return Result{}, err
	}
	if err := archiveTree(ctx, root, archive, config.SourceDateEpoch); err != nil {
		return Result{}, err
	}
	return Result{Directory: root, Archive: archive, Manifest: value}, nil
}

func SchemaVersion() int { return manifest.SchemaVersion }

func validateConfig(config Config) error {
	if config.Version == "" || config.SourceRoot == "" || config.OutputDir == "" || !filepath.IsAbs(config.SourceRoot) || !filepath.IsAbs(config.OutputDir) || config.SourceDateEpoch < 0 || !safeVersion(config.Version) {
		return fmt.Errorf("build_input_invalid")
	}
	if config.NodeVersion != PinnedNode || config.NPMVersion != PinnedNPM || config.GoVersion != PinnedGo {
		return fmt.Errorf("tool_version_invalid")
	}
	if len(config.SourceCommit) != 40 || strings.ToLower(config.SourceCommit) != config.SourceCommit {
		return fmt.Errorf("source_commit_invalid")
	}
	for _, char := range config.SourceCommit {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return fmt.Errorf("source_commit_invalid")
		}
	}
	if config.NodeVersion == "" || config.NPMVersion == "" || config.GoVersion == "" {
		return fmt.Errorf("tool_version_missing")
	}
	if _, err := time.Unix(config.SourceDateEpoch, 0).MarshalText(); err != nil {
		return fmt.Errorf("source_epoch_invalid")
	}
	return nil
}

func copyDashboardAssets(bundleRoot, sourceRoot string) error {
	expected := []string{"app.js", "backup.js", "event-history.js", "index.html", "styles.css"}
	entries, err := os.ReadDir(sourceRoot)
	if err != nil || len(entries) != len(expected) {
		return fmt.Errorf("dashboard_assets_invalid")
	}
	expectedSet := make(map[string]struct{}, len(expected))
	for _, name := range expected {
		expectedSet[name] = struct{}{}
	}
	for _, entry := range entries {
		if _, ok := expectedSet[entry.Name()]; !ok || !entry.Type().IsRegular() {
			return fmt.Errorf("dashboard_assets_invalid")
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("dashboard_assets_invalid")
		}
		mode, modeErr := canonicalBundleMode(info)
		if modeErr != nil || mode != 0o644 || info.Size() > 256*1024 {
			return fmt.Errorf("dashboard_assets_invalid")
		}
		if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Nlink > 1 {
			return fmt.Errorf("dashboard_assets_invalid")
		}
	}
	for _, name := range expected {
		if err := copyFile(filepath.Join(sourceRoot, name), filepath.Join(bundleRoot, "dashboard", name), 0o644); err != nil {
			return fmt.Errorf("dashboard_assets_invalid")
		}
	}
	return nil
}

func safeVersion(value string) bool {
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._+-", char)) {
			return false
		}
	}
	return true
}

func verifyPackageVersion(root, expected string) error {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return fmt.Errorf("package_metadata_missing")
	}
	var value struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(data, &value) != nil || value.Version != expected {
		return fmt.Errorf("package_version_mismatch")
	}
	return nil
}

func verifyTools(ctx context.Context, config Config) error {
	checks := []struct{ command, flag, expected string }{
		{"node", "--version", "v" + config.NodeVersion},
		{"npm", "--version", config.NPMVersion},
		{"go", "version", "go" + config.GoVersion},
	}
	for _, check := range checks {
		output, err := config.Runner.Run(ctx, check.command, []string{check.flag}, config.SourceRoot, controlledEnvironment(config.SourceDateEpoch, os.TempDir()))
		if err != nil || !toolVersionMatches(check.command, output, check.expected) {
			return fmt.Errorf("tool_version_invalid")
		}
	}
	return nil
}

func toolVersionMatches(command, output, expected string) bool {
	value := strings.TrimSpace(output)
	if command == "go" {
		return strings.HasPrefix(value, "go version "+expected+" ") && strings.Contains(value, " linux/amd64")
	}
	return value == expected
}

func controlledEnvironment(epoch int64, home string) []string {
	return []string{"HOME=" + home, "LANG=C", "LC_ALL=C", "TZ=UTC", "SOURCE_DATE_EPOCH=" + strconv.FormatInt(epoch, 10), "NPM_CONFIG_CACHE=" + filepath.Join(home, ".npm-cache")}
}

func copyBuildInputs(source, destination string) error {
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return fmt.Errorf("build_workspace_failed")
	}
	for _, name := range []string{"package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.deployment.json"} {
		if err := copyFile(filepath.Join(source, name), filepath.Join(destination, name), 0o644); err != nil {
			return err
		}
	}
	return copyTree(filepath.Join(source, "src"), filepath.Join(destination, "src"))
}

func assemble(root, buildRoot, runtimeRoot string, config Config) error {
	if err := os.MkdirAll(filepath.Join(root, "application", "dist"), 0o755); err != nil {
		return fmt.Errorf("bundle_directory_failed")
	}
	if err := copyTree(filepath.Join(buildRoot, "dist"), filepath.Join(root, "application", "dist")); err != nil {
		return err
	}
	if err := copyTree(filepath.Join(runtimeRoot, "node_modules"), filepath.Join(root, "application", "node_modules")); err != nil {
		return err
	}
	if config.InstallerPath == "" {
		return fmt.Errorf("installer_missing")
	}
	if err := copyFile(config.InstallerPath, filepath.Join(root, "atlas-manager-installer"), 0o755); err != nil {
		return err
	}
	if config.QualificationPath == "" {
		return fmt.Errorf("qualification_missing")
	}
	if err := copyFile(config.QualificationPath, filepath.Join(root, "atlas-manager-host-qualification"), 0o755); err != nil {
		return err
	}
	if config.IdentityInstallerPath == "" {
		return fmt.Errorf("identity_installer_missing")
	}
	if err := copyFile(config.IdentityInstallerPath, filepath.Join(root, "atlas-manager-runtime-identity-installer"), 0o755); err != nil {
		return err
	}
	if config.RuntimeConfigurationPath == "" {
		return fmt.Errorf("runtime_configuration_missing")
	}
	if err := copyFile(config.RuntimeConfigurationPath, filepath.Join(root, "atlas-manager-runtime-configuration"), 0o755); err != nil {
		return err
	}
	if config.ServiceLifecyclePath == "" {
		return fmt.Errorf("service_lifecycle_missing")
	}
	if err := copyFile(config.ServiceLifecyclePath, filepath.Join(root, "atlas-manager-service-lifecycle"), 0o755); err != nil {
		return err
	}
	if config.AdministrativeRuntimeConfigurationPath != "" {
		if err := copyFile(config.AdministrativeRuntimeConfigurationPath, filepath.Join(root, "atlas-manager-administrative-runtime-configuration"), 0o755); err != nil {
			return err
		}
	}
	for _, name := range []string{"package.json", "package-lock.json"} {
		if err := copyFile(filepath.Join(runtimeRoot, name), filepath.Join(root, "application", name), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeMetadata(root string, config Config) error {
	if err := os.MkdirAll(filepath.Join(root, "systemd"), 0o755); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o755); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.MkdirAll(filepath.Join(root, "dashboard"), 0o755); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "dashboard", "index.html"), []byte("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Atlas Manager</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main><h1>Atlas Manager</h1><p id=\"status\" role=\"status\">Loading administrative state…</p><section><h2>Overview</h2><pre id=\"app\">Loading…</pre></section><section><h2>Services</h2><div id=\"services\"></div></section><section><h2>Availability</h2><pre id=\"availability\">Loading…</pre></section><section><h2>Backups</h2><div id=\"backups\"></div></section><section><h2>Audit</h2><pre id=\"audit\">Loading…</pre><div id=\"event-history\" aria-live=\"polite\"></div></section><section><h2>Power safety</h2><p>Backend is mock. Power effects and the machine scheduler are disabled. The Linux helper is unused. Wake and shutdown controls are unavailable.</p></section></main><script src=\"app.js\" defer></script><script src=\"backup.js\" defer></script><script src=\"event-history.js\" defer></script></body></html>\n"), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "dashboard", "styles.css"), []byte("body{font-family:system-ui,sans-serif;margin:0;background:#10141c;color:#f3f4f6}main{max-width:72rem;margin:auto;padding:1rem}section,article{background:#1b2330;padding:1rem;margin:1rem 0;border-radius:.5rem}pre{white-space:pre-wrap;overflow:auto}label{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}input,button{font:inherit;padding:.4rem;background:#10141c;color:inherit;border:1px solid #718096;border-radius:.25rem}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}.mutation{margin:.5rem 0}:focus-visible{outline:3px solid #75bfff;outline-offset:2px}@media (max-width:40rem){label{align-items:stretch;flex-direction:column}}\n"), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "dashboard", "app.js"), []byte("const root=document.querySelector('#app'),services=document.querySelector('#services'),audit=document.querySelector('#audit'),status=document.querySelector('#status');async function readJson(path){const response=await fetch(path,{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');return response.json()}function addText(parent,value){parent.append(document.createTextNode(typeof value==='string'?value:JSON.stringify(value)))}function renderServices(value){if(!services)return;services.replaceChildren();const list=value&&Array.isArray(value.services)?value.services:[];if(!list.length){addText(services,'No registered services.');return}for(const service of list){const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p');addText(heading,service.id);addText(summary,`${String(service.displayName)} — ${String(service.status)} — ${String(service.availability)}`);article.append(heading,summary);for(const operation of ['start','stop','restart']){const form=document.createElement('form');form.className='mutation';const label=document.createElement('label');addText(label,`${operation} confirmation`);const input=document.createElement('input');input.type='text';input.required=true;input.autocomplete='off';label.append(input);const button=document.createElement('button');button.type='submit';addText(button,operation);form.append(label,button);form.addEventListener('submit',event=>{event.preventDefault();button.disabled=true;void fetch(`/admin/services/${encodeURIComponent(String(service.id))}/actions/${operation}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:input.value}),redirect:'error'}).then(async response=>{input.value='';if(!response.ok)throw new Error('operation_failed');await refresh()}).catch(()=>{input.value='';if(status)status.textContent='Operation failed; authoritative state was not assumed.'}).finally(()=>{button.disabled=false})});article.append(form)}services.append(article)}}function renderAudit(value){if(audit){audit.textContent='';addText(audit,value)}}async function refresh(){const [overview,serviceList,history]=await Promise.all([readJson('/admin/overview'),readJson('/admin/services'),readJson('/admin/event-history?limit=20')]);if(root)root.textContent=JSON.stringify(overview,null,2);renderServices(serviceList);renderAudit(history)}void refresh().catch(()=>{if(status)status.textContent='Administrative overview unavailable.'});\n"), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "dashboard", "backup.js"), []byte(dashboardBackupJavaScript), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "dashboard", "event-history.js"), []byte(dashboardEventHistoryJavaScript), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "atlas-manager.mock-admin.input.example.json"), administrativeconfiguration.ExampleInputBytes(), 0o644); err != nil {
		return fmt.Errorf("bundle_metadata_failed")
	}
	if err := os.WriteFile(filepath.Join(root, "systemd", "atlas-manager.service"), []byte(systemdunit.Content), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "config", "atlas-manager.env.example"), envTemplate(config), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "LICENSE"), []byte(mitLicense), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, "INSTALLATION.md"), []byte(installationText), 0o644)
}

const dashboardBackupJavaScript = "const main=document.querySelector('main');let root=document.querySelector('#backups'),status=document.querySelector('#status');if(!root&&main){const section=document.createElement('section'),heading=document.createElement('h2');heading.append(document.createTextNode('Backups'));root=document.createElement('div');root.id='backups';section.append(heading,root);main.append(section)}async function load(){if(!root)return;root.replaceChildren();const response=await fetch('/admin/backups/targets',{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');const value=await response.json(),targets=Array.isArray(value.targets)?value.targets:[];if(!targets.length){root.append(document.createTextNode('No registered backup targets.'));return}for(const target of targets){const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p'),form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');heading.append(document.createTextNode(String(target.displayName||target.id)));summary.append(document.createTextNode(String(target.id)+' — '+String(target.kind)+' — '+String(target.scheduleMode)));label.append(document.createTextNode('Manual backup confirmation '));input.type='text';input.required=true;input.autocomplete='off';label.append(input);button.type='submit';button.append(document.createTextNode('Run backup'));form.append(label,button);form.addEventListener('submit',event=>{event.preventDefault();button.disabled=true;void fetch('/admin/backups/targets/'+encodeURIComponent(String(target.id))+'/runs',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:input.value}),redirect:'error'}).then(response=>{input.value='';if(!response.ok)throw new Error('operation_failed');return load()}).catch(()=>{input.value='';if(status)status.textContent='Backup state could not be reread.'}).finally(()=>{button.disabled=false})});article.append(heading,summary,form);root.append(article)}const note=document.createElement('p');note.append(document.createTextNode('Retention and scheduling remain project-owned. Restoration is not supported.'));root.append(note)}void load().catch(()=>{if(status)status.textContent='Backup administration unavailable.'});\n"

const dashboardEventHistoryJavaScript = "const root=document.querySelector('#event-history'),status=document.querySelector('#status');async function read(path){const response=await fetch(path,{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');return response.json()}function text(parent,value){parent.append(document.createTextNode(String(value)))}async function load(){if(!root)return;root.replaceChildren();const integrity=await read('/admin/event-history/integrity'),retention=await read('/admin/event-history/retention');const summary=document.createElement('p');text(summary,'Integrity: '+String(integrity.outcome)+'; retained through: '+String(integrity.latestSequence??'unavailable')+'; sealed segments: '+String(integrity.sealedSegmentCount??0));root.append(summary);const policy=document.createElement('p');text(policy,'Eligible segments: '+String(retention.eligibleSegmentCount));root.append(policy)}void load().catch(()=>{if(status)status.textContent='Event-history operations unavailable.'});\n"

const mitLicense = `MIT License

Copyright (c) Gustavo Pinto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

func envTemplate(config Config) []byte {
	return []byte("# Atlas Manager safe disabled deployment template\nHOST=127.0.0.1\nPORT=3000\nLOG_LEVEL=info\nPOWER_MANAGEMENT_BACKEND=mock\nMACHINE_POWER_EFFECTS_ACTIVATION=disabled\nMACHINE_POWER_SCHEDULER_ENABLED=false\nMACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}\nREGISTERED_SERVICES_JSON=[]\nADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=false\nADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\nADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\n# Runtime configuration is operator-owned and is not created by this installer.\n")
}

const installationText = `# Atlas Manager disabled installation

This bundle is installed by a local administrator through
atlas-manager-installer install-disabled. Installation does not create users
or groups, create the real environment file, enable or start systemd, install
the Linux power helper, or activate power effects.
`

func writeChecksums(root string, value manifest.Manifest) error {
	paths := make([]string, 0, len(value.Files)+1)
	for _, file := range value.Files {
		paths = append(paths, file.Path)
	}
	paths = append(paths, "MANIFEST.json")
	sort.Strings(paths)
	var builder strings.Builder
	for _, path := range paths {
		digest, err := manifest.SHA256File(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			return fmt.Errorf("checksum_failed")
		}
		fmt.Fprintf(&builder, "%s  %s\n", digest, path)
	}
	return os.WriteFile(filepath.Join(root, "SHA256SUMS"), []byte(builder.String()), 0o644)
}

func archiveTree(ctx context.Context, root, archive string, epoch int64) error {
	file, err := os.Create(archive)
	if err != nil {
		return fmt.Errorf("archive_create_failed")
	}
	defer file.Close()
	gzipWriter, err := gzip.NewWriterLevel(file, gzip.BestCompression)
	if err != nil {
		return err
	}
	gzipWriter.Header.ModTime = time.Unix(epoch, 0).UTC()
	gzipWriter.Header.OS = 3
	tarWriter := tar.NewWriter(gzipWriter)
	type archiveEntry struct {
		path string
		info os.FileInfo
	}
	var entries []archiveEntry
	if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(filepath.Dir(root), path)
		if err != nil {
			return err
		}
		entries = append(entries, archiveEntry{path: filepath.ToSlash(rel), info: info})
		return nil
	}); err != nil {
		return fmt.Errorf("archive_walk_failed")
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].path < entries[right].path })
	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		full := filepath.Join(filepath.Dir(root), filepath.FromSlash(entry.path))
		mode, err := canonicalBundleMode(entry.info)
		if err != nil {
			return err
		}
		header := &tar.Header{Name: entry.path, Mode: int64(mode), ModTime: time.Unix(epoch, 0).UTC(), Uid: 0, Gid: 0, Uname: "root", Gname: "root"}
		if entry.info.IsDir() {
			header.Name = strings.TrimSuffix(header.Name, "/") + "/"
			header.Mode = 0o755
			header.Typeflag = tar.TypeDir
		} else {
			data, err := os.ReadFile(full)
			if err != nil {
				return fmt.Errorf("archive_read_failed")
			}
			header.Size = int64(len(data))
			header.Typeflag = tar.TypeReg
			if err := tarWriter.WriteHeader(header); err != nil {
				return err
			}
			if _, err := tarWriter.Write(data); err != nil {
				return err
			}
			continue
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}
	return file.Sync()
}

func copyTree(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if info.IsDir() && info.Name() == ".bin" && strings.Contains(filepath.ToSlash(path), "/node_modules/") {
			return filepath.SkipDir
		}
		if strings.Contains(filepath.ToSlash(path), "/node_modules/") {
			if info.IsDir() && isDevelopmentDirectory(info.Name()) {
				return filepath.SkipDir
			}
			if !info.IsDir() && isDevelopmentFile(info.Name()) {
				return nil
			}
		}
		target := filepath.Join(destination, rel)
		if info.IsDir() {
			mode, modeErr := canonicalBundleMode(info)
			if modeErr != nil {
				return modeErr
			}
			return os.MkdirAll(target, mode)
		}
		mode, modeErr := canonicalBundleMode(info)
		if modeErr != nil {
			return modeErr
		}
		return copyFile(path, target, mode)
	})
}

func canonicalBundleMode(info os.FileInfo) (os.FileMode, error) {
	if info.Mode()&os.ModeSymlink != 0 {
		return 0, fmt.Errorf("bundle_file_type_invalid")
	}
	if info.IsDir() {
		return 0o755, nil
	}
	if info.Mode().IsRegular() {
		if info.Mode()&0o111 != 0 {
			return 0o755, nil
		}
		return 0o644, nil
	}
	return 0, fmt.Errorf("bundle_file_type_invalid")
}

func canonicalizeTree(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		mode, modeErr := canonicalBundleMode(info)
		if modeErr != nil {
			return modeErr
		}
		if err := os.Chmod(path, mode); err != nil {
			return fmt.Errorf("bundle_mode_normalization_failed")
		}
		return nil
	})
}

func isDevelopmentDirectory(name string) bool {
	return name == "test" || name == "tests" || name == "__tests__" || name == "coverage"
}

func isDevelopmentFile(name string) bool {
	return strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tsx") || strings.HasSuffix(name, ".map") || strings.HasSuffix(name, ".d.cts") || strings.HasSuffix(name, ".d.mts")
}

func copyFile(source, destination string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("source_file_missing")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("copy_directory_failed")
	}
	if err := os.WriteFile(destination, data, mode); err != nil {
		return fmt.Errorf("copy_file_failed")
	}
	return os.Chmod(destination, mode)
}

func rejectDevelopmentDependencies(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("runtime_dependencies_missing")
	}
	for _, entry := range entries {
		name := entry.Name()
		if name == "typescript" || name == "tsx" || name == "vitest" || name == "eslint" || name == "prettier" || name == "supertest" || strings.HasPrefix(name, "@types") {
			return fmt.Errorf("development_dependency_packaged")
		}
	}
	return nil
}

type boundedBuffer struct {
	data     []byte
	limit    int
	overflow bool
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	if len(buffer.data)+len(value) > buffer.limit {
		buffer.overflow = true
		return len(value), nil
	}
	buffer.data = append(buffer.data, value...)
	return len(value), nil
}
