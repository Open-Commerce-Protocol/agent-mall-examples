# Minimal OCP Catalog Node — TypeScript

The smallest spec-valid [OCP Catalog Node](../../docs/specs), serving three
hardcoded in-memory products. No database, no vendor API, no auth.

## Run

```bash
bun install
bun run start        # listens on http://localhost:4400
```

Then:

```bash
curl http://localhost:4400/ocp/manifest
curl http://localhost:4400/ocp/health
curl -X POST http://localhost:4400/ocp/query   -H 'content-type: application/json' -d '{"query":"headphones"}'
curl -X POST http://localhost:4400/ocp/resolve -H 'content-type: application/json' -d '{"entry_id":"entry_example_inmemory_sku-001"}'
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/ocp-catalog` | discovery |
| GET | `/ocp/manifest` | capabilities + query packs |
| GET | `/ocp/health` | liveness |
| GET | `/ocp/contracts` | object contracts (empty — read-only node) |
| POST | `/ocp/query` | keyword search over products |
| POST | `/ocp/resolve` | resolve one entry into action bindings |

## Conformance

`src/server.test.ts` parses every response through the published
[`@ocp-catalog/ocp-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-schema)
Zod schemas, so the example is provably spec-valid:

```bash
bun test
```

Configuration via env: `CATALOG_ID`, `CATALOG_NAME`, `PORT`, `PUBLIC_BASE_URL`.
