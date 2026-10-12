"""校雠 — Web 产品版

一个完整的 Web 应用，包含：
  - OCP Catalog Node（5 个协议端点，合规）
  - Web UI（产品界面，浏览器打开即用）
  - Agent API（/api/agent 解析意图+发现+筛选+注释，/api/purchase 完成交易）

运行：
  python web_server.py
然后浏览器打开 http://localhost:4401
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from books_data import BOOKS
from agent import (
    parse_intent,
    assess_versions,
    generate_cultural_annotation,
    AUDIENCE_CRITERIA,
)

CATALOG_ID = "cat_classics_jiaochou"
CATALOG_NAME = "校雠·古籍版本目录"
PROVIDER_ID = "classics"
PORT = int(os.environ.get("PORT", "4401"))
BASE_URL = os.environ.get("PUBLIC_BASE_URL", f"http://localhost:{PORT}").rstrip("/")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _entry_id(book: dict) -> str:
    return f"entry_{PROVIDER_ID}_{book['id']}"


def _to_entry(book: dict) -> dict:
    return {
        "kind": "CatalogEntry",
        "catalog_id": CATALOG_ID,
        "entry_id": _entry_id(book),
        "provider_id": PROVIDER_ID,
        "object_id": book["id"],
        "object_type": "ocp.commerce.product",
        "title": book["title"],
        "summary": book["summary"],
        "attributes": {
            "brand": book["brand"],
            "category": book["category"],
            "price": {"currency": book["currency"], "amount": book["amount"]},
            "inventory": {"availability_status": book["availability"]},
            "product_url": book["url"],
            "work": book["work"],
            "target_audience": book["target_audience"],
            "annotation_style": book["annotation_style"],
            "base_text": book["base_text"],
            "scholarly_rating": book["scholarly_rating"],
            "readability": book["readability"],
            "recommended_for": book["recommended_for"],
            "editor": book["editor"],
            "era": book["era"],
        },
    }


def _find_book_by_entry_id(entry_id: str) -> dict | None:
    return next((b for b in BOOKS if _entry_id(b) == entry_id), None)


# ============================================================
#  OCP 协议端点
# ============================================================

def well_known_discovery() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "WellKnownCatalogDiscovery",
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "manifest_url": f"{BASE_URL}/ocp/manifest",
        "health_url": f"{BASE_URL}/ocp/health",
        "query_url": f"{BASE_URL}/ocp/query",
        "resolve_url": f"{BASE_URL}/ocp/resolve",
        "contracts_url": f"{BASE_URL}/ocp/contracts",
    }


def manifest() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "CatalogManifest",
        "id": f"manifest_{CATALOG_ID}",
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "description": "古籍版本目录——按版本学标准索引经典书籍的不同版本。",
        "registry_visibility": "public",
        "endpoints": {
            "health": {"url": f"{BASE_URL}/ocp/health", "method": "GET"},
            "query": {"url": f"{BASE_URL}/ocp/query", "method": "POST"},
            "resolve": {"url": f"{BASE_URL}/ocp/resolve", "method": "POST"},
            "contracts": {"url": f"{BASE_URL}/ocp/contracts", "method": "GET"},
        },
        "query_capabilities": [
            {
                "capability_id": "ocp.classics.book.search.v1",
                "name": "古籍版本搜索",
                "description": "按书名搜索该经典书的所有版本。",
                "query_packs": [
                    {
                        "pack_id": "ocp.query.keyword.v1",
                        "description": "按书名、标题、出版社、注译者做关键词匹配。",
                        "query_modes": ["keyword"],
                    }
                ],
                "supports_explain": True,
                "supports_resolve": True,
            }
        ],
        "object_contracts": [],
    }


def health() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "CatalogHealth",
        "catalog_id": CATALOG_ID,
        "status": "healthy",
        "ready": True,
        "checked_at": _now(),
    }


def contracts() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "ObjectContractList",
        "catalog_id": CATALOG_ID,
        "object_contracts": [],
        "note": "只读目录节点。",
    }


def ocp_query(body: dict) -> dict:
    # 边界用例：用了未声明的 query_pack → 400
    query_pack = body.get("query_pack", "ocp.query.keyword.v1")
    if query_pack not in ("ocp.query.keyword.v1",):
        return {
            "ocp_version": "1.0",
            "kind": "CatalogQueryResult",
            "id": f"qry_{uuid.uuid4()}",
            "catalog_id": CATALOG_ID,
            "error": {"code": "bad_request", "message": f"Undeclared query_pack: {query_pack}. Declared: ocp.query.keyword.v1"},
        }

    term = str(body.get("query", "") or "").strip().lower()
    limit = min(max(int(body.get("limit", 20) or 20), 1), 50)
    if term:
        matches = [
            b for b in BOOKS
            if any(term in str(b[f]).lower() for f in ("title", "summary", "brand", "work", "editor", "category"))
        ]
    else:
        matches = list(BOOKS)
    page = matches[:limit]
    return {
        "ocp_version": "1.0",
        "kind": "CatalogQueryResult",
        "id": f"qry_{uuid.uuid4()}",
        "catalog_id": CATALOG_ID,
        "query_pack": "ocp.query.keyword.v1",
        "query_mode": "keyword",
        "query": body.get("query", "") or "",
        "result_count": len(page),
        "page": {"limit": limit, "offset": 0, "has_more": False},
        "entries": [
            {"entry": _to_entry(b), "score": 1, "explain": [f"匹配 {b['work']} 的一个版本。"]}
            for b in page
        ],
    }


def ocp_resolve(entry_id: str, purpose: str = "view") -> tuple[int, dict]:
    """OCP resolve：同一商品按 purpose 返回不同动作。

    purpose=view     → url 类型，查看详情，无需确认
    purpose=checkout → api 类型，下单动作，强制用户确认 + 过期时效

    这是 OCP 协议核心设计：query 给投影，resolve 给动作；
    看和买是两个完全不同的动作，下单必须用户确认且会过期。
    """
    book = _find_book_by_entry_id(entry_id)
    if book is None:
        return 404, {"error": {"code": "not_found", "message": f"Unknown entry_id: {entry_id}"}}

    if purpose not in ("view", "checkout"):
        return 400, {"error": {"code": "bad_request", "message": f"Unsupported purpose: {purpose}. Use 'view' or 'checkout'."}}

    now = _now()
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    if purpose == "view":
        # purpose=view：只返回查看链接，url 类型，无需确认
        action_bindings = [
            {
                "action_id": "view",
                "action_type": "url",
                "label": "查看商品详情",
                "entrypoint": {"url": book["url"], "method": "GET"},
            }
        ]
    else:
        # purpose=checkout：返回下单动作，api 类型，强制确认 + 过期
        action_bindings = [
            {
                "action_id": "checkout",
                "action_type": "api",
                "label": "下单购买",
                "entrypoint": {"url": f"{BASE_URL}/api/order/create", "method": "POST"},
                "requires_user_confirmation": True,
                "expires_at": expires,
            }
        ]

    return 200, {
        "ocp_version": "1.0",
        "kind": "ResolvableReference",
        "id": f"res_{uuid.uuid4()}",
        "catalog_id": CATALOG_ID,
        "entry_id": _entry_id(book),
        "commercial_object_id": f"co_{book['id']}",
        "object_id": book["id"],
        "object_type": "ocp.commerce.product",
        "provider_id": PROVIDER_ID,
        "title": book["title"],
        "purpose": purpose,
        "visible_attributes": {
            "brand": book["brand"],
            "price": {"currency": book["currency"], "amount": book["amount"]},
            "availability": book["availability"],
            "target_audience": book["target_audience"],
        },
        "action_bindings": action_bindings,
        "freshness": {"object_updated_at": book["updated_at"], "resolved_at": now},
        "expires_at": expires,
    }


# ============================================================
#  Agent API（Web 产品核心）
# ============================================================

def api_agent(body: dict) -> dict:
    """完整 Agent 流程：意图 → 发现 → 筛选 → 注释 → 交易准备"""
    message = str(body.get("message", "") or "")
    intent = parse_intent(message)

    if not intent["work"]:
        return {
            "ok": False,
            "error": "no_work",
            "supported": "古籍：楚辞、论语、诗经、庄子、唐诗三百首 | 字帖：多宝塔碑、曹全碑",
        }

    # Discovery：直接查 BOOKS
    term = intent["work"].lower()
    matches = [
        b for b in BOOKS
        if any(term in str(b[f]).lower() for f in ("title", "summary", "brand", "work", "editor", "category"))
    ]
    entries = [{"entry": _to_entry(b), "score": 1, "explain": []} for b in matches]
    product_type = matches[0]["category"] if matches else "古籍"

    # Intention：版本学/碑帖学评估（明盒：对每一个发现的版本都给出评估）
    assessed = assess_versions(entries, intent["audience"], intent["budget"])
    qualified_count = sum(1 for a in assessed if a["qualified"])

    if not qualified_count:
        criteria = AUDIENCE_CRITERIA.get(intent["audience"], AUDIENCE_CRITERIA["大众"])
        return {
            "ok": False,
            "error": "no_match",
            "intent": intent,
            "discovery_count": len(matches),
            "criteria": criteria["desc"],
        }

    criteria = AUDIENCE_CRITERIA.get(intent["audience"], AUDIENCE_CRITERIA["大众"])
    discipline = "版本学" if product_type == "古籍" else "碑帖学"

    # 交易即教育：文化注释（基于排名第一的推荐版）
    top = next(a for a in assessed if a["verdict"] == "recommend")
    annotation = generate_cultural_annotation(top["attrs"], intent["audience"], entries, product_type)

    # Deal：resolve（两种 purpose）— 以推荐版为默认交易对象
    top_entry = top["entry"]
    entry_id = top_entry["entry_id"]
    _, resolved_view = ocp_resolve(entry_id, "view")
    _, resolved_checkout = ocp_resolve(entry_id, "checkout")

    # 构建明盒列表（给前端展示）—— 全部版本，含评估理由，最终由用户选择
    assessed_list = []
    for i, a in enumerate(assessed):
        attrs = a["attrs"]
        assessed_list.append({
            "rank": i,
            "title": a["entry"]["title"],
            "brand": attrs["brand"],
            "price": attrs["price"]["amount"],
            "base_text": attrs["base_text"],
            "annotation_style": attrs["annotation_style"],
            "scholarly_rating": attrs["scholarly_rating"],
            "readability": attrs["readability"],
            "recommended_for": attrs["recommended_for"],
            "entry_id": a["entry"]["entry_id"],
            "category": attrs["category"],
            "editor": attrs["editor"],
            "era": attrs["era"],
            "verdict": a["verdict"],
            "score": a["score"],
            "qualified": a["qualified"],
            "reasons": a["reasons"],
        })

    return {
        "ok": True,
        "intent": intent,
        "product_type": product_type,
        "discipline": discipline,
        "discovery_count": len(matches),
        "assessed_count": len(assessed),
        "qualified_count": qualified_count,
        "criteria_desc": criteria["desc"],
        "criteria_reason": criteria["reason"],
        "assessed": assessed_list,
        "annotation": annotation,
        "deal": {
            "entry_id": entry_id,
            "title": resolved_view["title"],
            "price": resolved_view["visible_attributes"]["price"]["amount"],
            "view_url": next((ab["entrypoint"]["url"] for ab in resolved_view["action_bindings"] if ab["action_id"] == "view"), ""),
            "checkout_url": next((ab["entrypoint"]["url"] for ab in resolved_checkout["action_bindings"] if ab["action_id"] == "checkout"), ""),
            "requires_confirmation": True,
            "expires_at": resolved_checkout["expires_at"],
        },
    }


def api_purchase(body: dict) -> dict:
    """Mock 交易完成"""
    entry_id = body.get("entry_id", "")
    book = _find_book_by_entry_id(entry_id)
    if book is None:
        return {"ok": False, "error": "not_found"}
    return {
        "ok": True,
        "transaction_id": f"co_{book['id']}",
        "title": book["title"],
        "price": book["amount"],
        "brand": book["brand"],
        "timestamp": _now(),
        "message": "OCP Deal 已执行，交易完成。",
    }


# ============================================================
#  真实下单流程（参考瑞幸 MCP 模式）
# ============================================================

import time as _time

# 内存订单存储
_ORDERS = {}

# 折扣规则
DISCOUNT_RULES = {
    "学术": {"type": "rate", "value": 0.15, "name": "学术研究折扣"},
    "大学": {"type": "rate", "value": 0.10, "name": "学生折扣"},
    "中学": {"type": "rate", "value": 0.10, "name": "学生折扣"},
    "少儿": {"type": "amount", "value": 5.0, "name": "启蒙优惠"},
    "入门": {"type": "amount", "value": 3.0, "name": "入门优惠"},
    "进阶": {"type": "rate", "value": 0.05, "name": "会员折扣"},
    "专业": {"type": "none", "value": 0, "name": ""},
    "大众": {"type": "rate", "value": 0.05, "name": "会员折扣"},
}


def _calc_discount(price: float, audience: str) -> tuple:
    """返回 (折扣金额, 折扣名称, 最终价格)"""
    rule = DISCOUNT_RULES.get(audience, DISCOUNT_RULES["大众"])
    if rule["type"] == "rate":
        discount = round(price * rule["value"], 2)
    elif rule["type"] == "amount":
        discount = min(rule["value"], price)
    else:
        discount = 0.0
    final = round(price - discount, 2)
    return discount, rule["name"], final


def api_preview(body: dict) -> dict:
    """订单预览——参考瑞幸 previewOrder，下单前展示最终价格和优惠"""
    entry_id = body.get("entry_id", "")
    audience = body.get("audience", "大众")
    book = _find_book_by_entry_id(entry_id)
    if book is None:
        return {"ok": False, "error": "not_found"}

    original_price = book["amount"]
    discount, discount_name, final_price = _calc_discount(original_price, audience)

    return {
        "ok": True,
        "entry_id": entry_id,
        "title": book["title"],
        "brand": book["brand"],
        "category": book["category"],
        "original_price": original_price,
        "discount": discount,
        "discount_name": discount_name,
        "final_price": final_price,
        "pickup_info": f"请到{book['brand']}自提点取货",
        "preview_id": f"prev_{uuid.uuid4().hex[:8]}",
    }


def api_create_order(body: dict) -> dict:
    """创建订单——参考瑞幸 createOrder，生成订单号和支付二维码"""
    entry_id = body.get("entry_id", "")
    audience = body.get("audience", "大众")
    book = _find_book_by_entry_id(entry_id)
    if book is None:
        return {"ok": False, "error": "not_found"}

    original_price = book["amount"]
    discount, discount_name, final_price = _calc_discount(original_price, audience)

    # 生成订单号
    order_id = f"JC{int(_time.time() * 1000)}"
    # 生成支付链接和二维码
    pay_url = f"https://pay.jiaochou.com/order/{order_id}"
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={pay_url}"

    # 存储订单
    _ORDERS[order_id] = {
        "order_id": order_id,
        "entry_id": entry_id,
        "title": book["title"],
        "brand": book["brand"],
        "category": book["category"],
        "original_price": original_price,
        "discount": discount,
        "discount_name": discount_name,
        "final_price": final_price,
        "status": "待支付",
        "created_at": _now(),
        "pay_url": pay_url,
        "qr_url": qr_url,
    }

    return {
        "ok": True,
        "order_id": order_id,
        "title": book["title"],
        "brand": book["brand"],
        "original_price": original_price,
        "discount": discount,
        "discount_name": discount_name,
        "final_price": final_price,
        "pay_url": pay_url,
        "qr_url": qr_url,
        "message": "OCP Deal 已创建，请扫码支付。",
    }


def api_order_status(body: dict) -> dict:
    """订单状态查询——参考瑞幸 queryOrderDetailInfo"""
    order_id = body.get("order_id", "")
    order = _ORDERS.get(order_id)
    if order is None:
        return {"ok": False, "error": "order_not_found"}

    # 模拟支付后状态更新
    if order["status"] == "待支付":
        order["status"] = "已支付·备货中"
        order["pickup_code"] = f"P{order_id[-6:]}"
        order["paid_at"] = _now()

    return {
        "ok": True,
        "order_id": order_id,
        "title": order["title"],
        "brand": order["brand"],
        "status": order["status"],
        "final_price": order["final_price"],
        "pickup_code": order.get("pickup_code", ""),
        "pickup_info": f"请到{order['brand']}自提点取货",
        "created_at": order["created_at"],
        "paid_at": order.get("paid_at", ""),
    }


# ============================================================
#  HTTP Handler
# ============================================================

class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_html(self, html: str):
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length", 0) or 0)
        if not length:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    def do_GET(self):
        # Web UI
        if self.path == "/" or self.path == "/index.html":
            html_path = os.path.join(SCRIPT_DIR, "index.html")
            try:
                with open(html_path, "r", encoding="utf-8") as f:
                    self._send_html(f.read())
            except FileNotFoundError:
                self._send_json(404, {"error": "index.html not found"})
            return

        # OCP endpoints
        routes = {
            "/.well-known/ocp-catalog": well_known_discovery,
            "/ocp/manifest": manifest,
            "/ocp/health": health,
            "/ocp/contracts": contracts,
        }
        builder = routes.get(self.path)
        if builder:
            self._send_json(200, builder())
        else:
            self._send_json(404, {"error": {"code": "not_found", "message": f"No route for GET {self.path}"}})

    def do_POST(self):
        if self.path == "/ocp/query":
            self._send_json(200, ocp_query(self._read_json()))
            return
        if self.path == "/ocp/resolve":
            body = self._read_json()
            entry_id = body.get("entry_id", "")
            purpose = body.get("purpose", "view")
            status, payload = ocp_resolve(entry_id, purpose)
            self._send_json(status, payload)
            return
        if self.path == "/api/agent":
            self._send_json(200, api_agent(self._read_json()))
            return
        if self.path == "/api/preview":
            self._send_json(200, api_preview(self._read_json()))
            return
        if self.path == "/api/order/create":
            self._send_json(200, api_create_order(self._read_json()))
            return
        if self.path == "/api/order/status":
            self._send_json(200, api_order_status(self._read_json()))
            return
        if self.path == "/api/purchase":
            self._send_json(200, api_create_order(self._read_json()))
            return
        self._send_json(404, {"error": {"code": "not_found", "message": f"No route for POST {self.path}"}})

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"校雠 Web 产品已启动：{BASE_URL}")
    print(f"  浏览器打开 ↑ 即可使用")
    print(f"  OCP 端点：/.well-known/ocp-catalog, /ocp/manifest, /ocp/health, /ocp/query, /ocp/resolve")
    print(f"  数据：{len(BOOKS)} 条文化品版本")
    server.serve_forever()


if __name__ == "__main__":
    main()