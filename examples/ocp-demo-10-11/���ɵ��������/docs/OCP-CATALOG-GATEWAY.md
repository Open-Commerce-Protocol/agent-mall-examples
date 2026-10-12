# OCP-Catalog 多公司统一网关

统一网关复用 OCP-Catalog 的发现、查询与解析模型，让调用方通过同一组接口访问不同公司的 Catalog。

## 发现

`GET /.well-known/ocp-catalog-gateway`

返回网关 Manifest、Provider 列表、查询和解析地址。

## 连接公司

每家公司需要先实现 OCP-Catalog 标准端点：

```text
GET  /ocp/manifest
POST /ocp/query
POST /ocp/resolve
```

注册公司：

```http
POST /ocp/gateway/providers
Content-Type: application/json
```

```json
{
  "provider_id": "provider_acme",
  "company_name": "Acme Commerce",
  "catalog_id": "cat_acme",
  "base_url": "https://catalog.acme.example",
  "trust_tier": "pending"
}
```

查看已接入公司：

```http
GET /ocp/gateway/providers
```

删除外部公司：

```http
DELETE /ocp/gateway/providers/{provider_id}
```

内置演示 Provider 不能删除。
网关不能把自身根地址注册为外部 Provider，避免形成回环调用。

## 一键接入

推荐使用自动发现接口。调用方只需要提供公司的根地址、Discovery 地址或 Manifest 地址，网关会自动完成发现、字段推导、注册和连接测试：

```http
POST /ocp/gateway/providers/quick
Content-Type: application/json
```

```json
{
  "url": "https://catalog.acme.example"
}
```

支持以下三种输入：

```text
https://catalog.acme.example
https://catalog.acme.example/.well-known/ocp-catalog
https://catalog.acme.example/ocp/manifest
```

网关会自动读取 Manifest，生成：

- `provider_id`
- `company_name`
- `catalog_id`
- `manifest_id`
- `base_url`
- 连接测试结果

如果同一地址已经接入，接口会返回已有 Provider，不会重复创建。

## 中国内地商户目录

搜索内置的中国商户目录：

```http
GET /ocp/gateway/directory?query=京东&region=CN
```

按目录 ID 加入：

```http
POST /ocp/gateway/directory/add
```

```json
{
  "merchant_id": "cn_jd"
}
```

目录结果分为两类：

- `ocp_catalog`：已经实现 OCP-Catalog，可以自动发现并直接接入。
- `enterprise_connector`：需要企业开放平台授权、App Key、Secret、签名或店铺授权。加入后会创建 `authorization_required` 状态的 Connector，不会伪造可用数据。

当前目录包含瑞幸咖啡、京东、淘宝 / 天猫、拼多多、美团、抖音电商、1688、小米有品、苏宁易购和唯品会。

## 门店定位与搜索

门店网络通过统一接口查询：

```http
GET /ocp/gateway/stores
```

参数：

- `provider_ids`：逗号分隔的商户 Provider ID
- `latitude`：用户纬度
- `longitude`：用户经度
- `query`：门店名称或地址关键词
- `radius_km`：搜索半径

示例：

```text
/ocp/gateway/stores?provider_ids=provider_kfc,provider_mcdonalds&latitude=31.2304&longitude=121.4737&radius_km=20
```

返回 `FederatedStoreResult`，门店按距离由近到远排序。瑞幸通过现有门店接口读取；KFC 和麦当劳使用可替换的本地门店网络适配器。真实生产接入时，可以保持门店接口不变，将适配器替换为各品牌开放平台或企业 MCP Connector。

## 主页面聚合商城

`GET /api/marketplace`

该接口聚合所有可用商户的商品，返回：

- 商品名称、描述、价格、币种和图片
- 所属商户和 Provider ID
- 商品品类和库存
- 商户列表
- 品类列表

主页面使用该接口进行品类整理、商户筛选、关键词搜索和购物车加购。非主站商户的商品在加入购物车时会转换为统一商品快照，因此可以继续使用现有结算、支付和订单工作流。

## 跨公司查询

```http
POST /ocp/gateway/query
```

```json
{
  "query": "travel",
  "query_pack": "ocp.query.keyword.v1",
  "provider_ids": [
    "provider_ocp_supply_lab",
    "provider_northstar_gear"
  ],
  "limit": 20
}
```

不传 `provider_ids` 时查询所有已接入公司。响应类型为：

```text
FederatedCatalogQueryResult
```

响应同时返回：

- 每个 Provider 的状态、结果数量和耗时
- 合并后的 Catalog Entry
- 每条结果的 `source_provider_id`
- 网关审计标识

单个外部 Provider 不可用时采用部分结果策略，其他公司仍正常返回。

## 跨公司解析

```http
POST /ocp/gateway/resolve
```

```json
{
  "entry_id": "ocp_...",
  "provider_id": "provider_acme",
  "purpose": "checkout",
  "live_check": true
}
```

如果 `entry_id` 已经通过当前网关查询得到，网关会从结果路由表自动推断 `provider_id`，也可以显式传入。

网关只负责目录发现、查询、解析和 Action Binding 路由。支付、订单、退款与履约仍由各公司自己的工作流实现。

## 生产环境约束

当前 Provider 注册表保存在内存中，并提供可执行的 HTTP 适配器。生产部署应进一步：

- 对 `base_url` 使用允许域名白名单，防止 SSRF
- 对 Provider 做域名、签名或信任等级验证
- 将注册信息持久化到数据库
- 为注册、更新和删除接口增加管理鉴权
- 为跨公司查询设置总超时、并发上限和熔断策略
