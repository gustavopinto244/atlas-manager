package runtimeverification

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
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
	BaseURL            string
	AdministrativeHost string
	HTTPClient         *http.Client
	CheckIdentity      func(int) error
	Process            func(int) (runtimeidentity.Process, error)
	PasswdPath         string
	GroupPath          string
}

func NewDependencies() Dependencies {
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: RequestTimeout}).DialContext, MaxResponseHeaderBytes: MaxHeaderBytes}
	return Dependencies{BaseURL: LoopbackURL, HTTPClient: &http.Client{Transport: transport, Timeout: RequestTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, Process: readProcessStatus, PasswdPath: "/etc/passwd", GroupPath: "/etc/group"}
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
		if err := verifyAbsentWithHost(ctx, dependencies.HTTPClient, dependencies.BaseURL, dependencies.AdministrativeHost, route.method, route.path); err != nil {
			return fmt.Errorf("administrative_route_policy_invalid")
		}
	}
	if err := verifyIdentity(pid, dependencies); err != nil {
		return fmt.Errorf("runtime_identity_invalid")
	}
	return nil
}

func verifyHealth(ctx context.Context, client *http.Client, baseURL, path string, live bool) error {
	var last error
	for attempt := 0; attempt < 20; attempt++ {
		last = verifyHealthOnce(ctx, client, baseURL, path, live)
		if last == nil {
			return nil
		}
		if !strings.HasPrefix(last.Error(), "health_request_failed:") {
			return last
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
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if err != nil || len(body) > MaxResponseBytes {
		return fmt.Errorf("health_response_invalid")
	}
	var value map[string]any
	if json.Unmarshal(body, &value) != nil || value == nil {
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
	request, err := http.NewRequestWithContext(ctx, method, baseURL+path, nil)
	if err != nil {
		return err
	}
	request.Host = host
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if err != nil || len(body) > MaxResponseBytes {
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
	if json.Unmarshal(body, &value) != nil || (value.Error.Code != "administrative_authentication_required" && value.Error.Code != "administrative_authorization_denied") {
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
	_, err = runtimeidentity.Validate(string(passwd), string(group), process)
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
