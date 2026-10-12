# Resolve 与动作

`resolve` 是把某个候选 catalog entry 转成“当前用户、当前上下文、当前策略、当前对象状态下，下一步可以执行什么”的步骤。

它不只等于打开详情页。URL 只是最简单的一种 action binding。

## 核心概念

Query 回答的是：

> 有哪些候选对象？

Resolve 回答的是：

> 当前调用方可以对这个候选对象继续做什么？

这个下一步可以是页面、API 调用、workflow 入口、受权限保护的联系渠道，或者某个 action provider 暴露的领域动作。

## 为什么 Resolve 要和 Query 分开

搜索结果应该更快、更容易缓存、更容易解释，也更适合在较宽权限下展示。

Resolve 可以更严格。它可以应用当前权限、检查新鲜度、暴露受保护字段、确认可用性，并且只在调用方有权限时返回 action binding。

这种分层让协议可以支持非常不同的行业，而不是要求每个 search result 一开始就携带所有可能的执行细节。

## 示例

```text
电商商品
-> resolve 可以返回 view_product, add_to_cart, buy_now, request_quote

本地生活服务
-> resolve 可以返回 view_store, book_slot, request_appointment

找工作
-> resolve 可以返回 view_job, apply_job, submit_resume

人才招聘
-> resolve 可以返回 view_profile, request_contact, send_interview_invite

B2B 服务
-> resolve 可以返回 view_capability, request_quote, start_procurement_flow
```

## ResolvableReference

`ResolvableReference` 是 resolve 阶段的标准输出。

它可以包含：

- 当前调用方可见的字段
- 来源与新鲜度
- 权限状态
- 匹配解释
- availability、eligibility、access、endpoint health 等 live check
- action bindings

这个 reference 是上下文化的。它不等于永久对象 ID，不等于完整对象记录，也不等于最终交易已经完成。

## Action Binding

Action binding 描述调用方下一步可以采取的动作。

典型字段类似：

```json
{
  "action_id": "book_slot",
  "action_type": "api",
  "label": "Book appointment",
  "url": "https://service.example.com/appointments/book",
  "method": "POST",
  "input_schema": "https://service.example.com/schemas/book-slot-request.json"
}
```

Catalog 暴露的是动作入口和调用要求。它不会因此变成预约系统、订单系统、ATS、CRM、ERP 或审批流系统。

这个边界很重要：OCP Catalog 标准化的是发现、解析和动作入口暴露；真正的执行与状态流转仍然应该留在权威服务附近。

## 阶段纪律

Search、Resolve、Action 的可见性、新鲜度、权限强度和审计粒度都不同。

- Search 不应该暴露价格内部细节、精确库存、联系方式或支付凭据。
- Resolve 不是批量详情查询。它应在用户或 Agent 选定候选对象之后，用来返回受限字段、实时校验或动作入口。
- Action 由 Action Provider 或业务系统执行，并且必须先通过用户确认、幂等、过期时间、schema 和风险校验。

具体集成也遵守同一结构：浏览器 demo 可以暴露搜索工具，commerce provider 可以把 resolve 映射到 checkout 创建，带支付能力的 agent 只能在 resolve 和明确用户授权之后创建 checkout。
