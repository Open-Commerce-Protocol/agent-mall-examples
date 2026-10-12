/*
 * Content-based coffee recommendations. Signals come from official product
 * fields, explicit preferences, and this browser's real behavior only.
 * No transaction requests, nutrition inference, or fabricated peer activity.
 *
 * rank(products, { preferences?, budget?, requireVerifiedOptions?, peerSignals? })
 * observe({ type: 'selected'|'paid'|'disliked', item, context?, officialStatus? })
 * A paid event requires officialStatus.source='official'|'luckin_official'|
 * 'luckin_mcp' plus an explicit paid flag/payment status. Demo events are ignored.
 * peerSignals: [{ productId, count: >=5, trusted: true, source, score: -1..1 }].
 * An envelope { count, trusted, source, items: [...] } is also accepted.
 * explain(productOrRankedItem) returns a copy of its factual reason strings.
 */
(function (root) {
  'use strict';

  const storageKey = 'one.recommendations.v1';
  const weights = { selected: 1, paid: 4, disliked: -5 };
  const maxEvents = 120;
  let cache = new WeakMap();
  const blockedIngredients = /拿铁|黄油|奶油|奶酪|奶|乳|摩卡|卡布|玛奇朵|芝士|雪顶|生椰|椰云|椰子水|椰水|椰浆|燕麦|豆乳|糖浆|焦糖|黑糖|红糖|蜂蜜|香草|果汁|果萃|果茶|橙c|橙汁|西柚|柠檬|葡萄|桃桃|蜜桃|芒果|杨梅|百香果|草莓|巧克力|可可|水果|酒精|威士忌/i;
  const noSugar = /不另外加糖|不额外加糖|不加糖|无糖|零糖|0糖|无添加糖|no added sugar|unsweetened/i;
  const iced = /冰|冷饮|iced|cold/i;
  const hot = /热|hot/i;

  function fresh() {
    return { version: 1, source: 'local_behavior', explicitPreferences: {}, events: [] };
  }

  function text(value) {
    return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  }

  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= 0 ? result : null;
  }

  function preferences(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    const enums = {
      coffeeType: ['americano', 'espresso', 'cold_brew', 'latte', 'any'],
      temperature: ['iced', 'hot', 'any'],
      sugar: ['none', 'low', 'standard', 'any']
    };
    for (const [key, options] of Object.entries(enums)) {
      if (options.includes(value[key])) result[key] = value[key];
    }
    for (const key of ['preferNew', 'pureCoffee']) {
      if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    const budget = number(value.budget);
    if (budget !== null && budget <= 10000) result.budget = budget;
    return result;
  }

  function read() {
    try {
      const stored = JSON.parse(root.localStorage.getItem(storageKey) || 'null');
      if (!stored || stored.version !== 1 || !Array.isArray(stored.events)) return fresh();
      return {
        version: 1,
        source: 'local_behavior',
        explicitPreferences: preferences(stored.explicitPreferences),
        events: stored.events.filter(event => event && Object.hasOwn(weights, event.type) &&
          typeof event.productKey === 'string' && typeof event.productName === 'string' &&
          Array.isArray(event.features) && (event.type !== 'paid' || event.verifiedPaid === true))
          .slice(-maxEvents).map(event => ({
            type: event.type, at: Number(event.at) || 0,
            productKey: event.productKey.slice(0, 200), productName: event.productName.slice(0, 120),
            features: event.features.filter(feature => typeof feature === 'string').slice(0, 8),
            ...(event.type === 'paid' ? { verifiedPaid: true } : {})
          }))
      };
    } catch (_) { return fresh(); }
  }

  let state = read();

  function save() {
    try { root.localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
  }

  function tagTexts(product) {
    const result = [];
    for (const list of [product.tags, product.productTags]) {
      if (!Array.isArray(list)) continue;
      for (const tag of list) {
        const label = text(typeof tag === 'string' ? tag : tag && (tag.tagName || tag.name || tag.text || tag.label));
        if (label) result.push(label);
      }
    }
    return result;
  }

  function optionLabel(option) {
    return text(option && (option.attributeName || option.name || option.label));
  }

  function groups(product) {
    if (!Array.isArray(product.productAttrs)) return [];
    return product.productAttrs.filter(group => group && group.canSelected !== 0 && group.canSelected !== false && group.disabled !== true)
      .map(group => ({
        name: optionLabel(group),
        available: (Array.isArray(group.productSubAttrs) ? group.productSubAttrs : [])
          .filter(option => option && option.canSelected !== 0 && option.canSelected !== false && option.disabled !== true)
          .map(option => ({ label: optionLabel(option), selected: option.selected === true || option.selected === 1 || option.isSelected === true }))
          .filter(option => option.label)
      }));
  }

  function identity(product, name) {
    if (product.productId !== undefined && product.productId !== null && String(product.productId) !== '') {
      return 'id:' + String(product.productId).slice(0, 160);
    }
    return 'name:' + name.slice(0, 160);
  }

  function facts(product) {
    const name = text(product.productName);
    const tags = tagTexts(product);
    const attrs = groups(product);
    const selected = attrs.flatMap(group => group.available.filter(option => option.selected)
      .map(option => ({ group: group.name, label: option.label })));
    const ingredientList = Array.isArray(product.ingredients) ? product.ingredients.map(text) : [text(product.ingredients)];
    const ingredientText = [name, ...tags, ...ingredientList, ...selected.map(option => option.label)]
      .join(' ').replace(/不加奶|不另外加奶|无奶|无乳|不含乳|不添加牛奶/g, '');
    const blockedIngredient = ingredientText.match(blockedIngredients)?.[0] || null;
    const hasBlockedIngredient = Boolean(blockedIngredient);
    const description = [name, ...tags, ...selected.map(option => option.label)].join(' ').toLowerCase();
    let coffeeType = 'unknown';
    if (/拿铁|latte/i.test(description)) coffeeType = 'latte';
    else if (/美式|americano|long black/i.test(description)) coffeeType = 'americano';
    else if (/冷萃|cold brew/i.test(description)) coffeeType = 'cold_brew';
    else if (/浓缩|espresso/i.test(description)) coffeeType = 'espresso';
    else if (/黑咖啡|纯咖啡|手冲|滴滤|black coffee|pure coffee/i.test(description)) coffeeType = 'coffee_other';
    const pureCoffee = !hasBlockedIngredient && coffeeType !== 'unknown' && coffeeType !== 'latte';
    const tempGroup = attrs.find(group => /温度|冷热|temperature/i.test(group.name));
    const sugarGroup = attrs.find(group => /糖|甜度|sweetness|sugar/i.test(group.name));
    const selectedTemp = tempGroup && tempGroup.available.find(option => option.selected);
    const selectedSugar = sugarGroup && sugarGroup.available.find(option => option.selected);
    const canIced = tempGroup ? tempGroup.available.some(option => iced.test(option.label) && !hot.test(option.label)) : (iced.test(name) ? true : null);
    const canHot = tempGroup ? tempGroup.available.some(option => hot.test(option.label)) : (hot.test(name) ? true : null);
    const noneOption = sugarGroup && sugarGroup.available.find(option => noSugar.test(option.label));
    const canNoAddedSugar = sugarGroup ? Boolean(noneOption) : (noSugar.test([name, ...tags].join(' ')) ? true : null);
    const isNew = tags.some(tag => !/非新品|不是新品|旧款|非新/i.test(tag) && (/新品|上新|新上市/i.test(tag) || /^(新|new)$/i.test(tag)));
    return {
      name, key: identity(product, name), tags, attrs, coffeeType, pureCoffee,
      hasBlockedIngredient, blockedIngredient, isNew, canIced, canHot, canNoAddedSugar,
      noneLabel: noneOption ? noneOption.label : null,
      selectedTemperature: selectedTemp ? (hot.test(selectedTemp.label) ? 'hot' : iced.test(selectedTemp.label) ? 'iced' : null) : null,
      selectedTemperatureLabel: selectedTemp ? selectedTemp.label : null,
      selectedSugar: selectedSugar ? (noSugar.test(selectedSugar.label) ? 'none' : 'other') : null,
      selectedSugarLabel: selectedSugar ? selectedSugar.label : null,
      price: number(product.estimatePrice ?? product.discountPrice ?? product.price),
      distance: number(product.distance)
    };
  }

  function features(item) {
    const result = [];
    if (item.coffeeType !== 'unknown') result.push('coffeeType:' + item.coffeeType);
    if (item.pureCoffee) result.push('pureCoffee:true');
    if (item.selectedTemperature) result.push('temperature:' + item.selectedTemperature);
    if (item.selectedSugar === 'none') result.push('sugar:none');
    if (item.isNew) result.push('new:true');
    return result;
  }

  function behavior() {
    const result = { byItem: new Map(), byFeature: new Map() };
    for (const event of state.events) {
      const item = result.byItem.get(event.productKey) || { score: 0, selected: 0, paid: 0, disliked: 0, lastType: '' };
      item.score += weights[event.type]; item[event.type]++; item.lastType = event.type;
      result.byItem.set(event.productKey, item);
      for (const feature of event.features) {
        result.byFeature.set(feature, (result.byFeature.get(feature) || 0) + weights[event.type]);
      }
    }
    return result;
  }

  function explicitPaid(status) {
    if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
    if (!['official', 'luckin_official', 'luckin_mcp'].includes(status.source)) return false;
    const labels = [status.paymentStatus, status.payStatus, status.orderStatusName, status.status]
      .map(text).filter(Boolean).join(' ');
    if (/未支付|待支付|未付款|待付款|取消|退款|unpaid|pending|cancel|refund/i.test(labels)) return false;
    return status.paid === true || status.isPaid === true ||
      /(^|\s)(PAID|PAYMENT_SUCCESS|SUCCESSFULLY_PAID)(\s|$)/i.test(labels) ||
      /已支付|已付款|支付成功|付款成功/.test(labels);
  }

  function observe(event) {
    if (!event || !Object.hasOwn(weights, event.type) || event.demo === true || event.context?.demo === true) return false;
    const product = event.item?.product || event.item || event.product;
    if (!product || typeof product !== 'object' || product.demo === true) return false;
    const item = facts(product);
    if (!item.name || /[（(]演示[）)]/.test(item.name)) return false;
    if (event.type === 'paid' && !explicitPaid(event.officialStatus)) return false;
    state.events.push({
      type: event.type, at: Date.now(), productKey: item.key, productName: item.name.slice(0, 120),
      features: features(item), ...(event.type === 'paid' ? { verifiedPaid: true } : {})
    });
    state.events = state.events.slice(-maxEvents);
    save();
    return true;
  }

  function peers(value, product) {
    if (product.productId === undefined || product.productId === null) return null;
    const envelope = value && !Array.isArray(value) ? value : {};
    const list = Array.isArray(value) ? value : Array.isArray(envelope.items) ? envelope.items : [];
    for (const signal of list) {
      if (!signal || signal.productId === undefined || signal.productId === null || String(signal.productId) !== String(product.productId)) continue;
      const count = signal.count ?? envelope.count;
      const trusted = signal.trusted ?? envelope.trusted;
      const source = text(signal.source || envelope.source);
      if (trusted !== true || !Number.isInteger(count) || count < 5 || !source) continue;
      if (!Number.isFinite(signal.score) || Math.abs(signal.score) > 1) continue;
      return { count, score: signal.score };
    }
    return null;
  }

  function rank(products, context) {
    const options = context && typeof context === 'object' ? context : {};
    const prefs = { ...state.explicitPreferences, ...preferences(options.preferences) };
    const budget = number(options.budget ?? prefs.budget);
    const signals = behavior();
    const candidates = (Array.isArray(products) ? products : [])
      .filter(product => product && typeof product === 'object' && text(product.productName))
      .map((product, index) => ({ product, item: facts(product), index }));
    const hasOtherCoffeeType = (item) => candidates.some(candidate => candidate.item.coffeeType !== item.coffeeType);
    const hasOlder = candidates.some(candidate => !candidate.item.isNew);
    const unsuitableNew = candidates.filter(candidate => candidate.item.isNew && candidate.item.hasBlockedIngredient);
    const hasPureNew = candidates.some(candidate => candidate.item.isNew && candidate.item.pureCoffee);
    const entries = candidates.map(({ product, item, index }) => {
      const reasons = [];
      const history = signals.byItem.get(item.key);
      let score = 0;
      let compatible = true;
      if (prefs.pureCoffee && !item.pureCoffee) {
        compatible = false;
        reasons.push(item.hasBlockedIngredient ? '商品信息包含奶、水果或调味成分，不符合你的纯咖啡要求。' : '官方商品信息不足以确认属于纯咖啡。');
      }
      if (prefs.sugar === 'none' && item.canNoAddedSugar === false) {
        compatible = false; reasons.push('官方可选糖度中没有不另外加糖选项。');
      }
      if (prefs.temperature === 'iced' && item.canIced === false) {
        compatible = false; reasons.push('官方返回的温度选项中没有冰饮。');
      }
      if (prefs.temperature === 'hot' && item.canHot === false) {
        compatible = false; reasons.push('官方返回的温度选项中没有热饮。');
      }
      if (options.requireVerifiedOptions && ((prefs.sugar === 'none' && item.canNoAddedSugar === null) ||
          (prefs.temperature === 'iced' && item.canIced === null) || (prefs.temperature === 'hot' && item.canHot === null))) {
        compatible = false; reasons.push('官方规格未完整返回，暂无法核实你的温度或糖度要求。');
      }
      if (history?.lastType === 'disliked') {
        compatible = false; reasons.push('你在本机已把这款标记为不喜欢。');
      }
      if (!compatible) {
        const result = { product, score: -Infinity, reasons, compatible: false };
        cache.set(product, result);
        return { ...result, index };
      }

      if (prefs.coffeeType && prefs.coffeeType !== 'any' && item.coffeeType === prefs.coffeeType) {
        score += 50;
        const labels = { americano: '美式', espresso: '浓缩咖啡', cold_brew: '冷萃', latte: '拿铁' };
        reasons.push('商品名称或官方属性明确属于' + labels[item.coffeeType] + (hasOtherCoffeeType(item) ? '，比其他咖啡类型更接近你明确的偏好。' : '，符合你明确的咖啡偏好。'));
      }
      if (prefs.pureCoffee && item.pureCoffee) {
        score += 25; reasons.push('已返回信息识别为纯黑咖啡，未发现奶、水果或糖浆成分。');
      }
      if (prefs.temperature === 'iced' && item.canIced === true) {
        score += 12;
        reasons.push(item.selectedTemperature === 'iced' ? '当前官方规格选择了冰饮。' : '官方规格可选冰饮' + (item.selectedTemperatureLabel ? '，当前为“' + item.selectedTemperatureLabel + '”，选购时需要切换。' : '，选购时需要确认温度。'));
      } else if (prefs.temperature === 'hot' && item.canHot === true) {
        score += 12; reasons.push(item.selectedTemperature === 'hot' ? '当前官方规格选择了热饮。' : '官方规格可选热饮，选购时确认温度。');
      } else if (prefs.temperature && prefs.temperature !== 'any') {
        reasons.push('官方温度规格未返回完整信息，选购前需要确认。');
      }
      if (prefs.sugar === 'none' && item.canNoAddedSugar === true) {
        score += 12;
        reasons.push(item.selectedSugar === 'none' ? '当前官方规格为“' + item.selectedSugarLabel + '”；这项选择不代表营养零糖。' :
          '官方信息支持“' + (item.noneLabel || '不另外加糖') + '”选择，选购时需要确认；这项选择不代表营养零糖。');
      } else if (prefs.sugar === 'none') {
        reasons.push('官方糖度规格未返回完整信息，选购前需要确认是否不另外加糖。');
      }
      if (prefs.preferNew && item.isNew) {
        score += 18; reasons.push('官方标签标记为新品' + (hasOlder ? '，比未标新品的候选更符合你尝新的偏好。' : '，符合你尝新的偏好。'));
      } else if (prefs.preferNew && prefs.pureCoffee && !hasPureNew && unsuitableNew.length) {
        reasons.push('本批次标新品的' + unsuitableNew.slice(0, 2).map(candidate => '“' + candidate.item.name + '”涉及' + candidate.item.blockedIngredient).join('、') + '，按你的纯咖啡要求排除。');
      }
      if (history) {
        score += Math.max(-24, Math.min(24, history.score * 3));
        if (history.paid) reasons.push('这台设备记录了这款的' + history.paid + '次官方确认支付。');
        else if (history.selected) reasons.push('你在这台设备实际选择过这款' + history.selected + '次。');
      }
      const learnedMatches = [];
      for (const feature of features(item)) {
        score += Math.max(-3, Math.min(3, (signals.byFeature.get(feature) || 0) * 0.4));
        if (!history && (signals.byFeature.get(feature) || 0) > 0) learnedMatches.push(feature);
      }
      if (learnedMatches.length) {
        const labels = { 'coffeeType:americano': '美式', 'coffeeType:espresso': '浓缩咖啡', 'coffeeType:cold_brew': '冷萃', 'coffeeType:latte': '拿铁', 'coffeeType:coffee_other': '其他黑咖啡', 'pureCoffee:true': '纯咖啡', 'temperature:iced': '冰饮', 'temperature:hot': '热饮', 'sugar:none': '不另外加糖', 'new:true': '官方新品' };
        reasons.push('你的本机真实选择记录更偏向' + learnedMatches.slice(0, 2).map(feature => labels[feature]).join('、') + '，这款具有相同商品特征。');
      }
      if (item.price !== null) {
        score -= Math.min(5, item.price * 0.05);
        if (budget !== null) {
          if (item.price <= budget) { score += 2; reasons.push('官方返回预估价 ¥' + item.price + '，在你的预算内；实付以官方报价为准。'); }
          else { score -= 2; reasons.push('官方返回预估价 ¥' + item.price + '，高于你的预算；实付以官方报价为准。'); }
        }
      }
      if (item.distance !== null) score -= Math.min(3, item.distance * 0.1);
      const peer = peers(options.peerSignals, product);
      if (peer) {
        score += peer.score * 6;
        reasons.push('使用了经验证的真实同好汇总信号（' + peer.count + '人）。');
      }
      if (!reasons.length) {
        if (item.coffeeType !== 'unknown') reasons.push('按商品名称、官方属性及标签比较这款咖啡；还没有你的本机行为记录。');
        else reasons.push('按已返回的商品信息排序；还没有足够的口味证据。');
      }
      const result = { product, score: Math.round(score * 1000) / 1000, reasons, compatible: true };
      cache.set(product, result);
      return { ...result, index };
    });
    return entries.filter(entry => entry.compatible).sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ index, ...entry }) => entry);
  }

  function getProfile() {
    const counts = { selected: 0, paid: 0, disliked: 0 };
    for (const event of state.events) counts[event.type]++;
    const learnedSignals = Object.fromEntries(behavior().byFeature);
    return JSON.parse(JSON.stringify({
      version: 1, source: 'local_behavior', scope: 'this_browser',
      explicitPreferences: state.explicitPreferences, eventCounts: counts,
      learnedSignals, history: state.events
    }));
  }

  function setExplicitPreferences(value) {
    state.explicitPreferences = { ...state.explicitPreferences, ...preferences(value) };
    save(); return getProfile();
  }

  function clear() {
    state = fresh();
    cache = new WeakMap();
    try { root.localStorage.removeItem(storageKey); } catch (_) {}
    return getProfile();
  }

  function explain(value) {
    if (value && Array.isArray(value.reasons)) return value.reasons.slice();
    const result = value && typeof value === 'object' ? cache.get(value) : null;
    return result ? result.reasons.slice() : ['尚未对这个商品完成推荐比较。'];
  }

  root.OneRecommendations = { rank, observe, getProfile, clear, setExplicitPreferences, explain };
})(window);
