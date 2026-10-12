import argparse
import json
import os
import posixpath
import socket
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from . import catalog, qr
from .assistant import ShoppingAssistant
from .errors import OCPError
from .models import CommerceStore
from .providers import ProviderRegistry


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_ROOT = os.path.join(ROOT, "web")
PROTOCOL_HEADER = "X-OCP-Version"


class OCPHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, store):
        self.store = store
        self.registry = ProviderRegistry(store)
        self.assistant = ShoppingAssistant(self.registry, store)
        super(OCPHTTPServer, self).__init__(address, handler)

    def handle_error(self, request, client_address):
        error_type = sys.exc_info()[0]
        if error_type and issubclass(
            error_type,
            (ConnectionError, BrokenPipeError),
        ):
            return
        super(OCPHTTPServer, self).handle_error(request, client_address)


class OCPRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    server_version = "OCPCommerceLab/1.0"

    def log_message(self, fmt, *args):
        if getattr(self.server, "quiet", False):
            return
        sys.stderr.write("[http] %s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        self.close_connection = True
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OCP-Version, Idempotency-Key, X-OCP-Agent")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Connection", "close")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._handle_request("GET")

    def do_POST(self):
        self._handle_request("POST")

    def do_PATCH(self):
        self._handle_request("PATCH")

    def do_DELETE(self):
        self._handle_request("DELETE")

    def _handle_request(self, method):
        started = time.time()
        request_id = "req_%s" % uuid.uuid4().hex[:18]
        split = urlsplit(self.path)
        path = unquote(split.path)
        catalog_request = path.startswith("/.well-known/ocp-catalog") or (
            path.startswith("/ocp/") and not path.startswith("/ocp/v1/")
        )
        try:
            if path.startswith("/.well-known/ocp-catalog") or (
                path.startswith("/ocp/") and not path.startswith("/ocp/v1/")
            ):
                response = self._handle_catalog(method, path)
            elif path.startswith("/ocp/v1/") or path == "/.well-known/ocp":
                response = self._handle_ocp(method, path, parse_qs(split.query))
            elif path.startswith("/api/"):
                response = self._handle_ui(method, path, parse_qs(split.query))
            elif path.startswith("/pay/"):
                self._serve_payment_page(method, path)
                return
            elif method == "GET":
                self._serve_static(path)
                return
            else:
                raise OCPError("not_found", "Route not found", status=404)
            self._send_json(
                response,
                request_id=request_id,
                catalog_protocol=catalog_request,
            )
            duration = int((time.time() - started) * 1000)
            self.server.store.record_transport_event(
                "response",
                method,
                path,
                200,
                request_id,
                self._transport_payload(response),
                duration,
            )
        except OCPError as exc:
            error_body = (
                self._catalog_error_body(exc)
                if catalog_request
                else self._error_body(exc, request_id)
            )
            self._send_json(
                error_body,
                status=exc.status,
                request_id=request_id,
                catalog_protocol=catalog_request,
            )
            self.server.store.record_transport_event(
                "error",
                method,
                path,
                exc.status,
                request_id,
                {"code": exc.code, "message": exc.message},
                int((time.time() - started) * 1000),
            )
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            error = OCPError("invalid_request", str(exc), status=400)
            body = (
                self._catalog_error_body(error)
                if catalog_request
                else self._error_body(error, request_id)
            )
            self._send_json(
                body,
                status=400,
                request_id=request_id,
                catalog_protocol=catalog_request,
            )
        except Exception as exc:
            error = OCPError("internal_error", "Unexpected server error", status=500)
            body = (
                self._catalog_error_body(error)
                if catalog_request
                else self._error_body(error, request_id)
            )
            self._send_json(
                body,
                status=500,
                request_id=request_id,
                catalog_protocol=catalog_request,
            )
            if not getattr(self.server, "quiet", False):
                sys.stderr.write("[error] %s: %r\n" % (request_id, exc))

    def _handle_catalog(self, method, path):
        base_url = self._base_url()
        if path == "/.well-known/ocp-catalog" and method == "GET":
            return catalog.create_well_known(base_url)
        if path == "/ocp/manifest" and method == "GET":
            return catalog.create_manifest(base_url)
        if path == "/ocp/health" and method == "GET":
            return catalog.create_health(self.server.store)
        if path == "/ocp/contracts" and method == "GET":
            return catalog.create_contracts()
        if path == "/ocp/query" and method == "POST":
            return catalog.query_catalog(
                self.server.store,
                self._read_json(),
                base_url,
            )
        if path == "/ocp/resolve" and method == "POST":
            return catalog.resolve_catalog_entry(
                self.server.store,
                self._read_json(),
                base_url,
            )
        if path == "/.well-known/ocp-catalog-gateway" and method == "GET":
            return {
                "ocp_version": catalog.OCP_VERSION,
                "kind": "WellKnownCatalogGatewayDiscovery",
                "gateway_id": "gateway_ocp_catalog",
                "manifest_url": base_url + "/ocp/gateway/manifest",
                "providers_url": base_url + "/ocp/gateway/providers",
                "query_url": base_url + "/ocp/gateway/query",
                "resolve_url": base_url + "/ocp/gateway/resolve",
            }
        if path == "/ocp/gateway/manifest" and method == "GET":
            return self.server.registry.manifest(base_url)
        if path == "/ocp/gateway/providers" and method == "GET":
            return self.server.registry.list()
        if path == "/ocp/gateway/providers" and method == "POST":
            return self.server.registry.register_http(
                self._read_json(),
                gateway_base_url=base_url,
            )
        if path == "/ocp/gateway/providers/quick" and method == "POST":
            return self.server.registry.discover_and_register(
                self._read_json(),
                gateway_base_url=base_url,
            )
        if path == "/ocp/gateway/directory" and method == "GET":
            query = parse_qs(urlsplit(self.path).query)
            return self.server.registry.search_directory(
                query=self._first(query, "query"),
                region=self._first(query, "region") or "CN",
                limit=int(self._first(query, "limit") or 20),
            )
        if path == "/ocp/gateway/directory/add" and method == "POST":
            body = self._read_json()
            return self.server.registry.add_directory_merchant(
                body.get("merchant_id"),
                gateway_base_url=base_url,
            )
        if path == "/ocp/gateway/stores" and method == "GET":
            query = parse_qs(urlsplit(self.path).query)
            provider_ids = self._first(query, "provider_ids")
            return self.server.registry.search_stores(
                {
                    "provider_ids": provider_ids or None,
                    "latitude": self._first(query, "latitude") or None,
                    "longitude": self._first(query, "longitude") or None,
                    "query": self._first(query, "query"),
                    "radius_km": self._first(query, "radius_km") or None,
                }
            )
        if path.startswith("/ocp/gateway/providers/") and method == "DELETE":
            provider_id = path[len("/ocp/gateway/providers/") :].strip("/")
            return self.server.registry.remove(provider_id)
        if path == "/ocp/gateway/query" and method == "POST":
            return self.server.registry.query(self._read_json(), base_url)
        if path == "/ocp/gateway/resolve" and method == "POST":
            return self.server.registry.resolve(self._read_json(), base_url)
        raise OCPError("not_found", "OCP Catalog route not found", status=404)

    def _handle_ocp(self, method, path, query):
        if path == "/.well-known/ocp" and method == "GET":
            return self._envelope(self._discovery_document())
        if path == "/ocp/v1/capabilities" and method == "GET":
            return self._envelope(self.server.store.capabilities())
        if path == "/ocp/v1/catalog" and method == "GET":
            products = self.server.store.catalog(
                query=self._first(query, "query"),
                category=self._first(query, "category"),
            )
            return self._envelope({"items": products, "count": len(products)})
        if path.startswith("/ocp/v1/products/") and method == "GET":
            product_id = path[len("/ocp/v1/products/") :].strip("/")
            return self._envelope(self.server.store.get_product(product_id))
        if path == "/ocp/v1/carts" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(body, lambda: self.server.store.create_cart(body.get("buyerId")))
        if path.startswith("/ocp/v1/carts/"):
            return self._handle_cart_route(method, path)
        if path == "/ocp/v1/checkouts" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.create_checkout(
                    body.get("cartId"),
                    fulfillment=body.get("fulfillment", "standard"),
                    buyer=body.get("buyer"),
                ),
            )
        if path.startswith("/ocp/v1/checkouts/"):
            return self._handle_checkout_route(method, path)
        if path.startswith("/ocp/v1/orders/") and method == "GET":
            order_id = path[len("/ocp/v1/orders/") :].strip("/")
            return self._envelope(self.server.store.get_order(order_id))
        if path.startswith("/ocp/v1/orders/") and method == "POST":
            parts = [part for part in path[len("/ocp/v1/orders/") :].split("/") if part]
            if len(parts) == 2 and parts[1] == "cancel":
                body = self._read_json()
                return self._with_idempotency(
                    body,
                    lambda: self.server.store.cancel_order(
                        parts[0], reason=body.get("reason", "buyer_requested")
                    ),
                )
        raise OCPError("not_found", "OCP route not found", status=404)

    def _handle_cart_route(self, method, path):
        parts = [part for part in path[len("/ocp/v1/carts/") :].split("/") if part]
        if len(parts) == 1 and method == "GET":
            return self._envelope(self.server.store.get_cart(parts[0]))
        if len(parts) == 2 and parts[1] == "items" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.add_cart_item(
                    parts[0], body.get("productId"), body.get("quantity", 1)
                ),
            )
        if len(parts) == 3 and parts[1] == "items" and method == "PATCH":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.update_cart_item(parts[0], parts[2], body.get("quantity")),
            )
        if len(parts) == 3 and parts[1] == "items" and method == "DELETE":
            return self._envelope(self.server.store.remove_cart_item(parts[0], parts[2]))
        raise OCPError("not_found", "Cart route not found", status=404)

    def _handle_checkout_route(self, method, path):
        parts = [part for part in path[len("/ocp/v1/checkouts/") :].split("/") if part]
        if len(parts) == 1 and method == "GET":
            return self._envelope(self.server.store.get_checkout(parts[0]))
        if len(parts) == 2 and parts[1] == "cancel" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.cancel_checkout(
                    parts[0],
                    reason=body.get("reason", "buyer_requested"),
                ),
            )
        if len(parts) == 2 and parts[1] == "pay" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.pay_checkout(
                    parts[0], body.get("paymentMethodToken")
                ),
            )
        raise OCPError("not_found", "Checkout route not found", status=404)

    def _transport_payload(self, response):
        if not isinstance(response, dict):
            return response
        data = response.get("data") if "data" in response else response
        if not isinstance(data, dict):
            return data
        if "metrics" in data and "orders" in data:
            return {
                "kind": "StateSnapshot",
                "metrics": data.get("metrics"),
                "orderCount": len(data.get("orders") or []),
                "checkoutCount": len(data.get("checkouts") or []),
            }
        if "products" in data and "result_count" in data:
            return {
                "kind": data.get("kind"),
                "resultCount": data.get("result_count"),
                "merchantCount": len(data.get("merchants") or []),
            }
        if "stores" in data and "result_count" in data:
            return {
                "kind": data.get("kind"),
                "resultCount": data.get("result_count"),
            }
        if "id" in data and ("status" in data or "itemCount" in data):
            return {
                "id": data.get("id"),
                "status": data.get("status"),
                "itemCount": data.get("itemCount"),
                "total": (data.get("totals") or {}).get("total"),
            }
        return data

    def _handle_ui(self, method, path, query):
        del query
        if path == "/api/state" and method == "GET":
            state = self.server.store.snapshot()
            state["ocpCatalog"] = catalog.catalog_metadata()
            state["ocpManifest"] = catalog.create_manifest(self._base_url())
            state["ocpGateway"] = self.server.registry.manifest(self._base_url())
            return self._envelope(state)
        if path == "/api/marketplace" and method == "GET":
            return self._envelope(
                self.server.registry.marketplace_catalog(self._base_url())
            )
        if path == "/api/assistant/plan" and method == "POST":
            body = self._read_json()
            return self._envelope(
                self.server.assistant.plan(
                    body.get("requirement"),
                    self._base_url(),
                )
            )
        if path == "/api/assistant/confirm" and method == "POST":
            body = self._read_json()
            if body.get("confirmed") is not True:
                raise OCPError(
                    "user_confirmation_required",
                    "The shopping plan requires explicit user confirmation",
                    status=409,
                )
            return self._envelope(
                self.server.assistant.confirm(
                    body.get("planId"),
                    buyer_id=body.get("buyerId", "assistant_buyer"),
                    store_id=body.get("storeId"),
                )
            )
        if path == "/api/assistant/payment-qr" and method == "POST":
            body = self._read_json()
            if body.get("consent") is not True:
                raise OCPError(
                    "payment_consent_required",
                    "Payment QR generation requires explicit user consent",
                    status=409,
                )
            provider = str(body.get("provider") or "wechat")
            if provider != "wechat":
                raise OCPError(
                    "payment_provider_unsupported",
                    "Only the WeChat sandbox QR flow is enabled",
                )
            intent = self.server.store.create_payment_intent(
                body.get("checkoutId"),
                provider=provider,
                base_url=self._base_url(),
            )
            if intent.get("status") == "succeeded":
                return self._envelope(intent)
            return self._envelope(
                {
                    **intent,
                    "qrSvg": qr.make_qr_svg(intent["paymentUrl"]),
                    "sandbox": True,
                }
            )
        if path.startswith("/api/payments/") and method == "POST":
            parts = [part for part in path[len("/api/payments/") :].split("/") if part]
            if len(parts) == 2 and parts[1] == "complete":
                return self._envelope(
                    self.server.store.complete_payment_intent(parts[0])
                )
        if path.startswith("/api/payments/") and method == "GET":
            payment_id = path[len("/api/payments/") :].strip("/")
            return self._envelope(self.server.store.get_payment_intent(payment_id))
        if path == "/api/health" and method == "GET":
            return self._envelope(
                {"status": "ok", "service": "open-commerce-protocol", "version": "1.0.0"}
            )
        if path == "/api/agent/run" and method == "POST":
            from .agent import OCPAgent

            body = self._read_json()
            port = self.server.server_address[1]
            agent = OCPAgent("http://127.0.0.1:%s" % port)
            result = agent.run(body.get("query", "portable"))
            return self._envelope(result)
        if path == "/api/actions/add-to-cart" and method == "POST":
            body = self._read_json()
            self._ensure_marketplace_product(body.get("productId"))
            return self._with_idempotency(
                body,
                lambda: self.server.store.add_cart_item(
                    body.get("cartId"),
                    body.get("productId"),
                    body.get("quantity", 1),
                ),
            )
        if path == "/api/actions/checkout" and method == "POST":
            body = self._read_json()
            return self._with_idempotency(
                body,
                lambda: self.server.store.create_checkout(
                    body.get("cartId"),
                    body.get("fulfillment", "standard"),
                    body.get("buyer"),
                ),
            )
        raise OCPError("not_found", "UI route not found", status=404)

    def _ensure_marketplace_product(self, product_id):
        if not product_id or product_id in self.server.store.products:
            return
        product = self.server.registry.get_cached_product(product_id)
        if not product:
            raise OCPError(
                "product_not_cached",
                "Refresh the marketplace catalog before adding this product",
                status=409,
            )
        self.server.store.register_product(product)

    def _serve_payment_page(self, method, path):
        parts = [part for part in path[len("/pay/") :].split("/") if part]
        if not parts:
            raise OCPError("not_found", "Payment page not found", status=404)
        payment_id = parts[0]
        if len(parts) == 2 and parts[1] == "complete" and method == "POST":
            order = self.server.store.complete_payment_intent(payment_id)
            self._send_payment_html(
                "<h1>Payment complete</h1><p>Order %s confirmed.</p>"
                % order["id"]
            )
            return
        if method != "GET":
            raise OCPError("not_found", "Payment route not found", status=404)
        intent = self.server.store.get_payment_intent(payment_id)
        amount = "%.2f %s" % (
            intent["amount"] / 100.0,
            intent["currency"],
        )
        self._send_payment_html(
            (
                "<h1>OCP WeChat sandbox payment</h1>"
                "<p>Payment intent: %s</p>"
                "<p class=\"amount\">%s</p>"
                "<form method=\"post\" action=\"/pay/%s/complete\">"
                "<button type=\"submit\">Confirm sandbox payment</button>"
                "</form>"
                "<p class=\"notice\">For demonstration only. "
                "Production WeChat Pay requires a verified merchant account.</p>"
            )
            % (payment_id, amount, payment_id)
        )

    def _send_payment_html(self, content):
        body = (
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>OCP Payment</title><style>"
            "body{font-family:system-ui,sans-serif;padding:32px;background:#f3f6f5;color:#18221f}"
            "main{max-width:480px;margin:10vh auto;background:#fff;padding:28px;"
            "border:1px solid #dbe2df;border-radius:8px}"
            ".amount{font-size:34px;font-weight:700}"
            "button{width:100%%;padding:12px;border:0;border-radius:6px;"
            "background:#08796a;color:#fff;font-size:16px}"
            ".notice{color:#65736e;font-size:13px}"
            "</style></head><body><main>%s</main></body></html>" % content
        ).encode("utf-8")
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
            self.wfile.flush()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def _with_idempotency(self, body, operation):
        idempotency_key = self.headers.get("Idempotency-Key")
        cached = self.server.store.idempotent_result(idempotency_key, body)
        if cached is not None:
            return self._envelope(cached)
        result = operation()
        self.server.store.save_idempotent_result(idempotency_key, body, result)
        return self._envelope(result)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise OCPError("invalid_request", "Invalid Content-Length")
        if length > 1024 * 1024:
            raise OCPError("payload_too_large", "Request body exceeds 1 MiB", status=413)
        raw = self.rfile.read(length) if length else b"{}"
        content_type = self.headers.get("Content-Type", "")
        if raw and "json" not in content_type:
            raise OCPError("unsupported_media_type", "Content-Type must be application/json", status=415)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise OCPError("invalid_json", "Request body is not valid JSON")
        if not isinstance(body, dict):
            raise OCPError("invalid_request", "JSON body must be an object")
        return body

    def _envelope(self, data):
        return {
            "protocol": "ocp",
            "version": "1.0",
            "contentType": "application/ocp+json",
            "data": data,
        }

    def _error_body(self, error, request_id):
        return {
            "protocol": "ocp",
            "version": "1.0",
            "requestId": request_id,
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
            },
        }

    def _catalog_error_body(self, error):
        return {
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
            }
        }

    def _base_url(self):
        host = self.headers.get("Host")
        if not host:
            host = "%s:%s" % self.server.server_address[:2]
        configured = os.environ.get("OCP_PUBLIC_BASE_URL")
        if configured:
            return configured.rstrip("/")
        hostname = host.split(":", 1)[0].strip("[]").lower()
        if hostname in ("127.0.0.1", "localhost", "::1"):
            bound_host = self.server.server_address[0]
            if bound_host in ("0.0.0.0", "::"):
                lan_ip = detect_lan_ip()
                if lan_ip:
                    port = self.server.server_address[1]
                    return "http://%s:%s" % (lan_ip, port)
        return "http://%s" % host

    def _discovery_document(self):
        return {
            "protocol": "ocp",
            "version": "1.0",
            "service": "merchant",
            "capabilities": "/ocp/v1/capabilities",
            "catalog": "/ocp/v1/catalog",
            "carts": "/ocp/v1/carts",
            "checkouts": "/ocp/v1/checkouts",
            "orders": "/ocp/v1/orders/{order_id}",
            "cancelOrder": "/ocp/v1/orders/{order_id}/cancel",
            "headers": {
                "version": PROTOCOL_HEADER,
                "idempotency": "Idempotency-Key",
                "agent": "X-OCP-Agent",
            },
        }

    def _send_json(self, value, status=200, request_id=None, catalog_protocol=False):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        content_type = (
            "application/json; charset=utf-8"
            if catalog_protocol
            else "application/ocp+json; charset=utf-8"
        )
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-OCP-Catalog-Id", catalog.CATALOG_ID)
        if request_id:
            self.send_header("X-Request-Id", request_id)
        self.end_headers()
        try:
            self.wfile.write(body)
            self.wfile.flush()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def _serve_static(self, request_path):
        if request_path == "/":
            request_path = "/index.html"
        normalized = posixpath.normpath(request_path).lstrip("/")
        if normalized.startswith("../") or normalized == "..":
            raise OCPError("invalid_path", "Invalid path", status=400)
        file_path = os.path.abspath(os.path.join(WEB_ROOT, normalized.replace("/", os.sep)))
        if not file_path.startswith(os.path.abspath(WEB_ROOT) + os.sep):
            raise OCPError("invalid_path", "Invalid path", status=400)
        if not os.path.isfile(file_path):
            raise OCPError("not_found", "Static file not found", status=404)
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
        }
        extension = os.path.splitext(file_path)[1].lower()
        with open(file_path, "rb") as handle:
            body = handle.read()
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(extension, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
            self.wfile.flush()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    @staticmethod
    def _first(query, key):
        values = query.get(key) or [""]
        return values[0]


def create_server(host="127.0.0.1", port=8760, store=None, quiet=False):
    store = store or CommerceStore()
    server = OCPHTTPServer((host, port), OCPRequestHandler, store)
    server.quiet = quiet
    return server


def detect_lan_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return None


def run_server(host="127.0.0.1", port=8760, quiet=False):
    server = create_server(host, port, quiet=quiet)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.25})
    thread.daemon = True
    thread.start()
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the Open Commerce Protocol demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8760, type=int)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)
    server = create_server(args.host, args.port, quiet=args.quiet)
    print("OCP Commerce Lab: http://%s:%s" % (args.host, server.server_address[1]))
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
