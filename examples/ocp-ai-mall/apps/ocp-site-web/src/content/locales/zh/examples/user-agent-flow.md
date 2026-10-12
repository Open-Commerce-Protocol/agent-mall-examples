# 用户与 Agent 流程

这个流程展示的是用户侧 agent 如何消费协议。

## 生命周期

```text
用户表达意图
-> agent 检查本地保存的 catalog profile
-> 如果为空，agent 搜索 Registration node
-> agent 选择候选 catalog
-> 用户确认是否注册到本地
-> agent 查询 catalog
-> agent resolve 选中的结果
```

## 当前仓库实现

当前 user demo 做了两件重要的事：

- 不直接把 raw tool result 扔给用户
- 先让 agent 消化 Registration node 和 Catalog 的返回，再转述给用户

当前仓库里的这条 example 已经比“泛化搜索某个 catalog”更具体：

- Registration node search 会返回 commerce catalog 的 route hint
- agent 会用 Catalog 支持的 query pack（例如 `ocp.query.keyword.v1`）去查询 commerce catalog；`ocp.commerce.product.search.v1` 是 catalog capability，不是 query pack
- catalog 可以使用 keyword、filter、hybrid，以及启用时的 semantic retrieval
- query result 现在会带上价格、图片、库存、质量层级等 commerce attributes
- agent resolve 的是选中的 `entry_id`，而不只是一个 `object_id`

当前 commerce demo resolve 成 `view_product`，是因为这个仓库里实际落地的是这个较窄动作。协议概念本身更宽：resolve 是把选中 entry 变成调用方下一步可执行动作的边界。

其他 catalog 可以把 entry resolve 成这些动作：

- 电商里的 `buy_now`
- 本地服务里的 `book_slot`
- 找工作里的 `apply_job` 或 `submit_resume`
- 人才招聘里的 `send_interview_invite`
- B2B 服务里的 `request_quote`

## 为什么 Registration node 和 Catalog 要分开

Agent 先解决的是：

> 我应该用哪个 Catalog？

然后再解决：

> 这个 Catalog 里我应该展示哪个商品？

这正是协议拆成两层的意义。

## 当前仓库里的真实示例

当前 workspace 中已经验证过的路径是：

```text
用户说要找 travel headphones
-> agent 先去 Registration node 搜索具备 commerce 能力的 catalog
-> agent 拿到 commerce catalog 的 route hint
-> agent 用价格、图片、库存感知的排序去查询该 catalog
-> agent 拿到 rich 和 basic 两类商品候选
-> agent 再把选中的 entry resolve 成带可见商品字段和 view_product action 的 ResolvableReference
```

同一条链路也可以用于非电商场景：

```text
用户说想预约下周二的牙医
-> agent 先去 Registration node 搜索本地服务 catalog
-> agent 查询该 catalog 里的诊所、医生和可预约时段
-> agent 把某个时段 resolve 成带 book_slot action 的 ResolvableReference
```
