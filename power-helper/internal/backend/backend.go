package backend

import (
	"context"
	"errors"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/lock"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/shutdown"
)

// Operations expose only the fixed version-one helper operations.
type Operations interface {
	ReadRTCInformation(protocol.Request) protocol.Response
	ReadWakeAlarm(protocol.Request) protocol.Response
	ScheduleWakeAlarm(protocol.Request) protocol.Response
	CancelWakeAlarm(protocol.Request) protocol.Response
	RequestShutdown(protocol.Request) protocol.Response
}

type DenyAll struct{}

func (DenyAll) ReadRTCInformation(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) ReadWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) CancelWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) RequestShutdown(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

type ReadOnly struct {
	reader RTCReader
}

type RTCReader interface {
	ReadRTCInformation() (rtc.Information, error)
	ReadWakeAlarm() (rtc.WakeAlarm, error)
}

type RTCMutator interface {
	Schedule(string) (rtc.Mutation, error)
	Cancel() (rtc.Mutation, error)
}

type MachineShutdownRequester interface {
	RequestPowerOff(context.Context) error
}

type LinuxOperations struct {
	reader            RTCReader
	mutator           RTCMutator
	shutdownRequester MachineShutdownRequester
	lock              lock.OperationLock
}

func NewLinuxOperations(reader RTCReader, mutator RTCMutator, shutdownRequester MachineShutdownRequester, operationLock lock.OperationLock) LinuxOperations {
	return LinuxOperations{reader: reader, mutator: mutator, shutdownRequester: shutdownRequester, lock: operationLock}
}

func (operations LinuxOperations) ReadRTCInformation(request protocol.Request) protocol.Response {
	release, err := operations.lock.AcquireShared()
	if err != nil {
		return operationRejected(request)
	}
	defer release()
	return readRTCInformationResponse(operations.reader, request)
}

func (operations LinuxOperations) ReadWakeAlarm(request protocol.Request) protocol.Response {
	release, err := operations.lock.AcquireShared()
	if err != nil {
		return operationRejected(request)
	}
	defer release()
	return readWakeAlarmResponse(operations.reader, request)
}

func (operations LinuxOperations) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	release, err := operations.lock.AcquireExclusive()
	if err != nil {
		return operationRejected(request)
	}
	defer release()
	mutation, err := operations.mutator.Schedule(request.ScheduledFor)
	if err != nil {
		return mutationFailure(request, err)
	}
	return scheduleMutationResponse(request, mutation)
}

func (operations LinuxOperations) CancelWakeAlarm(request protocol.Request) protocol.Response {
	release, err := operations.lock.AcquireExclusive()
	if err != nil {
		return operationRejected(request)
	}
	defer release()
	mutation, err := operations.mutator.Cancel()
	if err != nil {
		return mutationFailure(request, err)
	}
	return cancelMutationResponse(request, mutation)
}

func (operations LinuxOperations) RequestShutdown(request protocol.Request) protocol.Response {
	release, err := operations.lock.AcquireExclusive()
	if err != nil {
		return operationRejected(request)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), shutdown.DBusDeadline)
	defer cancel()
	if err := operations.shutdownRequester.RequestPowerOff(ctx); err != nil {
		return shutdownFailure(request, err)
	}
	response, err := protocol.NewRequestShutdownSuccess()
	if err != nil {
		return operationFailed(request)
	}
	return response
}

func NewReadOnly(reader RTCReader) ReadOnly {
	return ReadOnly{reader: reader}
}

func (operations ReadOnly) ReadRTCInformation(request protocol.Request) protocol.Response {
	return readRTCInformationResponse(operations.reader, request)
}

func readRTCInformationResponse(reader RTCReader, request protocol.Request) protocol.Response {
	information, err := reader.ReadRTCInformation()
	if err != nil {
		return readFailure(request, err)
	}
	wakeAlarm, err := protocol.NewWakeAlarmResult(information.WakeAlarm.State, information.WakeAlarm.ScheduledFor)
	if err != nil {
		return stateUnavailable(request)
	}
	response, err := protocol.NewReadRTCInformationSuccess(information.RTCTime, wakeAlarm)
	if err != nil {
		return stateUnavailable(request)
	}
	return response
}

func (operations ReadOnly) ReadWakeAlarm(request protocol.Request) protocol.Response {
	return readWakeAlarmResponse(operations.reader, request)
}

func readWakeAlarmResponse(reader RTCReader, request protocol.Request) protocol.Response {
	wakeAlarm, err := reader.ReadWakeAlarm()
	if err != nil {
		return readFailure(request, err)
	}
	result, err := protocol.NewWakeAlarmResult(wakeAlarm.State, wakeAlarm.ScheduledFor)
	if err != nil {
		return stateUnavailable(request)
	}
	response, err := protocol.NewReadWakeAlarmSuccess(result)
	if err != nil {
		return stateUnavailable(request)
	}
	return response
}

func (ReadOnly) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (ReadOnly) CancelWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (ReadOnly) RequestShutdown(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func readFailure(request protocol.Request, err error) protocol.Response {
	if errors.Is(err, rtc.ErrUnsupported) {
		return protocol.RejectingResponse(request)
	}
	return stateUnavailable(request)
}

func stateUnavailable(request protocol.Request) protocol.Response {
	response, err := protocol.NewFailureResponse(request.Operation, "failed", "state_unavailable")
	if err != nil {
		return protocol.Response{}
	}
	return response
}

func operationRejected(request protocol.Request) protocol.Response {
	response, err := protocol.NewFailureResponse(request.Operation, "rejected", "operation_rejected")
	if err != nil {
		return protocol.Response{}
	}
	return response
}

func mutationFailure(request protocol.Request, err error) protocol.Response {
	if errors.Is(err, rtc.ErrUnsupported) {
		return protocol.RejectingResponse(request)
	}
	if errors.Is(err, rtc.ErrOperationRejected) {
		return operationRejected(request)
	}
	if errors.Is(err, rtc.ErrStateUnavailable) {
		return stateUnavailable(request)
	}
	response, responseErr := protocol.NewFailureResponse(request.Operation, "failed", "operation_failed")
	if responseErr != nil {
		return protocol.Response{}
	}
	return response
}

func scheduleMutationResponse(request protocol.Request, mutation rtc.Mutation) protocol.Response {
	before, after, err := mutationProtocolStates(mutation)
	if err != nil {
		return operationFailed(request)
	}
	response, err := protocol.NewScheduleWakeAlarmSuccess(before, after, mutation.Outcome)
	if err != nil {
		return operationFailed(request)
	}
	return response
}

func cancelMutationResponse(request protocol.Request, mutation rtc.Mutation) protocol.Response {
	before, after, err := mutationProtocolStates(mutation)
	if err != nil {
		return operationFailed(request)
	}
	response, err := protocol.NewCancelWakeAlarmSuccess(before, after, mutation.Outcome)
	if err != nil {
		return operationFailed(request)
	}
	return response
}

func mutationProtocolStates(mutation rtc.Mutation) (protocol.WakeAlarmResult, protocol.WakeAlarmResult, error) {
	before, err := protocol.NewWakeAlarmResult(mutation.Before.State, mutation.Before.ScheduledFor)
	if err != nil {
		return protocol.WakeAlarmResult{}, protocol.WakeAlarmResult{}, err
	}
	after, err := protocol.NewWakeAlarmResult(mutation.After.State, mutation.After.ScheduledFor)
	if err != nil {
		return protocol.WakeAlarmResult{}, protocol.WakeAlarmResult{}, err
	}
	return before, after, nil
}

func operationFailed(request protocol.Request) protocol.Response {
	response, err := protocol.NewFailureResponse(request.Operation, "failed", "operation_failed")
	if err != nil {
		return protocol.Response{}
	}
	return response
}

func shutdownFailure(request protocol.Request, err error) protocol.Response {
	if errors.Is(err, shutdown.ErrShutdownUnsupported) {
		return protocol.RejectingResponse(request)
	}
	if errors.Is(err, shutdown.ErrShutdownRejected) {
		return operationRejected(request)
	}
	return operationFailed(request)
}

func Dispatch(operations Operations, request protocol.Request) protocol.Response {
	switch request.Operation {
	case protocol.ReadRTCInformation:
		return operations.ReadRTCInformation(request)
	case protocol.ReadWakeAlarm:
		return operations.ReadWakeAlarm(request)
	case protocol.ScheduleWakeAlarm:
		return operations.ScheduleWakeAlarm(request)
	case protocol.CancelWakeAlarm:
		return operations.CancelWakeAlarm(request)
	case protocol.RequestShutdown:
		return operations.RequestShutdown(request)
	default:
		return protocol.RejectingResponse(request)
	}
}
