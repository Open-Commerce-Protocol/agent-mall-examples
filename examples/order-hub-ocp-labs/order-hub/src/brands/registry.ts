/**
 * 品牌注册表。
 *
 * 三个来源：
 *   - 内置手写适配器（luckin.ts）：需要多步状态循环的品牌；
 *   - **声明式 spec**（src/brands/specs/*.json）：加品牌 = 加一个 JSON 文件，不改代码；
 *   - 站内接入助手生成的 spec（同上，路径一致，因此可热重载）。
 *
 * 想接入一个新 MCP：
 *   网站里点「接入新品牌」贴 URL + token（推荐，任何人可自助），或
 *   `node scripts/onboard.ts --url <mcpUrl> --token <token> --id <brandId> --write`
 */
import { fileURLToPath } from 'node:url';
import { luckinAdapter } from './luckin.ts';
import { buildAdapter, loadSpecs, type BrandSpec } from './declarative.ts';
import { specReadiness } from './onboard.ts';
import type { BrandAdapter } from './types.ts';

const SPEC_DIR = fileURLToPath(new URL('./specs', import.meta.url));

export type BrandStatus = 'ready' | 'pending-token' | 'planned';

export type BrandDescriptor = {
  adapter: BrandAdapter;
  status: BrandStatus;
  /** 展示给访客的状态说明——不粉饰。 */
  statusNote: string;
  source: 'builtin' | 'spec';
  /** 该品牌还需要什么才能下单（空数组表示已可下单）。 */
  missing?: string[];
};

function describeSpec(spec: BrandSpec): BrandDescriptor {
  const readiness = specReadiness(spec);
  const missing = [
    ...readiness.missingOps.map((op) => `操作 ${op}`),
    ...(readiness.shapeGroups < 3 ? ['字段路径 shapes'] : []),
  ];
  return {
    adapter: buildAdapter(spec),
    status: readiness.ready ? 'ready' : 'pending-token',
    statusNote: readiness.ready
      ? `${spec.specNote ?? '声明式 spec 完整。'}`
      : `${spec.specNote ?? ''}${spec.specNote !== undefined ? ' ' : ''}尚缺：${missing.join('、') || '（未知）'}。` +
        '填入 token 后可以先查看它的工具清单。',
    source: 'spec',
    missing,
  };
}

const BUILTIN: BrandDescriptor = {
  adapter: luckinAdapter,
  status: 'ready',
  statusNote: '内置适配器：8 个工具逐个实测通过，全链路（门店→商品→规格→预览→下单）可用。',
  source: 'builtin',
};

let declarative: BrandDescriptor[] = [];

/** 读取 spec 目录并重建声明式品牌。启动时与站内保存 spec 后各调一次。 */
export function reloadBrands(): { loaded: number; ids: string[] } {
  declarative = loadSpecs(SPEC_DIR)
    .filter((spec) => spec.hidden !== true)
    .map(describeSpec);
  return { loaded: declarative.length, ids: declarative.map((d) => d.adapter.id) };
}
reloadBrands();

export function allBrands(): BrandDescriptor[] {
  return [BUILTIN, ...declarative];
}

export function findBrand(id: string): BrandDescriptor | undefined {
  return allBrands().find((b) => b.adapter.id === id);
}

/**
 * 二期（尚未接入）：走支付宝 AI 开放平台 / 千问，而非标准 MCP。
 * 另有一条务实路线：第三方聚合 API（如微客云）声称一家接入即覆盖 11 个连锁品牌，
 * 但那是商业 HTTP API 而不是 MCP，需要服务方账号——列出来是为了说明边界。
 */
export const PLANNED_BRANDS = [
  { name: '肯德基', via: '支付宝 AI 开放平台', note: '首批接入品牌之一，协议不是标准 MCP' },
  { name: '蜜雪冰城', via: '支付宝 AI 开放平台 / 千问', note: '支持"一句话点单"' },
  { name: '星巴克中国', via: '社区 MCP（sawzhang/starbucks-mcp-server）', note: '带 login_starbucks，需会话登录而非 Bearer token' },
  { name: '高德地图', via: '官方 MCP Server', note: '属出行/打车而非点餐，是另一类"品牌"' },
  { name: '肯德基/麦当劳/星巴克/瑞幸等 11 家', via: '第三方聚合 API（微客云）', note: '商业 HTTP API 而非 MCP，一次接入覆盖多品牌，需服务方账号' },
];
