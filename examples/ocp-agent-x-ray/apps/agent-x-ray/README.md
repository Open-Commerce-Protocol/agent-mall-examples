# OCP Agent X-Ray

A local OCP shopping inspector for hackathon demonstrations. Run a buyer scenario, inspect each protocol response, break the sample product data, and rerun a repaired fixture. The UI exports a `report.json` that a coding agent can read without interpreting screenshots.

## Run

From the repository root, with Bun installed:

```sh
bun install
bun run xray:build
bun run xray:dev
```

Open http://127.0.0.1:4410. The server binds to loopback. Demo needs no network after dependencies and the UI have been built.

For UI development, run `bun run xray:dev` in one terminal and `bun run xray:ui` in another. Open http://127.0.0.1:5174; Vite forwards `/api` to the local server.

## The 30-second demo

1. Keep the default goal, `headphones` query, USD 200 budget and healthy Demo Catalog. Click **Run scenario**. Aurora Wireless Headphones costs USD 199. Click Query or Resolve to inspect its actual request and response.
2. Select **Break & Repair · missing data** and run again. Query and Resolve still return HTTP 200 and schema-valid OCP envelopes. Their nodes turn red because the product lacks a usable price and view action. The lab lists both checks with their evidence.
3. Click **Generate Fix for Coding Agent** to copy the repair task. Download `report.json` for the full trace. Click **Apply fixture repair & rerun**. It removes fault injection for this scenario, reruns all steps and compares failure counts. It does not edit source files or a remote Catalog.

Choose **invalid schema** for a separate protocol failure. The Query response deliberately uses a string for `entries`; the SDK rejects it, the inspector retains the response, and Resolve does not run.

## Protocol and recommendation boundaries

The runner imports `@ocp-catalog/ocp-client` and `@ocp-catalog/ocp-schema`. Demo reuses `examples/typescript/src/server.ts`; fixture responses are validated before intentional corruption. Product prices use the official price-pack schema. Missing price/action checks are product-quality checks, not invented OCP requirements.

Discovery means direct selection of a user-provided Catalog Manifest URL. It does not make a Registration search request. Manifest inspection precedes Query. Query uses a declared keyword or semantic pack; the runner rejects Catalogs with no supported text-query pack. Filters stay empty because the budget check is local. Resolve uses an entry from the Query response and validates its identity and expiry.

The planner is deterministic, with no LLM or API key. It maps headphone phrases in Chinese or English to `headphones` and extracts an explicit USD budget. Other text is passed through as the editable query. The UI labels this behavior. Catalog explanations and scores are shown as returned; they are not model chain-of-thought. Selection takes the highest Catalog score among same-currency candidates within budget. Ties keep response order. A missing-price candidate may be resolved for diagnosis, but is not eligible for recommendation. A run with no eligible candidate fails selection and skips Resolve. The runner inspects up to 12 entries on the first page and makes no claim about unseen products.

Demo measures in-process fixture execution and schema validation, not network latency. Live measures actual HTTP execution including response parsing and validation. Demo product URLs use `example.com`, so the UI does not offer them as real shopping destinations.

## Live Catalog

To try the repository's real HTTP example:

```sh
bun run examples/typescript/src/server.ts
```

Switch X-Ray to Live and keep `http://localhost:4400/ocp/manifest`. Live calls happen on the local server, so Catalog CORS policies do not block the browser.

By default, only `http://localhost:4400` and `http://127.0.0.1:4400` are allowed. To use a Catalog you own, restart with an explicit origin allowlist:

```sh
X_RAY_CATALOG_ORIGINS=https://catalog.example.org bun run xray:dev
```

Include every origin used by the Manifest's Query and Resolve endpoints. All requests enforce the allowlist; redirects, URL credentials, query strings and fragments are rejected. There is no arbitrary browser proxy endpoint or authentication forwarding. Errors remain errors; Live never falls back to Demo. This is a local development tool. Keep it bound to loopback; it is not a public proxy or a DNS-rebinding-resistant production service.

## Reports and repair

Each completed run saves a separate `apps/agent-x-ray/reports/xray_<uuid>.json`, ignored by Git. The download uses the same sanitized report. It contains input, planner identity, transport, protocol steps, HTTP statuses, measured durations, raw JSON evidence, failed checks, selection reasons and a repair task. Reports omit request/response headers; sensitive JSON keys are redacted, and URLs in evidence lose credentials, queries and fragments. Avoid pasting secrets into free-text inputs. Raw arbitrary text cannot be guaranteed to contain no secrets.

The copy button creates a handoff, not an autonomous code edit. A coding agent still needs access to the Catalog/provider source and approval for remote writes. Fixture repair is reproducible fault removal followed by a fresh run; new run IDs and before/after counts make that visible.

## Verify

```sh
bun run --cwd apps/agent-x-ray typecheck
bun test apps/agent-x-ray/src/runner.test.ts
bun run xray:build
bun test
```

The tests cover healthy shopping, missing-data repair, invalid schema, budget/currency rejection, concurrent trace isolation, actual HTTP Catalog calls, unavailable Live endpoints, URL bounds and report redaction.

## Implementation notes

React, TypeScript, Tailwind, a local shadcn/ui Button, React Flow and Framer Motion implement the UI. Motion respects reduced-motion settings; fonts use local fallbacks so the demo has no external asset requests. The visual direction is an industrial inspection console, using a green protocol line and red check failures. Four work areas occupy one page: buyer input, protocol trace, product evidence and agent repair.

The current SDK has no transport-injection option. The server's fetch wrapper uses AsyncLocalStorage to capture only calls inside an X-Ray run; unrelated requests use the original fetch. Fault state and trace evidence remain scoped per run. Client activity is not sent to any external telemetry endpoint.

To remove the app, revert the X-Ray commit. No authentication, MCP, hooks or shell startup files are changed. The repository workspace and lockfile add this app and its frontend dependencies only.
