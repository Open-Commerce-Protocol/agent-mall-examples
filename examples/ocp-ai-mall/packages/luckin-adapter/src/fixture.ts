import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { canonicalJson, luckinSelectionId, luckinOrderSchema, type LuckinScope, type LuckinSelection, type LuckinTerms, type LuckinOrder } from '@ocp-catalog/shopping-contracts';
import data from '../../../fixtures/luckin/menu.json';
import { productSchema, storeSchema, LuckinRejected, type LuckinPort, type LuckinPreview } from './port';

/** Durable, explicitly synthetic upstream, separate from the workflow journal. */
export class FixtureLuckinPort implements LuckinPort {
  readonly environment = 'fixture' as const;
  canFindByRequestId = true;
  loseNextCreateResponse = false;
  rejectNextCreate = false;
  readonly db: Database;
  readonly menu = data.products.map(value => productSchema.parse(value));
  readonly locations = data.stores.map(value => storeSchema.parse(value));
  constructor(path = ':memory:', private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS fixture_previews (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_orders (request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_calls (request_id TEXT NOT NULL);`);
  }
  private key(scope: LuckinScope) { if (scope.environment !== 'fixture') throw new Error('fixture scope required'); return canonicalJson(scope); }
  async stores(scope: LuckinScope) { this.key(scope); return structuredClone(this.locations); }
  async products(scope: LuckinScope, storeId: string) {
    this.key(scope);
    if (!this.locations.some(store => store.store_id === storeId && store.open)) throw new Error('fixture store closed or missing');
    return structuredClone(this.menu);
  }
  async preview(scope: LuckinScope, selections: LuckinSelection[]): Promise<LuckinPreview> {
    const items: LuckinTerms['items'] = [];
    for (const selection of selections) {
      const product = (await this.products(scope, selection.store_id)).find(product => product.product_id === selection.product_id);
      if (!product?.available || !product.skus.some(sku => sku.sku_id === selection.sku_id)) throw new Error('fixture product unavailable');
      if (Object.keys(selection.options).length !== product.options.length || product.options.some(option => !option.values.some(value => value.value_id === selection.options[option.option_id]))) throw new Error('fixture invalid options');
      items.push({ ...selection, line_id: luckinSelectionId(selection), unit_minor: selection.sku_id === 'large' ? 1800 : 1500 });
    }
    const subtotal = items.reduce((n, line) => n + line.unit_minor * line.quantity, 0);
    const preview: LuckinPreview = { preview_id: `fp_${randomUUID()}`, expires_at: new Date(this.now() + 120_000).toISOString(), items,
      adjustments: [{ code: 'fixture_discount', label: '合成优惠', amount_minor: -400 }, { code: 'fixture_fee', label: '合成服务费', amount_minor: 50 }], total_minor: subtotal - 350 };
    this.db.query('INSERT INTO fixture_previews VALUES(?,?,?)').run(preview.preview_id, this.key(scope), JSON.stringify(preview));
    return preview;
  }
  async create(scope: LuckinScope, terms: LuckinTerms, termsHash: string, requestId: string): Promise<LuckinOrder> {
    this.db.query('INSERT INTO fixture_calls VALUES(?)').run(requestId);
    const previous = await this.findByRequestId(scope, requestId);
    if (previous) return previous;
    if (this.rejectNextCreate) { this.rejectNextCreate = false; throw new LuckinRejected(); }
    const saved = this.db.query('SELECT body FROM fixture_previews WHERE id=? AND scope=?').get(terms.preview_id, this.key(scope)) as { body: string } | null;
    if (!saved) throw new LuckinRejected();
    const preview = JSON.parse(saved.body) as LuckinPreview;
    if (Date.parse(preview.expires_at) <= this.now() || preview.total_minor !== terms.total_minor || canonicalJson(preview.items) !== canonicalJson(terms.items)) throw new LuckinRejected();
    // Recheck store, stock and option choices at submission time.
    try { await this.preview(scope, terms.items); } catch { throw new LuckinRejected(); }
    const order = luckinOrderSchema.parse({ order_id: `fo_${randomUUID()}`, store_id: terms.store_id, terms_hash: termsHash,
      total_minor: terms.total_minor, payment: 'pending', fulfillment: 'pending', payment_action: { type: 'fixture', label: '模拟支付，不会扣款' } });
    this.db.query('INSERT INTO fixture_orders VALUES(?,?,?,?)').run(requestId, this.key(scope), order.order_id, JSON.stringify(order));
    if (this.loseNextCreateResponse) { this.loseNextCreateResponse = false; throw new Error('synthetic response loss after upstream commit'); }
    return order;
  }
  async order(scope: LuckinScope, orderId: string): Promise<LuckinOrder> {
    const saved = this.db.query('SELECT body FROM fixture_orders WHERE order_id=? AND scope=?').get(orderId, this.key(scope)) as { body: string } | null;
    if (!saved) throw new Error('fixture order not found');
    return luckinOrderSchema.parse(JSON.parse(saved.body));
  }
  async findByRequestId(scope: LuckinScope, requestId: string): Promise<LuckinOrder | null> {
    const saved = this.db.query('SELECT body FROM fixture_orders WHERE request_id=? AND scope=?').get(requestId, this.key(scope)) as { body: string } | null;
    return saved ? luckinOrderSchema.parse(JSON.parse(saved.body)) : null;
  }
  async advance(scope: LuckinScope, orderId: string, action: 'pay' | 'ready' | 'collect') {
    const order = await this.order(scope, orderId);
    if (action === 'pay' && order.payment === 'pending') {
      order.payment = 'paid'; order.fulfillment = 'preparing'; delete order.payment_action;
    } else if (action === 'ready' && order.payment === 'paid' && order.fulfillment === 'preparing') {
      order.fulfillment = 'ready'; order.pickup_code = 'FIXTURE-001';
    } else if (action === 'collect' && order.fulfillment === 'ready') order.fulfillment = 'completed';
    else throw new Error('invalid fixture transition');
    this.db.query('UPDATE fixture_orders SET body=? WHERE order_id=? AND scope=?').run(JSON.stringify(luckinOrderSchema.parse(order)), orderId, this.key(scope));
  }
  get createCalls(): number { return (this.db.query('SELECT COUNT(*) AS n FROM fixture_calls').get() as { n: number }).n; }
  close() { this.db.close(); }
}
