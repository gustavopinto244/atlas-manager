package smoke

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

func Run(ctx context.Context, nodePath, applicationRoot string) error {
	entry := filepath.Join(applicationRoot, "dist", "main.js")
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("smoke_entry_missing")
	}
	port := "39123"
	command := exec.CommandContext(ctx, nodePath, entry)
	command.Dir = applicationRoot
	command.Env = []string{
		"PATH=/usr/bin:/bin", "HOME=/var/lib/atlas-manager", "LANG=C", "LC_ALL=C", "TZ=UTC",
		"HOST=127.0.0.1", "PORT=" + port, "LOG_LEVEL=error", "POWER_MANAGEMENT_BACKEND=mock",
		"MACHINE_POWER_EFFECTS_ACTIVATION=disabled", "MACHINE_POWER_SCHEDULER_ENABLED=false",
		"MACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}",
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("smoke_start_failed")
	}
	address := net.JoinHostPort("127.0.0.1", port)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			break
		}
		select {
		case <-ctx.Done():
			_ = command.Process.Kill()
			_ = command.Wait()
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	if time.Now().After(deadline) {
		_ = command.Process.Kill()
		_ = command.Wait()
		return fmt.Errorf("smoke_listen_failed")
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return fmt.Errorf("smoke_stop_failed")
	}
	if err := command.Wait(); err != nil {
		return fmt.Errorf("smoke_exit_failed")
	}
	return nil
}
