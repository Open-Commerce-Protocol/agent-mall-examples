import copy
import datetime
import hashlib
import json
import threading
import uuid
from collections import deque

from .errors import ConflictError, NotFoundError, OCPError


def utc_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def new_id(prefix):
    return "%s_%s" % (prefix, uuid.uuid4().hex[:18])


PRODUCTS = [
    {
        "id": "prod_aurora_lamp",
        "name": "Aurora Task Light",
        "category": "Home",
        "description": "Dimmable desk light with warm, neutral and daylight profiles.",
        "price": 12900,
        "currency": "CNY",
        "stock": 18,
        "image": "/assets/aurora-lamp.svg",
        "attributes": {"color": "Graphite", "power": "12 W", "warranty": "2 years"},
        "translations": {
            "zh-CN": {
                "name": "极光工作灯",
                "category": "家居",
                "description": "支持暖光、中性光和日光模式的无级调光桌面灯。",
                "attributes": {"color": "石墨黑", "power": "12 W", "warranty": "2 年"},
            }
        },
    },
    {
        "id": "prod_pulse_headphones",
        "name": "Pulse Studio Headphones",
        "category": "Audio",
        "description": "Closed-back wireless headphones with low-latency USB-C audio.",
        "price": 79900,
        "currency": "CNY",
        "stock": 7,
        "image": "/assets/pulse-headphones.svg",
        "attributes": {"color": "Midnight", "battery": "42 h", "warranty": "2 years"},
        "translations": {
            "zh-CN": {
                "name": "Pulse 录音耳机",
                "category": "音频",
                "description": "支持低延迟 USB-C 音频的封闭式无线头戴耳机。",
                "attributes": {"color": "午夜黑", "battery": "42 小时", "warranty": "2 年"},
            }
        },
    },
    {
        "id": "prod_slate_keyboard",
        "name": "Slate 75 Keyboard",
        "category": "Workspace",
        "description": "Compact mechanical keyboard with hot-swap switches and Bluetooth.",
        "price": 45900,
        "currency": "CNY",
        "stock": 12,
        "image": "/assets/slate-keyboard.svg",
        "attributes": {"layout": "75%", "connection": "USB-C / BT", "warranty": "1 year"},
        "translations": {
            "zh-CN": {
                "name": "Slate 75 机械键盘",
                "category": "办公",
                "description": "支持热插拔轴体和蓝牙连接的紧凑型机械键盘。",
                "attributes": {"layout": "75%", "connection": "USB-C / 蓝牙", "warranty": "1 年"},
            }
        },
    },
    {
        "id": "prod_meridian_bottle",
        "name": "Meridian Bottle",
        "category": "Travel",
        "description": "Double-wall stainless bottle with a leak-proof ceramic lid.",
        "price": 18900,
        "currency": "CNY",
        "stock": 25,
        "image": "/assets/meridian-bottle.svg",
        "attributes": {"capacity": "600 ml", "material": "18/8 steel", "warranty": "1 year"},
        "translations": {
            "zh-CN": {
                "name": "Meridian 保温瓶",
                "category": "出行",
                "description": "采用防漏陶瓷盖的双层不锈钢保温瓶。",
                "attributes": {"capacity": "600 ml", "material": "18/8 不锈钢", "warranty": "1 年"},
            }
        },
    },
    {
        "id": "prod_cloud_backpack",
        "name": "Cloud Daypack",
        "category": "Travel",
        "description": "Weather-resistant 18 L daypack with a padded 14-inch laptop sleeve.",
        "price": 59900,
        "currency": "CNY",
        "stock": 9,
        "image": "/assets/cloud-backpack.svg",
        "attributes": {"capacity": "18 L", "laptop": "14 in", "warranty": "2 years"},
        "translations": {
            "zh-CN": {
                "name": "Cloud 通勤背包",
                "category": "出行",
                "description": "带 14 英寸笔记本隔层的 18 L 防泼水通勤背包。",
                "attributes": {"capacity": "18 L", "laptop": "14 英寸", "warranty": "2 年"},
            }
        },
    },
]


class CommerceStore:
    """In-memory merchant implementing the OCP commerce state machine."""

    def __init__(self, products=None):
        self.lock = threading.RLock()
        self.products = {
            item["id"]: copy.deepcopy(item) for item in (products or PRODUCTS)
        }
        self.carts = {}
        self.checkouts = {}
        self.orders = {}
        self.payments = {}
        self.payment_intents = {}
        self.events = deque(maxlen=400)
        self.idempotency = {}
        self.started_at = utc_now()

    def capabilities(self):
        return {
            "merchant": {
                "id": "merchant_ocp_demo",
                "name": "OCP Supply Lab",
                "currency": "CNY",
                "locale": "zh-CN",
            },
            "protocol": {
                "name": "Open Commerce Protocol",
                "version": "1.0",
                "envelope": "application/ocp+json",
                "idempotency": "Idempotency-Key",
            },
            "operations": [
                "catalog.search",
                "product.get",
                "cart.create",
                "cart.item.add",
                "cart.item.update",
                "cart.item.remove",
                "checkout.create",
                "checkout.pay",
                "order.get",
                "order.cancel",
            ],
            "payment_methods": ["wechat_qr_sandbox", "demo_card"],
            "fulfillment_methods": ["standard", "express"],
        }

    def register_product(self, product):
        if not isinstance(product, dict) or not product.get("id"):
            raise OCPError("invalid_product", "A marketplace product needs an id")
        with self.lock:
            self.products[product["id"]] = copy.deepcopy(product)
            return copy.deepcopy(self.products[product["id"]])

    def catalog(self, query="", category=""):
        query = (query or "").strip().lower()
        category = (category or "").strip().lower()
        with self.lock:
            result = []
            for product in self.products.values():
                haystack = " ".join(
                    [
                        product["name"],
                        product["category"],
                        product["description"],
                        " ".join(product["attributes"].values()),
                    ]
                ).lower()
                if query and query not in haystack:
                    continue
                if category and category != product["category"].lower():
                    continue
                result.append(copy.deepcopy(product))
            return result

    def get_product(self, product_id):
        with self.lock:
            product = self.products.get(product_id)
            if not product:
                raise NotFoundError("product", product_id)
            return copy.deepcopy(product)

    def create_cart(self, buyer_id, currency="CNY"):
        if not buyer_id:
            raise OCPError("invalid_request", "buyerId is required")
        if currency != "CNY":
            raise OCPError("unsupported_currency", "Only CNY is enabled", details={"currency": currency})
        with self.lock:
            cart_id = new_id("cart")
            cart = {
                "id": cart_id,
                "buyerId": buyer_id,
                "currency": currency,
                "status": "open",
                "items": [],
                "createdAt": utc_now(),
                "updatedAt": utc_now(),
            }
            self.carts[cart_id] = cart
            self._event("business", "cart.created", {"cartId": cart_id, "buyerId": buyer_id})
            return self._cart_view(cart)

    def get_cart(self, cart_id):
        with self.lock:
            return self._cart_view(self._require_cart(cart_id))

    def add_cart_item(self, cart_id, product_id, quantity):
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            raise OCPError("invalid_quantity", "quantity must be an integer")
        if quantity < 1 or quantity > 20:
            raise OCPError("invalid_quantity", "quantity must be between 1 and 20")
        with self.lock:
            cart = self._require_open_cart(cart_id)
            product = self.products.get(product_id)
            if not product:
                raise NotFoundError("product", product_id)
            existing = next((item for item in cart["items"] if item["productId"] == product_id), None)
            requested = quantity + (existing["quantity"] if existing else 0)
            if requested > product["stock"]:
                raise ConflictError(
                    "insufficient_stock",
                    "Only %s units are available" % product["stock"],
                    {"productId": product_id, "available": product["stock"], "requested": requested},
                )
            if existing:
                existing["quantity"] = requested
                existing["updatedAt"] = utc_now()
            else:
                cart["items"].append(
                    {
                        "id": new_id("item"),
                        "productId": product_id,
                        "quantity": quantity,
                        "unitPrice": product["price"],
                        "addedAt": utc_now(),
                        "updatedAt": utc_now(),
                    }
                )
            cart["updatedAt"] = utc_now()
            self._event(
                "business",
                "cart.item.added",
                {"cartId": cart_id, "productId": product_id, "quantity": quantity},
            )
            return self._cart_view(cart)

    def update_cart_item(self, cart_id, item_id, quantity):
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            raise OCPError("invalid_quantity", "quantity must be an integer")
        with self.lock:
            cart = self._require_open_cart(cart_id)
            item = next((entry for entry in cart["items"] if entry["id"] == item_id), None)
            if not item:
                raise NotFoundError("cart item", item_id)
            if quantity == 0:
                cart["items"].remove(item)
            elif quantity < 0 or quantity > 20:
                raise OCPError("invalid_quantity", "quantity must be between 0 and 20")
            else:
                product = self.products[item["productId"]]
                if quantity > product["stock"]:
                    raise ConflictError(
                        "insufficient_stock",
                        "Only %s units are available" % product["stock"],
                        {"productId": product["id"], "available": product["stock"]},
                    )
                item["quantity"] = quantity
                item["updatedAt"] = utc_now()
            cart["updatedAt"] = utc_now()
            self._event(
                "business",
                "cart.item.updated",
                {"cartId": cart_id, "itemId": item_id, "quantity": quantity},
            )
            return self._cart_view(cart)

    def remove_cart_item(self, cart_id, item_id):
        with self.lock:
            cart = self._require_open_cart(cart_id)
            item = next((entry for entry in cart["items"] if entry["id"] == item_id), None)
            if not item:
                raise NotFoundError("cart item", item_id)
            cart["items"].remove(item)
            cart["updatedAt"] = utc_now()
            self._event("business", "cart.item.removed", {"cartId": cart_id, "itemId": item_id})
            return self._cart_view(cart)

    def create_checkout(self, cart_id, fulfillment="standard", buyer=None):
        if fulfillment not in ("standard", "express"):
            raise OCPError("invalid_fulfillment", "Unknown fulfillment method")
        with self.lock:
            cart = self._require_open_cart(cart_id)
            if not cart["items"]:
                raise ConflictError("empty_cart", "Cannot checkout an empty cart")
            active = next(
                (
                    checkout
                    for checkout in self.checkouts.values()
                    if checkout["cartId"] == cart_id and checkout["status"] in ("requires_payment", "processing")
                ),
                None,
            )
            if active:
                return self._checkout_view(active)
            checkout_id = new_id("checkout")
            checkout = {
                "id": checkout_id,
                "cartId": cart_id,
                "buyerId": cart["buyerId"],
                "buyer": copy.deepcopy(buyer or {}),
                "currency": cart["currency"],
                "status": "requires_payment",
                "fulfillment": fulfillment,
                "items": self._checkout_items(cart),
                "totals": self._totals(cart, fulfillment),
                "payment": None,
                "orderId": None,
                "createdAt": utc_now(),
                "updatedAt": utc_now(),
            }
            self.checkouts[checkout_id] = checkout
            cart["status"] = "checkout"
            cart["updatedAt"] = utc_now()
            self._event(
                "business",
                "checkout.created",
                {"checkoutId": checkout_id, "cartId": cart_id, "total": checkout["totals"]["total"]},
            )
            return self._checkout_view(checkout)

    def get_checkout(self, checkout_id):
        with self.lock:
            checkout = self.checkouts.get(checkout_id)
            if not checkout:
                raise NotFoundError("checkout", checkout_id)
            return self._checkout_view(checkout)

    def cancel_checkout(self, checkout_id, reason="buyer_requested"):
        with self.lock:
            checkout = self.checkouts.get(checkout_id)
            if not checkout:
                raise NotFoundError("checkout", checkout_id)
            if checkout.get("orderId"):
                return self.cancel_order(checkout["orderId"], reason=reason)
            if checkout["status"] == "cancelled":
                return self._checkout_view(checkout)
            if checkout["status"] != "requires_payment":
                raise ConflictError(
                    "checkout_not_cancellable",
                    "Checkout is not awaiting payment",
                )
            payment = checkout.get("payment")
            if payment and payment.get("status") == "pending":
                intent = self.payment_intents.get(payment.get("id"))
                if intent:
                    intent["status"] = "cancelled"
                    intent["cancelledAt"] = utc_now()
            checkout["status"] = "cancelled"
            checkout["updatedAt"] = utc_now()
            cart = self.carts.get(checkout["cartId"])
            if cart:
                cart["status"] = "open"
                cart["updatedAt"] = utc_now()
            self._event(
                "business",
                "checkout.cancelled",
                {"checkoutId": checkout_id, "reason": reason},
            )
            return self._checkout_view(checkout)

    def pay_checkout(self, checkout_id, payment_method_token):
        if not payment_method_token or not str(payment_method_token).startswith("tok_"):
            raise OCPError(
                "payment_method_invalid",
                "A demo payment token beginning with tok_ is required",
            )
        with self.lock:
            checkout = self.checkouts.get(checkout_id)
            if not checkout:
                raise NotFoundError("checkout", checkout_id)
            if checkout["status"] == "paid" and checkout.get("orderId"):
                return self._order_view(self.orders[checkout["orderId"]])
            if checkout["status"] != "requires_payment":
                raise ConflictError("checkout_not_payable", "Checkout is not awaiting payment")
            for item in checkout["items"]:
                product = self.products[item["productId"]]
                if item["quantity"] > product["stock"]:
                    raise ConflictError(
                        "insufficient_stock",
                        "%s no longer has enough inventory" % product["name"],
                        {"productId": product["id"], "available": product["stock"]},
                    )

            payment_id = new_id("pay")
            order_id = new_id("order")
            payment = {
                "id": payment_id,
                "checkoutId": checkout_id,
                "amount": checkout["totals"]["total"],
                "currency": checkout["currency"],
                "status": "succeeded",
                "method": "demo_card",
                "createdAt": utc_now(),
            }
            order = {
                "id": order_id,
                "checkoutId": checkout_id,
                "buyerId": checkout["buyerId"],
                "currency": checkout["currency"],
                "status": "confirmed",
                "items": copy.deepcopy(checkout["items"]),
                "totals": copy.deepcopy(checkout["totals"]),
                "fulfillment": {
                    "method": checkout["fulfillment"],
                    "status": "preparing",
                    "trackingNumber": None,
                },
                "paymentId": payment_id,
                "createdAt": utc_now(),
            }
            for item in checkout["items"]:
                self.products[item["productId"]]["stock"] -= item["quantity"]
            checkout["status"] = "paid"
            checkout["payment"] = payment
            checkout["orderId"] = order_id
            checkout["updatedAt"] = utc_now()
            self.carts[checkout["cartId"]]["status"] = "completed"
            self.carts[checkout["cartId"]]["updatedAt"] = utc_now()
            self.payments[payment_id] = payment
            self.orders[order_id] = order
            self._event(
                "business",
                "payment.succeeded",
                {"paymentId": payment_id, "checkoutId": checkout_id, "amount": payment["amount"]},
            )
            self._event(
                "business",
                "order.confirmed",
                {"orderId": order_id, "checkoutId": checkout_id, "currency": order["currency"]},
            )
            return self._order_view(order)

    def create_payment_intent(
        self,
        checkout_id,
        provider="wechat",
        base_url="",
    ):
        with self.lock:
            checkout = self.checkouts.get(checkout_id)
            if not checkout:
                raise NotFoundError("checkout", checkout_id)
            if checkout["status"] == "paid" and checkout.get("orderId"):
                return {
                    "status": "succeeded",
                    "orderId": checkout["orderId"],
                }
            if checkout["status"] != "requires_payment":
                raise ConflictError(
                    "checkout_not_payable",
                    "Checkout is not awaiting payment",
                )
            existing = checkout.get("payment")
            if existing and existing.get("status") == "pending":
                return copy.deepcopy(existing)
            payment_id = new_id("pay")
            payment_url = "%s/pay/%s" % (base_url.rstrip("/"), payment_id)
            intent = {
                "id": payment_id,
                "checkoutId": checkout_id,
                "provider": provider,
                "method": "wechat_qr" if provider == "wechat" else provider,
                "amount": checkout["totals"]["total"],
                "currency": checkout["currency"],
                "status": "pending",
                "paymentUrl": payment_url,
                "createdAt": utc_now(),
            }
            checkout["payment"] = intent
            checkout["updatedAt"] = utc_now()
            self.payment_intents[payment_id] = intent
            self._event(
                "business",
                "payment.intent.created",
                {
                    "paymentId": payment_id,
                    "checkoutId": checkout_id,
                    "provider": provider,
                    "amount": intent["amount"],
                },
            )
            return copy.deepcopy(intent)

    def get_payment_intent(self, payment_id):
        with self.lock:
            intent = self.payment_intents.get(payment_id)
            if not intent:
                raise NotFoundError("payment intent", payment_id)
            return copy.deepcopy(intent)

    def complete_payment_intent(self, payment_id):
        with self.lock:
            intent = self.payment_intents.get(payment_id)
            if not intent:
                raise NotFoundError("payment intent", payment_id)
            checkout = self.checkouts.get(intent["checkoutId"])
            if not checkout:
                raise NotFoundError("checkout", intent["checkoutId"])
            if intent["status"] == "succeeded" and intent.get("orderId"):
                return self._order_view(self.orders[intent["orderId"]])
            order = self.pay_checkout(checkout["id"], "tok_demo_wechat")
            intent["status"] = "succeeded"
            intent["orderId"] = order["id"]
            intent["completedAt"] = utc_now()
            return order

    def get_order(self, order_id):
        with self.lock:
            order = self.orders.get(order_id)
            if not order:
                raise NotFoundError("order", order_id)
            return self._order_view(order)

    def cancel_order(self, order_id, reason="buyer_requested"):
        with self.lock:
            order = self.orders.get(order_id)
            if not order:
                raise NotFoundError("order", order_id)
            if order["status"] == "cancelled":
                return self._order_view(order)
            if order["fulfillment"]["status"] not in ("preparing", "pending"):
                raise ConflictError(
                    "order_not_cancellable",
                    "The order can no longer be cancelled because fulfillment has started",
                    {"orderId": order_id, "fulfillmentStatus": order["fulfillment"]["status"]},
                )

            for item in order["items"]:
                product = self.products.get(item["productId"])
                if product:
                    product["stock"] += item["quantity"]

            payment = self.payments.get(order["paymentId"])
            refund_id = new_id("refund")
            if payment:
                payment["status"] = "refunded"
                payment["refundId"] = refund_id
                payment["refundedAt"] = utc_now()
            order["status"] = "cancelled"
            order["cancellation"] = {
                "reason": reason or "buyer_requested",
                "refundId": refund_id,
                "cancelledAt": utc_now(),
            }
            order["fulfillment"]["status"] = "cancelled"
            checkout = self.checkouts.get(order["checkoutId"])
            if checkout:
                checkout["status"] = "cancelled"
                checkout["updatedAt"] = utc_now()
            self._event(
                "business",
                "order.cancelled",
                {"orderId": order_id, "reason": order["cancellation"]["reason"]},
            )
            self._event(
                "business",
                "payment.refunded",
                {
                    "orderId": order_id,
                    "paymentId": order["paymentId"],
                    "refundId": refund_id,
                    "amount": order["totals"]["total"],
                },
            )
            return self._order_view(order)

    def idempotent_result(self, key, request_body):
        if not key:
            return None
        fingerprint = hashlib.sha256(
            json.dumps(request_body, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        with self.lock:
            record = self.idempotency.get(key)
            if not record:
                return None
            if record["fingerprint"] != fingerprint:
                raise ConflictError(
                    "idempotency_conflict",
                    "The idempotency key was already used with a different request",
                )
            stored = copy.deepcopy(record["response"])
            stored["replayed"] = True
            return stored

    def save_idempotent_result(self, key, request_body, response):
        if not key:
            return
        fingerprint = hashlib.sha256(
            json.dumps(request_body, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        with self.lock:
            self.idempotency[key] = {
                "fingerprint": fingerprint,
                "response": copy.deepcopy(response),
                "createdAt": utc_now(),
            }

    def snapshot(self):
        with self.lock:
            carts = [self._cart_view(cart) for cart in self.carts.values()]
            carts.sort(key=lambda cart: cart["createdAt"], reverse=True)
            checkouts = [self._checkout_view(checkout) for checkout in self.checkouts.values()]
            checkouts.sort(key=lambda checkout: checkout["createdAt"], reverse=True)
            orders = [self._order_view(order) for order in self.orders.values()]
            orders.sort(key=lambda order: order["createdAt"], reverse=True)
            gross = sum(order["totals"]["total"] for order in self.orders.values())
            return {
                "serverTime": utc_now(),
                "startedAt": self.started_at,
                "capabilities": self.capabilities(),
                "metrics": {
                    "products": len(self.products),
                    "openCarts": sum(1 for cart in self.carts.values() if cart["status"] == "open"),
                    "checkouts": len(self.checkouts),
                    "orders": len(self.orders),
                    "grossAmount": gross,
                    "currency": "CNY",
                },
                "products": self.catalog(),
                "carts": carts[:20],
                "checkouts": checkouts[:20],
                "orders": orders[:20],
                "events": list(self.events)[:100],
            }

    def record_transport_event(self, direction, method, path, status, request_id, payload=None, duration_ms=0):
        try:
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            encoded = str(payload)
        if len(encoded) > 1200:
            payload = {
                "summary": encoded[:1100] + "...",
                "truncated": True,
            }
        self._event(
            direction,
            "%s %s" % (method, path),
            {
                "requestId": request_id,
                "status": status,
                "durationMs": duration_ms,
                "payload": payload,
            },
        )

    def _event(self, direction, action, payload=None):
        self.events.appendleft(
            {
                "timestamp": utc_now(),
                "direction": direction,
                "action": action,
                "payload": copy.deepcopy(payload),
            }
        )

    def _require_cart(self, cart_id):
        cart = self.carts.get(cart_id)
        if not cart:
            raise NotFoundError("cart", cart_id)
        return cart

    def _require_open_cart(self, cart_id):
        cart = self._require_cart(cart_id)
        if cart["status"] != "open":
            raise ConflictError("cart_not_open", "Cart is no longer open")
        return cart

    def _cart_view(self, cart):
        items = []
        for item in cart["items"]:
            product = self.products[item["productId"]]
            items.append(
                {
                    "id": item["id"],
                    "productId": item["productId"],
                    "name": product["name"],
                    "image": product["image"],
                    "translations": copy.deepcopy(product.get("translations", {})),
                    "quantity": item["quantity"],
                    "unitPrice": item["unitPrice"],
                    "lineTotal": item["unitPrice"] * item["quantity"],
                    "availableStock": product["stock"],
                }
            )
        subtotal = sum(item["lineTotal"] for item in items)
        return {
            "id": cart["id"],
            "buyerId": cart["buyerId"],
            "currency": cart["currency"],
            "status": cart["status"],
            "items": items,
            "itemCount": sum(item["quantity"] for item in items),
            "subtotal": subtotal,
            "createdAt": cart["createdAt"],
            "updatedAt": cart["updatedAt"],
        }

    def _checkout_items(self, cart):
        items = []
        for item in cart["items"]:
            product = self.products[item["productId"]]
            items.append(
                {
                    "productId": product["id"],
                    "name": product["name"],
                    "image": product["image"],
                    "translations": copy.deepcopy(product.get("translations", {})),
                    "quantity": item["quantity"],
                    "unitPrice": item["unitPrice"],
                    "lineTotal": item["unitPrice"] * item["quantity"],
                }
            )
        return items

    def _totals(self, cart, fulfillment):
        subtotal = sum(item["unitPrice"] * item["quantity"] for item in cart["items"])
        shipping = 0 if subtotal >= 20000 or fulfillment == "standard" else 0
        if fulfillment == "express":
            shipping += 2500
        tax = int(round(subtotal * 0.06))
        return {
            "subtotal": subtotal,
            "shipping": shipping,
            "tax": tax,
            "discount": 0,
            "total": subtotal + shipping + tax,
        }

    def _checkout_view(self, checkout):
        return {
            "id": checkout["id"],
            "cartId": checkout["cartId"],
            "buyerId": checkout["buyerId"],
            "buyer": copy.deepcopy(checkout["buyer"]),
            "currency": checkout["currency"],
            "status": checkout["status"],
            "fulfillment": checkout["fulfillment"],
            "items": copy.deepcopy(checkout["items"]),
            "totals": copy.deepcopy(checkout["totals"]),
            "payment": copy.deepcopy(checkout["payment"]),
            "orderId": checkout["orderId"],
            "createdAt": checkout["createdAt"],
            "updatedAt": checkout["updatedAt"],
        }

    def _order_view(self, order):
        return copy.deepcopy(order)
