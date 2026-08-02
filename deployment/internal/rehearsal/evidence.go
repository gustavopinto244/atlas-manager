package rehearsal

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

const (
	SchemaVersion = 1
	MaxEvidence   = 256 * 1024
)

type Step struct {
	Sequence               int    `json:"sequence"`
	Action                 string `json:"action"`
	ExpectedResult         string `json:"expectedResult"`
	ObservedResult         string `json:"observedResult"`
	ReportSHA256           string `json:"reportSha256"`
	MutationClassification string `json:"mutationClassification"`
}

type Release struct {
	Version             string `json:"version"`
	SourceCommit        string `json:"sourceCommit"`
	ArchiveSHA256       string `json:"archiveSha256"`
	RepeatedBuildSHA256 string `json:"repeatedBuildSha256"`
}

type Evidence struct {
	SchemaVersion   int      `json:"schemaVersion"`
	Result          string   `json:"result"`
	BaselineCommit  string   `json:"baselineCommit"`
	ReleaseA        Release  `json:"releaseA"`
	ReleaseB        Release  `json:"releaseB"`
	Steps           []Step   `json:"steps"`
	FinalState      string   `json:"finalState"`
	MutationSummary []string `json:"mutationSummary"`
	EvidenceChain   string   `json:"evidenceChain"`
}

type Entry struct {
	Path   string
	Type   string
	Mode   fs.FileMode
	Size   int64
	Hash   string
	Target string
}

func (e Evidence) Marshal() ([]byte, error) {
	if e.SchemaVersion != SchemaVersion || e.Result != "passed" || e.BaselineCommit == "" || e.FinalState != "managed_prepared" || len(e.Steps) == 0 || len(e.Steps) > 64 || len(e.MutationSummary) > 32 {
		return nil, fmt.Errorf("rehearsal_evidence_invalid")
	}
	for index, step := range e.Steps {
		if step.Sequence != index+1 || step.Action == "" || step.ExpectedResult == "" || step.ObservedResult == "" || step.MutationClassification == "" || len(step.ReportSHA256) != 64 || !isLowerHex(step.ReportSHA256) {
			return nil, fmt.Errorf("rehearsal_evidence_invalid")
		}
	}
	data, err := json.Marshal(e)
	if err != nil || len(data)+1 > MaxEvidence {
		return nil, fmt.Errorf("rehearsal_evidence_oversized")
	}
	return append(data, '\n'), nil
}

func ReportDigest(action, result, mutation string) string {
	data, _ := json.Marshal(struct {
		Action   string `json:"action"`
		Result   string `json:"result"`
		Mutation string `json:"mutationClassification"`
	}{action, result, mutation})
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func Chain(previous, reportDigest string) string {
	digest := sha256.Sum256([]byte(previous + reportDigest))
	return hex.EncodeToString(digest[:])
}

func Snapshot(root string) ([]Entry, error) {
	if err := validateRoot(root); err != nil {
		return nil, err
	}
	var entries []Entry
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil || relative == "." || filepath.IsAbs(relative) || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
			return fmt.Errorf("sandbox_escape")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		} else if entry.Type()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !entry.Type().IsRegular() {
			return fmt.Errorf("sandbox_object_invalid")
		}
		item := Entry{Path: filepath.ToSlash(relative), Type: kind, Mode: info.Mode().Perm(), Size: info.Size()}
		if kind == "file" {
			if stats, ok := info.Sys().(*syscall.Stat_t); ok && stats.Nlink > 1 {
				return fmt.Errorf("sandbox_hard_link")
			}
		}
		if kind == "symlink" {
			target, readErr := os.Readlink(path)
			if readErr != nil || !symlinkStaysInside(root, path, target) {
				return fmt.Errorf("sandbox_escape")
			}
			item.Target = target
		}
		if kind == "file" {
			digest, err := fileDigest(path)
			if err != nil {
				return err
			}
			item.Hash = digest
		}
		entries = append(entries, item)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Path < entries[right].Path })
	return entries, nil
}

func symlinkStaysInside(root, path, target string) bool {
	resolved := target
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(filepath.Dir(path), resolved)
	}
	relative, err := filepath.Rel(root, filepath.Clean(resolved))
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func Changed(before, after []Entry) []string {
	left := make(map[string]Entry, len(before))
	right := make(map[string]Entry, len(after))
	for _, entry := range before {
		left[entry.Path] = entry
	}
	for _, entry := range after {
		right[entry.Path] = entry
	}
	paths := make(map[string]struct{})
	for path := range left {
		paths[path] = struct{}{}
	}
	for path := range right {
		paths[path] = struct{}{}
	}
	changed := make([]string, 0)
	for path := range paths {
		if left[path] != right[path] {
			changed = append(changed, path)
		}
	}
	sort.Strings(changed)
	return changed
}

func AssertAllowed(changed []string, allowed []string) error {
	for _, path := range changed {
		matched := false
		for _, prefix := range allowed {
			if path == prefix || strings.HasPrefix(path, strings.TrimSuffix(prefix, "/")+"/") {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("mutation_outside_allowlist")
		}
	}
	return nil
}

func AssertAllowedEntries(changed []string, before, after []Entry, allowed []string) error {
	left := make(map[string]Entry, len(before))
	right := make(map[string]Entry, len(after))
	for _, entry := range before {
		left[entry.Path] = entry
	}
	for _, entry := range after {
		right[entry.Path] = entry
	}
	for _, path := range changed {
		if err := AssertAllowed([]string{path}, allowed); err == nil {
			continue
		}
		entry, exists := right[path]
		if !exists {
			entry, exists = left[path]
		}
		if !exists || entry.Type != "directory" {
			return fmt.Errorf("mutation_outside_allowlist")
		}
		parentAllowed := false
		for _, target := range allowed {
			if strings.HasPrefix(target, strings.TrimSuffix(path, "/")+"/") {
				parentAllowed = true
				break
			}
		}
		if !parentAllowed {
			return fmt.Errorf("mutation_outside_allowlist")
		}
	}
	return nil
}

func validateRoot(root string) error {
	if root == "" || !filepath.IsAbs(root) || filepath.Clean(root) == string(filepath.Separator) {
		return fmt.Errorf("sandbox_root_invalid")
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("sandbox_root_invalid")
	}
	return nil
}

func fileDigest(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func isLowerHex(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
