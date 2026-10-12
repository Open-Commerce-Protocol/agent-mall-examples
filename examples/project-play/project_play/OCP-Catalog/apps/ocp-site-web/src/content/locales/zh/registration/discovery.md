# 注册发现

注册发现文档用于引导调用方访问 OCP Catalog Registration node。

当前 wire schema 使用 `RegistrationDiscovery` kind 和 `registration_*` 字段名。这个 discovery 文档是 OCP Catalog Registration node 的 baseline 入口。

## 必需字段

```json
{
  "required": [
    "ocp_version",
    "kind",
    "registration_id",
    "registration_name",
    "registration_protocol",
    "registration_protocol_version",
    "manifest_url",
    "catalog_registration_url",
    "catalog_search_url"
  ]
}
```

## 示例片段

```json
{
  "kind": "RegistrationDiscovery",
  "registration_id": "ocp_registry_public",
  "registration_name": "Open Commerce Protocol Registry",
  "registration_protocol": "ocp.catalog.registration.v1",
  "manifest_url": "http://localhost:4100/ocp/registration/manifest",
  "catalog_registration_url": "http://localhost:4100/ocp/catalogs/register",
  "catalog_search_url": "http://localhost:4100/ocp/catalogs/search"
}
```

## 为什么需要它

如果没有 discovery 文档，所有客户端都只能依赖外部约定知道 Registration node 的接口地址。

有了它，registration node 的入口就变成了自描述的。
