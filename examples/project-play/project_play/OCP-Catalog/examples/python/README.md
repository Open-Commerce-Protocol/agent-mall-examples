# Minimal OCP Catalog Node — Python

The smallest spec-valid [OCP Catalog Node](../../docs/specs), serving three
hardcoded in-memory products. Standard library only — no framework, no
third-party dependencies. Requires Python 3.9+.

## Run

```bash
python server.py        # listens on http://localhost:4401
```

Then:

```bash
curl http://localhost:4401/ocp/manifest
curl http://localhost:4401/ocp/health
curl -X POST http://localhost:4401/ocp/query   -H 'content-type: application/json' -d '{"query":"headphones"}'
curl -X POST http://localhost:4401/ocp/resolve -H 'content-type: application/json' -d '{"entry_id":"entry_example_inmemory_sku-001"}'
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

`conformance_test.py` starts the server and asserts every response carries the
required OCP fields (structural check — there is no OCP pip package yet; the
canonical schemas live in [`@ocp-catalog/ocp-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-schema)
and [`docs/specs`](../../docs/specs)):

```bash
python conformance_test.py
```

Configuration via env: `CATALOG_ID`, `CATALOG_NAME`, `PORT`, `PUBLIC_BASE_URL`.
