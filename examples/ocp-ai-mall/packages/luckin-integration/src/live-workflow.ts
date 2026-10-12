import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '@ocp-catalog/shopping-contracts';
import { LuckinLiveCheckout, type LiveBasket, type LivePreview, type LiveOrder } from '@ocp-catalog/luckin-adapter';

export class LiveCheckoutError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
interface Quote { id: string; owner: string; account: string; basket: LiveBasket; preview: LivePreview; remark: string; expires: number; active: number }
interface Attempt { id: string; quote_id: string; owner: string; account: string; state: 'sending' | 'unknown' | 'created'; order?: LiveOrder; quote: Quote }
export class LuckinLiveWorkflow {
  readonly db: Database;
  private readonly preparing = new Set<string>();
  constructor(path: string, readonly upstream: LuckinLiveCheckout, private readonly account: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS live_quotes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS live_attempts (id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS live_unresolved ON live_attempts((1)) WHERE state IN ('sending','unknown');`);
    // Never reset/replay sends on startup: another local process could still own the request.
  }
  close() { this.db.close(); }
  private readQuote(owner: string, id: string): Quote {
    const row = this.db.query('SELECT body,active FROM live_quotes WHERE id=? AND owner=?').get(id, owner) as { body: string; active: number } | null;
    if (!row) throw new LiveCheckoutError('quote_missing', '订单预览不存在，请重新选择商品。', 404);
    const quote = { ...JSON.parse(row.body), active: row.active } as Quote;
    if (quote.account !== this.account) throw new LiveCheckoutError('account_changed', '瑞幸授权已变更，请使用原授权查询订单。');
    return quote;
  }
  private view(row: Attempt) {
    return { attempt_id: row.id, quote_id: row.quote_id, state: row.state, order: row.order,
      store: row.quote.preview.shopInfo.deptName, address: row.quote.preview.shopInfo.address,
      products: row.quote.preview.productInfoList.map(line => ({ title: line.name, specs: line.additionDesc, quantity: line.amount })),
      message: row.state === 'created' ? undefined : '订单提交结果尚未确认。请先到瑞幸核对订单，勿再次下单。' };
  }
  private existing(owner: string, quoteId: string): Attempt | undefined {
    const row = this.db.query('SELECT body FROM live_attempts WHERE quote_id=? AND owner=?').get(quoteId, owner) as { body: string } | null;
    return row ? JSON.parse(row.body) as Attempt : undefined;
  }
  private save(row: Attempt) {
    this.db.query('UPDATE live_attempts SET state=?,body=? WHERE id=?').run(row.state, JSON.stringify(row), row.id);
  }
  private ensureClear() {
    if (this.db.query("SELECT id FROM live_attempts WHERE state IN ('sending','unknown') LIMIT 1").get()) {
      throw new LiveCheckoutError('unresolved_order', '有一笔订单提交结果未确认，请先到瑞幸核对，当前暂停新订单。');
    }
  }
  invalidate(owner: string) { this.db.query('UPDATE live_quotes SET active=0 WHERE owner=?').run(owner); }
  async quote(owner: string, basket: LiveBasket, remark: string) {
    this.ensureClear();
    // Register the latest quote before I/O; a delayed response cannot reactivate an older quote.
    const id = randomUUID();
    this.db.transaction(() => {
      this.invalidate(owner);
      this.db.query('INSERT INTO live_quotes VALUES(?,?,?,1)').run(id, owner, '{}');
    })();
    const preview = await this.upstream.preview(basket);
    const quote: Quote = { id, owner, account: this.account, basket, preview, remark, expires: this.now() + 120_000, active: 1 };
    this.db.query('UPDATE live_quotes SET body=? WHERE id=?').run(JSON.stringify(quote), id);
    return { quote_id: id, expires_at: new Date(quote.expires).toISOString(), total_minor: preview.discountPrice,
      original_minor: preview.totalInitialPrice, discount_minor: preview.privilegeMoney, store: preview.shopInfo.deptName,
      address: preview.shopInfo.address, remark,
      products: preview.productInfoList.map(line => ({ title: line.name, specs: line.additionDesc, quantity: line.amount, total_minor: line.estimateTotalPrice })) };
  }
  async confirm(owner: string, id: string, location: { longitude: number; latitude: number }, enabled: boolean) {
    const quote = this.readQuote(owner, id);
    const existing = this.existing(owner, id);
    if (existing) return this.view(existing);
    if (!enabled) throw new LiveCheckoutError('checkout_disabled', '当前已暂停新订单。');
    if (!quote.active || quote.expires <= this.now()) throw new LiveCheckoutError('quote_expired', '订单预览已失效，请重新核对金额。');
    this.ensureClear();
    if (this.preparing.has(owner)) throw new LiveCheckoutError('checkout_busy', '正在核对订单，请稍候。');
    this.preparing.add(owner);
    try {
      const refreshed = await this.upstream.preview(quote.basket);
      if (canonicalJson(refreshed) !== canonicalJson(quote.preview)) {
        this.invalidate(owner);
        throw new LiveCheckoutError('quote_changed', '商家价格、优惠或商品信息已变化，请重新预览后确认。');
      }
      let attempt: Attempt | undefined;
      const duplicate = this.db.transaction(() => {
        const prior = this.existing(owner, id); if (prior) return prior;
        const current = this.readQuote(owner, id);
        if (!current.active || current.expires <= this.now()) throw new LiveCheckoutError('quote_expired', '订单预览已失效，请重新预览。');
        this.ensureClear();
        attempt = { id: randomUUID(), quote_id: id, owner, account: this.account, state: 'sending', quote };
        this.db.query('INSERT INTO live_attempts VALUES(?,?,?,?,?)').run(attempt.id, id, owner, attempt.state, JSON.stringify(attempt));
        return undefined;
      })();
      if (duplicate) return this.view(duplicate);
      const row = attempt!;
      try {
        row.order = await this.upstream.create({ ...quote.basket, longitude: location.longitude, latitude: location.latitude,
          couponCodeList: quote.preview.couponCodeList, ...(quote.remark ? { remark: quote.remark } : {}) });
        row.state = 'created';
      } catch { row.state = 'unknown'; }
      this.save(row);
      return this.view(row);
    } finally { this.preparing.delete(owner); }
  }
  list(owner: string) {
    const rows = this.db.query('SELECT body FROM live_attempts WHERE owner=? ORDER BY rowid DESC LIMIT 50').all(owner) as { body: string }[];
    return rows.map(row => JSON.parse(row.body) as Attempt).filter(row => row.account === this.account).map(row => this.view(row));
  }
  async refresh(owner: string, id: string) {
    const record = this.db.query('SELECT body FROM live_attempts WHERE id=? AND owner=?').get(id, owner) as { body: string } | null;
    const row = record ? JSON.parse(record.body) as Attempt : undefined;
    if (!row || row.account !== this.account) throw new LiveCheckoutError('order_missing', '订单不存在。', 404);
    if (!row.order) return this.view(row);
    const updated = await this.upstream.query(row.order.order_id);
    row.order = { ...row.order, ...updated }; this.save(row);
    return this.view(row);
  }
}
