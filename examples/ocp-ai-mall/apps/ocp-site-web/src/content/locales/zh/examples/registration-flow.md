# 注册流程

这一页描述的是当前仓库里真实存在的 `Catalog -> Registration node` 运行链路。

## 真实生命周期

```text
catalog admin 提交 CatalogRegistration
-> Registration node 校验 registration_id 和 registration_version
-> Registration node 拉取 /.well-known/ocp-catalog 与 catalog manifest
-> Registration node 校验拉取到的身份信息、endpoint 与 domain 一致性
-> Registration node 优先检查 endpoints.health，旧 manifest 才降级为 query probe
-> Registration node 落 registration record 和 manifest snapshot
-> Registration node 索引 active snapshot
-> Registration node 下发 catalog_access_token
-> 后续 refresh 会重新拉 discovery / manifest / health，并更新 active snapshot
```

在当前实现里，`operator` 只是可选元数据。一个 catalog 真正必须做到的是：声明自己的 `catalog_id`，并暴露可被 Registration node 拉取的 discovery / manifest / query，生产级 catalog 还应该暴露 health endpoint。

## 当前实现实际会持久化什么

当前 Registration node runtime 不是只存一条 registration 行，而是会分层持久化：

- `catalog_registration_records`
- `registered_catalogs`
- `catalog_manifest_snapshots`
- `catalog_index_entries`
- `catalog_verification_records`
- `catalog_health_checks`
- `catalog_search_audit_records`

这样拆分很重要，因为当前运行时明确把 registration 历史、active catalog 状态、snapshot、搜索索引、可选 verification 记录和 health 当成相关但不同的生命周期对象。

## 当前仓库里的 registration 状态

对于一个 `catalog_id`，当前实现会区分几种运行时结果：

- `stale_ignored`
  registration 被记录了，但它的 `registration_version` 没有覆盖当前 active 版本。
- `accepted_indexed`
  catalog 已经拥有 active indexed snapshot。

这个 demo Registration node 的关键行为是：

- 不要求额外的域名 verification
- registration 在 fetch + health evaluation 之后会立即进入 indexed 状态

## Verification、Token 与 Refresh 行为

当前实现里还有一条明确的控制面流程：

- `verify` 用于确认 catalog verification 状态；demo Registration node 不要求额外 challenge
- registration 成功时，如果还没有 token，Registration node 会下发 `catalog_access_token`
- `refresh` 和 `token/rotate` 都要求带这个 catalog token
- refresh scheduler 只会扫描已经 `accepted_indexed` 的 catalog

所以在当前仓库里，catalog 进入 Registration node searchable index 不再依赖额外的域名验证门槛。

## Health 与 Indexing

当前 Registration node 不把 health 当成一个被动展示字段，而是会优先调用 manifest 里的 `endpoints.health` 并记录结果；旧 manifest 没声明 health 时，才发送最小 query probe。

这个 health 状态会继续影响：

- 新注册 catalog 的健康状态
- refresh 后的新 snapshot 是否仍然健康
- 连续失败是否把 index entry 标记为 stale
- route hint 里返回的 trust / health 信息

## 当前仓库里的真实示例

当前 workspace 里已经验证过的路径是：

```text
catalog admin 提交 CatalogRegistration
-> Registration node 拉取 catalog discovery document
-> Registration node 拉取 manifest
-> Registration node 调用 manifest.endpoints.health 里的 GET /ocp/health
-> Registration node 落 registration + snapshot
-> Registration node 写入 catalog_index_entries
-> Registration node 下发 catalog_access_token
-> user-side agent 之后就可以通过 Registration node search 找到这个 catalog
-> 后续 refresh 会重新拉 manifest，并更新 active snapshot
```

## 为什么这个示例重要

这条 Registration node flow 已经不只是 schema 演示：

- registration 是有版本和状态流转的
- snapshot 是一等运行时对象
- token issuance、health checks 和 indexing 是连在一起的
- 连续 health 失败会把 catalog 从默认搜索中隐藏
- Registration node search 运行在内部 catalog metadata index 上，而不是直接扫远端 catalog
- route hint 来源于 active indexed snapshot，而不只是原始 registration 输入
