/**
 * 启动站点。
 *
 * 公网暴露不在这一步做：默认只绑回环，隧道客户端连的也是本机回环，
 * 所以要用隧道时直接 `npm run tunnel` 即可，无需改绑定地址。
 */
import { PLANNED_BRANDS, allBrands } from './brands/registry.ts';
import { LIMITS } from './session.ts';
import { WEB_HOST, WEB_PORT, startWeb } from './web.ts';

const { port, host } = await startWeb();

console.log('');
console.log('  多品牌点单站已启动');
console.log(`  本机访问   http://127.0.0.1:${port}  (绑定 ${host})`);
console.log('');
console.log('  品牌：');
for (const brand of allBrands()) {
  const gap = (brand.missing ?? []).length > 0 ? `　缺：${brand.missing?.join('、')}` : '';
  console.log(`    · ${brand.adapter.name.padEnd(10, '　')} [${brand.status}] ${brand.adapter.mcpUrl}${gap}`);
}
console.log(`    二期（需平台账号，协议非标准 MCP）：${PLANNED_BRANDS.map((p) => p.name).join('、')}`);
console.log('');
console.log('  访客可自助接入：网站上「接入新品牌」贴 MCP 地址 + token，保存后热重载、无需重启。');
console.log(`  金额护栏：单笔上限 ¥${LIMITS.maxOrderAmount}　单会话累计上限 ¥${LIMITS.maxSessionSpend}`);
console.log(`  对话限流：${LIMITS.chatPerMinute}/分钟　${LIMITS.chatPerSession}/会话`);
console.log(`  确认单有效期 ${Math.round(LIMITS.confirmTtlMs / 1000)}s　会话闲置 ${Math.round(LIMITS.sessionTtlMs / 60000)}min 回收`);
console.log('');
console.log('  公网访问（出站隧道，无需公网 IP / 管理员权限）：');
console.log(`    npm run tunnel      # ssh -R 80:127.0.0.1:${port} nokey@localhost.run`);
console.log('');
