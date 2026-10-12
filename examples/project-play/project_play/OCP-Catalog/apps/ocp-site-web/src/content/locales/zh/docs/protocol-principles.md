# 协议设计原则

这一页总结的是当前 OCP Catalog 协议形状背后的主要设计原则。

## 按职责拆分协议

当前协议被有意拆成两层：

- `Provider -> Catalog`
- `Catalog -> Registration node`

这样可以避免一个 schema 包同时承担供给侧和发现侧的复杂职责。

## 让最小协议核心保持精简

最小协议只应该冻结真正影响互操作的内容。

例如：

- identity
- endpoint discovery
- 版本化 registration
- route hint
- 通用对象包络

其他字段在成为顶层必需项之前，都应该谨慎评估。

## 优先稳定契约，而不是临时方便字段

协议告诉 agent 如何交互，应该依赖结构化契约，而不是只靠临时 flag。

这也是为什么 `query_packs` 比平铺的 mode 列表更重要。

## 把 Hints 当成 Hints

语言支持、语义检索提示、排序提示等信息非常有价值，但不应该轻易变成硬协议主轴。

当前设计把这些内容放进 `metadata`，让它们保持有用，但不会把最小协议搞得过重。

## 把路由选择和对象检索分开

Registration node 应该帮助回答：

> 我应该去问哪个 catalog？

Catalog 应该帮助回答：

> 我应该返回哪个对象？

把这两个阶段拆开，是当前设计能够超越单一 catalog 的关键原因之一。

## 把 Resolve 视为下一步边界

Query 不应该被迫携带所有执行细节。

Resolve 是选中候选对象变成上下文化 `ResolvableReference` 的地方：当前可见字段、权限、新鲜度检查，以及调用方下一步可以做什么的 action binding。

这些 action binding 可以指向页面、API、联系渠道或 workflow 入口。Catalog 暴露入口，但真正的订单、预约、投递、邀约、报价或审批状态机仍然属于权威服务。

## 版本化声明是必须的

无论是 provider registration 还是 catalog registration，之所以都做成版本化结构，是因为：

- 便于审计
- 可以防止过期写入悄悄生效
- 给 sync 操作提供清晰的契约边界
