import re
import time
import uuid

from .errors import NotFoundError, OCPError


CATEGORY_KEYWORDS = {
    "咖啡": ["咖啡", "拿铁", "美式", "coffee", "latte"],
    "饮品": ["饮料", "奶茶", "茶饮", "drink"],
    "汉堡": ["汉堡", "burger"],
    "小食": ["鸡块", "薯条", "小食", "snack", "fries"],
    "甜品": ["甜品", "蛋挞", "dessert"],
    "办公": ["办公", "键盘", "扩展坞", "office", "workspace"],
    "家居": ["家居", "台灯", "灯", "home", "lamp"],
    "音频": ["耳机", "音频", "headphone", "audio"],
    "出行": ["出行", "旅行", "背包", "保温瓶", "travel", "backpack"],
}


class ShoppingAssistant:
    def __init__(self, registry, store):
        self.registry = registry
        self.store = store
        self.plans = {}

    def plan(self, requirement, base_url):
        requirement = str(requirement or "").strip()
        if len(requirement) < 2:
            raise OCPError("requirement_too_short", "Please describe your needs")
        marketplace = self.registry.marketplace_catalog(base_url)
        products = marketplace.get("products") or []
        if not products:
            raise OCPError("catalog_empty", "No connected product is available")

        text = requirement.lower()
        budget = parse_budget(text)
        quantity = parse_quantity(text)
        merchant_terms = matched_merchant_terms(text, marketplace)
        category_terms = matched_categories(text)
        scored = []
        for product in products:
            score = 0
            haystack = " ".join(
                [
                    product.get("name", ""),
                    product.get("description", ""),
                    product.get("category", ""),
                    product.get("merchantName", ""),
                ]
            ).lower()
            if merchant_terms:
                if any(term in product.get("merchantName", "").lower() for term in merchant_terms):
                    score += 10
                else:
                    score -= 5
            if category_terms:
                if product.get("category") in category_terms:
                    score += 8
            for token in re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9-]{3,}", text):
                if token in haystack:
                    score += 3
            for category, keywords in CATEGORY_KEYWORDS.items():
                if any(keyword in text for keyword in keywords):
                    if product.get("category") == category:
                        score += 6
            if score > 0:
                scored.append((score, product))

        if not scored:
            scored = [(1, product) for product in products]
        scored.sort(
            key=lambda item: (
                -item[0],
                item[1].get("price", 0),
                item[1].get("name", ""),
            )
        )

        selected = []
        total = 0
        desired_count = 3 if ("和" in text or " plus " in text or "," in text) else 2
        for score, product in scored:
            price = int(product.get("price") or 0)
            if budget is not None and total + price * quantity > budget:
                continue
            selected.append(
                {
                    "productId": product["id"],
                    "name": product["name"],
                    "merchantName": product.get("merchantName"),
                    "category": product.get("category"),
                    "quantity": quantity,
                    "unitPrice": price,
                    "total": price * quantity,
                    "reason": explain_match(product, requirement, merchant_terms, category_terms),
                }
            )
            total += price * quantity
            if len(selected) >= desired_count:
                break

        if not selected:
            raise OCPError(
                "budget_too_low",
                "No matching product fits the requested budget",
            )

        plan_id = "plan_%s" % uuid.uuid4().hex[:18]
        plan = {
            "id": plan_id,
            "requirement": requirement,
            "budget": budget,
            "items": selected,
            "total": total,
            "createdAt": time.time(),
        }
        self.plans[plan_id] = plan
        return {
            "kind": "ShoppingAssistantPlan",
            "plan_id": plan_id,
            "requirement": requirement,
            "interpretation": {
                "budget": budget,
                "quantity_per_item": quantity,
                "merchants": merchant_terms,
                "categories": category_terms,
            },
            "items": selected,
            "item_count": sum(item["quantity"] for item in selected),
            "total": total,
            "requires_user_confirmation": True,
        }

    def confirm(self, plan_id, buyer_id="assistant_buyer", store_id=None):
        plan = self.plans.get(plan_id)
        if not plan:
            raise NotFoundError("shopping plan", plan_id)
        cart = self.store.create_cart(buyer_id or "assistant_buyer")
        for item in plan["items"]:
            product = self.registry.get_cached_product(item["productId"])
            if not product:
                raise OCPError(
                    "product_not_cached",
                    "Refresh the marketplace catalog before confirming the plan",
                )
            self.store.register_product(product)
            self.store.add_cart_item(
                cart["id"],
                item["productId"],
                item["quantity"],
            )
        checkout = self.store.create_checkout(
            cart["id"],
            fulfillment="standard",
            buyer={
                "name": "OCP Assistant Buyer",
                "email": "assistant@example.com",
                "selectedStoreId": store_id,
                "requirement": plan["requirement"],
            },
        )
        plan["checkoutId"] = checkout["id"]
        return checkout


def parse_budget(text):
    patterns = [
        r"(?:预算|不超过|最多|小于|低于)\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?",
        r"(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)\s*(?:以内|以下)",
        r"(?:under|below|budget)\s*(\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return int(round(float(match.group(1)) * 100))
    return None


def parse_quantity(text):
    if re.search(r"(两个|两份|两杯|2份|2个|2杯)", text):
        return 2
    match = re.search(r"(\d+)\s*(?:份|个|杯|件)", text)
    if match:
        return max(1, min(5, int(match.group(1))))
    return 1


def matched_categories(text):
    categories = set()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            categories.add(category)
    return sorted(categories)


def matched_merchant_terms(text, marketplace):
    terms = []
    for merchant in marketplace.get("merchants") or []:
        merchant_lower = merchant.lower()
        if merchant_lower in text:
            terms.append(merchant_lower)
    aliases = {
        "肯德基": "肯德基",
        "kfc": "肯德基",
        "麦当劳": "麦当劳",
        "mcdonald": "麦当劳",
        "瑞幸": "瑞幸",
        "luckin": "瑞幸",
    }
    for alias, merchant in aliases.items():
        if alias in text:
            terms.append(merchant)
    return sorted(set(terms))


def explain_match(product, requirement, merchants, categories):
    reasons = []
    if merchants and any(term in product.get("merchantName", "") for term in merchants):
        reasons.append("Matches the requested merchant")
    if categories and product.get("category") in categories:
        reasons.append("Matches the requested category")
    if not reasons:
        reasons.append("Closest available match for the request")
    return " · ".join(reasons)
