package runtimeidentity

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	RuntimeUser       = "atlas-manager"
	RuntimeGroup      = "atlas-manager"
	RuntimeHome       = "/var/lib/atlas-manager"
	RuntimeShell      = "/usr/sbin/nologin"
	HelperGroup       = "atlas-manager-power"
	MaxAccountBytes   = 1 << 20
	MaxAccountLineLen = 4096
)

type Identity struct {
	UserID         int
	PrimaryGroupID int
	HelperGroupID  int
}

type State string

const (
	Absent  State = "absent"
	Ready   State = "ready"
	Blocked State = "blocked"
)

type Process struct {
	UID    int
	EUID   int
	GID    int
	EGID   int
	Groups []int
}

type Entry struct {
	Name    string
	ID      int
	GID     int
	Home    string
	Shell   string
	Members string
}

func Validate(passwd, group string, process Process) (Identity, error) {
	return validateProcess(passwd, group, process, true)
}

// ValidateMock requires the dedicated service identity while rejecting the
// helper execution group. The default systemd profile uses this narrower
// contract; Linux power-effects admission continues to use Validate.
func ValidateMock(passwd, group string, process Process) (Identity, error) {
	return validateProcess(passwd, group, process, false)
}

func validateProcess(passwd, group string, process Process, requireHelperGroup bool) (Identity, error) {
	users, err := parsePasswd(passwd)
	if err != nil {
		return Identity{}, err
	}
	groups, err := parseGroups(group)
	if err != nil {
		return Identity{}, err
	}
	identity, err := validateEntries(users, groups)
	if err != nil {
		return Identity{}, err
	}
	if process.UID <= 0 || process.EUID <= 0 || process.UID != process.EUID {
		return Identity{}, fmt.Errorf("runtime_user_mismatch")
	}
	if process.GID <= 0 || process.EGID <= 0 || process.GID != process.EGID {
		return Identity{}, fmt.Errorf("runtime_primary_group_invalid")
	}
	for _, id := range process.Groups {
		if id == 0 {
			return Identity{}, fmt.Errorf("runtime_root_group_membership_rejected")
		}
	}

	user, _ := exactlyNamed(users, RuntimeUser, "runtime_user")
	if countID(users, user.ID) != 1 || user.ID != process.UID || user.GID != process.GID {
		return Identity{}, fmt.Errorf("runtime_user_mismatch")
	}
	if identity.PrimaryGroupID != process.GID {
		return Identity{}, fmt.Errorf("runtime_primary_group_invalid")
	}
	hasHelperGroup := contains(process.Groups, identity.HelperGroupID)
	if requireHelperGroup && !hasHelperGroup {
		return Identity{}, fmt.Errorf("runtime_helper_group_membership_missing")
	}
	if !requireHelperGroup && hasHelperGroup {
		return Identity{}, fmt.Errorf("runtime_helper_group_membership_unexpected")
	}
	return identity, nil
}

func ValidateAccountContract(passwd, group string) (Identity, error) {
	users, err := parsePasswd(passwd)
	if err != nil {
		return Identity{}, err
	}
	groups, err := parseGroups(group)
	if err != nil {
		return Identity{}, err
	}
	return validateEntries(users, groups)
}

// ClassifyAccountContract reuses the deployment identity parser while
// distinguishing a completely absent account contract from a partial or
// inconsistent one. It never creates or changes account state.
func ClassifyAccountContract(passwd, group string) (State, Identity, error) {
	users, err := parsePasswd(passwd)
	if err != nil {
		return Blocked, Identity{}, err
	}
	groups, err := parseGroups(group)
	if err != nil {
		return Blocked, Identity{}, err
	}
	if !hasName(users, RuntimeUser) && !hasName(groups, RuntimeGroup) && !hasName(groups, HelperGroup) {
		return Absent, Identity{}, nil
	}
	identity, err := validateEntries(users, groups)
	if err != nil {
		return Blocked, Identity{}, err
	}
	helper, _ := exactlyNamed(groups, HelperGroup, "runtime_helper_group")
	if helper.Members != "" {
		return Blocked, Identity{}, fmt.Errorf("runtime_helper_group_members_nonempty")
	}
	return Ready, identity, nil
}

func validateEntries(users, groups []Entry) (Identity, error) {
	user, err := exactlyNamed(users, RuntimeUser, "runtime_user")
	if err != nil {
		return Identity{}, err
	}
	if user.ID <= 0 || user.GID <= 0 || countID(users, user.ID) != 1 {
		return Identity{}, fmt.Errorf("runtime_user_mismatch")
	}
	if user.Home != RuntimeHome {
		return Identity{}, fmt.Errorf("runtime_user_home_invalid")
	}
	if user.Shell != RuntimeShell {
		return Identity{}, fmt.Errorf("runtime_user_shell_invalid")
	}
	primary, err := exactlyNamed(groups, RuntimeGroup, "runtime_primary_group")
	if err != nil {
		return Identity{}, err
	}
	if primary.ID <= 0 || primary.ID != user.GID || countID(groups, primary.ID) != 1 {
		return Identity{}, fmt.Errorf("runtime_primary_group_invalid")
	}
	helper, err := exactlyNamed(groups, HelperGroup, "runtime_helper_group")
	if err != nil {
		return Identity{}, err
	}
	if helper.ID <= 0 || helper.ID == primary.ID || countID(groups, helper.ID) != 1 {
		return Identity{}, fmt.Errorf("runtime_helper_group_invalid")
	}
	return Identity{UserID: user.ID, PrimaryGroupID: primary.ID, HelperGroupID: helper.ID}, nil
}

func parsePasswd(value string) ([]Entry, error) {
	if len(value) > MaxAccountBytes || strings.IndexByte(value, 0) >= 0 || !utf8.ValidString(value) {
		return nil, fmt.Errorf("runtime_identity_files_oversized")
	}
	var result []Entry
	for _, line := range strings.Split(value, "\n") {
		if line == "" {
			continue
		}
		if len(line) > MaxAccountLineLen {
			return nil, fmt.Errorf("runtime_identity_files_oversized")
		}
		fields := strings.Split(line, ":")
		if len(fields) != 7 {
			return nil, fmt.Errorf("runtime_identity_malformed")
		}
		uid, err := canonicalID(fields[2])
		if err != nil {
			return nil, fmt.Errorf("runtime_identity_malformed")
		}
		gid, err := canonicalID(fields[3])
		if err != nil {
			return nil, fmt.Errorf("runtime_identity_malformed")
		}
		result = append(result, Entry{Name: fields[0], ID: uid, GID: gid, Home: fields[5], Shell: fields[6]})
	}
	return result, nil
}

func parseGroups(value string) ([]Entry, error) {
	if len(value) > MaxAccountBytes || strings.IndexByte(value, 0) >= 0 || !utf8.ValidString(value) {
		return nil, fmt.Errorf("runtime_identity_files_oversized")
	}
	var result []Entry
	for _, line := range strings.Split(value, "\n") {
		if line == "" {
			continue
		}
		if len(line) > MaxAccountLineLen {
			return nil, fmt.Errorf("runtime_identity_files_oversized")
		}
		fields := strings.Split(line, ":")
		if len(fields) != 4 {
			return nil, fmt.Errorf("runtime_identity_malformed")
		}
		gid, err := canonicalID(fields[2])
		if err != nil {
			return nil, fmt.Errorf("runtime_identity_malformed")
		}
		result = append(result, Entry{Name: fields[0], ID: gid, Members: fields[3]})
	}
	return result, nil
}

func hasName(entries []Entry, name string) bool {
	for _, entry := range entries {
		if entry.Name == name {
			return true
		}
	}
	return false
}

func canonicalID(value string) (int, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, fmt.Errorf("noncanonical id")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0, fmt.Errorf("noncanonical id")
		}
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("noncanonical id")
	}
	return parsed, nil
}

func exactlyNamed(entries []Entry, name, prefix string) (Entry, error) {
	var matches []Entry
	for _, entry := range entries {
		if entry.Name == name {
			matches = append(matches, entry)
		}
	}
	if len(matches) == 0 {
		return Entry{}, fmt.Errorf("%s_missing", prefix)
	}
	if len(matches) != 1 {
		return Entry{}, fmt.Errorf("%s_duplicate", prefix)
	}
	return matches[0], nil
}

func countID(entries []Entry, id int) int {
	count := 0
	for _, entry := range entries {
		if entry.ID == id {
			count++
		}
	}
	return count
}

func contains(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
