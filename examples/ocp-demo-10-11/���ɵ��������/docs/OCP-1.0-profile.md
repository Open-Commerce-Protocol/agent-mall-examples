# OCP Commerce Extension 1.0

OCP-Catalog 1.0 的发现、查询和解析定义见 `OCP-CATALOG-1.0.md`。本文档描述本应用在 Catalog 之外提供的购物车、结算、支付和订单工作流，协议接口位于 `/ocp/v1`，并使用 `application/ocp+json` 作为媒体类型。

## 消息信封

成功响应：

```json
{
  "protocol": "ocp",
  "version": "1.0",
  "contentType": "application/ocp+json",
  "data": {}
}
```

错误响应：

```json
{
  "protocol": "ocp",
  "version": "1.0",
  "requestId": "req_a1b2c3",
  "error": {
    "code": "insufficient_stock",
    "message": "Only 7 units are available",
    "details": {}
  }
}
```

## 公共请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `X-OCP-Version` | 否 | 客户端协议版本，当前为 `1.0` |
| `X-OCP-Agent` | 否 | 发起请求的买家代理标识 |
| `Idempotency-Key` | 写操作建议 | 同一请求重放时返回首次结果 |
| `Content-Type` | POST/PATCH | 必须包含 `json` |

## Commerce Extension 服务发现

`GET /.well-known/ocp`

返回应用扩展资源入口、协议版本、幂等头与代理头。标准 OCP-Catalog 客户端应优先使用 `/.well-known/ocp-catalog`。

## 能力声明

`GET /ocp/v1/capabilities`

返回商户信息、支持的操作、支付方式、配送方式和币种。

## 商品目录

`GET /ocp/v1/catalog?query=portable&category=Travel`

`GET /ocp/v1/products/{product_id}`

商品价格统一使用整数最小货币单位。当前演示币种为 CNY，因此 `12900` 表示 `¥129.00`。

## 购物车

`POST /ocp/v1/carts`

```json
{
  "buyerId": "buyer_001",
  "currency": "CNY"
}
```

`POST /ocp/v1/carts/{cart_id}/items`

```json
{
  "productId": "prod_aurora_lamp",
  "quantity": 1
}
```

`PATCH /ocp/v1/carts/{cart_id}/items/{item_id}`

```json
{
  "quantity": 2
}
```

`DELETE /ocp/v1/carts/{cart_id}/items/{item_id}`

购物车只接收服务端重新计算的价格，客户端提交的金额不会进入结算模型。

## 结算

`POST /ocp/v1/checkouts`

```json
{
  "cartId": "cart_123",
  "fulfillment": "standard",
  "buyer": {
    "name": "Demo Buyer",
    "email": "buyer@example.com",
    "address": {
      "line1": "88 Commerce Road",
      "city": "Shanghai",
      "postalCode": "200000",
      "country": "CN"
    }
  }
}
```

结算响应包含商品快照、小计、配送、税费和总价。`fulfillment` 支持 `standard` 与 `express`。

## 支付与订单

`POST /ocp/v1/checkouts/{checkout_id}/pay`

```json
{
  "paymentMethodToken": "tok_demo_visa"
}
```

支付成功后，服务端在同一状态转换内扣减库存、创建支付记录、确认订单并关闭购物车。

`GET /ocp/v1/orders/{order_id}`

订单状态包含 `confirmed`。演示履约状态从 `preparing` 开始。

## 取消订单

`POST /ocp/v1/orders/{order_id}/cancel`

```json
{
  "reason": "buyer_requested"
}
```

未进入发货阶段的已确认订单可以取消。取消操作会恢复商品库存、将支付状态更新为 `refunded`、生成退款标识，并把订单和履约状态更新为 `cancelled`。重复取消同一订单不会重复回补库存。

## 错误码

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `invalid_request` | 缺少字段或字段格式错误 |
| 400 | `invalid_quantity` | 数量超出允许范围 |
| 404 | `resource_not_found` | 资源不存在 |
| 409 | `insufficient_stock` | 库存不足 |
| 409 | `cart_not_open` | 购物车已完成结算 |
| 409 | `idempotency_conflict` | 幂等键对应了不同请求 |
| 415 | `unsupported_media_type` | 请求媒体类型错误 |
