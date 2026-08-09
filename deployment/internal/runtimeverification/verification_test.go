package runtimeverification

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
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
	dependencies.BaseURL = "http://127.0.0.1:3000"
	dependencies.AdministrativeHost = "admin.example.test"
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
		} else if request.URL.Path == "/admin/event-history" {
			if request.Host != "admin.example.test" {
				t.Fatalf("unexpected administrative authority: %s", request.Host)
			}
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

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
