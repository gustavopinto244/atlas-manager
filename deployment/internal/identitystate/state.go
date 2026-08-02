package identitystate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const (
	SchemaVersion        = 1
	MaxBytes             = 16 * 1024
	RuntimeUser          = runtimeidentity.RuntimeUser
	PrimaryGroup         = runtimeidentity.RuntimeGroup
	HelperGroup          = runtimeidentity.HelperGroup
	ResourceRuntimeUser  = "runtime_user"
	ResourcePrimaryGroup = "primary_group"
	ResourceHelperGroup  = "helper_group"
)

type State string

const (
	Absent          State = "absent"
	ManagedPrepared State = "managed_prepared"
	ExactUnmanaged  State = "exact_unmanaged"
	Partial         State = "partial"
	Conflicting     State = "conflicting"
	Interrupted     State = "interrupted"
	Unsafe          State = "unsafe"
)

type Resource struct {
	Name string `json:"name"`
	ID   int    `json:"uid,omitempty"`
}

type GroupResource struct {
	Name string `json:"name"`
	ID   int    `json:"gid,omitempty"`
}

type ManagedState struct {
	SchemaVersion int           `json:"schemaVersion"`
	Status        string        `json:"status"`
	RuntimeUser   Resource      `json:"runtimeUser"`
	PrimaryGroup  GroupResource `json:"primaryGroup"`
	HelperGroup   GroupResource `json:"helperGroup"`
	SourceCommit  string        `json:"sourceCommit"`
	BundleVersion string        `json:"bundleVersion"`
}

type Journal struct {
	SchemaVersion int      `json:"schemaVersion"`
	Status        string   `json:"status"`
	Resources     []string `json:"resources"`
	Steps         []string `json:"completedSteps"`
	SourceCommit  string   `json:"sourceCommit"`
	BundleVersion string   `json:"bundleVersion"`
}

func Classify(passwd, group string, state *ManagedState, journalPresent bool) (State, runtimeidentity.Identity, error) {
	if journalPresent {
		return Interrupted, runtimeidentity.Identity{}, fmt.Errorf("preparation_journal_present")
	}
	if !hasRelevantName(passwd, group) {
		if state != nil {
			return Unsafe, runtimeidentity.Identity{}, fmt.Errorf("managed_state_invalid")
		}
		return Absent, runtimeidentity.Identity{}, nil
	}
	accountState, identity, accountErr := runtimeidentity.ClassifyAccountContract(passwd, group)
	if accountState == runtimeidentity.Absent {
		if state != nil {
			return Unsafe, runtimeidentity.Identity{}, fmt.Errorf("managed_state_invalid")
		}
		return Absent, runtimeidentity.Identity{}, nil
	}
	if accountState == runtimeidentity.Ready {
		if helperMembersPresent(group) {
			return Conflicting, runtimeidentity.Identity{}, fmt.Errorf("identity_state_conflicting")
		}
		if state == nil {
			return ExactUnmanaged, identity, nil
		}
		if err := Validate(*state); err != nil || !stateMatches(*state, identity) {
			return Unsafe, identity, fmt.Errorf("managed_state_invalid")
		}
		return ManagedPrepared, identity, nil
	}
	if accountErr == nil {
		return Conflicting, runtimeidentity.Identity{}, fmt.Errorf("identity_state_conflicting")
	}
	if hasRelevantName(passwd, group) {
		if strings.Contains(accountErr.Error(), "duplicate") || strings.Contains(accountErr.Error(), "mismatch") || strings.Contains(accountErr.Error(), "invalid") || strings.Contains(accountErr.Error(), "members_nonempty") {
			return Conflicting, runtimeidentity.Identity{}, fmt.Errorf("identity_state_conflicting")
		}
		return Partial, runtimeidentity.Identity{}, fmt.Errorf("identity_state_partial")
	}
	return Unsafe, runtimeidentity.Identity{}, fmt.Errorf("account_database_unsafe")
}

func Validate(state ManagedState) error {
	if state.SchemaVersion != SchemaVersion || state.Status != "prepared" || state.RuntimeUser.Name != RuntimeUser || state.PrimaryGroup.Name != PrimaryGroup || state.HelperGroup.Name != HelperGroup || state.RuntimeUser.ID <= 0 || state.PrimaryGroup.ID <= 0 || state.HelperGroup.ID <= 0 || state.PrimaryGroup.ID == state.HelperGroup.ID || !safeCommit(state.SourceCommit) || !safeVersion(state.BundleVersion) {
		return fmt.Errorf("managed_state_invalid")
	}
	return nil
}

func ValidateJournal(journal Journal) error {
	if journal.SchemaVersion != SchemaVersion || journal.Status != "in_progress" || len(journal.Resources) != 3 || len(journal.Steps) > 3 || !safeCommit(journal.SourceCommit) || !safeVersion(journal.BundleVersion) {
		return fmt.Errorf("preparation_journal_invalid")
	}
	for _, resource := range journal.Resources {
		if resource != ResourceRuntimeUser && resource != ResourcePrimaryGroup && resource != ResourceHelperGroup {
			return fmt.Errorf("preparation_journal_invalid")
		}
	}
	if len(map[string]struct{}{journal.Resources[0]: {}, journal.Resources[1]: {}, journal.Resources[2]: {}}) != len(journal.Resources) {
		return fmt.Errorf("preparation_journal_invalid")
	}
	steps := map[string]struct{}{}
	for _, step := range journal.Steps {
		if step != ResourceRuntimeUser && step != ResourcePrimaryGroup && step != ResourceHelperGroup {
			return fmt.Errorf("preparation_journal_invalid")
		}
		if _, exists := steps[step]; exists {
			return fmt.Errorf("preparation_journal_invalid")
		}
		steps[step] = struct{}{}
	}
	return nil
}

func ReadState(path string) (*ManagedState, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, fmt.Errorf("managed_state_read_failed")
	}
	if len(data) > MaxBytes {
		return nil, true, fmt.Errorf("managed_state_invalid")
	}
	var state ManagedState
	if err := decodeStrict(data, &state); err != nil || Validate(state) != nil {
		return nil, true, fmt.Errorf("managed_state_invalid")
	}
	return &state, true, nil
}

func ReadJournal(path string) (Journal, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Journal{}, false, nil
	}
	if err != nil || len(data) > MaxBytes {
		return Journal{}, true, fmt.Errorf("preparation_journal_invalid")
	}
	var journal Journal
	if err := decodeStrict(data, &journal); err != nil || ValidateJournal(journal) != nil {
		return Journal{}, true, fmt.Errorf("preparation_journal_invalid")
	}
	return journal, true, nil
}

func WriteState(directory, path string, state ManagedState) error {
	if err := Validate(state); err != nil {
		return err
	}
	if err := preparePrivateDirectory(directory); err != nil {
		return fmt.Errorf("managed_state_write_failed")
	}
	return writeAtomic(path, state)
}

func WriteJournal(directory, path string, journal Journal) error {
	if err := ValidateJournal(journal); err != nil {
		return err
	}
	if err := preparePrivateDirectory(directory); err != nil {
		return fmt.Errorf("preparation_journal_write_failed")
	}
	return writeAtomic(path, journal)
}

func RemoveJournal(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("preparation_journal_remove_failed")
	}
	return nil
}

func stateMatches(state ManagedState, identity runtimeidentity.Identity) bool {
	return state.RuntimeUser.ID == identity.UserID && state.PrimaryGroup.ID == identity.PrimaryGroupID && state.HelperGroup.ID == identity.HelperGroupID
}

func hasRelevantName(passwd, group string) bool {
	for _, line := range strings.Split(passwd, "\n") {
		if fields := strings.Split(line, ":"); len(fields) > 0 && (fields[0] == RuntimeUser || fields[0] == PrimaryGroup || fields[0] == HelperGroup) {
			return true
		}
	}
	for _, line := range strings.Split(group, "\n") {
		if fields := strings.Split(line, ":"); len(fields) > 0 && (fields[0] == RuntimeUser || fields[0] == HelperGroup) {
			return true
		}
	}
	return false
}

func helperMembersPresent(group string) bool {
	for _, line := range strings.Split(group, "\n") {
		fields := strings.Split(line, ":")
		if len(fields) == 4 && fields[0] == HelperGroup && fields[3] != "" {
			return true
		}
	}
	return false
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

func safeVersion(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._+-", char)) {
			return false
		}
	}
	return true
}

func preparePrivateDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	return os.Chmod(path, 0o700)
}

func writeAtomic(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			_ = os.Remove(temporary)
		}
	}()
	if _, err := file.Write(append(data, '\n')); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	ok = true
	return nil
}

func decodeStrict(data []byte, target any) error {
	if err := uniqueJSON(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("trailing_json")
	}
	return nil
}

func uniqueJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := parseValue(decoder); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("trailing_json")
	}
	return nil
}

func parseValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	if delimiter, ok := token.(json.Delim); ok {
		switch delimiter {
		case '{':
			keys := map[string]struct{}{}
			for decoder.More() {
				keyToken, keyErr := decoder.Token()
				key, keyOK := keyToken.(string)
				if keyErr != nil || !keyOK {
					return fmt.Errorf("object_key_invalid")
				}
				if _, exists := keys[key]; exists {
					return fmt.Errorf("duplicate_json_field")
				}
				keys[key] = struct{}{}
				if err := parseValue(decoder); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
		case '[':
			for decoder.More() {
				if err := parseValue(decoder); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
		}
	}
	return err
}
