package protocol

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestValidCorpusAndDenyAllResponses(t *testing.T) {
	files, err := filepath.Glob("../../testdata/protocol/valid/*.json")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	if len(files) != 5 {
		t.Fatalf("expected five valid fixtures, got %d", len(files))
	}
	for _, fixture := range files {
		input := mustRead(t, fixture)
		request, err := ParseRequestLine(input)
		if err != nil {
			t.Fatalf("%s: %v", fixture, err)
		}
		encoded, err := MarshalResponse(RejectingResponse(request))
		if err != nil {
			t.Fatal(err)
		}
		want := mustRead(t, filepath.Join("../../testdata/protocol/responses", filepath.Base(fixture)))
		if string(encoded) != string(want) {
			t.Fatalf("%s: response is not canonical", fixture)
		}
	}
}

func TestInvalidCorpusRejects(t *testing.T) {
	files, err := filepath.Glob("../../testdata/protocol/invalid/*.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range files {
		if input := mustRead(t, fixture); len(input) > 0 {
			if _, err := ParseRequestLine(input); err == nil {
				t.Fatalf("%s: invalid fixture was accepted", fixture)
			}
		}
	}
}

func TestStrictBoundariesAndTimestampRules(t *testing.T) {
	valid := []byte("{\"version\":1,\"operation\":\"read_wake_alarm\",\"requestedAt\":\"2026-08-01T12:00:00.000Z\"}\n")
	for name, input := range map[string][]byte{
		"missing newline": valid[:len(valid)-1],
		"CRLF":            append(valid[:len(valid)-1], '\r', '\n'),
		"multiple lines":  append(append([]byte{}, valid...), valid...),
		"trailing data":   append(append([]byte{}, valid[:len(valid)-1]...), []byte("extra\n")...),
	} {
		if _, err := ParseRequestLine(input); err == nil {
			t.Fatalf("%s input was accepted", name)
		}
	}
	if _, err := ParseRequestLine(append(valid, make([]byte, MaxRequestBytes-len(valid)+1)...)); err == nil {
		t.Fatal("oversized request was accepted")
	}
	if _, err := ParseRequestLine([]byte("{\"version\":1,\"operation\":\"read_wake_alarm\",\"requestedAt\":\"2026-08-01T12:00:00.000Z\",\"requestedAt\":\"2026-08-01T12:01:00.000Z\"}\n")); err == nil {
		t.Fatal("duplicate field was accepted")
	}
	if !IsCanonicalTimestamp("2026-08-01T12:00:00.000Z") {
		t.Fatal("canonical timestamp was rejected")
	}
	for _, timestamp := range []string{
		"2026-08-01T12:00:00Z",
		"2026-08-01T12:00:00.000z",
		"2026-08-01T12:00:00.0000Z",
		" 2026-08-01T12:00:00.000Z",
	} {
		if IsCanonicalTimestamp(timestamp) {
			t.Fatalf("noncanonical timestamp accepted: %q", timestamp)
		}
	}
	encodedInvalidUTF8 := mustRead(t, "../../testdata/protocol/invalid/invalid-utf8.hex")
	invalidUTF8, err := hex.DecodeString(strings.TrimSpace(string(encodedInvalidUTF8)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseRequestLine(invalidUTF8); err == nil {
		t.Fatal("invalid UTF-8 was accepted")
	}
	if _, err := MarshalResponse(Response{
		Version: Version, Operation: Operation(string(ReadWakeAlarm) + string(make([]byte, MaxResponseBytes))), Outcome: "rejected", Code: "operation_unsupported",
	}); err == nil {
		t.Fatal("oversized response was accepted")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}
