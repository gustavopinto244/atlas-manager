package runtimeverification

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const (
	LoopbackURL      = "http://127.0.0.1:3000"
	MaxResponseBytes = 1 << 20
	RequestTimeout   = 5 * time.Second
	MaxHeaderBytes   = 16 * 1024
	HealthLivePath   = "/health/live"
	HealthServerPath = "/health/server"
)

type administrativeRoute struct {
	method string
	path   string
}

var administrativeRoutes = []administrativeRoute{
	{http.MethodGet, "/admin/event-history"},
	{http.MethodGet, "/admin/power/wake-alarm"},
	{http.MethodPut, "/admin/power/wake-alarm"},
	{http.MethodDelete, "/admin/power/wake-alarm"},
	{http.MethodPost, "/admin/power/shutdown/preparations"},
	{http.MethodPost, "/admin/power/shutdown/executions"},
}

type Dependencies struct {
	BaseURL                        string
	AdministrativeHost             string
	AdministrativeWakeAlarmEnabled bool
	AdministrativeShutdownEnabled  bool
	HTTPClient                     *http.Client
	CheckIdentity                  func(int) error
	Process                        func(int) (runtimeidentity.Process, error)
	PasswdPath                     string
	GroupPath                      string
	Now                            func() time.Time
}

func NewDependencies() Dependencies {
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: RequestTimeout}).DialContext, MaxResponseHeaderBytes: MaxHeaderBytes}
	return Dependencies{BaseURL: LoopbackURL, HTTPClient: &http.Client{Transport: transport, Timeout: RequestTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, Process: readProcessStatus, PasswdPath: "/etc/passwd", GroupPath: "/etc/group", Now: time.Now}
}

func Verify(ctx context.Context, pid int, dependencies Dependencies) error {
	if dependencies.BaseURL == "" {
		dependencies.BaseURL = LoopbackURL
	}
	if dependencies.HTTPClient == nil {
		dependencies.HTTPClient = NewDependencies().HTTPClient
	}
	if err := verifyHealth(ctx, dependencies.HTTPClient, dependencies.BaseURL, HealthLivePath, true); err != nil {
		return fmt.Errorf("service_health_failed")
	}
	if err := verifyHealth(ctx, dependencies.HTTPClient, dependencies.BaseURL, HealthServerPath, false); err != nil {
		return fmt.Errorf("service_health_failed")
	}
	for _, route := range administrativeRoutes {
		if err := verifyAbsent(ctx, dependencies.HTTPClient, dependencies.BaseURL, route.method, route.path); err != nil {
			return fmt.Errorf("administrative_route_exposed")
		}
	}
	if dependencies.CheckIdentity != nil {
		if err := dependencies.CheckIdentity(pid); err != nil {
			return fmt.Errorf("runtime_identity_invalid")
		}
	} else if dependencies.Process != nil {
		if err := verifyProcessIdentity(pid, dependencies); err != nil {
			return fmt.Errorf("runtime_identity_invalid")
		}
	}
	return nil
}

// VerifyAdministrative validates the administrative profile while preserving
// loopback as the physical destination and using the configured public origin
// only as the HTTP Host authority.
func VerifyAdministrative(ctx context.Context, pid int, dependencies Dependencies) error {
	if dependencies.BaseURL == "" {
		dependencies.BaseURL = LoopbackURL
	}
	if dependencies.HTTPClient == nil {
		dependencies.HTTPClient = NewDependencies().HTTPClient
	}
	if dependencies.AdministrativeHost == "" {
		return fmt.Errorf("administrative_host_missing")
	}
	if dependencies.Now == nil {
		dependencies.Now = time.Now
	}
	if err := verifyHealth(ctx, dependencies.HTTPClient, dependencies.BaseURL, HealthLivePath, true); err != nil {
		return fmt.Errorf("service_health_failed")
	}
	if err := verifyHealth(ctx, dependencies.HTTPClient, dependencies.BaseURL, HealthServerPath, false); err != nil {
		return fmt.Errorf("service_health_failed")
	}
	if err := verifyProtected(ctx, dependencies.HTTPClient, dependencies.BaseURL, dependencies.AdministrativeHost, http.MethodGet, "/admin/event-history"); err != nil {
		return fmt.Errorf("administrative_route_policy_invalid")
	}
	for _, route := range administrativeRoutes[1:] {
		enabled := (strings.HasPrefix(route.path, "/admin/power/wake-alarm") && dependencies.AdministrativeWakeAlarmEnabled) || (strings.HasPrefix(route.path, "/admin/power/shutdown/") && dependencies.AdministrativeShutdownEnabled)
		if err := verifyAdministrativeRoute(ctx, dependencies.HTTPClient, dependencies.BaseURL, dependencies.AdministrativeHost, route, enabled, dependencies.Now()); err != nil {
			return fmt.Errorf("administrative_route_policy_invalid")
		}
	}
	if err := verifyIdentity(pid, dependencies); err != nil {
		return fmt.Errorf("runtime_identity_invalid")
	}
	return nil
}

func verifyAdministrativeRoute(ctx context.Context, client *http.Client, baseURL, host string, route administrativeRoute, enabled bool, now time.Time) error {
	if enabled {
		body := administrativeProbeBody(route, now)
		return verifyProtectedWithBody(ctx, client, baseURL, host, route.method, route.path, body)
	}
	return verifyAbsentWithHost(ctx, client, baseURL, host, route.method, route.path)
}

func administrativeProbeBody(route administrativeRoute, now time.Time) []byte {
	canonical := func(value time.Time) string {
		return value.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	scheduledFor := canonical(now.Add(time.Hour))
	wakeScheduledFor := canonical(now.Add(2 * time.Hour))
	switch {
	case route.method == http.MethodPut && route.path == "/admin/power/wake-alarm":
		return []byte(fmt.Sprintf(`{"scheduledFor":%q}`, scheduledFor))
	case route.method == http.MethodPost && route.path == "/admin/power/shutdown/preparations":
		return []byte(fmt.Sprintf(`{"operation":"shutdown","scheduledFor":%q,"wakeScheduledFor":%q,"confirmation":"confirm_shutdown_preparation"}`, scheduledFor, wakeScheduledFor))
	case route.method == http.MethodPost && route.path == "/admin/power/shutdown/executions":
		return []byte(fmt.Sprintf(`{"operation":"shutdown","scheduledFor":%q,"wakeScheduledFor":%q,"confirmation":"confirm_shutdown_execution"}`, scheduledFor, wakeScheduledFor))
	default:
		return nil
	}
}

func verifyHealth(ctx context.Context, client *http.Client, baseURL, path string, live bool) error {
	var last error
	for attempt := 0; attempt < 20; attempt++ {
		last = verifyHealthOnce(ctx, client, baseURL, path, live)
		if last == nil {
			return nil
		}
		if !isRetryableHealthFailure(last) {
			return last
		}
		if attempt == 19 {
			break
		}
		timer := time.NewTimer(250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return last
}

func isRetryableHealthFailure(err error) bool {
	if err == nil || !strings.HasPrefix(err.Error(), "health_request_failed:") {
		return false
	}
	if errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EHOSTUNREACH) || errors.Is(err, syscall.ENETUNREACH) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection refused") || strings.Contains(message, "connection reset") || strings.Contains(message, "network is unreachable") || strings.Contains(message, "no route to host")
}

func verifyHealthOnce(ctx context.Context, client *http.Client, baseURL, path string, live bool) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("health_request_failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		return fmt.Errorf("health_response_invalid")
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if err != nil || len(responseBody) > MaxResponseBytes {
		return fmt.Errorf("health_response_invalid")
	}
	var value map[string]any
	if json.Unmarshal(responseBody, &value) != nil || value == nil {
		return fmt.Errorf("health_response_invalid")
	}
	if live {
		if len(value) != 1 || value["status"] != "ok" {
			return fmt.Errorf("health_live_invalid")
		}
		return nil
	}
	required := []string{"capturedAt", "uptimeSeconds", "memory", "cpu", "cpuLoadAverage", "disk"}
	for _, key := range required {
		if _, ok := value[key]; !ok {
			return fmt.Errorf("health_server_invalid")
		}
	}
	return nil
}

func verifyAbsent(ctx context.Context, client *http.Client, baseURL, method, path string) error {
	return verifyAbsentWithHost(ctx, client, baseURL, "", method, path)
}

func verifyAbsentWithHost(ctx context.Context, client *http.Client, baseURL, host, method, path string) error {
	request, err := http.NewRequestWithContext(ctx, method, baseURL+path, nil)
	if err != nil {
		return err
	}
	if host != "" {
		request.Host = host
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		return fmt.Errorf("route_present")
	}
	return nil
}

func verifyProtected(ctx context.Context, client *http.Client, baseURL, host, method, path string) error {
	return verifyProtectedWithBody(ctx, client, baseURL, host, method, path, nil)
}

func verifyProtectedWithBody(ctx context.Context, client *http.Client, baseURL, host, method, path string, body []byte) error {
	request, err := http.NewRequestWithContext(ctx, method, baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Host = host
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if err != nil || len(responseBody) > MaxResponseBytes {
		return fmt.Errorf("administrative_protection_invalid")
	}
	if response.StatusCode != http.StatusUnauthorized && response.StatusCode != http.StatusForbidden {
		return fmt.Errorf("administrative_protection_invalid")
	}
	var value struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(responseBody, &value) != nil || (value.Error.Code != "administrative_authentication_required" && value.Error.Code != "administrative_authorization_denied") {
		return fmt.Errorf("administrative_protection_invalid")
	}
	return nil
}

func verifyIdentity(pid int, dependencies Dependencies) error {
	if dependencies.CheckIdentity != nil {
		return dependencies.CheckIdentity(pid)
	}
	if dependencies.Process != nil {
		return verifyProcessIdentity(pid, dependencies)
	}
	return nil
}

func verifyProcessIdentity(pid int, dependencies Dependencies) error {
	if pid <= 0 || dependencies.PasswdPath == "" || dependencies.GroupPath == "" {
		return fmt.Errorf("runtime_identity_invalid")
	}
	passwd, err := os.ReadFile(dependencies.PasswdPath)
	if err != nil {
		return err
	}
	group, err := os.ReadFile(dependencies.GroupPath)
	if err != nil {
		return err
	}
	process, err := dependencies.Process(pid)
	if err != nil {
		return err
	}
	_, err = runtimeidentity.ValidateMock(string(passwd), string(group), process)
	return err
}

func readProcessStatus(pid int) (runtimeidentity.Process, error) {
	file, err := os.Open("/proc/" + strconv.Itoa(pid) + "/status")
	if err != nil {
		return runtimeidentity.Process{}, err
	}
	defer file.Close()
	var process runtimeidentity.Process
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "Uid:":
			if len(fields) < 3 {
				return runtimeidentity.Process{}, fmt.Errorf("process_status_invalid")
			}
			process.UID, err = strconv.Atoi(fields[1])
			if err != nil {
				return runtimeidentity.Process{}, err
			}
			process.EUID, err = strconv.Atoi(fields[2])
			if err != nil {
				return runtimeidentity.Process{}, err
			}
		case "Gid:":
			if len(fields) < 3 {
				return runtimeidentity.Process{}, fmt.Errorf("process_status_invalid")
			}
			process.GID, err = strconv.Atoi(fields[1])
			if err != nil {
				return runtimeidentity.Process{}, err
			}
			process.EGID, err = strconv.Atoi(fields[2])
			if err != nil {
				return runtimeidentity.Process{}, err
			}
		case "Groups:":
			for _, value := range fields[1:] {
				group, parseErr := strconv.Atoi(value)
				if parseErr != nil {
					return runtimeidentity.Process{}, parseErr
				}
				process.Groups = append(process.Groups, group)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return runtimeidentity.Process{}, err
	}
	return process, nil
}
