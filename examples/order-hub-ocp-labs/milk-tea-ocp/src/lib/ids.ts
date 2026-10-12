/** OCP 各处的 id 都是带前缀的随机串，这里统一生成，避免散落各处。 */
import { randomUUID } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

/** 条目 id 必须是稳定的：`entry_<provider>_<sku>`，resolve 时靠它反查。 */
export const entryIdFor = (providerId: string, sku: string): string => `entry_${providerId}_${sku}`;
