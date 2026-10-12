#!/usr/bin/env python3
"""Dependency-free bridge to Luckin's official Streamable HTTP MCP.

Run: python3 app.py
Cloud: CLOUD_MODE=1 PUBLIC_ORIGIN=https://your-host.example python3 app.py
Credentials, browser sessions and write guards live only in process memory.
"""

import argparse
import copy
import hashlib
import json
import math
import mimetypes
import os
import re
import secrets
import signal
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ocp_catalog import CatalogError, OCPCatalog
from auth import AuthError, AuthManager, cookie_value, make_cookie


MCP_ENDPOINT = "https://gwmcp.lkcoffee.com/order/user/mcp"
PROTOCOL_VERSION = "2025-03-26"
SUPPORTED_PROTOCOLS = {"2025-03-26", "2025-06-18", "2025-11-25"}
REQUEST_TIMEOUT = 20
MAX_REMOTE_BYTES = 2 * 1024 * 1024
MAX_BODY_BYTES = 256 * 1024
DUPLICATE_WINDOW_SECONDS = 120
BROWSER_SESSION_TTL = 8 * 60 * 60
MAX_BROWSER_SESSIONS = 1024
MAX_IDEMPOTENCY_KEYS = 64
MCP_SESSION_COOKIE = "__Host-amo_mcp"
READ_ONLY_TOOLS = {
    "queryShopList", "searchProductForMcp", "switchProduct",
    "queryProductDetailInfo", "previewOrder", "queryOrderDetailInfo",
}
STATIC_DIR = Path(__file__).resolve().parent / "static"


def normalize_origin(value, require_https=False):
    """Accept configured origins, never a user supplied forwarded header."""
    if not isinstance(value, str) or any(ord(char) <= 32 for char in value):
        raise ValueError("站点地址必须是完整的 origin，不得含空格。")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError("站点地址格式无效。") from None
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or (port is not None and port == 0)
            or (require_https and parsed.scheme != "https")):
        raise ValueError("云模式站点地址必须是 HTTPS origin，例如 https://one.example.com。")
    hostname = parsed.hostname.lower()
    host = "[" + hostname + "]" if ":" in hostname else hostname
    if port and port != (443 if parsed.scheme == "https" else 80):
        host += ":" + str(port)
    return parsed.scheme + "://" + host


class AppError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.details = details

    def as_json(self):
        error = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"ok": False, "error": error}


def redact(value, token=""):
    """Remove credentials even if an upstream error or tool echoes them."""
    if isinstance(value, str):
        if token:
            value = value.replace(token, "[已隐藏]")
        return re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [已隐藏]", value)
    if isinstance(value, list):
        return [redact(item, token) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if str(key).lower().replace("_", "") in {
                "token", "accesstoken", "refreshtoken", "authorization", "apikey",
            } and isinstance(item, str):
                result[key] = "[已隐藏]"
            else:
                result[redact(key, token) if isinstance(key, str) else key] = redact(item, token)
        return result
    return value


def normalize_order_ids(value):
    """Keep order identifiers exact when JSON reaches JavaScript's Number type."""
    if isinstance(value, list):
        return [normalize_order_ids(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {"orderId", "order_id"} and type(item) is int:
                result[key] = str(item)
            else:
                result[key] = normalize_order_ids(item)
        if result.get("type") == "text" and isinstance(result.get("text"), str):
            try:
                parsed = json.loads(result["text"])
                if isinstance(parsed, dict):
                    normalized = normalize_order_ids(parsed)
                    if normalized != parsed:
                        result["text"] = json.dumps(normalized, ensure_ascii=False, allow_nan=False)
            except (ValueError, TypeError):
                pass
        return result
    return value


def requires_confirmation(tool):
    # Server annotations are advisory. Only the documented query tools bypass
    # confirmation; any newly discovered capability has a conservative default.
    return tool.get("name") not in READ_ONLY_TOOLS


def validate_arguments(value, schema, path="arguments", depth=0):
    """Validate common JSON Schema constraints without external dependencies.

    Full authoritative validation still belongs to the official MCP server.
    Unsupported schema keywords are preserved for the frontend, not fabricated.
    """
    if not isinstance(schema, dict) or depth > 24:
        return
    expected = schema.get("type")
    types = expected if isinstance(expected, list) else [expected]
    matches = {
        "object": isinstance(value, dict), "array": isinstance(value, list),
        "string": isinstance(value, str), "boolean": isinstance(value, bool),
        "null": value is None,
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
    }
    if expected is not None and not any(matches.get(t, True) for t in types):
        raise AppError("invalid_arguments", "%s 的类型应为 %s。" % (path, expected))
    if "enum" in schema and value not in schema["enum"]:
        raise AppError("invalid_arguments", "%s 不在允许的选项中。" % path)
    if "const" in schema and value != schema["const"]:
        raise AppError("invalid_arguments", "%s 不符合固定值要求。" % path)
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                raise AppError("invalid_arguments", "缺少必填参数：%s.%s。" % (path, key))
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                validate_arguments(item, properties[key], "%s.%s" % (path, key), depth + 1)
            elif schema.get("additionalProperties") is False:
                raise AppError("invalid_arguments", "不支持的参数：%s.%s。" % (path, key))
    elif isinstance(value, list):
        for keyword, compare in (("minItems", lambda n: len(value) < n),
                                 ("maxItems", lambda n: len(value) > n)):
            if keyword in schema and compare(schema[keyword]):
                raise AppError("invalid_arguments", "%s 的条目数量不符合要求。" % path)
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                validate_arguments(item, schema["items"], "%s[%d]" % (path, index), depth + 1)
    elif isinstance(value, str):
        if ("minLength" in schema and len(value) < schema["minLength"]) or (
            "maxLength" in schema and len(value) > schema["maxLength"]
        ):
            raise AppError("invalid_arguments", "%s 的文字长度不符合要求。" % path)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise AppError("invalid_arguments", "%s 必须是有限数值。" % path)
        if ("minimum" in schema and value < schema["minimum"]) or (
            "maximum" in schema and value > schema["maximum"]
        ):
            raise AppError("invalid_arguments", "%s 的数值超出允许范围。" % path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the bearer credential to a redirect destination.
        return None


def open_remote(request, timeout):
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)


class MCPClient:
    def __init__(self, token, opener=None, timeout=REQUEST_TIMEOUT):
        self._token = token
        self._opener = opener or open_remote
        self.timeout = timeout
        self._id_lock = threading.Lock()
        self._next_id = 0
        self._session_id = None
        self.protocol_version = PROTOCOL_VERSION
        self.server_info = {}

    def clear(self):
        self._token = ""
        self._session_id = None

    def _response_message(self, value, request_id, token):
        messages = value if isinstance(value, list) else [value]
        for message in messages:
            if not isinstance(message, dict) or message.get("id") != request_id:
                continue
            if "error" in message:
                error = message["error"] if isinstance(message["error"], dict) else {}
                detail = redact(str(error.get("message", "官方 MCP 返回错误。")), token)[:500]
                raise AppError("mcp_error", detail, 502,
                               {"rpcCode": redact(error.get("code"), token)})
            if "result" in message:
                return redact(normalize_order_ids(message["result"]), token)
        return None

    def _chunks(self, response, deadline):
        """Bound both response size and total read time, including SSE heartbeats."""
        total = 0
        read = getattr(response, "read1", response.read)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AppError("remote_timeout", "官方 MCP 响应超时。", 504)
            # urllib's HTTPResponse exposes this socket on CPython. The generic
            # fallback still retains the opener's bounded per-read timeout.
            raw = getattr(getattr(response, "fp", None), "raw", None)
            remote_socket = getattr(raw, "_sock", None)
            if remote_socket is not None:
                remote_socket.settimeout(remaining)
            chunk = read(64 * 1024)
            total += len(chunk)
            if total > MAX_REMOTE_BYTES:
                raise AppError("remote_response_too_large", "官方 MCP 响应超过大小限制。", 502)
            if not chunk:
                return
            yield chunk

    def _sse_lines(self, response, deadline):
        buffer = b""
        for chunk in self._chunks(response, deadline):
            buffer += chunk
            while True:
                match = re.search(br"[\r\n]", buffer)
                if match is None:
                    break
                index = match.start()
                if buffer[index:] == b"\r":
                    break  # The next chunk may complete a CRLF pair.
                width = 2 if buffer[index:index + 2] == b"\r\n" else 1
                yield buffer[:index]
                buffer = buffer[index + width:]
        if buffer:
            yield buffer.rstrip(b"\r")
        yield b""  # Flush a final data event even if no blank line was sent.

    def _read_result(self, response, request_id, token, deadline):
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type == "text/event-stream":
            data_lines = []
            for line in self._sse_lines(response, deadline):
                if not line:
                    if data_lines:
                        try:
                            value = json.loads("\n".join(data_lines))
                        except (ValueError, UnicodeError):
                            raise AppError("invalid_mcp_response", "官方 MCP 返回的 SSE 数据格式无效。", 502)
                        result = self._response_message(value, request_id, token)
                        if result is not None:
                            return result
                        data_lines = []
                elif line.startswith(b"data:"):
                    try:
                        data = line[5:]
                        data_lines.append((data[1:] if data.startswith(b" ") else data).decode("utf-8"))
                    except UnicodeError:
                        raise AppError("invalid_mcp_response", "官方 MCP 返回的字符编码无效。", 502)
            raise AppError("missing_mcp_response", "官方 MCP 未返回本次请求的结果。", 502)
        if content_type != "application/json":
            raise AppError("invalid_mcp_response", "官方 MCP 返回了不支持的响应类型。", 502)
        payload = b"".join(self._chunks(response, deadline))
        try:
            value = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise AppError("invalid_mcp_response", "官方 MCP 返回的 JSON 格式无效。", 502)
        result = self._response_message(value, request_id, token)
        if result is None:
            raise AppError("missing_mcp_response", "官方 MCP 未返回本次请求的结果。", 502)
        return result

    def rpc(self, method, params=None, notification=False):
        token = self._token
        if not token:
            raise AppError("not_connected", "请先连接瑞幸官方 MCP。", 409)
        message = {"jsonrpc": "2.0", "method": method}
        request_id = None
        if not notification:
            with self._id_lock:
                self._next_id += 1
                request_id = self._next_id
            message["id"] = request_id
        if params is not None:
            message["params"] = params
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol_version,
            "User-Agent": "AgentMallOne/1.0",
        }
        if self._session_id:
            headers["MCP-Session-Id"] = self._session_id
        request = urllib.request.Request(
            MCP_ENDPOINT, data=json.dumps(message, ensure_ascii=False, allow_nan=False).encode("utf-8"),
            headers=headers, method="POST",
        )
        deadline = time.monotonic() + self.timeout
        try:
            with self._opener(request, timeout=self.timeout) as response:
                if method == "initialize":
                    session = response.headers.get("MCP-Session-Id")
                    if session:
                        if len(session) > 1024 or any(not 33 <= ord(char) <= 126 for char in session):
                            raise AppError("invalid_mcp_session", "官方 MCP 返回的会话信息无效。", 502)
                        self._session_id = session
                if notification:
                    return None
                return self._read_result(response, request_id, token, deadline)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            if status in (401, 403):
                raise AppError("authentication_failed", "瑞幸 Token 无效或已过期，请从官方平台重新复制。", 401)
            if status == 404 and self._session_id:
                raise AppError("session_expired", "官方 MCP 会话已失效，请重新连接；交易请求不会自动重试。", 409)
            if status == 429:
                raise AppError("remote_rate_limited", "官方 MCP 请求过于频繁，请稍后再试。", 429)
            raise AppError("remote_http_error", "官方 MCP 返回 HTTP %d。" % status, 502)
        except (socket.timeout, TimeoutError):
            raise AppError("remote_timeout", "官方 MCP 响应超时；如涉及订单，请先查询订单再决定下一步。", 504)
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                raise AppError("remote_timeout", "连接官方 MCP 超时。", 504)
            raise AppError("remote_unavailable", "无法连接瑞幸官方 MCP，请检查网络后重试。", 502)
        except (OSError, ValueError, UnicodeError):
            raise AppError("remote_unavailable", "官方 MCP 连接或响应异常。", 502)

    def initialize(self):
        result = self.rpc("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "agent-mall-one", "version": "1.0.0"},
        })
        if not isinstance(result, dict) or result.get("protocolVersion") not in SUPPORTED_PROTOCOLS:
            raise AppError("unsupported_mcp_version", "官方 MCP 返回了不支持的协议版本。", 502)
        self.protocol_version = result["protocolVersion"]
        self.server_info = result.get("serverInfo", {})
        self.rpc("notifications/initialized", notification=True)

    def list_tools(self):
        tools, seen_cursors, cursor = [], set(), None
        for _ in range(50):
            result = self.rpc("tools/list", {"cursor": cursor} if cursor else {})
            if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
                raise AppError("invalid_tool_list", "官方 MCP 返回的工具清单无效。", 502)
            for tool in result["tools"]:
                if not isinstance(tool, dict) or not isinstance(tool.get("name"), str):
                    raise AppError("invalid_tool_list", "官方 MCP 返回了无效工具。", 502)
                if len(tools) >= 1000:
                    raise AppError("invalid_tool_list", "官方 MCP 工具清单超过限制。", 502)
                tools.append(tool)
            cursor = result.get("nextCursor")
            if not cursor:
                return tools
            if not isinstance(cursor, str) or len(cursor) > 4096 or cursor in seen_cursors:
                raise AppError("invalid_tool_list", "官方 MCP 工具分页信息无效。", 502)
            seen_cursors.add(cursor)
        raise AppError("invalid_tool_list", "官方 MCP 工具分页超过限制。", 502)


class MallState:
    def __init__(self, client_factory=None, clock=None):
        self._client_factory = client_factory or MCPClient
        self._clock = clock or time.monotonic
        self._lock = threading.RLock()
        self._client = None
        self._tools = {}
        self._account_key = ""
        self._generation = 0
        self._connecting = False
        self._active_write = None
        self._writes = {}
        self._idempotency = {}

    def status(self):
        with self._lock:
            return {"connected": self._client is not None, "toolCount": len(self._tools),
                    "connecting": self._connecting, "writeInProgress": self._active_write is not None}

    def tools(self):
        with self._lock:
            tools = copy.deepcopy(list(self._tools.values()))
            for tool in tools:
                tool["requiresConfirmation"] = requires_confirmation(tool)
            return {"ok": True, "tools": tools, **self.status()}

    def connect(self, token):
        if not isinstance(token, str):
            raise AppError("invalid_token", "请输入从瑞幸官方平台复制的 Token。")
        token = token.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not token or len(token) > 16384 or any(ord(char) <= 32 or ord(char) >= 127 for char in token):
            raise AppError("invalid_token", "Token 为空或格式无效，请重新复制。")
        with self._lock:
            if self._connecting or self._active_write is not None:
                raise AppError("operation_in_progress", "连接或订单操作正在处理中，请稍后再试。", 409)
            self._connecting = True
            generation = self._generation
        client = None
        try:
            client = self._client_factory(token)
            client.initialize()
            tools = client.list_tools()
            with self._lock:
                if generation != self._generation:
                    raise AppError("connection_changed", "连接已被取消，请重新连接。", 409)
                previous = self._client
                self._client = client
                self._tools = {tool["name"]: tool for tool in tools}
                self._account_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
                self._generation += 1
                if previous:
                    previous.clear()
                result = self.tools()
                result.update({"connecting": False, "serverInfo": copy.deepcopy(client.server_info),
                               "protocolVersion": client.protocol_version, "endpoint": MCP_ENDPOINT})
                return result
        except Exception:
            if client:
                client.clear()
            raise
        finally:
            with self._lock:
                self._connecting = False

    def disconnect(self):
        with self._lock:
            if self._active_write is not None:
                raise AppError("write_in_progress", "订单请求正在处理中，完成后再断开。", 409)
            self._generation += 1
            if self._client:
                self._client.clear()
            self._client, self._tools, self._account_key = None, {}, ""
            return {"ok": True, **self.status()}

    def clear(self):
        """Dispose credentials and private results when a browser session ends."""
        with self._lock:
            self._generation += 1
            if self._client:
                self._client.clear()
            self._client, self._tools, self._account_key = None, {}, ""
            self._writes.clear()
            self._idempotency.clear()

    def call_tool(self, name, arguments, confirmed=False, idempotency_key=None, require_idempotency=False):
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise AppError("invalid_request", "工具名必须是文字，arguments 必须是 JSON 对象。")
        if idempotency_key is not None and (
            not isinstance(idempotency_key, str)
            or not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", idempotency_key)
        ):
            raise AppError("invalid_idempotency_key", "订单请求标识必须是 8 至 128 位字母、数字或 . _ : -。")
        idempotency_record = None
        with self._lock:
            if self._client is None:
                raise AppError("not_connected", "请先连接瑞幸官方 MCP。", 409)
            tool = self._tools.get(name)
            if tool is None:
                raise AppError("unknown_tool", "该工具不在本次官方 MCP 发现的清单中。", 404)
            write = requires_confirmation(tool)
            if write and self._connecting:
                raise AppError("operation_in_progress", "正在更新官方连接，完成后再执行订单操作。", 409)
            if write and confirmed is not True:
                raise AppError("confirmation_required", "此工具会修改订单或账户，请明确确认后执行。", 428,
                               {"name": name, "requiresConfirmation": True})
            if write and require_idempotency and idempotency_key is None:
                raise AppError("idempotency_required", "云模式订单操作需要唯一请求标识，请刷新页面后重试。", 428)
            validate_arguments(arguments, tool.get("inputSchema", {}))
            client = self._client
            write_key = None
            if write:
                canonical = json.dumps({"name": name, "arguments": arguments},
                                       sort_keys=True, separators=(",", ":"), allow_nan=False)
                write_key = self._account_key + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                if idempotency_key:
                    key = self._account_key + hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
                    previous = self._idempotency.get(key)
                    if previous is not None:
                        if previous["write_key"] != write_key:
                            raise AppError("idempotency_conflict", "该订单请求标识已用于另一组参数，请先核对上次订单。", 409)
                        if "result" in previous:
                            return {**copy.deepcopy(previous["result"]), "idempotentReplay": True}
                        if "error" in previous:
                            error = previous["error"]
                            details = {**copy.deepcopy(error["details"]), "idempotentReplay": True}
                            raise AppError(error["code"], error["message"], error["status"], details)
                        raise AppError("write_in_progress", "该订单请求正在处理，请等待或查询订单，不要重复提交。", 409)
                    if len(self._idempotency) >= MAX_IDEMPOTENCY_KEYS:
                        raise AppError("write_limit_reached", "当前会话的订单操作已达到限制，请先核对已有订单。", 429)
                now = self._clock()
                self._writes = {key: stamp for key, stamp in self._writes.items()
                                if now - stamp < DUPLICATE_WINDOW_SECONDS}
                if write_key in self._writes:
                    raise AppError("duplicate_write", "已拦截重复订单操作，请先查看上次结果或查询订单。", 409,
                                   {"retryAfterSeconds": max(1, math.ceil(
                                       DUPLICATE_WINDOW_SECONDS - (now - self._writes[write_key])))})
                if self._active_write is not None:
                    raise AppError("write_in_progress", "已有订单操作正在处理，请等待其结果。", 409)
                self._writes[write_key] = now
                self._active_write = write_key
                if idempotency_key:
                    idempotency_record = {"write_key": write_key}
                    self._idempotency[key] = idempotency_record
        try:
            result = client.rpc("tools/call", {"name": name, "arguments": arguments})
            response = {"ok": True, "name": name, "result": result,
                        "requiresConfirmation": write,
                        "toolError": isinstance(result, dict) and result.get("isError") is True}
            if idempotency_record is not None:
                with self._lock:
                    idempotency_record["result"] = copy.deepcopy(response)
            return response
        except AppError as exc:
            if write:
                exc.details = {"name": name, "writeOutcomeUnknown": True,
                               "nextStep": "先使用官方订单查询核对结果，不要自动重试交易。"}
                if idempotency_record is not None:
                    with self._lock:
                        idempotency_record["error"] = {"code": exc.code, "message": exc.message,
                                                       "status": exc.status, "details": copy.deepcopy(exc.details)}
            raise
        except Exception:
            if not write:
                raise
            exc = AppError("write_outcome_unknown", "订单操作结果无法确认，请先查询官方订单。", 502,
                           {"name": name, "writeOutcomeUnknown": True,
                            "nextStep": "先使用官方订单查询核对结果，不要自动重试交易。"})
            if idempotency_record is not None:
                with self._lock:
                    idempotency_record["error"] = {"code": exc.code, "message": exc.message,
                                                   "status": exc.status, "details": copy.deepcopy(exc.details)}
            raise exc from None
        finally:
            if write_key is not None:
                with self._lock:
                    self._active_write = None


class BrowserSessions:
    """Unpredictable, host-only cookies map to separate memory-only MCP states."""

    def __init__(self, state_factory=None, clock=None, ttl=BROWSER_SESSION_TTL, limit=MAX_BROWSER_SESSIONS):
        self._state_factory = state_factory or MallState
        self._clock = clock or time.monotonic
        self.ttl, self.limit = ttl, limit
        self._lock = threading.RLock()
        self._sessions = {}

    def acquire(self, cookies):
        session = cookie_value(cookies, MCP_SESSION_COOKIE)
        key = hashlib.sha256(session.encode("ascii")).hexdigest() if session else None
        with self._lock:
            now = self._clock()
            for expired_key, record in list(self._sessions.items()):
                if record["expires"] <= now and record["active"] == 0:
                    record["state"].clear()
                    del self._sessions[expired_key]
            record = self._sessions.get(key)
            if record is None:
                if len(self._sessions) >= self.limit:
                    raise AppError("session_limit_reached", "服务当前会话较多，请稍后再试。", 429)
                # Never adopt a cookie supplied by an unknown browser.
                session = secrets.token_urlsafe(32)
                key = hashlib.sha256(session.encode("ascii")).hexdigest()
                record = {"state": self._state_factory(), "expires": now + self.ttl, "active": 0}
                self._sessions[key] = record
            record["active"] += 1
            record["expires"] = now + self.ttl
            return record["state"], key, make_cookie(MCP_SESSION_COOKIE, session, self.ttl, True)

    def release(self, key):
        with self._lock:
            record = self._sessions.get(key)
            if record:
                record["active"] -= 1

    def clear(self):
        with self._lock:
            for record in self._sessions.values():
                record["state"].clear()
            self._sessions.clear()


class MallHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, state=None, static_dir=None, auth=None, *, cloud_mode=False,
                 trusted_origins=None, state_factory=None, session_clock=None,
                 session_ttl=BROWSER_SESSION_TTL):
        self.cloud_mode = cloud_mode
        # Allow in-flight transactions to finish during a cloud shutdown.
        self.daemon_threads = not cloud_mode
        if cloud_mode and state is not None:
            raise ValueError("云模式不能使用共享或预先连接的 MallState；请使用 state_factory。")
        self.state = None if cloud_mode else (state or MallState())
        self.auth = auth or AuthManager()
        self.static_dir = (Path(static_dir) if static_dir else STATIC_DIR).resolve()
        configured_origins = [normalize_origin(origin, require_https=cloud_mode)
                              for origin in trusted_origins or []]
        self.trusted_origins = set(configured_origins)
        if cloud_mode and not self.trusted_origins:
            raise ValueError("云模式需要 PUBLIC_ORIGIN（或 RENDER_EXTERNAL_URL）配置公网 HTTPS 站点地址。")
        self.sessions = BrowserSessions(state_factory, clock=session_clock, ttl=session_ttl) if cloud_mode else None
        super().__init__(address, MallHandler)
        catalog_origin = (configured_origins[0] if cloud_mode
                          else "http://127.0.0.1:%d" % self.server_address[1])
        self.catalog = OCPCatalog(catalog_origin, MCP_ENDPOINT)

    def server_close(self):
        super().server_close()
        if self.sessions:
            self.sessions.clear()
        if self.state:
            self.state.clear()
        self.auth.clear()


class MallHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # Request URLs can contain pasted credentials. Never log URLs or bodies.
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(REQUEST_TIMEOUT)

    def _request_origin(self):
        host = self.headers.get("Host", "").lower()
        for origin in self._allowed_origins():
            if urllib.parse.urlsplit(origin).netloc == host:
                return origin
        return "http://" + host

    def _allowed_origins(self):
        if self.server.cloud_mode:
            return self.server.trusted_origins
        port = self.server.server_address[1]
        return {"http://127.0.0.1:%d" % port, "http://localhost:%d" % port} | self.server.auth.allowed_origins

    def _check_local_request(self, oauth_callback=False):
        allowed_origins = self._allowed_origins()
        allowed_hosts = {urllib.parse.urlsplit(origin).netloc for origin in allowed_origins}
        if len(self.headers.get_all("Host", [])) != 1 or self.headers.get("Host", "").lower() not in allowed_hosts:
            raise AppError("invalid_host", "请通过已配置的站点地址访问服务。", 403)
        path = urllib.parse.urlsplit(self.path).path
        # Public page navigation from GitHub must work. State-bearing API routes
        # remain same-origin; OAuth GET callbacks validate their own state.
        if self.server.cloud_mode and self.command in {"GET", "HEAD"} and not path.startswith(("/api/", "/ocp/")):
            return
        origin = self.headers.get("Origin")
        if len(self.headers.get_all("Origin", [])) > 1:
            raise AppError("invalid_origin", "请求的站点信息无效。", 403)
        if (origin and origin.lower() != self._request_origin()
                and not oauth_callback):
            raise AppError("invalid_origin", "已拒绝来自其他网站的请求。", 403)
        if self.server.cloud_mode and self.command == "POST" and not origin:
            raise AppError("origin_required", "云模式接口需要同源 Origin 请求头。", 403)
        if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site" and not oauth_callback:
            raise AppError("invalid_origin", "已拒绝来自其他网站的请求。", 403)

    def _state(self):
        if not self.server.cloud_mode:
            return self.server.state
        if not hasattr(self, "_session_key"):
            state, self._session_key, self._session_cookie = self.server.sessions.acquire(self.headers.get("Cookie", ""))
            self._browser_state = state
        return self._browser_state

    def _release_session(self):
        if hasattr(self, "_session_key"):
            self.server.sessions.release(self._session_key)
            del self._session_key

    def _reply(self, status, data, content_type="application/json; charset=utf-8", head=False, extra_headers=None):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        if getattr(self, "_session_cookie", None):
            self.send_header("Set-Cookie", self._session_cookie)
        for name, value in extra_headers or []:
            self.send_header(name, value)
        self.end_headers()
        self.close_connection = True
        if not head:
            self.wfile.write(data)

    def _error(self, exc):
        try:
            self._reply(exc.status, exc.as_json(), head=self.command == "HEAD")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise AppError("invalid_request", "不支持分块请求体。")
        length_string = self.headers.get("Content-Length", "0")
        try:
            length = int(length_string)
        except (ValueError, TypeError):
            raise AppError("invalid_request", "请求长度无效。")
        if length < 0 or length > MAX_BODY_BYTES:
            raise AppError("request_too_large", "请求体超过大小限制。", 413)
        if length == 0:
            return {}
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise AppError("invalid_content_type", "请求体必须使用 application/json。", 415)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise AppError("invalid_request", "请求体不完整。")
        try:
            body = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise AppError("invalid_json", "请求体必须是有效 JSON。")
        if not isinstance(body, dict):
            raise AppError("invalid_request", "请求体必须是 JSON 对象。")
        return body

    def do_POST(self):
        try:
            self._check_local_request()
            path = urllib.parse.urlsplit(self.path).path
            body = self._json_body()
            cookies = self.headers.get("Cookie", "")
            origin = self._request_origin()
            if path == "/api/auth/start":
                result, set_cookies = self.server.auth.start(body.get("provider"), cookies, origin)
                self._reply(200, result, extra_headers=[("Set-Cookie", value) for value in set_cookies])
                return
            if path == "/api/auth/logout":
                if self.server.cloud_mode:
                    self._state().disconnect()
                result, set_cookies = self.server.auth.logout(cookies, origin)
                self._reply(200, result, extra_headers=[("Set-Cookie", value) for value in set_cookies])
                return
            if path == "/api/connect":
                result = self._state().connect(body.get("token"))
            elif path == "/api/disconnect":
                result = self._state().disconnect()
            elif path == "/api/tool":
                idempotency_key = body.get("idempotencyKey")
                header_key = self.headers.get("Idempotency-Key")
                if len(self.headers.get_all("Idempotency-Key", [])) > 1 or (
                    header_key is not None and idempotency_key is not None and header_key != idempotency_key
                ):
                    raise AppError("invalid_idempotency_key", "订单请求标识不一致。")
                result = self._state().call_tool(body.get("name"), body.get("arguments", {}),
                                                body.get("confirmed", False),
                                                idempotency_key=header_key if header_key is not None else idempotency_key,
                                                require_idempotency=self.server.cloud_mode)
            elif path == "/ocp/query":
                result = self.server.catalog.query(body)
            elif path == "/ocp/resolve":
                result = self.server.catalog.resolve(body)
            else:
                raise AppError("not_found", "接口不存在。", 404)
            self._reply(200, result)
        except (AppError, CatalogError, AuthError) as exc:
            self._error(exc)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (socket.timeout, TimeoutError):
            self._error(AppError("request_timeout", "本地请求超时。", 408))
        except Exception:
            self._error(AppError("internal_error", "本地服务处理请求失败。", 500))
        finally:
            self._release_session()

    def _get(self, head=False):
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path == "/healthz":
                self._reply(200, {"ok": True, "service": "agent-mall-one",
                                  "mode": "cloud" if self.server.cloud_mode else "local"}, head=head)
                return
            callbacks = {"/auth/callback/wechat": "wechat", "/auth/callback/alipay": "alipay"}
            self._check_local_request(oauth_callback=path in callbacks and not head)
            cookies = self.headers.get("Cookie", "")
            if path in callbacks:
                if head:
                    raise AppError("method_not_allowed", "OAuth 回调需要 GET 请求。", 405)
                try:
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query, keep_blank_values=True,
                                                  max_num_fields=20)
                    set_cookies = self.server.auth.callback(callbacks[path], query, cookies, self._request_origin())
                    headers = [("Location", "/?login=success")] + [("Set-Cookie", value) for value in set_cookies]
                except Exception:
                    headers = [("Location", "/?login=failed")]
                self._reply(302, b"", extra_headers=headers)
                return
            if path == "/api/auth/providers":
                self._reply(200, self.server.auth.providers(self._request_origin()), head=head)
                return
            if path == "/api/auth/me":
                self._reply(200, self.server.auth.me(cookies), head=head)
                return
            if path == "/api/health":
                self._reply(200, {"ok": True, "service": "agent-mall-one",
                                  "endpoint": MCP_ENDPOINT,
                                  "mode": "cloud" if self.server.cloud_mode else "local",
                                  **self._state().status()}, head=head)
                return
            if path == "/api/tools":
                self._reply(200, {**self._state().tools(),
                                  "mode": "cloud" if self.server.cloud_mode else "local"}, head=head)
                return
            if path == "/api/catalog-evidence":
                self._reply(200, self.server.catalog.evidence(), head=head)
                return
            ocp_routes = {"/.well-known/ocp-catalog": self.server.catalog.discovery,
                          "/ocp/manifest": self.server.catalog.manifest,
                          "/ocp/health": self.server.catalog.health}
            if path in ocp_routes:
                self._reply(200, ocp_routes[path](), head=head)
                return
            if path.startswith("/ocp/"):
                raise CatalogError("not_found", "OCP 接口不存在。", 404)
            if path.startswith("/api/"):
                raise AppError("not_found", "接口不存在。", 404)
            relative = urllib.parse.unquote(path).lstrip("/") or "index.html"
            if self.server.cloud_mode and Path(relative).name.lower() == "current-order.json":
                raise AppError("not_found", "文件不存在。", 404)
            target = (self.server.static_dir / relative).resolve()
            try:
                target.relative_to(self.server.static_dir)
            except ValueError:
                raise AppError("not_found", "文件不存在。", 404)
            if self.server.cloud_mode and target.name.lower() == "current-order.json":
                raise AppError("not_found", "文件不存在。", 404)
            if not target.is_file():
                raise AppError("not_found", "文件不存在。", 404)
            data = target.read_bytes()
            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type == "application/javascript":
                content_type += "; charset=utf-8"
            self._reply(200, data, content_type, head=head)
        except (AppError, CatalogError, AuthError) as exc:
            self._error(exc)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error(AppError("internal_error", "本地服务无法读取文件。", 500))
        finally:
            self._release_session()

    def do_GET(self):
        self._get()

    def do_HEAD(self):
        self._get(head=True)

    def do_OPTIONS(self):
        self._error(AppError("method_not_allowed", "请通过同一本地页面访问接口。", 405))


def main():
    parser = argparse.ArgumentParser(description="一念 One（瑞幸官方 MCP），支持本地和单实例云部署")
    parser.add_argument("--cloud", action="store_true", default=os.environ.get("CLOUD_MODE", "").lower() in {"1", "true", "yes"})
    parser.add_argument("--port", type=int, default=os.environ.get("PORT", "8765"))
    parser.add_argument("--host", default=os.environ.get("HOST"))
    parser.add_argument("--public-origin", default=os.environ.get("PUBLIC_ORIGIN") or os.environ.get("RENDER_EXTERNAL_URL"))
    parser.add_argument("--trusted-origin", action="append", default=[])
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port 必须介于 1 和 65535")
    host = args.host or ("0.0.0.0" if args.cloud else "127.0.0.1")
    if not args.cloud and host not in {"127.0.0.1", "localhost"}:
        parser.error("非本机监听必须显式启用 --cloud，并配置 HTTPS PUBLIC_ORIGIN。")
    origins = ([args.public_origin] if args.public_origin else []) + args.trusted_origin
    origins += [item.strip() for item in os.environ.get("TRUSTED_ORIGINS", "").split(",") if item.strip()]
    try:
        server = MallHTTPServer((host, args.port), cloud_mode=args.cloud, trusted_origins=origins)
    except ValueError as exc:
        parser.error(str(exc))
    except OSError:
        parser.exit(1, "无法启动：监听地址或端口不可用。\n")
    if args.cloud:
        print("云模式已启动；站点：%s；会话与订单请求标识仅保存在当前单实例内存中。" % ", ".join(sorted(server.trusted_origins)), flush=True)
    else:
        print("本地智能体商城已启动：http://127.0.0.1:%d" % args.port, flush=True)
    def terminate(signum, frame):
        # shutdown must run outside the thread serving the HTTP event loop.
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, terminate)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
