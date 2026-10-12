/**
 * 统一启动入口。
 *
 * 抽出来是为了让 start-all / selfcheck / 演示脚本共用同一套启动逻辑，
 * 并且**端口被占用时复用已运行的实例**——这样验收脚本不必先关掉正在跑的栈。
 */
import { startOrReuse } from './lib/net.ts';
import { createMcpClient, loadToken, type McpClient } from './mcp/client.ts';
import { createLuckinTools, type LuckinTools } from './mcp/tools.ts';
import { createStoreDirectory, type StoreDirectory } from './catalog/store-directory.ts';
import { LUCKIN_CATALOG_PORT, luckinCatalogRoutes } from './catalog/luckin-catalog.ts';
import { BRIDGE_PORT, bridgeRoutes } from './bridge/bridge-node.ts';
import { REGISTRATION_PORT, startRegistrationNode } from './catalog/registration-node.ts';
import { guardState } from './bridge/guard.ts';

/** 基准坐标：杭州市中心（西湖区）。queryShopList 必须要有坐标。 */
export const HERE = { longitude: 120.1551, latitude: 30.2741 };

export type BootstrapResult = {
  client: McpClient;
  tools: LuckinTools;
  stores: StoreDirectory;
  tokenSource: string;
  serverInfo: string;
  reused: { catalog: boolean; bridge: boolean; registration: boolean };
};

export async function bootstrap(): Promise<BootstrapResult> {
  const { token, source } = loadToken();
  const client = createMcpClient({ token, clientName: 'luckin-ocp' });
  const init = await client.initialize();
  const tools = createLuckinTools(client);

  const stores = createStoreDirectory(tools, HERE);
  const shops = await stores.refresh();

  const catalog = await startOrReuse(luckinCatalogRoutes(stores, tools), LUCKIN_CATALOG_PORT, 'catalog');
  const bridge = await startOrReuse(bridgeRoutes(tools, stores), BRIDGE_PORT, 'bridge');
  const registration = await startRegistrationNode(stores);

  console.log(`[boot] MCP ${init.serverInfo.name} v${init.serverInfo.version}（协议 ${init.protocolVersion}）`);
  console.log(`[boot] 门店缓存 ${shops.length} 家（基准坐标 ${HERE.latitude},${HERE.longitude}）`);
  console.log(`[boot] Catalog 节点 :${LUCKIN_CATALOG_PORT}${catalog.reused ? '（复用）' : ''}`);
  console.log(`[boot] 桥接执行层   :${BRIDGE_PORT}${bridge.reused ? '（复用）' : ''}`);
  console.log(`[boot] Registration :${REGISTRATION_PORT}（已索引 ${registration.indexed.length} 家门店）${registration.reused ? '（复用）' : ''}`);
  for (const warning of registration.warnings) console.log(`[boot] 警告：${warning}`);

  const guard = guardState();
  console.log(
    `[boot] 下单护栏：${guard.armed ? `已武装（指纹 ${guard.expectedFingerprint}）` : '未武装 —— /create 一律 428，不会产生任何真实订单'}`,
  );

  return {
    client,
    tools,
    stores,
    tokenSource: source,
    serverInfo: `${init.serverInfo.name} v${init.serverInfo.version}`,
    reused: { catalog: catalog.reused, bridge: bridge.reused, registration: registration.reused },
  };
}
