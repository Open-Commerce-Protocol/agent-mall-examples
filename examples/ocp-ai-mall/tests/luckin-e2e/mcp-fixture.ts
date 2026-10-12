import verified from '../../fixtures/luckin/tools-list.2026-10-11.json';

export const upstreamProduct = {
  productId: 101, productName: '合成拿铁', skuCode: 'TEST-SKU', initialPrice: 25, estimatePrice: 10.9,
  productAttrs: [{ attributeId: 17, attributeName: '温度', productSubAttrs: [
    { attributeId: 56, attributeName: '热', selected: true, canSelected: 1, price: 0 },
    { attributeId: 57, attributeName: '冰', selected: false, canSelected: 1, price: 0 },
  ] }, { attributeId: 18, attributeName: '糖度', productSubAttrs: [
    { attributeId: 69, attributeName: '不另外加糖', selected: true, canSelected: 1, price: 0 },
    { attributeId: 112, attributeName: '少甜', selected: false, canSelected: 1, price: 0 },
  ] }],
};
export function startMcpFixture() {
  const calls: { method: string; params: Record<string, unknown>; headers: Headers }[] = [];
  const behavior = { status: 200, sse: false, drift: false, textError: false, delay: 0, wrongId: false, cyclicCursor: false, businessError: false,
    price: 10.9, createError: false, createDelay: 0, orderStatus: 10, unsafeOrderId: false, previewMismatch: false, orderMismatch: false };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const rpc = await request.json() as { id?: number; method: string; params: Record<string, unknown> };
    calls.push({ method: rpc.method, params: rpc.params, headers: request.headers });
    if (behavior.delay) await Bun.sleep(behavior.delay);
    if (behavior.status !== 200) return new Response('DO NOT EXPOSE upstream-private-detail', { status: behavior.status });
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result: unknown;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1' } };
    else if (rpc.method === 'tools/list') {
      const tools = structuredClone(verified.tools);
      if (behavior.drift) (tools[0]!.inputSchema.required as string[]).push('newUnknownArgument');
      result = { tools, ...(behavior.cyclicCursor ? { nextCursor: 'repeat' } : {}) };
    } else if (rpc.method === 'tools/call') {
      const name = rpc.params.name;
      const args = rpc.params.arguments as Record<string, unknown>;
      let data: unknown;
      if (name === 'queryShopList') data = [{ deptId: 1, deptName: '合成门店', address: '合成地址', workStatus: '营业中', deptTags: ['private-personal-tag'] }];
      else if (name === 'searchProductForMcp') data = [upstreamProduct];
      else if (name === 'queryProductDetailInfo') data = upstreamProduct;
      else if (name === 'switchProduct') {
        const operation = args.attrOperationParam as { attributeId: number; subAttr: { attributeId: number } };
        const ice = operation.attributeId === 17 ? operation.subAttr.attributeId === 57 : String(args.skuCode).includes('ICE');
        const less = operation.attributeId === 18 ? operation.subAttr.attributeId === 112 : String(args.skuCode).includes('LESS');
        const switched = structuredClone(upstreamProduct); switched.skuCode = `${ice ? 'TEST-ICE' : 'TEST-SKU'}${less ? '-LESS' : ''}`;
        for (const attr of switched.productAttrs) for (const sub of attr.productSubAttrs) sub.selected = sub.attributeId === (attr.attributeId === 17 ? ice ? 57 : 56 : less ? 112 : 69);
        data = { ...switched, pictureUrl: '' };
      }
      else if (name === 'previewOrder') {
        const lines = args.productList as { productId: number; skuCode: string; amount: number }[];
        const quantity = lines.reduce((sum, line) => sum + line.amount, 0);
        data = { discountPrice: Number((behavior.price * quantity).toFixed(2)), totalInitialPrice: 25 * quantity,
          privilegeMoney: Number(((25 - behavior.price) * quantity).toFixed(2)), couponCodeList: ['private-coupon'],
          shopInfo: { deptId: behavior.previewMismatch ? 999 : args.deptId, deptName: '合成门店', address: '合成地址' },
          productInfoList: lines.map(line => ({ ...line, name: '合成拿铁', additionDesc: `大杯/${line.skuCode.includes('ICE') ? '冰' : '热'}/${line.skuCode.includes('LESS') ? '少甜' : '不另外加糖'}`, estimateTotalPrice: Number((behavior.price * line.amount).toFixed(2)) })) };
      }
      else if (name === 'createOrder') {
        if (behavior.createDelay) await Bun.sleep(behavior.createDelay);
        if (behavior.createError) return new Response('creation may already have succeeded', { status: 500 });
        const quantity = (args.productList as { amount: number }[]).reduce((sum, line) => sum + line.amount, 0);
        data = { orderId: 7639308439653908490, ...(behavior.unsafeOrderId ? {} : { orderIdStr: '7639308439653908490' }),
          needPay: true, discountPrice: Number((behavior.price * quantity).toFixed(2)), payOrderUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-only',
          payOrderQrCodeUrl: 'https://open.lkcoffee.com/transfer/qrcode?token=synthetic-only' };
      }
      else if (name === 'queryOrderDetailInfo') data = { orderId: behavior.orderMismatch ? '999' : args.orderId, orderStatus: behavior.orderStatus,
        orderStatusName: behavior.orderStatus === 10 ? '待付款' : '等待取餐', orderPayAmount: behavior.price,
        takeMealCodeInfo: { code: 'TEST-001' } };
      else return new Response('unexpected write tool', { status: 500 });
      result = { content: [{ type: 'text', text: behavior.textError ? 'private upstream business error' : JSON.stringify({ code: behavior.businessError ? 123 : 0, success: !behavior.businessError, data }) }] };
    } else return new Response('unsupported RPC', { status: 400 });
    const body = JSON.stringify({ jsonrpc: '2.0', id: behavior.wrongId ? -1 : rpc.id, result });
    return new Response(behavior.sse ? `: keepalive\r\n\r\ndata: ${body}\r\n\r\n` : body,
      { headers: { 'content-type': behavior.sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'fixture-session' } });
  } });
  return { server, endpoint: `http://127.0.0.1:${server.port}/mcp`, calls, behavior };
}
