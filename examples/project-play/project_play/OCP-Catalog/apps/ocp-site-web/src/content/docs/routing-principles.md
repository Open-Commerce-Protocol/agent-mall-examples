# Routing Principles

This page explains how routing is intended to work across Registration node and Catalog.

## Route Hint Is A Summary, Not A Full Mirror

`CatalogRouteHint` should help the agent decide whether a catalog is worth asking.

It should not try to mirror the entire manifest.

That is why route hint focuses on:

- routable endpoints
- supported query packs
- optional metadata hints
- trust and health state
- declared federation summary
- trust profile projection
- cacheability

For remote-first federation, the route hint may expose a compact `federation`
summary and `trust_profile`. These fields describe whether the source catalog
declares profile-only exchange, summary exchange, mutation logs, or remote
routing support. They are routing metadata, not permission for Registration node
to execute object query or resolve on behalf of the agent.

## Manifest Remains The Detailed Capability Document

If the agent needs deeper detail, it should follow `manifest_url`.

This keeps Registration node lightweight and keeps capability truth with the catalog.

## Route Selection Happens Before Query Execution

The intended order is:

1. search Registration node
2. pick a catalog
3. inspect route hint or manifest if needed
4. query the catalog
5. resolve a result

That ordering is important because it stops Registration node from turning into a product search engine.

## Remote-First Federation Is Contract Exchange

Registration node federation is remote-first and declarative in P5.

Registration nodes and catalogs exchange:

- profile snapshots
- object contract summaries
- catalog summary projections
- mutation metadata
- trust and verification metadata

Registration node does not proxy object `query` or `resolve` traffic. After route
selection, agents call the selected Catalog directly. A future federation router
would be a separate runtime capability, not an implied behavior of route hint or
manifest federation metadata.

## Trust And Health Matter At Routing Time

The agent should be able to use Registration node metadata to prefer:

- verified catalogs
- healthier catalogs
- catalogs whose query packs match the user task

This lets routing stay explainable without forcing the agent to inspect every manifest in detail first.
