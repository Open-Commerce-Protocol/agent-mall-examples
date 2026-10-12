# 验证与刷新

Registration node 包里还定义了 catalog verification、refresh 和 token rotation 相关的控制面对象。

## 验证请求

当前 verification request 很小，只做最小必要表达。

```json
{
  "properties": {
    "ocp_version": { "const": "1.0" },
    "kind": { "const": "CatalogVerificationRequest" },
    "challenge_id": { "type": "string" }
  }
}
```

有些 Registration node 会用这个对象做额外 verification，但协议并没有要求所有 Registration node 都必须用 DNS 或 HTTPS challenge 作为注册门槛。

## 刷新结果

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "status",
    "health_status",
    "indexed",
    "warnings",
    "refreshed_at"
  ]
}
```

这个结果告诉 Catalog：一次 refresh 是否成功生成了健康、可索引的 snapshot。

## 令牌轮换结果

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "catalog_access_token",
    "token_issued_at"
  ]
}
```

## 为什么这些对象重要

它们不会直接影响用户侧商品搜索，但对多 catalog 网络的运维非常关键：

- verification 保证注册可信
- refresh 保证 snapshot 是新的
- token rotation 保证操作权限可控
