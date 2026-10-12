/**
 * 启动全部节点：两家奶茶铺（4501/4502）+ 奶茶导航（4500）+ 演示面板（4600）。
 *
 * 顺序有讲究：先起两家奶茶铺，Registration 节点启动时才能真的拉到它们的
 * discovery / manifest / health。面板最后起。
 */
import { startServer } from './lib/http.ts';
import { catalogRoutes } from './nodes/catalog-node.ts';
import { startPanelNode, PANEL_PORT } from './nodes/panel-node.ts';
import { startRegistrationNode } from './nodes/registration-node.ts';
import { shanhai } from './shops/shanhai.ts';
import { shiguang } from './shops/shiguang.ts';
import type { Shop } from './shops/types.ts';

const shops: Shop[] = [shanhai, shiguang];

for (const shop of shops) {
  await startServer(catalogRoutes(shop), shop.port, shop.catalog_id);
  console.log(`[boot] ${shop.catalog_name}　 Catalog 节点 → ${shop.base_url}`);
}

const registration = await startRegistrationNode(shops);
console.log(`[boot] 奶茶导航　 Registration 节点 → http://127.0.0.1:${registration.port}`);

await startPanelNode();
console.log(`[boot] 演示面板　 → http://127.0.0.1:${PANEL_PORT}`);
console.log('[boot] 就绪。命令行演示：npm run demo　一致性自检：npm run selfcheck');
