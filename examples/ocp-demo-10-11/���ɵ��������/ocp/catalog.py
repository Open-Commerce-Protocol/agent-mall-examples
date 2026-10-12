import base64
import datetime
import json
import uuid

from .errors import OCPError


OCP_VERSION = "1.0"
CATALOG_ID = "cat_ocp_supply_lab"
CATALOG_NAME = "OCP Supply Lab Catalog"
MANIFEST_ID = "manifest_ocp_supply_lab_v1"
PROVIDER_ID = "provider_ocp_supply_lab"
QUERY_PACK_ID = "ocp.query.keyword.v1"
DEFAULT_LIMIT = 20
MAX_LIMIT = 50


def utc_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def catalog_metadata():
    return {
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "query_pack": QUERY_PACK_ID,
        "manifest_id": MANIFEST_ID,
    }


def create_well_known(base_url):
    return {
        "ocp_version": OCP_VERSION,
        "kind": "WellKnownCatalogDiscovery",
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "manifest_url": absolute(base_url, "/ocp/manifest"),
        "health_url": absolute(base_url, "/ocp/health"),
        "query_url": absolute(base_url, "/ocp/query"),
        "resolve_url": absolute(base_url, "/ocp/resolve"),
        "contracts_url": absolute(base_url, "/ocp/contracts"),
    }


def create_manifest(base_url):
    return {
        "ocp_version": OCP_VERSION,
        "kind": "CatalogManifest",
        "id": MANIFEST_ID,
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "description": (
            "Agent-readable product catalog with keyword/filter search, "
            "live resolution and an add-to-cart action binding."
        ),
        "registry_visibility": "public",
        "endpoints": {
            "health": {"url": absolute(base_url, "/ocp/health"), "method": "GET"},
            "query": {"url": absolute(base_url, "/ocp/query"), "method": "POST"},
            "resolve": {"url": absolute(base_url, "/ocp/resolve"), "method": "POST"},
            "contracts": {
                "url": absolute(base_url, "/ocp/contracts"),
                "method": "GET",
            },
        },
        "query_capabilities": [
            {
                "capability_id": "ocp.supply_lab.product.search.v1",
                "name": "Product catalog search",
                "description": "Keyword, filter and hybrid search over the retail catalog.",
                "query_packs": [
                    {
                        "pack_id": QUERY_PACK_ID,
                        "description": "Keyword and structured filter search over product entries.",
                        "query_modes": ["keyword", "filter", "hybrid"],
                        "metadata": {
                            "default_limit": DEFAULT_LIMIT,
                            "maximum_limit": MAX_LIMIT,
                            "currency": "CNY",
                        },
                    }
                ],
                "searchable_field_refs": [
                    "ocp.product#/title",
                    "ocp.product#/summary",
                    "ocp.product#/attributes/tags",
                ],
                "filterable_field_refs": [
                    "ocp.product#/attributes/category",
                    "ocp.product#/attributes/price/amount",
                    "ocp.product#/image_url",
                ],
                "sortable_field_refs": [
                    "ocp.product#/attributes/price/amount",
                    "ocp.product#/attributes/availability_status",
                ],
                "input_fields": [
                    {"name": "query", "type": "string", "required": False},
                    {"name": "query_mode", "type": "string", "required": False},
                    {"name": "filters.category", "type": "string", "required": False},
                    {"name": "filters.min_amount", "type": "number", "required": False},
                    {"name": "filters.max_amount", "type": "number", "required": False},
                    {"name": "filters.has_image", "type": "boolean", "required": False},
                    {"name": "limit", "type": "integer", "required": False},
                ],
                "supports_explain": True,
                "supports_resolve": True,
                "metadata": {
                    "source": "in-memory-commerce-store",
                    "stateful_location": False,
                },
            }
        ],
        "object_contracts": [product_contract()],
        "federation": {
            "mode": "profile_only",
            "node_role": "source_catalog",
            "supported_protocols": [
                "ocp.catalog.handshake.v1",
                "ocp.catalog.registration.v1",
            ],
            "trust_strategy": {
                "trust_tier": "verified",
                "domain_verified": True,
                "manifest_signed": False,
                "signature_algorithms": [],
                "downgrade_invalidates_cache": True,
            },
        },
    }


def product_contract():
    return {
        "object_type": "ocp.commerce.retail.product",
        "required_fields": [
            "ocp.product#/object_id",
            "ocp.product#/title",
            "ocp.product#/attributes/price/amount",
            "ocp.product#/attributes/currency",
        ],
        "optional_fields": [
            "ocp.product#/summary",
            "ocp.product#/image_url",
            "ocp.product#/attributes/category",
            "ocp.product#/attributes/tags",
            "ocp.product#/attributes/availability_status",
        ],
        "additional_fields_policy": "allow",
        "field_usage_policy": [
            {
                "field_ref": "ocp.product#/object_id",
                "requirement": "required",
                "usage": ["identity", "resolve_visible"],
            },
            {
                "field_ref": "ocp.product#/title",
                "requirement": "required",
                "usage": ["index", "display", "search_visible"],
            },
            {
                "field_ref": "ocp.product#/attributes/price/amount",
                "requirement": "required",
                "usage": ["filter", "rank", "display", "search_visible"],
            },
        ],
        "identity_policy": {
            "accepted_identity_keys": ["provider_object_id", "provider_sku"],
            "dedupe_scope": "provider",
            "provider_sku_trust": "requires_verified_provider",
            "requires_authority_verification": False,
        },
        "provenance_requirements": {
            "accepted_authority_types": ["source"],
            "requires_verification": False,
            "minimum_trust_tier": "verified",
        },
        "resolve_policy": {
            "strategies": ["provider_api"],
            "requires_live_check": True,
            "provider_endpoint_required": False,
            "minimum_trust_tier": "verified",
        },
    }


def create_contracts():
    return {
        "ocp_version": OCP_VERSION,
        "kind": "ObjectContractList",
        "catalog_id": CATALOG_ID,
        "object_contracts": [product_contract()],
    }


def create_health(store):
    snapshot = store.snapshot()
    return {
        "ocp_version": OCP_VERSION,
        "kind": "CatalogHealth",
        "catalog_id": CATALOG_ID,
        "status": "healthy",
        "ready": True,
        "checked_at": utc_now(),
        "manifest_version": MANIFEST_ID,
        "details": {
            "product_count": snapshot["metrics"]["products"],
            "source": "in-memory-commerce-store",
        },
        "dependencies": [
            {
                "name": "commerce-store",
                "status": "healthy",
                "message": "Catalog source is available.",
            }
        ],
    }


def query_catalog(store, request, base_url):
    request = validate_query(request)
    products = store.catalog(
        query=request["query"],
        category=request["filters"].get("category", ""),
    )
    filtered = [
        product
        for product in products
        if apply_filters(product, request["filters"])
    ]
    limited = filtered[: request["limit"]]
    locale = request["locale"]
    entries = [
        {
            "entry": to_catalog_entry(product, locale, base_url),
            "score": score_product(product, request["query"]),
            "explain": explain_product(product, request),
        }
        for product in limited
    ]
    return {
        "ocp_version": OCP_VERSION,
        "kind": "CatalogQueryResult",
        "id": new_id("qry"),
        "catalog_id": CATALOG_ID,
        "query_pack": QUERY_PACK_ID,
        "query_mode": request["query_mode"],
        "query": request["query"],
        "result_count": len(entries),
        "page": {
            "limit": request["limit"],
            "offset": 0,
            "has_more": len(filtered) > len(limited),
        },
        "entries": entries,
        "policy_summary": {
            "selected_capability_id": "ocp.supply_lab.product.search.v1",
            "selected_query_pack": QUERY_PACK_ID,
            "query_mode": request["query_mode"],
            "supports_explain": True,
            "accepted_filters": sorted(request["filters"].keys()),
            "rejected_filters": [],
            "warnings": [],
        },
        "audit_id": new_id("audit"),
    }


def resolve_catalog_entry(store, request, base_url):
    if not isinstance(request, dict):
        raise OCPError("invalid_request", "Resolve body must be a JSON object")
    entry_id = request.get("entry_id")
    payload = decode_entry_id(entry_id)
    product = store.get_product(payload["productId"])
    locale = str(request.get("locale") or "zh-CN")
    localized = localized_product(product, locale)
    now = utc_now()
    expires = (
        datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    ).replace(microsecond=0).isoformat() + "Z"
    return {
        "ocp_version": OCP_VERSION,
        "kind": "ResolvableReference",
        "id": new_id("res"),
        "catalog_id": CATALOG_ID,
        "entry_id": entry_id,
        "commercial_object_id": "ocp_supply_lab_%s" % product["id"],
        "object_id": product["id"],
        "object_type": "ocp.commerce.retail.product",
        "provider_id": PROVIDER_ID,
        "title": localized["name"],
        "visible_attributes": {
            "brand": CATALOG_NAME,
            "category": localized["category"],
            "description": localized["description"],
            "sku": product["id"],
            "price": {
                "currency": product["currency"],
                "amount": cents_to_amount(product["price"]),
            },
            "availability_status": "in_stock" if product["stock"] > 0 else "out_of_stock",
            "stock": product["stock"],
            "image_url": absolute(base_url, product["image"]),
            "tags": list(localized["attributes"].values()),
        },
        "access": {
            "visibility": "public",
            "permission_state": "granted",
            "redacted_fields": [],
            "policy_notes": ["Cart changes require an explicit action request."],
        },
        "live_checks": [
            {
                "check_id": "commerce_store_inventory",
                "status": "passed",
                "checked_at": now,
                "summary": "Current product and inventory state loaded.",
                "details": {"stock": product["stock"]},
            }
        ],
        "action_bindings": [
            {
                "action_id": "add_to_cart",
                "action_type": "workflow",
                "label": "Add to cart",
                "description": "Add this resolved product to an existing OCP cart.",
                "entrypoint": {
                    "url": absolute(base_url, "/api/actions/add-to-cart"),
                    "method": "POST",
                },
                "input_schema": {
                    "type": "object",
                    "required": ["cartId", "productId", "quantity"],
                    "properties": {
                        "cartId": {"type": "string"},
                        "productId": {"type": "string"},
                        "quantity": {"type": "integer", "minimum": 1, "maximum": 20},
                    },
                },
                "auth_requirements": {},
                "requires_user_confirmation": False,
            },
            {
                "action_id": "checkout",
                "action_type": "workflow",
                "label": "Create checkout",
                "description": "Convert an OCP cart into a checkout session.",
                "entrypoint": {
                    "url": absolute(base_url, "/api/actions/checkout"),
                    "method": "POST",
                },
                "input_schema": {
                    "type": "object",
                    "required": ["cartId"],
                    "properties": {
                        "cartId": {"type": "string"},
                        "fulfillment": {
                            "type": "string",
                            "enum": ["standard", "express"],
                        },
                    },
                },
                "auth_requirements": {},
                "requires_user_confirmation": True,
            },
        ],
        "freshness": {
            "object_updated_at": now,
            "resolved_at": now,
        },
        "expires_at": expires,
    }


def to_catalog_entry(product, locale, base_url):
    localized = localized_product(product, locale)
    return {
        "kind": "CatalogEntry",
        "catalog_id": CATALOG_ID,
        "entry_id": encode_entry_id({"productId": product["id"]}),
        "provider_id": PROVIDER_ID,
        "object_id": product["id"],
        "object_type": "ocp.commerce.retail.product",
        "commercial_object_id": "ocp_supply_lab_%s" % product["id"],
        "title": localized["name"],
        "summary": localized["description"],
        "image_url": absolute(base_url, product["image"]),
        "attributes": {
            "brand": CATALOG_NAME,
            "category": localized["category"],
            "sku": product["id"],
            "price": {
                "currency": product["currency"],
                "amount": cents_to_amount(product["price"]),
            },
            "availability_status": "in_stock" if product["stock"] > 0 else "out_of_stock",
            "stock": product["stock"],
            "tags": list(localized["attributes"].values()),
            "resolve_url": "/ocp/resolve",
        },
    }


def validate_query(request):
    if not isinstance(request, dict):
        raise OCPError("invalid_query", "Query body must be a JSON object")
    if request.get("query_pack") not in (None, "", QUERY_PACK_ID):
        raise OCPError(
            "invalid_query_pack",
            "Unsupported query_pack: %s" % request.get("query_pack"),
        )
    try:
        limit = int(request.get("limit", DEFAULT_LIMIT))
    except (TypeError, ValueError):
        raise OCPError("invalid_limit", "limit must be an integer")
    if limit < 1 or limit > MAX_LIMIT:
        raise OCPError(
            "invalid_limit",
            "limit must be between 1 and %s" % MAX_LIMIT,
        )
    query = str(request.get("query", ""))[:500]
    filters = request.get("filters") or {}
    if not isinstance(filters, dict):
        raise OCPError("invalid_filters", "filters must be an object")
    query_mode = request.get("query_mode")
    if query_mode not in (None, "", "keyword", "filter", "hybrid"):
        raise OCPError("invalid_query_mode", "Unsupported query_mode")
    return {
        "query": query,
        "filters": filters,
        "limit": limit,
        "query_mode": query_mode or infer_query_mode(query, filters),
        "locale": str(request.get("locale") or "zh-CN"),
    }


def apply_filters(product, filters):
    price = cents_to_amount(product["price"])
    min_amount = number_or_none(filters.get("min_amount"))
    max_amount = number_or_none(filters.get("max_amount"))
    if min_amount is not None and price < min_amount:
        return False
    if max_amount is not None and price > max_amount:
        return False
    if filters.get("has_image") is True and not product.get("image"):
        return False
    if filters.get("has_image") is False and product.get("image"):
        return False
    return True


def infer_query_mode(query, filters):
    if query and filters:
        return "hybrid"
    if filters:
        return "filter"
    return "keyword"


def score_product(product, query):
    query = query.strip().lower()
    if not query:
        return 0.5
    text = " ".join(
        [
            product["name"],
            product["category"],
            product["description"],
            " ".join(product["attributes"].values()),
        ]
    ).lower()
    return 1.0 if query in text else 0.5


def explain_product(product, request):
    reasons = ["Matched the catalog query pack."]
    if request["query"]:
        reasons.append("Query token matched product metadata.")
    if request["filters"]:
        reasons.append("All requested structured filters passed.")
    if product["stock"] > 0:
        reasons.append("Inventory is currently available.")
    return reasons


def encode_entry_id(value):
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return "ocp_%s" % token


def decode_entry_id(entry_id):
    if not isinstance(entry_id, str) or not entry_id.startswith("ocp_"):
        raise OCPError("invalid_entry_id", "entry_id must be an OCP Catalog entry id")
    token = entry_id[4:]
    token += "=" * ((4 - len(token) % 4) % 4)
    try:
        value = json.loads(
            base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        )
    except (ValueError, UnicodeDecodeError):
        raise OCPError("invalid_entry_id", "entry_id is malformed")
    if not isinstance(value, dict) or not value.get("productId"):
        raise OCPError("invalid_entry_id", "entry_id payload is incomplete")
    return value


def localized_product(product, locale):
    translation = (product.get("translations") or {}).get(locale, {})
    return {
        "name": translation.get("name") or product["name"],
        "category": translation.get("category") or product["category"],
        "description": translation.get("description") or product["description"],
        "attributes": translation.get("attributes") or product["attributes"],
    }


def cents_to_amount(cents):
    return round(float(cents) / 100.0, 2)


def number_or_none(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise OCPError("invalid_filters", "Numeric filters must contain numbers")


def new_id(prefix):
    return "%s_%s" % (prefix, uuid.uuid4().hex[:18])


def absolute(base_url, path):
    return base_url.rstrip("/") + path
