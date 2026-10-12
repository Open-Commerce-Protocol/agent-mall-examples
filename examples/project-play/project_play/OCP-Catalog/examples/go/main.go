// Command example-catalog-go is a minimal, spec-valid OCP Catalog Node.
//
// It serves five endpoints from ~3 in-memory products using only the Go
// standard library — no database, no vendor client, no auth:
//
//	GET  /.well-known/ocp-catalog   discovery
//	GET  /ocp/manifest              capabilities
//	GET  /ocp/health                liveness
//	GET  /ocp/contracts             object contracts (empty -- read-only node)
//	POST /ocp/query                 keyword search over products
//	POST /ocp/resolve               resolve one entry into actions
//
// Response shapes match @ocp-catalog/ocp-schema; main_test.go asserts the
// required OCP fields on every endpoint.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type product struct {
	ID           string
	Title        string
	Summary      string
	Brand        string
	Category     string
	Currency     string
	Amount       float64
	Availability string
	URL          string
	UpdatedAt    string
}

var products = []product{
	{"sku-001", "Aurora Wireless Headphones", "Over-ear Bluetooth headphones with active noise cancellation.", "Aurora", "electronics", "USD", 199.0, "in_stock", "https://example.com/products/aurora-headphones", "2026-07-01T00:00:00.000Z"},
	{"sku-002", "Trailhead Running Shoes", "Lightweight trail runners with a grippy all-terrain outsole.", "Trailhead", "footwear", "USD", 129.0, "low_stock", "https://example.com/products/trailhead-shoes", "2026-07-02T00:00:00.000Z"},
	{"sku-003", "Camp Kettle 1.5L", "Hard-anodized aluminium kettle for backcountry cooking.", "Basecamp", "outdoors", "USD", 39.0, "in_stock", "https://example.com/products/camp-kettle", "2026-07-03T00:00:00.000Z"},
}

const providerID = "example_inmemory"

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

var (
	catalogID   = env("CATALOG_ID", "cat_example_go")
	catalogName = env("CATALOG_NAME", "Example Go Catalog")
	port        = env("PORT", "4402")
	baseURL     = strings.TrimRight(env("PUBLIC_BASE_URL", "http://localhost:"+env("PORT", "4402")), "/")
)

func randID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func entryID(p product) string { return fmt.Sprintf("entry_%s_%s", providerID, p.ID) }

func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

type obj = map[string]any

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func wellKnownDiscovery() obj {
	return obj{
		"ocp_version":   "1.0",
		"kind":          "WellKnownCatalogDiscovery",
		"catalog_id":    catalogID,
		"catalog_name":  catalogName,
		"manifest_url":  baseURL + "/ocp/manifest",
		"health_url":    baseURL + "/ocp/health",
		"query_url":     baseURL + "/ocp/query",
		"resolve_url":   baseURL + "/ocp/resolve",
		"contracts_url": baseURL + "/ocp/contracts",
	}
}

func manifest() obj {
	return obj{
		"ocp_version":         "1.0",
		"kind":                "CatalogManifest",
		"id":                  "manifest_" + catalogID,
		"catalog_id":          catalogID,
		"catalog_name":        catalogName,
		"description":         "Minimal in-memory OCP Catalog Node example (Go).",
		"registry_visibility": "public",
		"endpoints": obj{
			"health":    obj{"url": baseURL + "/ocp/health", "method": "GET"},
			"query":     obj{"url": baseURL + "/ocp/query", "method": "POST"},
			"resolve":   obj{"url": baseURL + "/ocp/resolve", "method": "POST"},
			"contracts": obj{"url": baseURL + "/ocp/contracts", "method": "GET"},
		},
		"query_capabilities": []obj{
			{
				"capability_id": "ocp.example.product.search.v1",
				"name":          "Keyword product search",
				"description":   "Case-insensitive keyword match over the in-memory product list.",
				"query_packs": []obj{
					{
						"pack_id":     "ocp.query.keyword.v1",
						"description": "Keyword search over title, summary, brand, and category.",
						"query_modes": []string{"keyword"},
					},
				},
				"supports_explain": true,
				"supports_resolve": true,
			},
		},
		// Required by the schema even for a read-only node that ingests nothing.
		"object_contracts": []obj{},
	}
}

func health() obj {
	return obj{
		"ocp_version": "1.0",
		"kind":        "CatalogHealth",
		"catalog_id":  catalogID,
		"status":      "healthy",
		"ready":       true,
		"checked_at":  nowISO(),
	}
}

func contracts() obj {
	return obj{
		"ocp_version":      "1.0",
		"kind":             "ObjectContractList",
		"catalog_id":       catalogID,
		"object_contracts": []obj{},
		"note":             "Read-only example node; it does not accept provider object ingestion.",
	}
}

func toEntry(p product) obj {
	return obj{
		"kind":        "CatalogEntry",
		"catalog_id":  catalogID,
		"entry_id":    entryID(p),
		"provider_id": providerID,
		"object_id":   p.ID,
		"object_type": "ocp.commerce.product",
		"title":       p.Title,
		"summary":     p.Summary,
		"attributes": obj{
			"brand":       p.Brand,
			"category":    p.Category,
			"price":       obj{"currency": p.Currency, "amount": p.Amount},
			"inventory":   obj{"availability_status": p.Availability},
			"product_url": p.URL,
		},
	}
}

func query(body obj) obj {
	term := strings.ToLower(strings.TrimSpace(asString(body["query"])))
	limit := 20
	if l, ok := body["limit"].(float64); ok && l >= 1 && l <= 50 {
		limit = int(l)
	}
	var matches []product
	for _, p := range products {
		if term == "" || strings.Contains(strings.ToLower(p.Title+" "+p.Summary+" "+p.Brand+" "+p.Category), term) {
			matches = append(matches, p)
		}
	}
	if len(matches) > limit {
		matches = matches[:limit]
	}
	entries := make([]obj, 0, len(matches))
	for _, p := range matches {
		entries = append(entries, obj{
			"entry":   toEntry(p),
			"score":   1,
			"explain": []string{fmt.Sprintf("Keyword match for %q.", asString(body["query"]))},
		})
	}
	return obj{
		"ocp_version":  "1.0",
		"kind":         "CatalogQueryResult",
		"id":           randID("qry"),
		"catalog_id":   catalogID,
		"query_pack":   "ocp.query.keyword.v1",
		"query_mode":   "keyword",
		"query":        asString(body["query"]),
		"result_count": len(entries),
		"page":         obj{"limit": limit, "offset": 0, "has_more": false},
		"entries":      entries,
	}
}

func resolve(body obj) (int, obj) {
	id := asString(body["entry_id"])
	for _, p := range products {
		if entryID(p) == id {
			now := nowISO()
			return http.StatusOK, obj{
				"ocp_version":          "1.0",
				"kind":                 "ResolvableReference",
				"id":                   randID("res"),
				"catalog_id":           catalogID,
				"entry_id":             entryID(p),
				"commercial_object_id": "co_" + p.ID,
				"object_id":            p.ID,
				"object_type":          "ocp.commerce.product",
				"provider_id":          providerID,
				"title":                p.Title,
				"visible_attributes": obj{
					"brand":        p.Brand,
					"category":     p.Category,
					"price":        obj{"currency": p.Currency, "amount": p.Amount},
					"availability": p.Availability,
				},
				"action_bindings": []obj{
					{
						"action_id":   "view",
						"action_type": "url",
						"label":       "View product",
						"entrypoint":  obj{"url": p.URL, "method": "GET"},
					},
				},
				"freshness":  obj{"object_updated_at": p.UpdatedAt, "resolved_at": now},
				"expires_at": time.Now().UTC().Add(time.Hour).Format("2006-01-02T15:04:05.000Z"),
			}
		}
	}
	if id == "" {
		id = "(missing)"
	}
	return http.StatusNotFound, obj{"error": obj{"code": "not_found", "message": "Unknown entry_id: " + id}}
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func readJSON(r *http.Request) obj {
	var parsed obj
	if err := json.NewDecoder(r.Body).Decode(&parsed); err != nil || parsed == nil {
		return obj{}
	}
	return parsed
}

// NewMux builds the router. Exported so tests can exercise it without a socket.
func NewMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/ocp-catalog", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, wellKnownDiscovery()) })
	mux.HandleFunc("GET /ocp/manifest", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, manifest()) })
	mux.HandleFunc("GET /ocp/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, health()) })
	mux.HandleFunc("GET /ocp/contracts", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, contracts()) })
	mux.HandleFunc("POST /ocp/query", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, query(readJSON(r))) })
	mux.HandleFunc("POST /ocp/resolve", func(w http.ResponseWriter, r *http.Request) {
		status, body := resolve(readJSON(r))
		writeJSON(w, status, body)
	})
	return mux
}

func main() {
	addr := ":" + port
	log.Printf("Example Go OCP Catalog Node listening on %s", baseURL)
	if err := http.ListenAndServe(addr, NewMux()); err != nil {
		log.Fatal(err)
	}
}
