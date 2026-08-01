package testfixture

import (
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

func TestDeterministicFixtureSupportsMutationLifecycle(t *testing.T) {
	operations := NewOperations()
	request := func(operation protocol.Operation, scheduledFor string) protocol.Request {
		return protocol.Request{Version: protocol.Version, Operation: operation, RequestedAt: "2026-08-01T12:00:00.000Z", ScheduledFor: scheduledFor}
	}
	assertOutcome := func(response protocol.Response, want string) {
		t.Helper()
		if response.Result == nil || response.Result.Mutation == nil || response.Result.Mutation.Outcome != want {
			t.Fatalf("unexpected response: %#v", response)
		}
	}

	t1 := "2026-08-02T09:00:00.000Z"
	t2 := "2026-08-02T10:00:00.000Z"
	assertOutcome(operations.ScheduleWakeAlarm(request(protocol.ScheduleWakeAlarm, t1)), "scheduled")
	assertOutcome(operations.ScheduleWakeAlarm(request(protocol.ScheduleWakeAlarm, t1)), "unchanged")
	assertOutcome(operations.ScheduleWakeAlarm(request(protocol.ScheduleWakeAlarm, t2)), "replaced")
	assertOutcome(operations.CancelWakeAlarm(request(protocol.CancelWakeAlarm, "")), "cancelled")
	assertOutcome(operations.CancelWakeAlarm(request(protocol.CancelWakeAlarm, "")), "not_scheduled")
}
