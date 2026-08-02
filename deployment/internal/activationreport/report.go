package activationreport

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	SchemaVersion = 1
	MaxBytes      = 128 * 1024
)

type Step struct {
	Sequence     int    `json:"sequence"`
	Action       string `json:"action"`
	Status       string `json:"status"`
	ReportSHA256 string `json:"reportSha256"`
}

type Evidence struct {
	SchemaVersion              int    `json:"schemaVersion"`
	Result                     string `json:"result"`
	SourceCommit               string `json:"sourceCommit"`
	ApplicationVersion         string `json:"applicationVersion"`
	DeploymentBundleSHA256     string `json:"deploymentBundleSha256"`
	RuntimeConfigurationSHA256 string `json:"runtimeConfigurationSha256"`
	SystemdUnitSHA256          string `json:"systemdUnitSha256"`
	ActivationSteps            []Step `json:"activationSteps"`
	HealthChecks               []Step `json:"healthChecks"`
	FinalState                 string `json:"finalState"`
}

func (e Evidence) Marshal() ([]byte, error) {
	if e.SchemaVersion != SchemaVersion || !safeResult(e.Result) || !safeCommit(e.SourceCommit) || !safeVersion(e.ApplicationVersion) || !safeHash(e.DeploymentBundleSHA256) || !safeHash(e.RuntimeConfigurationSHA256) || !safeHash(e.SystemdUnitSHA256) || len(e.ActivationSteps) > 64 || len(e.HealthChecks) > 64 {
		return nil, fmt.Errorf("activation_evidence_invalid")
	}
	for _, step := range append(append([]Step{}, e.ActivationSteps...), e.HealthChecks...) {
		if step.Sequence <= 0 || !safeText(step.Action) || !safeText(step.Status) || !safeHash(step.ReportSHA256) {
			return nil, fmt.Errorf("activation_evidence_invalid")
		}
	}
	data, err := json.Marshal(e)
	if err != nil || len(data)+1 > MaxBytes {
		return nil, fmt.Errorf("activation_evidence_invalid")
	}
	return append(data, '\n'), nil
}

func Digest(data []byte) string { value := sha256.Sum256(data); return hex.EncodeToString(value[:]) }

func Chain(previous, reportDigest string) string {
	return Digest([]byte(previous + reportDigest))
}

func safeHash(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
func safeCommit(value string) bool {
	if len(value) != 40 || strings.ToLower(value) != value {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
func safeVersion(value string) bool { return safeText(value) }
func safeText(value string) bool {
	if value == "" || len(value) > 256 || strings.IndexByte(value, 0) >= 0 {
		return false
	}
	return strings.TrimSpace(value) == value
}
func safeResult(value string) bool {
	switch value {
	case "active_mock_verified", "deactivated", "activation_failed_rolled_back", "activation_failed_recovery_required", "blocked":
		return true
	}
	return false
}
