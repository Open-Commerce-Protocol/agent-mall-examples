The app connects to Shopify Admin GraphQL, builds a ProviderRegistration for the merchant, maps Shopify products into OCP CommercialObjects, and pushes them through /ocp/providers/register and /ocp/objects/sync.

Full sync, delta sync, one-product sync, signed product webhooks, tombstones for deleted products, and an admin status endpoint are implemented in the example app. Mock fixtures are enabled by default so the flow can be validated without real merchant credentials.

The value is practical distribution: a merchant does not need to build a catalog or rewrite agent-side integrations. Once the app is installed and connected, its products become searchable in a compatible OCP catalog, while checkout and the final commercial relationship remain on the original Shopify storefront.
