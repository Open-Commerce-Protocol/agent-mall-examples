import json
import urllib.error
import urllib.request


class OCPAgent:
    """Buyer-side agent that demonstrates the complete OCP commerce flow."""

    def __init__(self, base_url, agent_name="codex-buyer-agent"):
        self.base_url = base_url.rstrip("/")
        self.agent_name = agent_name

    def request(self, method, path, body=None, idempotency_key=None):
        data = None
        headers = {
            "Accept": "application/ocp+json",
            "X-OCP-Version": "1.0",
            "X-OCP-Agent": self.agent_name,
        }
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = urllib.request.urlopen(request, timeout=12)
            payload = json.loads(response.read().decode("utf-8"))
            return payload["data"]
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            try:
                payload = json.loads(raw)
                message = payload.get("error", {}).get("message", raw)
                code = payload.get("error", {}).get("code", "http_error")
            except ValueError:
                message = raw
                code = "http_error"
            raise RuntimeError("%s (%s): %s" % (code, exc.code, message))

    def run(self, query="portable"):
        steps = []

        capabilities = self.request("GET", "/ocp/v1/capabilities")
        steps.append(self._step("capabilities", "Merchant capabilities discovered", capabilities))

        catalog = self.request("GET", "/ocp/v1/catalog")
        products = catalog.get("items", [])
        query_lower = (query or "").lower()
        matching = [
            product
            for product in products
            if query_lower in (
                product["name"] + " " + product["category"] + " " + product["description"]
            ).lower()
        ]
        selected = (matching or products)[:2]
        if not selected:
            raise RuntimeError("catalog_empty: Merchant has no products")
        steps.append(
            self._step(
                "catalog.search",
                "Selected %s product(s)" % len(selected),
                {"query": query, "products": selected},
            )
        )

        cart = self.request("POST", "/ocp/v1/carts", {"buyerId": "buyer_agent_demo"})
        cart_id = cart["id"]
        steps.append(self._step("cart.create", "Created shopping cart", cart))

        for product in selected:
            cart = self.request(
                "POST",
                "/ocp/v1/carts/%s/items" % cart_id,
                {"productId": product["id"], "quantity": 1},
                idempotency_key="agent-cart-%s-%s" % (cart_id, product["id"]),
            )
        steps.append(self._step("cart.item.add", "Cart priced by merchant", cart))

        checkout = self.request(
            "POST",
            "/ocp/v1/checkouts",
            {
                "cartId": cart_id,
                "fulfillment": "standard",
                "buyer": {
                    "name": "OCP Demo Buyer",
                    "email": "buyer@example.com",
                    "address": {
                        "line1": "88 Commerce Road",
                        "city": "Shanghai",
                        "postalCode": "200000",
                        "country": "CN",
                    },
                },
            },
            idempotency_key="agent-checkout-%s" % cart_id,
        )
        steps.append(
            self._step(
                "checkout.create",
                "Checkout total returned by merchant",
                checkout,
            )
        )

        order = self.request(
            "POST",
            "/ocp/v1/checkouts/%s/pay" % checkout["id"],
            {"paymentMethodToken": "tok_demo_visa"},
            idempotency_key="agent-payment-%s" % checkout["id"],
        )
        steps.append(self._step("checkout.pay", "Payment succeeded and order confirmed", order))

        fetched = self.request("GET", "/ocp/v1/orders/%s" % order["id"])
        steps.append(self._step("order.get", "Order state reconciled", fetched))
        return {
            "agent": self.agent_name,
            "status": "completed",
            "query": query,
            "steps": steps,
            "order": fetched,
        }

    @staticmethod
    def _step(operation, message, data):
        return {
            "operation": operation,
            "message": message,
            "data": data,
        }
