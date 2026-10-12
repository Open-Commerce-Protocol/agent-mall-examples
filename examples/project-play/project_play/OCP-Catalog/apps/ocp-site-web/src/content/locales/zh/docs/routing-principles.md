# 路由原则

这一页说明的是 Registration node 和 Catalog 之间的路由是如何被设计的。

## Route Hint 是摘要，不是完整镜像

`CatalogRouteHint` 的职责是帮助 agent 判断某个 catalog 是否值得继续访问。

它不应该试图完整镜像整个 manifest。

因此 route hint 更关注：

- 可路由 endpoint
- 支持的 query pack
- 可选 metadata hint
- trust 与 health 状态
- cache 信息

## Manifest 是完整能力文档

如果 agent 需要更深的能力细节，就应该跟着 `manifest_url` 去读取 manifest。

这样 Registration node 保持轻量，能力真相也继续留在 Catalog 本身。

## 路由选择先于 Query 执行

正确顺序应该是：

1. 搜索 Registration node
2. 选择 catalog
3. 视需要检查 route hint 或 manifest
4. 查询 catalog
5. resolve 某个结果

这个顺序很重要，因为它可以防止 Registration node 逐渐演变成一个商品搜索引擎。

## Trust 和 Health 应在路由阶段发挥作用

Agent 应该能够利用 Registration node 的 metadata 优先选择：

- 已验证的 catalog
- 更健康的 catalog
- query pack 与用户任务更匹配的 catalog

这样一来，路由就保持可解释，而不必先深读每一个 manifest。 
