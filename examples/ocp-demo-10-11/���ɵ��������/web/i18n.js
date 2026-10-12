(function () {
  const STORAGE_KEY = "ocp.language";
  const DEFAULT_LANGUAGE = "zh-CN";
  const messages = {
    "zh-CN": {
      app: { title: "OCP Commerce Lab" },
      connection: {
        connecting: "正在连接",
        online: "协议在线",
        offline: "连接中断",
      },
      header: { runAgent: "运行买家代理" },
      hero: {
        title: "商户商务能力沙盒",
        loading: "服务状态加载中",
        serverTime: "服务器时间 {time}",
      },
      nav: {
        label: "工作区",
        commerce: "商务流程",
        assistant: "智能选购",
        activity: "协议轨迹",
        merchants: "商户接入",
        stores: "门店选择",
        architecture: "接口能力",
      },
      metrics: {
        products: "商品",
        openCarts: "开放购物车",
        checkouts: "结算会话",
        gross: "成交金额",
      },
      assistant: {
        title: "描述你的需求",
        subtitle: "系统会从已接入商户中生成购物方案",
        placeholder: "例如：我想买汉堡和薯条，预算 50 元",
        noStore: "未选择门店",
        selectedStore: "当前门店：{name}",
        generatePlan: "生成购物方案",
        planning: "正在分析需求",
        planTitle: "推荐购物方案",
        planEmpty: "输入需求后生成购物方案",
        confirmPlan: "同意方案并加入购物车",
        confirming: "正在创建购物车",
        reason: "推荐原因：{reason}",
        confirmTitle: "确认与支付",
        confirmSubtitle: "确认后才会加入购物车",
        checkoutEmpty: "确认购物方案后创建结算",
        checkoutReady: "结算已创建",
        paymentConsent: "我同意使用所选支付方式并生成付款二维码",
        wechat: "微信支付（沙箱）",
        generateQr: "生成微信付款二维码",
        generatingQr: "正在生成二维码",
        qrTitle: "微信沙箱付款二维码",
        qrNotice: "正式微信支付需要已认证的微信支付商户号。",
        completeSandbox: "模拟扫码完成支付",
        paymentComplete: "支付完成，订单 {id} 已确认",
        planCreated: "已生成 {count} 件商品的购物方案",
      },
      catalog: {
        title: "商品目录",
        count: "{count} 个商品",
        search: "搜索商品",
        allCategories: "全部品类",
        allMerchants: "全部商户",
        stock: "库存 {count}",
        add: "加入购物车",
        empty: "没有匹配的商品",
      },
      cart: {
        title: "购物车",
        waiting: "等待创建会话",
        empty: "空",
        addPrompt: "从商品目录添加商品",
        subtotal: "商品小计",
        taxNote: "税费与配送在结算时计算",
        createCheckout: "创建结算",
        buyer: "买家 {buyerId}",
        remove: "移除",
        decrease: "减少数量",
        increase: "增加数量",
        open: "开放",
      },
      orders: {
        title: "结算与订单",
        subtitle: "支付状态由商户实时确认",
        empty: "完成购物车后创建结算",
        checkout: "结算 {id}",
        order: "订单 {id}",
        itemLines: "{count} 个商品行",
        status: "状态 {status}",
        payment: "支付 {id}",
        fulfillment: "配送 {status}",
        pay: "支付",
        cancelCheckout: "取消订单",
        cancelCheckoutConfirm: "确定取消当前待支付订单吗？",
        checkoutCancelled: "待支付订单已取消",
        cancel: "取消订单",
        cancelConfirm: "确定取消这笔订单并退款吗？",
        confirmed: "已确认",
        cancelled: "已取消",
        refunded: "已退款",
        express: "加急配送",
        standard: "标准配送",
      },
      events: {
        title: "最近事件",
        subtitle: "协议与业务状态变化",
        activityTitle: "OCP 消息轨迹",
        activitySubtitle: "请求、响应、错误与业务事件",
        all: "全部",
        response: "响应",
        business: "业务",
        error: "错误",
        time: "时间",
        type: "类型",
        operation: "操作",
        summary: "摘要",
        none: "暂无事件",
      },
      agent: {
        title: "代理执行",
        subtitle: "目录到订单的自动化链路",
        idle: "待运行",
        running: "执行中",
        failed: "失败",
        completed: "已完成",
        empty: "尚未执行代理流程",
        jsonPlaceholder: "选择一条协议事件查看详情。",
        operations: {
          capabilities: "发现商户能力",
          "catalog.search": "从目录选择了商品",
          "cart.create": "创建购物车",
          "cart.item.add": "商户返回购物车价格",
          "checkout.create": "商户返回结算总价",
          "checkout.pay": "支付完成并确认订单",
          "order.get": "核对最终订单状态",
        },
      },
      architecture: {
        title: "OCP Catalog 协议",
        subtitle: "目录发现、查询、解析与对象契约",
        providersTitle: "接入公司",
        providersSubtitle: "通过统一 OCP-Catalog 网关连接",
        providerCount: "{count} 家",
        copy: "复制地址",
        endpointsTitle: "HTTP 映射",
        endpointsSubtitle: "OCP 1.0 资源地址",
      },
      merchants: {
        title: "添加商户接口",
        subtitle: "注册遵循 OCP-Catalog 的外部商户",
        directoryTitle: "中国商户目录",
        directorySubtitle: "按名称搜索并加入接口",
        directorySearch: "搜索商户名称",
        directoryEmpty: "没有匹配的商户",
        manualTitle: "手动添加 Catalog",
        manualSubtitle: "通过标准地址自动发现接口",
        directReady: "可直接接入",
        authorizationRequired: "需要企业授权",
        addDirect: "搜索并接入",
        addPending: "加入待配置",
        alreadyConnected: "已接入",
        directoryAdded: "{name} 已接入",
        pendingAdded: "{name} 已加入待授权列表",
        providerId: "商户标识",
        companyName: "公司名称",
        baseUrl: "Catalog 根地址",
        catalogUrl: "Catalog 地址",
        catalogId: "Catalog ID",
        trustTier: "信任等级",
        add: "添加商户",
        quickAdd: "一键接入",
        adding: "正在添加",
        listTitle: "已接入商户",
        listSubtitle: "统一网关中的 Provider",
        count: "{count} 家",
        empty: "尚未接入商户",
        test: "测试连接",
        testing: "测试中",
        connected: "连接正常",
        unavailable: "不可用",
        builtIn: "内置",
        external: "外部",
        remove: "移除",
        removeConfirm: "确定移除商户 {name} 吗？",
        added: "商户 {name} 已接入",
        removed: "商户 {name} 已移除",
        testSuccess: "{name} 已返回 {count} 条目录结果",
        testFailed: "{name} 连接测试失败",
      },
      stores: {
        title: "附近门店",
        locationIdle: "位置尚未获取",
        useLocation: "开启定位",
        locating: "正在获取位置",
        locationReady: "已定位，门店按距离排序",
        locationDenied: "定位失败，可继续按名称搜索门店",
        searchPlaceholder: "搜索门店或地址",
        allProviders: "全部商户",
        empty: "没有匹配的门店",
        select: "选择门店",
        selected: "已选择",
        selectedTitle: "已选门店",
        selectedSubtitle: "用于当前点单会话",
        noneSelected: "请选择一家门店",
        distance: "约 {distance} km",
        hours: "营业时间 {hours}",
      },
      status: {
        open: "开放",
        completed: "已完成",
        checkout: "结算中",
        requires_payment: "待支付",
        paid: "已支付",
        confirmed: "已确认",
        cancelled: "已取消",
        refunded: "已退款",
        preparing: "备货中",
        available: "可用",
      },
      toast: {
        productAdded: "商品已加入购物车",
        checkoutCreated: "结算会话已创建",
        paymentConfirmed: "支付成功，订单 {id} 已确认",
        agentCompleted: "代理完成订单 {id}",
        orderCancelled: "订单 {id} 已取消并完成退款",
        discoveryCopied: "服务发现地址已复制",
      },
    },
    "en-US": {
      app: { title: "OCP Commerce Lab" },
      connection: {
        connecting: "Connecting",
        online: "Protocol online",
        offline: "Connection lost",
      },
      header: { runAgent: "Run buyer agent" },
      hero: {
        title: "Merchant commerce sandbox",
        loading: "Loading service status",
        serverTime: "Server time {time}",
      },
      nav: {
        label: "Workspace",
        commerce: "Commerce",
        assistant: "Smart shopping",
        activity: "Protocol trace",
        merchants: "Merchant access",
        stores: "Store selection",
        architecture: "Capabilities",
      },
      metrics: {
        products: "Products",
        openCarts: "Open carts",
        checkouts: "Checkouts",
        gross: "Gross amount",
      },
      assistant: {
        title: "Describe your needs",
        subtitle: "Generate a shopping plan from connected merchants",
        placeholder: "Example: I want a burger and fries under CNY 50",
        noStore: "No store selected",
        selectedStore: "Current store: {name}",
        generatePlan: "Generate plan",
        planning: "Analyzing request",
        planTitle: "Recommended shopping plan",
        planEmpty: "Describe your needs to generate a plan",
        confirmPlan: "Approve and add to cart",
        confirming: "Creating cart",
        reason: "Reason: {reason}",
        confirmTitle: "Confirmation and payment",
        confirmSubtitle: "Items are added only after confirmation",
        checkoutEmpty: "Approve a plan to create checkout",
        checkoutReady: "Checkout created",
        paymentConsent: "I consent to the selected payment method and QR generation",
        wechat: "WeChat Pay (sandbox)",
        generateQr: "Generate WeChat payment QR",
        generatingQr: "Generating QR",
        qrTitle: "WeChat sandbox payment QR",
        qrNotice: "Production WeChat Pay requires a verified merchant account.",
        completeSandbox: "Simulate scanned payment",
        paymentComplete: "Payment complete. Order {id} confirmed",
        planCreated: "A plan with {count} item(s) was generated",
      },
      catalog: {
        title: "Product catalog",
        count: "{count} products",
        search: "Search products",
        allCategories: "All categories",
        allMerchants: "All merchants",
        stock: "Stock {count}",
        add: "Add to cart",
        empty: "No matching products",
      },
      cart: {
        title: "Shopping cart",
        waiting: "No active session",
        empty: "Empty",
        addPrompt: "Add products from the catalog",
        subtotal: "Item subtotal",
        taxNote: "Tax and shipping are calculated at checkout",
        createCheckout: "Create checkout",
        buyer: "Buyer {buyerId}",
        remove: "Remove",
        decrease: "Decrease quantity",
        increase: "Increase quantity",
        open: "Open",
      },
      orders: {
        title: "Checkouts and orders",
        subtitle: "Merchant confirms payment status in real time",
        empty: "Create a checkout from the cart",
        checkout: "Checkout {id}",
        order: "Order {id}",
        itemLines: "{count} line items",
        status: "Status {status}",
        payment: "Payment {id}",
        fulfillment: "Fulfillment {status}",
        pay: "Pay",
        cancelCheckout: "Cancel order",
        cancelCheckoutConfirm: "Cancel this pending order?",
        checkoutCancelled: "Pending order cancelled",
        cancel: "Cancel order",
        cancelConfirm: "Cancel this order and issue a refund?",
        confirmed: "Confirmed",
        cancelled: "Cancelled",
        refunded: "Refunded",
        express: "Express delivery",
        standard: "Standard delivery",
      },
      events: {
        title: "Recent events",
        subtitle: "Protocol and business state changes",
        activityTitle: "OCP message trace",
        activitySubtitle: "Requests, responses, errors and business events",
        all: "All",
        response: "Responses",
        business: "Business",
        error: "Errors",
        time: "Time",
        type: "Type",
        operation: "Operation",
        summary: "Summary",
        none: "No events",
      },
      agent: {
        title: "Agent execution",
        subtitle: "Automated catalog-to-order flow",
        idle: "Ready",
        running: "Running",
        failed: "Failed",
        completed: "Completed",
        empty: "The agent has not run yet",
        jsonPlaceholder: "Select a protocol event to inspect its JSON.",
        operations: {
          capabilities: "Merchant capabilities discovered",
          "catalog.search": "Products selected from the catalog",
          "cart.create": "Shopping cart created",
          "cart.item.add": "Merchant priced the cart",
          "checkout.create": "Merchant returned the checkout total",
          "checkout.pay": "Payment completed and order confirmed",
          "order.get": "Final order state reconciled",
        },
      },
      architecture: {
        title: "OCP Catalog protocol",
        subtitle: "Discovery, query, resolve and object contracts",
        providersTitle: "Connected companies",
        providersSubtitle: "Connected through the common OCP-Catalog gateway",
        providerCount: "{count} providers",
        copy: "Copy URL",
        endpointsTitle: "HTTP mapping",
        endpointsSubtitle: "OCP 1.0 resource paths",
      },
      merchants: {
        title: "Add merchant interface",
        subtitle: "Register an external OCP-Catalog merchant",
        directoryTitle: "China merchant directory",
        directorySubtitle: "Search by name and add an interface",
        directorySearch: "Search merchant name",
        directoryEmpty: "No matching merchants",
        manualTitle: "Add Catalog manually",
        manualSubtitle: "Discover an interface from a standard URL",
        directReady: "Direct connect",
        authorizationRequired: "Authorization required",
        addDirect: "Search and connect",
        addPending: "Add pending connector",
        alreadyConnected: "Connected",
        directoryAdded: "{name} was connected",
        pendingAdded: "{name} was added as a pending connector",
        providerId: "Provider ID",
        companyName: "Company name",
        baseUrl: "Catalog base URL",
        catalogUrl: "Catalog URL",
        catalogId: "Catalog ID",
        trustTier: "Trust tier",
        add: "Add merchant",
        quickAdd: "Quick connect",
        adding: "Adding",
        listTitle: "Connected merchants",
        listSubtitle: "Providers in the common gateway",
        count: "{count} providers",
        empty: "No merchants connected",
        test: "Test connection",
        testing: "Testing",
        connected: "Connected",
        unavailable: "Unavailable",
        builtIn: "Built-in",
        external: "External",
        remove: "Remove",
        removeConfirm: "Remove merchant {name}?",
        added: "{name} was connected",
        removed: "{name} was removed",
        testSuccess: "{name} returned {count} catalog results",
        testFailed: "{name} connection test failed",
      },
      stores: {
        title: "Nearby stores",
        locationIdle: "Location not available",
        useLocation: "Use location",
        locating: "Getting location",
        locationReady: "Location ready, stores sorted by distance",
        locationDenied: "Location failed; search by store name instead",
        searchPlaceholder: "Search store or address",
        allProviders: "All merchants",
        empty: "No matching stores",
        select: "Select store",
        selected: "Selected",
        selectedTitle: "Selected store",
        selectedSubtitle: "Used for the current ordering session",
        noneSelected: "Select a store",
        distance: "About {distance} km",
        hours: "Hours {hours}",
      },
      status: {
        open: "Open",
        completed: "Completed",
        checkout: "In checkout",
        requires_payment: "Payment required",
        paid: "Paid",
        confirmed: "Confirmed",
        cancelled: "Cancelled",
        refunded: "Refunded",
        preparing: "Preparing",
        available: "Available",
      },
      toast: {
        productAdded: "Product added to cart",
        checkoutCreated: "Checkout session created",
        paymentConfirmed: "Payment succeeded. Order {id} confirmed",
        agentCompleted: "Agent completed order {id}",
        orderCancelled: "Order {id} was cancelled and refunded",
        discoveryCopied: "Discovery URL copied",
      },
    },
  };

  function getValue(source, path) {
    return path.split(".").reduce((value, key) => value && value[key], source);
  }

  function getLanguage() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANGUAGE;
    } catch (error) {
      return DEFAULT_LANGUAGE;
    }
  }

  function setLanguage(language) {
    const next = messages[language] ? language : DEFAULT_LANGUAGE;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      // Storage can be disabled in private or embedded contexts.
    }
    document.documentElement.lang = next;
    return next;
  }

  function t(key, variables = {}) {
    const language = getLanguage();
    const template =
      getValue(messages[language], key) ??
      getValue(messages[DEFAULT_LANGUAGE], key) ??
      key;
    return String(template).replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match
    );
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.dataset.i18nTitle));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
    document.title = t("app.title");
  }

  function money(cents, currency = "CNY") {
    return new Intl.NumberFormat(getLanguage(), {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format((Number(cents) || 0) / 100);
  }

  function dateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(getLanguage(), { hour12: false });
  }

  function time(value) {
    if (!value) return "--:--:--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString(getLanguage(), { hour12: false });
  }

  window.OCP_I18N = {
    apply,
    dateTime,
    getLanguage,
    money,
    setLanguage,
    t,
    time,
  };
})();
