//go:build linux

package qualification

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/shutdown"
)

const (
	Purpose                  = "disabled_installation"
	MaxReportBytes           = 16 * 1024
	MaxOSReleaseBytes        = 16 * 1024
	MaxBootIDBytes           = 256
	MaxIntrospectionBytes    = 65536
	QualificationDBusTimeout = 2 * time.Second
	bootHashDomain           = "atlas-manager:host-qualification:boot-id:v1\x00"
)

const (
	ActionQualify        = "qualify"
	ActionVerifyDisabled = "verify-disabled-installation"
	ActionVerifyRemoved  = "verify-removed"
	OutcomeQualified     = "qualified_for_disabled_installation"
	OutcomeDisabledValid = "disabled_installation_valid"
	OutcomeRemovedValid  = "removed_state_valid"
	OutcomeBlocked       = "blocked"
	OutcomeUnsupported   = "unsupported"
	OutcomeIncomplete    = "incomplete"
	StatusPassed         = "passed"
	StatusBlocked        = "blocked"
	StatusUnsupported    = "unsupported"
	StatusNotTested      = "not_tested"
	StatusNotApplicable  = "not_applicable"
)

var (
	ErrQualificationUnavailable = errors.New("qualification unavailable")
	ErrQualificationUnsafe      = errors.New("qualification unsafe")
	ErrQualificationInvalid     = errors.New("qualification invalid")
	ErrQualificationBusy        = errors.New("qualification busy")
	ErrQualificationUnsupported = errors.New("qualification unsupported")
	bootIDPattern               = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	keyPattern                  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

type HostFacts struct {
	OSID          string `json:"osId"`
	OSVersionID   string `json:"osVersionId"`
	KernelRelease string `json:"kernelRelease"`
	Architecture  string `json:"architecture"`
	BootIDHash    string `json:"bootIdHash"`
}

type Check struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Code   string `json:"code,omitempty"`
}

type Report struct {
	SchemaVersion int       `json:"schemaVersion"`
	Purpose       string    `json:"purpose"`
	Action        string    `json:"action"`
	Outcome       string    `json:"outcome"`
	Host          HostFacts `json:"host"`
	Checks        []Check   `json:"checks"`
	Limitations   []string  `json:"limitations"`
}

func (report Report) MarshalCanonical() ([]byte, error) {
	encoded, err := json.Marshal(report)
	if err != nil || len(encoded)+1 > MaxReportBytes {
		return nil, ErrQualificationInvalid
	}
	return append(encoded, '\n'), nil
}

type Platform interface {
	Kernel() (name, release, machine string, err error)
}

type HostFileSystem interface {
	ReadOSRelease() ([]byte, error)
	ReadGroup() ([]byte, error)
	ReadBootID() ([]byte, error)
	CheckSysfs() error
	ReadSinceEpoch() ([]byte, error)
	ReadWakeAlarm() ([]byte, error)
	WakeAlarmMetadata() (Metadata, error)
	RuntimeLockMetadata() (Metadata, error)
	BusMetadata() (Metadata, Metadata, error)
	InstallationParents() (ParentStatus, error)
}

type Metadata struct {
	Exists     bool
	Regular    bool
	Socket     bool
	Directory  bool
	Symlink    bool
	UID        uint32
	Mode       os.FileMode
	Links      uint64
	OwnerWrite bool
}

type ParentStatus struct {
	UsrExists      bool
	UsrLocalExists bool
	LibexecExists  bool
}

type InstallationInspector interface {
	Fresh() error
	Disabled() error
	Removed() error
}

type LogindInspector interface {
	Inspect(context.Context) (CanPowerOff, error)
}

type CanPowerOff string

const (
	CanPowerOffYes       CanPowerOff = "yes"
	CanPowerOffNo        CanPowerOff = "no"
	CanPowerOffChallenge CanPowerOff = "challenge"
	CanPowerOffNA        CanPowerOff = "na"
)

type Dependencies struct {
	Platform     Platform
	FileSystem   HostFileSystem
	Clock        rtc.Clock
	Installation InstallationInspector
	Logind       LogindInspector
}

type Qualifier struct{ dependencies Dependencies }

func New(dependencies Dependencies) Qualifier { return Qualifier{dependencies: dependencies} }

func FixedActions() []string {
	return []string{ActionQualify, ActionVerifyDisabled, ActionVerifyRemoved}
}

func ValidAction(action string) bool {
	return action == ActionQualify || action == ActionVerifyDisabled || action == ActionVerifyRemoved
}

func (qualifier Qualifier) Run(action string) (Report, error) {
	if !ValidAction(action) {
		return Report{}, ErrQualificationInvalid
	}
	report := Report{SchemaVersion: 1, Purpose: Purpose, Action: action, Host: HostFacts{}, Checks: fixedChecks(), Limitations: fixedLimitations()}
	qualifier.collectFacts(&report.Host)
	if action == ActionQualify {
		qualifier.inspectHost(&report)
	} else {
		qualifier.inspectGroupAndParents(&report)
	}

	switch action {
	case ActionQualify:
		qualifier.inspectFreshInstallation(&report)
	case ActionVerifyDisabled:
		qualifier.inspectDisabledInstallation(&report)
	case ActionVerifyRemoved:
		qualifier.inspectRemovedInstallation(&report)
	}
	report.Outcome = deriveOutcome(action, report.Checks)
	return report, nil
}

func fixedLimitations() []string {
	return []string{"firmware_wake_not_tested", "real_shutdown_not_tested", "application_user_not_enrolled", "application_not_activated"}
}

func fixedChecks() []Check {
	ids := []string{"linux_amd64", "os_release", "boot_id", "sysfs", "rtc0", "rtc_alignment", "wake_alarm", "runtime_lock", "system_bus", "logind", "helper_group", "installation_parents", "installation_state"}
	checks := make([]Check, len(ids))
	for index, id := range ids {
		checks[index] = Check{ID: id, Status: StatusNotTested}
	}
	return checks
}

func (qualifier Qualifier) collectFacts(host *HostFacts) {
	if data, err := qualifier.dependencies.FileSystem.ReadOSRelease(); err == nil {
		if values, ok := parseOSRelease(data); ok {
			host.OSID, host.OSVersionID = values["ID"], values["VERSION_ID"]
		}
	}
	if name, release, machine, err := qualifier.dependencies.Platform.Kernel(); err == nil {
		if name == "Linux" && safeKernelRelease(release) {
			host.KernelRelease = release
		}
		if machine == "x86_64" || machine == "amd64" {
			host.Architecture = "amd64"
		}
	}
	if data, err := qualifier.dependencies.FileSystem.ReadBootID(); err == nil {
		value := strings.TrimSuffix(string(data), "\n")
		if bootIDPattern.MatchString(value) {
			digest := sha256.Sum256(append([]byte(bootHashDomain), []byte(strings.ToLower(value))...))
			host.BootIDHash = hex.EncodeToString(digest[:])
		}
	}
}

func (qualifier Qualifier) inspectHost(report *Report) {
	linuxCheck := check(report, "linux_amd64")
	name, release, machine, err := qualifier.dependencies.Platform.Kernel()
	if err != nil || name != "Linux" || !safeKernelRelease(release) {
		linuxCheck.Status, linuxCheck.Code = StatusBlocked, "not_linux"
	} else if machine != "x86_64" && machine != "amd64" {
		linuxCheck.Status, linuxCheck.Code = StatusBlocked, "unsupported_architecture"
	} else {
		linuxCheck.Status = StatusPassed
	}

	osCheck := check(report, "os_release")
	data, err := qualifier.dependencies.FileSystem.ReadOSRelease()
	if err != nil {
		osCheck.Status, osCheck.Code = StatusBlocked, "os_release_unavailable"
	} else if values, ok := parseOSRelease(data); !ok || values["ID"] == "" || values["VERSION_ID"] == "" {
		osCheck.Status, osCheck.Code = StatusBlocked, "os_release_unavailable"
	} else {
		osCheck.Status = StatusPassed
	}

	bootCheck := check(report, "boot_id")
	if report.Host.BootIDHash == "" {
		bootCheck.Status, bootCheck.Code = StatusBlocked, "boot_id_unavailable"
	} else {
		bootCheck.Status = StatusPassed
	}

	sysfsCheck := check(report, "sysfs")
	if err := qualifier.dependencies.FileSystem.CheckSysfs(); err != nil {
		sysfsCheck.Status, sysfsCheck.Code = StatusBlocked, "sysfs_unavailable"
	} else {
		sysfsCheck.Status = StatusPassed
	}

	rtcCheck := check(report, "rtc0")
	alignmentCheck := check(report, "rtc_alignment")
	wakeCheck := check(report, "wake_alarm")
	if sysfsCheck.Status != StatusPassed {
		rtcCheck.Status, rtcCheck.Code = StatusBlocked, "rtc0_unavailable"
		alignmentCheck.Status = StatusNotApplicable
		wakeCheck.Status = StatusNotApplicable
	} else {
		reader := rtc.NewReader(qualificationFileSystem{qualifier.dependencies.FileSystem}, qualifier.dependencies.Clock)
		information, readErr := reader.ReadRTCInformation()
		if readErr != nil {
			if errors.Is(readErr, rtc.ErrUnsupported) {
				rtcCheck.Status, rtcCheck.Code = StatusBlocked, "rtc0_unavailable"
			} else {
				rtcCheck.Status, rtcCheck.Code = StatusBlocked, "rtc_state_unavailable"
			}
			alignmentCheck.Status, alignmentCheck.Code = StatusBlocked, "rtc_clock_misaligned"
			wakeCheck.Status, wakeCheck.Code = StatusBlocked, "wake_alarm_unavailable"
		} else {
			rtcCheck.Status, alignmentCheck.Status = StatusPassed, StatusPassed
			wakeMeta, metaErr := qualifier.dependencies.FileSystem.WakeAlarmMetadata()
			if metaErr != nil || !wakeMeta.Exists || wakeMeta.Symlink || !wakeMeta.Regular || wakeMeta.UID != 0 || !wakeMeta.OwnerWrite {
				wakeCheck.Status, wakeCheck.Code = StatusBlocked, "wake_alarm_unavailable"
			} else {
				wakeCheck.Status = StatusPassed
			}
			_ = information
		}
	}

	lockCheck := check(report, "runtime_lock")
	lockMeta, lockErr := qualifier.dependencies.FileSystem.RuntimeLockMetadata()
	if lockErr != nil {
		lockCheck.Status, lockCheck.Code = StatusBlocked, "runtime_lock_invalid"
	} else if !lockMeta.Exists {
		lockCheck.Status, lockCheck.Code = StatusPassed, "not_created"
	} else if lockMeta.Symlink || !lockMeta.Regular || lockMeta.UID != 0 || lockMeta.Mode.Perm() != 0600 || lockMeta.Links != 1 {
		lockCheck.Status, lockCheck.Code = StatusBlocked, "runtime_lock_invalid"
	} else {
		lockCheck.Status = StatusPassed
	}

	busCheck := check(report, "system_bus")
	parent, socket, busErr := qualifier.dependencies.FileSystem.BusMetadata()
	if busErr != nil || !parent.Exists || parent.Symlink || !parent.Directory || parent.UID != 0 || parent.Mode.Perm()&0022 != 0 || !socket.Exists || socket.Symlink || !socket.Socket || socket.UID != 0 {
		busCheck.Status, busCheck.Code = StatusBlocked, "system_bus_unsafe"
	} else {
		busCheck.Status = StatusPassed
	}

	logindCheck := check(report, "logind")
	if busCheck.Status != StatusPassed {
		logindCheck.Status = StatusNotApplicable
	} else if qualifier.dependencies.Logind == nil {
		logindCheck.Status, logindCheck.Code = StatusUnsupported, "logind_unavailable"
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), QualificationDBusTimeout)
		result, logindErr := qualifier.dependencies.Logind.Inspect(ctx)
		cancel()
		if logindErr != nil {
			if errors.Is(logindErr, ErrQualificationUnsupported) {
				logindCheck.Status, logindCheck.Code = StatusUnsupported, "logind_unavailable"
			} else if errors.Is(logindErr, ErrQualificationInvalid) {
				logindCheck.Status, logindCheck.Code = StatusBlocked, "logind_contract_invalid"
			} else {
				logindCheck.Status, logindCheck.Code = StatusBlocked, "logind_unavailable"
			}
		} else {
			switch result {
			case CanPowerOffYes:
				logindCheck.Status = StatusPassed
			case CanPowerOffNA:
				logindCheck.Status, logindCheck.Code = StatusUnsupported, "poweroff_not_authorized"
			case CanPowerOffNo, CanPowerOffChallenge:
				logindCheck.Status, logindCheck.Code = StatusBlocked, "poweroff_not_authorized"
			default:
				logindCheck.Status, logindCheck.Code = StatusBlocked, "logind_contract_invalid"
			}
		}
	}

	qualifier.inspectGroupAndParents(report)
}

func (qualifier Qualifier) inspectGroupAndParents(report *Report) {
	groupCheck := check(report, "helper_group")
	group, groupErr := parseEmptyGroup(dataOrEmpty(qualifier.dependencies.FileSystem.ReadGroup()))
	if groupErr != nil {
		groupCheck.Status, groupCheck.Code = StatusBlocked, groupCode(groupErr)
	} else if group != "" {
		groupCheck.Status = StatusPassed
	} else {
		groupCheck.Status, groupCheck.Code = StatusBlocked, "group_prerequisite_missing"
	}

	parentCheck := check(report, "installation_parents")
	parents, parentErr := qualifier.dependencies.FileSystem.InstallationParents()
	if parentErr != nil {
		parentCheck.Status, parentCheck.Code = StatusBlocked, "installation_parent_unsafe"
	} else if !parents.UsrExists || !parents.UsrLocalExists {
		parentCheck.Status, parentCheck.Code = StatusBlocked, "installation_parent_unsafe"
	} else if !parents.LibexecExists {
		parentCheck.Status, parentCheck.Code = StatusPassed, "creatable_by_installer"
	} else {
		parentCheck.Status = StatusPassed
	}
}

func safeKernelRelease(value string) bool {
	if value == "" || len(value) > 256 {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func (qualifier Qualifier) inspectFreshInstallation(report *Report) {
	installationCheck := check(report, "installation_state")
	if qualifier.dependencies.Installation == nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "installation_invalid"
		return
	}
	if err := qualifier.dependencies.Installation.Fresh(); err != nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "existing_installation_requires_verification"
	} else {
		installationCheck.Status = StatusPassed
	}
}

func (qualifier Qualifier) inspectDisabledInstallation(report *Report) {
	installationCheck := check(report, "installation_state")
	if qualifier.dependencies.Installation == nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "installation_invalid"
		return
	}
	if err := qualifier.dependencies.Installation.Disabled(); err != nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "installation_invalid"
	} else {
		installationCheck.Status = StatusPassed
	}
}

func (qualifier Qualifier) inspectRemovedInstallation(report *Report) {
	installationCheck := check(report, "installation_state")
	if qualifier.dependencies.Installation == nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "installation_state_recheck_required"
		return
	}
	if err := qualifier.dependencies.Installation.Removed(); err != nil {
		installationCheck.Status, installationCheck.Code = StatusBlocked, "installation_state_recheck_required"
	} else {
		installationCheck.Status = StatusPassed
	}
}

func deriveOutcome(action string, checks []Check) string {
	for _, item := range checks {
		if item.Status == StatusBlocked {
			return OutcomeBlocked
		}
	}
	for _, item := range checks {
		if item.Status == StatusUnsupported {
			return OutcomeUnsupported
		}
	}
	switch action {
	case ActionQualify:
		return OutcomeQualified
	case ActionVerifyDisabled:
		return OutcomeDisabledValid
	case ActionVerifyRemoved:
		return OutcomeRemovedValid
	default:
		return OutcomeIncomplete
	}
}

func check(report *Report, id string) *Check {
	for index := range report.Checks {
		if report.Checks[index].ID == id {
			return &report.Checks[index]
		}
	}
	return &report.Checks[0]
}

func dataOrEmpty(data []byte, err error) []byte {
	if err != nil {
		return nil
	}
	return data
}

func groupCode(err error) string {
	if errors.Is(err, errGroupMissing) {
		return "group_prerequisite_missing"
	}
	if errors.Is(err, errGroupNotEmpty) {
		return "group_not_empty"
	}
	return "group_prerequisite_missing"
}

var errGroupMissing = errors.New("group missing")
var errGroupNotEmpty = errors.New("group not empty")

func parseEmptyGroup(data []byte) (string, error) {
	if len(data) == 0 || len(data) > 65536 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return "", errGroupMissing
	}
	seen := false
	names := map[string]struct{}{}
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		if len(line) > 1024 || strings.ContainsRune(line, '\r') {
			return "", errGroupMissing
		}
		fields := strings.Split(line, ":")
		if len(fields) != 4 || fields[0] == "" || (fields[1] != "x" && fields[1] != "!" && fields[1] != "*") {
			return "", errGroupMissing
		}
		if _, exists := names[fields[0]]; exists {
			return "", errGroupMissing
		}
		names[fields[0]] = struct{}{}
		if fields[0] != "atlas-manager-power" {
			if fields[2] == "" || (len(fields[2]) > 1 && fields[2][0] == '0') {
				return "", errGroupMissing
			}
			if _, err := strconv.ParseUint(fields[2], 10, 32); err != nil {
				return "", errGroupMissing
			}
			if fields[3] != "" {
				for _, member := range strings.Split(fields[3], ",") {
					if member == "" || strings.ContainsAny(member, " \t") {
						return "", errGroupMissing
					}
				}
			}
			continue
		}
		if seen {
			return "", errGroupMissing
		}
		seen = true
		if fields[3] != "" {
			return "", errGroupNotEmpty
		}
		if fields[2] == "" || (len(fields[2]) > 1 && fields[2][0] == '0') || fields[2] == "0" {
			return "", errGroupMissing
		}
		if _, err := strconv.ParseUint(fields[2], 10, 32); err != nil {
			return "", errGroupMissing
		}
	}
	if !seen {
		return "", errGroupMissing
	}
	return "atlas-manager-power", nil
}

func parseOSRelease(data []byte) (map[string]string, bool) {
	if len(data) == 0 || len(data) > MaxOSReleaseBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return nil, false
	}
	result := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		if strings.ContainsRune(line, '\r') {
			return nil, false
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 || !keyPattern.MatchString(parts[0]) {
			return nil, false
		}
		if _, exists := result[parts[0]]; exists {
			return nil, false
		}
		value, ok := parseOSValue(parts[1])
		if !ok {
			return nil, false
		}
		result[parts[0]] = value
	}
	return result, true
}

func parseOSValue(value string) (string, bool) {
	if value == "" {
		return "", true
	}
	if value[0] == '"' {
		if len(value) < 2 || value[len(value)-1] != '"' {
			return "", false
		}
		var builder strings.Builder
		for index := 1; index < len(value)-1; index++ {
			character := value[index]
			if character == '\\' {
				index++
				if index >= len(value)-1 || (value[index] != '\\' && value[index] != '"' && value[index] != 'n') {
					return "", false
				}
				if value[index] == 'n' {
					builder.WriteByte('\n')
				} else {
					builder.WriteByte(value[index])
				}
			} else if character < 0x20 {
				return "", false
			} else {
				builder.WriteByte(character)
			}
		}
		return builder.String(), true
	}
	if strings.ContainsAny(value, " \t\r\n\\\"") {
		return "", false
	}
	return value, true
}

type qualificationFileSystem struct{ source HostFileSystem }

func (fs qualificationFileSystem) CheckSysfs() error               { return fs.source.CheckSysfs() }
func (fs qualificationFileSystem) ReadSinceEpoch() ([]byte, error) { return fs.source.ReadSinceEpoch() }
func (fs qualificationFileSystem) ReadWakeAlarm() ([]byte, error)  { return fs.source.ReadWakeAlarm() }
func (fs qualificationFileSystem) WriteWakeAlarm([]byte) error     { return rtc.ErrOperationFailed }

type LinuxPlatform struct{}

func (LinuxPlatform) Kernel() (string, string, string, error) {
	var value syscall.Utsname
	if err := syscall.Uname(&value); err != nil {
		return "", "", "", err
	}
	read := func(bytes []int8) string {
		result := make([]byte, 0, len(bytes))
		for _, item := range bytes {
			if item == 0 {
				break
			}
			result = append(result, byte(item))
		}
		return string(result)
	}
	return read(value.Sysname[:]), read(value.Release[:]), read(value.Machine[:]), nil
}

type LinuxFileSystem struct{}

func (LinuxFileSystem) ReadOSRelease() ([]byte, error) {
	return readFixed("/etc/os-release", MaxOSReleaseBytes)
}
func (LinuxFileSystem) ReadGroup() ([]byte, error) { return readFixed("/etc/group", 65536) }
func (LinuxFileSystem) ReadBootID() ([]byte, error) {
	return readFixed("/proc/sys/kernel/random/boot_id", MaxBootIDBytes)
}
func (LinuxFileSystem) CheckSysfs() error { return (rtc.LinuxFileSystem{}).CheckSysfs() }
func (LinuxFileSystem) ReadSinceEpoch() ([]byte, error) {
	return (rtc.LinuxFileSystem{}).ReadSinceEpoch()
}
func (LinuxFileSystem) ReadWakeAlarm() ([]byte, error) {
	return (rtc.LinuxFileSystem{}).ReadWakeAlarm()
}
func (LinuxFileSystem) WakeAlarmMetadata() (Metadata, error) { return metadata(rtc.RTC_WAKE_ALARM) }
func (LinuxFileSystem) RuntimeLockMetadata() (Metadata, error) {
	return metadata("/run/atlas-manager-power-helper.lock")
}
func (LinuxFileSystem) BusMetadata() (Metadata, Metadata, error) {
	parent, parentErr := metadata("/run/dbus")
	socket, socketErr := metadata(shutdown.SystemBusSocketPath)
	if parentErr != nil && !errors.Is(parentErr, os.ErrNotExist) {
		return parent, socket, parentErr
	}
	if socketErr != nil && !errors.Is(socketErr, os.ErrNotExist) {
		return parent, socket, socketErr
	}
	return parent, socket, nil
}
func (LinuxFileSystem) InstallationParents() (ParentStatus, error) {
	result := ParentStatus{}
	for path, target := range map[string]*bool{"/usr": &result.UsrExists, "/usr/local": &result.UsrLocalExists, "/usr/local/libexec": &result.LibexecExists} {
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || info.Mode().Perm()&0022 != 0 || !hasRoot(info) {
			return result, ErrQualificationUnsafe
		}
		*target = true
	}
	return result, nil
}

func readFixed(path string, max int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(max)+1))
	if err != nil || len(data) > max {
		return nil, ErrQualificationUnavailable
	}
	return data, nil
}
func metadata(path string) (Metadata, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Metadata{}, nil
		}
		return Metadata{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return Metadata{}, ErrQualificationUnsafe
	}
	return Metadata{Exists: true, Regular: info.Mode().IsRegular(), Socket: info.Mode()&os.ModeSocket != 0, Directory: info.IsDir(), Symlink: info.Mode()&os.ModeSymlink != 0, UID: uint32(stat.Uid), Mode: info.Mode(), Links: uint64(stat.Nlink), OwnerWrite: info.Mode().Perm()&0200 != 0}, nil
}
func hasRoot(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && uint32(stat.Uid) == 0
}

// The following XML types deliberately model only the D-Bus introspection
// vocabulary required by the qualification policy.
type introspectionNode struct {
	Interfaces []introspectionInterface `xml:"interface"`
}
type introspectionInterface struct {
	Name    string                `xml:"name,attr"`
	Methods []introspectionMethod `xml:"method"`
}
type introspectionMethod struct {
	Name string             `xml:"name,attr"`
	Args []introspectionArg `xml:"arg"`
}
type introspectionArg struct {
	Type      string `xml:"type,attr"`
	Direction string `xml:"direction,attr"`
}

func validateIntrospection(document string) bool {
	if len(document) == 0 || len(document) > MaxIntrospectionBytes || !utf8.ValidString(document) {
		return false
	}
	decoder := xml.NewDecoder(strings.NewReader(document))
	decoder.Strict = true
	var node introspectionNode
	if decoder.Decode(&node) != nil {
		return false
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return false
	}
	var power, can bool
	for _, item := range node.Interfaces {
		if item.Name != shutdown.LogindInterface {
			continue
		}
		for _, method := range item.Methods {
			if method.Name == "PowerOff" {
				if len(method.Args) != 1 || method.Args[0].Type != "b" || method.Args[0].Direction != "in" {
					return false
				}
				power = true
			}
			if method.Name == "CanPowerOff" {
				if len(method.Args) != 1 || method.Args[0].Type != "s" || method.Args[0].Direction != "out" {
					return false
				}
				can = true
			}
		}
	}
	return power && can
}

func validateIntrospectionBytes(document []byte) bool { return validateIntrospection(string(document)) }
