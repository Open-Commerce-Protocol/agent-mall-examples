这个 app 会从 /wp-json/wc/v3/products 读取商品，把 WooCommerce 字段映射到 OCP 的 product、price、inventory packs，并以带 ocp.push.batch 同步能力的 Provider 形式注册商家。

它支持全量同步、基于 modified_after 的增量同步、单商品同步、可变商品变体嵌入、WooCommerce HMAC webhook 校验，以及删除商品的 inactive tombstone。

这让 WordPress 电商库存可以进入 OCP 兼容 Catalog，而不要求商家迁移到新的店铺系统。Catalog 可以负责推广、搜索和 resolve 商品，但最终商品页与交易仍保留在商家自己的站点。
