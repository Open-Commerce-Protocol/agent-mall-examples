# OCP-Catalog 1.0 适配说明

本应用在原有购物车与订单工作流之外，实现了 OCP-Catalog 的发现、查询和解析接口。Catalog 协议负责把商业对象标准化为可搜索、可解释、可实时解析的引用；支付与履约不属于 Catalog 核心，因此通过 `ActionBinding` 指向本应用的工作流。

## 标准端点

| Method | Path | Kind |
| --- | --- | --- |
| `GET` | `/.well-known/ocp-catalog` | `WellKnownCatalogDiscovery` |
| `GET` | `/ocp/manifest` | `CatalogManifest` |
| `GET` | `/ocp/health` | `CatalogHealth` |
| `GET` | `/ocp/contracts` | `ObjectContractList` |
| `POST` | `/ocp/query` | `CatalogQueryResult` |
| `POST` | `/ocp/resolve` | `ResolvableReference` |

所有标准响应均包含 `ocp_version: "1.0"`，目录响应同时带 `X-OCP-Catalog-Id` 响应头。

## 服务发现

`GET /.well-known/ocp-catalog`

返回目录标识、Manifest、健康检查、查询、解析和契约地址。

## Manifest

`GET /ocp/manifest`

Manifest 声明：

- Catalog 标识和描述
- Query Capability 与 Query Pack
- 可搜索、过滤和排序的字段引用
- Object Contract
- Federation 与信任策略

当前查询包：

```text
ocp.query.keyword.v1
```

支持的查询模式：

```text
keyword
filter
hybrid
```

## Query

`POST /ocp/query`

```json
{
  "query": "travel",
  "query_pack": "ocp.query.keyword.v1",
  "query_mode": "hybrid",
  "filters": {
    "category": "Travel",
    "min_amount": 100,
    "max_amount": 800,
    "has_image": true
  },
  "limit": 10,
  "locale": "zh-CN"
}
```

结果中的每个条目采用以下结构：

```json
{
  "entry": {
    "kind": "CatalogEntry",
    "catalog_id": "cat_ocp_supply_lab",
    "entry_id": "ocp_...",
    "provider_id": "provider_ocp_supply_lab",
    "object_id": "prod_aurora_lamp",
    "object_type": "ocp.commerce.retail.product",
    "title": "极光工作灯",
    "image_url": "http://127.0.0.1:8760/assets/aurora-lamp.svg",
    "attributes": {
      "price": {
        "currency": "CNY",
        "amount": 129.0
      },
      "availability_status": "in_stock"
    }
  },
  "score": 0.5,
  "explain": []
}
```

## Resolve

`POST /ocp/resolve`

```json
{
  "entry_id": "ocp_...",
  "purpose": "checkout",
  "live_check": true,
  "locale": "zh-CN"
}
```

返回 `ResolvableReference`，包含：

- 当前商品、价格和库存
- `live_checks`
- `access` 策略
- 时效与过期时间
- `add_to_cart` 和 `checkout` Action Bindings

Action Binding 将 Catalog 对象连接到现有工作流：

```text
add_to_cart -> /api/actions/add-to-cart
checkout    -> /api/actions/checkout
```

这样 Catalog 保持对商业对象的标准化描述，而支付、配送和订单状态继续由应用自己的工作流处理。
