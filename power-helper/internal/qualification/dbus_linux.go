//go:build linux

package qualification

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/shutdown"
	"github.com/godbus/dbus/v5"
)

// FixedLogindInspector performs only the three read-only checks approved by
// ADR-010. It does not expose a configurable bus address or D-Bus object.
type FixedLogindInspector struct {
	socketInspector shutdown.SystemBusSocketInspector
}

func NewFixedLogindInspector() FixedLogindInspector {
	return FixedLogindInspector{socketInspector: shutdown.LinuxSystemBusSocketInspector{}}
}

func (inspector FixedLogindInspector) Inspect(ctx context.Context) (CanPowerOff, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := inspector.socketInspector.Inspect(); err != nil {
		return "", ErrQualificationUnavailable
	}
	dialer := net.Dialer{}
	connection, err := dialer.DialContext(ctx, "unix", shutdown.SystemBusSocketPath)
	if err != nil {
		return "", ErrQualificationUnavailable
	}
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		_ = connection.Close()
		return "", ErrQualificationUnavailable
	}
	defer unixConnection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		if err := unixConnection.SetDeadline(deadline); err != nil {
			return "", ErrQualificationUnavailable
		}
	}
	dbusConnection, err := dbus.DialUnix(unixConnection, dbus.WithAuth(dbus.AuthExternal("0")), dbus.WithContext(ctx))
	if err != nil {
		return "", ErrQualificationUnavailable
	}
	defer dbusConnection.Close()
	if err := dbusConnection.Auth([]dbus.Auth{dbus.AuthExternal("0")}); err != nil {
		return "", ErrQualificationUnavailable
	}
	if err := dbusConnection.Hello(); err != nil {
		return "", ErrQualificationUnavailable
	}

	bus := dbusConnection.Object("org.freedesktop.DBus", dbus.ObjectPath("/org/freedesktop/DBus"))
	var owns bool
	call := bus.CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0, "org.freedesktop.login1")
	if call == nil || call.Err != nil || call.Store(&owns) != nil || !owns {
		return "", ErrQualificationUnavailable
	}

	logind := dbusConnection.Object(shutdown.LogindDestination, dbus.ObjectPath(shutdown.LogindObjectPath))
	var document string
	call = logind.CallWithContext(ctx, "org.freedesktop.DBus.Introspectable.Introspect", 0)
	if call == nil || call.Err != nil || call.Store(&document) != nil || len(document) > MaxIntrospectionBytes || !validateIntrospection(document) {
		return "", ErrQualificationInvalid
	}

	var result string
	call = logind.CallWithContext(ctx, "org.freedesktop.login1.Manager.CanPowerOff", 0)
	if call == nil {
		return "", ErrQualificationUnavailable
	}
	if call.Err != nil {
		if isUnsupportedDBus(call.Err) {
			return "", ErrQualificationUnsupported
		}
		return "", ErrQualificationUnavailable
	}
	if call.Store(&result) != nil {
		return "", ErrQualificationInvalid
	}
	switch result {
	case "yes":
		return CanPowerOffYes, nil
	case "no":
		return CanPowerOffNo, nil
	case "challenge":
		return CanPowerOffChallenge, nil
	case "na":
		return CanPowerOffNA, nil
	default:
		return "", ErrQualificationInvalid
	}
}

func isUnsupportedDBus(err error) bool {
	var value dbus.Error
	if errors.As(err, &value) {
		return isUnsupportedName(value.Name)
	}
	var pointer *dbus.Error
	return errors.As(err, &pointer) && pointer != nil && isUnsupportedName(pointer.Name)
}

func isUnsupportedName(name string) bool {
	switch name {
	case "org.freedesktop.DBus.Error.ServiceUnknown", "org.freedesktop.DBus.Error.NameHasNoOwner", "org.freedesktop.DBus.Error.UnknownObject", "org.freedesktop.DBus.Error.UnknownInterface", "org.freedesktop.DBus.Error.UnknownMethod":
		return true
	default:
		return false
	}
}

func qualificationContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 2*time.Second)
}
