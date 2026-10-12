const i18n = window.OCP_I18N;
const t = (key, variables) => i18n.t(key, variables);

const ui = {
  state: null,
  checkoutId: null,
  agentResult: null,
  eventFilter: "all",
  search: "",
  language: i18n.getLanguage(),
  merchantTests: {},
  merchantDirectory: [],
  location: null,
  stores: [],
  selectedStore: null,
  storeQuery: "",
  storeProviderFilter: "all",
  marketplaceProducts: [],
  marketplaceCategories: [],
  marketplaceMerchants: [],
  marketplaceCategory: "all",
  marketplaceMerchant: "all",
  assistantPlan: null,
  assistantCheckout: null,
  assistantPayment: null,
  assistantOrder: null,
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents, currency = "CNY") {
  return i18n.money(cents, currency);
}

function timeLabel(value) {
  return i18n.time(value);
}

function localizedProduct(product) {
  const translation = product.translations?.[ui.language] || {};
  return {
    name: translation.name || product.name,
    category: translation.category || product.category,
    description: translation.description || product.description,
    attributes: translation.attributes || product.attributes,
  };
}

function statusLabel(status) {
  const translated = t(`status.${status}`);
  return translated === `status.${status}` ? status : translated;
}

function eventTypeLabel(direction) {
  const translated = t(`events.${direction}`);
  return translated === `events.${direction}` ? direction : translated;
}

function compact(value, length = 72) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/ocp+json",
    "X-OCP-Version": "1.0",
    ...(options.headers || {}),
  };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
}

async function refresh() {
  try {
    ui.state = await api("/api/state");
    setConnection("online", t("connection.online"));
    render();
  } catch (error) {
    setConnection("offline", t("connection.offline"));
    toast(error.message, true);
  }
}

function setConnection(status, label) {
  const element = $(".connection-state");
  element.classList.remove("online", "offline");
  element.classList.add(status);
  $("#connectionLabel").textContent = label;
}

function render() {
  if (!ui.state) return;
  renderMetrics();
  renderMarketplaceFilters();
  renderProducts();
  renderCart();
  renderOrders();
  renderEvents();
  renderAssistant();
  renderMerchants();
  renderMerchantDirectory();
  renderStores();
  renderCapabilities();
  $("#serverClock").textContent = t("hero.serverTime", {
    time: i18n.dateTime(ui.state.serverTime),
  });
}

function renderMetrics() {
  const metrics = ui.state.metrics;
  $("#metrics").innerHTML = [
    [
      t("metrics.products"),
      ui.marketplaceProducts.length || metrics.products,
    ],
    [t("metrics.openCarts"), metrics.openCarts],
    [t("metrics.checkouts"), metrics.checkouts],
    [t("metrics.gross"), money(metrics.grossAmount, metrics.currency)],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderMarketplaceFilters() {
  const container = $("#marketplaceFilters");
  if (!container) return;
  const categoryButtons = [
    `<button class="marketplace-filter ${ui.marketplaceCategory === "all" ? "active" : ""}" type="button" data-marketplace-category="all">${t("catalog.allCategories")}</button>`,
    ...ui.marketplaceCategories.map(
      (category) => `
        <button class="marketplace-filter ${ui.marketplaceCategory === category ? "active" : ""}" type="button" data-marketplace-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>`
    ),
  ].join("");
  const merchantOptions = [
    `<option value="all">${t("catalog.allMerchants")}</option>`,
    ...ui.marketplaceMerchants.map(
      (merchant) => `
        <option value="${escapeHtml(merchant)}" ${ui.marketplaceMerchant === merchant ? "selected" : ""}>
          ${escapeHtml(merchant)}
        </option>`
    ),
  ].join("");
  container.innerHTML = `
    <div class="marketplace-category-list">${categoryButtons}</div>
    <select id="marketplaceMerchantSelect" class="marketplace-merchant-select">${merchantOptions}</select>`;
}

function renderProducts() {
  const search = ui.search.trim().toLowerCase();
  const source = ui.marketplaceProducts.length
    ? ui.marketplaceProducts
    : ui.state.products;
  const products = source.filter((product) => {
    const localized = localizedProduct(product);
    const text = `${product.name} ${product.category} ${product.description} ${product.merchantName || ""} ${localized.name} ${localized.category} ${localized.description}`.toLowerCase();
    const categoryMatches =
      ui.marketplaceCategory === "all" ||
      localized.category === ui.marketplaceCategory;
    const merchantMatches =
      ui.marketplaceMerchant === "all" ||
      product.merchantName === ui.marketplaceMerchant;
    return (
      (!search || text.includes(search)) &&
      categoryMatches &&
      merchantMatches
    );
  });
  $("#catalogCount").textContent = t("catalog.count", { count: products.length });
  $("#productGrid").innerHTML = products.length
    ? products
        .map(
          (product) => {
            const localized = localizedProduct(product);
            return `
            <article class="product-card">
              <div class="product-image">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(localized.name)}" onerror="this.onerror=null;this.src='/assets/ocp-mark.svg'">
                <span class="stock-badge ${product.stock <= 8 ? "low" : ""}">${t("catalog.stock", { count: product.stock })}</span>
              </div>
              <div class="product-body">
                <div class="product-meta">
                  <span class="product-category">${escapeHtml(localized.category)}</span>
                  <strong class="product-price">${money(product.price, product.currency)}</strong>
                </div>
                ${product.merchantName ? `<div class="product-merchant">${escapeHtml(product.merchantName)}</div>` : ""}
                <h3>${escapeHtml(localized.name)}</h3>
                <p class="product-description">${escapeHtml(localized.description)}</p>
                <div class="product-attributes">
                  ${(product.providerId ? [] : Object.values(localized.attributes))
                    .map((value) => `<span class="attribute">${escapeHtml(value)}</span>`)
                    .join("")}
                </div>
                <button class="button full secondary" type="button" data-add-product="${product.id}" ${product.stock < 1 ? "disabled" : ""}>
                  ${t("catalog.add")}
                </button>
              </div>
            </article>`;
          }
        )
        .join("")
    : `<div class="empty-state"><p>${t("catalog.empty")}</p></div>`;
}

function openCart() {
  return ui.state?.carts?.find((cart) => cart.status === "open") || null;
}

function renderCart() {
  const cart = openCart();
  const lines = $("#cartLines");
  $("#cartOwner").textContent = cart
    ? t("cart.buyer", { buyerId: cart.buyerId })
    : t("cart.waiting");
  $("#cartStatus").textContent = cart
    ? cart.status === "open"
      ? t("cart.open")
      : statusLabel(cart.status)
    : t("cart.empty");
  $("#cartStatus").className = `status-chip ${cart ? "success" : "neutral"}`;
  $("#cartSubtotal").textContent = money(cart?.subtotal || 0, cart?.currency);
  $("#checkoutButton").disabled = !cart || !cart.items.length;

  if (!cart || !cart.items.length) {
    lines.innerHTML = `<div class="empty-state compact"><span class="empty-icon">+</span><p>${t("cart.addPrompt")}</p></div>`;
    return;
  }

  lines.innerHTML = cart.items
    .map(
      (item) => `
        <div class="cart-line">
          <img src="${escapeHtml(item.image)}" alt="">
          <div>
            <div class="cart-line-name">${escapeHtml(localizedProduct(item).name)}</div>
            <div class="cart-line-meta">${money(item.unitPrice, cart.currency)} × ${item.quantity}</div>
            <button class="remove-line" type="button" data-remove-item="${item.id}">${t("cart.remove")}</button>
          </div>
          <div class="quantity-control">
            <button type="button" data-change-item="${item.id}" data-quantity="${item.quantity - 1}" aria-label="${t("cart.decrease")}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-change-item="${item.id}" data-quantity="${item.quantity + 1}" aria-label="${t("cart.increase")}">+</button>
          </div>
        </div>`
    )
    .join("");
}

function renderOrders() {
  const checkouts = ui.state.checkouts || [];
  const orders = ui.state.orders || [];
  const items = [
    ...checkouts
      .filter((checkout) => ["requires_payment", "processing"].includes(checkout.status))
      .map((checkout) => ({ type: "checkout", ...checkout })),
    ...orders.map((order) => ({ type: "order", ...order })),
  ];
  const list = $("#orderList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">#</span><p>${t("orders.empty")}</p></div>`;
    return;
  }
  list.innerHTML = items
    .slice(0, 8)
    .map((item) => {
      if (item.type === "checkout") {
        const canPay = item.status === "requires_payment";
        return `
          <article class="order-card">
            <div>
              <h3>${t("orders.checkout", { id: escapeHtml(item.id.slice(-8)) })}</h3>
              <p>${t("orders.itemLines", { count: item.items.length })} · ${item.fulfillment === "express" ? t("orders.express") : t("orders.standard")}</p>
              <p>${t("orders.status", { status: escapeHtml(statusLabel(item.status)) })}</p>
            </div>
            <div class="order-total">
              <strong>${money(item.totals.total, item.currency)}</strong>
              ${canPay ? `<button class="button primary" type="button" data-pay-checkout="${item.id}">${t("orders.pay")}</button>` : ""}
              ${canPay ? `<button class="button danger-outline" type="button" data-cancel-checkout="${item.id}">${t("orders.cancelCheckout")}</button>` : ""}
            </div>
          </article>`;
      }
      const cancelled = item.status === "cancelled";
      const cancellable =
        item.status === "confirmed" &&
        ["preparing", "pending"].includes(item.fulfillment.status);
      return `
        <article class="order-card">
          <div>
            <h3>${t("orders.order", { id: escapeHtml(item.id.slice(-8)) })}</h3>
            <p>${t("orders.itemLines", { count: item.items.length })} · ${cancelled ? t("orders.refunded") : t("orders.payment", { id: escapeHtml(item.paymentId.slice(-8)) })}</p>
            <p>${t("orders.fulfillment", { status: escapeHtml(statusLabel(item.fulfillment.status)) })} · ${timeLabel(item.createdAt)}</p>
          </div>
          <div class="order-total">
            <strong>${money(item.totals.total, item.currency)}</strong>
            <span class="status-chip ${cancelled ? "danger" : "success"}">${cancelled ? t("orders.cancelled") : t("orders.confirmed")}</span>
            ${cancellable ? `<button class="button danger-outline" type="button" data-cancel-order="${item.id}">${t("orders.cancel")}</button>` : ""}
          </div>
        </article>`;
    })
    .join("");
}

function visibleEvents() {
  const events = ui.state?.events || [];
  return ui.eventFilter === "all"
    ? events
    : events.filter((event) => event.direction === ui.eventFilter);
}

function renderEvents() {
  const events = visibleEvents();
  $("#eventTable").innerHTML = events
    .map(
      (event, index) => `
        <tr data-event-index="${index}">
          <td>${timeLabel(event.timestamp)}</td>
          <td><span class="event-badge ${escapeHtml(event.direction)}">${escapeHtml(eventTypeLabel(event.direction))}</span></td>
          <td title="${escapeHtml(event.action)}">${escapeHtml(event.action)}</td>
          <td title="${escapeHtml(compact(event.payload, 180))}">${escapeHtml(compact(event.payload))}</td>
        </tr>`
    )
    .join("");
  if (!events.length) {
    $("#eventTable").innerHTML = `<tr><td colspan="4">${t("events.none")}</td></tr>`;
  }
  const recent = ui.state.events.slice(0, 6);
  $("#recentEvents").innerHTML = recent.length
    ? recent
        .map(
          (event) => `
            <div class="event-row">
              <time>${timeLabel(event.timestamp)}</time>
              <div><strong>${escapeHtml(event.action)}</strong><span>${escapeHtml(compact(event.payload, 96))}</span></div>
            </div>`
        )
        .join("")
    : `<div class="empty-state compact"><p>${t("events.none")}</p></div>`;
}

function renderCapabilities() {
  const manifest = ui.state.ocpManifest;
  const gateway = ui.state.ocpGateway;
  const providers = gateway?.providers || [];
  $("#providerCount").textContent = t("architecture.providerCount", {
    count: providers.length,
  });
  $("#providerList").innerHTML = providers
    .map(
      (provider) => `
        <div class="provider-card">
          <div>
            <strong>${escapeHtml(provider.company_name)}</strong>
            <code>${escapeHtml(provider.provider_id)}</code>
          </div>
          <span class="status-chip ${provider.trust_tier === "verified" ? "success" : "warning"}">
            ${escapeHtml(provider.trust_tier)}
          </span>
        </div>`
    )
    .join("");
  const queryPacks = (manifest?.query_capabilities || []).flatMap((capability) =>
    (capability.query_packs || []).map((pack) => ({
      capability: capability.capability_id,
      pack: pack.pack_id,
      modes: pack.query_modes || [],
    }))
  );
  $("#operationGrid").innerHTML = queryPacks
    .map(
      (item, index) => `
        <div class="operation-card">
          <span>0${index + 1} · ${escapeHtml(item.modes.join(" / "))}</span>
          <code>${escapeHtml(item.pack)}</code>
        </div>`
    )
    .join("");
  const endpointMap = manifest?.endpoints || {};
  const endpoints = [
    ["GET", "/.well-known/ocp-catalog"],
    ...Object.values(endpointMap).map((endpoint) => [
      endpoint.method,
      new URL(endpoint.url).pathname,
    ]),
    ...Object.values(gateway?.endpoints || {}).map((endpoint) => {
      const url = new URL(endpoint);
      return ["POST", url.pathname];
    }),
  ];
  $("#endpointList").innerHTML = endpoints
    .map(
      ([method, path]) =>
        `<div class="endpoint-item"><span class="method">${method}</span><code>${escapeHtml(path)}</code></div>`
    )
    .join("");
  $("#discoveryUrl").textContent = "/.well-known/ocp-catalog";
}

function renderMerchants() {
  const providers = ui.state.ocpGateway?.providers || [];
  $("#merchantCount").textContent = t("merchants.count", {
    count: providers.length,
  });
  const list = $("#merchantList");
  if (!providers.length) {
    list.innerHTML = `<div class="empty-state compact"><p>${t("merchants.empty")}</p></div>`;
    return;
  }
  list.innerHTML = providers
    .map((provider) => {
      const test = ui.merchantTests[provider.provider_id];
      const authorizationPending =
        provider.connection_status === "authorization_required";
      const testClass =
        authorizationPending
          ? "warning"
          : test?.status === "connected"
          ? "success"
          : test?.status === "unavailable"
            ? "danger"
            : "neutral";
      const testLabel =
        authorizationPending
          ? t("merchants.authorizationRequired")
          : test?.status === "connected"
          ? t("merchants.connected")
          : test?.status === "unavailable"
            ? t("merchants.unavailable")
            : provider.trust_tier;
      return `
        <article class="merchant-card">
          <div>
            <strong>${escapeHtml(provider.company_name)}</strong>
            <code>${escapeHtml(provider.provider_id)}</code>
            <small>${provider.adapter_type === "local" ? t("merchants.builtIn") : t("merchants.external")} · ${escapeHtml(provider.catalog_id)}</small>
          </div>
          <div class="merchant-card-actions">
            <span class="status-chip ${testClass}">${escapeHtml(testLabel)}</span>
            ${
              provider.adapter_type !== "connector"
                ? `<button class="button secondary" type="button" data-test-provider="${provider.provider_id}">${t("merchants.test")}</button>`
                : ""
            }
            ${
              provider.adapter_type !== "local"
                ? `<button class="button danger-outline" type="button" data-remove-provider="${provider.provider_id}" data-provider-name="${escapeHtml(provider.company_name)}">${t("merchants.remove")}</button>`
                : ""
            }
          </div>
        </article>`;
    })
    .join("");
}

function renderMerchantDirectory() {
  const container = $("#merchantDirectory");
  if (!container) return;
  const merchants = ui.merchantDirectory || [];
  if (!merchants.length) {
    container.innerHTML = `<div class="empty-state compact"><p>${t("merchants.directoryEmpty")}</p></div>`;
    return;
  }
  container.innerHTML = merchants
    .map((merchant) => {
      const direct = merchant.integration_mode === "ocp_catalog";
      const label = merchant.connected
        ? t("merchants.alreadyConnected")
        : direct
          ? t("merchants.addDirect")
          : t("merchants.addPending");
      return `
        <article class="directory-card">
          <div>
            <strong>${escapeHtml(merchant.name)}</strong>
            <span>${escapeHtml(merchant.category)} · ${escapeHtml(merchant.region)}</span>
            <small>${escapeHtml(merchant.description)}</small>
          </div>
          <div>
            <span class="status-chip ${direct ? "success" : "warning"}">${direct ? t("merchants.directReady") : t("merchants.authorizationRequired")}</span>
            <button class="button ${merchant.connected ? "secondary" : "primary"}" type="button" data-add-directory-merchant="${merchant.merchant_id}" ${merchant.connected ? "disabled" : ""}>
              ${label}
            </button>
          </div>
        </article>`;
    })
    .join("");
}

async function loadMerchantDirectory(query = "") {
  try {
    const result = await api(
      `/ocp/gateway/directory?query=${encodeURIComponent(query)}&region=CN&limit=30`
    );
    ui.merchantDirectory = result.merchants || [];
    renderMerchantDirectory();
  } catch (error) {
    toast(error.message, true);
  }
}

async function addDirectoryMerchant(merchantId) {
  const merchant = ui.merchantDirectory.find(
    (item) => item.merchant_id === merchantId
  );
  try {
    const provider = await api("/ocp/gateway/directory/add", {
      method: "POST",
      body: JSON.stringify({ merchant_id: merchantId }),
    });
    await refresh();
    await loadMerchantDirectory($("#merchantDirectorySearch").value);
    await loadMarketplace();
    toast(
      provider.connection_status === "connected"
        ? t("merchants.directoryAdded", { name: provider.company_name })
        : t("merchants.pendingAdded", { name: provider.company_name })
    );
  } catch (error) {
    toast(error.message, true);
  }
}

function storeProviders() {
  return (ui.state?.ocpGateway?.providers || []).filter(
    (provider) =>
      provider.supports_stores &&
      provider.connection_status !== "authorization_required"
  );
}

function renderStores() {
  const providers = storeProviders();
  const filters = $("#storeFilters");
  if (filters) {
    filters.innerHTML = [
      `<button class="store-filter ${ui.storeProviderFilter === "all" ? "active" : ""}" type="button" data-store-provider="all">${t("stores.allProviders")}</button>`,
      ...providers.map(
        (provider) => `
          <button class="store-filter ${ui.storeProviderFilter === provider.provider_id ? "active" : ""}" type="button" data-store-provider="${provider.provider_id}">
            ${escapeHtml(provider.company_name)}
          </button>`
      ),
    ].join("");
  }
  const list = $("#storeList");
  if (!list) return;
  if (!ui.stores.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">◎</span><p>${t("stores.empty")}</p></div>`;
  } else {
    list.innerHTML = ui.stores
      .map((store) => {
        const selected =
          ui.selectedStore?.store_id === store.store_id &&
          ui.selectedStore?.provider_id === store.provider_id;
        return `
          <article class="store-card ${selected ? "selected" : ""}">
            <div class="store-card-header">
              <h3>${escapeHtml(store.name)}</h3>
              <span class="status-chip ${selected ? "success" : "neutral"}">
                ${selected ? t("stores.selected") : escapeHtml(store.company_name)}
              </span>
            </div>
            <p>${escapeHtml(store.address)}</p>
            <div class="store-meta">
              ${
                store.distance_km !== null && store.distance_km !== undefined
                  ? `<span>${t("stores.distance", { distance: store.distance_km })}</span>`
                  : ""
              }
              ${store.hours ? `<span>${t("stores.hours", { hours: escapeHtml(store.hours) })}</span>` : ""}
              ${(store.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
            <button class="button ${selected ? "secondary" : "primary"} full" type="button" data-select-store="${store.provider_id}|${store.store_id}">
              ${selected ? t("stores.selected") : t("stores.select")}
            </button>
          </article>`;
      })
      .join("");
  }
  renderSelectedStore();
}

function renderSelectedStore() {
  const container = $("#selectedStore");
  if (!container) return;
  if (!ui.selectedStore) {
    container.innerHTML = `
      <div class="empty-state compact">
        <span class="empty-icon" aria-hidden="true">◎</span>
        <p>${t("stores.noneSelected")}</p>
      </div>`;
    return;
  }
  const store = ui.selectedStore;
  container.innerHTML = `
    <div class="selected-store-card">
      <h3>${escapeHtml(store.name)}</h3>
      <p>${escapeHtml(store.company_name)}</p>
      <p>${escapeHtml(store.address)}</p>
      ${
        store.distance_km !== null && store.distance_km !== undefined
          ? `<p>${t("stores.distance", { distance: store.distance_km })}</p>`
          : ""
      }
      <span class="status-chip success">${escapeHtml(store.store_id)}</span>
    </div>`;
}

async function loadStores() {
  try {
    const parameters = new URLSearchParams({
      query: ui.storeQuery,
      radius_km: "500",
    });
    if (ui.location) {
      parameters.set("latitude", ui.location.latitude);
      parameters.set("longitude", ui.location.longitude);
    }
    const providers = storeProviders();
    if (ui.storeProviderFilter !== "all") {
      parameters.set("provider_ids", ui.storeProviderFilter);
    } else if (providers.length) {
      parameters.set(
        "provider_ids",
        providers.map((provider) => provider.provider_id).join(",")
      );
    }
    const result = await api(`/ocp/gateway/stores?${parameters.toString()}`);
    ui.stores = result.stores || [];
    renderStores();
  } catch (error) {
    toast(error.message, true);
  }
}

function useCurrentLocation() {
  const status = $("#locationStatus");
  if (!navigator.geolocation) {
    status.textContent = t("stores.locationDenied");
    return;
  }
  status.textContent = t("stores.locating");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      ui.location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      status.textContent = `${t("stores.locationReady")} · ±${Math.round(ui.location.accuracy)} m`;
      loadStores();
    },
    () => {
      status.textContent = t("stores.locationDenied");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function ensureCart() {
  const existing = openCart();
  if (existing) return existing;
  return api("/ocp/v1/carts", {
    method: "POST",
    body: JSON.stringify({ buyerId: "buyer_console" }),
    headers: { "Idempotency-Key": `console-cart-${Date.now()}` },
  });
}

async function loadMarketplace() {
  try {
    const result = await api("/api/marketplace");
    ui.marketplaceProducts = result.products || [];
    ui.marketplaceCategories = result.categories || [];
    ui.marketplaceMerchants = result.merchants || [];
    if (
      ui.marketplaceCategory !== "all" &&
      !ui.marketplaceCategories.includes(ui.marketplaceCategory)
    ) {
      ui.marketplaceCategory = "all";
    }
    if (
      ui.marketplaceMerchant !== "all" &&
      !ui.marketplaceMerchants.includes(ui.marketplaceMerchant)
    ) {
      ui.marketplaceMerchant = "all";
    }
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderAssistant() {
  const storeHint = $("#assistantStoreHint");
  if (storeHint) {
    storeHint.textContent = ui.selectedStore
      ? t("assistant.selectedStore", { name: ui.selectedStore.name })
      : t("assistant.noStore");
  }
  const planContainer = $("#assistantPlan");
  if (planContainer) {
    if (!ui.assistantPlan) {
      planContainer.innerHTML = `<div class="empty-state compact"><p>${t("assistant.planEmpty")}</p></div>`;
    } else {
      planContainer.innerHTML = `
        <div class="assistant-plan-summary">
          <div>
            <strong>${escapeHtml(ui.assistantPlan.requirement)}</strong>
            <span>${ui.assistantPlan.item_count} 件 · ${money(ui.assistantPlan.total, "CNY")}</span>
          </div>
          <button class="button primary" type="button" data-confirm-assistant-plan>
            ${t("assistant.confirmPlan")}
          </button>
        </div>
        ${ui.assistantPlan.items
          .map(
            (item) => `
              <article class="assistant-plan-item">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.merchantName || "")} · ${escapeHtml(item.category || "")}</span>
                  <small>${t("assistant.reason", { reason: escapeHtml(item.reason) })}</small>
                </div>
                <strong>${money(item.total, "CNY")}</strong>
              </article>`
          )
          .join("")}`;
    }
  }
  renderAssistantCheckout();
}

function renderAssistantCheckout() {
  const container = $("#assistantCheckout");
  if (!container) return;
  if (!ui.assistantCheckout) {
    container.innerHTML = `
      <div class="empty-state compact">
        <span class="empty-icon" aria-hidden="true">✓</span>
        <p>${t("assistant.checkoutEmpty")}</p>
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="assistant-plan-summary">
      <div>
        <strong>${t("assistant.checkoutReady")}</strong>
        <span>${ui.assistantCheckout.items.length} 个商品行</span>
      </div>
      <strong>${money(ui.assistantCheckout.totals.total, ui.assistantCheckout.currency)}</strong>
    </div>`;
}

async function generateAssistantPlan() {
  const button = $("#assistantPlanButton");
  const label = button.querySelector("[data-i18n]");
  const requirement = $("#assistantRequirement").value.trim();
  button.disabled = true;
  label.textContent = t("assistant.planning");
  try {
    ui.assistantPlan = await api("/api/assistant/plan", {
      method: "POST",
      body: JSON.stringify({ requirement }),
    });
    ui.assistantCheckout = null;
    ui.assistantPayment = null;
    ui.assistantOrder = null;
    renderAssistant();
    toast(
      t("assistant.planCreated", {
        count: ui.assistantPlan.item_count,
      })
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    label.textContent = t("assistant.generatePlan");
  }
}

async function confirmAssistantPlan() {
  if (!ui.assistantPlan) return;
  try {
    ui.assistantCheckout = await api("/api/assistant/confirm", {
      method: "POST",
      body: JSON.stringify({
        planId: ui.assistantPlan.plan_id,
        confirmed: true,
        buyerId: "assistant_buyer",
        storeId: ui.selectedStore?.store_id || null,
      }),
    });
    const consent = $("#paymentConsent");
    consent.checked = false;
    $("#generatePaymentQrButton").disabled = true;
    $("#paymentQr").innerHTML = "";
    renderAssistantCheckout();
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function generatePaymentQr() {
  if (!ui.assistantCheckout) return;
  const consent = $("#paymentConsent");
  if (!consent.checked) {
    toast(t("assistant.paymentConsent"), true);
    return;
  }
  const button = $("#generatePaymentQrButton");
  const label = button.querySelector("[data-i18n]");
  button.disabled = true;
  label.textContent = t("assistant.generatingQr");
  try {
    const payment = await api("/api/assistant/payment-qr", {
      method: "POST",
      body: JSON.stringify({
        checkoutId: ui.assistantCheckout.id,
        provider: $("#paymentMethod").value,
        consent: true,
      }),
    });
    ui.assistantPayment = payment;
    $("#paymentQr").innerHTML = `
      <div class="payment-qr-card">
        ${payment.qrSvg}
        <strong>${t("assistant.qrTitle")}</strong>
        <p>${t("assistant.qrNotice")}</p>
        <button class="button full secondary" type="button" data-complete-sandbox-payment="${payment.id}">
          ${t("assistant.completeSandbox")}
        </button>
      </div>`;
  } catch (error) {
    toast(error.message, true);
  } finally {
    label.textContent = t("assistant.generateQr");
    button.disabled = !consent.checked;
  }
}

async function completeSandboxPayment() {
  if (!ui.assistantPayment) return;
  try {
    const order = await api(
      `/api/payments/${ui.assistantPayment.id}/complete`,
      { method: "POST" }
    );
    ui.assistantOrder = order;
    $("#paymentQr").innerHTML = `
      <div class="payment-qr-card">
        <span class="status-chip success">${t("assistant.paymentComplete", { id: order.id.slice(-8) })}</span>
      </div>`;
    toast(t("assistant.paymentComplete", { id: order.id.slice(-8) }));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function addProduct(productId) {
  const button = document.querySelector(`[data-add-product="${productId}"]`);
  if (button) button.disabled = true;
  try {
    const cart = await ensureCart();
    await api("/api/actions/add-to-cart", {
      method: "POST",
      body: JSON.stringify({ cartId: cart.id, productId, quantity: 1 }),
      headers: { "Idempotency-Key": `add-${cart.id}-${productId}-${Date.now()}` },
    });
    toast(t("toast.productAdded"));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function changeItem(itemId, quantity) {
  const cart = openCart();
  if (!cart) return;
  try {
    if (quantity <= 0) {
      await api(`/ocp/v1/carts/${cart.id}/items/${itemId}`, { method: "DELETE" });
    } else {
      await api(`/ocp/v1/carts/${cart.id}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
        headers: { "Idempotency-Key": `change-${itemId}-${quantity}-${Date.now()}` },
      });
    }
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function createCheckout() {
  const cart = openCart();
  if (!cart || !cart.items.length) return;
  try {
    const checkout = await api("/ocp/v1/checkouts", {
      method: "POST",
      body: JSON.stringify({
        cartId: cart.id,
        fulfillment: "standard",
        buyer: {
          name: "Console Buyer",
          email: "console@example.com",
          address: { line1: "88 Commerce Road", city: "Shanghai", postalCode: "200000", country: "CN" },
        },
      }),
      headers: { "Idempotency-Key": `checkout-${cart.id}-${Date.now()}` },
    });
    ui.checkoutId = checkout.id;
    toast(t("toast.checkoutCreated"));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function payCheckout(checkoutId) {
  try {
    const order = await api(`/ocp/v1/checkouts/${checkoutId}/pay`, {
      method: "POST",
      body: JSON.stringify({ paymentMethodToken: "tok_demo_visa" }),
      headers: { "Idempotency-Key": `pay-${checkoutId}-${Date.now()}` },
    });
    toast(t("toast.paymentConfirmed", { id: order.id.slice(-8) }));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function cancelCheckout(checkoutId) {
  if (!window.confirm(t("orders.cancelCheckoutConfirm"))) return;
  try {
    await api(`/ocp/v1/checkouts/${checkoutId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "buyer_requested" }),
      headers: {
        "Idempotency-Key": `cancel-checkout-${checkoutId}-${Date.now()}`,
      },
    });
    toast(t("orders.checkoutCancelled"));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function cancelOrder(orderId) {
  if (!window.confirm(t("orders.cancelConfirm"))) return;
  try {
    const order = await api(`/ocp/v1/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "buyer_requested" }),
      headers: { "Idempotency-Key": `cancel-${orderId}-${Date.now()}` },
    });
    toast(t("toast.orderCancelled", { id: order.id.slice(-8) }));
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

async function registerMerchant(form) {
  const button = $("#registerMerchantButton");
  const label = button.querySelector("[data-i18n]");
  const originalLabel = label.textContent;
  const data = new FormData(form);
  const catalogUrl = String(data.get("url") || "").trim();
  button.disabled = true;
  label.textContent = t("merchants.adding");
  try {
    const provider = await api("/ocp/gateway/providers/quick", {
      method: "POST",
      body: JSON.stringify({ url: catalogUrl }),
    });
    form.reset();
    await refresh();
    await loadMarketplace();
    ui.merchantTests[provider.provider_id] = {
      status:
        provider.connection_test?.status === "ok"
          ? "connected"
          : "unavailable",
      count: provider.connection_test?.result_count || 0,
    };
    renderMerchants();
    toast(t("merchants.added", { name: provider.company_name }));
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    label.textContent = originalLabel;
  }
}

async function testMerchant(providerId) {
  ui.merchantTests[providerId] = { status: "testing" };
  renderMerchants();
  try {
    const result = await api("/ocp/gateway/query", {
      method: "POST",
      body: JSON.stringify({
        query: "",
        query_pack: "ocp.query.keyword.v1",
        provider_ids: [providerId],
        limit: 1,
      }),
    });
    const provider = result.providers?.find(
      (item) => item.provider_id === providerId
    );
    if (provider?.status === "ok") {
      ui.merchantTests[providerId] = {
        status: "connected",
        count: provider.result_count,
      };
      const company =
        ui.state.ocpGateway?.providers.find(
          (item) => item.provider_id === providerId
        )?.company_name || providerId;
      toast(
        t("merchants.testSuccess", {
          name: company,
          count: provider.result_count,
        })
      );
    } else {
      ui.merchantTests[providerId] = { status: "unavailable" };
      toast(t("merchants.testFailed", { name: providerId }), true);
    }
  } catch (error) {
    ui.merchantTests[providerId] = { status: "unavailable" };
    toast(error.message, true);
  }
  renderMerchants();
}

async function removeMerchant(providerId, companyName) {
  if (!window.confirm(t("merchants.removeConfirm", { name: companyName }))) {
    return;
  }
  try {
    await api(`/ocp/gateway/providers/${providerId}`, {
      method: "DELETE",
    });
    delete ui.merchantTests[providerId];
    await refresh();
    await loadMarketplace();
    toast(t("merchants.removed", { name: companyName }));
  } catch (error) {
    toast(error.message, true);
  }
}

async function runAgent() {
  const button = $("#runAgentButton");
  button.disabled = true;
  $("#agentStatus").textContent = t("agent.running");
  $("#agentStatus").className = "status-chip warning";
  try {
    const result = await api("/api/agent/run", {
      method: "POST",
      body: JSON.stringify({ query: "portable" }),
    });
    ui.agentResult = result;
    renderAgent();
    toast(t("toast.agentCompleted", { id: result.order.id.slice(-8) }));
    await refresh();
    switchView("activity");
  } catch (error) {
    $("#agentStatus").textContent = t("agent.failed");
    $("#agentStatus").className = "status-chip danger";
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderAgent() {
  if (!ui.agentResult) return;
  const steps = ui.agentResult.steps || [];
  $("#agentStatus").textContent =
    ui.agentResult.status === "completed"
      ? t("agent.completed")
      : statusLabel(ui.agentResult.status);
  $("#agentStatus").className = `status-chip ${ui.agentResult.status === "completed" ? "success" : "warning"}`;
  $("#agentProgress").innerHTML = steps
    .map(
      (step, index) => `
        <div class="agent-step">
          <strong>${index + 1}. ${escapeHtml(step.operation)}</strong>
          <span>${escapeHtml(t(`agent.operations.${step.operation}`))}</span>
        </div>`
    )
    .join("");
  $("#jsonPreview").textContent = JSON.stringify(ui.agentResult.order, null, 2);
}

function switchView(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  if (name === "stores" && ui.state) loadStores();
  if (name === "assistant") renderAssistant();
}

function toast(message, isError = false) {
  const element = document.createElement("div");
  element.className = `toast ${isError ? "error" : ""}`;
  element.textContent = message;
  $("#toastRegion").appendChild(element);
  window.setTimeout(() => element.remove(), 3600);
}

document.addEventListener("click", (event) => {
  const addProductButton = event.target.closest("[data-add-product]");
  const changeButton = event.target.closest("[data-change-item]");
  const removeButton = event.target.closest("[data-remove-item]");
  const payButton = event.target.closest("[data-pay-checkout]");
  const cancelOrderButton = event.target.closest("[data-cancel-order]");
  const cancelCheckoutButton = event.target.closest("[data-cancel-checkout]");
  const testProviderButton = event.target.closest("[data-test-provider]");
  const removeProviderButton = event.target.closest("[data-remove-provider]");
  const addDirectoryMerchantButton = event.target.closest(
    "[data-add-directory-merchant]"
  );
  const selectStoreButton = event.target.closest("[data-select-store]");
  const storeProviderButton = event.target.closest("[data-store-provider]");
  const marketplaceCategoryButton = event.target.closest(
    "[data-marketplace-category]"
  );
  const confirmAssistantButton = event.target.closest(
    "[data-confirm-assistant-plan]"
  );
  const completePaymentButton = event.target.closest(
    "[data-complete-sandbox-payment]"
  );
  const tab = event.target.closest(".tab");
  const filter = event.target.closest(".filter");
  const eventRow = event.target.closest("[data-event-index]");

  if (addProductButton) addProduct(addProductButton.dataset.addProduct);
  if (changeButton) changeItem(changeButton.dataset.changeItem, Number(changeButton.dataset.quantity));
  if (removeButton) changeItem(removeButton.dataset.removeItem, 0);
  if (payButton) payCheckout(payButton.dataset.payCheckout);
  if (cancelOrderButton) cancelOrder(cancelOrderButton.dataset.cancelOrder);
  if (cancelCheckoutButton) {
    cancelCheckout(cancelCheckoutButton.dataset.cancelCheckout);
  }
  if (testProviderButton) testMerchant(testProviderButton.dataset.testProvider);
  if (removeProviderButton) {
    removeMerchant(
      removeProviderButton.dataset.removeProvider,
      removeProviderButton.dataset.providerName
    );
  }
  if (addDirectoryMerchantButton) {
    addDirectoryMerchant(
      addDirectoryMerchantButton.dataset.addDirectoryMerchant
    );
  }
  if (selectStoreButton) {
    const [providerId, storeId] = selectStoreButton.dataset.selectStore.split("|");
    ui.selectedStore =
      ui.stores.find(
        (store) =>
          store.provider_id === providerId && store.store_id === storeId
      ) || null;
    renderStores();
    renderAssistant();
  }
  if (storeProviderButton) {
    ui.storeProviderFilter = storeProviderButton.dataset.storeProvider;
    loadStores();
  }
  if (marketplaceCategoryButton) {
    ui.marketplaceCategory =
      marketplaceCategoryButton.dataset.marketplaceCategory;
    renderMarketplaceFilters();
    renderProducts();
  }
  if (confirmAssistantButton) confirmAssistantPlan();
  if (completePaymentButton) completeSandboxPayment();
  if (tab) switchView(tab.dataset.view);
  if (filter) {
    ui.eventFilter = filter.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === filter));
    renderEvents();
  }
  if (eventRow) {
    const selected = visibleEvents()[Number(eventRow.dataset.eventIndex)];
    $("#jsonPreview").textContent = JSON.stringify(selected, null, 2);
  }
});

$("#catalogSearch").addEventListener("input", (event) => {
  ui.search = event.target.value;
  renderProducts();
});

$("#checkoutButton").addEventListener("click", createCheckout);
$("#runAgentButton").addEventListener("click", runAgent);
$("#merchantForm").addEventListener("submit", (event) => {
  event.preventDefault();
  registerMerchant(event.currentTarget);
});
let directorySearchTimer = null;
$("#merchantDirectorySearch").addEventListener("input", (event) => {
  window.clearTimeout(directorySearchTimer);
  directorySearchTimer = window.setTimeout(
    () => loadMerchantDirectory(event.target.value),
    180
  );
});
let storeSearchTimer = null;
$("#storeSearch").addEventListener("input", (event) => {
  ui.storeQuery = event.target.value;
  window.clearTimeout(storeSearchTimer);
  storeSearchTimer = window.setTimeout(loadStores, 180);
});
$("#useLocationButton").addEventListener("click", useCurrentLocation);
$("#assistantPlanButton").addEventListener("click", generateAssistantPlan);
$("#generatePaymentQrButton").addEventListener("click", generatePaymentQr);
$("#paymentConsent").addEventListener("change", (event) => {
  $("#generatePaymentQrButton").disabled = !event.target.checked;
});
document.addEventListener("change", (event) => {
  if (event.target.id === "marketplaceMerchantSelect") {
    ui.marketplaceMerchant = event.target.value;
    renderProducts();
  }
});
$("#clearFiltersButton").addEventListener("click", () => {
  ui.eventFilter = "all";
  document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
  renderEvents();
});
$("#copyDiscoveryButton").addEventListener("click", async () => {
  const url = `${window.location.origin}/.well-known/ocp-catalog`;
  try {
    await navigator.clipboard.writeText(url);
    toast(t("toast.discoveryCopied"));
  } catch {
    toast(url);
  }
});

$("#languageSelect").addEventListener("change", (event) => {
  ui.language = i18n.setLanguage(event.target.value);
  i18n.apply(document);
  if (ui.state) render();
  if (ui.agentResult) renderAgent();
  refresh();
});

$("#languageSelect").value = i18n.setLanguage(ui.language);
i18n.apply(document);
loadMerchantDirectory();
refresh().then(() => Promise.all([loadStores(), loadMarketplace()]));
window.setInterval(refresh, 2500);
