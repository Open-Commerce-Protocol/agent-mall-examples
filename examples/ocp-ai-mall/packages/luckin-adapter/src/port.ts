import { z } from 'zod';
import type { LuckinOrder, LuckinScope, LuckinSelection, LuckinTerms } from '@ocp-catalog/shopping-contracts';

const id = z.string().min(1);
export const storeSchema = z.object({ store_id: id, name: id, address: id, open: z.boolean() }).strict();
export const productSchema = z.object({
  product_id: id, title: id, available: z.boolean(), reference_minor: z.number().int().nonnegative().nullable(),
  skus: z.array(z.object({ sku_id: id, label: id }).strict()).min(1),
  options: z.array(z.object({ option_id: id, label: id, values: z.array(z.object({ value_id: id, label: id }).strict()).min(1) }).strict()),
}).strict();
export type LuckinStore = z.infer<typeof storeSchema>;
export type LuckinProduct = z.infer<typeof productSchema>;
export interface LuckinPreview {
  preview_id: string; expires_at: string;
  items: LuckinTerms['items']; adjustments: LuckinTerms['adjustments']; total_minor: number;
}
/** Internal port, NOT asserted to be the official MCP tool schema. */
export interface LuckinPort {
  readonly environment: LuckinScope['environment'];
  readonly canFindByRequestId: boolean;
  stores(scope: LuckinScope): Promise<LuckinStore[]>;
  products(scope: LuckinScope, storeId: string): Promise<LuckinProduct[]>;
  preview(scope: LuckinScope, selections: LuckinSelection[]): Promise<LuckinPreview>;
  create(scope: LuckinScope, terms: LuckinTerms, termsHash: string, requestId: string): Promise<LuckinOrder>;
  order(scope: LuckinScope, orderId: string): Promise<LuckinOrder>;
  findByRequestId?(scope: LuckinScope, requestId: string): Promise<LuckinOrder | null>;
}
/** Only use when the verified upstream contract guarantees no order was created. */
export class LuckinRejected extends Error {
  constructor() { super('upstream explicitly rejected the order'); }
}
