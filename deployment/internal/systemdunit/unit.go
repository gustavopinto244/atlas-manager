package systemdunit

import "strings"

const Content = `[Unit]
Description=Atlas Manager
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
StateDirectory=atlas-manager atlas-manager-backups
StateDirectoryMode=0750
RuntimeDirectory=atlas-manager
RuntimeDirectoryMode=0750
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectControlGroups=true
ProtectKernelModules=true
RestrictRealtime=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/atlas-manager /var/lib/atlas-manager-backups

[Install]
WantedBy=multi-user.target
`

func Validate(value string) bool {
	for _, required := range []string{
		"User=atlas-manager", "Group=atlas-manager", "SupplementaryGroups=atlas-manager-power",
		"ExecStart=/usr/bin/node /opt/atlas-manager/current/dist/main.js",
		"WorkingDirectory=/var/lib/atlas-manager", "EnvironmentFile=/etc/atlas-manager/atlas-manager.env",
		"Restart=no", "StateDirectory=atlas-manager atlas-manager-backups", "RuntimeDirectory=atlas-manager", "UMask=0027",
	} {
		if !strings.Contains(value, required) {
			return false
		}
	}
	for _, forbidden := range []string{"NoNewPrivileges=true", "RestrictSUIDSGID=true", "PrivateDevices=true", "systemctl", "sh -c"} {
		if strings.Contains(value, forbidden) {
			return false
		}
	}
	return true
}
