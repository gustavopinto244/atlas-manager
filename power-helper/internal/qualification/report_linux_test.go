//go:build linux

package qualification

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

type fakePlatform struct{}

func (fakePlatform) Kernel() (string, string, string, error) {
	return "Linux", "6.8.0-test", "x86_64", nil
}

type fakeClock struct{ value time.Time }

func (clock fakeClock) Now() time.Time { return clock.value }

type fakeFS struct {
	osRelease, group, boot, since, wake      []byte
	sysfsErr, sinceErr, wakeErr              error
	wakeMeta, lockMeta, busParent, busSocket Metadata
	parents                                  ParentStatus
}

func (fs fakeFS) ReadOSRelease() ([]byte, error)             { return fs.osRelease, nil }
func (fs fakeFS) ReadGroup() ([]byte, error)                 { return fs.group, nil }
func (fs fakeFS) ReadBootID() ([]byte, error)                { return fs.boot, nil }
func (fs fakeFS) CheckSysfs() error                          { return fs.sysfsErr }
func (fs fakeFS) ReadSinceEpoch() ([]byte, error)            { return fs.since, fs.sinceErr }
func (fs fakeFS) ReadWakeAlarm() ([]byte, error)             { return fs.wake, fs.wakeErr }
func (fs fakeFS) WakeAlarmMetadata() (Metadata, error)       { return fs.wakeMeta, nil }
func (fs fakeFS) RuntimeLockMetadata() (Metadata, error)     { return fs.lockMeta, nil }
func (fs fakeFS) BusMetadata() (Metadata, Metadata, error)   { return fs.busParent, fs.busSocket, nil }
func (fs fakeFS) InstallationParents() (ParentStatus, error) { return fs.parents, nil }

type fakeInstallation struct{ fresh, disabled, removed error }

func (installation fakeInstallation) Fresh() error    { return installation.fresh }
func (installation fakeInstallation) Disabled() error { return installation.disabled }
func (installation fakeInstallation) Removed() error  { return installation.removed }

type fakeLogind struct {
	result CanPowerOff
	err    error
}

func (logind fakeLogind) Inspect(_ context.Context) (CanPowerOff, error) {
	return logind.result, logind.err
}

func qualifiedFS() fakeFS {
	clock := time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC)
	return fakeFS{
		osRelease: []byte("ID=ubuntu\nVERSION_ID=24.04\n"),
		group:     []byte("root:x:0:\natlas-manager-power:x:1001:\n"),
		boot:      []byte("01234567-89ab-cdef-0123-456789abcdef\n"),
		since:     []byte([]byte(fmt.Sprintf("%d\n", clock.Unix()))),
		wake:      []byte("\n"),
		wakeMeta:  Metadata{Exists: true, Regular: true, UID: 0, Mode: 0644, Links: 1, OwnerWrite: true},
		busParent: Metadata{Exists: true, Directory: true, UID: 0, Mode: 0755, Links: 1},
		busSocket: Metadata{Exists: true, Socket: true, UID: 0, Links: 1},
		parents:   ParentStatus{UsrExists: true, UsrLocalExists: true, LibexecExists: false},
	}
}

func TestQualificationReportIsDeterministicAndReadOnly(t *testing.T) {
	fs := qualifiedFS()
	dependencies := Dependencies{Platform: fakePlatform{}, FileSystem: fs, Clock: fakeClock{value: time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC)}, Installation: fakeInstallation{}, Logind: fakeLogind{result: CanPowerOffYes}}
	first, err := New(dependencies).Run(ActionQualify)
	if err != nil {
		t.Fatal(err)
	}
	second, err := New(dependencies).Run(ActionQualify)
	if err != nil {
		t.Fatal(err)
	}
	firstBytes, err := first.MarshalCanonical()
	if err != nil {
		t.Fatal(err)
	}
	secondBytes, err := second.MarshalCanonical()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatal("qualification report is not deterministic")
	}
	if first.Outcome != OutcomeQualified {
		t.Fatalf("outcome = %q", first.Outcome)
	}
	if first.Host.BootIDHash == "" || len(first.Host.BootIDHash) != 64 {
		t.Fatal("boot identifier was not safely hashed")
	}
	if first.Limitations[0] != "firmware_wake_not_tested" {
		t.Fatal("limitations are not ordered")
	}
}

func TestOSReleaseRejectsDuplicateAndMalformedValues(t *testing.T) {
	for _, data := range [][]byte{[]byte("ID=ubuntu\nID=debian\nVERSION_ID=24.04\n"), []byte("ID=\"unterminated\nVERSION_ID=24.04\n"), []byte("ID=ubuntu\x00\nVERSION_ID=24.04\n")} {
		if _, ok := parseOSRelease(data); ok {
			t.Fatalf("accepted invalid os-release %q", data)
		}
	}
}

func TestGroupParserRequiresOneEmptyNonzeroGroup(t *testing.T) {
	if _, err := parseEmptyGroup([]byte("atlas-manager-power:x:1001:user\n")); !errors.Is(err, errGroupNotEmpty) {
		t.Fatalf("unexpected nonempty group error: %v", err)
	}
	if _, err := parseEmptyGroup([]byte("atlas-manager-power:x:0:\n")); err == nil {
		t.Fatal("accepted zero gid")
	}
	if _, err := parseEmptyGroup([]byte("atlas-manager-power:x:1001:\natlas-manager-power:x:1002:\n")); err == nil {
		t.Fatal("accepted duplicate group")
	}
}

func TestIntrospectionContract(t *testing.T) {
	document := `<node><interface name="org.freedesktop.login1.Manager"><method name="PowerOff"><arg type="b" direction="in"/></method><method name="CanPowerOff"><arg type="s" direction="out"/></method></interface></node>`
	if !validateIntrospection(document) {
		t.Fatal("valid logind contract rejected")
	}
	if validateIntrospection(`<node><interface name="org.freedesktop.login1.Manager"><method name="PowerOff"><arg type="s" direction="in"/></method></interface></node>`) {
		t.Fatal("invalid PowerOff signature accepted")
	}
}

func TestBlockedPowerCapabilityDoesNotClaimQualification(t *testing.T) {
	fs := qualifiedFS()
	dependencies := Dependencies{Platform: fakePlatform{}, FileSystem: fs, Clock: fakeClock{value: time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC)}, Installation: fakeInstallation{}, Logind: fakeLogind{result: CanPowerOffChallenge}}
	report, err := New(dependencies).Run(ActionQualify)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != OutcomeBlocked {
		t.Fatalf("outcome = %q", report.Outcome)
	}
}
