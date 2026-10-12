"""OCP Catalog Node — 古籍版本目录（"校雠"）

基于 OCP 官方 Python 示例修改，保留全部 OCP 协议响应格式，
商品数据替换为古籍版本数据，在 attributes 中扩展 DH 元数据。

运行：python server.py    # 监听 http://localhost:4401

测试：
  curl http://localhost:4401/ocp/manifest
  curl http://localhost:4401/ocp/health
  curl -X POST http://localhost:4401/ocp/query -H 'content-type: application/json' -d '{"query":"楚辞"}'
  curl -X POST http://localhost:4401/ocp/resolve -H 'content-type: application/json' -d '{"entry_id":"entry_classics_chuci-quanyi-zhonghua"}'
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from books_data import BOOKS

CATALOG_ID = os.environ.get("CATALOG_ID", "cat_classics_jiaochou")
CATALOG_NAME = os.environ.get("CATALOG_NAME", "校雠·古籍版本目录")
PROVIDER_ID = "classics"
PORT = int(os.environ.get("PORT", "4401"))
BASE_URL = os.environ.get("PUBLIC_BASE_URL", f"http://localhost:{PORT}").rstrip("/")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _entry_id(book: dict) -> str:
    return f"entry_{PROVIDER_ID}_{book['id']}"


# ---- OCP 协议端点实现（格式不变，数据变了）----

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
                "description": "按书名搜索该经典书的所有版本，每个版本带版本学元数据（底本、笺注风格、适读人群、校勘评级）。",
                "query_packs": [
                    {
                        "pack_id": "ocp.query.keyword.v1",
                        "description": "按书名（work）、标题、出版社、注译者做关键词匹配。",
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
        "note": "只读目录节点，不接受外部数据写入。",
    }


def _to_entry(book: dict) -> dict:
    """把一条古籍版本数据转成 OCP CatalogEntry 格式。

    DH 扩展信息放在 attributes 里——这是 OCP 允许的自由扩展区域，
    不破坏协议合规性，同时让 Agent 能读到版本学决策所需的所有信息。
    """
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
            # ---- DH 扩展元数据 ----
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


def query(body: dict) -> dict:
    term = str(body.get("query", "") or "").strip().lower()
    limit = min(max(int(body.get("limit", 20) or 20), 1), 50)
    if term:
        matches = [
            b for b in BOOKS
            if any(
                term in str(b[f]).lower()
                for f in ("title", "summary", "brand", "work", "editor", "category")
            )
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
            {
                "entry": _to_entry(b),
                "score": 1,
                "explain": [f"\"{body.get('query', '')}\" 匹配 {b['work']} 的一个版本。"],
            }
            for b in page
        ],
    }


def resolve(body: dict):
    entry_id = body.get("entry_id")
    book = next((b for b in BOOKS if _entry_id(b) == entry_id), None)
    if book is None:
        return 404, {
            "error": {
                "code": "not_found",
                "message": f"Unknown entry_id: {entry_id or '(missing)'}",
            }
        }
    now = _now()
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
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
        "visible_attributes": {
            "brand": book["brand"],
            "category": book["category"],
            "price": {"currency": book["currency"], "amount": book["amount"]},
            "availability": book["availability"],
            "target_audience": book["target_audience"],
            "scholarly_rating": book["scholarly_rating"],
            "readability": book["readability"],
        },
        "action_bindings": [
            {
                "action_id": "view",
                "action_type": "url",
                "label": "查看商品",
                "entrypoint": {"url": book["url"], "method": "GET"},
            },
            {
                "action_id": "buy",
                "action_type": "url",
                "label": "下单购买",
                "entrypoint": {"url": book["url"] + "?action=buy", "method": "GET"},
            },
        ],
        "freshness": {"object_updated_at": book["updated_at"], "resolved_at": now},
        "expires_at": expires,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
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
        routes = {
            "/.well-known/ocp-catalog": well_known_discovery,
            "/ocp/manifest": manifest,
            "/ocp/health": health,
            "/ocp/contracts": contracts,
        }
        builder = routes.get(self.path)
        if builder is None:
            self._send(
                404, {"error": {"code": "not_found", "message": f"No route for GET {self.path}"}}
            )
            return
        self._send(200, builder())

    def do_POST(self):
        if self.path == "/ocp/query":
            self._send(200, query(self._read_json()))
            return
        if self.path == "/ocp/resolve":
            status, payload = resolve(self._read_json())
            self._send(status, payload)
            return
        self._send(
            404, {"error": {"code": "not_found", "message": f"No route for POST {self.path}"}}
        )

    def log_message(self, *_args):
        return


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"校雠·古籍版本目录 OCP Catalog Node serving on {BASE_URL}")
    print(f"  共 {len(BOOKS)} 条版本数据")
    server.serve_forever()


if __name__ == "__main__":
    main()