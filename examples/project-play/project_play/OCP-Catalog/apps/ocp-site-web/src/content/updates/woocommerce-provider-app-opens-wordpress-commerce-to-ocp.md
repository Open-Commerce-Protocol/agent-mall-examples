The app reads products from /wp-json/wc/v3/products, maps WooCommerce fields into OCP product, price, and inventory packs, and registers the merchant as a Provider with ocp.push.batch sync capability.

It supports full sync, modified-after delta sync, single-product sync, variable-product variation embedding, HMAC-signed WooCommerce webhooks, and inactive tombstones for deleted products.

This makes WordPress commerce inventory available to OCP-compatible catalogs without forcing merchants into a new storefront. Catalogs can promote and resolve the merchant products, but the final product page and transaction remain under the merchant site.
