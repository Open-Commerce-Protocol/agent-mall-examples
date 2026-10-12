/**
 * 本地实现的 OCP Schema 校验器 —— 字段与官方 @ocp-catalog/ocp-schema (Zod) 对齐。
 *
 * 为什么手写而不是装包：现场 1 小时封闭开发，npm 装包失败/网络抖动是不可接受的
 * 风险。这份校验器的目的和目标一致 —— 证明「我们的每一个响应体都符合协议规范」，
 * 而不是「我们调用了某个库」。
 *
 * 覆盖：CatalogManifest / CatalogHealth / CatalogQueryResult / ResolvableReference /
 *      WellKnownCatalogDiscovery / ObjectContractList
 */

export type Issue = { path: string; message: string };

class V {
  issues: Issue[] = [];
  constructor(private prefix = '') {}

  at(k: string) {
    return new V(this.prefix ? `${this.prefix}.${k}` : k);
  }
  idx(i: number) {
    return new V(`${this.prefix}[${i}]`);
  }
  err(msg: string) {
    this.issues.push({ path: this.prefix || '(root)', message: msg });
  }

  str(k: string, o: any, opts: { req?: boolean; const?: string; min?: number; enum?: string[]; uri?: boolean; dt?: boolean } = {}) {
    const v = o?.[k];
    if (v === undefined || v === null) {
      if (opts.req) this.at(k).err('必填字段缺失');
      return this;
    }
    if (typeof v !== 'string') return this.at(k).err(`应为 string，实际 ${typeof v}`), this;
    if (opts.const !== undefined && v !== opts.const) this.at(k).err(`应为常量 "${opts.const}"，实际 "${v}"`);
    if (opts.min !== undefined && v.length < opts.min) this.at(k).err(`长度应 >= ${opts.min}`);
    if (opts.enum && !opts.enum.includes(v)) this.at(k).err(`应为 ${opts.enum.join('|')} 之一，实际 "${v}"`);
    if (opts.uri && !/^https?:\/\//.test(v)) this.at(k).err('应为合法 URL');
    if (opts.dt && Number.isNaN(Date.parse(v))) this.at(k).err('应为合法 date-time');
    return this;
  }

  bool(k: string, o: any, req = false) {
    const v = o?.[k];
    if (v === undefined && !req) return this;
    if (typeof v !== 'boolean') this.at(k).err(`应为 boolean，实际 ${typeof v}`);
    return this;
  }

  int(k: string, o: any, opts: { req?: boolean; min?: number; max?: number } = {}) {
    const v = o?.[k];
    if (v === undefined && !opts.req) return this;
    if (!Number.isInteger(v)) return this.at(k).err(`应为 integer，实际 ${typeof v}`), this;
    if (opts.min !== undefined && v < opts.min) this.at(k).err(`应 >= ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) this.at(k).err(`应 <= ${opts.max}`);
    return this;
  }

  obj(k: string, o: any, req = false) {
    const v = o?.[k];
    if (v === undefined && !req) return null;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.at(k).err('应为 object');
      return null;
    }
    return this.at(k);
  }

  arr(k: string, o: any, opts: { req?: boolean; min?: number } = {}) {
    const v = o?.[k];
    if (v === undefined && !opts.req) return null;
    if (!Array.isArray(v)) {
      this.at(k).err('应为 array');
      return null;
    }
    if (opts.min !== undefined && v.length < opts.min) this.at(k).err(`至少 ${opts.min} 项`);
    return v;
  }
}

const OCP_VERSION = '1.0';

/** WellKnownCatalogDiscovery */
export function checkDiscovery(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'WellKnownCatalogDiscovery' });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.str('catalog_name', d, { req: true, min: 1 });
  for (const k of ['manifest_url', 'health_url', 'query_url', 'resolve_url', 'contracts_url']) {
    v.str(k, d, { req: true, uri: true });
  }
  return v.issues;
}

/** CatalogManifest —— endpoints.query/resolve 必填；>=1 query_capabilities；object_contracts 必填(可空) */
export function checkManifest(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'CatalogManifest' });
  v.str('id', d, { req: true, min: 1 });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.str('catalog_name', d, { req: true, min: 1 });
  v.str('registry_visibility', d, { enum: ['public', 'partner', 'private'] });

  const ep = v.obj('endpoints', d, true);
  if (ep) {
    for (const k of ['query', 'resolve']) {
      const e = ep.obj(k, d.endpoints, true);
      if (e) {
        e.str('url', d.endpoints[k], { req: true, uri: true });
        e.str('method', d.endpoints[k], { req: true, enum: ['GET', 'POST', 'PUT'] });
      }
    }
    for (const k of ['health', 'contracts']) {
      const e = ep.obj(k, d.endpoints);
      if (e && d.endpoints[k]) {
        e.str('url', d.endpoints[k], { req: true, uri: true });
        e.str('method', d.endpoints[k], { req: true, enum: ['GET', 'POST', 'PUT'] });
      }
    }
  }

  const caps = v.arr('query_capabilities', d, { req: true, min: 1 });
  if (caps) {
    caps.forEach((c: any, i: number) => {
      const cv = v.idx(i);
      cv.str('capability_id', c, { req: true, min: 1 });
      cv.bool('supports_explain', c);
      cv.bool('supports_resolve', c);
      const packs = cv.arr('query_packs', c);
      packs?.forEach((p: any, j: number) => {
        const pv = cv.idx(j);
        pv.str('pack_id', p, { req: true, min: 1 });
        const modes = pv.arr('query_modes', p);
        modes?.forEach((m: any, k2: number) => {
          if (!['keyword', 'filter', 'semantic', 'hybrid'].includes(m)) {
            pv.idx(k2).err(`query_mode 应为 keyword|filter|semantic|hybrid，实际 "${m}"`);
          }
        });
      });
    });
  }

  const oc = v.arr('object_contracts', d, { req: true });
  oc?.forEach((c: any, i: number) => {
    const cv = v.idx(i);
    cv.str('pack_id', c, { req: true, min: 1 });
    cv.str('object_type', c, { req: true, min: 1 });
  });

  return v.issues;
}

/** CatalogHealth */
export function checkHealth(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'CatalogHealth' });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.str('status', d, { req: true, enum: ['healthy', 'degraded', 'unhealthy'] });
  v.bool('ready', d, true);
  v.str('checked_at', d, { req: true, dt: true });
  const deps = v.arr('dependencies', d);
  deps?.forEach((dep: any, i: number) => {
    const dv = v.idx(i);
    dv.str('name', dep, { req: true, min: 1 });
    dv.str('status', dep, { req: true, enum: ['healthy', 'degraded', 'unhealthy'] });
  });
  return v.issues;
}

/** ObjectContractList */
export function checkContracts(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'ObjectContractList' });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.arr('object_contracts', d, { req: true });
  return v.issues;
}

/** CatalogQueryResult：entries[] of {entry, score, explain}；page.offset 必须为 0 */
export function checkQueryResult(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'CatalogQueryResult' });
  v.str('id', d, { req: true, min: 1 });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.str('query_pack', d, { req: true, min: 1 });
  v.str('query_mode', d, { enum: ['keyword', 'filter', 'semantic', 'hybrid'] });
  v.str('query', d, { req: true });
  v.int('result_count', d, { req: true, min: 0 });

  const page = v.obj('page', d, true);
  if (page) {
    page.int('limit', d.page, { req: true, min: 1 });
    const off = d.page?.offset;
    if (off !== 0) page.at('offset').err(`必须为 0（协议约定），实际 ${off}`);
    page.bool('has_more', d.page, true);
  }

  const entries = v.arr('entries', d, { req: true });
  if (entries) {
    if (entries.length !== d.result_count) {
      v.err(`result_count (${d.result_count}) 与 entries.length (${entries.length}) 不一致`);
    }
    entries.forEach((item: any, i: number) => {
      const iv = v.idx(i);
      iv.obj('entry', item, true);
      if (item.entry) {
        const e = iv.at('entry');
        e.str('kind', item.entry, { const: 'CatalogEntry' });
        e.str('catalog_id', item.entry, { req: true, min: 1 });
        e.str('entry_id', item.entry, { req: true, min: 1 });
        e.str('provider_id', item.entry, { req: true, min: 1 });
        e.str('object_id', item.entry, { req: true, min: 1 });
        e.str('title', item.entry, { req: true, min: 1 });
        e.obj('attributes', item.entry, true);
      }
      if (typeof item.score !== 'number') iv.err('score 应为 number');
      const ex = iv.arr('explain', item);
      ex?.forEach((s: any, j: number) => {
        if (typeof s !== 'string') iv.idx(j).err('explain 项应为 string');
      });
    });
  }
  return v.issues;
}

/** ResolvableReference：action_bindings[]、freshness、expires_at */
export function checkResolveResult(d: any): Issue[] {
  const v = new V();
  v.str('ocp_version', d, { req: true, const: OCP_VERSION });
  v.str('kind', d, { req: true, const: 'ResolvableReference' });
  v.str('id', d, { req: true, min: 1 });
  v.str('catalog_id', d, { req: true, min: 1 });
  v.str('entry_id', d, { req: true, min: 1 });
  v.str('object_id', d, { req: true, min: 1 });
  v.str('object_type', d, { req: true, min: 1 });
  v.str('provider_id', d, { req: true, min: 1 });
  v.str('title', d, { req: true, min: 1 });
  v.obj('visible_attributes', d);
  v.str('expires_at', d, { req: true, dt: true });

  const fresh = v.obj('freshness', d, true);
  if (fresh) {
    fresh.str('object_updated_at', d.freshness, { dt: true });
    fresh.str('resolved_at', d.freshness, { req: true, dt: true });
  }

  const ab = v.arr('action_bindings', d, { req: true, min: 1 });
  ab?.forEach((b: any, i: number) => {
    const bv = v.idx(i);
    bv.str('action_id', b, { req: true, min: 1 });
    bv.str('action_type', b, { req: true, enum: ['url', 'api', 'deeplink', 'qr'] });
    bv.str('label', b, { min: 1 });
    const ep = bv.obj('entrypoint', b, { req: true });
    if (ep) {
      // entrypoint 至少要有 url 或 endpoint 之一，且 method 合法
      const hasUrl = typeof b.entrypoint?.url === 'string';
      const hasEndpoint = typeof b.entrypoint?.endpoint === 'string';
      if (!hasUrl && !hasEndpoint) ep.err('entrypoint 需要 url 或 endpoint');
      if (b.entrypoint?.method && !['GET', 'POST', 'PUT'].includes(b.entrypoint.method)) {
        ep.at('method').err('method 应为 GET|POST|PUT');
      }
    }
  });
  return v.issues;
}

/** 泄漏扫描：内部字段不允许出现在任何对外响应里 */
const INTERNAL_KEYS = ['cost', 'margin', 'internal_note', 'supplier_id', 'wholesale', 'stock_alert'];

export function scanLeaks(obj: unknown, issues: Issue[] = [], path = '(root)'): Issue[] {
  if (obj === null || typeof obj !== 'object') return issues;
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    if (INTERNAL_KEYS.includes(k)) {
      issues.push({ path: `${path}.${k}`, message: `内部字段泄漏到对外响应中` });
    }
    scanLeaks(val, issues, `${path}.${k}`);
  }
  return issues;
}
