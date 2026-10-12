/**
 * 站点服务：静态页面 + JSON API。
 *
 * 安全约定（贯穿本文件）：
 *   - token 只在 POST /api/session 的请求体里出现一次，存进程内存；
 *   - **任何响应都不回显 token**，日志也只打路径不打 body（见 lib/http.ts）；
 *   - 下单必须带 /api/preview 发的一次性 confirmToken 且 acknowledge=true；
 *   - 单笔与单会话都有金额上限（见 session.ts）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, html, json, startServer, type Ctx, type Handler, type OcpReply, type Route } from './lib/http.ts';
import { PLANNED_BRANDS, allBrands, findBrand, reloadBrands, type BrandDescriptor } from './brands/registry.ts';
import { BrandError, type BrandAdapter, type OrderLine } from './brands/types.ts';
import { draftSpec, guessOps, type McpTool } from './brands/onboard.ts';
import { llmConfig, runChatTurn, type BrandBrief } from './chat/service.ts';
import { createMcpClient } from './mcp/client.ts';
import {
  appendTurn,
  bindSession,
  conversationStats,
  createConversation,
  getConversation,
  recentHistory,
  sweepConversations,
} from './chat/conversation.ts';
import {
  LIMITS,
  allowChat,
  commitOrder,
  computeFingerprint,
  consumeConfirmation,
  createSession,
  dropSession,
  getSession,
  sessionStats,
  stageConfirmation,
  sweepSessions,
  type Session,
} from './session.ts';

export const WEB_PORT = Number(process.env.ORDER_HUB_PORT ?? 8080);
export const WEB_HOST = process.env.ORDER_HUB_HOST ?? '127.0.0.1';
const INDEX_FILE = fileURLToPath(new URL('../web/index.html', import.meta.url));

/* --------------------------------------------------------------- 小工具 */

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 统一把 BrandError 转成带 code 的 JSON，其余按上游故障处理。 */
const safe = (fn: (ctx: Ctx) => Promise<OcpReply> | OcpReply): Handler => async (ctx) => {
  try {
    return await fn(ctx);
  } catch (error) {
    if (error instanceof BrandError) return fail(error.code, error.message, error.status);
    return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
  }
};

function requireSession(ctx: Ctx): Session {
  const id = asString(ctx.body.sessionId);
  if (id === '') throw new BrandError('missing_session', '缺少 sessionId', 400);
  const session = getSession(id);
  if (session === undefined) {
    throw new BrandError('session_expired', '会话已过期或不存在，请重新填写 token 建立会话。', 401);
  }
  return session;
}

function adapterOf(session: Session): BrandAdapter {
  const found = findBrand(session.brandId);
  if (found === undefined) throw new BrandError('unknown_brand', `未知品牌 ${session.brandId}`, 400);
  return found.adapter;
}

function parseLines(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new BrandError('invalid_lines', 'lines 必须是非空数组', 400);
  return raw.map((item) => {
    const rec = (item ?? {}) as Record<string, unknown>;
    const productId = asNumber(rec.productId);
    const amount = asNumber(rec.amount);
    const skuCode = asString(rec.skuCode);
    if (!Number.isInteger(productId) || productId <= 0) throw new BrandError('invalid_lines', 'productId 必须是正整数', 400);
    if (!Number.isInteger(amount) || amount < 1 || amount > LIMITS.maxLineAmount) {
      throw new BrandError('invalid_lines', `amount 必须是 1..${LIMITS.maxLineAmount} 的整数`, 400);
    }
    if (skuCode === '') throw new BrandError('invalid_lines', 'skuCode 不能为空（请先选规格）', 400);
    return { productId, skuCode, amount };
  });
}

const brandPublic = (descriptor: BrandDescriptor): unknown => ({
  id: descriptor.adapter.id,
  name: descriptor.adapter.name,
  tagline: descriptor.adapter.tagline,
  mcpUrl: descriptor.adapter.mcpUrl,
  tokenHint: descriptor.adapter.tokenHint,
  requiresLocation: descriptor.adapter.requiresLocation,
  status: descriptor.status,
  statusNote: descriptor.statusNote,
  canOrder: descriptor.status === 'ready',
  missing: descriptor.missing ?? [],
});

/** 给模型与前端用的品牌简介（不含任何凭据）。 */
function brandBriefs(): BrandBrief[] {
  return allBrands().map((b) => ({
    id: b.adapter.id,
    name: b.adapter.name,
    tagline: b.adapter.tagline,
    status: b.status,
    canOrder: b.status === 'ready',
    tokenHint: b.adapter.tokenHint,
  }));
}

/**
 * 校验接入用的 MCP 地址。
 *
 * 这个端点会让**本机**去请求访客给的 URL，所以是典型 SSRF 面。只允许 https，
 * 并挡掉回环与私有网段字面量，避免被用来探测内网。
 */
function assertPublicMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrandError('invalid_url', 'MCP 地址不是合法 URL', 400);
  }
  if (url.protocol !== 'https:') throw new BrandError('https_required', '只接受 https:// 的 MCP 地址', 400);
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fd') ||
    host.startsWith('fe80');
  if (blocked) throw new BrandError('private_host_blocked', '出于 SSRF 防护，不接受回环或私有网段地址', 400);
  return url;
}

function requireConversation(ctx: Ctx) {
  const id = asString(ctx.body.conversationId);
  if (id === '') throw new BrandError('missing_conversation', '缺少 conversationId', 400);
  const conversation = getConversation(id);
  if (conversation === undefined) {
    throw new BrandError('conversation_expired', '对话已过期，请刷新页面重新开始。', 410);
  }
  return conversation;
}

/* --------------------------------------------------------------- 路由 */

export function webRoutes(): Route[] {
  return [
    { method: 'GET', path: '/', handler: () => html(readFileSync(INDEX_FILE, 'utf8')) },

    {
      method: 'GET',
      path: '/api/health',
      handler: () =>
        json({
          status: 'healthy',
          service: 'order-hub',
          brands: allBrands().length,
          limits: LIMITS,
          sessions: sessionStats(),
          checked_at: new Date().toISOString(),
        }),
    },

    {
      method: 'GET',
      path: '/api/brands',
      handler: () => json({ brands: allBrands().map(brandPublic), planned: PLANNED_BRANDS, limits: LIMITS }),
    },

    /* ---- 站内接入新品牌：探测 ---- */
    {
      method: 'POST',
      path: '/api/onboard/inspect',
      handler: safe(async (ctx) => {
        const mcpUrl = assertPublicMcpUrl(asString(ctx.body.mcpUrl).trim()).href;
        const token = asString(ctx.body.token).trim();
        const id = asString(ctx.body.id).trim();
        const name = asString(ctx.body.name).trim();
        if (token === '') throw new BrandError('missing_token', '请填写该品牌的 MCP Token', 400);
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
          throw new BrandError('invalid_id', 'id 只能是小写字母/数字/连字符，且以字母或数字开头（最长 32）', 400);
        }

        const mcp = createMcpClient({ token, url: mcpUrl, clientName: 'order-hub-onboard' });
        let init: { serverInfo?: { name?: string; version?: string }; protocolVersion?: string };
        try {
          init = (await mcp.initialize()) as typeof init;
        } catch (error) {
          throw new BrandError('token_rejected', `该 MCP 拒绝了这次握手：${error instanceof Error ? error.message : String(error)}`, 401);
        }
        const tools = (await mcp.listTools()) as McpTool[];
        const draft = draftSpec({ id, name: name === '' ? id : name, mcpUrl, tools });
        const guesses = guessOps(tools);

        return json({
          ok: true,
          serverInfo: init.serverInfo ?? null,
          protocolVersion: init.protocolVersion ?? null,
          toolCount: tools.length,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            required: t.inputSchema?.required ?? [],
            optional: Object.keys(t.inputSchema?.properties ?? {}).filter((k) => !(t.inputSchema?.required ?? []).includes(k)),
          })),
          guesses,
          draft,
          next:
            '工具名已自动匹配。**shapes（字段路径）必须按真实响应填写**——填好之后该品牌才能查商品。' +
            '保存后品牌会立刻出现在站点上（无需重启）。',
        });
      }),
    },

    /* ---- 站内接入新品牌：保存 spec 并热重载 ---- */
    {
      method: 'POST',
      path: '/api/onboard/save',
      handler: safe(async (ctx) => {
        // 公开部署应设置 ONBOARD_TOKEN：它决定谁能往本机写 spec 文件。
        const required = process.env.ONBOARD_TOKEN ?? '';
        if (required !== '' && asString(ctx.body.onboardToken) !== required) {
          throw new BrandError('onboard_forbidden', '本部署要求提供接入口令（ONBOARD_TOKEN）才能保存新品牌。', 403);
        }

        const spec = ctx.body.spec as Record<string, unknown> | undefined;
        if (spec === undefined || typeof spec !== 'object') throw new BrandError('invalid_spec', '缺少 spec', 400);
        const id = String(spec.id ?? '');
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
          throw new BrandError('invalid_id', 'spec.id 只能是小写字母/数字/连字符（最长 32）', 400);
        }
        assertPublicMcpUrl(String(spec.mcpUrl ?? ''));
        if (typeof spec.ops !== 'object' || spec.ops === null) throw new BrandError('invalid_spec', 'spec.ops 必须是对象', 400);

        const file = join(fileURLToPath(new URL('../src/brands/specs', import.meta.url)), `${id}.json`);
        writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
        const reloaded = reloadBrands();

        return json({
          ok: true,
          savedTo: `src/brands/specs/${id}.json`,
          reloaded,
          brands: allBrands().map(brandPublic),
          notice: `已保存并热重载，当前共 ${reloaded.loaded} 个声明式品牌。`,
        });
      }),
    },

    /* 对话能力开关：让前端如实告诉访客现在是不是模型在说话。 */
    {
      method: 'GET',
      path: '/api/chat/config',
      handler: () => {
        const config = llmConfig();
        return json({
          llmEnabled: config.enabled,
          model: config.enabled ? config.model : null,
          provider: config.provider,
          mode: config.mode,
          credentialSource: config.enabled ? config.credentialSource : null,
          note: config.enabled
            ? `对话由模型驱动（${config.model} · ${config.provider} · ${config.mode} 协议），模型可查真实菜单并暂存订单，但**没有下单能力**。`
            : '未配置 LLM：当前是「基于真实菜单的关键词推荐」，不是模型对话。要启用模型，二选一：' +
              '① `CHAT_LLM_PROVIDER=dsh-account` 直接用本机 DSH 的账户额度（会读 ~/.dsh/.credentials.yaml，不经过 agent）；' +
              '② 设置 `CHAT_LLM_BASE_URL` / `CHAT_LLM_API_KEY` 指向任意 OpenAI 兼容接口。',
        });
      },
    },

    /* 新建对话：**不需要任何 token**——因为流程是"先聊天，再挑品牌"。 */
    {
      method: 'POST',
      path: '/api/conversation',
      handler: () => {
        const conversation = createConversation();
        return json({
          conversationId: conversation.id,
          brands: brandBriefs(),
          planned: PLANNED_BRANDS,
          llmEnabled: llmConfig().enabled,
          model: llmConfig().enabled ? llmConfig().model : null,
          phase: 'recommend',
          limits: LIMITS,
          notice: '这是推荐级对话：还没有品牌权限，只能聊方向。选定品牌并填入它的 token 后，我就能查真实菜单。',
        });
      },
    },

    /* 把已建好的品牌会话绑定到这段对话上——绑完之后同一段聊天就升级成品牌级。 */
    {
      method: 'POST',
      path: '/api/chat/bind',
      handler: safe(async (ctx) => {
        const conversation = requireConversation(ctx);
        const sessionId = asString(ctx.body.sessionId);
        const session = getSession(sessionId);
        if (session === undefined) throw new BrandError('session_expired', '品牌会话已过期，请重新填写 token。', 401);
        bindSession(conversation, sessionId, session.brandId);
        const descriptor = findBrand(session.brandId);
        appendTurn(conversation, 'assistant', `（已接入「${descriptor?.adapter.name ?? session.brandId}」，现在可以查真实菜单了）`);
        return json({
          conversationId: conversation.id,
          phase: 'brand',
          brandId: session.brandId,
          brandName: descriptor?.adapter.name ?? session.brandId,
          message: `已绑定品牌「${descriptor?.adapter.name ?? session.brandId}」。现在说说你想吃什么，我直接查真实菜单。`,
        });
      }),
    },

    /* 聊天：推荐 → 暂存订单。真实下单仍然只能走 /api/order 的确认门。 */
    {
      method: 'POST',
      path: '/api/chat',
      handler: safe(async (ctx) => {
        const conversation = requireConversation(ctx);
        const message = asString(ctx.body.message).trim();
        if (message === '') throw new BrandError('empty_message', '请先输入内容', 400);
        if (message.length > 500) throw new BrandError('message_too_long', '单条消息最长 500 字', 400);

        // 额度保护：接入真实 LLM 后每句话都在花钱，先过闸再花。
        const gate = allowChat(conversation);
        if (!gate.ok) {
          return json({ error: { code: 'chat_rate_limited', message: gate.message }, limits: LIMITS }, gate.status);
        }

        const history = recentHistory(conversation);
        appendTurn(conversation, 'user', message);

        const session = conversation.sessionId === undefined ? undefined : getSession(conversation.sessionId);
        if (conversation.sessionId !== undefined && session === undefined) {
          // 品牌会话过期了，对话退回推荐级，并如实告知。
          conversation.sessionId = undefined;
          conversation.brandId = undefined;
        }

        const turn = await runChatTurn(
          {
            brands: brandBriefs(),
            ...(session !== undefined ? { session, adapter: adapterOf(session) } : {}),
            history,
          },
          message,
        );
        appendTurn(conversation, 'assistant', turn.reply);

        return json({
          conversationId: conversation.id,
          ...turn,
          brands: brandBriefs(),
          bound: session !== undefined,
          brandId: session?.brandId ?? null,
          sessionId: session?.id ?? null,
          llmEnabled: llmConfig().enabled,
          sessionSpendTotal: session?.spendTotal ?? 0,
          limits: LIMITS,
          history: conversation.turns.map((t) => ({ role: t.role, text: t.text })),
        });
      }),
    },

    /* 建会话：这是 token 唯一一次进入系统的地方，建完就只存在于内存。 */
    {
      method: 'POST',
      path: '/api/session',
      handler: safe(async (ctx) => {
        const brandId = asString(ctx.body.brandId);
        const token = asString(ctx.body.token).trim();
        const descriptor = findBrand(brandId);
        if (descriptor === undefined) throw new BrandError('unknown_brand', `未知品牌「${brandId}」`, 400);
        if (token === '') throw new BrandError('missing_token', '请填写该品牌的 MCP Token', 400);

        const lat = asNumber(ctx.body.latitude);
        const lon = asNumber(ctx.body.longitude);
        const location =
          Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0
            ? { latitude: lat, longitude: lon }
            : descriptor.adapter.defaultLocation;

        const session = createSession(brandId, descriptor.adapter.mcpUrl, token, location);

        // 真的握一次手，token 无效就地报错——而不是等到下单才失败。
        try {
          const init = await session.mcp.initialize();
          return json({
            sessionId: session.id,
            brand: brandPublic(descriptor),
            location,
            serverInfo: init,
            limits: LIMITS,
            tokenFingerprint: session.tokenFingerprint,
            notice: `token 仅存于本机内存（指纹 ${session.tokenFingerprint}），不落盘、不写日志、不回显。`,
          });
        } catch (error) {
          dropSession(session.id);
          throw new BrandError(
            'token_rejected',
            `品牌 MCP 拒绝了该 token：${error instanceof Error ? error.message : String(error)}`,
            401,
          );
        }
      }),
    },

    /* 工具清单：pending 状态的品牌靠它把工具面暴露出来，以便据实完成映射。 */
    {
      method: 'POST',
      path: '/api/tools',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const tools = await adapterOf(session).inspectTools(session.mcp);
        return json({ brandId: session.brandId, count: tools.length, tools });
      }),
    },

    {
      method: 'POST',
      path: '/api/stores',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const stores = await adapterOf(session).listStores(session.mcp, session.location);
        return json({ count: stores.length, stores });
      }),
    },

    {
      method: 'POST',
      path: '/api/products',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const storeId = asNumber(ctx.body.storeId);
        if (!Number.isInteger(storeId)) throw new BrandError('invalid_store', 'storeId 必须是整数', 400);
        const products = await adapterOf(session).searchProducts(session.mcp, {
          storeId,
          query: asString(ctx.body.query),
        });
        return json({ count: products.length, products });
      }),
    },

    {
      method: 'POST',
      path: '/api/options',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const storeId = asNumber(ctx.body.storeId);
        const productId = asNumber(ctx.body.productId);
        if (!Number.isInteger(storeId) || !Number.isInteger(productId)) {
          throw new BrandError('invalid_request', 'storeId 与 productId 必须是整数', 400);
        }
        const options = await adapterOf(session).productOptions(session.mcp, { storeId, productId });
        return json({ count: options.length, options });
      }),
    },

    {
      method: 'POST',
      path: '/api/configure',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const storeId = asNumber(ctx.body.storeId);
        const productId = asNumber(ctx.body.productId);
        const skuCode = asString(ctx.body.skuCode);
        const amount = ctx.body.amount === undefined ? 1 : asNumber(ctx.body.amount);
        const rawSelections = Array.isArray(ctx.body.selections) ? ctx.body.selections : [];
        if (skuCode === '') throw new BrandError('invalid_request', 'skuCode 不能为空', 400);
        const selections = rawSelections.map((item) => {
          const rec = (item ?? {}) as Record<string, unknown>;
          const attributeId = asNumber(rec.attributeId);
          const subAttributeId = asNumber(rec.subAttributeId);
          if (!Number.isInteger(attributeId) || !Number.isInteger(subAttributeId)) {
            throw new BrandError('invalid_request', 'selections 每项需要整数 attributeId 与 subAttributeId', 400);
          }
          return { attributeId, subAttributeId };
        });
        const result = await adapterOf(session).configure(session.mcp, {
          storeId,
          productId,
          skuCode,
          amount: Number.isInteger(amount) && amount >= 1 && amount <= LIMITS.maxLineAmount ? amount : 1,
          selections,
        });
        return json({ initialSkuCode: skuCode, skuCode: result.skuCode });
      }),
    },

    /* 预览：这一步之后才有资格下单。 */
    {
      method: 'POST',
      path: '/api/preview',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const storeId = asNumber(ctx.body.storeId);
        if (!Number.isInteger(storeId)) throw new BrandError('invalid_store', 'storeId 必须是整数', 400);
        const lines = parseLines(ctx.body.lines);
        const summary = await adapterOf(session).preview(session.mcp, { storeId, lines });
        // 指纹由枢纽层统一计算，品牌适配器不必操心（声明式 spec 就更不用）。
        summary.fingerprint = computeFingerprint(session.brandId, storeId, lines, summary.couponCodes);

        const pending = stageConfirmation(session, {
          fingerprint: summary.fingerprint,
          payable: summary.pricing.payable ?? 0,
          storeId,
          lines,
        });

        const warnings: string[] = [];
        const payable = summary.pricing.payable ?? 0;
        if (payable > LIMITS.maxOrderAmount) {
          warnings.push(`本单实付 ¥${payable} 超过单笔上限 ¥${LIMITS.maxOrderAmount}，下单会被拒绝。`);
        }
        if (session.spendTotal + payable > LIMITS.maxSessionSpend) {
          warnings.push(`本会话累计 ¥${session.spendTotal}，加本单会超过会话上限 ¥${LIMITS.maxSessionSpend}，下单会被拒绝。`);
        }

        return json({
          summary,
          confirmToken: pending.confirmToken,
          expiresInMs: LIMITS.confirmTtlMs,
          sessionSpendTotal: session.spendTotal,
          limits: LIMITS,
          warnings,
          notice: '这是只读预览，未产生任何订单。下单必须带上 confirmToken 并显式确认。',
        });
      }),
    },

    /* 下单：真正的花钱动作，全部前置校验都在这里。 */
    {
      method: 'POST',
      path: '/api/order',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        const confirmToken = asString(ctx.body.confirmToken);
        const acknowledge = ctx.body.acknowledge === true;
        const decision = consumeConfirmation(session, confirmToken, acknowledge);
        if (!decision.ok) {
          return json(
            {
              error: { code: decision.code, message: decision.message },
              sessionSpendTotal: session.spendTotal,
              limits: LIMITS,
              note: '未发生任何订单，未产生任何扣款。',
            },
            decision.status,
          );
        }

        const pending = decision.pending;
        const adapter = adapterOf(session);
        const couponCodes = Array.isArray(ctx.body.couponCodes)
          ? ctx.body.couponCodes.filter((c: unknown): c is string => typeof c === 'string')
          : undefined;
        const remark = asString(ctx.body.remark) || undefined;

        // 下单前重新预览一次，若金额与确认时不一致就拒绝（价格漂移保护）。
        const fresh = await adapter.preview(session.mcp, { storeId: pending.storeId, lines: pending.lines });
        const freshPayable = fresh.pricing.payable ?? 0;
        if (Math.abs(freshPayable - pending.payable) > 0.001) {
          return json(
            {
              error: {
                code: 'price_changed',
                message: `价格与确认时不一致：你确认的是 ¥${pending.payable}，现在预览为 ¥${freshPayable}。已拒绝下单，请重新确认。`,
              },
              summary: fresh,
              note: '未发生任何订单，未产生任何扣款。',
            },
            428,
          );
        }

        const result = await adapter.createOrder(session.mcp, {
          storeId: pending.storeId,
          lines: pending.lines,
          location: session.location,
          couponCodes,
          remark,
        });
        commitOrder(session, freshPayable);

        return json(
          {
            order: result,
            summary: fresh,
            sessionSpendTotal: session.spendTotal,
            warning: '真实订单已提交，可能已产生实际扣款。',
          },
          201,
        );
      }),
    },

    /* 会话自检：只回统计，不回 token。 */
    {
      method: 'POST',
      path: '/api/session/status',
      handler: safe(async (ctx) => {
        const session = requireSession(ctx);
        return json({
          sessionId: session.id,
          brandId: session.brandId,
          tokenFingerprint: session.tokenFingerprint,
          createdAt: session.createdAt,
          orderCount: session.orderCount,
          spendTotal: session.spendTotal,
          hasPendingConfirmation: session.pending !== undefined,
          limits: LIMITS,
        });
      }),
    },
  ];
}

export async function startWeb(): Promise<{ port: number; host: string }> {
  await startServer(webRoutes(), WEB_PORT, 'order-hub', WEB_HOST);
  // 定期回收闲置会话，顺带把没人用的 token 从内存里清掉。
  setInterval(() => {
    const removed = sweepSessions();
    if (removed > 0) console.log(`[order-hub] 回收闲置会话 ${removed} 个（其 token 已从内存移除）`);
  }, 60_000).unref?.();
  return { port: WEB_PORT, host: WEB_HOST };
}
