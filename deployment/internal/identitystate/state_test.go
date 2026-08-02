package identitystate

import (
	"os"
	"path/filepath"
	"testing"
)

const validCommit = "0123456789abcdef0123456789abcdef01234567"

func validState() ManagedState {
	return ManagedState{SchemaVersion: 1, Status: "prepared", RuntimeUser: Resource{Name: RuntimeUser, ID: 1001}, PrimaryGroup: GroupResource{Name: PrimaryGroup, ID: 1001}, HelperGroup: GroupResource{Name: HelperGroup, ID: 1002}, SourceCommit: validCommit, BundleVersion: "0.1.0"}
}

func TestClassifyAbsentExactAndManaged(t *testing.T) {
	passwd := "root:x:0:0:root:/root:/bin/sh\n"
	group := "root:x:0:\n"
	state, _, err := Classify(passwd, group, nil, false)
	if err != nil || state != Absent {
		t.Fatalf("absent state = %s, %v", state, err)
	}
	passwd = passwd + "atlas-manager:x:1001:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
	group = group + "atlas-manager:x:1001:\natlas-manager-power:x:1002:\n"
	state, _, err = Classify(passwd, group, nil, false)
	if err != nil || state != ExactUnmanaged {
		t.Fatalf("exact state = %s, %v", state, err)
	}
	managed := validState()
	state, _, err = Classify(passwd, group, &managed, false)
	if err != nil || state != ManagedPrepared {
		t.Fatalf("managed state = %s, %v", state, err)
	}
}

func TestClassifyJournalAndHelperMembersBlock(t *testing.T) {
	passwd := "atlas-manager:x:1001:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
	group := "atlas-manager:x:1001:\natlas-manager-power:x:1002:atlas-manager\n"
	state, _, err := Classify(passwd, group, nil, false)
	if err == nil || state != Conflicting {
		t.Fatalf("member state = %s, %v", state, err)
	}
	state, _, err = Classify("", "", nil, true)
	if err == nil || state != Interrupted {
		t.Fatalf("journal state = %s, %v", state, err)
	}
}

func TestStateRejectsDuplicateFieldsAndUnknownFields(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state.json")
	valid := `{"schemaVersion":1,"status":"prepared","runtimeUser":{"name":"atlas-manager","uid":1001},"primaryGroup":{"name":"atlas-manager","gid":1001},"helperGroup":{"name":"atlas-manager-power","gid":1002},"sourceCommit":"` + validCommit + `","bundleVersion":"0.1.0"}`
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"schemaVersion":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, exists, err := ReadState(path); !exists || err == nil {
		t.Fatal("duplicate state fields accepted")
	}
	if err := os.WriteFile(path, []byte(valid+" "+`{"extra":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, exists, err := ReadState(path); !exists || err == nil {
		t.Fatal("trailing state accepted")
	}
}
