package systemdunit

import (
	"fmt"
	"strings"
)

type Profile string

const (
	ProfileMock         Profile = "mock"
	ProfilePowerEnabled Profile = "power-enabled"
	DefaultProfile              = ProfileMock
)

const Content = `[Unit]
Description=Atlas Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atlas-manager
Group=atlas-manager
WorkingDirectory=/var/lib/atlas-manager
EnvironmentFile=/etc/atlas-manager/atlas-manager.env
ExecStart=/usr/bin/node /opt/atlas-manager/current/dist/main.js
Restart=no
KillMode=control-group
KillSignal=SIGTERM
TimeoutStartSec=30s
TimeoutStopSec=30s
UMask=0027
StateDirectory=atlas-manager atlas-manager-backups atlas-manager-event-history atlas-manager-service-availability atlas-manager-machine-power
StateDirectoryMode=0700
RuntimeDirectory=atlas-manager
RuntimeDirectoryMode=0700
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectControlGroups=true
ProtectKernelModules=true
RestrictRealtime=true
LockPersonality=true
NoNewPrivileges=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/atlas-manager /var/lib/atlas-manager-backups /var/lib/atlas-manager-event-history /var/lib/atlas-manager-service-availability /var/lib/atlas-manager-machine-power

[Install]
WantedBy=multi-user.target
`

// PowerEnabledContent is a future, explicitly selected template. The default
// installer never installs it. Its only privilege difference is the helper
// execution group and the absence of hardening that would block the reviewed
// setuid helper. It does not select a backend or satisfy any ADR-015 gate.
const PowerEnabledContent = `[Unit]
Description=Atlas Manager (explicit power-enabled profile)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atlas-manager
Group=atlas-manager
SupplementaryGroups=atlas-manager-power
WorkingDirectory=/var/lib/atlas-manager
EnvironmentFile=/etc/atlas-manager/atlas-manager.env
ExecStart=/usr/bin/node /opt/atlas-manager/current/dist/main.js
Restart=no
KillMode=control-group
KillSignal=SIGTERM
TimeoutStartSec=30s
TimeoutStopSec=30s
UMask=0027
StateDirectory=atlas-manager atlas-manager-backups atlas-manager-event-history atlas-manager-service-availability atlas-manager-machine-power
StateDirectoryMode=0700
RuntimeDirectory=atlas-manager
RuntimeDirectoryMode=0700
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectControlGroups=true
ProtectKernelModules=true
RestrictRealtime=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/atlas-manager /var/lib/atlas-manager-backups /var/lib/atlas-manager-event-history /var/lib/atlas-manager-service-availability /var/lib/atlas-manager-machine-power

[Install]
WantedBy=multi-user.target
`

var previousPowerReadyContent = strings.Replace(
	PowerEnabledContent,
	"Description=Atlas Manager (explicit power-enabled profile)",
	"Description=Atlas Manager",
	1,
)

var legacyPowerEnabledContent = strings.NewReplacer(
	" atlas-manager-machine-power",
	"",
	" /var/lib/atlas-manager-machine-power",
	"",
).Replace(previousPowerReadyContent)

func ContentFor(profile Profile) (string, error) {
	switch profile {
	case ProfileMock:
		return Content, nil
	case ProfilePowerEnabled:
		return PowerEnabledContent, nil
	default:
		return "", fmt.Errorf("systemd_profile_invalid")
	}
}

func Validate(value string) bool { return ValidateForProfile(value, ProfileMock) }

func ValidateForProfile(value string, profile Profile) bool {
	for _, required := range []string{
		"User=atlas-manager", "Group=atlas-manager",
		"ExecStart=/usr/bin/node /opt/atlas-manager/current/dist/main.js",
		"WorkingDirectory=/var/lib/atlas-manager", "EnvironmentFile=/etc/atlas-manager/atlas-manager.env",
		"Restart=no", "StateDirectory=atlas-manager atlas-manager-backups atlas-manager-event-history atlas-manager-service-availability atlas-manager-machine-power", "RuntimeDirectory=atlas-manager", "UMask=0027",
	} {
		if !strings.Contains(value, required) {
			return false
		}
	}
	for _, forbidden := range []string{
		"systemctl", "sh -c", "sudo", "/usr/local/libexec/atlas-manager-power-helper",
		"POWER_MANAGEMENT_BACKEND=", "MACHINE_POWER_EFFECTS_ACTIVATION=",
		"MACHINE_POWER_EFFECTS_CONFIRMATION=", "LINUX_POWER_HELPER_EXPECTED_SHA256=",
		"MACHINE_POWER_SCHEDULER_ENABLED=", "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=",
		"ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=",
	} {
		if strings.Contains(value, forbidden) {
			return false
		}
	}
	switch profile {
	case ProfileMock:
		return hasExactDirective(value, "NoNewPrivileges", "true") &&
			hasExactDirective(value, "RestrictSUIDSGID", "true") &&
			!hasDirective(value, "SupplementaryGroups") &&
			!strings.Contains(value, "atlas-manager-power")
	case ProfilePowerEnabled:
		return hasExactDirective(value, "SupplementaryGroups", "atlas-manager-power") &&
			!hasDirective(value, "NoNewPrivileges") &&
			!hasDirective(value, "RestrictSUIDSGID")
	default:
		return false
	}
}

func hasDirective(value, name string) bool {
	prefix := name + "="
	for _, line := range strings.Split(value, "\n") {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return false
}

func hasExactDirective(value, name, expected string) bool {
	prefix := name + "="
	seen := false
	for _, line := range strings.Split(value, "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		if seen || line != prefix+expected {
			return false
		}
		seen = true
	}
	return seen
}

// ValidateManaged accepts the default mock contract, the opt-in template, and
// the exact power-ready predecessor units used by the managed upgrade path. Bundle
// inspection remains strict through Validate; predecessor compatibility
// applies only while proving an existing installation before replacement.
func ValidateManaged(value string) bool {
	return Validate(value) ||
		strings.TrimSpace(value) == strings.TrimSpace(PowerEnabledContent) ||
		strings.TrimSpace(value) == strings.TrimSpace(previousPowerReadyContent) ||
		strings.TrimSpace(value) == strings.TrimSpace(legacyPowerEnabledContent)
}
