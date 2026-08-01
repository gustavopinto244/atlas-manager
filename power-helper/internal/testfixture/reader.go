package testfixture

import "github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"

// Reader is a deterministic compatibility fixture. It is imported only by the
// separately named fixture executable and never by the production command.
type Reader struct{}

func (Reader) ReadRTCInformation() (rtc.Information, error) {
	return rtc.Information{
		RTCTime: "2026-08-01T18:00:00.000Z",
		WakeAlarm: rtc.WakeAlarm{
			State:        "scheduled",
			ScheduledFor: "2026-08-02T09:00:00.000Z",
		},
	}, nil
}

func (Reader) ReadWakeAlarm() (rtc.WakeAlarm, error) {
	return rtc.WakeAlarm{State: "scheduled", ScheduledFor: "2026-08-02T09:00:00.000Z"}, nil
}
