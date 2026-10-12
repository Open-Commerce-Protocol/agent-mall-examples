package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func do(t *testing.T, srv *httptest.Server, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req, err := http.NewRequest(method, srv.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("content-type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&parsed)
	return resp.StatusCode, parsed
}

func hasKeys(t *testing.T, body map[string]any, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := body[k]; !ok {
			t.Errorf("missing required key %q", k)
		}
	}
}

func TestConformance(t *testing.T) {
	srv := httptest.NewServer(NewMux())
	defer srv.Close()

	t.Run("manifest", func(t *testing.T) {
		status, body := do(t, srv, "GET", "/ocp/manifest", "")
		if status != 200 {
			t.Fatalf("status = %d", status)
		}
		hasKeys(t, body, "ocp_version", "kind", "id", "catalog_id", "catalog_name", "endpoints", "query_capabilities", "object_contracts")
		if caps, ok := body["query_capabilities"].([]any); !ok || len(caps) == 0 {
			t.Error("query_capabilities must be non-empty")
		}
	})

	t.Run("health", func(t *testing.T) {
		status, body := do(t, srv, "GET", "/ocp/health", "")
		if status != 200 {
			t.Fatalf("status = %d", status)
		}
		hasKeys(t, body, "ocp_version", "kind", "catalog_id", "status", "ready", "checked_at")
		if body["ready"] != true {
			t.Error("ready must be true")
		}
	})

	t.Run("discovery", func(t *testing.T) {
		status, body := do(t, srv, "GET", "/.well-known/ocp-catalog", "")
		if status != 200 {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(body["query_url"].(string), "/ocp/query") {
			t.Error("query_url must point at /ocp/query")
		}
	})

	t.Run("query keyword", func(t *testing.T) {
		status, body := do(t, srv, "POST", "/ocp/query", `{"query":"headphones"}`)
		if status != 200 {
			t.Fatalf("status = %d", status)
		}
		hasKeys(t, body, "ocp_version", "kind", "id", "catalog_id", "query", "result_count", "page", "entries")
		if body["result_count"].(float64) != 1 {
			t.Errorf("result_count = %v, want 1", body["result_count"])
		}
	})

	t.Run("query empty returns all", func(t *testing.T) {
		_, body := do(t, srv, "POST", "/ocp/query", `{}`)
		if body["result_count"].(float64) != 3 {
			t.Errorf("result_count = %v, want 3", body["result_count"])
		}
	})

	t.Run("resolve", func(t *testing.T) {
		status, body := do(t, srv, "POST", "/ocp/resolve", `{"entry_id":"entry_example_inmemory_sku-001"}`)
		if status != 200 {
			t.Fatalf("status = %d", status)
		}
		hasKeys(t, body, "ocp_version", "kind", "id", "catalog_id", "entry_id", "commercial_object_id", "object_id", "object_type", "provider_id", "title", "visible_attributes", "action_bindings", "freshness", "expires_at")
	})

	t.Run("resolve unknown 404", func(t *testing.T) {
		status, _ := do(t, srv, "POST", "/ocp/resolve", `{"entry_id":"entry_example_inmemory_nope"}`)
		if status != 404 {
			t.Errorf("status = %d, want 404", status)
		}
	})
}
