# 智能选购与沙箱支付

## 需求理解

`POST /api/assistant/plan`

```json
{
  "requirement": "我想买汉堡和薯条，预算50元"
}
```

系统根据已接入商户的商品、品类关键词、商户名称和预算生成购物方案。规划阶段不会修改购物车。

响应类型：

```text
ShoppingAssistantPlan
```

方案包含商品、数量、商户、品类、推荐原因和总金额。

## 用户确认

`POST /api/assistant/confirm`

```json
{
  "planId": "plan_xxx",
  "confirmed": true,
  "storeId": "kfc_sh_renmin"
}
```

未提交 `confirmed: true` 时返回 `409`，不会创建购物车。确认后系统执行：

- 创建购物车
- 注册跨商户商品快照
- 加入商品
- 创建结算会话

## 支付同意与二维码

`POST /api/assistant/payment-qr`

```json
{
  "checkoutId": "checkout_xxx",
  "provider": "wechat",
  "consent": true
}
```

未提交 `consent: true` 时返回 `409`，不会生成付款信息。

生成内容包括：

- 支付意图 ID
- 支付金额和币种
- 局域网可访问的支付页面 URL
- 本地生成的可扫描 QR SVG

二维码不是调用第三方在线二维码服务生成的，商品金额、支付意图和二维码均在本地生成。

## 沙箱支付限制

当前实现是微信支付沙箱流程，用于完整演示“用户同意 → 生成二维码 → 扫码打开支付页 → 确认支付 → 订单确认”。

正式微信支付接入需要：

- 微信支付商户号
- API v3 密钥
- 商户证书和平台证书
- 应用 AppID 绑定
- 支付回调公网地址
- 商户订单号、签名和回调解密

生产接入时应保持当前页面和状态机不变，将 `create_payment_intent()` 和 `complete_payment_intent()` 替换为微信支付官方 API。
