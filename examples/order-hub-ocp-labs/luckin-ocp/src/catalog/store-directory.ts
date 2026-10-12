/**
 * 门店目录：MCP 的 queryShopList 需要经纬度，而 OCP 的 resolve/query 只认 deptId。
 * 所以在启动时（或按需）拉一次门店列表并缓存，用来按 deptId 反查门店信息。
 *
 * 这就是 OCP 里 Handshake 层（Provider → Catalog 同步）的最小等价物：
 * "把 provider 的目录同步进 catalog"，只不过这里同步的是门店维度而不是商品维度。
 */
import type { LuckinTools, Shop } from '../mcp/tools.ts';

export type StoreDirectory = {
  list: () => Shop[];
  byDeptId: (deptId: number) => Shop | undefined;
  refresh: () => Promise<Shop[]>;
  loadedAt: () => string | undefined;
};

export function createStoreDirectory(
  tools: LuckinTools,
  here: { longitude: number; latitude: number },
): StoreDirectory {
  let shops: Shop[] = [];
  let fetchedAt: string | undefined;

  const refresh = async (): Promise<Shop[]> => {
    const result = await tools.queryShopList(here);
    shops = Array.isArray(result) ? result : [];
    fetchedAt = new Date().toISOString();
    return shops;
  };

  return {
    list: () => shops,
    byDeptId: (deptId) => shops.find((s) => s.deptId === deptId),
    refresh,
    loadedAt: () => fetchedAt,
  };
}
