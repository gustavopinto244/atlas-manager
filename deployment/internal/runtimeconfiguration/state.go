package runtimeconfiguration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

const StateSchemaVersion = 1

type State struct {
	SchemaVersion       int    `json:"schemaVersion"`
	Profile             string `json:"profile"`
	ConfigurationSHA256 string `json:"configurationSha256"`
	ApplicationVersion  string `json:"applicationVersion"`
	SourceCommit        string `json:"sourceCommit"`
	Status              string `json:"status"`
}

func ValidateState(state State) error {
	if state.SchemaVersion != StateSchemaVersion || state.Profile != ProfileName || state.Status != "installed" || !safeHash(state.ConfigurationSHA256) || !safeVersion(state.ApplicationVersion) || !safeCommit(state.SourceCommit) {
		return fmt.Errorf("configuration_state_invalid")
	}
	return nil
}

func ReadState(path string) (State, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return State{}, false, nil
	}
	if err != nil || len(data) > 16*1024 {
		return State{}, true, fmt.Errorf("configuration_state_invalid")
	}
	var state State
	if err := decodeStrict(data, &state); err != nil || ValidateState(state) != nil {
		return State{}, true, fmt.Errorf("configuration_state_invalid")
	}
	return state, true, nil
}

func WriteState(directory, path string, state State) error {
	if err := ValidateState(state); err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	return writeAtomic(path, append(data, '\n'))
}

func RemoveState(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("configuration_state_remove_failed")
	}
	return nil
}

func writeAtomic(path string, data []byte) error {
	temporary := path + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	defer func() { _ = os.Remove(temporary) }()
	if _, err := file.Write(data); err != nil || file.Sync() != nil || file.Close() != nil {
		_ = file.Close()
		return fmt.Errorf("configuration_state_write_failed")
	}
	if err := os.Chmod(temporary, 0o600); err != nil || os.Rename(temporary, path) != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	return nil
}

func decodeStrict(data []byte, target any) error {
	if err := rejectDuplicateKeys(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("configuration_state_trailing_data")
	}
	return nil
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
					return fmt.Errorf("configuration_state_invalid")
				}
				if _, exists := seen[name]; exists {
					return fmt.Errorf("configuration_state_duplicate_field")
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
		} else {
			return nil
		}
		_, err = decoder.Token()
		return err
	}
	if err := walk(); err != nil {
		return err
	}
	_, err := decoder.Token()
	if err != io.EOF {
		return fmt.Errorf("configuration_state_trailing_data")
	}
	return nil
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
	return value != strings.Repeat("0", 64)
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
