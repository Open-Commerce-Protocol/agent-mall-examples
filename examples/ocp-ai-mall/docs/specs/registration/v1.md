# OCP Catalog Registration Protocol v1.0

## 1. 文档定位

本文档定义 **OCP Catalog Registration** 的第一版基础设计，用于描述：

- Catalog 如何向 OCP Catalog Registration node 声明自己。
- Registration node 如何发现、校验和索引 Catalog metadata。
- 用户或 Agent 如何通过 Registration node 找到可用 Catalog，并获得可保存的 route hint。

当前 wire schema 使用 `ocp.catalog.registration.v1`、`RegistrationDiscovery`、`RegistrationManifest` 和 `registration_*` 字段名。Registration node 是可替换的发现与路由辅助节点，不是中心权威。

本协议不定义 Provider 如何接入 Catalog。Provider 接入 Catalog 由 `ocp.catalog.handshake.v1` 定义。

## 2. 设计原则

OCP 是去中心化协议。Registration node 是可选的发现与路由辅助节点，不是全局中心权威。

- 任何主体都可以运行 registration node。
- Catalog 可以注册到一个或多个 registration nodes。
- Agent 或应用可以自行选择信任哪些 registration nodes。
- Registration node 只索引 Catalog metadata，不默认同步 Catalog 内部完整对象数据库。
- Catalog 自己负责对象索引、查询、权限判断和 resolve。

Registration node 的核心问题是：

```text
应该使用哪个 Catalog？
```

它不回答：

```text
应该选择哪个具体商品、服务或商业对象？
```

后一个问题属于被选中的 Catalog。

## 3. 角色边界

### 3.1 Registration Node

Registration node 是 Catalog 的 Catalog，也可以理解为 Catalog registry、Catalog discovery node 或 Catalog router。

Registration node 负责：

- 接收 Catalog registration。
- 拉取 Catalog discovery document 与 `CatalogManifest`。
- 校验 Catalog 的身份、endpoint、查询能力和对象契约摘要。
- 记录 Catalog 的健康状态、验证状态、信任等级和新鲜度。
- 对 Catalog metadata 建索引。
- 为用户或 Agent 提供 Catalog 搜索。
- 返回可被本地保存和后续调用的 `CatalogRouteHint`。

Registration node 默认不负责：

- 存储每个 Catalog 内部完整对象。
- 替代 Catalog 的私有索引引擎。
- 替代 Catalog 的 Query / Resolve 权限判断。
- 替代 Provider 的权威数据源。
- 统一全网交易、支付、履约或业务状态机。

### 3.2 Catalog Node

Catalog Node 是一个可被发现、可被查询、可声明查询能力和对象契约的节点。

Catalog Node 负责：

- 暴露 `/.well-known/ocp-catalog`。
- 暴露 `CatalogManifest`。
- 声明支持哪些 object types、descriptor contracts 和 query capabilities。
- 实现自己的索引、召回、排序、解释与权限过滤。
- 接收 Provider 对象，或通过其他方式构建自己的对象索引。
- 对外提供 `/ocp/query` 和 `/ocp/resolve`。

### 3.3 Provider

Provider 是对象来源方，例如商户、服务商、招聘方、供应商或数据平台。

Provider 通常注册到某个 Catalog Node，而不是注册到 Registration node。Registration node 只索引 Catalog 的能力与入口，不直接要求 Provider 同步对象。

### 3.4 Agent / User

Agent 或用户可以：

- 先搜索本地已保存的 Catalog profile。
- 本地没有合适 Catalog 时，再向 registration node 搜索 Catalog。
- 保存候选 Catalog 的 profile 和 route hints。
- 后续根据 Catalog 的 query capability 调用该 Catalog 的 `/ocp/query`。

## 4. 与 Handshake 协议的关系

`ocp.catalog.handshake.v1` 定义：

```text
Provider -> Catalog
```

OCP Catalog Registration 定义：

```text
Catalog -> Registration node
Agent/User -> Registration node
```

二者不能混用：

- `ProviderRegistration` 是 Provider 对 Catalog 的能力声明。
- `CatalogRegistration` 是 Catalog 对 Registration node 的注册声明。
- `CommercialObject` 是 Catalog 内部可索引对象。
- `CatalogIndexEntry` 是 Registration node 对 Catalog metadata 的本地索引投影。

## 5. 协议对象

第一版基础对象包括：

- `RegistrationDiscovery`
- `RegistrationManifest`
- `CatalogRegistration`
- `CatalogRegistrationResult`
- `CatalogProfileSnapshot`
- `CatalogIndexEntry`
- `CatalogVerificationChallenge`
- `CatalogVerificationResult`
- `CatalogHealthSnapshot`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogSearchResultItem`
- `CatalogRouteHint`

其中 `RegistrationDiscovery`、`RegistrationManifest` 和 `registration_*` 字段名属于 registration wire contract。

## 6. Endpoint 概览

Registration node 暴露：

```text
GET  /health
GET  /.well-known/ocp-registration
GET  /ocp/registration/manifest

POST /ocp/catalogs/register
GET  /ocp/catalogs/:catalogId
GET  /ocp/catalogs/:catalogId/manifest-snapshot
GET  /ocp/catalogs/:catalogId/health
POST /ocp/catalogs/:catalogId/refresh
GET  /ocp/catalogs/:catalogId/verification
POST /ocp/catalogs/:catalogId/verify
POST /ocp/catalogs/:catalogId/token/rotate

POST /ocp/catalogs/search
POST /ocp/catalogs/resolve
```

其中：

- `/ocp/catalogs/register` 用于 Catalog 注册或更新注册声明。
- `/ocp/catalogs/:catalogId/refresh` 用于触发 registration node 重新拉取 discovery / manifest / health。
- `/ocp/catalogs/:catalogId/verify` 用于执行 Catalog 身份验证。

Catalog manifest 应优先声明 `endpoints.health`。Registration node 在注册和 refresh 时优先调用该端点；如果旧 manifest 未声明 health endpoint，registration node 可以降级为 query probe。

标准 Catalog health response:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogHealth",
  "catalog_id": "cat_local_dev",
  "status": "healthy",
  "ready": true,
  "checked_at": "2026-05-17T00:00:00.000Z",
  "manifest_version": "manifest_cat_local_dev",
  "details": {},
  "dependencies": [
    {
      "name": "postgres",
      "status": "healthy"
    }
  ]
}
```

当 health 连续失败达到 registration node 配置的阈值后，Catalog 可被标记为 stale，并从默认搜索结果中移除，直到后续健康检查恢复。

Registration node 只把 `status: "healthy"` 且 `ready: true` 视为可用健康检查。`degraded` 是 Catalog 对外暴露的诊断状态，但在 registration 搜索可见性里按失败健康检查处理，避免把部分依赖不可用的 Catalog 路由给用户请求。
- `/ocp/catalogs/:catalogId/token/rotate` 用于轮换 catalog-specific token。
- `/ocp/catalogs/search` 用于搜索 Catalog metadata。
- `/ocp/catalogs/resolve` 用于把搜索结果解析成可保存的 `CatalogRouteHint`，不是解析商业对象。

Catalog Node 仍应暴露：

```text
GET  /.well-known/ocp-catalog
GET  /ocp/manifest
GET  /ocp/contracts
POST /ocp/query
POST /ocp/resolve
```

Provider 接入 Catalog Node 的 endpoint 仍属于 `ocp.catalog.handshake.v1`，不属于 Registration 协议。

## 7. Registration Discovery

Registration node 暴露：

```http
GET /.well-known/ocp-registration
```

返回 discovery document：

```json
{
  "ocp_version": "1.0",
  "kind": "RegistrationDiscovery",
  "registration_id": "registration_node_public",
  "registration_name": "Public Catalog Registration Node",
  "registration_protocol": "ocp.catalog.registration.v1",
  "registration_protocol_version": "1.0.0",
  "manifest_url": "https://registration.example.com/ocp/registration/manifest",
  "catalog_registration_url": "https://registration.example.com/ocp/catalogs/register",
  "catalog_search_url": "https://registration.example.com/ocp/catalogs/search"
}
```

## 8. Registration Manifest

Registration node 暴露：

```http
GET /ocp/registration/manifest
```

返回 manifest，用于声明 registration node 的注册、验证、搜索和治理能力：

```json
{
  "ocp_version": "1.0",
  "kind": "RegistrationManifest",
  "registration_id": "registration_node_public",
  "registration_name": "Public Catalog Registration Node",
  "supported_protocols": [
    "ocp.catalog.registration.v1",
    "ocp.catalog.handshake.v1"
  ],
  "catalog_registration": {
    "registration_modes": ["open_intake", "invite_only"],
    "default_status": "pending_verification",
    "requires_domain_verification": true,
    "requires_https": true
  },
  "catalog_search_capabilities": [
    {
      "capability_id": "registration.catalog.keyword.v1",
      "query_modes": ["keyword", "filter"],
      "filter_fields": [
        "query_pack",
        "verification_status",
        "trust_tier",
        "domain",
        "tag"
      ],
      "supports_explain": true
    }
  ]
}
```

## 9. CatalogRegistration

Catalog Node 向 registration node 注册时提交 `CatalogRegistration`。

Endpoint：

```http
POST /ocp/catalogs/register
```

最小请求：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogRegistration",
  "id": "catreg_demo_1",
  "registration_id": "registration_node_public",
  "catalog_id": "catalog_demo",
  "registration_version": 1,
  "updated_at": "2026-04-20T00:00:00.000Z",
  "homepage": "https://catalog.example.com",
  "well_known_url": "https://catalog.example.com/.well-known/ocp-catalog",
  "claimed_domains": ["catalog.example.com"],
  "intended_visibility": "public",
  "tags": ["commerce", "retail"]
}
```

字段说明：

- `registration_id`：目标 registration node 的 ID。
- `catalog_id`：Catalog Node 自己声明的稳定 ID，必须与 `CatalogManifest.catalog_id` 一致。
- `registration_version`：Catalog 对 registration node 的注册版本。
- `well_known_url`：registration node 用于拉取 Catalog discovery document 的入口。
- `claimed_domains`：Catalog 声称控制的域名集合。
- `intended_visibility`：希望被 registration node 公开索引的范围。
- `tags`：用于轻量检索和分类的场景标签。
- `operator`：可选运营方元数据，可用于展示、审计或治理，但不应成为注册成功的协议前提。

## 10. CatalogRegistrationResult

Registration node 返回 `CatalogRegistrationResult`：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogRegistrationResult",
  "id": "catregres_01",
  "registration_id": "registration_node_public",
  "catalog_id": "catalog_demo",
  "status": "accepted_pending_verification",
  "effective_registration_version": 1,
  "manifest_fetch_status": "fetched",
  "verification_status": "challenge_required",
  "health_status": "unknown",
  "indexed": false,
  "warnings": []
}
```

常见状态：

- `accepted_indexed`：已验证并进入 registration node 索引。
- `accepted_pending_verification`：注册已记录，但尚未验证。
- `accepted_limited`：可进入弱索引，但部分能力或验证缺失。
- `rejected`：无法注册。
- `stale_ignored`：低版本或重复版本被记录但不覆盖 active 状态。

## 11. 注册流程

标准流程：

```text
Catalog Node
  -> POST /ocp/catalogs/register
Registration node
  -> 拉取 Catalog /.well-known/ocp-catalog
  -> 拉取 Catalog /ocp/manifest
  -> 校验 discovery 与 manifest
  -> 验证 Catalog 身份
  -> 执行 health probe
  -> 生成 CatalogProfileSnapshot
  -> 生成 CatalogIndexEntry
  -> Catalog 进入 searchable index
```

版本规则：

- Registration node 使用 `registration_id + catalog_id` 识别一个 Catalog 注册关系。
- 新提交的 `registration_version` 大于 active version 时，可以视为注册更新。
- 新提交版本小于或等于 active version 时，不应覆盖 active Catalog profile。

Manifest 拉取规则：

- Registration node 应通过 `well_known_url` 拉取 Catalog discovery document。
- Registration node 应通过 discovery 中的 `manifest_url` 拉取完整 `CatalogManifest`。
- Registration node 不应只信任注册请求中直接提交的 manifest snapshot。

最小校验：

- discovery 中的 `catalog_id` 必须等于 `CatalogRegistration.catalog_id`。
- manifest 中的 `catalog_id` 必须等于 discovery 中的 `catalog_id`。
- manifest 必须声明 `query` endpoint。
- manifest 必须声明至少一个 query capability。
- endpoint URL 必须是合法 URL。
- endpoint 域名必须在 `claimed_domains` 内，或由 manifest 明确声明为授权外部域名。

## 12. Catalog 身份验证

Catalog 注册不能只靠自声明。Registration node 可以使用一种或多种方式验证 Catalog 身份：

- DNS TXT challenge。
- HTTPS well-known challenge。
- Signed manifest。

验证通过前，registration node 可以保存 registration record 和 manifest snapshot，但默认不应进入公开索引。验证通过后，registration node 才应将 Catalog 标记为 verified，并生成或激活 `CatalogIndexEntry`。

## 13. CatalogProfileSnapshot

`CatalogProfileSnapshot` 是 registration node 对已拉取并校验的 `CatalogManifest` 生成的 profile 摘要。

它可以包含：

- Catalog identity。
- Catalog homepage / discovery / manifest URL。
- query capabilities。
- supported query packs。
- object contract summaries。
- verification status。
- health status。
- trust tier。
- freshness metadata。

Registration node 保存的是 profile snapshot，不是 Catalog 内部完整对象数据库。

## 14. CatalogIndexEntry

`CatalogIndexEntry` 是 registration node 对 Catalog 的本地搜索投影。

它可以包含：

- `catalog_id`
- `catalog_name`
- `description`
- `homepage`
- `manifest_url`
- `well_known_url`
- `supported_query_modes`
- `supported_query_packs`
- `supports_resolve`
- `tags`
- `domains`
- `verification_status`
- `trust_tier`
- `health_status`
- `active_snapshot_id`

`CatalogIndexEntry` 只用于帮助 Agent 或用户选择 Catalog，不应被视为 Catalog manifest 的完整替代品。

## 15. Catalog Search

Endpoint：

```http
POST /ocp/catalogs/search
```

请求：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogSearchRequest",
  "query": "commerce catalog for travel headphones",
  "filters": {
    "query_pack": "ocp.query.keyword.v1",
    "supports_resolve": true,
    "verification_status": "verified"
  },
  "limit": 20,
  "explain": true
}
```

返回：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogSearchResult",
  "id": "catsearch_01",
  "registration_id": "registration_node_public",
  "result_count": 1,
  "items": [
    {
      "catalog_id": "catalog_demo",
      "catalog_name": "Demo Catalog",
      "description": "Product and service discovery catalog.",
      "score": 0.91,
      "matched_query_packs": ["ocp.query.keyword.v1"],
      "verification_status": "verified",
      "trust_tier": "verified_domain",
      "health_status": "healthy",
      "route_hint": {
        "catalog_id": "catalog_demo",
        "manifest_url": "https://catalog.example.com/ocp/manifest",
        "query_url": "https://catalog.example.com/ocp/query",
        "resolve_url": "https://catalog.example.com/ocp/resolve",
        "supported_query_packs": [
          "ocp.commerce.product.search.v1"
        ],
        "cache_ttl_seconds": 86400
      },
      "explain": [
        "Catalog supports the requested query pack.",
        "Catalog domain is verified."
      ]
    }
  ]
}
```

Catalog search 搜索的是 Catalog metadata，不是远端 Catalog 内部的商业对象。

## 16. CatalogRouteHint

`CatalogRouteHint` 是 Agent 可以保存到本地的最小可调用信息。

它不是永久授权凭证，不应包含 secret。

基础字段：

- `catalog_id`
- `catalog_name`
- `manifest_url`
- `query_url`
- `resolve_url`
- `supported_query_packs`
- `auth_requirements`
- `verification_status`
- `trust_tier`
- `health_status`
- `cache_ttl_seconds`
- `snapshot_id`
- `snapshot_fetched_at`

Agent 使用 route hint 的方式：

```text
1. 保存 route hint 到本地 catalog cache。
2. 后续查询前按 TTL 判断是否需要刷新 manifest。
3. 根据 manifest/query capability 构造对应 Catalog 的 query request。
4. 直接调用源 Catalog 的 query endpoint。
5. 如需解析结果，调用源 Catalog 的 resolve endpoint。
```

## 17. 安全与治理原则

Catalog registration 可以采用 open intake，但 open intake 不等于直接进入公开索引。

基本原则：

- 未验证 Catalog 默认不进入公开搜索结果，或只能进入低信任隔离索引。
- 注册入口应有 rate limit、body size limit 和滥用防护。
- refresh/update 操作应要求 catalog-specific token、signed manifest 或重新验证。
- route hint 不应包含 secret。
- registration node 搜索结果应带有 trust、health 和 explain 信息。
- 调用方可以自行决定是否信任某个 registration node 的索引结果。

Catalog-specific token 只能用于当前 Catalog 的维护操作，不应用于修改其他 Catalog、注入搜索结果或绕过 manifest 校验。

## 18. 最终原则

OCP Catalog Registration 发现和索引的是 Catalog，不是 Provider，也不是所有商业对象。

Catalog 自己负责对象索引和查询能力实现。

Registration node 负责让用户和 Agent 找到“应该问哪个 Catalog”，并提供可信、可解释、可缓存的 route hint。

Provider 的对象同步仍发生在具体 Catalog 内部，而不是默认发生在 registration node。
