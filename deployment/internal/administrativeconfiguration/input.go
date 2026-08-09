package administrativeconfiguration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	InputName        = "administrative-runtime.input.json"
	ExampleInputName = "atlas-manager.mock-admin.input.example.json"
	ProfileName      = "mock-administrative"
	MaxInputBytes    = 65_536
)

const ExampleInput = `{"schemaVersion":1,"cloudflareTeamName":"example-team","cloudflareAudience":"replace-with-access-application-audience","publicOrigin":"https://atlas.example.com","roleAssignments":[{"principalId":"00000000-0000-4000-8000-000000000001","roles":["administrator"]}],"registeredServices":[],"backupSchedulerEnabled":false,"backupTargets":[{"id":"example-backup","displayName":"Example backup","kind":"mock","schedule":{"mode":"manual"},"retention":{"keepLastSuccessful":7},"limits":{"maxFiles":1000,"maxTotalBytes":1073741824,"maxFileBytes":268435456,"maxDepth":16,"maxRelativePathBytes":4096}}]}
`

func ExampleInputBytes() []byte {
	var input map[string]any
	if err := json.Unmarshal([]byte(ExampleInput), &input); err != nil {
		panic(err)
	}
	input["eventHistoryOperations"] = map[string]any{
		"enabled": true,
		"segment": map[string]any{"maxEvents": 10000, "maxBytes": 16777216},
		"retention": map[string]any{
			"automaticPruneEnabled": false,
			"segments":              map[string]any{"minSealedSegments": 2, "maxSealedSegments": 100, "maxSealedSegmentAgeDays": 365},
			"exports":               map[string]any{"minExports": 1, "maxExports": 32, "maxExportAgeDays": 90},
		},
	}
	value, err := json.Marshal(input)
	if err != nil {
		panic(err)
	}
	return append(value, '\n')
}

type Input struct {
	SchemaVersion          int                    `json:"schemaVersion"`
	CloudflareTeam         string                 `json:"cloudflareTeamName"`
	CloudflareAudience     string                 `json:"cloudflareAudience"`
	PublicOrigin           string                 `json:"publicOrigin"`
	RoleAssignments        []RoleAssignment       `json:"roleAssignments"`
	RegisteredServices     json.RawMessage        `json:"registeredServices"`
	BackupSchedulerEnabled bool                   `json:"backupSchedulerEnabled"`
	BackupTargets          json.RawMessage        `json:"backupTargets"`
	EventHistoryOperations EventHistoryOperations `json:"eventHistoryOperations"`
}

type EventHistoryOperations struct {
	Enabled   bool                  `json:"enabled"`
	Segment   EventHistorySegment   `json:"segment"`
	Retention EventHistoryRetention `json:"retention"`
}
type EventHistorySegment struct {
	MaxEvents int `json:"maxEvents"`
	MaxBytes  int `json:"maxBytes"`
}
type EventHistoryRetention struct {
	AutomaticPruneEnabled bool                         `json:"automaticPruneEnabled"`
	Segments              EventHistorySegmentRetention `json:"segments"`
	Exports               EventHistoryExportRetention  `json:"exports"`
}
type EventHistorySegmentRetention struct {
	MinSealedSegments       int `json:"minSealedSegments"`
	MaxSealedSegments       int `json:"maxSealedSegments"`
	MaxSealedSegmentAgeDays int `json:"maxSealedSegmentAgeDays"`
}
type EventHistoryExportRetention struct {
	MinExports       int `json:"minExports"`
	MaxExports       int `json:"maxExports"`
	MaxExportAgeDays int `json:"maxExportAgeDays"`
}

type RoleAssignment struct {
	PrincipalID string   `json:"principalId"`
	Roles       []string `json:"roles"`
}

var allowedRoles = map[string]struct{}{
	"power_operator": {}, "scheduler_operator": {}, "auditor": {},
	"service_operator": {}, "backup_operator": {}, "audit_operator": {}, "administrator": {},
}

func ValidateInput(data []byte) (Input, error) {
	if len(data) == 0 || len(data) > MaxInputBytes {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	var input Input
	if err := rejectDuplicateKeys(data); err != nil {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	if input.SchemaVersion != 1 || input.CloudflareTeam == "" || input.CloudflareTeam != strings.TrimSpace(input.CloudflareTeam) || len(input.CloudflareTeam) > 63 || !validTeam(input.CloudflareTeam) || input.CloudflareAudience == "" || input.CloudflareAudience != strings.TrimSpace(input.CloudflareAudience) || len(input.CloudflareAudience) > 256 || strings.ContainsAny(input.CloudflareAudience, "\" ,\t\r\n") || !validPublicOrigin(input.PublicOrigin) || len(input.RoleAssignments) == 0 || len(input.RoleAssignments) > 32 || len(input.RegisteredServices) == 0 {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(data, &topLevel); err != nil {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	if _, ok := topLevel["backupSchedulerEnabled"]; !ok {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	if _, ok := topLevel["eventHistoryOperations"]; !ok || !validEventHistoryOperations(input.EventHistoryOperations) {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	seenPrincipals := map[string]struct{}{}
	for index := range input.RoleAssignments {
		assignment := &input.RoleAssignments[index]
		if !validUUID(assignment.PrincipalID) || len(assignment.Roles) == 0 || len(assignment.Roles) > 7 {
			return Input{}, fmt.Errorf("administrative_input_invalid")
		}
		if _, exists := seenPrincipals[assignment.PrincipalID]; exists {
			return Input{}, fmt.Errorf("administrative_input_invalid")
		}
		seenPrincipals[assignment.PrincipalID] = struct{}{}
		seenRoles := map[string]struct{}{}
		for _, role := range assignment.Roles {
			if _, allowed := allowedRoles[role]; !allowed {
				return Input{}, fmt.Errorf("administrative_input_invalid")
			}
			if _, exists := seenRoles[role]; exists {
				return Input{}, fmt.Errorf("administrative_input_invalid")
			}
			seenRoles[role] = struct{}{}
		}
	}
	hasAdministrator := false
	for _, assignment := range input.RoleAssignments {
		for _, role := range assignment.Roles {
			if role == "administrator" {
				hasAdministrator = true
			}
		}
	}
	if !hasAdministrator {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	var services []json.RawMessage
	if json.Unmarshal(input.RegisteredServices, &services) != nil || len(services) > 100 {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	var backupTargets []json.RawMessage
	if json.Unmarshal(input.BackupTargets, &backupTargets) != nil || len(backupTargets) > 100 {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	seenBackupIDs := map[string]struct{}{}
	seenBackupSources := map[string]struct{}{}
	for _, target := range backupTargets {
		id, source, ok := validBackupTarget(target)
		if !ok {
			return Input{}, fmt.Errorf("administrative_input_invalid")
		}
		if _, exists := seenBackupIDs[id]; exists {
			return Input{}, fmt.Errorf("administrative_input_invalid")
		}
		seenBackupIDs[id] = struct{}{}
		if source != "" {
			if _, exists := seenBackupSources[source]; exists {
				return Input{}, fmt.Errorf("administrative_input_invalid")
			}
			seenBackupSources[source] = struct{}{}
		}
	}
	return input, nil
}

func validPublicOrigin(value string) bool {
	parsed, err := url.Parse(value)
	hostname := parsed.Hostname()
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(hostname, "*") || net.ParseIP(hostname) != nil || (parsed.Port() != "" && parsed.Port() != "443") || strings.HasSuffix(parsed.Host, ":443") || !regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$`).MatchString(hostname) {
		return false
	}
	return hostname == strings.ToLower(hostname) && strings.TrimSpace(value) == value
}

func validBackupTarget(data []byte) (string, string, bool) {
	var target map[string]json.RawMessage
	if json.Unmarshal(data, &target) != nil {
		return "", "", false
	}
	allowed := map[string]bool{"id": true, "displayName": true, "kind": true, "sourcePath": true, "schedule": true, "retention": true, "limits": true}
	for key := range target {
		if !allowed[key] {
			return "", "", false
		}
	}
	for _, key := range []string{"id", "displayName", "kind", "schedule", "retention", "limits"} {
		if _, ok := target[key]; !ok {
			return "", "", false
		}
	}
	var id, displayName, kind string
	if json.Unmarshal(target["id"], &id) != nil || !validResourceID(id) || json.Unmarshal(target["displayName"], &displayName) != nil || displayName == "" || strings.TrimSpace(displayName) != displayName || json.Unmarshal(target["kind"], &kind) != nil || (kind != "mock" && kind != "filesystem_tree") {
		return "", "", false
	}
	if len(displayName) > 128 {
		return "", "", false
	}
	source := ""
	if kind == "filesystem_tree" {
		var sourceValue string
		if json.Unmarshal(target["sourcePath"], &sourceValue) != nil || !validSourcePath(sourceValue) {
			return "", "", false
		}
		source = sourceValue
	} else if _, ok := target["sourcePath"]; ok {
		return "", "", false
	}
	var schedule map[string]json.RawMessage
	if json.Unmarshal(target["schedule"], &schedule) != nil {
		return "", "", false
	}
	if len(schedule) < 1 || len(schedule) > 3 {
		return "", "", false
	}
	var mode string
	if json.Unmarshal(schedule["mode"], &mode) != nil || (mode != "manual" && mode != "scheduled" && mode != "disabled") {
		return "", "", false
	}
	if mode != "scheduled" && len(schedule) != 1 {
		return "", "", false
	}
	if mode == "scheduled" {
		var timezone string
		var windows []json.RawMessage
		if json.Unmarshal(schedule["timezone"], &timezone) != nil || timezone == "" || json.Unmarshal(schedule["windows"], &windows) != nil || len(windows) == 0 || len(windows) > 64 {
			return "", "", false
		}
		if len(schedule) != 3 {
			return "", "", false
		}
	}
	var retention map[string]json.RawMessage
	if json.Unmarshal(target["retention"], &retention) != nil {
		return "", "", false
	}
	if len(retention) < 1 || len(retention) > 2 {
		return "", "", false
	}
	var keep int
	if json.Unmarshal(retention["keepLastSuccessful"], &keep) != nil || keep < 1 || keep > 100 {
		return "", "", false
	}
	if age, ok := retention["maxSuccessfulAgeDays"]; ok {
		var days int
		if json.Unmarshal(age, &days) != nil || days < 1 || days > 3650 {
			return "", "", false
		}
	}
	var limits map[string]json.RawMessage
	if json.Unmarshal(target["limits"], &limits) != nil {
		return "", "", false
	}
	if len(limits) != 5 {
		return "", "", false
	}
	maximums := map[string]int64{"maxFiles": 100000, "maxTotalBytes": 100 * 1024 * 1024 * 1024, "maxFileBytes": 20 * 1024 * 1024 * 1024, "maxDepth": 64, "maxRelativePathBytes": 4096}
	for _, key := range []string{"maxFiles", "maxTotalBytes", "maxFileBytes", "maxDepth", "maxRelativePathBytes"} {
		var value int64
		if json.Unmarshal(limits[key], &value) != nil || value < 1 || value > maximums[key] {
			return "", "", false
		}
	}
	return id, source, true
}

func validResourceID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for index, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && (char != '-' || index == 0 || index == len(value)-1) {
			return false
		}
	}
	return true
}

func validSourcePath(value string) bool {
	if value == "" || value == "/" || !filepath.IsAbs(value) || filepath.Clean(value) != value || strings.Contains(value, "..") {
		return false
	}
	for _, root := range []string{"/proc", "/sys", "/dev", "/run", "/var/lib/atlas-manager-backups"} {
		if value == root || strings.HasPrefix(value, root+string(filepath.Separator)) {
			return false
		}
	}
	return true
}

func rejectDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		if delimiter == '{' {
			seen := map[string]struct{}{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok {
					return fmt.Errorf("invalid")
				}
				if _, exists := seen[name]; exists {
					return fmt.Errorf("duplicate")
				}
				seen[name] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
		} else if delimiter == '[' {
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		}
		_, err = decoder.Token()
		return err
	}
	if err := walk(); err != nil {
		return err
	}
	_, err := decoder.Token()
	if err != io.EOF {
		return fmt.Errorf("trailing")
	}
	return nil
}

func CanonicalInput(input Input) ([]byte, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("administrative_input_invalid")
	}
	return append(data, '\n'), nil
}

func Environment(input Input) ([]byte, error) {
	environment, err := environmentWithoutPublicOrigin(input)
	if err != nil {
		return nil, err
	}
	return addPublicOrigin(environment, input.PublicOrigin), nil
}

func environmentWithoutPublicOrigin(input Input) ([]byte, error) {
	canonical, err := json.Marshal(input.RoleAssignments)
	if err != nil {
		return nil, fmt.Errorf("administrative_input_invalid")
	}
	services := bytes.TrimSpace(input.RegisteredServices)
	schedulerFiles := "SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE=/var/lib/atlas-manager-service-availability/scheduler-cursor.json\nSERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE=/var/lib/atlas-manager-service-availability/occurrence-claims.jsonl\nSERVICE_AVAILABILITY_OVERRIDE_FILE=/var/lib/atlas-manager-service-availability/overrides.json\n"
	if input.BackupSchedulerEnabled {
		schedulerFiles += "BACKUP_SCHEDULER_CURSOR_FILE=/var/lib/atlas-manager-backups/scheduler-cursor.json\nBACKUP_OCCURRENCE_CLAIM_FILE=/var/lib/atlas-manager-backups/occurrence-claims.jsonl\n"
	}
	if input.EventHistoryOperations.Enabled {
		retention, err := json.Marshal(input.EventHistoryOperations.Retention)
		if err != nil {
			return nil, fmt.Errorf("administrative_input_invalid")
		}
		var retentionMap map[string]any
		if err := json.Unmarshal(retention, &retentionMap); err != nil {
			return nil, fmt.Errorf("administrative_input_invalid")
		}
		retentionMap["schemaVersion"] = 1
		retention, err = json.Marshal(retentionMap)
		if err != nil {
			return nil, fmt.Errorf("administrative_input_invalid")
		}
		return []byte(fmt.Sprintf("HOST=127.0.0.1\nPORT=3000\nLOG_LEVEL=info\nPOWER_MANAGEMENT_BACKEND=mock\nMACHINE_POWER_EFFECTS_ACTIVATION=disabled\nMACHINE_POWER_SCHEDULER_ENABLED=false\nMACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}\nADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true\nADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true\nADMINISTRATIVE_OVERVIEW_HTTP_ENABLED=true\nADMINISTRATIVE_DASHBOARD_ENABLED=true\nADMINISTRATIVE_BACKUP_HTTP_ENABLED=true\nADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\nADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\nSERVICE_AVAILABILITY_POLICY_FILE=/var/lib/atlas-manager-service-availability/policies.json\nADMINISTRATIVE_EVENT_HISTORY_DIRECTORY=/var/lib/atlas-manager-event-history\nADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS=%d\nADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES=%d\nADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY=%s\nADMINISTRATIVE_EVENT_HISTORY_AUTOMATIC_RETENTION_ENABLED=%t\nBACKUP_RUN_HISTORY_FILE=/var/lib/atlas-manager-backups/runs.jsonl\nBACKUP_SCHEDULER_ENABLED=%t\n%sCLOUDFLARE_ACCESS_TEAM_NAME=%s\nCLOUDFLARE_ACCESS_AUDIENCE=%s\nADMINISTRATIVE_ROLE_ASSIGNMENTS=%s\nREGISTERED_SERVICES_JSON=%s\nREGISTERED_BACKUP_TARGETS_JSON=%s\n", input.EventHistoryOperations.Segment.MaxEvents, input.EventHistoryOperations.Segment.MaxBytes, bytes.TrimSpace(retention), input.EventHistoryOperations.Retention.AutomaticPruneEnabled, input.BackupSchedulerEnabled, schedulerFiles, input.CloudflareTeam, input.CloudflareAudience, canonical, services, bytes.TrimSpace(input.BackupTargets))), nil
	}
	return []byte(fmt.Sprintf("HOST=127.0.0.1\nPORT=3000\nLOG_LEVEL=info\nPOWER_MANAGEMENT_BACKEND=mock\nMACHINE_POWER_EFFECTS_ACTIVATION=disabled\nMACHINE_POWER_SCHEDULER_ENABLED=false\nMACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}\nADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true\nADMINISTRATIVE_OVERVIEW_HTTP_ENABLED=true\nADMINISTRATIVE_DASHBOARD_ENABLED=true\nADMINISTRATIVE_BACKUP_HTTP_ENABLED=true\nADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\nADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\nSERVICE_AVAILABILITY_POLICY_FILE=/var/lib/atlas-manager-service-availability/policies.json\nADMINISTRATIVE_EVENT_HISTORY_FILE=/var/lib/atlas-manager/admin-events.jsonl\nBACKUP_RUN_HISTORY_FILE=/var/lib/atlas-manager-backups/runs.jsonl\nBACKUP_SCHEDULER_ENABLED=%t\n%sCLOUDFLARE_ACCESS_TEAM_NAME=%s\nCLOUDFLARE_ACCESS_AUDIENCE=%s\nADMINISTRATIVE_ROLE_ASSIGNMENTS=%s\nREGISTERED_SERVICES_JSON=%s\nREGISTERED_BACKUP_TARGETS_JSON=%s\n", input.BackupSchedulerEnabled, schedulerFiles, input.CloudflareTeam, input.CloudflareAudience, canonical, services, bytes.TrimSpace(input.BackupTargets))), nil
}

func addPublicOrigin(environment []byte, origin string) []byte {
	line := []byte("ADMINISTRATIVE_PUBLIC_ORIGIN=" + origin + "\nADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED=true\n")
	marker := []byte("ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true\n")
	index := bytes.Index(environment, marker)
	if index < 0 {
		return environment
	}
	result := make([]byte, 0, len(environment)+len(line))
	result = append(result, environment[:index+len(marker)]...)
	result = append(result, line...)
	result = append(result, environment[index+len(marker):]...)
	return result
}

func validEventHistoryOperations(value EventHistoryOperations) bool {
	segments := value.Retention.Segments
	exports := value.Retention.Exports
	return value.Enabled &&
		value.Segment.MaxEvents >= 100 && value.Segment.MaxEvents <= 100000 &&
		value.Segment.MaxBytes >= 1048576 && value.Segment.MaxBytes <= 67108864 &&
		segments.MinSealedSegments >= 1 && segments.MinSealedSegments <= 1000 &&
		segments.MaxSealedSegments >= segments.MinSealedSegments && segments.MaxSealedSegments <= 10000 &&
		segments.MaxSealedSegmentAgeDays >= 1 && segments.MaxSealedSegmentAgeDays <= 3650 &&
		exports.MinExports >= 0 && exports.MinExports <= 100 &&
		exports.MaxExports >= exports.MinExports && exports.MaxExports <= 1000 &&
		exports.MaxExportAgeDays >= 1 && exports.MaxExportAgeDays <= 3650
}

func ProfileSHA256(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func validTeam(value string) bool {
	for index, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
		if (index == 0 || index == len(value)-1) && char == '-' {
			return false
		}
	}
	return true
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
			continue
		}
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	version := value[14]
	return version >= '1' && version <= '5' && (value[19] == '8' || value[19] == '9' || value[19] == 'a' || value[19] == 'b')
}
