# ocp.catalog.registration.v1

`ocp.catalog.registration.v1` 定义的是 `Catalog Node -> OCP Catalog Registration` 的注册与发现协议。

它的职责不是索引商品对象本身，而是索引 Catalog metadata，并给用户侧或 agent 返回可缓存的 route hint。

## Scope

这个包当前定义的对象包括：

- `RegistrationDiscovery`
- `RegistrationManifest`
- `CatalogRegistration`
- `CatalogRegistrationResult`
- `CatalogProfileSnapshot`
- `CatalogVerificationChallenge`
- `CatalogVerificationRequest`
- `CatalogVerificationResult`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- `CatalogRefreshResult`
- `CatalogTokenRotationResult`

协议草案与生命周期说明见：

- [../docs/specs/registration/v1.md](../docs/specs/registration/v1.md)

## Boundary

这个包处理的是：

```text
Catalog Node -> OCP Catalog Registration
User / Agent -> OCP Catalog Registration -> route hint
```

它**不**处理：

- Provider 如何接入 Catalog
- Catalog 内部对象同步
- Catalog 对对象的 query / resolve payload
- 商品或服务对象的全文索引

Provider -> Catalog 仍由：

- `ocp.catalog.handshake.v1`

负责。

## Registration Node Role

Registration node 回答的问题是：

> 应该去问哪个 Catalog

而不是：

> 这个 Catalog 里有哪些对象

所以 Registration node 的核心输出是：

- Catalog metadata
- manifest snapshot
- verification / trust / health 状态
- route hint

## CatalogRegistration

`CatalogRegistration` 是 Catalog 向 Registration node 提交的版本化注册声明。

它包含：

- `catalog_id`
- `registration_version`
- `homepage`
- `well_known_url`
- `claimed_domains`
- `intended_visibility`
- `tags`

还可以带可选元数据，例如：

- `operator`

版本规则：

- 对同一 `catalog_id`
- 更新通过更大的 `registration_version`
- `updated_at` 仅用于审计和时间记录

## CatalogRouteHint

`CatalogRouteHint` 是 Registration node 返回给使用方的最小路由摘要。

它的核心字段是：

- `catalog_id`
- `catalog_name`
- `description`
- `manifest_url`
- `query_url`
- `resolve_url`
- `supported_query_packs`
- `verification_status`
- `trust_tier`
- `health_status`
- `cache_ttl_seconds`
- `snapshot_id`
- `snapshot_fetched_at`

### Metadata

`CatalogRouteHint` 现在保留一个统一的：

- `metadata`

用于承载额外提示信息。

例如：

- `metadata.query_hints.supported_query_modes`
- `metadata.query_hints.supported_query_languages`
- `metadata.query_hints.content_languages`

这些信息对于 agent 路由很有价值，但不应该成为 route hint 的最小必填主轴。

主轴仍然是：

- 去哪里拿完整 manifest
- 去哪里 query
- 这个 Catalog 是否可信、健康、可用

## Search vs Route Hint

`CatalogSearchResult` 返回的是 Catalog 候选项列表。  
每个候选项里都可以附带一个 `route_hint`。

设计意图是：

1. Registration node 先帮 agent 选 Catalog
2. agent 再根据 `route_hint` 去真正的 Catalog
3. 如果需要完整能力协商，再读取 `manifest_url`

也就是说：

- route hint 是摘要
- manifest 才是完整能力说明

## Verification / Refresh / Token

Registration node 侧还定义了 Catalog 运维相关控制面对象：

- verification challenge / result
- refresh result
- token rotation result

这些对象让 Registration node 可以：

- 验证 Catalog 控制权
- 刷新 manifest snapshot
- 对 refresh 行为做 Catalog-specific token 控制

## Relationship To Handshake

这个包和 `ocp.catalog.handshake.v1` 的关系是：

```text
ocp.catalog.handshake.v1
  Provider -> Catalog Node

ocp.catalog.registration.v1
  Catalog Node -> OCP Catalog Registration
```

两者是并列协议，不互相替代。

## Current Runtime Shape

当前仓库运行时已经采用以下约定：

- “如何搜索”的主协商信息在 Catalog manifest 的 `query_packs`
- route hint 只保留最小路由和可信度信息
- 语言、mode、semantic hints 进入 `metadata`

这意味着：

- Registration node 不试图镜像 Catalog 的全部查询语义
- agent 若要拿完整搜索能力，应回到 `manifest_url`

## Related Docs

- [../ocp.catalog.handshake.v1/README.md](../ocp.catalog.handshake.v1/README.md)
- [../docs/specs/registration/v1.md](../docs/specs/registration/v1.md)
