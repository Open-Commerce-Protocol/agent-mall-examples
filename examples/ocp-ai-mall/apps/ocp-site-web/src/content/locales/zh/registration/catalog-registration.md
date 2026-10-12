# 目录注册（CatalogRegistration）

`CatalogRegistration` 是 Catalog 向 Registration node 发送的版本化声明。

## 必需字段

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "registration_version",
    "updated_at",
    "homepage",
    "well_known_url",
    "claimed_domains"
  ]
}
```

## 示例片段

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "registration_version": 3,
  "homepage": "http://localhost:4000",
  "well_known_url": "http://localhost:4000/.well-known/ocp-catalog",
  "claimed_domains": ["localhost"],
  "intended_visibility": "public",
  "tags": ["commerce", "products"]
}
```

## 可选元数据

`operator` 仍然可以作为可选元数据传递，但它不再是注册成功的前提。

## 版本规则

对同一个 `catalog_id`：

- 更大的 `registration_version` 会覆盖旧版本
- `updated_at` 只是审计时间，不是主版本排序依据

## Registration node 接下来会做什么

Registration node 接受注册后，可以继续：

- 校验 catalog 控制权
- 拉取 catalog manifest
- 生成 snapshot
- 索引可路由 metadata
