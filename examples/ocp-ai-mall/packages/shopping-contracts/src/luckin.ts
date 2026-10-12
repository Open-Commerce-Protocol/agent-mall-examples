import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';
import { luckinSelectionSchema, luckinTermsSchema, type LuckinSelection, type LuckinTerms } from './luckin-schema';
export * from './luckin-schema';

export function luckinSelectionId(raw: LuckinSelection): string {
  const { quantity: _quantity, ...identity } = luckinSelectionSchema.parse({
    store_id: raw.store_id, product_id: raw.product_id, sku_id: raw.sku_id, options: raw.options, quantity: raw.quantity,
  });
  return `line_${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`;
}
/** Only identical store/product/SKU/options merge; ordering does not affect identity. */
export function mergeLuckinSelections(raw: readonly LuckinSelection[]): LuckinSelection[] {
  const lines = new Map<string, LuckinSelection>();
  for (const item of raw) {
    const selection = luckinSelectionSchema.parse(item);
    const key = luckinSelectionId(selection);
    const previous = lines.get(key);
    lines.set(key, luckinSelectionSchema.parse({ ...selection, quantity: selection.quantity + (previous?.quantity ?? 0) }));
  }
  return [...lines.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, line]) => line);
}
export function luckinTermsHash(raw: LuckinTerms): string {
  const terms = luckinTermsSchema.parse(raw);
  for (const line of terms.items) if (line.line_id !== luckinSelectionId(line)) throw new Error('line identity mismatch');
  return createHash('sha256').update(canonicalJson({ ...terms,
    items: [...terms.items].sort((a, b) => a.line_id < b.line_id ? -1 : 1),
    adjustments: [...terms.adjustments].sort((a, b) => a.code < b.code ? -1 : 1),
  })).digest('hex');
}
