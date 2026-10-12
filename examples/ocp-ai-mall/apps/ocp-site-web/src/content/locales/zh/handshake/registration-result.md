# 注册结果（RegistrationResult）

`RegistrationResult` 是 Provider registration 完成后的结构化反馈。

## 状态模型

当前 schema 支持：

```json
{
  "status": {
    "enum": [
      "accepted_full",
      "accepted_limited",
      "rejected",
      "pending_verification"
    ]
  }
}
```

## 主要字段

```json
{
  "properties": {
    "matched_object_contract_count": { "type": "integer" },
    "effective_registration_version": { "type": "integer" },
    "selected_sync_capability": {
      "type": "object"
    },
    "missing_required_fields": { "type": "array" },
    "warnings": { "type": "array" },
    "message": { "type": "string" }
  }
}
```

## 为什么它重要

它会告诉 Provider：

- registration 是否被完全接受
- 匹配到了多少个 object contract
- 最终选中了哪条 sync capability
- 是否存在缺失字段
- 当前激活版本是否发生变化

这些反馈都应该在 Provider Admin UI 里展示出来，然后再决定是否继续 full sync。

## 当前仓库里的真实行为

在当前 commerce provider 示例里，成功路径通常会是：

- `status = "accepted_full"`
- `matched_object_contract_count = 1`
- `selected_sync_capability.capability_id = "ocp.push.batch"`
- `warnings = []`

这个 accepted 结果随后会先被记录到 provider 侧的 run log 中，然后 provider 才继续执行 `sync_all`。

schema 仍然支持 `accepted_limited`，但当前 commerce catalog/provider 这对默认实现被刻意配置成在默认 registration declaration 下走一个更强的 fully accepted path。
