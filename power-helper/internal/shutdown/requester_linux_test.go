//go:build linux

package shutdown

import (
	"context"
	"errors"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

type fakeInspector struct {
	err   error
	calls int
}

func (inspector *fakeInspector) Inspect() error {
	inspector.calls++
	return inspector.err
}

type fakeConnection struct {
	authCalls     int
	helloCalls    int
	powerOffCalls int
	closeCalls    int
	authErr       error
	helloErr      error
	powerOffErr   error
	deadlineSeen  bool
}

func (connection *fakeConnection) Authenticate() error {
	connection.authCalls++
	return connection.authErr
}

func (connection *fakeConnection) Hello() error {
	connection.helloCalls++
	return connection.helloErr
}

func (connection *fakeConnection) PowerOff(ctx context.Context) error {
	connection.powerOffCalls++
	_, connection.deadlineSeen = ctx.Deadline()
	return connection.powerOffErr
}

func (connection *fakeConnection) Close() error {
	connection.closeCalls++
	return nil
}

type fakeConnector struct {
	connection *fakeConnection
	calls      int
	context    context.Context
	err        error
}

func (connector *fakeConnector) Connect(ctx context.Context) (BusConnection, error) {
	connector.calls++
	connector.context = ctx
	if connector.err != nil {
		return nil, connector.err
	}
	return connector.connection, nil
}

type fileInfoFixture struct {
	name string
	mode os.FileMode
	uid  uint32
}

func (info fileInfoFixture) Name() string       { return info.name }
func (info fileInfoFixture) Size() int64        { return 0 }
func (info fileInfoFixture) Mode() os.FileMode  { return info.mode }
func (info fileInfoFixture) ModTime() time.Time { return time.Time{} }
func (info fileInfoFixture) IsDir() bool        { return info.mode.IsDir() }
func (info fileInfoFixture) Sys() any           { return &syscall.Stat_t{Uid: info.uid} }

func TestFixedSystemBusResources(t *testing.T) {
	if SystemBusSocketPath != "/run/dbus/system_bus_socket" || SystemBusAddress != "unix:path=/run/dbus/system_bus_socket" || SystemBusDirectory != "/run/dbus" {
		t.Fatal("system bus resource contract changed")
	}
	if LogindDestination != "org.freedesktop.login1" || LogindObjectPath != "/org/freedesktop/login1" || LogindInterface != "org.freedesktop.login1.Manager" || LogindPowerOff != "org.freedesktop.login1.Manager.PowerOff" || LogindInteractive {
		t.Fatal("logind resource contract changed")
	}
	if DBusDeadline != 3*time.Second {
		t.Fatal("D-Bus deadline changed")
	}
}

func TestSocketValidationRules(t *testing.T) {
	if !validBusDirectory(fileInfoFixture{mode: os.ModeDir | 0755, uid: 0}) {
		t.Fatal("valid bus directory rejected")
	}
	if validBusDirectory(fileInfoFixture{mode: os.ModeDir | 0775, uid: 0}) || validBusDirectory(fileInfoFixture{mode: os.ModeDir | 0755, uid: 1000}) || validBusDirectory(fileInfoFixture{mode: os.ModeSymlink | 0755, uid: 0}) {
		t.Fatal("unsafe bus directory accepted")
	}
	if !validBusSocket(fileInfoFixture{mode: os.ModeSocket | 0666, uid: 0}) {
		t.Fatal("valid bus socket rejected")
	}
	if validBusSocket(fileInfoFixture{mode: 0600, uid: 0}) || validBusSocket(fileInfoFixture{mode: os.ModeSocket | 0666, uid: 1000}) || validBusSocket(fileInfoFixture{mode: os.ModeSymlink | 0777, uid: 0}) {
		t.Fatal("unsafe bus socket accepted")
	}
}

func TestRequesterUsesOnePrivateConnectionAndOnePowerOffCall(t *testing.T) {
	inspector := &fakeInspector{}
	connection := &fakeConnection{}
	connector := &fakeConnector{connection: connection}
	requester := NewSystemdLogindRequester(inspector, connector)
	ctx, cancel := context.WithTimeout(context.Background(), DBusDeadline)
	defer cancel()

	if err := requester.RequestPowerOff(ctx); err != nil {
		t.Fatal(err)
	}
	if inspector.calls != 1 || connector.calls != 1 || connection.authCalls != 1 || connection.helloCalls != 1 || connection.powerOffCalls != 1 || connection.closeCalls != 1 || !connection.deadlineSeen {
		t.Fatalf("unexpected D-Bus lifecycle: inspector=%d connector=%d connection=%#v", inspector.calls, connector.calls, connection)
	}
}

func TestBusEnvironmentCannotChangeFixedRequesterBoundary(t *testing.T) {
	t.Setenv("DBUS_SYSTEM_BUS_ADDRESS", "tcp:host=attacker.example,port=1234")
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/tmp/attacker.sock")
	connector := &fakeConnector{connection: &fakeConnection{}}
	requester := NewSystemdLogindRequester(&fakeInspector{}, connector)
	if err := requester.RequestPowerOff(context.Background()); err != nil {
		t.Fatal(err)
	}
	if connector.calls != 1 || connector.connection.powerOffCalls != 1 {
		t.Fatal("hostile D-Bus environment changed the fixed requester flow")
	}
	if SystemBusAddress != "unix:path=/run/dbus/system_bus_socket" {
		t.Fatal("fixed system bus address changed")
	}
}

func TestRequesterDoesNotConnectWhenSocketIsUnavailableOrUnsafe(t *testing.T) {
	for _, testCase := range []struct {
		name string
		err  error
		want error
	}{
		{name: "absent", err: ErrSocketUnavailable, want: ErrShutdownUnsupported},
		{name: "unsafe", err: ErrSocketUnsafe, want: ErrShutdownFailed},
		{name: "inspection", err: ErrSocketInspection, want: ErrShutdownFailed},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			connector := &fakeConnector{connection: &fakeConnection{}}
			requester := NewSystemdLogindRequester(&fakeInspector{err: testCase.err}, connector)
			if err := requester.RequestPowerOff(context.Background()); !errors.Is(err, testCase.want) || connector.calls != 0 {
				t.Fatalf("unexpected socket mapping: %v, calls=%d", err, connector.calls)
			}
		})
	}
}

func TestRequesterMapsConnectionAndAuthenticationFailuresSafely(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		connection *fakeConnection
		connector  *fakeConnector
	}{
		{name: "connect", connection: &fakeConnection{}, connector: &fakeConnector{err: errors.New("raw connection details")}},
		{name: "authentication", connection: &fakeConnection{authErr: errors.New("raw authentication details")}, connector: &fakeConnector{}},
		{name: "hello", connection: &fakeConnection{helloErr: errors.New("raw hello details")}, connector: &fakeConnector{}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			testCase.connector.connection = testCase.connection
			requester := NewSystemdLogindRequester(&fakeInspector{}, testCase.connector)
			if err := requester.RequestPowerOff(context.Background()); !errors.Is(err, ErrShutdownFailed) {
				t.Fatalf("failure was not mapped safely: %v", err)
			}
			if testCase.connection.closeCalls > 1 {
				t.Fatal("connection was closed more than once")
			}
		})
	}
}

func TestRequesterMapsRemoteErrors(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		nameValue string
		want      error
	}{
		{name: "unsupported", nameValue: "org.freedesktop.DBus.Error.UnknownMethod", want: ErrShutdownUnsupported},
		{name: "rejected", nameValue: "org.freedesktop.DBus.Error.AccessDenied", want: ErrShutdownRejected},
		{name: "unknown", nameValue: "org.freedesktop.DBus.Error.Failed", want: ErrShutdownFailed},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := classifyPowerOffError(dbus.Error{Name: testCase.nameValue}); !errors.Is(got, testCase.want) {
				t.Fatalf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestRequesterMapsCallTimeoutAsUncertain(t *testing.T) {
	connection := &fakeConnection{powerOffErr: context.DeadlineExceeded}
	requester := NewSystemdLogindRequester(&fakeInspector{}, &fakeConnector{connection: connection})
	if err := requester.RequestPowerOff(context.Background()); !errors.Is(err, ErrShutdownAcceptanceUncertain) {
		t.Fatalf("timeout was not treated as uncertain: %v", err)
	}
}
