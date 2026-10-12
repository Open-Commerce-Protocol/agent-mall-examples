/**
 * 启动全部服务。
 *
 *   4700  OCP Catalog 节点（门店维度：/stores/:deptId/...）
 *   4701  桥接执行层（持有 token；下单受护栏保护）
 *   4702  Registration 节点（把门店索引成独立 Catalog）
 *
 * 端口被占用时会复用已在运行的实例，所以这个脚本可以重复执行。
 */
import { bootstrap } from './bootstrap.ts';

await bootstrap();
console.log('[boot] 就绪。只读探测：npm run probe:mcp / npm run probe:core　一致性自检：npm run selfcheck');
