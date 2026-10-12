import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import catalog, merchant_directory
from .errors import ConflictError, NotFoundError, OCPError
from .models import CommerceStore


PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,79}$")


NORTHSTAR_PRODUCTS = [
    {
        "id": "prod_northstar_dock",
        "name": "Northstar USB-C Dock",
        "category": "Workspace",
        "description": "Ten-port USB-C dock with dual display and Ethernet.",
        "price": 69900,
        "currency": "CNY",
        "stock": 14,
        "image": "/assets/slate-keyboard.svg",
        "attributes": {"ports": "10", "display": "Dual 4K", "warranty": "2 years"},
        "translations": {
            "zh-CN": {
                "name": "Northstar USB-C 扩展坞",
                "category": "办公",
                "description": "支持双屏与有线网络的十口 USB-C 扩展坞。",
                "attributes": {"ports": "10 口", "display": "双 4K", "warranty": "2 年"},
            }
        },
    },
    {
        "id": "prod_northstar_tripod",
        "name": "Northstar Travel Tripod",
        "category": "Travel",
        "description": "Compact aluminum tripod with a quick-release ball head.",
        "price": 34900,
        "currency": "CNY",
        "stock": 11,
        "image": "/assets/cloud-backpack.svg",
        "attributes": {"height": "152 cm", "weight": "1.1 kg", "warranty": "1 year"},
        "translations": {
            "zh-CN": {
                "name": "Northstar 旅行三脚架",
                "category": "出行",
                "description": "配备快装球型云台的轻量铝合金旅行三脚架。",
                "attributes": {"height": "152 cm", "weight": "1.1 kg", "warranty": "1 年"},
            }
        },
    },
]


class BaseProviderAdapter:
    def __init__(self, config):
        self.config = config

    def manifest(self, base_url):
        del base_url
        raise NotImplementedError

    def query(self, request, base_url):
        del request, base_url
        raise NotImplementedError

    def resolve(self, request, base_url):
        del request, base_url
        raise NotImplementedError

    def stores(self, request):
        del request
        raise OCPError(
            "stores_not_supported",
            "Provider does not expose a store network",
            status=404,
        )


class LocalCatalogAdapter(BaseProviderAdapter):
    def __init__(self, config, store, stores=None):
        super(LocalCatalogAdapter, self).__init__(config)
        self.store = store
        self.store_network = list(stores or [])

    def manifest(self, base_url):
        del base_url
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "CatalogManifest",
            "id": self.config["manifest_id"],
            "catalog_id": self.config["catalog_id"],
            "catalog_name": self.config["company_name"],
            "provider_id": self.config["provider_id"],
            "adapter_type": "local",
        }

    def query(self, request, base_url):
        result = catalog.query_catalog(self.store, request, base_url)
        return self._decorate_result(result)

    def resolve(self, request, base_url):
        result = catalog.resolve_catalog_entry(self.store, request, base_url)
        result["catalog_id"] = self.config["catalog_id"]
        result["provider_id"] = self.config["provider_id"]
        return result

    def stores(self, request):
        return filter_stores(self.store_network, request)

    def _decorate_result(self, result):
        result["catalog_id"] = self.config["catalog_id"]
        for item in result.get("entries", []):
            entry = item["entry"]
            entry["catalog_id"] = self.config["catalog_id"]
            entry["provider_id"] = self.config["provider_id"]
            entry["entry_id"] = catalog.encode_entry_id(
                {
                    "providerId": self.config["provider_id"],
                    "productId": entry["object_id"],
                }
            )
        return result


class HTTPCatalogAdapter(BaseProviderAdapter):
    def __init__(self, config):
        super(HTTPCatalogAdapter, self).__init__(config)
        self.base_url = config["base_url"].rstrip("/")

    def manifest(self, base_url):
        del base_url
        return self._request("/ocp/manifest")

    def query(self, request, base_url):
        del base_url
        return self._request("/ocp/query", request)

    def resolve(self, request, base_url):
        del base_url
        return self._request("/ocp/resolve", request)

    def stores(self, request):
        path = self.config.get("stores_path")
        if not path:
            return super(HTTPCatalogAdapter, self).stores(request)
        response = self._request(
            path,
            {
                "longitude": request.get("longitude"),
                "latitude": request.get("latitude"),
                "deptName": request.get("query", ""),
            },
        )
        return filter_stores(extract_stores(response), request)

    def _request(self, path, body=None):
        data = None
        headers = {
            "Accept": "application/json",
            "X-OCP-Version": catalog.OCP_VERSION,
        }
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method="GET" if body is None else "POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            try:
                error = json.loads(raw).get("error", {})
            except ValueError:
                error = {}
            raise OCPError(
                "provider_error",
                error.get("message") or "Provider returned HTTP %s" % exc.code,
                status=502,
                details={"providerId": self.config["provider_id"]},
            )
        except (OSError, ValueError) as exc:
            raise OCPError(
                "provider_unreachable",
                "Provider is unavailable: %s" % exc,
                status=502,
                details={"providerId": self.config["provider_id"]},
            )


class ConnectorPlaceholderAdapter(BaseProviderAdapter):
    """Represents a known merchant connector that still needs authorization."""

    def manifest(self, base_url):
        del base_url
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "CatalogConnectorManifest",
            "id": self.config["manifest_id"],
            "catalog_id": self.config["catalog_id"],
            "catalog_name": self.config["company_name"],
            "provider_id": self.config["provider_id"],
            "adapter_type": "connector",
            "connection_status": "authorization_required",
        }

    def query(self, request, base_url):
        del request, base_url
        raise OCPError(
            "connector_authorization_required",
            "Merchant connector needs enterprise authorization before it can be queried",
            status=409,
            details={"providerId": self.config["provider_id"]},
        )

    def resolve(self, request, base_url):
        del request, base_url
        raise OCPError(
            "connector_authorization_required",
            "Merchant connector needs enterprise authorization before it can be resolved",
            status=409,
            details={"providerId": self.config["provider_id"]},
        )

    def stores(self, request):
        del request
        raise OCPError(
            "connector_authorization_required",
            "Merchant connector needs enterprise authorization before stores can be queried",
            status=409,
            details={"providerId": self.config["provider_id"]},
        )


class ProviderRegistry:
    """Common OCP-Catalog gateway for local and external company providers."""

    def __init__(self, primary_store):
        self.lock = threading.RLock()
        self.adapters = {}
        self.entry_routes = {}
        self.product_cache = {}
        self.register_local(
            provider_id="provider_ocp_supply_lab",
            company_name="OCP Supply Lab",
            catalog_id="cat_ocp_supply_lab",
            manifest_id="manifest_ocp_supply_lab_v1",
            store=primary_store,
            trust_tier="verified",
        )
        self.register_local(
            provider_id="provider_northstar_gear",
            company_name="Northstar Gear",
            catalog_id="cat_northstar_gear",
            manifest_id="manifest_northstar_gear_v1",
            store=CommerceStore(NORTHSTAR_PRODUCTS),
            trust_tier="verified",
        )
        luckin = self.register_http(
            {
                "provider_id": "provider_luckin_coffee_demo",
                "company_name": "瑞幸咖啡 OCP 适配目录",
                "catalog_id": "cat_luckin_coffee_demo",
                "manifest_id": "manifest_luckin_coffee_demo",
                "base_url": os.environ.get(
                    "LUCKIN_CATALOG_URL",
                    "http://127.0.0.1:4310",
                ),
                "trust_tier": "verified",
            }
        )
        luckin_adapter = self.get_adapter(luckin["provider_id"])
        luckin_adapter.config["stores_path"] = "/api/luckin/shops"
        luckin_adapter.config["connection_status"] = "connected"
        luckin_adapter.config["directory_id"] = "cn_luckin_coffee"
        for merchant_id in ("cn_kfc", "cn_mcdonalds"):
            self.register_store_network(merchant_directory.get(merchant_id))

    def register_local(
        self,
        provider_id,
        company_name,
        catalog_id,
        manifest_id,
        store,
        trust_tier="verified",
        stores=None,
    ):
        config = self._config(
            provider_id=provider_id,
            company_name=company_name,
            catalog_id=catalog_id,
            manifest_id=manifest_id,
            adapter_type="local",
            trust_tier=trust_tier,
        )
        with self.lock:
            self.adapters[provider_id] = LocalCatalogAdapter(
                config,
                store,
                stores=stores,
            )
        return self.public_config(provider_id)

    def register_store_network(self, merchant):
        existing = self.find_by_directory_id(merchant["merchant_id"])
        if existing:
            return self.public_config(existing)
        provider_id = "provider_%s" % merchant["merchant_id"].replace("cn_", "", 1)
        config = self._config(
            provider_id=provider_id,
            company_name=merchant["name"],
            catalog_id="cat_%s" % merchant["merchant_id"],
            manifest_id="manifest_%s_v1" % merchant["merchant_id"],
            adapter_type="store",
            trust_tier="verified",
        )
        config.update(
            {
                "directory_id": merchant["merchant_id"],
                "integration_mode": merchant["integration_mode"],
                "connection_status": "connected",
                "description": merchant.get("description"),
                "supports_stores": True,
            }
        )
        with self.lock:
            self.adapters[provider_id] = LocalCatalogAdapter(
                config,
                CommerceStore(merchant.get("products") or []),
                stores=merchant.get("stores") or [],
            )
        return self.public_config(provider_id)

    def register_http(self, request, gateway_base_url=None):
        if not isinstance(request, dict):
            raise OCPError("invalid_provider", "Provider body must be an object")
        provider_id = str(request.get("provider_id") or "").strip()
        company_name = str(request.get("company_name") or "").strip()
        base_url = str(request.get("base_url") or "").strip()
        if not PROVIDER_ID_PATTERN.match(provider_id):
            raise OCPError(
                "invalid_provider_id",
                "provider_id must contain 3-80 lowercase letters, numbers, dots, dashes or underscores",
            )
        if not company_name:
            raise OCPError("invalid_company_name", "company_name is required")
        if not (base_url.startswith("http://") or base_url.startswith("https://")):
            raise OCPError("invalid_base_url", "base_url must use http or https")
        if gateway_base_url and normalize_url(base_url) == normalize_url(gateway_base_url):
            raise OCPError(
                "gateway_self_registration",
                "The gateway cannot register its own root URL as an external provider",
            )
        with self.lock:
            if provider_id in self.adapters:
                raise ConflictError(
                    "provider_already_registered",
                    "Provider %s is already registered" % provider_id,
                )
        catalog_id = str(request.get("catalog_id") or "cat_%s" % provider_id)
        manifest_id = str(request.get("manifest_id") or "manifest_%s_v1" % provider_id)
        config = self._config(
            provider_id=provider_id,
            company_name=company_name,
            catalog_id=catalog_id,
            manifest_id=manifest_id,
            adapter_type="http",
            trust_tier=str(request.get("trust_tier") or "pending"),
            base_url=base_url,
        )
        with self.lock:
            self.adapters[provider_id] = HTTPCatalogAdapter(config)
        return self.public_config(provider_id)

    def discover_and_register(self, request, gateway_base_url=None):
        if not isinstance(request, dict):
            raise OCPError("invalid_provider", "Provider body must be an object")
        url = str(request.get("url") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise OCPError("invalid_catalog_url", "Catalog URL must use http or https")

        base_url, discovery, manifest = discover_catalog(url)
        if gateway_base_url and normalize_url(base_url) == normalize_url(gateway_base_url):
            raise OCPError(
                "gateway_self_registration",
                "The gateway cannot register its own root URL as an external provider",
            )

        catalog_id = (
            manifest.get("catalog_id")
            or (discovery or {}).get("catalog_id")
            or ""
        )
        if not catalog_id:
            raise OCPError(
                "catalog_id_missing",
                "The discovered manifest does not declare catalog_id",
            )
        company_name = (
            manifest.get("catalog_name")
            or manifest.get("name")
            or (discovery or {}).get("catalog_name")
            or urllib.parse.urlsplit(base_url).hostname
            or "Catalog Provider"
        )
        manifest_id = manifest.get("id") or "manifest_%s_v1" % catalog_id

        existing = self.find_by_base_url(base_url)
        if existing:
            result = self.public_config(existing)
            result["already_registered"] = True
            result["manifest"] = summarize_manifest(manifest)
            return result

        provider_id = self.unique_provider_id(
            derive_provider_id(base_url, catalog_id)
        )
        provider = self.register_http(
            {
                "provider_id": provider_id,
                "company_name": company_name,
                "catalog_id": catalog_id,
                "manifest_id": manifest_id,
                "base_url": base_url,
                "trust_tier": "verified",
            },
            gateway_base_url=gateway_base_url,
        )
        adapter = self.get_adapter(provider_id)
        try:
            query_result = adapter.query(
                {
                    "query": "",
                    "query_pack": catalog.QUERY_PACK_ID,
                    "limit": 1,
                },
                base_url,
            )
        except OCPError:
            self.remove(provider_id)
            raise
        provider["already_registered"] = False
        provider["manifest"] = summarize_manifest(manifest)
        provider["connection_test"] = {
            "status": "ok",
            "result_count": int(query_result.get("result_count", 0)),
        }
        return provider

    def search_directory(self, query="", region="CN", limit=20):
        merchants = merchant_directory.search(query, region, limit)
        connected_directory_ids = {
            adapter.config.get("directory_id")
            for provider_id in self.provider_ids()
            for adapter in [self.get_adapter(provider_id)]
            if adapter and adapter.config.get("directory_id")
        }
        connected_urls = {
            normalize_url(adapter.config["base_url"]): provider_id
            for provider_id, adapter in (
                (provider_id, self.get_adapter(provider_id))
                for provider_id in self.provider_ids()
            )
            if adapter and adapter.config.get("base_url")
        }
        for merchant in merchants:
            catalog_url = merchant.get("catalog_url")
            merchant["connected"] = bool(
                merchant["merchant_id"] in connected_directory_ids
                or (
                    catalog_url
                    and normalize_url(catalog_url) in connected_urls
                )
            )
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "MerchantDirectoryResult",
            "query": query,
            "region": region,
            "result_count": len(merchants),
            "merchants": merchants,
        }

    def search_stores(self, request):
        if not isinstance(request, dict):
            request = {}
        provider_ids = request.get("provider_ids")
        if provider_ids is None:
            provider_ids = [
                provider_id
                for provider_id in self.provider_ids()
                if self.get_adapter(provider_id).config.get(
                    "connection_status", "connected"
                )
                == "connected"
            ]
        elif isinstance(provider_ids, str):
            provider_ids = [
                value.strip()
                for value in provider_ids.split(",")
                if value.strip()
            ]

        stores = []
        provider_results = []
        for provider_id in provider_ids:
            adapter = self.get_adapter(provider_id)
            if not adapter:
                raise NotFoundError("provider", provider_id)
            started = time.time()
            try:
                provider_stores = adapter.stores(request)
                for store in provider_stores:
                    store["provider_id"] = provider_id
                    store["company_name"] = adapter.config["company_name"]
                    stores.append(store)
                provider_results.append(
                    {
                        "provider_id": provider_id,
                        "company_name": adapter.config["company_name"],
                        "status": "ok",
                        "store_count": len(provider_stores),
                        "latency_ms": int((time.time() - started) * 1000),
                    }
                )
            except OCPError as exc:
                provider_results.append(
                    {
                        "provider_id": provider_id,
                        "company_name": adapter.config["company_name"],
                        "status": "error",
                        "store_count": 0,
                        "error": {"code": exc.code, "message": exc.message},
                    }
                )

        radius = number_or_none(request.get("radius_km"))
        if radius is not None:
            stores = [
                store
                for store in stores
                if store.get("distance_km") is None
                or store["distance_km"] <= radius
            ]
        stores.sort(
            key=lambda store: (
                store.get("distance_km") is None,
                store.get("distance_km")
                if store.get("distance_km") is not None
                else 999999,
                store.get("name", ""),
            )
        )
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "FederatedStoreResult",
            "gateway_id": "gateway_ocp_catalog",
            "location": {
                "latitude": request.get("latitude"),
                "longitude": request.get("longitude"),
                "query": request.get("query", ""),
                "radius_km": radius,
            },
            "result_count": len(stores),
            "providers": provider_results,
            "stores": stores,
        }

    def marketplace_catalog(self, base_url):
        result = self.query({"query": "", "limit": 50}, base_url)
        products = []
        seen = set()
        for item in result.get("entries", []):
            entry = item.get("entry") or {}
            product_id = entry.get("entry_id") or "%s:%s" % (
                entry.get("provider_id"),
                entry.get("object_id"),
            )
            if not product_id or product_id in seen:
                continue
            attributes = entry.get("attributes") or {}
            price = (attributes.get("price") or {}).get("amount")
            if price is None:
                continue
            product = {
                "id": product_id,
                "name": entry.get("title") or "Unnamed product",
                "category": attributes.get("category") or "Other",
                "description": entry.get("summary") or "",
                "price": int(round(float(price) * 100)),
                "currency": (attributes.get("price") or {}).get("currency")
                or "CNY",
                "stock": int(attributes.get("stock") or 99),
                "image": marketplace_image(
                    entry.get("image_url"),
                    attributes.get("category") or "Other",
                ),
                "attributes": {
                    "merchant": item.get("source_company_name")
                    or entry.get("provider_id")
                    or "",
                    "source": entry.get("provider_id") or "",
                },
                "translations": {},
                "providerId": item.get("source_provider_id")
                or entry.get("provider_id"),
                "merchantName": item.get("source_company_name")
                or entry.get("provider_id"),
                "objectId": entry.get("object_id"),
                "objectType": entry.get("object_type"),
            }
            self.product_cache[product_id] = product
            products.append(product)
            seen.add(product_id)
        categories = sorted(
            {product["category"] for product in products},
            key=lambda value: value.lower(),
        )
        merchants = sorted(
            {product["merchantName"] for product in products},
            key=lambda value: value.lower(),
        )
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "MarketplaceCatalogResult",
            "result_count": len(products),
            "categories": categories,
            "merchants": merchants,
            "products": products,
            "providers": result.get("providers", []),
        }

    def get_cached_product(self, product_id):
        with self.lock:
            product = self.product_cache.get(product_id)
            return dict(product) if product else None

    def add_directory_merchant(
        self,
        merchant_id,
        gateway_base_url=None,
    ):
        merchant = merchant_directory.get(merchant_id)
        if not merchant:
            raise NotFoundError("merchant", merchant_id)
        if merchant["integration_mode"] == "ocp_catalog" and merchant.get(
            "catalog_url"
        ):
            provider = self.discover_and_register(
                {"url": merchant["catalog_url"]},
                gateway_base_url=gateway_base_url,
            )
            adapter = self.get_adapter(provider["provider_id"])
            if adapter:
                adapter.config["directory_id"] = merchant_id
                adapter.config["integration_mode"] = merchant["integration_mode"]
                adapter.config["connection_status"] = "connected"
                if merchant.get("stores_path"):
                    adapter.config["stores_path"] = merchant["stores_path"]
            provider["directory_id"] = merchant_id
            provider["integration_mode"] = merchant["integration_mode"]
            provider["connection_status"] = "connected"
            return provider

        if merchant["integration_mode"] == "store_network":
            provider = self.register_store_network(merchant)
            provider["already_registered"] = True
            return provider

        provider_id = self.unique_provider_id(
            "provider_%s" % merchant_id.replace("cn_", "cn_", 1)
        )
        config = self._config(
            provider_id=provider_id,
            company_name=merchant["name"],
            catalog_id="cat_%s" % merchant_id,
            manifest_id="manifest_%s_v1" % merchant_id,
            adapter_type="connector",
            trust_tier="pending",
        )
        config.update(
            {
                "directory_id": merchant_id,
                "integration_mode": merchant["integration_mode"],
                "connection_status": merchant["connection_status"],
                "description": merchant.get("description"),
            }
        )
        with self.lock:
            self.adapters[provider_id] = ConnectorPlaceholderAdapter(config)
        return self.public_config(provider_id)

    def remove(self, provider_id):
        with self.lock:
            adapter = self.adapters.get(provider_id)
            if not adapter:
                raise NotFoundError("provider", provider_id)
            if adapter.config["adapter_type"] == "local":
                raise ConflictError(
                    "provider_is_builtin",
                    "Built-in providers cannot be removed",
                )
            del self.adapters[provider_id]
        return {"provider_id": provider_id, "removed": True}

    def list(self):
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "ProviderList",
            "gateway_id": "gateway_ocp_catalog",
            "providers": [
                self.public_config(provider_id)
                for provider_id in self.provider_ids()
            ],
        }

    def manifest(self, base_url):
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "CatalogGatewayManifest",
            "gateway_id": "gateway_ocp_catalog",
            "description": "A common OCP-Catalog gateway for multiple company providers.",
            "endpoints": {
                "providers": base_url.rstrip("/") + "/ocp/gateway/providers",
                "query": base_url.rstrip("/") + "/ocp/gateway/query",
                "resolve": base_url.rstrip("/") + "/ocp/gateway/resolve",
                "stores": base_url.rstrip("/") + "/ocp/gateway/stores",
            },
            "providers": self.list()["providers"],
            "query_pack": catalog.QUERY_PACK_ID,
            "federation": {
                "mode": "fan_out",
                "dedupe_scope": "provider",
                "provider_isolation": True,
                "partial_results_allowed": True,
            },
        }

    def query(self, request, base_url):
        if not isinstance(request, dict):
            raise OCPError("invalid_query", "Query body must be an object")
        requested_ids = request.get("provider_ids")
        if requested_ids is None:
            provider_ids = [
                provider_id
                for provider_id in self.provider_ids()
                if self.get_adapter(provider_id).config.get(
                    "connection_status", "connected"
                )
                == "connected"
            ]
        elif isinstance(requested_ids, list):
            provider_ids = [str(value) for value in requested_ids]
        else:
            raise OCPError("invalid_provider_ids", "provider_ids must be an array")
        for provider_id in provider_ids:
            adapter = self.get_adapter(provider_id)
            if not adapter:
                raise NotFoundError("provider", provider_id)

        entries = []
        provider_results = []
        has_more = False
        for provider_id in provider_ids:
            adapter = self.get_adapter(provider_id)
            if not adapter:
                raise NotFoundError("provider", provider_id)
            started = time.time()
            try:
                result = adapter.query(request, base_url)
                provider_entries = result.get("entries", [])
                for item in provider_entries:
                    entry = item.get("entry") or {}
                    entry["provider_id"] = entry.get("provider_id") or provider_id
                    item["source_provider_id"] = provider_id
                    item["source_company_name"] = adapter.config["company_name"]
                    if entry.get("entry_id"):
                        with self.lock:
                            self.entry_routes[entry["entry_id"]] = provider_id
                entries.extend(provider_entries)
                has_more = has_more or bool(result.get("page", {}).get("has_more"))
                provider_results.append(
                    {
                        "provider_id": provider_id,
                        "company_name": adapter.config["company_name"],
                        "status": "ok",
                        "result_count": len(provider_entries),
                        "latency_ms": int((time.time() - started) * 1000),
                    }
                )
            except OCPError as exc:
                provider_results.append(
                    {
                        "provider_id": provider_id,
                        "company_name": adapter.config["company_name"],
                        "status": "error",
                        "result_count": 0,
                        "latency_ms": int((time.time() - started) * 1000),
                        "error": {"code": exc.code, "message": exc.message},
                    }
                )
        entries.sort(key=lambda item: item.get("score", 0), reverse=True)
        limit = int(request.get("limit", catalog.DEFAULT_LIMIT))
        return {
            "ocp_version": catalog.OCP_VERSION,
            "kind": "FederatedCatalogQueryResult",
            "id": catalog.new_id("fqry"),
            "gateway_id": "gateway_ocp_catalog",
            "query_pack": catalog.QUERY_PACK_ID,
            "query": str(request.get("query") or ""),
            "result_count": len(entries),
            "page": {
                "limit": limit,
                "offset": 0,
                "has_more": has_more,
            },
            "providers": provider_results,
            "entries": entries,
            "audit_id": catalog.new_id("audit"),
        }

    def resolve(self, request, base_url):
        if not isinstance(request, dict):
            raise OCPError("invalid_resolve", "Resolve body must be an object")
        provider_id = request.get("provider_id")
        entry_id = request.get("entry_id")
        if not provider_id and entry_id:
            with self.lock:
                provider_id = self.entry_routes.get(entry_id)
        if not provider_id:
            raise OCPError(
                "provider_required",
                "provider_id is required when entry_id has not been queried through this gateway",
            )
        adapter = self.get_adapter(provider_id)
        if not adapter:
            raise NotFoundError("provider", provider_id)
        result = adapter.resolve(request, base_url)
        result["gateway_id"] = "gateway_ocp_catalog"
        result["provider_id"] = provider_id
        result["source_company_name"] = adapter.config["company_name"]
        return result

    def public_config(self, provider_id):
        adapter = self.get_adapter(provider_id)
        if not adapter:
            raise NotFoundError("provider", provider_id)
        config = dict(adapter.config)
        config.pop("base_url", None)
        config["supports_stores"] = bool(
            config.get("stores_path")
            or (
                isinstance(adapter, LocalCatalogAdapter)
                and adapter.store_network
            )
        )
        return config

    def provider_ids(self):
        with self.lock:
            return sorted(self.adapters)

    def get_adapter(self, provider_id):
        with self.lock:
            return self.adapters.get(provider_id)

    def find_by_base_url(self, base_url):
        normalized = normalize_url(base_url)
        for provider_id in self.provider_ids():
            adapter = self.get_adapter(provider_id)
            if (
                adapter
                and adapter.config.get("base_url")
                and normalize_url(adapter.config["base_url"]) == normalized
            ):
                return provider_id
        return None

    def find_by_directory_id(self, directory_id):
        for provider_id in self.provider_ids():
            adapter = self.get_adapter(provider_id)
            if (
                adapter
                and adapter.config.get("directory_id") == directory_id
            ):
                return provider_id
        return None

    def unique_provider_id(self, preferred):
        provider_id = preferred
        suffix = 2
        with self.lock:
            while provider_id in self.adapters:
                provider_id = "%s_%s" % (preferred[:72], suffix)
                suffix += 1
        return provider_id

    @staticmethod
    def _config(
        provider_id,
        company_name,
        catalog_id,
        manifest_id,
        adapter_type,
        trust_tier,
        base_url=None,
    ):
        return {
            "provider_id": provider_id,
            "company_name": company_name,
            "catalog_id": catalog_id,
            "manifest_id": manifest_id,
            "adapter_type": adapter_type,
            "trust_tier": trust_tier,
            "enabled": True,
            "base_url": base_url,
        }


def normalize_url(value):
    parsed = urllib.parse.urlsplit(value)
    host = (parsed.hostname or "").lower()
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path.rstrip("/")
    return "%s://%s:%s%s" % (parsed.scheme.lower(), host, port, path)


def discover_catalog(url):
    parsed = urllib.parse.urlsplit(url)
    path = parsed.path.rstrip("/")
    if path.endswith("/ocp/manifest"):
        base_url = url[: -len("/ocp/manifest")].rstrip("/")
        manifest = fetch_json_url(url)
        return base_url, None, manifest

    if path.endswith("/.well-known/ocp-catalog"):
        base_url = url[: -len("/.well-known/ocp-catalog")].rstrip("/")
        discovery_url = url
    else:
        base_url = url.rstrip("/")
        discovery_url = base_url + "/.well-known/ocp-catalog"

    discovery = fetch_json_url(discovery_url)
    if discovery.get("kind") != "WellKnownCatalogDiscovery":
        raise OCPError(
            "invalid_discovery_document",
            "The discovery response is not a WellKnownCatalogDiscovery",
        )
    manifest_url = discovery.get("manifest_url") or base_url + "/ocp/manifest"
    manifest = fetch_json_url(manifest_url)
    return base_url, discovery, manifest


def fetch_json_url(url):
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "X-OCP-Version": catalog.OCP_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise OCPError(
            "discovery_http_error",
            "Catalog discovery returned HTTP %s" % exc.code,
            status=502,
            details={"url": url},
        )
    except (OSError, ValueError) as exc:
        raise OCPError(
            "catalog_unreachable",
            "Unable to read catalog discovery: %s" % exc,
            status=502,
            details={"url": url},
        )
    if not isinstance(value, dict):
        raise OCPError(
            "invalid_discovery_document",
            "Catalog discovery response must be a JSON object",
        )
    return value


def derive_provider_id(base_url, catalog_id):
    value = catalog_id or urllib.parse.urlsplit(base_url).hostname or "catalog"
    if value.startswith("cat_"):
        value = value[4:]
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if len(slug) < 3:
        slug = "company_%s" % slug
    return ("provider_%s" % slug)[:80]


def summarize_manifest(manifest):
    return {
        "id": manifest.get("id"),
        "kind": manifest.get("kind"),
        "catalog_id": manifest.get("catalog_id"),
        "catalog_name": manifest.get("catalog_name"),
        "query_capability_count": len(manifest.get("query_capabilities") or []),
        "object_contract_count": len(manifest.get("object_contracts") or []),
    }


def marketplace_image(image_url, category):
    if category in ("咖啡", "饮品"):
        return "/assets/coffee-drink.svg"
    if category in ("汉堡", "小食", "甜品"):
        return "/assets/fast-food.svg"
    if image_url and not image_url.startswith("http"):
        return image_url
    return "/assets/ocp-mark.svg"


def extract_stores(response):
    if isinstance(response, list):
        return [normalize_store(item) for item in response]
    if not isinstance(response, dict):
        return []
    for key in ("stores", "shopList", "shops", "list", "data"):
        value = response.get(key)
        if isinstance(value, list):
            return [normalize_store(item) for item in value]
        if isinstance(value, dict):
            nested = extract_stores(value)
            if nested:
                return nested
    return []


def normalize_store(store):
    if not isinstance(store, dict):
        return {}
    hours = store.get("hours")
    if not hours:
        start = store.get("workTimeStart") or ""
        end = store.get("workTimeEnd") or ""
        hours = "%s-%s" % (start, end) if start or end else ""
    return {
        "store_id": str(
            store.get("store_id")
            or store.get("storeId")
            or store.get("deptId")
            or store.get("id")
            or ""
        ),
        "name": str(
            store.get("name")
            or store.get("storeName")
            or store.get("deptName")
            or "Unnamed store"
        ),
        "address": str(store.get("address") or store.get("storeAddress") or ""),
        "longitude": number_or_none(store.get("longitude")),
        "latitude": number_or_none(store.get("latitude")),
        "distance_km": number_or_none(
            store.get("distance_km", store.get("distance"))
        ),
        "hours": hours,
        "tags": store.get("tags") or store.get("deptTags") or [],
        "phone": store.get("phone") or store.get("number"),
    }


def filter_stores(stores, request):
    latitude = number_or_none(request.get("latitude"))
    longitude = number_or_none(request.get("longitude"))
    query = str(request.get("query") or "").strip().lower()
    output = []
    for raw in stores:
        store = normalize_store(raw)
        if query and query not in (
            store["name"] + " " + store["address"]
        ).lower():
            continue
        if (
            store.get("distance_km") is None
            and latitude is not None
            and longitude is not None
            and store.get("latitude") is not None
            and store.get("longitude") is not None
        ):
            store["distance_km"] = haversine_km(
                latitude,
                longitude,
                store["latitude"],
                store["longitude"],
            )
        output.append(store)
    return output


def number_or_none(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    import math

    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return round(
        radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)),
        2,
    )
