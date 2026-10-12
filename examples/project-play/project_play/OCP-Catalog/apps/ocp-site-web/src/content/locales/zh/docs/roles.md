# 角色

当前协议和仓库实现里，主要有四种角色。

## Registration node

Registration node 主要回答的问题是：

> 下一步应该去问哪个 Catalog？

Registration node 最好理解成“catalog 的 catalog”。

它不直接提供商品，而是索引 catalog 元数据、可信状态、route hint 和 manifest snapshot，帮助 agent 决定下一步应该使用哪个 catalog。

更重要的是，OCP Catalog Registration node 不是协议里的强制中心权威。这个协议本身是明确去中心化的：

- 任何人都可以独立运行一个 OCP Catalog Registration node
- 不同运营方可以运行不同的 Registration node，并采用不同的 intake、trust 与治理策略
- catalog 可以自行选择注册到哪个或哪些 Registration node
- agent 或应用也可以自行选择信任哪个或哪些 Registration node

这意味着，即使存在一个公开或官方的 Registration node，也不等于协议本身会因此变成中心化协议。

## Catalog

Catalog 是真正提供查询能力的节点。

它负责：

- 发布 manifest
- 定义 object contract
- 接收 provider registration
- 接收对象同步
- 暴露 query 和 resolve 接口
- 通过 resolve 结果暴露动作入口

## Provider

Provider 是对象供给方。

它负责：

- 声明自己能提供哪些 object type 和 pack
- 发送版本化的 registration
- 把具体对象同步进 catalog

## Agent

Agent 是使用侧。

它负责：

- 通过 Registration node 选择合适的 catalog
- 读取 catalog 的能力描述
- 对 catalog 发 query 请求
- 对选中的结果执行 resolve

这些最终动作是开放的。一个 catalog 里可能是 `view_product` 或 `buy_now`；另一个 catalog 里可能是 `book_slot`、`apply_job`、`submit_resume`、`send_interview_invite` 或 `request_quote`。

## 角色关系

```text
Provider -> Catalog -> Registration node
                 ^
                 |
               Agent
```

## 为什么要这样拆分

这种拆分把四个关注点分开了：

- 对象供给
- catalog 服务
- 网络级发现
- 上下文化地解析成下一步动作

这正是当前 demo 可以同时支持多个 provider 和多个 catalog 的原因。

它也让协议权力保持分散：

- provider 不需要依赖单一 discovery authority
- catalog 不需要得到某个全局中心的许可才能存在
- Registration node 可以彼此竞争、分工或垂直化，而不需要改变 handshake 协议本身

## 实践中的角色组合

同一个组织仍然可以承担多个角色。这里强调的是协议层面的权责边界，不是公司边界或进程拓扑。

- WooCommerce 店铺可以同时是 **Provider** 和 **Action Provider**：它提供商品对象，同时继续负责 checkout、订单、税费、履约和退款。
- 参考 commerce agent 扮演 **Agent**，并在 Catalog 协议之外组合独立的支付信任和确认规则。
- 公共 commerce catalog 扮演 **Catalog**，聚合多个 Provider，并注册到一个或多个 Registration node。

关键规则是每个协议面都保持职责清晰：Registration node 不变成商品搜索引擎，Catalog 不变成订单系统，Agent 不绕过 resolve 或用户确认。
