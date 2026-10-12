'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/recommendations.js'), 'utf8');
const key = 'one.recommendations.v1';
const prefs = { coffeeType: 'americano', temperature: 'iced', sugar: 'none', preferNew: true, pureCoffee: true };

function createEngine(storage = new Map(), failStorage = false) {
  let networkCalls = 0;
  const localStorage = {
    getItem(name) { if (failStorage) throw Error('Unavailable'); return storage.get(name) ?? null; },
    setItem(name, value) { if (failStorage) throw Error('Unavailable'); storage.set(name, value); },
    removeItem(name) { if (failStorage) throw Error('Unavailable'); storage.delete(name); }
  };
  const window = { localStorage };
  vm.runInNewContext(source, { window, Date, fetch() { networkCalls++; throw Error('No requests permitted'); } });
  return { api: window.OneRecommendations, storage, networkCalls: () => networkCalls };
}

function product(productId, productName = '美式', overrides = {}) {
  return {
    productId, productName, skuCode: 'test-sku-' + productId, estimatePrice: 15, tags: [],
    productAttrs: [
      { attributeId: 4, attributeName: '温度', productSubAttrs: [
        { attributeId: 57, attributeName: '冰', selected: null, canSelected: null },
        { attributeId: 58, attributeName: '热', selected: null, canSelected: null }
      ] },
      { attributeId: 14, attributeName: '糖', productSubAttrs: [
        { attributeId: 48, attributeName: '不另外加糖', selected: null, canSelected: null },
        { attributeId: 50, attributeName: '标准糖', selected: null, canSelected: null }
      ] },
      { attributeId: 15, attributeName: '奶', productSubAttrs: [
        { attributeId: 49, attributeName: '无奶', selected: null, canSelected: null }
      ] }
    ],
    ...overrides
  };
}

function clean(value) { return JSON.parse(JSON.stringify(value)); }
function reasons(entry) { return entry.reasons.join(' '); }

test('module exposes the requested API and identifies browser behavior as its source', () => {
  const { api, networkCalls } = createEngine();
  assert.deepEqual(Object.keys(api).sort(), ['clear', 'explain', 'getProfile', 'observe', 'rank', 'setExplicitPreferences']);
  const profile = clean(api.setExplicitPreferences(prefs));
  assert.deepEqual(profile.explicitPreferences, prefs);
  assert.equal(profile.source, 'local_behavior');
  assert.equal(profile.scope, 'this_browser');
  assert.deepEqual(profile.eventCounts, { selected: 0, paid: 0, disliked: 0 });
  assert.equal(networkCalls(), 0);
});

test('explicit coffee preferences and official new tags outrank price without fixed product IDs', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const fresh = product('arbitrary-new-id', '单一产地美式', { tags: ['新品'], estimatePrice: 25 });
  const regular = product('arbitrary-regular-id', '美式', { estimatePrice: 5 });
  const coldBrew = product('arbitrary-cold-id', '冷萃咖啡', { estimatePrice: 1 });
  const result = api.rank([regular, coldBrew, fresh]);
  assert.equal(result[0].product, fresh);
  assert.equal(result[1].product, regular);
  assert.equal(result[2].product, coldBrew);
  assert.match(reasons(result[0]), /官方标签标记为新品/);
  assert.match(reasons(result[0]), /比其他咖啡类型/);
  assert.deepEqual(Object.keys(result[0]).sort(), ['compatible', 'product', 'reasons', 'score']);
  assert.equal(fresh.productName, '单一产地美式');
});

test('butter and orange new Americanos are excluded even with no-added-sugar options', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const butter = product(701, '小黄油美式（原创）', { tags: ['新品'] });
  const orange = product(702, '橙C美式(原创)', { tags: ['新品'] });
  const standard = product(2500, '美式', { skuCode: 'SP2277-03135' });
  const result = api.rank([butter, orange, standard]);
  assert.equal(result.length, 1);
  assert.equal(result[0].product, standard);
  assert.match(reasons(result[0]), /小黄油美式.*黄油.*橙C美式.*橙C/);
  assert.match(reasons(result[0]), /可选冰饮.*需要确认/);
  assert.doesNotMatch(reasons(result[0]), /当前官方规格选择了冰饮/);
  assert.match(api.explain(butter).join(' '), /不符合你的纯咖啡要求/);
});

test('milk, fruit, syrup and official selected ingredient attributes cannot pass pure-coffee constraints', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const milkAttribute = product(4, '美式');
  milkAttribute.productAttrs[2].productSubAttrs = [{ attributeName: '加奶油', selected: true }];
  const rejected = [
    product(1, '生椰拿铁'), product(2, '柠檬美式'),
    product(3, '香草美式'), milkAttribute,
    product(5, '美式', { ingredients: ['咖啡', '水', '焦糖糖浆'] })
  ];
  assert.equal(api.rank(rejected).length, 0);
  for (const item of rejected) assert.match(api.explain(item).join(' '), /不符合你的纯咖啡要求/);
});

test('newness only uses official product tags, never a title or store tag', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const titleOnly = product(1, '新品美式', { deptTags: ['新品'] });
  const notNew = product(2, '美式', { tags: ['非新品'] });
  const officiallyNew = product(3, '美式', { productTags: [{ tagName: '新品' }] });
  const result = api.rank([titleOnly, notNew, officiallyNew]);
  assert.equal(result[0].product, officiallyNew);
  assert.equal(result[1].score, result[2].score);
  assert.doesNotMatch(reasons(result[1]), /官方标签标记为新品/);
});

test('known unavailable ice and no-added-sugar options are excluded; missing options remain explicit', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const onlyHot = product(1);
  onlyHot.productAttrs[0].productSubAttrs = [{ attributeName: '热' }];
  const disabledNone = product(2);
  disabledNone.productAttrs[1].productSubAttrs[0].canSelected = false;
  const unknown = product(3, '美式', { productAttrs: [] });
  const result = api.rank([onlyHot, disabledNone, unknown]);
  assert.equal(result.length, 1);
  assert.equal(result[0].product, unknown);
  assert.match(reasons(result[0]), /温度规格未返回完整信息/);
  assert.match(reasons(result[0]), /糖度规格未返回完整信息/);
  assert.equal(api.rank([unknown], { requireVerifiedOptions: true }).length, 0);
});

test('no-added-sugar selection is never described as a nutrition zero-sugar fact', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const selected = product(1);
  selected.productAttrs[0].productSubAttrs[0].selected = true;
  selected.productAttrs[1].productSubAttrs[0].selected = true;
  const result = api.rank([selected])[0];
  assert.match(reasons(result), /当前官方规格为“不另外加糖”/);
  assert.match(reasons(result), /不代表营养零糖/);
  assert.doesNotMatch(reasons(result), /0卡|零卡|低热量|营养成分.*0/);
  assert.match(reasons(result), /当前官方规格选择了冰饮/);
});

test('budget and distance break otherwise comparable choices after explicit preferences', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const far = product(1, '美式', { estimatePrice: 15, distance: 4 });
  const nearby = product(2, '美式', { estimatePrice: 15, distance: 0.2 });
  const cheaper = product(3, '美式', { estimatePrice: 10, distance: 0.2 });
  const coldBrew = product(4, '冷萃咖啡', { estimatePrice: 1, distance: 0 });
  const result = api.rank([far, nearby, cheaper, coldBrew], { budget: 12 });
  assert.equal(result[0].product, cheaper);
  assert.equal(result[1].product, nearby);
  assert.equal(result[2].product, far);
  assert.equal(result[3].product, coldBrew);
  assert.match(reasons(result[0]), /预算内.*实付以官方报价/);
});

test('selected and official paid events have distinct weights; unpaid and demo events are rejected', () => {
  const selectedEngine = createEngine();
  const paidEngine = createEngine();
  const item = product(1);
  selectedEngine.api.setExplicitPreferences(prefs);
  paidEngine.api.setExplicitPreferences(prefs);
  assert.equal(selectedEngine.api.observe({ type: 'selected', item }), true);
  for (const status of [undefined, 'PAID', { source: 'local', paid: true },
    { source: 'official', status: '待支付', paid: true }, { source: 'official', status: '已完成' },
    { source: 'official', status: 'REFUNDED', paid: true }]) {
    assert.equal(paidEngine.api.observe({ type: 'paid', item, officialStatus: status }), false);
  }
  assert.equal(paidEngine.api.observe({ type: 'paid', item, officialStatus: { source: 'luckin_mcp', paymentStatus: 'PAID' } }), true);
  assert.equal(paidEngine.api.observe({ type: 'paid', item, officialStatus: { source: 'luckin_mcp', paymentStatus: 'PAID', orderStatusName: '已完成' } }), true);
  assert.equal(paidEngine.api.observe({ type: 'selected', item, context: { demo: true } }), false);
  assert.equal(paidEngine.api.observe({ type: 'selected', item: product(2, '美式（演示）') }), false);
  assert.ok(paidEngine.api.rank([item])[0].score > selectedEngine.api.rank([item])[0].score);
  assert.match(reasons(paidEngine.api.rank([item])[0]), /2次官方确认支付/);
  assert.equal(paidEngine.api.getProfile().eventCounts.paid, 2);
  assert.equal(paidEngine.networkCalls(), 0);
});

test('real behavior learns matching product features while retaining explicit preferences', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const observed = product(1);
  observed.productAttrs[0].productSubAttrs[0].selected = true;
  observed.productAttrs[1].productSubAttrs[0].selected = true;
  api.observe({ type: 'selected', item: { product: observed } });
  const similar = product(2);
  const result = api.rank([similar])[0];
  assert.match(reasons(result), /本机真实选择记录更偏向美式、纯咖啡/);
  assert.equal(api.getProfile().learnedSignals['temperature:iced'], 1);
  assert.equal(api.getProfile().learnedSignals['sugar:none'], 1);
  assert.deepEqual(clean(api.getProfile().explicitPreferences), prefs);
});

test('dislike removes a candidate until a later real selection changes that local feedback', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const item = product(1);
  api.observe({ type: 'disliked', item });
  assert.equal(api.rank([item]).length, 0);
  assert.match(api.explain(item).join(' '), /已把这款标记为不喜欢/);
  api.observe({ type: 'selected', item });
  assert.equal(api.rank([item]).length, 1);
  assert.deepEqual(clean(api.getProfile().eventCounts), { selected: 1, paid: 0, disliked: 1 });
});

test('behavior persists locally, profile copies are isolated, and clear preserves unrelated storage', () => {
  const storage = new Map([['unrelated-account-state', 'keep']]);
  const first = createEngine(storage).api;
  first.setExplicitPreferences(prefs);
  first.observe({ type: 'selected', item: product(1) });
  const second = createEngine(storage).api;
  assert.equal(second.getProfile().eventCounts.selected, 1);
  const copy = second.getProfile();
  copy.explicitPreferences.coffeeType = 'latte';
  copy.history[0].features.push('invented');
  assert.equal(second.getProfile().explicitPreferences.coffeeType, 'americano');
  assert.equal(second.getProfile().history[0].features.includes('invented'), false);
  const item = product(2);
  second.rank([item]);
  second.clear();
  assert.equal(storage.has(key), false);
  assert.equal(storage.get('unrelated-account-state'), 'keep');
  assert.equal(second.getProfile().history.length, 0);
  assert.match(second.explain(item).join(' '), /尚未/);
});

test('untrusted or small peer samples never produce fabricated similar-user reasons', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const item = product(1);
  const baseline = api.rank([item])[0];
  for (const signal of [
    { productId: 1, count: 4, trusted: true, source: 'verified-server', score: 1 },
    { productId: 1, count: 30, trusted: false, source: 'verified-server', score: 1 },
    { productId: 1, count: 30, trusted: true, score: 1 },
    { productId: 1, count: 30, trusted: true, source: 'verified-server', score: 5 }
  ]) {
    const result = api.rank([item], { peerSignals: [signal] })[0];
    assert.equal(result.score, baseline.score);
    assert.doesNotMatch(reasons(result), /同好|同类用户|达人/);
  }
  assert.doesNotMatch(reasons(baseline), /同好|同类用户|达人/);
  const valid = api.rank([item], { peerSignals: { count: 5, trusted: true, source: 'verified-server', items: [{ productId: 1, score: 1 }] } })[0];
  assert.equal(valid.score, baseline.score + 6);
  assert.match(reasons(valid), /经验证的真实同好汇总信号（5人）/);
  const missingId = product(undefined);
  const noId = api.rank([missingId], { peerSignals: [{ count: 5, trusted: true, source: 'verified-server', score: 1 }] })[0];
  assert.doesNotMatch(reasons(noId), /同好|同类用户/);
  assert.equal(api.getProfile().history.length, 0);
});

test('temporary ranking context does not overwrite explicit preferences or create observations', () => {
  const { api } = createEngine();
  api.setExplicitPreferences(prefs);
  const latte = product(1, '拿铁');
  const result = api.rank([latte], { preferences: { pureCoffee: false, coffeeType: 'latte' } });
  assert.equal(result.length, 1);
  assert.deepEqual(clean(api.getProfile().explicitPreferences), prefs);
  assert.equal(api.getProfile().history.length, 0);
  const explanation = api.explain(result[0]);
  explanation.push('invented');
  assert.equal(result[0].reasons.includes('invented'), false);
});

test('missing storage, malformed products and invalid stored paid records are handled safely', () => {
  const unavailable = createEngine(new Map(), true).api;
  assert.doesNotThrow(() => unavailable.setExplicitPreferences(prefs));
  assert.equal(unavailable.observe({ type: 'selected', item: product(1) }), true);
  assert.equal(unavailable.getProfile().eventCounts.selected, 1);
  assert.equal(unavailable.rank([null, {}, { productName: 45 }]).length, 0);
  assert.equal(unavailable.observe({ type: 'selected', item: {} }), false);
  const storage = new Map([[key, JSON.stringify({ version: 1, events: [
    { type: 'paid', productKey: 'id:1', productName: '美式', features: [] },
    { type: 'unknown', productKey: 'id:1', productName: '美式', features: [] }
  ] })]]);
  assert.equal(createEngine(storage).api.getProfile().history.length, 0);
});

test('local history is bounded and does not store order status or transaction details', () => {
  const { api, storage } = createEngine();
  const item = product(1);
  for (let index = 0; index < 125; index++) api.observe({ type: 'selected', item });
  assert.equal(api.getProfile().history.length, 120);
  api.observe({ type: 'paid', item, officialStatus: { source: 'official', isPaid: true, orderId: 'private-order-id' } });
  assert.equal(api.getProfile().history.length, 120);
  assert.equal(storage.get(key).includes('private-order-id'), false);
  assert.equal(api.getProfile().history.at(-1).verifiedPaid, true);
});
