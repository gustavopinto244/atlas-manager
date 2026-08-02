package runtimeconfiguration

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	ProfileName = "mock-only"
	Profile     = "HOST=127.0.0.1\nPORT=3000\nLOG_LEVEL=info\nPOWER_MANAGEMENT_BACKEND=mock\nMACHINE_POWER_EFFECTS_ACTIVATION=disabled\nMACHINE_POWER_SCHEDULER_ENABLED=false\nMACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}\nREGISTERED_SERVICES_JSON=[]\nADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=false\nADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\nADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\n"
)

func ProfileBytes() []byte { return []byte(Profile) }

func ProfileSHA256() string {
	digest := sha256.Sum256(ProfileBytes())
	return hex.EncodeToString(digest[:])
}

func ValidateProfile(value []byte) error {
	if string(value) != Profile || !strings.HasSuffix(string(value), "\n") {
		return fmt.Errorf("configuration_profile_invalid")
	}
	return nil
}
