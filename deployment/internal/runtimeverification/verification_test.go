package runtimeverification

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestVerifyChecksHealthAndAdministrativeRouteAbsence(t *testing.T) {
	dependencies := NewDependencies()
	dependencies.BaseURL = "http://127.0.0.1:3000"
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := `{"status":"ok"}`
		if request.URL.Path == HealthLivePath {
			// The live health probe intentionally uses the default loopback Host.
		} else if request.URL.Path == HealthServerPath {
			body = `{"capturedAt":"2026-01-01T00:00:00.000Z","uptimeSeconds":1,"memory":{},"cpu":{},"cpuLoadAverage":[],"disk":{}}`
		}
		status := http.StatusOK
		if request.URL.Path != HealthLivePath && request.URL.Path != HealthServerPath {
			status = http.StatusNotFound
			body = "{}"
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	dependencies.CheckIdentity = func(int) error { return nil }
	if err := Verify(context.Background(), 123, dependencies); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRetriesTransientHealthConnectionFailure(t *testing.T) {
	dependencies := NewDependencies()
	attempts := 0
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == HealthLivePath && attempts < 2 {
			attempts++
			return nil, errors.New("connection refused")
		}
		body := `{"status":"ok"}`
		status := http.StatusOK
		if request.URL.Path == HealthServerPath {
			body = `{"capturedAt":"2026-01-01T00:00:00.000Z","uptimeSeconds":1,"memory":{},"cpu":{},"cpuLoadAverage":[],"disk":{}}`
		} else if request.URL.Path != HealthLivePath {
			status = http.StatusNotFound
			body = `{}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	dependencies.CheckIdentity = func(int) error { return nil }
	if err := Verify(context.Background(), 123, dependencies); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 {
		t.Fatalf("expected two transient retries, got %d", attempts)
	}
}

func TestVerifyDoesNotRetryInvalidHealthResponse(t *testing.T) {
	dependencies := NewDependencies()
	attempts := 0
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		attempts++
		return &http.Response{StatusCode: http.StatusInternalServerError, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"status":"ok"}`)), Request: request}, nil
	})}
	if err := Verify(context.Background(), 123, dependencies); err == nil {
		t.Fatal("invalid health response accepted")
	}
	if attempts != 1 {
		t.Fatalf("expected no retry for HTTP failure, got %d attempts", attempts)
	}
}

func TestVerifyStopsRetryingWhenContextIsCancelled(t *testing.T) {
	dependencies := NewDependencies()
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := verifyHealth(ctx, dependencies.HTTPClient, dependencies.BaseURL, HealthLivePath, true); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

func TestVerifyRejectsRedirectedHealth(t *testing.T) {
	dependencies := NewDependencies()
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusTemporaryRedirect, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
	})}
	if err := Verify(context.Background(), 123, dependencies); err == nil {
		t.Fatal("redirected health accepted")
	}
}

func TestVerifyAdministrativeUsesLoopbackURLAndConfiguredHost(t *testing.T) {
	dependencies := NewDependencies()
	dependencies.Now = func() time.Time { return time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC) }
	dependencies.BaseURL = "http://127.0.0.1:3000"
	dependencies.AdministrativeHost = "admin.example.test"
	dependencies.AdministrativeWakeAlarmEnabled = true
	dependencies.AdministrativeShutdownEnabled = true
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "127.0.0.1:3000" {
			t.Fatalf("unexpected physical destination: %s", request.URL.Host)
		}
		body := `{"status":"ok"}`
		status := http.StatusOK
		if request.URL.Path == HealthLivePath {
			// The live health probe intentionally uses the default loopback Host.
		} else if request.URL.Path == HealthServerPath {
			// The server health probe also intentionally uses the loopback Host.
			body = `{"capturedAt":"2026-01-01T00:00:00.000Z","uptimeSeconds":1,"memory":{},"cpu":{},"cpuLoadAverage":[],"disk":{}}`
		} else if request.URL.Path == "/admin/event-history" || strings.HasPrefix(request.URL.Path, "/admin/power/") {
			if request.Host != "admin.example.test" {
				t.Fatalf("unexpected administrative authority: %s", request.Host)
			}
			assertAdministrativeProbeRequest(t, request)
			status = http.StatusUnauthorized
			body = `{"error":{"code":"administrative_authentication_required"}}`
		} else {
			if request.Host != "admin.example.test" {
				t.Fatalf("unexpected administrative authority: %s", request.Host)
			}
			status = http.StatusNotFound
			body = `{}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	dependencies.CheckIdentity = func(int) error { return nil }
	if err := VerifyAdministrative(context.Background(), 123, dependencies); err != nil {
		t.Fatal(err)
	}
}

func assertAdministrativeProbeRequest(t *testing.T, request *http.Request) {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		t.Fatal(err)
	}
	expected := ""
	switch {
	case request.Method == http.MethodPut && request.URL.Path == "/admin/power/wake-alarm":
		expected = `{"scheduledFor":"2026-08-09T13:00:00.000Z"}`
	case request.Method == http.MethodPost && request.URL.Path == "/admin/power/shutdown/preparations":
		expected = `{"operation":"shutdown","scheduledFor":"2026-08-09T13:00:00.000Z","wakeScheduledFor":"2026-08-09T14:00:00.000Z","confirmation":"confirm_shutdown_preparation"}`
	case request.Method == http.MethodPost && request.URL.Path == "/admin/power/shutdown/executions":
		expected = `{"operation":"shutdown","scheduledFor":"2026-08-09T13:00:00.000Z","wakeScheduledFor":"2026-08-09T14:00:00.000Z","confirmation":"confirm_shutdown_execution"}`
	}
	if string(body) != expected {
		t.Fatalf("unexpected %s %s probe body: %q", request.Method, request.URL.Path, string(body))
	}
	if expected != "" && request.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("missing JSON content type for %s %s", request.Method, request.URL.Path)
	}
	if expected == "" && request.Header.Get("Content-Type") != "" {
		t.Fatalf("unexpected content type for bodyless %s %s", request.Method, request.URL.Path)
	}
}

func TestVerifyAdministrativeRejectsAnEnabledPowerRouteThatIsAbsent(t *testing.T) {
	dependencies := NewDependencies()
	dependencies.AdministrativeHost = "admin.example.test"
	dependencies.AdministrativeWakeAlarmEnabled = true
	dependencies.HTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, status := `{"status":"ok"}`, http.StatusOK
		switch request.URL.Path {
		case HealthServerPath:
			body = `{"capturedAt":"2026-01-01T00:00:00.000Z","uptimeSeconds":1,"memory":{},"cpu":{},"cpuLoadAverage":[],"disk":{}}`
		case "/admin/event-history":
			status, body = http.StatusUnauthorized, `{"error":{"code":"administrative_authentication_required"}}`
		case "/admin/power/wake-alarm":
			status, body = http.StatusNotFound, `{}`
		default:
			status, body = http.StatusNotFound, `{}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	dependencies.CheckIdentity = func(int) error { return nil }
	if err := VerifyAdministrative(context.Background(), 123, dependencies); err == nil {
		t.Fatal("enabled wake-alarm routes were accepted while absent")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
