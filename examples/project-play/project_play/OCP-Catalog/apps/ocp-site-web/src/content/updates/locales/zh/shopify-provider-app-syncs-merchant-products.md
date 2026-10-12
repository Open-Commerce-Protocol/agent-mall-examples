这个 app 会连接 Shopify Admin GraphQL，为商家生成 ProviderRegistration，把 Shopify 商品映射成 OCP CommercialObject，并通过 /ocp/providers/register 与 /ocp/objects/sync 推送到 Catalog。

示例 app 已实现全量同步、增量同步、单商品同步、带签名校验的商品 webhook、删除商品 tombstone，以及 admin status 端点。默认启用 mock fixtures，因此不需要真实商家凭证也能验证完整流程。

它的价值是实际分发：商家不需要自己搭建 Catalog，也不需要改造 Agent 侧集成。安装并连接 app 之后，商品就可以出现在兼容的 OCP Catalog 中被搜索和推荐；结账与最终商业关系仍然回到原始 Shopify 店铺。
