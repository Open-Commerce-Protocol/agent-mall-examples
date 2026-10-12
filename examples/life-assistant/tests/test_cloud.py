"""Cloud isolation and duplicate-write tests; all provider/MCP traffic is mocked."""

import io
import json
import secrets
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import (AppError, BrowserSessions, DUPLICATE_WINDOW_SECONDS, MCP_SESSION_COOKIE,
                 MallHTTPServer, MallState, normalize_origin)
from auth import AuthManager, NoRedirect, cookie_value


ORIGIN = "https://one.example.com"
ALIAS = "https://alias.example.com"
TOKEN_A = "mock-private-token-A"
TOKEN_B = "mock-private-token-B"
READ_TOOL = {"name": "queryShopList", "inputSchema": {"type": "object"}}
WRITE_TOOL = {"name": "createOrder", "inputSchema": {"type": "object"}}


def cookie_header(headers):
    return "; ".join(value.split(";", 1)[0] for value in headers.get_all("Set-Cookie", []))


class PrivateClient:
    protocol_version = "2025-03-26"
    server_info = {"name": "mock-luckin"}

    def __init__(self, token):
        self.token = token
        self.owner = "A" if token == TOKEN_A else "B"
        self.calls = []
        self.failure = None
        self.entered = threading.Event()
        self.release = None

    def initialize(self):
        pass

    def list_tools(self):
        return [READ_TOOL, WRITE_TOOL, {"name": "privateCapability" + self.owner}]

    def rpc(self, method, params):
        self.calls.append(params)
        self.entered.set()
        if self.release is not None:
            self.release.wait(2)
        if self.failure:
            raise self.failure
        return {"structuredContent": {"owner": self.owner, "orderId": "order-" + self.owner}}

    def clear(self):
        self.token = ""


class IdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.client = PrivateClient(TOKEN_A)
        self.state = MallState(lambda token: self.client, clock=lambda: self.now)
        self.state.connect(TOKEN_A)

    def test_replay_survives_short_duplicate_window_and_does_not_call_upstream(self):
        first = self.state.call_tool("createOrder", {"quantity": 1}, True, "order-attempt-001")
        self.now += DUPLICATE_WINDOW_SECONDS + 1
        replay = self.state.call_tool("createOrder", {"quantity": 1}, True, "order-attempt-001")
        self.assertEqual(replay["result"], first["result"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(len(self.client.calls), 1)
        replay["result"]["structuredContent"]["owner"] = "changed"
        self.assertEqual(self.state.call_tool("createOrder", {"quantity": 1}, True,
                                              "order-attempt-001")["result"], first["result"])

    def test_key_cannot_be_reused_with_different_order_arguments(self):
        self.state.call_tool("createOrder", {"quantity": 1}, True, "order-attempt-001")
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {"quantity": 2}, True, "order-attempt-001")
        self.assertEqual(caught.exception.code, "idempotency_conflict")
        self.assertEqual(len(self.client.calls), 1)

    def test_uncertain_write_is_not_retried_after_timeout_window(self):
        self.client.failure = AppError("remote_timeout", "mock timeout", 504)
        with self.assertRaises(AppError):
            self.state.call_tool("createOrder", {}, True, "order-attempt-001")
        self.now += DUPLICATE_WINDOW_SECONDS + 1
        self.client.failure = None
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {}, True, "order-attempt-001")
        self.assertTrue(caught.exception.details["writeOutcomeUnknown"])
        self.assertTrue(caught.exception.details["idempotentReplay"])
        self.assertEqual(len(self.client.calls), 1)

    def test_parallel_same_attempt_does_not_create_a_second_order(self):
        self.client.release = threading.Event()
        results = []
        thread = threading.Thread(target=lambda: results.append(
            self.state.call_tool("createOrder", {}, True, "order-attempt-001")))
        thread.start()
        self.assertTrue(self.client.entered.wait(1))
        try:
            with self.assertRaises(AppError) as caught:
                self.state.call_tool("createOrder", {}, True, "order-attempt-001")
            self.assertEqual(caught.exception.code, "write_in_progress")
            self.assertEqual(len(self.client.calls), 1)
        finally:
            self.client.release.set()
            thread.join(2)
        self.assertEqual(len(results), 1)

    def test_cloud_write_requires_request_identifier_and_confirmation(self):
        for confirmed, code in ((False, "confirmation_required"), (True, "idempotency_required")):
            with self.assertRaises(AppError) as caught:
                self.state.call_tool("createOrder", {}, confirmed, require_idempotency=True)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.client.calls, [])

    def test_unexpected_upstream_failure_remains_an_uncertain_write(self):
        self.client.failure = ValueError("private remote detail")
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {}, True, "order-attempt-001")
        self.assertEqual(caught.exception.code, "write_outcome_unknown")
        self.assertNotIn("private remote detail", str(caught.exception))
        with self.assertRaises(AppError):
            self.state.call_tool("createOrder", {}, True, "order-attempt-001")
        self.assertEqual(len(self.client.calls), 1)


class BrowserSessionTests(unittest.TestCase):
    def test_random_host_only_cookie_and_unknown_cookie_is_not_adopted(self):
        sessions = BrowserSessions()
        attacker_cookie = secrets.token_urlsafe(32)
        state, key, response_cookie = sessions.acquire(MCP_SESSION_COOKIE + "=" + attacker_cookie)
        cookies = SimpleCookie(response_cookie)
        value = cookies[MCP_SESSION_COOKIE]
        self.assertNotEqual(value.value, attacker_cookie)
        self.assertTrue(value["httponly"])
        self.assertTrue(value["secure"])
        self.assertEqual(value["samesite"], "Lax")
        self.assertEqual(value["path"], "/")
        self.assertEqual(value["domain"], "")
        self.assertNotIn(value.value, sessions._sessions)
        sessions.release(key)
        resumed, resumed_key, _ = sessions.acquire(MCP_SESSION_COOKIE + "=" + value.value)
        self.assertIs(resumed, state)
        sessions.release(resumed_key)
        sessions.clear()

    def test_expiration_clears_credential_and_private_results(self):
        now = [1000]
        client = PrivateClient(TOKEN_A)
        sessions = BrowserSessions(lambda: MallState(lambda token: client), clock=lambda: now[0], ttl=10)
        state, key, response_cookie = sessions.acquire("")
        state.connect(TOKEN_A)
        state.call_tool("createOrder", {}, True, "order-attempt-001")
        sessions.release(key)
        now[0] += 11
        fresh, fresh_key, _ = sessions.acquire(response_cookie.split(";", 1)[0])
        self.assertIsNot(fresh, state)
        self.assertFalse(fresh.status()["connected"])
        self.assertEqual(client.token, "")
        self.assertEqual(state._idempotency, {})
        sessions.release(fresh_key)
        sessions.clear()

    def test_active_request_session_is_not_removed_by_expiration_cleanup(self):
        now = [1000]
        sessions = BrowserSessions(clock=lambda: now[0], ttl=10)
        state, key, response_cookie = sessions.acquire("")
        now[0] += 11
        resumed, resumed_key, _ = sessions.acquire(response_cookie.split(";", 1)[0])
        self.assertIs(resumed, state)
        sessions.release(resumed_key)
        sessions.release(key)
        sessions.clear()

    def test_session_limit_preserves_existing_browser_access(self):
        sessions = BrowserSessions(limit=1)
        state, key, response_cookie = sessions.acquire("")
        sessions.release(key)
        with self.assertRaises(AppError) as caught:
            sessions.acquire("")
        self.assertEqual(caught.exception.status, 429)
        same, key, _ = sessions.acquire(response_cookie.split(";", 1)[0])
        self.assertIs(state, same)
        sessions.release(key)
        sessions.clear()


class CloudHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        static = Path(self.temp.name)
        (static / "index.html").write_text("Cloud UI", encoding="utf-8")
        (static / "current-order.json").write_text('{"private":"local-order"}', encoding="utf-8")
        (static / "order-alias.json").symlink_to(static / "current-order.json")
        self.clients = []
        def client_factory(token):
            client = PrivateClient(token)
            self.clients.append(client)
            return client
        self.auth_env = {"WECHAT_APP_ID": "wx0123456789abcdef", "WECHAT_SECRET": "mock-secret",
                         "WECHAT_REDIRECT_URI": ORIGIN + "/auth/callback/wechat"}
        def oauth_remote(request, timeout):
            data = ({"access_token": "mock-oauth-token", "openid": "mock-user-id"}
                    if "/oauth2/access_token" in request.full_url else
                    {"openid": "mock-user-id", "nickname": "测试用户", "headimgurl": ""})
            return io.BytesIO(json.dumps(data).encode())
        self.server = MallHTTPServer(("127.0.0.1", 0), static_dir=static,
                                     auth=AuthManager(self.auth_env, opener=oauth_remote), cloud_mode=True,
                                     trusted_origins=[ORIGIN, ALIAS],
                                     state_factory=lambda: MallState(client_factory))
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, path, body=None, cookies="", headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request_headers = {"Host": "one.example.com", "Cookie": cookies}
        if body is not None:
            request_headers.update({"Content-Type": "application/json", "Origin": ORIGIN})
        for key, value in (headers or {}).items():
            if value is None:
                request_headers.pop(key, None)
            else:
                request_headers[key] = value
        request = urllib.request.Request(self.base + path, data=data, headers=request_headers)
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=3) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as response:
            return response.code, response.read(), response.headers

    def connect(self, token):
        status, raw, headers = self.request("/api/connect", {"token": token})
        self.assertEqual(status, 200)
        self.assertNotIn(token.encode(), raw)
        return cookie_header(headers)

    def test_tools_connection_and_query_results_are_browser_isolated(self):
        browser_a = self.connect(TOKEN_A)
        status, raw, headers = self.request("/api/tools")
        self.assertEqual(json.loads(raw)["tools"], [])
        self.assertFalse(json.loads(raw)["connected"])
        browser_b = cookie_header(headers)
        self.assertNotEqual(browser_a, browser_b)
        self.assertEqual(self.request("/api/connect", {"token": TOKEN_B}, browser_b)[0], 200)
        for browser, owner in ((browser_a, "A"), (browser_b, "B")):
            _, raw, _ = self.request("/api/tools", cookies=browser)
            self.assertEqual(json.loads(raw)["mode"], "cloud")
            private_tools = [t["name"] for t in json.loads(raw)["tools"] if t["name"].startswith("private")]
            self.assertEqual(private_tools, ["privateCapability" + owner])
            _, raw, _ = self.request("/api/tool", {"name": "queryShopList", "arguments": {}}, browser)
            self.assertEqual(json.loads(raw)["result"]["structuredContent"]["owner"], owner)
            self.assertNotIn(cookie_value(browser, MCP_SESSION_COOKIE).encode(), raw)
        self.request("/api/disconnect", {}, browser_a)
        self.assertFalse(json.loads(self.request("/api/health", cookies=browser_a)[1])["connected"])
        self.assertTrue(json.loads(self.request("/api/health", cookies=browser_b)[1])["connected"])

    def test_order_results_and_idempotency_cache_do_not_cross_browsers(self):
        browser_a, browser_b = self.connect(TOKEN_A), self.connect(TOKEN_B)
        payload = {"name": "createOrder", "arguments": {}, "confirmed": True,
                   "idempotencyKey": "order-attempt-001"}
        for browser, owner in ((browser_a, "A"), (browser_b, "B")):
            for repeat in range(2):
                status, raw, _ = self.request("/api/tool", payload, browser)
                self.assertEqual(status, 200)
                result = json.loads(raw)
                self.assertEqual(result["result"]["structuredContent"]["orderId"], "order-" + owner)
                self.assertEqual(result.get("idempotentReplay", False), bool(repeat))
        self.assertEqual([len(client.calls) for client in self.clients], [1, 1])

    def test_cloud_rejects_confirmed_write_without_identifier(self):
        browser = self.connect(TOKEN_A)
        status, raw, _ = self.request("/api/tool", {"name": "createOrder", "arguments": {}, "confirmed": True}, browser)
        self.assertEqual(status, 428)
        self.assertEqual(json.loads(raw)["error"]["code"], "idempotency_required")
        self.assertEqual(self.clients[0].calls, [])

    def test_same_origin_validation_ignores_spoofed_forwarded_headers(self):
        for headers in ({"Origin": None}, {"Origin": "https://evil.example"}, {"Origin": ALIAS},
                        {"Sec-Fetch-Site": "cross-site"},
                        {"Host": "evil.example", "X-Forwarded-Host": "one.example.com"}):
            self.assertEqual(self.request("/api/connect", {"token": TOKEN_A}, headers=headers)[0], 403)
        self.assertEqual(self.clients, [])
        self.assertEqual(self.request("/", headers={"Sec-Fetch-Site": "cross-site",
                                                    "Sec-Fetch-Mode": "navigate"})[0], 200)

    def test_current_local_order_is_never_served_in_cloud(self):
        for path in ("/current-order.json", "/%63urrent-order.json", "/current-order.json?cache=1",
                     "/order-alias.json", "/nested/../current-order.json"):
            status, raw, _ = self.request(path)
            self.assertEqual(status, 404)
            self.assertNotIn(b"local-order", raw)

    def test_public_liveness_does_not_allocate_or_reveal_browser_state(self):
        status, raw, headers = self.request("/healthz", headers={"Host": "health-check.internal"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"ok": True, "service": "agent-mall-one", "mode": "cloud"})
        self.assertIsNone(headers.get("Set-Cookie"))
        self.assertEqual(self.server.sessions._sessions, {})

    def test_catalog_links_use_the_primary_public_origin(self):
        status, raw, _ = self.request("/ocp/manifest")
        self.assertEqual(status, 200)
        self.assertIn(ORIGIN.encode(), raw)
        self.assertNotIn(self.base.encode(), raw)

    def test_oauth_configured_public_origin_and_cross_site_callback_work(self):
        _, raw, _ = self.request("/api/auth/providers")
        self.assertTrue(json.loads(raw)["providers"][0]["enabled"])
        _, raw, _ = self.request("/api/auth/providers", headers={"Host": "alias.example.com"})
        self.assertFalse(json.loads(raw)["providers"][0]["enabled"])
        status, raw, headers = self.request("/api/auth/start", {"provider": "wechat"})
        self.assertEqual(status, 200)
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(json.loads(raw)["url"]).query)["state"][0]
        browser_cookie = cookie_header(headers)
        status, _, headers = self.request("/auth/callback/wechat?" + urllib.parse.urlencode(
            {"state": state, "code": "mock-code"}), cookies=browser_cookie,
            headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/?login=success")
        _, raw, _ = self.request("/api/auth/me", cookies=cookie_header(headers))
        self.assertTrue(json.loads(raw)["authenticated"])
        self.assertNotIn(b"mock-oauth-token", raw)
        self.assertNotIn(b"mock-user-id", raw)
        self.assertFalse(json.loads(self.request("/api/auth/me")[1])["authenticated"])

    def test_cloud_logout_disconnects_only_current_browser_luckin(self):
        browser_a, browser_b = self.connect(TOKEN_A), self.connect(TOKEN_B)
        self.assertEqual(self.request("/api/auth/logout", {}, browser_a)[0], 200)
        self.assertEqual(self.clients[0].token, "")
        self.assertEqual(self.clients[1].token, TOKEN_B)
        self.assertTrue(json.loads(self.request("/api/health", cookies=browser_b)[1])["connected"])


class CloudConfigurationTests(unittest.TestCase):
    def test_https_origin_normalization(self):
        self.assertEqual(normalize_origin("https://ONE.example.com:443/", True), ORIGIN)
        for origin in ("http://one.example.com", "https://one.example.com/path", "https://user:pass@one.example.com",
                       "https://one.example.com?query=1", "https://one.example.com:0", "https://one.example.com\n"):
            with self.assertRaises(ValueError):
                normalize_origin(origin, True)

    def test_cloud_requires_origin_and_rejects_seeded_shared_state(self):
        with self.assertRaises(ValueError):
            MallHTTPServer(("127.0.0.1", 0), cloud_mode=True)
        with self.assertRaises(ValueError):
            MallHTTPServer(("127.0.0.1", 0), MallState(), cloud_mode=True, trusted_origins=[ORIGIN])


if __name__ == "__main__":
    unittest.main()
