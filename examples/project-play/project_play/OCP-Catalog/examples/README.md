# Minimal OCP Catalog Node examples

Each subdirectory is a **complete, spec-valid [OCP Catalog Node](../docs/specs)**
implemented from scratch in a different language, serving the same three
hardcoded in-memory products. They exist to show the smallest thing that
correctly speaks the OCP Catalog read surface — no database, no vendor API, no
auth, no framework beyond each language's standard library (the TypeScript one
depends only on the published schema package for its conformance test).

| Language | Directory | Default port | Run |
|---|---|---|---|
| TypeScript | [`typescript/`](./typescript) | 4400 | `bun install && bun run start` |
| Python | [`python/`](./python) | 4401 | `python server.py` |
| Go | [`go/`](./go) | 4402 | `go run .` |

## What a Catalog Node must implement

A Catalog Node answers five endpoints. The canonical shapes are the Zod schemas
in [`@ocp-catalog/ocp-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-schema)
and the specs in [`../docs/specs`](../docs/specs); the minimal required fields
are:

| Method | Path | Returns | Minimal required fields |
|---|---|---|---|
| GET | `/.well-known/ocp-catalog` | discovery | `catalog_id`, `catalog_name`, and the `*_url` endpoints |
| GET | `/ocp/manifest` | `CatalogManifest` | `endpoints.query` + `endpoints.resolve`, ≥1 `query_capabilities` entry, `object_contracts` (may be `[]`) |
| GET | `/ocp/health` | `CatalogHealth` | `status`, `ready`, `checked_at` |
| GET | `/ocp/contracts` | `ObjectContractList` | `object_contracts` (`[]` for a read-only node) |
| POST | `/ocp/query` | `CatalogQueryResult` | `query`, `result_count`, `page.offset:0`, `entries[]` of `{entry, score, explain}` |
| POST | `/ocp/resolve` | `ResolvableReference` | `entry_id`, `object_id`, `title`, `action_bindings[]`, `freshness`, `expires_at` |

A `CatalogEntry` inside a query result needs `catalog_id`, `entry_id`,
`provider_id`, `object_id`, `title`, and an `attributes` object. That's it — the
rest of the schema is optional and defaults sensibly.

## Conformance

Every example ships a test that exercises all five endpoints. The TypeScript
test parses each response through the published Zod schemas, so it is a true
schema-conformance check; the Python and Go tests assert the required fields
structurally (there is no OCP package for those ecosystems yet).

```bash
cd typescript && bun test
cd python     && python conformance_test.py
cd go         && go test ./...
```

## Where the full applications live

These are teaching examples. The production-grade catalog nodes, provider apps,
admin UIs, demos, and deploy tooling live in the separate OCP Catalog instances
repository. This repo keeps only the protocol: the specs, the schema/client
packages, and these minimal examples.
