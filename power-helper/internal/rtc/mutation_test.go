package rtc

import (
	"bytes"
	"errors"
	"strconv"
	"testing"
	"time"
)

type mutationFileSystem struct {
	since       []byte
	wake        []byte
	writes      [][]byte
	writeErr    error
	keepState   bool
	readWakeErr error
}

func (filesystem *mutationFileSystem) CheckSysfs() error { return nil }

func (filesystem *mutationFileSystem) ReadSinceEpoch() ([]byte, error) {
	return filesystem.since, nil
}

func (filesystem *mutationFileSystem) ReadWakeAlarm() ([]byte, error) {
	if filesystem.readWakeErr != nil {
		return nil, filesystem.readWakeErr
	}
	return filesystem.wake, nil
}

func (filesystem *mutationFileSystem) WriteWakeAlarm(payload []byte) error {
	filesystem.writes = append(filesystem.writes, append([]byte(nil), payload...))
	if filesystem.writeErr != nil {
		return filesystem.writeErr
	}
	if filesystem.keepState {
		return nil
	}
	if bytes.Equal(payload, []byte("0\n")) {
		filesystem.wake = []byte("\n")
		return nil
	}
	filesystem.wake = append([]byte(nil), payload...)
	return nil
}

type mutationClock struct{}

func (mutationClock) Now() time.Time {
	return time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
}

func mutationFilesystem(wake string) *mutationFileSystem {
	rtcEpoch := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC).Unix()
	return &mutationFileSystem{
		since: []byte(strconv.FormatInt(rtcEpoch, 10) + "\n"),
		wake:  []byte(wake),
	}
}

func TestScheduleFromAbsentAlarmWritesOneAbsolutePayload(t *testing.T) {
	filesystem := mutationFilesystem("\n")
	mutation, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-02T09:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Outcome != "scheduled" || mutation.Before.State != "not_scheduled" || mutation.After.ScheduledFor != "2026-08-02T09:00:00.000Z" {
		t.Fatalf("unexpected mutation: %#v", mutation)
	}
	if len(filesystem.writes) != 1 || string(filesystem.writes[0]) != "1785661200\n" {
		t.Fatalf("unexpected writes: %q", filesystem.writes)
	}
}

func TestScheduleSameAlarmDoesNotWrite(t *testing.T) {
	filesystem := mutationFilesystem("1785661200\n")
	mutation, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-02T09:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Outcome != "unchanged" || len(filesystem.writes) != 0 {
		t.Fatalf("unexpected unchanged mutation: %#v, writes=%q", mutation, filesystem.writes)
	}
}

func TestScheduleReplacementCancelsThenSchedules(t *testing.T) {
	filesystem := mutationFilesystem("1785565200\n")
	mutation, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-02T09:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Outcome != "replaced" || len(filesystem.writes) != 2 {
		t.Fatalf("unexpected replacement: %#v, writes=%q", mutation, filesystem.writes)
	}
	if string(filesystem.writes[0]) != "0\n" || string(filesystem.writes[1]) != "1785661200\n" {
		t.Fatalf("replacement ordering mismatch: %q", filesystem.writes)
	}
}

func TestCancelIsIdempotentAndUsesExactPayload(t *testing.T) {
	filesystem := mutationFilesystem("1785661200\n")
	mutation, err := NewMutator(filesystem, mutationClock{}).Cancel()
	if err != nil || mutation.Outcome != "cancelled" || len(filesystem.writes) != 1 || string(filesystem.writes[0]) != "0\n" {
		t.Fatalf("unexpected cancellation: %#v, %q, %v", mutation, filesystem.writes, err)
	}

	filesystem = mutationFilesystem("\n")
	mutation, err = NewMutator(filesystem, mutationClock{}).Cancel()
	if err != nil || mutation.Outcome != "not_scheduled" || len(filesystem.writes) != 0 {
		t.Fatalf("unexpected absent cancellation: %#v, %q, %v", mutation, filesystem.writes, err)
	}
}

func TestMutationRejectsNonfutureTargetBeforeWrite(t *testing.T) {
	filesystem := mutationFilesystem("\n")
	_, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-01T12:00:00.000Z")
	if !errors.Is(err, ErrOperationRejected) || len(filesystem.writes) != 0 {
		t.Fatalf("unexpected nonfuture result: %v, writes=%q", err, filesystem.writes)
	}
}

func TestReplacementFailurePreservesPartialStateWithoutRetry(t *testing.T) {
	filesystem := mutationFilesystem("1785565200\n")
	filesystem.keepState = true
	_, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-02T09:00:00.000Z")
	if !errors.Is(err, ErrOperationFailed) || len(filesystem.writes) != 1 {
		t.Fatalf("unexpected replacement failure: %v, writes=%q", err, filesystem.writes)
	}
}

func TestWriteFailureDoesNotRetry(t *testing.T) {
	filesystem := mutationFilesystem("\n")
	filesystem.writeErr = errors.New("write failed")
	_, err := NewMutator(filesystem, mutationClock{}).Schedule("2026-08-02T09:00:00.000Z")
	if !errors.Is(err, ErrOperationFailed) || len(filesystem.writes) != 1 {
		t.Fatalf("unexpected write failure: %v, writes=%q", err, filesystem.writes)
	}
}
