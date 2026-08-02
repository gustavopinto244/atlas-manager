package administrativeconfiguration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const (
	InputName        = "atlas-manager.mock-admin.input.json"
	ExampleInputName = "atlas-manager.mock-admin.input.example.json"
	ProfileName      = "mock-administrative"
	MaxInputBytes    = 65_536
)

const ExampleInput = `{"schemaVersion":1,"cloudflareTeamName":"example-team","cloudflareAudience":"replace-with-access-application-audience","roleAssignments":[{"principalId":"00000000-0000-4000-8000-000000000001","roles":["administrator"]}],"registeredServices":[]}
`

func ExampleInputBytes() []byte { return []byte(ExampleInput) }

type Input struct {
	SchemaVersion      int              `json:"schemaVersion"`
	CloudflareTeam     string           `json:"cloudflareTeamName"`
	CloudflareAudience string           `json:"cloudflareAudience"`
	RoleAssignments    []RoleAssignment `json:"roleAssignments"`
	RegisteredServices json.RawMessage  `json:"registeredServices"`
}

type RoleAssignment struct {
	PrincipalID string   `json:"principalId"`
	Roles       []string `json:"roles"`
}

var allowedRoles = map[string]struct{}{
	"power_operator": {}, "scheduler_operator": {}, "auditor": {},
	"service_operator": {}, "administrator": {},
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
	if input.SchemaVersion != 1 || input.CloudflareTeam == "" || input.CloudflareTeam != strings.TrimSpace(input.CloudflareTeam) || len(input.CloudflareTeam) > 63 || !validTeam(input.CloudflareTeam) || input.CloudflareAudience == "" || input.CloudflareAudience != strings.TrimSpace(input.CloudflareAudience) || len(input.CloudflareAudience) > 256 || strings.ContainsAny(input.CloudflareAudience, "\" ,\t\r\n") || len(input.RoleAssignments) == 0 || len(input.RoleAssignments) > 32 || len(input.RegisteredServices) == 0 {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	seenPrincipals := map[string]struct{}{}
	for index := range input.RoleAssignments {
		assignment := &input.RoleAssignments[index]
		if !validUUID(assignment.PrincipalID) || len(assignment.Roles) == 0 || len(assignment.Roles) > 5 {
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
	var services []json.RawMessage
	if json.Unmarshal(input.RegisteredServices, &services) != nil || len(services) > 100 {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	return input, nil
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
	canonical, err := json.Marshal(input.RoleAssignments)
	if err != nil {
		return nil, fmt.Errorf("administrative_input_invalid")
	}
	services := bytes.TrimSpace(input.RegisteredServices)
	return []byte(fmt.Sprintf("HOST=127.0.0.1\nPORT=3000\nLOG_LEVEL=info\nPOWER_MANAGEMENT_BACKEND=mock\nMACHINE_POWER_EFFECTS_ACTIVATION=disabled\nMACHINE_POWER_SCHEDULER_ENABLED=false\nMACHINE_OPERATING_POLICY={\"mode\":\"always_on\"}\nADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED=true\nADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true\nADMINISTRATIVE_OVERVIEW_HTTP_ENABLED=true\nADMINISTRATIVE_DASHBOARD_ENABLED=true\nADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\nADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\nADMINISTRATIVE_EVENT_HISTORY_FILE=/var/lib/atlas-manager/admin-events.jsonl\nCLOUDFLARE_ACCESS_TEAM_NAME=%s\nCLOUDFLARE_ACCESS_AUDIENCE=%s\nADMINISTRATIVE_ROLE_ASSIGNMENTS=%s\nREGISTERED_SERVICES_JSON=%s\n", input.CloudflareTeam, input.CloudflareAudience, canonical, services)), nil
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
	return value[14] == '4' && (value[19] == '8' || value[19] == '9' || value[19] == 'a' || value[19] == 'b')
}
