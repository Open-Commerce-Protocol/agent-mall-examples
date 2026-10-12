import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { FlowError, MallGuide, type MallProduct, type ShoppingModelClient } from '@ocp-catalog/agent-runtime';
import { LuckinMcpProbe, LuckinLiveRead, LuckinLiveCheckout } from '@ocp-catalog/luckin-adapter';
import { LuckinLiveCatalog, LuckinLiveWorkflow } from '@ocp-catalog/luckin-integration';
import { loadLuckinCredential } from '../../luckin-merchant-api/src/credentials';

/** Future geolocation implementation can supply this interface after user opt-in.
 * The MVP never invokes browser geolocation or infers a location from IP. */
export interface MallLocationProvider {
  getLocation(): Promise<{ longitude: number; latitude: number; source: 'fixed' | 'device'; label: string }>;
}
export class FixedMallLocation implements MallLocationProvider {
  async getLocation() { return { longitude: 120.15, latitude: 30.25, source: 'fixed' as const, label: '杭州 · 预设位置附近' }; }
}
type History = { role: 'user' | 'assistant'; content: string }[];
type Product = Awaited<ReturnType<LuckinLiveRead['search']>>[number];
const requestSchema = z.object({ merchant_id: z.literal('luckin'), store_id: z.string().regex(/^\d+$/), message: z.string().trim().min(1).max(1000),
  conversation_id: z.string().uuid().optional(), direct_search: z.boolean().optional() }).strict();

export class MallService {
  private readonly sessions = new Map<string, { owner: string; store: string; history: History; updated: number; products: MallProduct[] }>();
  private readonly running = new Set<string>();
  private knownStores = new Set<string>();
  private readonly catalog?: LuckinLiveCatalog;
  private readonly guide?: MallGuide;
  private readonly selections = new Map<string, { owner: string; store: string; product: Product; expires: number }>();
  constructor(readonly reader: LuckinLiveRead | undefined, readonly location: MallLocationProvider = new FixedMallLocation(), readonly checkout?: LuckinLiveWorkflow) {
    if (reader) {
      // In-process OCP boundary: both query and Resolve validate protocol objects.
      this.catalog = new LuckinLiveCatalog(reader, 'http://127.0.0.1');
      this.guide = new MallGuide([{ id: 'luckin', name: '瑞幸咖啡', search: async (storeId, query) => {
        const result = await this.catalog!.query(storeId, { query, limit: 20, query_pack: 'ocp.query.keyword.v1', query_mode: 'keyword' });
        return result.entries.map(match => match.entry.attributes['luckin.selection.v1'] as Product);
      } }]);
    }
  }
  async bootstrap(model?: ShoppingModelClient) {
    return { merchants: [{ id: 'luckin', name: '瑞幸咖啡', category: '咖啡与饮品', connected: Boolean(this.reader) }],
      location: await this.location.getLocation(), automatic_location_available: false, model: model ? { configured: true, name: model.model } : { configured: false },
      checkout_enabled: Boolean(this.checkout) && process.env.LUCKIN_NEW_ORDERS !== 'disabled', specification_editing: Boolean(this.reader), source: 'luckin_mcp' };
  }
  async stores() {
    if (!this.catalog) throw new FlowError('merchant_not_configured', '瑞幸连接尚未配置，请在项目中配置 my-coffee MCP。', 503);
    const location = await this.location.getLocation();
    const rows = await this.catalog.locations(location.longitude, location.latitude);
    this.knownStores = new Set(rows.map(row => row.store_id));
    return { stores: rows, location };
  }
  private checkStore(store: string) {
    if (!this.catalog || !this.guide) throw new FlowError('merchant_not_configured', '瑞幸连接尚未配置。', 503);
    if (!this.knownStores.has(store)) throw new FlowError('invalid_store', '请先选择当前附近门店。');
  }
  async chat(owner: string, raw: unknown, model?: ShoppingModelClient) {
    const input = requestSchema.parse(raw); this.checkStore(input.store_id);
    if (this.running.has(owner)) throw new FlowError('agent_busy', '上一条消息还在处理中，请稍候。', 429);
    const cutoff = Date.now() - 60 * 60_000;
    for (const [id, session] of this.sessions) if (session.updated < cutoff) this.sessions.delete(id);
    const id = input.conversation_id ?? crypto.randomUUID();
    let session = this.sessions.get(id);
    if (input.conversation_id && (!session || session.owner !== owner)) throw new FlowError('conversation_expired', '对话已过期，请开启新对话。', 404);
    if (session && session.store !== input.store_id) throw new FlowError('store_changed', '门店已改变，请开启新对话。');
    if (!session) {
      if (this.sessions.size >= 100) throw new FlowError('too_many_sessions', '本机对话较多，请稍后重试。', 429);
      session = { owner, store: input.store_id, history: [], updated: Date.now(), products: [] };
    }
    this.running.add(owner);
    try {
      const reply = await this.guide!.respond({ merchantId: input.merchant_id, storeId: input.store_id, message: input.message,
        history: session.history, products: session.products, model: input.direct_search ? undefined : model,
        checkoutEnabled: Boolean(this.checkout) && process.env.LUCKIN_NEW_ORDERS !== 'disabled' });
      session.history.push({ role: 'user', content: input.message }, { role: 'assistant', content: reply.text });
      session.history = session.history.slice(-12); session.updated = Date.now(); this.sessions.set(id, session);
      if (reply.products.length) session.products = reply.products;
      return { ...reply, conversation_id: id, store_id: input.store_id, merchant_id: 'luckin', checked_at: new Date().toISOString() };
    } finally { this.running.delete(owner); }
  }
  private selection(owner: string, store: string, product: Product) {
    for (const [id, entry] of this.selections) if (entry.expires < Date.now()) this.selections.delete(id);
    if (this.selections.size >= 1000) throw new FlowError('too_many_selections', '商品选择过多，请稍后重试。', 429);
    const selection_id = crypto.randomUUID();
    this.selections.set(selection_id, { owner, store, product, expires: Date.now() + 30 * 60_000 });
    return { product, selection_id, store_id: store, checkout_enabled: Boolean(this.checkout) && process.env.LUCKIN_NEW_ORDERS !== 'disabled' };
  }
  private selected(owner: string, id: string) {
    const selected = this.selections.get(id);
    if (!selected || selected.owner !== owner || selected.expires < Date.now()) throw new FlowError('selection_expired', '商品选择已过期，请重新打开商品。');
    return selected;
  }
  async detail(raw: unknown, owner = '') {
    const input = z.object({ store_id: z.string().regex(/^\d+$/), product_id: z.string().regex(/^\d+$/) }).strict().parse(raw);
    this.checkStore(input.store_id);
    const reference = await this.catalog!.resolve(input.store_id, { entry_id: input.product_id, purpose: 'view' });
    this.checkout?.invalidate(owner);
    return { ...this.selection(owner, input.store_id, reference.visible_attributes['luckin.selection.v1'] as Product), checked_at: new Date().toISOString() };
  }
  async switch(owner: string, raw: unknown) {
    const input = z.object({ selection_id: z.string().uuid(), option_id: z.string().regex(/^\d+$/), value_id: z.string().regex(/^\d+$/) }).strict().parse(raw);
    const selected = this.selected(owner, input.selection_id);
    this.checkout?.invalidate(owner);
    const product = await this.reader!.switch(selected.store, selected.product, input.option_id, input.value_id);
    return this.selection(owner, selected.store, product);
  }
  async preview(owner: string, raw: unknown) {
    if (!this.checkout || process.env.LUCKIN_NEW_ORDERS === 'disabled') throw new FlowError('checkout_disabled', '当前已暂停新订单。');
    const input = z.object({ selection_id: z.string().uuid(), quantity: z.number().int().min(1).max(20), remark: z.string().trim().max(100).default('') }).strict().parse(raw);
    const selected = this.selected(owner, input.selection_id);
    return this.checkout.quote(owner, { deptId: Number(selected.store), productList: [{ productId: Number(selected.product.product_id), skuCode: selected.product.sku_id, amount: input.quantity }] }, input.remark);
  }
  async confirm(owner: string, raw: unknown) {
    const input = z.object({ quote_id: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(raw);
    if (!this.checkout) throw new FlowError('checkout_disabled', '下单尚未配置。');
    return this.withQr(await this.checkout.confirm(owner, input.quote_id, await this.location.getLocation(), process.env.LUCKIN_NEW_ORDERS !== 'disabled'));
  }
  private async withQr(attempt: ReturnType<LuckinLiveWorkflow['list']>[number]) {
    let payment_qr_data: string | undefined;
    if (attempt.order?.need_pay !== false && attempt.order?.payment_url) {
      try { payment_qr_data = await QRCode.toDataURL(attempt.order.payment_url, { width: 300, margin: 4, errorCorrectionLevel: 'M' }); }
      catch { /* Keep the merchant QR/link and durable order even if local QR rendering fails. */ }
    }
    return { ...attempt, payment_qr_data };
  }
  async orders(owner: string) { return { orders: await Promise.all((this.checkout?.list(owner) ?? []).map(row => this.withQr(row))) }; }
  async refresh(owner: string, raw: unknown) {
    const input = z.object({ attempt_id: z.string().uuid() }).strict().parse(raw);
    if (!this.checkout) throw new FlowError('checkout_disabled', '订单查询尚未配置。');
    return this.withQr(await this.checkout.refresh(owner, input.attempt_id));
  }
}
export async function createLocalMall(root: string): Promise<MallService> {
  const path = resolve(root, '.codex/config.toml');
  if (!process.env.LUCKIN_MCP_TOKEN && !existsSync(path)) return new MallService(undefined);
  const token = await loadLuckinCredential(process.env.LUCKIN_MCP_TOKEN ? undefined : path);
  const probe = new LuckinMcpProbe(async () => token, { timeoutMs: 15000 });
  const directory = resolve(root, '.codex-tmp/luckin-live');
  mkdirSync(directory, { recursive: true });
  // One shared live ledger across preview ports / demo sessions, bound to this backend credential.
  return new MallService(new LuckinLiveRead(probe), new FixedMallLocation(), new LuckinLiveWorkflow(resolve(directory, 'orders.sqlite'),
    new LuckinLiveCheckout(probe), createHash('sha256').update(token).digest('hex')));
}
