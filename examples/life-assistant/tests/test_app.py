import io
import json
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from email.message import Message
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import AppError, MCPClient, MallHTTPServer, MallState, requires_confirmation


TOKEN = "test-token-never-persist-this"
READ_TOOL = {"name": "queryShopList", "description": "查询门店", "inputSchema": {
    "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}
WRITE_TOOL = {"name": "createOrder", "inputSchema": {"type": "object"}}
CANCEL_TOOL = {"name": "cancelOrder", "inputSchema": {"type": "object"}}


class Response(io.BytesIO):
    def __init__(self, data, content_type="application/json", session=None):
        super().__init__(data)
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        if session:
            self.headers["MCP-Session-Id"] = session


class FakeRemote:
    def __init__(self, sse=False):
        self.requests = []
        self.sse = sse

    def __call__(self, request, timeout):
        body = json.loads(request.data)
        self.requests.append((body, dict(request.header_items())))
        method = body["method"]
        if method == "notifications/initialized":
            return Response(b"")
        if method == "initialize":
            result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}},
                      "serverInfo": {"name": "mock-luckin", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [READ_TOOL, WRITE_TOOL, CANCEL_TOOL]}
        else:
            result = {"content": [{"type": "text", "text": "success"}]}
        message = {"jsonrpc": "2.0", "id": body["id"], "result": result}
        if self.sse:
            payload = b": heartbeat\n\nevent: message\ndata: " + json.dumps(
                {"jsonrpc": "2.0", "method": "notifications/progress", "params": {}}
            ).encode() + b"\n\nevent: message\ndata: " + json.dumps(message).encode() + b"\n\n"
            return Response(payload, "text/event-stream", "mock-session" if method == "initialize" else None)
        return Response(json.dumps(message).encode(), session="mock-session" if method == "initialize" else None)


class FakeClient:
    protocol_version = "2025-03-26"
    server_info = {"name": "mock"}

    def __init__(self, token):
        self.token = token
        self.calls = []
        self.entered = threading.Event()
        self.release = None
        self.failure = None

    def initialize(self):
        pass

    def list_tools(self):
        return [READ_TOOL, WRITE_TOOL, CANCEL_TOOL,
                {"name": "switchProduct", "inputSchema": {"type": "object"}},
                {"name": "newCapability", "annotations": {"readOnlyHint": True}}]

    def rpc(self, method, params):
        self.calls.append((method, params))
        self.entered.set()
        if self.release:
            self.release.wait(2)
        if self.failure:
            raise self.failure
        return {"content": [{"type": "text", "text": "mock result"}]}

    def clear(self):
        self.token = ""


class TransportTests(unittest.TestCase):
    def test_initialize_json_and_session_headers(self):
        remote = FakeRemote()
        client = MCPClient(TOKEN, opener=remote)
        client.initialize()
        self.assertEqual(len(client.list_tools()), 3)
        initialize, notify, tool_list = remote.requests
        self.assertEqual(initialize[0]["method"], "initialize")
        self.assertNotIn("id", notify[0])
        self.assertEqual(tool_list[1]["Mcp-session-id"], "mock-session")
        self.assertEqual(tool_list[1]["Authorization"], "Bearer " + TOKEN)
        self.assertIn("text/event-stream", tool_list[1]["Accept"])

    def test_sse_with_notifications_returns_matching_result(self):
        client = MCPClient(TOKEN, opener=FakeRemote(sse=True))
        client.initialize()
        self.assertEqual(client.list_tools()[0]["name"], "queryShopList")

    def test_multiline_sse_and_unmatched_response(self):
        def remote(request, timeout):
            request_id = json.loads(request.data)["id"]
            payload = ('data: {"jsonrpc":"2.0",\n'
                       'data: "id":%s,"result":{"hello":"world"}}\n\n' % request_id).encode()
            return Response(payload, "text/event-stream")
        self.assertEqual(MCPClient(TOKEN, opener=remote).rpc("test"), {"hello": "world"})

    def test_upstream_error_redacts_token(self):
        def remote(request, timeout):
            request_id = json.loads(request.data)["id"]
            return Response(json.dumps({"id": request_id, "error": {
                "code": -32602, "message": "bad credential " + TOKEN,
                "data": {"token": TOKEN}}}).encode())
        with self.assertRaises(AppError) as caught:
            MCPClient(TOKEN, opener=remote).rpc("test")
        self.assertNotIn(TOKEN, json.dumps(caught.exception.as_json()))

    def test_timeout_is_json_error(self):
        def remote(request, timeout):
            raise socket.timeout()
        with self.assertRaises(AppError) as caught:
            MCPClient(TOKEN, opener=remote).rpc("test")
        self.assertEqual(caught.exception.status, 504)

    def test_auth_http_error_does_not_echo_body(self):
        def remote(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, TOKEN, {}, io.BytesIO(TOKEN.encode()))
        with self.assertRaises(AppError) as caught:
            MCPClient(TOKEN, opener=remote).rpc("test")
        self.assertEqual(caught.exception.code, "authentication_failed")
        self.assertNotIn(TOKEN, str(caught.exception))

    def test_large_order_identifiers_preserve_precision(self):
        large_id = 9223372036854775801
        def remote(request, timeout):
            request_id = json.loads(request.data)["id"]
            result = {"structuredContent": {"orderId": large_id, "order_id": large_id,
                                             "amount": 12.5, "deptId": large_id},
                      "content": [{"type": "text", "text": json.dumps({
                          "response": {"orderId": large_id, "order_id": large_id,
                                       "amount": 12.5, "deptId": large_id}})}]}
            return Response(json.dumps({"id": request_id, "result": result}).encode())
        result = MCPClient(TOKEN, opener=remote).rpc("tools/call", {"name": "mock", "arguments": {}})
        structured = result["structuredContent"]
        text = json.loads(result["content"][0]["text"])["response"]
        for values in (structured, text):
            self.assertEqual(values["orderId"], str(large_id))
            self.assertEqual(values["order_id"], str(large_id))
            self.assertEqual(values["deptId"], large_id)
            self.assertEqual(values["amount"], 12.5)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.clients = []
        self.now = 1000
        def factory(token):
            client = FakeClient(token)
            self.clients.append(client)
            return client
        self.state = MallState(factory, lambda: self.now)
        self.state.connect(TOKEN)
        self.client = self.clients[-1]

    def test_discovered_schema_and_readonly_rules(self):
        tools = {tool["name"]: tool for tool in self.state.tools()["tools"]}
        self.assertEqual(tools["queryShopList"]["inputSchema"], READ_TOOL["inputSchema"])
        self.assertFalse(tools["queryShopList"]["requiresConfirmation"])
        self.assertFalse(tools["switchProduct"]["requiresConfirmation"])
        self.assertTrue(tools["createOrder"]["requiresConfirmation"])
        self.assertTrue(tools["newCapability"]["requiresConfirmation"])

    def test_unknown_and_unconfirmed_writes_never_reach_remote(self):
        for name, confirmation in (("notDiscovered", True), ("createOrder", False),
                                   ("cancelOrder", "true"), ("createOrder", 1)):
            with self.assertRaises(AppError):
                self.state.call_tool(name, {}, confirmation)
        self.assertEqual(self.client.calls, [])

    def test_invalid_arguments_stay_local(self):
        with self.assertRaises(AppError):
            self.state.call_tool("queryShopList", {})
        self.assertEqual(self.client.calls, [])

    def test_read_tools_can_repeat(self):
        self.state.call_tool("queryShopList", {"city": "杭州"})
        self.state.call_tool("queryShopList", {"city": "杭州"})
        self.assertEqual(len(self.client.calls), 2)

    def test_duplicate_write_including_changed_key_order_is_blocked(self):
        self.state.call_tool("createOrder", {"shop": 1, "item": 2}, True)
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {"item": 2, "shop": 1}, True)
        self.assertEqual(caught.exception.code, "duplicate_write")
        self.assertEqual(len(self.client.calls), 1)

    def test_concurrent_writes_block_and_do_not_send_second_request(self):
        self.client.release = threading.Event()
        worker = threading.Thread(target=lambda: self.state.call_tool("createOrder", {"a": 1}, True))
        worker.start()
        self.assertTrue(self.client.entered.wait(1))
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {"a": 2}, True)
        self.assertEqual(caught.exception.code, "write_in_progress")
        with self.assertRaises(AppError):
            self.state.disconnect()
        self.client.release.set()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(self.client.calls), 1)

    def test_uncertain_write_is_not_retried(self):
        self.client.failure = AppError("remote_timeout", "mock timeout", 504)
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {}, True)
        self.assertTrue(caught.exception.details["writeOutcomeUnknown"])
        with self.assertRaises(AppError) as duplicate:
            self.state.call_tool("createOrder", {}, True)
        self.assertEqual(duplicate.exception.code, "duplicate_write")
        self.assertEqual(len(self.client.calls), 1)

    def test_reconnect_same_account_keeps_duplicate_guard(self):
        self.state.call_tool("createOrder", {}, True)
        self.state.disconnect()
        self.assertEqual(self.client.token, "")
        self.state.connect(TOKEN)
        with self.assertRaises(AppError) as caught:
            self.state.call_tool("createOrder", {}, True)
        self.assertEqual(caught.exception.code, "duplicate_write")

    def test_disconnect_clears_credential_and_schema(self):
        self.state.disconnect()
        self.assertEqual(self.client.token, "")
        self.assertFalse(self.state.status()["connected"])
        self.assertEqual(self.state.tools()["tools"], [])


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        static = Path(cls.temp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("<h1>Mock UI</h1>", encoding="utf-8")
        (Path(cls.temp.name) / "secret.txt").write_text("private")
        cls.state = MallState(FakeClient)
        cls.server = MallHTTPServer(("127.0.0.1", 0), cls.state, static)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)
        cls.temp.cleanup()

    def request(self, path, body=None, headers=None):
        request_headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            request_headers.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(self.base + path, data=data, headers=request_headers)
        try:
            with urllib.request.urlopen(req, timeout=2) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as response:
            return response.code, response.read()

    def test_health_and_static(self):
        status, body = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        self.assertEqual(self.request("/")[1], b"<h1>Mock UI</h1>")

    def test_cross_origin_and_host_rejected(self):
        status, _ = self.request("/api/connect", {"token": TOKEN}, {"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        status, _ = self.request("/api/health", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)

    def test_static_traversal_and_references_are_not_served(self):
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/references/luckin-platform.js"):
            self.assertEqual(self.request(path)[0], 404)

    def test_connect_tools_call_and_disconnect(self):
        status, body = self.request("/api/connect", {"token": TOKEN})
        self.assertEqual(status, 200)
        self.assertNotIn(TOKEN.encode(), body)
        self.assertGreater(len(json.loads(self.request("/api/tools")[1])["tools"]), 0)
        status, body = self.request("/api/tool", {"name": "queryShopList", "arguments": {"city": "杭州"}})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        status, _ = self.request("/api/tool", {"name": "createOrder", "arguments": {}})
        self.assertEqual(status, 428)
        self.assertEqual(self.request("/api/disconnect", {})[0], 200)


if __name__ == "__main__":
    unittest.main()
