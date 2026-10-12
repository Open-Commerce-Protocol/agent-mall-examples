import { z } from 'zod';
import { LuckinMcpProbe } from './probe';

const positiveId = z.number().int().positive().safe();
const minor = (value: number | null | undefined): number | null => {
  if (value == null) return null;
  const scaled = value * 100;
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.000001) throw new Error('invalid upstream money');
  return Math.round(scaled);
};
const price = z.number().finite().nonnegative().nullable().optional();
const product = z.object({
  productId: positiveId, productName: z.string().min(1), skuCode: z.string().min(1), initialPrice: price, estimatePrice: price,
  pictureUrl: z.union([z.string().url(), z.literal('')]).nullable().optional(),
  productAttrs: z.array(z.object({ attributeId: positiveId, attributeName: z.string(), productSubAttrs: z.array(z.object({
    attributeId: positiveId, attributeName: z.string(), selected: z.boolean().nullable(), canSelected: z.number().nullable(), price,
  })) })),
});
function unwrap<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = z.object({ code: z.literal(0), success: z.literal(true), data: schema }).safeParse(raw);
  if (!result.success) throw new Error('upstream response failed validation');
  return result.data.data;
}
/** Normalized read model only. Never turns estimatePrice into a confirmed quote.
 * Its probe/session belongs to one backend credential binding, with no shared cache.
 */
export class LuckinLiveRead {
  constructor(private readonly probe: LuckinMcpProbe) {}
  async stores(longitude: number, latitude: number) {
    const rows = unwrap(z.array(z.object({ deptId: positiveId, deptName: z.string(), address: z.string(), workStatus: z.string() })),
      await this.probe.read('queryShopList', { longitude, latitude }));
    // Deliberately omit personalized tags and location coordinates from projections.
    return rows.map(row => ({ store_id: String(row.deptId), name: row.deptName, address: row.address, status: row.workStatus }));
  }
  private normalize(row: z.infer<typeof product>) {
    const image = row.pictureUrl ? new URL(row.pictureUrl) : undefined;
    const image_url = image?.protocol === 'https:' && image.hostname.endsWith('.luckincoffeecdn.com') && !image.username && !image.password
      ? `${image.origin}${image.pathname}` : undefined;
    return { product_id: String(row.productId), title: row.productName, sku_id: row.skuCode,
      ...(image_url ? { image_url } : {}),
      reference_minor: minor(row.initialPrice), estimate_minor: minor(row.estimatePrice), price_semantics: 'estimate' as const,
      options: row.productAttrs.map(attr => ({ option_id: String(attr.attributeId), label: attr.attributeName,
        values: attr.productSubAttrs.map(value => ({ value_id: String(value.attributeId), label: value.attributeName,
          selected: value.selected, selectable: value.canSelected === null ? null : value.canSelected === 1, extra_minor: minor(value.price) })) })),
    };
  }
  async search(storeId: string, query: string) {
    const rows = unwrap(z.array(product), await this.probe.read('searchProductForMcp', { deptId: positiveId.parse(Number(storeId)), query }));
    return rows.map(row => this.normalize(row));
  }
  async detail(storeId: string, productId: string) {
    const row = unwrap(product, await this.probe.read('queryProductDetailInfo', { deptId: positiveId.parse(Number(storeId)), productId: positiveId.parse(Number(productId)) }));
    if (String(row.productId) !== productId) throw new Error('upstream product identity mismatch');
    return this.normalize(row);
  }
  async switch(storeId: string, current: ReturnType<LuckinLiveRead['normalize']>, optionId: string, valueId: string) {
    const option = current.options.find(option => option.option_id === optionId);
    if (!option?.values.some(value => value.value_id === valueId && value.selectable === true)) throw new Error('unavailable option');
    const row = unwrap(product, await this.probe.checkout('switchProduct', { deptId: Number(storeId), productId: Number(current.product_id),
      skuCode: current.sku_id, amount: 1, attrOperationParam: { attributeId: Number(optionId), subAttr: { attributeId: Number(valueId), operation: 1 } } }));
    if (String(row.productId) !== current.product_id) throw new Error('upstream product identity mismatch');
    const normalized = this.normalize(row);
    if (!normalized.options.find(option => option.option_id === optionId)?.values.some(value => value.value_id === valueId && value.selected)) throw new Error('upstream selection mismatch');
    return { ...normalized, image_url: normalized.image_url ?? current.image_url };
  }
}
