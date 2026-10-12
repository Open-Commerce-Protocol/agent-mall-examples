# 查询契约原则

这一页说明 catalog 查询契约的组织原则。

## Query Packs 是主要搜索契约

Agent 需要一个稳定答案来回答：

> 我应该如何搜索这个 catalog？

这个答案应该主要来自 `query_packs`。

每个 pack 都可以描述：

- pack 标识
- 支持的 query mode
- request schema 链接
- 可选 metadata hints

## Query Modes 应该属于某个 Pack

`keyword`、`filter`、`semantic`、`hybrid` 这些 mode，只有放在具体 query pack 的上下文中才有意义。

因此把它们放进 `query_packs[*]` 才是更一致的结构。

## Metadata 用来承载搜索提示

下面这些内容：

- 支持的 query 语言
- 内容语言
- filter 字段提示
- semantic search 说明

都应该优先作为可选 metadata，而不是轻易升成顶层必填协议字段。

## Catalog 应该明确搜索形状

随着 catalog 真实复杂度增加，越来越需要对外明确：

- 哪些字段可搜索
- 哪些字段可过滤
- 哪些字段可排序
- 是否支持 resolve

当前协议已经为这些能力留出了足够空间，而不需要立刻引入一个巨大的统一搜索 schema。
