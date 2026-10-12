import { z } from 'zod';

/** Application extension, independent of the existing demo terms domain. */
export const LUCKIN_TERMS_DOMAIN = 'ocp.shopping.luckin.terms.v1';
export const LUCKIN_CONTRACT_VERSION = '1.0.0';
export const LUCKIN_WORKFLOW_ID = 'ocp.shopping.luckin.checkout.v1';
const id = z.string().trim().min(1).max(160);
const minor = z.number().int().nonnegative().max(100_000_000);
export const luckinScopeSchema = z.object({
  owner_id: id, account_id: id, environment: z.enum(['fixture', 'live']),
}).strict();
export const luckinSelectionSchema = z.object({
  store_id: id, product_id: id, sku_id: id,
  options: z.record(id, id), quantity: z.number().int().min(1).max(20),
}).strict();
export const luckinLineSchema = luckinSelectionSchema.extend({ line_id: id, unit_minor: minor }).strict();
export const luckinTermsSchema = z.object({
  v: z.literal(LUCKIN_TERMS_DOMAIN), scope: luckinScopeSchema,
  catalog_id: id, quote_id: id, store_id: id, preview_id: id,
  currency: z.literal('CNY'), fulfillment: z.literal('pickup'),
  expires_at: z.string().datetime(), items: z.array(luckinLineSchema).min(1).max(10),
  adjustments: z.array(z.object({ code: id, label: id, amount_minor: z.number().int().min(-100_000_000).max(100_000_000) }).strict()).max(50),
  total_minor: minor, budget_minor: minor,
}).strict().superRefine((terms, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (terms.items.some(line => line.store_id !== terms.store_id)) fail('cross-store basket');
  if (new Set(terms.items.map(line => line.line_id)).size !== terms.items.length) fail('duplicate line_id');
  if (new Set(terms.adjustments.map(fee => fee.code)).size !== terms.adjustments.length) fail('duplicate adjustment');
  if (terms.items.reduce((n, line) => n + line.quantity, 0) > 20) fail('too many cups');
  const total = terms.items.reduce((n, line) => n + line.unit_minor * line.quantity, 0)
    + terms.adjustments.reduce((n, fee) => n + fee.amount_minor, 0);
  if (total !== terms.total_minor) fail('inconsistent total');
  if (terms.total_minor > terms.budget_minor) fail('budget exceeded including fees');
});
export const luckinPaymentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixture'), label: z.literal('模拟支付，不会扣款') }).strict(),
  z.object({ type: z.literal('url'), url: z.string().url().refine(value => new URL(value).protocol === 'https:') }).strict(),
]);
export const luckinOrderSchema = z.object({
  order_id: id, store_id: id, terms_hash: z.string().regex(/^[a-f0-9]{64}$/), total_minor: minor,
  payment: z.enum(['pending', 'paid', 'failed', 'unknown']),
  fulfillment: z.enum(['pending', 'preparing', 'ready', 'completed', 'cancelled']),
  payment_action: luckinPaymentActionSchema.optional(), pickup_code: id.optional(),
}).strict().superRefine((order, ctx) => {
  if (order.payment !== 'pending' && order.payment_action) ctx.addIssue({ code: 'custom', message: 'payment action requires pending payment' });
  if (order.pickup_code && !['ready', 'completed'].includes(order.fulfillment)) ctx.addIssue({ code: 'custom', message: 'pickup code requires ready fulfillment' });
});
export const luckinQuoteRequestSchema = z.object({
  store_id: id, selections: z.array(luckinSelectionSchema).min(1).max(10), budget_minor: minor,
}).strict();
export const luckinConfirmationSchema = z.object({
  quote_id: id, terms_hash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true),
}).strict();
export type LuckinScope = z.infer<typeof luckinScopeSchema>;
export type LuckinSelection = z.infer<typeof luckinSelectionSchema>;
export type LuckinTerms = z.infer<typeof luckinTermsSchema>;
export type LuckinOrder = z.infer<typeof luckinOrderSchema>;
export type LuckinQuoteRequest = z.infer<typeof luckinQuoteRequestSchema>;
export type LuckinConfirmation = z.infer<typeof luckinConfirmationSchema>;
