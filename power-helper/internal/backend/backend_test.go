package backend

import (
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

func TestDenyAllBackendRejectsEveryValidOperation(t *testing.T) {
	backend := DenyAll{}
	for _, operation := range []protocol.Operation{
		protocol.ReadRTCInformation,
		protocol.ReadWakeAlarm,
		protocol.ScheduleWakeAlarm,
		protocol.CancelWakeAlarm,
		protocol.RequestShutdown,
	} {
		request := protocol.Request{
			Version:      protocol.Version,
			Operation:    operation,
			RequestedAt:  "2026-08-01T12:00:00.000Z",
			ScheduledFor: "2026-08-02T09:00:00.000Z",
		}
		response := Dispatch(backend, request)
		if response != protocol.RejectingResponse(request) {
			t.Fatalf("unexpected response for %s: %#v", operation, response)
		}
	}
}
