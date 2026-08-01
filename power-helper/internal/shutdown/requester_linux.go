//go:build linux

package shutdown

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	LogindDestination = "org.freedesktop.login1"
	LogindObjectPath  = "/org/freedesktop/login1"
	LogindInterface   = "org.freedesktop.login1.Manager"
	LogindPowerOff    = LogindInterface + ".PowerOff"
	LogindInteractive = false
	DBusDeadline      = 3 * time.Second
)

var (
	ErrShutdownUnsupported         = errors.New("shutdown unsupported")
	ErrShutdownRejected            = errors.New("shutdown rejected")
	ErrShutdownFailed              = errors.New("shutdown failed")
	ErrShutdownAcceptanceUncertain = errors.New("shutdown acceptance uncertain")
)

type ShutdownRequester interface {
	RequestPowerOff(context.Context) error
}

type BusConnection interface {
	Authenticate() error
	Hello() error
	PowerOff(context.Context) error
	Close() error
}

type BusConnector interface {
	Connect(context.Context) (BusConnection, error)
}

type SystemdLogindRequester struct {
	inspector SystemBusSocketInspector
	connector BusConnector
}

func NewSystemdLogindRequester(inspector SystemBusSocketInspector, connector BusConnector) SystemdLogindRequester {
	return SystemdLogindRequester{inspector: inspector, connector: connector}
}

func (requester SystemdLogindRequester) RequestPowerOff(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requester.inspector.Inspect(); err != nil {
		if errors.Is(err, ErrSocketUnavailable) {
			return ErrShutdownUnsupported
		}
		return ErrShutdownFailed
	}

	connection, err := requester.connector.Connect(ctx)
	if err != nil {
		return ErrShutdownFailed
	}
	defer connection.Close()

	if err := connection.Authenticate(); err != nil {
		return ErrShutdownFailed
	}
	if err := connection.Hello(); err != nil {
		return ErrShutdownFailed
	}
	return translatePowerOffError(connection.PowerOff(ctx))
}

func translatePowerOffError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrShutdownUnsupported) || errors.Is(err, ErrShutdownRejected) || errors.Is(err, ErrShutdownFailed) || errors.Is(err, ErrShutdownAcceptanceUncertain) {
		return err
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrShutdownAcceptanceUncertain
	}
	return ErrShutdownFailed
}

type FixedBusConnector struct{}

func (FixedBusConnector) Connect(ctx context.Context) (BusConnection, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	dialer := net.Dialer{}
	connection, err := dialer.DialContext(ctx, "unix", SystemBusSocketPath)
	if err != nil {
		return nil, ErrShutdownFailed
	}
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		_ = connection.Close()
		return nil, ErrShutdownFailed
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := unixConnection.SetDeadline(deadline); err != nil {
			_ = unixConnection.Close()
			return nil, ErrShutdownFailed
		}
	}
	dbusConnection, err := dbus.DialUnix(unixConnection, dbus.WithAuth(dbus.AuthExternal("0")), dbus.WithContext(ctx))
	if err != nil {
		_ = unixConnection.Close()
		return nil, ErrShutdownFailed
	}
	return fixedBusConnection{connection: dbusConnection}, nil
}

type fixedBusConnection struct {
	connection *dbus.Conn
}

func (connection fixedBusConnection) Authenticate() error {
	return connection.connection.Auth([]dbus.Auth{dbus.AuthExternal("0")})
}

func (connection fixedBusConnection) Hello() error {
	return connection.connection.Hello()
}

func (connection fixedBusConnection) PowerOff(ctx context.Context) error {
	call := connection.connection.Object(LogindDestination, dbus.ObjectPath(LogindObjectPath)).CallWithContext(ctx, LogindPowerOff, 0, LogindInteractive)
	if call == nil {
		return ErrShutdownAcceptanceUncertain
	}
	if call.Err != nil {
		return classifyPowerOffError(call.Err)
	}
	if len(call.Body) != 0 {
		return ErrShutdownFailed
	}
	return nil
}

func (connection fixedBusConnection) Close() error {
	return connection.connection.Close()
}

func classifyPowerOffError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrShutdownAcceptanceUncertain
	}
	var dbusError dbus.Error
	if errors.As(err, &dbusError) {
		return classifyRemoteError(dbusError.Name)
	}
	var dbusErrorPointer *dbus.Error
	if errors.As(err, &dbusErrorPointer) && dbusErrorPointer != nil {
		return classifyRemoteError(dbusErrorPointer.Name)
	}
	return ErrShutdownAcceptanceUncertain
}

func classifyRemoteError(name string) error {
	switch name {
	case "org.freedesktop.DBus.Error.ServiceUnknown",
		"org.freedesktop.DBus.Error.NameHasNoOwner",
		"org.freedesktop.DBus.Error.UnknownObject",
		"org.freedesktop.DBus.Error.NoSuchObject",
		"org.freedesktop.DBus.Error.UnknownInterface",
		"org.freedesktop.DBus.Error.UnknownMethod":
		return ErrShutdownUnsupported
	case "org.freedesktop.DBus.Error.AccessDenied",
		"org.freedesktop.DBus.Error.PermissionDenied",
		"org.freedesktop.DBus.Error.InteractiveAuthorizationRequired",
		"org.freedesktop.login1.Error.Inhibited",
		"org.freedesktop.login1.Error.AlreadyInProgress":
		return ErrShutdownRejected
	default:
		return ErrShutdownFailed
	}
}

var _ ShutdownRequester = SystemdLogindRequester{}
var _ BusConnector = FixedBusConnector{}
