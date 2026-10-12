import json
import threading
import unittest
import urllib.error
import urllib.request

from ocp.agent import OCPAgent
from ocp.server import create_server


class OCPEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.server = create_server(port=0, quiet=True)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            kwargs={"poll_interval": 0.05},
        )
        self.thread.daemon = True
        self.thread.start()
        self.base_url = "http://127.0.0.1:%s" % self.server.server_address[1]
        self.agent = OCPAgent(self.base_url, agent_name="integration-test-agent")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def test_full_commerce_flow_and_stock_update(self):
        capabilities = self.agent.request("GET", "/ocp/v1/capabilities")
        self.assertEqual(capabilities["protocol"]["version"], "1.0")

        catalog = self.agent.request("GET", "/ocp/v1/catalog")
        self.assertEqual(catalog["count"], 5)
        product = catalog["items"][0]
        initial_stock = product["stock"]

        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts",
            {"buyerId": "buyer_test"},
            idempotency_key="cart-create-test",
        )
        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts/%s/items" % cart["id"],
            {"productId": product["id"], "quantity": 2},
            idempotency_key="cart-add-test",
        )
        self.assertEqual(cart["itemCount"], 2)
        self.assertEqual(cart["subtotal"], product["price"] * 2)

        checkout = self.agent.request(
            "POST",
            "/ocp/v1/checkouts",
            {"cartId": cart["id"], "fulfillment": "standard"},
            idempotency_key="checkout-create-test",
        )
        self.assertEqual(checkout["status"], "requires_payment")
        self.assertGreater(checkout["totals"]["total"], checkout["totals"]["subtotal"])

        order = self.agent.request(
            "POST",
            "/ocp/v1/checkouts/%s/pay" % checkout["id"],
            {"paymentMethodToken": "tok_demo_visa"},
            idempotency_key="checkout-pay-test",
        )
        self.assertEqual(order["status"], "confirmed")
        self.assertEqual(order["paymentId"][:4], "pay_")

        fetched = self.agent.request("GET", "/ocp/v1/orders/%s" % order["id"])
        self.assertEqual(fetched["id"], order["id"])
        refreshed_catalog = self.agent.request("GET", "/ocp/v1/catalog")
        refreshed_product = next(item for item in refreshed_catalog["items"] if item["id"] == product["id"])
        self.assertEqual(refreshed_product["stock"], initial_stock - 2)

    def test_replays_idempotent_result(self):
        first = self.agent.request(
            "POST",
            "/ocp/v1/carts",
            {"buyerId": "buyer_idempotent"},
            idempotency_key="same-cart-request",
        )
        second = self.agent.request(
            "POST",
            "/ocp/v1/carts",
            {"buyerId": "buyer_idempotent"},
            idempotency_key="same-cart-request",
        )
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second["replayed"])

    def test_rejects_invalid_quantity_with_structured_error(self):
        cart = self.agent.request("POST", "/ocp/v1/carts", {"buyerId": "buyer_error"})
        with self.assertRaises(RuntimeError) as context:
            self.agent.request(
                "POST",
                "/ocp/v1/carts/%s/items" % cart["id"],
                {"productId": "prod_aurora_lamp", "quantity": 0},
            )
        self.assertIn("invalid_quantity", str(context.exception))

    def test_buyer_agent_completes_purchase(self):
        result = self.agent.run("portable")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["order"]["status"], "confirmed")
        self.assertEqual(result["steps"][0]["operation"], "capabilities")
        self.assertEqual(result["steps"][-1]["operation"], "order.get")

    def test_discovery_document_and_health(self):
        discovery_request = urllib.request.Request(
            self.base_url + "/.well-known/ocp",
            headers={"Accept": "application/ocp+json", "X-OCP-Version": "1.0"},
        )
        with urllib.request.urlopen(discovery_request, timeout=5) as response:
            discovery = json.loads(response.read().decode("utf-8"))
        self.assertEqual(discovery["data"]["protocol"], "ocp")
        self.assertEqual(discovery["data"]["version"], "1.0")

        health_request = urllib.request.Request(
            self.base_url + "/api/health",
            headers={"Accept": "application/ocp+json"},
        )
        with urllib.request.urlopen(health_request, timeout=5) as response:
            health = json.loads(response.read().decode("utf-8"))
        self.assertEqual(health["data"]["status"], "ok")

    def test_error_response_is_protocol_enveloped(self):
        request = urllib.request.Request(
            self.base_url + "/ocp/v1/products/missing_product",
            headers={"Accept": "application/ocp+json", "X-OCP-Version": "1.0"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=5)
        body = json.loads(context.exception.read().decode("utf-8"))
        self.assertEqual(context.exception.code, 404)
        self.assertEqual(body["protocol"], "ocp")
        self.assertEqual(body["error"]["code"], "resource_not_found")

    def test_language_assets_and_product_translations(self):
        with urllib.request.urlopen(self.base_url + "/", timeout=5) as response:
            index = response.read().decode("utf-8")
        self.assertIn('id="languageSelect"', index)
        self.assertIn('value="en-US"', index)
        self.assertIn('id="merchantForm"', index)
        self.assertIn('data-view="merchants"', index)
        self.assertIn('data-view="stores"', index)
        self.assertIn('id="storeSearch"', index)
        self.assertIn('id="assistantRequirement"', index)
        self.assertIn('data-view="assistant"', index)

        with urllib.request.urlopen(self.base_url + "/i18n.js", timeout=5) as response:
            i18n = response.read().decode("utf-8")
        self.assertEqual(response.status, 200)
        self.assertIn('"en-US"', i18n)
        self.assertIn('"zh-CN"', i18n)

        catalog = self.agent.request("GET", "/ocp/v1/catalog")
        for product in catalog["items"]:
            self.assertIn("zh-CN", product["translations"])

    def test_cancel_order_restores_stock_and_refunds_payment(self):
        catalog = self.agent.request("GET", "/ocp/v1/catalog")
        product = catalog["items"][0]
        initial_stock = product["stock"]

        cart = self.agent.request("POST", "/ocp/v1/carts", {"buyerId": "buyer_cancel"})
        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts/%s/items" % cart["id"],
            {"productId": product["id"], "quantity": 2},
        )
        checkout = self.agent.request(
            "POST",
            "/ocp/v1/checkouts",
            {"cartId": cart["id"], "fulfillment": "standard"},
        )
        order = self.agent.request(
            "POST",
            "/ocp/v1/checkouts/%s/pay" % checkout["id"],
            {"paymentMethodToken": "tok_demo_visa"},
        )
        after_payment = self.agent.request("GET", "/ocp/v1/products/%s" % product["id"])
        self.assertEqual(after_payment["stock"], initial_stock - 2)

        cancelled = self.agent.request(
            "POST",
            "/ocp/v1/orders/%s/cancel" % order["id"],
            {"reason": "buyer_requested"},
            idempotency_key="cancel-order-test",
        )
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(cancelled["fulfillment"]["status"], "cancelled")
        self.assertEqual(cancelled["cancellation"]["refundId"][:7], "refund_")

        restored = self.agent.request("GET", "/ocp/v1/products/%s" % product["id"])
        self.assertEqual(restored["stock"], initial_stock)
        checkout_after_cancel = self.agent.request("GET", "/ocp/v1/checkouts/%s" % checkout["id"])
        self.assertEqual(checkout_after_cancel["status"], "cancelled")

        cancelled_again = self.agent.request(
            "POST",
            "/ocp/v1/orders/%s/cancel" % order["id"],
            {"reason": "buyer_requested"},
            idempotency_key="cancel-order-test",
        )
        self.assertEqual(cancelled_again["status"], "cancelled")
        still_restored = self.agent.request("GET", "/ocp/v1/products/%s" % product["id"])
        self.assertEqual(still_restored["stock"], initial_stock)

    def test_ocp_catalog_discovery_query_and_resolve(self):
        discovery_request = urllib.request.Request(
            self.base_url + "/.well-known/ocp-catalog",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(discovery_request, timeout=5) as response:
            discovery = json.loads(response.read().decode("utf-8"))
            self.assertEqual(
                response.headers.get("X-OCP-Catalog-Id"),
                "cat_ocp_supply_lab",
            )
        self.assertEqual(discovery["kind"], "WellKnownCatalogDiscovery")
        self.assertEqual(discovery["ocp_version"], "1.0")

        with urllib.request.urlopen(
            self.base_url + "/ocp/manifest", timeout=5
        ) as response:
            manifest = json.loads(response.read().decode("utf-8"))
        self.assertEqual(manifest["kind"], "CatalogManifest")
        self.assertEqual(
            manifest["query_capabilities"][0]["query_packs"][0]["pack_id"],
            "ocp.query.keyword.v1",
        )

        query_request = urllib.request.Request(
            self.base_url + "/ocp/query",
            data=json.dumps(
                {
                    "query": "travel",
                    "query_pack": "ocp.query.keyword.v1",
                    "filters": {"has_image": True},
                    "limit": 10,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(query_request, timeout=5) as response:
            query_result = json.loads(response.read().decode("utf-8"))
        self.assertEqual(query_result["kind"], "CatalogQueryResult")
        self.assertGreater(query_result["result_count"], 0)
        entry = query_result["entries"][0]["entry"]
        self.assertEqual(entry["kind"], "CatalogEntry")
        self.assertTrue(entry["entry_id"].startswith("ocp_"))
        self.assertEqual(entry["object_type"], "ocp.commerce.retail.product")

        resolve_request = urllib.request.Request(
            self.base_url + "/ocp/resolve",
            data=json.dumps(
                {
                    "entry_id": entry["entry_id"],
                    "purpose": "checkout",
                    "live_check": True,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(resolve_request, timeout=5) as response:
            resolved = json.loads(response.read().decode("utf-8"))
        self.assertEqual(resolved["kind"], "ResolvableReference")
        self.assertEqual(resolved["object_id"], entry["object_id"])
        self.assertTrue(resolved["live_checks"])
        self.assertTrue(
            any(
                action["action_id"] == "add_to_cart"
                for action in resolved["action_bindings"]
            )
        )

    def test_ocp_catalog_errors_are_unwrapped(self):
        request = urllib.request.Request(
            self.base_url + "/ocp/resolve",
            data=json.dumps({"entry_id": "invalid"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=5)
        body = json.loads(context.exception.read().decode("utf-8"))
        self.assertEqual(context.exception.code, 400)
        self.assertEqual(body["error"]["code"], "invalid_entry_id")
        self.assertNotIn("protocol", body)

    def test_catalog_gateway_connects_multiple_companies(self):
        with urllib.request.urlopen(
            self.base_url + "/.well-known/ocp-catalog-gateway",
            timeout=5,
        ) as response:
            discovery = json.loads(response.read().decode("utf-8"))
        self.assertEqual(discovery["kind"], "WellKnownCatalogGatewayDiscovery")

        with urllib.request.urlopen(
            self.base_url + "/ocp/gateway/providers",
            timeout=5,
        ) as response:
            providers = json.loads(response.read().decode("utf-8"))
        provider_ids = {item["provider_id"] for item in providers["providers"]}
        self.assertIn("provider_ocp_supply_lab", provider_ids)
        self.assertIn("provider_northstar_gear", provider_ids)

        query_request = urllib.request.Request(
            self.base_url + "/ocp/gateway/query",
            data=json.dumps(
                {
                    "query": "travel",
                    "query_pack": "ocp.query.keyword.v1",
                    "provider_ids": sorted(provider_ids),
                    "limit": 20,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(query_request, timeout=5) as response:
            result = json.loads(response.read().decode("utf-8"))
        self.assertEqual(result["kind"], "FederatedCatalogQueryResult")
        self.assertGreaterEqual(result["result_count"], 2)
        self.assertEqual(
            {item["provider_id"] for item in result["providers"]},
            provider_ids,
        )
        self.assertTrue(
            {"provider_ocp_supply_lab", "provider_northstar_gear"}.issubset(
                {item["source_provider_id"] for item in result["entries"]}
            )
        )

        entry = result["entries"][0]["entry"]
        resolve_request = urllib.request.Request(
            self.base_url + "/ocp/gateway/resolve",
            data=json.dumps(
                {
                    "entry_id": entry["entry_id"],
                    "purpose": "checkout",
                    "live_check": True,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(resolve_request, timeout=5) as response:
            resolved = json.loads(response.read().decode("utf-8"))
        self.assertEqual(resolved["gateway_id"], "gateway_ocp_catalog")
        self.assertEqual(resolved["object_id"], entry["object_id"])

    def test_catalog_gateway_can_register_and_remove_company(self):
        provider = {
            "provider_id": "provider_demo_company",
            "company_name": "Demo Company",
            "catalog_id": "cat_demo_company",
            "base_url": "http://127.0.0.1:9",
        }
        request = urllib.request.Request(
            self.base_url + "/ocp/gateway/providers",
            data=json.dumps(provider).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            registered = json.loads(response.read().decode("utf-8"))
        self.assertEqual(registered["provider_id"], "provider_demo_company")
        self.assertEqual(registered["adapter_type"], "http")

        delete_request = urllib.request.Request(
            self.base_url + "/ocp/gateway/providers/provider_demo_company",
            method="DELETE",
        )
        with urllib.request.urlopen(delete_request, timeout=5) as response:
            removed = json.loads(response.read().decode("utf-8"))
        self.assertTrue(removed["removed"])

    def test_catalog_gateway_rejects_self_registration(self):
        request = urllib.request.Request(
            self.base_url + "/ocp/gateway/providers",
            data=json.dumps(
                {
                    "provider_id": "provider_self",
                    "company_name": "Self Provider",
                    "base_url": self.base_url,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=5)
        body = json.loads(context.exception.read().decode("utf-8"))
        self.assertEqual(body["error"]["code"], "gateway_self_registration")

    def test_quick_catalog_onboarding_discovers_provider_configuration(self):
        provider_server = create_server(port=0, quiet=True)
        provider_thread = threading.Thread(
            target=provider_server.serve_forever,
            kwargs={"poll_interval": 0.05},
        )
        provider_thread.daemon = True
        provider_thread.start()
        provider_url = "http://127.0.0.1:%s" % provider_server.server_address[1]
        try:
            request = urllib.request.Request(
                self.base_url + "/ocp/gateway/providers/quick",
                data=json.dumps({"url": provider_url}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                provider = json.loads(response.read().decode("utf-8"))
            self.assertEqual(provider["adapter_type"], "http")
            self.assertEqual(provider["catalog_id"], "cat_ocp_supply_lab")
            self.assertEqual(provider["trust_tier"], "verified")
            self.assertEqual(provider["connection_test"]["status"], "ok")
            self.assertEqual(provider["manifest"]["kind"], "CatalogManifest")

            query_request = urllib.request.Request(
                self.base_url + "/ocp/gateway/query",
                data=json.dumps(
                    {
                        "query": "",
                        "provider_ids": [provider["provider_id"]],
                        "limit": 1,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(query_request, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
            self.assertEqual(result["providers"][0]["status"], "ok")
            self.assertEqual(result["result_count"], 1)

            delete_request = urllib.request.Request(
                self.base_url
                + "/ocp/gateway/providers/"
                + provider["provider_id"],
                method="DELETE",
            )
            with urllib.request.urlopen(delete_request, timeout=5):
                pass
        finally:
            provider_server.shutdown()
            provider_server.server_close()
            provider_thread.join(timeout=3)

    def test_china_merchant_directory_search_and_pending_connector(self):
        with urllib.request.urlopen(
            self.base_url + "/ocp/gateway/directory?query=%E4%BA%AC%E4%B8%9C",
            timeout=5,
        ) as response:
            directory = json.loads(response.read().decode("utf-8"))
        self.assertEqual(directory["kind"], "MerchantDirectoryResult")
        self.assertEqual(directory["merchants"][0]["merchant_id"], "cn_jd")

        add_request = urllib.request.Request(
            self.base_url + "/ocp/gateway/directory/add",
            data=json.dumps({"merchant_id": "cn_jd"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(add_request, timeout=5) as response:
            provider = json.loads(response.read().decode("utf-8"))
        self.assertEqual(provider["adapter_type"], "connector")
        self.assertEqual(
            provider["connection_status"],
            "authorization_required",
        )

        query_request = urllib.request.Request(
            self.base_url + "/ocp/gateway/query",
            data=json.dumps({"query": "", "limit": 20}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(query_request, timeout=5) as response:
            self.assertEqual(response.status, 200)

        delete_request = urllib.request.Request(
            self.base_url
            + "/ocp/gateway/providers/"
            + provider["provider_id"],
            method="DELETE",
        )
        with urllib.request.urlopen(delete_request, timeout=5):
            pass

    def test_store_search_by_location_and_name(self):
        with urllib.request.urlopen(
            self.base_url + "/ocp/gateway/providers",
            timeout=5,
        ) as response:
            providers = json.loads(response.read().decode("utf-8"))
        provider_ids = {item["provider_id"] for item in providers["providers"]}
        self.assertIn("provider_kfc", provider_ids)
        self.assertIn("provider_mcdonalds", provider_ids)
        self.assertIn("provider_luckin_coffee_demo", provider_ids)

        store_url = (
            self.base_url
            + "/ocp/gateway/stores?provider_ids=provider_kfc,provider_mcdonalds"
            + "&latitude=31.2304&longitude=121.4737&radius_km=20"
        )
        with urllib.request.urlopen(store_url, timeout=5) as response:
            stores = json.loads(response.read().decode("utf-8"))
        self.assertEqual(stores["kind"], "FederatedStoreResult")
        self.assertEqual(stores["result_count"], 4)
        distances = [
            store["distance_km"]
            for store in stores["stores"]
            if store["distance_km"] is not None
        ]
        self.assertEqual(distances, sorted(distances))
        self.assertLessEqual(distances[0], distances[-1])

        search_url = (
            self.base_url
            + "/ocp/gateway/stores?provider_ids=provider_kfc,provider_mcdonalds"
            + "&latitude=31.2304&longitude=121.4737&query=%E9%99%86%E5%AE%B6%E5%98%B4"
        )
        with urllib.request.urlopen(search_url, timeout=5) as response:
            filtered = json.loads(response.read().decode("utf-8"))
        self.assertEqual(filtered["result_count"], 1)
        self.assertIn("陆家嘴", filtered["stores"][0]["name"])

        directory_url = (
            self.base_url
            + "/ocp/gateway/directory?query=KFC&region=CN"
        )
        with urllib.request.urlopen(directory_url, timeout=5) as response:
            directory = json.loads(response.read().decode("utf-8"))
        self.assertTrue(directory["merchants"][0]["connected"])

    def test_marketplace_groups_products_and_supports_external_cart_items(self):
        marketplace = self.agent.request("GET", "/api/marketplace")
        self.assertEqual(marketplace["kind"], "MarketplaceCatalogResult")
        self.assertGreater(marketplace["result_count"], 0)
        self.assertIn("汉堡", marketplace["categories"])

        kfc_product = next(
            product
            for product in marketplace["products"]
            if product["merchantName"] == "肯德基 KFC"
        )
        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts",
            {"buyerId": "marketplace_buyer"},
        )
        cart = self.agent.request(
            "POST",
            "/api/actions/add-to-cart",
            {
                "cartId": cart["id"],
                "productId": kfc_product["id"],
                "quantity": 1,
            },
            idempotency_key="marketplace-add-kfc",
        )
        self.assertEqual(cart["itemCount"], 1)
        self.assertEqual(cart["items"][0]["name"], kfc_product["name"])

    def test_assistant_plan_confirmation_and_wechat_qr_payment(self):
        plan = self.agent.request(
            "POST",
            "/api/assistant/plan",
            {"requirement": "我想买汉堡和薯条，预算50元"},
        )
        self.assertEqual(plan["kind"], "ShoppingAssistantPlan")
        self.assertGreater(plan["item_count"], 0)
        self.assertLessEqual(plan["total"], 5000)
        self.assertTrue(
            any(
                item["category"] in ("汉堡", "小食")
                for item in plan["items"]
            )
        )

        unconfirmed = urllib.request.Request(
            self.base_url + "/api/assistant/confirm",
            data=json.dumps(
                {
                    "planId": plan["plan_id"],
                    "confirmed": False,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(unconfirmed, timeout=5)
        self.assertEqual(context.exception.code, 409)

        checkout = self.agent.request(
            "POST",
            "/api/assistant/confirm",
            {
                "planId": plan["plan_id"],
                "confirmed": True,
            },
        )
        self.assertEqual(checkout["status"], "requires_payment")

        no_consent = urllib.request.Request(
            self.base_url + "/api/assistant/payment-qr",
            data=json.dumps(
                {
                    "checkoutId": checkout["id"],
                    "provider": "wechat",
                    "consent": False,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(no_consent, timeout=5)
        self.assertEqual(context.exception.code, 409)

        payment = self.agent.request(
            "POST",
            "/api/assistant/payment-qr",
            {
                "checkoutId": checkout["id"],
                "provider": "wechat",
                "consent": True,
            },
        )
        self.assertEqual(payment["provider"], "wechat")
        self.assertEqual(payment["status"], "pending")
        self.assertTrue(payment["qrSvg"].startswith("<svg"))
        self.assertIn("/pay/" + payment["id"], payment["paymentUrl"])

        with urllib.request.urlopen(payment["paymentUrl"], timeout=5) as response:
            payment_page = response.read().decode("utf-8")
        self.assertEqual(response.status, 200)
        self.assertIn("OCP WeChat sandbox payment", payment_page)
        self.assertIn(payment["id"], payment_page)

        order = self.agent.request(
            "POST",
            "/api/payments/%s/complete" % payment["id"],
        )
        self.assertEqual(order["status"], "confirmed")

    def test_cancel_pending_checkout_and_payment_intent(self):
        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts",
            {"buyerId": "cancel_checkout_buyer"},
        )
        cart = self.agent.request(
            "POST",
            "/ocp/v1/carts/%s/items" % cart["id"],
            {"productId": "prod_aurora_lamp", "quantity": 1},
        )
        checkout = self.agent.request(
            "POST",
            "/ocp/v1/checkouts",
            {"cartId": cart["id"], "fulfillment": "standard"},
        )
        payment = self.agent.request(
            "POST",
            "/api/assistant/payment-qr",
            {
                "checkoutId": checkout["id"],
                "provider": "wechat",
                "consent": True,
            },
        )
        cancelled = self.agent.request(
            "POST",
            "/ocp/v1/checkouts/%s/cancel" % checkout["id"],
            {"reason": "buyer_requested"},
        )
        self.assertEqual(cancelled["status"], "cancelled")
        reopened_cart = self.agent.request(
            "GET",
            "/ocp/v1/carts/%s" % cart["id"],
        )
        self.assertEqual(reopened_cart["status"], "open")
        payment_intent = self.agent.request(
            "GET",
            "/api/payments/%s" % payment["id"],
        )
        self.assertEqual(payment_intent["status"], "cancelled")

    def test_state_events_do_not_embed_full_snapshots(self):
        for _ in range(3):
            self.agent.request("GET", "/api/state")
        state = self.agent.request("GET", "/api/state")
        event_payload = json.dumps(state["events"], ensure_ascii=False)
        self.assertLess(len(event_payload), 200000)


if __name__ == "__main__":
    unittest.main()
