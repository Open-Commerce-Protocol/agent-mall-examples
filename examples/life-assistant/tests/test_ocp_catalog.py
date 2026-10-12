import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import MCP_ENDPOINT, MallHTTPServer
from ocp_catalog import CATALOG_ID, OBJECT_TYPE, PROVIDER_ID, CatalogError, OCPCatalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = OCPCatalog("http://127.0.0.1:8765", MCP_ENDPOINT)

    def test_manifest_declares_actual_surface_and_local_scope(self):
        discovery = self.catalog.discovery()
        manifest = self.catalog.manifest()
        self.assertEqual(discovery["kind"], "WellKnownCatalogDiscovery")
        self.assertEqual(manifest["kind"], "CatalogManifest")
        self.assertEqual(manifest["registry_visibility"], "private")
        self.assertEqual(manifest["object_contracts"], [])
        self.assertEqual(manifest["endpoints"]["query"]["method"], "POST")
        self.assertEqual(manifest["data_profile"]["catalog_entry_count"], 3)
        self.assertNotIn("provider_registration", manifest["endpoints"])
        self.assertIn("本地", manifest["description"])

    def test_query_matches_local_definitions_and_never_invents_price(self):
        response = self.catalog.query({"query_pack": "ocp.query.keyword.v1", "query": "瑞幸"})
        self.assertEqual(response["kind"], "CatalogQueryResult")
        self.assertEqual(response["result_count"], 3)
        for match in response["entries"]:
            entry = match["entry"]
            self.assertEqual(entry["provider_id"], PROVIDER_ID)
            self.assertEqual(entry["object_type"], OBJECT_TYPE)
            self.assertEqual(entry["attributes"]["source_kind"], "local_demo_service_definition")
            self.assertNotIn("price", entry["attributes"])
            self.assertEqual(entry["attributes"]["inventory"]["availability_status"], "unknown")
        self.assertEqual(self.catalog.query({"query": "不存在的品牌"})["result_count"], 0)

    def test_cursor_pages_without_duplicate_results(self):
        response = self.catalog.query({"query": "瑞幸", "limit": 1})
        ids = [response["entries"][0]["entry"]["entry_id"]]
        while response["page"]["has_more"]:
            response = self.catalog.query({"query": "瑞幸", "limit": 1,
                                           "cursor": response["page"]["next_cursor"]})
            ids.extend(match["entry"]["entry_id"] for match in response["entries"])
        self.assertEqual(len(ids), 3)
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(response["page"]["offset"], 0)

    def test_cursor_is_bound_to_query_and_tamper_protected(self):
        cursor = self.catalog.query({"limit": 1})["page"]["next_cursor"]
        for body in ({"query": "门店", "cursor": cursor}, {"cursor": cursor + "x"},
                     {"cursor": "not-a-valid-cursor"}):
            with self.assertRaises(CatalogError):
                self.catalog.query(body)

    def test_filters_and_explain_are_respected(self):
        response = self.catalog.query({"filters": {"brand": "瑞幸"}, "explain": False})
        self.assertEqual(response["result_count"], 3)
        self.assertTrue(all(match["explain"] == [] for match in response["entries"]))
        self.assertEqual(self.catalog.query({"filters": {"brand": "未授权其他品牌"}})["result_count"], 0)

    def test_invalid_or_unsupported_query_inputs_are_rejected(self):
        cases = [{"limit": True}, {"limit": 0}, {"limit": 51}, {"query": 10},
                 {"query": "a" * 501}, {"offset": 1}, {"filters": {"min_amount": 9}},
                 {"query_mode": "semantic"}, {"query_pack": "invented.pack"},
                 {"ocp_version": "2.0"}, {"catalog_id": "another_catalog"}, {"fake": "field"}]
        for body in cases:
            with self.subTest(body=body), self.assertRaises(CatalogError):
                self.catalog.query(body)

    def test_resolve_binds_to_official_mcp_without_implying_authorization(self):
        entry = self.catalog.query({"query": "订单"})["entries"][0]["entry"]
        response = self.catalog.resolve({"entry_id": entry["entry_id"], "purpose": "workflow", "live_check": True})
        self.assertEqual(response["kind"], "ResolvableReference")
        self.assertEqual(response["access"]["permission_state"], "limited")
        self.assertEqual(response["live_checks"][0]["status"], "unknown")
        self.assertFalse(response["live_checks"][0]["details"]["vendor_request_performed"])
        actions = {action["action_id"]: action for action in response["action_bindings"]}
        self.assertTrue(actions["createOrder"]["requires_user_confirmation"])
        self.assertTrue(actions["cancelOrder"]["requires_user_confirmation"])
        self.assertFalse(actions["previewOrder"]["requires_user_confirmation"])
        for action in actions.values():
            self.assertIn(action["action_type"], {"url", "api", "workflow", "contact"})
            if action["action_type"] == "api":
                self.assertEqual(action["entrypoint"], {"url": MCP_ENDPOINT, "method": "POST"})
                self.assertTrue(action["auth_requirements"]["requires_official_tools_discovery"])
                self.assertEqual(action["input_schema"]["properties"]["method"]["const"], "tools/call")
        datetime.fromisoformat(response["expires_at"].replace("Z", "+00:00"))

    def test_resolve_unknown_or_invalid_entry_does_not_make_calls(self):
        for body in ({}, {"entry_id": "invented"}, {"entry_id": 123}):
            with self.assertRaises(CatalogError):
                self.catalog.resolve(body)

    def test_evidence_is_honest_about_source_and_brand_scope(self):
        evidence = self.catalog.evidence()
        self.assertFalse(evidence["execution"]["other_brands_authorized"])
        self.assertFalse(evidence["live_product_data_included"])
        self.assertEqual(len(evidence["schema_sources"]), 2)
        self.assertFalse(self.catalog.health()["details"]["vendor_health_checked"])


class CatalogHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = MallHTTPServer(("127.0.0.1", 0))
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)

    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as response:
            return response.code, json.loads(response.read())

    def test_full_discover_manifest_query_resolve_flow(self):
        status, discovery = self.request("/.well-known/ocp-catalog")
        self.assertEqual(status, 200)
        self.assertEqual(discovery["manifest_url"], self.base + "/ocp/manifest")
        status, manifest = self.request("/ocp/manifest")
        self.assertEqual(status, 200)
        self.assertEqual(manifest["catalog_id"], CATALOG_ID)
        status, query = self.request("/ocp/query", {"kind": "CatalogQueryRequest", "query": "门店"})
        self.assertEqual(status, 200)
        entry_id = query["entries"][0]["entry"]["entry_id"]
        status, resolve = self.request("/ocp/resolve", {"kind": "ResolveRequest", "entry_id": entry_id})
        self.assertEqual(status, 200)
        self.assertEqual(resolve["action_bindings"][0]["action_id"], "queryShopList")
        self.assertEqual(self.request("/ocp/health")[1]["kind"], "CatalogHealth")
        self.assertEqual(self.request("/api/catalog-evidence")[1]["source_kind"], "local_demo_service_definition")
        self.assertFalse(self.server.state.status()["connected"])

    def test_errors_are_structured_and_unknown_entry_is_404(self):
        self.assertEqual(self.request("/ocp/resolve", {"entry_id": "unknown"})[0], 404)
        self.assertEqual(self.request("/ocp/does-not-exist")[0], 404)
        status, payload = self.request("/ocp/query", {"limit": 0})
        self.assertEqual(status, 400)
        self.assertIn("error", payload)
        self.assertNotIn("entries", payload)


if __name__ == "__main__":
    unittest.main()
