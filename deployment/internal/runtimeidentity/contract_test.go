package runtimeidentity

import (
	"os"
	"path/filepath"
	"testing"
)

const validPasswd = "root:x:0:0::/root:/usr/sbin/nologin\natlas-manager:x:1001:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
const validGroup = "root:x:0:\natlas-manager:x:1001:\natlas-manager-power:x:1002:\n"

func validProcess() Process {
	return Process{UID: 1001, EUID: 1001, GID: 1001, EGID: 1001, Groups: []int{1002}}
}

func TestValidateExactIdentity(t *testing.T) {
	identity, err := Validate(validPasswd, validGroup, validProcess())
	if err != nil || identity != (Identity{UserID: 1001, PrimaryGroupID: 1001, HelperGroupID: 1002}) {
		t.Fatalf("identity = %#v, err = %v", identity, err)
	}
}

func TestValidateAccountContractDoesNotRequireInstallerToRunAsService(t *testing.T) {
	identity, err := ValidateAccountContract(validPasswd, validGroup)
	if err != nil || identity.UserID != 1001 || identity.HelperGroupID != 1002 {
		t.Fatalf("identity = %#v, err = %v", identity, err)
	}
}

func TestSharedIdentityFixtures(t *testing.T) {
	root := filepath.Join("..", "..", "testdata", "runtime-identity")
	passwd, err := os.ReadFile(filepath.Join(root, "valid.passwd"))
	if err != nil {
		t.Fatal(err)
	}
	group, err := os.ReadFile(filepath.Join(root, "valid.group"))
	if err != nil {
		t.Fatal(err)
	}
	identity, err := Validate(string(passwd), string(group), validProcess())
	if err != nil || identity.HelperGroupID != 1002 {
		t.Fatalf("identity = %#v, err = %v", identity, err)
	}
	for _, name := range []string{"wrong-home.passwd", "wrong-shell.passwd"} {
		value, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Validate(string(value), string(group), validProcess()); err == nil {
			t.Fatalf("fixture %s was accepted", name)
		}
	}
	alternate, err := os.ReadFile(filepath.Join(root, "alternate-helper.group"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Validate(string(passwd), string(alternate), validProcess()); err == nil {
		t.Fatal("alternate helper group was accepted")
	}
}

func TestValidateRejectsUnsafeIdentity(t *testing.T) {
	cases := []struct {
		name    string
		pass    string
		group   string
		process Process
	}{
		{"root uid", validPasswd, validGroup, Process{UID: 0, EUID: 0, GID: 1001, EGID: 1001, Groups: []int{1002}}},
		{"wrong home", "atlas-manager:x:1001:1001::/wrong:/usr/sbin/nologin\n", validGroup, validProcess()},
		{"wrong shell", "atlas-manager:x:1001:1001::/var/lib/atlas-manager:/bin/sh\n", validGroup, validProcess()},
		{"helper missing", validPasswd, "atlas-manager:x:1001:", validProcess()},
		{"helper membership", validPasswd, validGroup, Process{UID: 1001, EUID: 1001, GID: 1001, EGID: 1001}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := Validate(testCase.pass, testCase.group, testCase.process); err == nil {
				t.Fatal("expected identity rejection")
			}
		})
	}
}

func TestValidateRejectsDuplicateRelevantRecords(t *testing.T) {
	if _, err := Validate(validPasswd+"atlas-manager:x:1001:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n", validGroup, validProcess()); err == nil {
		t.Fatal("expected duplicate user rejection")
	}
	if _, err := Validate(validPasswd, validGroup+"other:x:1002:\n", validProcess()); err == nil {
		t.Fatal("expected duplicate helper GID rejection")
	}
}
