"""Local OCP Catalog 1.0 read surface, using only the Python standard library.

Response shapes follow the official MIT-licensed Python example and schema:
https://github.com/Open-Commerce-Protocol/OCP-Catalog/blob/main/examples/python/server.py
https://github.com/Open-Commerce-Protocol/OCP-Catalog/blob/main/packages/ocp-schema/src/index.ts

This module indexes locally authored service definitions, not an authorized
merchant product feed. It never connects to a vendor or performs a transaction.
"""

import base64
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


CATALOG_ID = "cat_agent_mall_local_demo"
CATALOG_NAME = "智能体商城 · 本地演示服务目录"
PROVIDER_ID = "agent_mall_local_demo"
OBJECT_TYPE = "agent-mall.service"
QUERY_PACK = "ocp.query.keyword.v1"
CAPABILITY_ID = "agent-mall.service.keyword-search.v1"
OFFICIAL_PLATFORM_URL = "https://open.lkcoffee.com/mcp"
EXAMPLE_SOURCE_URL = "https://github.com/Open-Commerce-Protocol/OCP-Catalog/blob/main/examples/python/server.py"
SCHEMA_SOURCE_URL = "https://github.com/Open-Commerce-Protocol/OCP-Catalog/blob/main/packages/ocp-schema/src/index.ts"
SOURCE_NOTE = "本地手工定义的演示服务入口，不是瑞幸官方商品目录；价格、库存和具体参数须通过用户授权后的官方 MCP 实时查询。"

SERVICES = (
    {
        "id": "luckin-store-discovery",
        "title": "瑞幸咖啡 · 附近门店查询",
        "summary": "本地演示服务入口：连接瑞幸官方 MCP，查询附近门店及门店信息。",
        "category": "coffee",
        "keywords": "瑞幸 luckin coffee 咖啡 附近 门店 地址 store shop location",
        "tools": (("queryShopList", "查询附近门店", False),),
    },
    {
        "id": "luckin-product-search",
        "title": "瑞幸咖啡 · 商品与规格查询",
        "summary": "本地演示服务入口：在官方 MCP 中搜索商品、查看详情和切换规格；不预设价格或库存。",
        "category": "coffee",
        "keywords": "瑞幸 luckin coffee 咖啡 商品 美式 拿铁 生椰 温度 冰 热 甜度 menu product",
        "tools": (("searchProductForMcp", "搜索官方商品", False),
                  ("queryProductDetailInfo", "查看官方商品详情", False),
                  ("switchProduct", "查询商品规格切换", False)),
    },
    {
        "id": "luckin-order-workflow",
        "title": "瑞幸咖啡 · 订单预览与确认执行",
        "summary": "本地演示服务入口：先通过官方 MCP 预览订单，用户明确确认后再创建或取消订单，并查询结果。",
        "category": "coffee",
        "keywords": "瑞幸 luckin coffee 咖啡 点单 下单 订单 预览 优惠 取消 order checkout coupon",
        "tools": (("previewOrder", "预览官方订单", False),
                  ("queryOrderDetailInfo", "查询官方订单结果", False),
                  ("createOrder", "确认后创建官方订单", True),
                  ("cancelOrder", "确认后取消官方订单", True)),
    },
)


def timestamp(value=None):
    return (value or datetime.now(timezone.utc)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CatalogError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def as_json(self):
        return {"error": {"code": self.code, "message": self.message}}


class OCPCatalog:
    def __init__(self, base_url, mcp_endpoint):
        self.base_url = base_url.rstrip("/")
        self.mcp_endpoint = mcp_endpoint
        self.updated_at = timestamp(datetime.fromtimestamp(Path(__file__).stat().st_mtime, timezone.utc))
        self._cursor_key = secrets.token_bytes(32)

    def discovery(self):
        return {
            "ocp_version": "1.0", "kind": "WellKnownCatalogDiscovery",
            "catalog_id": CATALOG_ID, "catalog_name": CATALOG_NAME,
            "manifest_url": self.base_url + "/ocp/manifest",
            "health_url": self.base_url + "/ocp/health",
            "query_url": self.base_url + "/ocp/query",
            "resolve_url": self.base_url + "/ocp/resolve",
        }

    def manifest(self):
        return {
            "ocp_version": "1.0", "kind": "CatalogManifest",
            "id": "manifest_" + CATALOG_ID, "catalog_id": CATALOG_ID,
            "catalog_name": CATALOG_NAME,
            "description": SOURCE_NOTE + " 本节点仅在本机提供只读目录，未注册外部 Registration 节点，不声明其他品牌执行授权。",
            "registry_visibility": "private",
            "endpoints": {
                "health": {"url": self.base_url + "/ocp/health", "method": "GET"},
                "query": {"url": self.base_url + "/ocp/query", "method": "POST"},
                "resolve": {"url": self.base_url + "/ocp/resolve", "method": "POST"},
            },
            "query_capabilities": [{
                "capability_id": CAPABILITY_ID, "name": "本地演示服务关键词查询",
                "description": "查询本地服务定义的标题、摘要和关键词；不查询官方商品或库存。",
                "query_packs": [{"pack_id": QUERY_PACK, "query_modes": ["keyword"],
                                 "description": "OCP keyword query pack；支持 brand、category、provider_id 精确过滤。",
                                 "metadata": {"supported_filters": ["brand", "category", "provider_id"]}}],
                "supports_explain": True, "supports_resolve": True,
                "metadata": {"source_kind": "local_demo_service_definition", "execution_transport": "mcp"},
            }],
            "object_contracts": [],
            "data_profile": {"catalog_entry_count": len(SERVICES),
                             "object_counts": [{"object_type": OBJECT_TYPE, "count": len(SERVICES)}],
                             "counted_at": timestamp()},
        }

    def health(self):
        return {
            "ocp_version": "1.0", "kind": "CatalogHealth", "catalog_id": CATALOG_ID,
            "status": "healthy", "ready": True, "checked_at": timestamp(),
            "details": {"scope": "local_catalog_only", "source_kind": "local_demo_service_definition",
                        "entry_count": len(SERVICES), "vendor_health_checked": False},
            "dependencies": [],
        }

    def evidence(self):
        """Application metadata, deliberately outside the OCP response schemas."""
        return {
            "ok": True, "catalog_id": CATALOG_ID, "source_kind": "local_demo_service_definition",
            "scope": "本地服务目录，只读查询与解析；未注册外部 Registration 节点。",
            "entry_count": len(SERVICES), "provider_id": PROVIDER_ID,
            "object_type_note": "agent-mall.service 为本应用定义的对象类型，不是协议内置商品类型。",
            "source_note": SOURCE_NOTE,
            "schema_sources": [
                {"url": EXAMPLE_SOURCE_URL, "git_blob_sha": "c402938b0defd996448ca58fd78105d88562e112"},
                {"url": SCHEMA_SOURCE_URL, "git_blob_sha": "5a2d067740936bb0eb8bcaf40f58ad0be4e178c3"},
            ],
            "execution": {"platform_url": OFFICIAL_PLATFORM_URL, "mcp_endpoint": self.mcp_endpoint,
                          "token_required": True, "official_tools_discovery_required": True,
                          "transaction_confirmation_required": True, "other_brands_authorized": False},
            "live_product_data_included": False,
            "protocol_endpoints": ["/.well-known/ocp-catalog", "/ocp/manifest", "/ocp/health",
                                   "/ocp/query", "/ocp/resolve"],
        }

    def _entry_id(self, service):
        return "entry_" + PROVIDER_ID + "_" + service["id"]

    def _attributes(self, service):
        return {
            "brand": "瑞幸", "category": service["category"],
            "source_kind": "local_demo_service_definition", "source_note": SOURCE_NOTE,
            "provider_role": "local_demo_author", "official_platform_url": OFFICIAL_PLATFORM_URL,
            "execution_endpoint": self.mcp_endpoint, "execution_transport": "mcp",
            "official_tool_names": [tool[0] for tool in service["tools"]],
            "requires_user_token": True, "live_price_available": False,
            "inventory": {"availability_status": "unknown"},
        }

    def _entry(self, service):
        return {
            "kind": "CatalogEntry", "catalog_id": CATALOG_ID,
            "entry_id": self._entry_id(service), "provider_id": PROVIDER_ID,
            "object_id": service["id"], "object_type": OBJECT_TYPE,
            "commercial_object_id": "co_local_demo_" + service["id"],
            "title": service["title"], "summary": service["summary"],
            "attributes": self._attributes(service),
        }

    def _check_common(self, body, kind):
        if not isinstance(body, dict):
            raise CatalogError("invalid_request", "请求体必须是 JSON 对象。")
        if "ocp_version" in body and body["ocp_version"] != "1.0":
            raise CatalogError("unsupported_version", "本节点支持 OCP Catalog 1.0。")
        if "kind" in body and body["kind"] != kind:
            raise CatalogError("invalid_kind", "请求 kind 必须为 " + kind + "。")
        if "catalog_id" in body and body["catalog_id"] != CATALOG_ID:
            raise CatalogError("unknown_catalog", "请求的目录不是此本地演示目录。", 404)

    def _cursor(self, start, query_hash):
        payload = json.dumps({"start": start, "query_hash": query_hash}, separators=(",", ":")).encode()
        signature = hmac.new(self._cursor_key, payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")

    def _cursor_start(self, cursor, query_hash):
        try:
            raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
            signature, payload = raw[:32], raw[32:]
            if not hmac.compare_digest(signature, hmac.new(self._cursor_key, payload, hashlib.sha256).digest()):
                raise ValueError()
            data = json.loads(payload)
            if data.get("query_hash") != query_hash or type(data.get("start")) is not int or data["start"] < 0:
                raise ValueError()
            return data["start"]
        except (ValueError, KeyError, TypeError):
            raise CatalogError("invalid_cursor", "分页 cursor 无效、已失效或不属于本次查询。")

    def query(self, body):
        self._check_common(body, "CatalogQueryRequest")
        allowed = {"ocp_version", "kind", "catalog_id", "query_pack", "query_mode", "query",
                   "filters", "limit", "offset", "cursor", "explain"}
        if set(body) - allowed:
            raise CatalogError("invalid_request", "查询包含协议未定义的字段。")
        if body.get("query_pack", QUERY_PACK) != QUERY_PACK:
            raise CatalogError("unsupported_query_pack", "本目录仅声明 ocp.query.keyword.v1。")
        if body.get("query_mode", "keyword") != "keyword":
            raise CatalogError("unsupported_query_mode", "本目录仅支持关键词查询。")
        term, limit, filters = body.get("query", ""), body.get("limit", 20), body.get("filters", {})
        if not isinstance(term, str) or len(term) > 500:
            raise CatalogError("invalid_request", "query 必须是至多 500 字符的文字。")
        if type(limit) is not int or not 1 <= limit <= 50:
            raise CatalogError("invalid_request", "limit 必须是 1 至 50 的整数。")
        if type(body.get("offset", 0)) is not int or body.get("offset", 0) != 0:
            raise CatalogError("invalid_request", "OCP offset 固定为 0；翻页请使用 cursor。")
        if type(body.get("explain", True)) is not bool:
            raise CatalogError("invalid_request", "explain 必须是布尔值。")
        if not isinstance(filters, dict):
            raise CatalogError("invalid_request", "filters 必须是 JSON 对象。")
        if set(filters) - {"brand", "category", "provider_id"}:
            raise CatalogError("unsupported_filters", "本服务目录仅支持 brand、category、provider_id 过滤，不提供价格或库存筛选。")
        if any(not isinstance(value, str) or not value for value in filters.values()):
            raise CatalogError("invalid_request", "过滤条件必须是非空文字。")
        cursor = body.get("cursor")
        if "cursor" in body and (not isinstance(cursor, str) or not 1 <= len(cursor) <= 512):
            raise CatalogError("invalid_cursor", "cursor 必须是 1 至 512 字符的文字。")
        terms = term.strip().casefold().split()
        matches = []
        for service in SERVICES:
            haystack = " ".join((service["title"], service["summary"], service["keywords"], service["category"])).casefold()
            values = {"brand": "瑞幸", "category": service["category"], "provider_id": PROVIDER_ID}
            if all(part in haystack for part in terms) and all(values[key].casefold() == value.casefold() for key, value in filters.items()):
                matches.append(service)
        query_hash = hashlib.sha256(json.dumps({"query": term, "filters": filters}, sort_keys=True,
                                               ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        start = self._cursor_start(cursor, query_hash) if cursor else 0
        page_services = matches[start:start + limit]
        has_more = start + limit < len(matches)
        page = {"limit": limit, "offset": 0, "has_more": has_more}
        if has_more:
            page["next_cursor"] = self._cursor(start + limit, query_hash)
        show_explain = body.get("explain", True)
        return {
            "ocp_version": "1.0", "kind": "CatalogQueryResult", "id": "qry_" + str(uuid.uuid4()),
            "catalog_id": CATALOG_ID, "query_pack": QUERY_PACK, "query_mode": "keyword", "query": term,
            "result_count": len(page_services), "page": page,
            "entries": [{"entry": self._entry(service), "score": 1.0,
                         "explain": ["匹配本地服务定义的关键词；不是实时商品搜索结果。"] if show_explain else []}
                        for service in page_services],
            "policy_summary": {"selected_capability_id": CAPABILITY_ID, "selected_query_pack": QUERY_PACK,
                               "query_mode": "keyword", "supports_explain": True,
                               "accepted_filters": list(filters), "rejected_filters": [],
                               "warnings": [SOURCE_NOTE]},
            "explain": [SOURCE_NOTE] if show_explain else [],
        }

    def _action(self, name, label, confirmation, expires):
        return {
            "action_id": name, "action_type": "api", "label": label,
            "description": "标准 MCP tools/call；业务 arguments 以用户连接后官方 tools/list 返回的 inputSchema 为准。",
            "entrypoint": {"url": self.mcp_endpoint, "method": "POST"},
            "input_schema": {
                "type": "object", "required": ["jsonrpc", "id", "method", "params"],
                "properties": {
                    "jsonrpc": {"type": "string", "const": "2.0"},
                    "id": {"type": ["integer", "string"]},
                    "method": {"type": "string", "const": "tools/call"},
                    "params": {"type": "object", "required": ["name", "arguments"],
                               "properties": {"name": {"type": "string", "const": name},
                                              "arguments": {"type": "object",
                                                            "description": "通过官方 tools/list 发现并校验具体参数 schema。"}}},
                },
            },
            "auth_requirements": {"scheme": "Bearer", "transport": "streamable_http",
                                  "token_source": OFFICIAL_PLATFORM_URL,
                                  "requires_user_token": True, "requires_initialize": True,
                                  "requires_official_tools_discovery": True},
            "requires_user_confirmation": confirmation, "expires_at": expires,
        }

    def resolve(self, body):
        self._check_common(body, "ResolveRequest")
        entry_id = body.get("entry_id")
        if not isinstance(entry_id, str) or not entry_id:
            raise CatalogError("invalid_request", "entry_id 必须是非空文字。")
        purpose = body.get("purpose", "view")
        if not isinstance(purpose, str) or purpose not in {"view", "checkout", "contact", "workflow"}:
            raise CatalogError("invalid_request", "purpose 必须为 view、checkout、contact 或 workflow。")
        if type(body.get("live_check", True)) is not bool:
            raise CatalogError("invalid_request", "live_check 必须是布尔值。")
        requested = body.get("requested_fields", [])
        if not isinstance(requested, list) or any(not isinstance(field, str) or not field for field in requested):
            raise CatalogError("invalid_request", "requested_fields 必须是非空文字组成的数组。")
        service = next((item for item in SERVICES if self._entry_id(item) == entry_id), None)
        if service is None:
            raise CatalogError("not_found", "本地目录中没有此 entry_id。", 404)
        now = datetime.now(timezone.utc)
        expires = timestamp(now + timedelta(minutes=15))
        attributes = self._attributes(service)
        if requested:
            attributes = {key: value for key, value in attributes.items()
                          if key in requested or key in {"source_kind", "source_note"}}
        actions = [self._action(name, label, confirmation, expires) for name, label, confirmation in service["tools"]]
        actions.append({"action_id": "view_official_platform", "action_type": "url", "label": "查看瑞幸官方开放平台",
                        "entrypoint": {"url": OFFICIAL_PLATFORM_URL, "method": "GET"},
                        "requires_user_confirmation": False})
        if purpose == "contact":
            actions = []  # No verified contact action exists in this local demo.
        return {
            "ocp_version": "1.0", "kind": "ResolvableReference", "id": "res_" + str(uuid.uuid4()),
            "catalog_id": CATALOG_ID, "entry_id": entry_id,
            "commercial_object_id": "co_local_demo_" + service["id"],
            "object_id": service["id"], "object_type": OBJECT_TYPE, "provider_id": PROVIDER_ID,
            "title": service["title"], "visible_attributes": attributes,
            "access": {"visibility": "private", "permission_state": "limited", "redacted_fields": [],
                       "policy_notes": [SOURCE_NOTE, "本地解析不授予官方 MCP 访问或交易授权；执行必须先发现官方工具并使用用户 Token。"]},
            "live_checks": [{"check_id": "official_mcp_execution_availability",
                             "status": "unknown" if body.get("live_check", True) else "not_applicable",
                             "checked_at": timestamp(now),
                             "summary": "仅解析本地定义；没有请求官方 MCP，也没有核查实时商品、价格或库存。",
                             "details": {"vendor_request_performed": False, "source_kind": "local_demo_service_definition"}}],
            "action_bindings": actions,
            "freshness": {"object_updated_at": self.updated_at, "resolved_at": timestamp(now)},
            "expires_at": expires,
        }
