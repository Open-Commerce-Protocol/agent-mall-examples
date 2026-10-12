# CLI & Skill

> **Status: published.** The OCP CLI and bundled `ocp-catalog` agent skill are available
> on npm as [`@ocp-catalog/ocp-cli`](https://www.npmjs.com/package/@ocp-catalog/ocp-cli).
> Use `npm install -g @ocp-catalog/ocp-cli` for a global install, or run commands directly
> with `npx @ocp-catalog/ocp-cli@latest`.

The OCP CLI and the `ocp-catalog` agent skill give an agent a correct, repeatable way to
drive the protocol. The CLI returns structured JSON for both help and results, so an agent can
inspect a command and act on its output without parsing terminal prose.

## What The CLI Is For

- **The standard OCP workflow as commands.** Discover a Registration node, search or resolve a
  Catalog route, inspect the Catalog manifest, query with a manifest-declared query pack, then
  resolve a selected entry only when details or actions are needed.
- **Manifest-based request validation.** This is the part that keeps agents honest. Before a
  query leaves the machine, the CLI can load the Catalog manifest and reject anything the Catalog
  did not declare: an unsupported `query_pack`, a filter field that does not exist, invalid
  pagination, or a missing semantic query string. Instead of a failed network round-trip, the
  agent gets explicit correction details — and a default query pack is selected when one can be.
- **Public activity, not raw audit data.** `events tail` reads the redacted public Activity API
  projection so an agent can see query/resolve/sync/tooling events without touching audit payloads.
- **Skill management.** Install, update, check, or remove the local `ocp-catalog` skill for your
  agent environment.

## Install From npm

Install the CLI globally when you want a stable `ocp` command on `PATH`:

```bash
npm install -g @ocp-catalog/ocp-cli
ocp help
```

Or run it without a global install:

```bash
npx @ocp-catalog/ocp-cli@latest help
npx @ocp-catalog/ocp-cli@latest skill doctor --target both
```

## Try It From GitHub

If you are contributing to the repository, you can still run the bundled CLI through the
skill runner:

```bash
git clone https://github.com/Open-Commerce-Protocol/OCP-Catalog
cd OCP-Catalog

# Top-level help describes the full OCP workflow
bun scripts/ocp-skill-runner.ts help

# A real discovery → search → inspect → query flow
bun scripts/ocp-skill-runner.ts registration search --registration-url https://ocp.deeplumen.io/registry --query "commerce"
bun scripts/ocp-skill-runner.ts catalog inspect http://localhost:4000/ocp/manifest
bun scripts/ocp-skill-runner.ts events tail --activity-url https://ocp.deeplumen.io
```

The runner resolves the CLI in this order: `OCP_CLI_COMMAND`, then `OCP_CLI_BIN`, then a bundled
CLI, then an `ocp` binary on `PATH`, then `bunx @ocp-catalog/ocp-cli`, then `npx @ocp-catalog/ocp-cli`.

## Install The Skill Into Your Agent

To use the OCP workflow from an agent without keeping this monorepo around, install the
standalone skill shipped inside the npm package:

```bash
# Install / update / check / remove the skill in a local agent skill directory
ocp skill install --target both
ocp skill update --target auto
ocp skill doctor --target both
```

`--target` accepts `auto`, `codex`, `agents`, `both`, or an explicit skills directory. Once
installed, the agent follows the same CLI-first workflow described above.

Repository contributors can also export the skill directly from source:

```bash
bun run skill:ocp:export
```

## Request Validation In Practice

Add `--manifest` to a query so the CLI validates the request against the Catalog's declared
capabilities before sending it. Use `validate query` to check a proposed request with no network
call at all:

```bash
# Validate a query against a manifest without sending it
ocp validate query --manifest http://localhost:4000/ocp/manifest --query "running shoes" --filters "{\"category\":\"shoes\"}"

# Validate a query at request time (rejects unsupported packs / filters before the call)
ocp catalog query --manifest http://localhost:4000/ocp/manifest --query-url http://localhost:4000/ocp/query --query-pack ocp.query.keyword.v1 --query "running shoes"

# Validate a Catalog manifest itself against the schema
ocp validate manifest http://localhost:4000/ocp/manifest
```

## Command Reference

| Command | What it does |
| --- | --- |
| `registration discover <discovery-url>` | Read a Registration discovery document and find its endpoints. |
| `registration search --registration-url <url> [--query <text>]` | Find Catalog route candidates by metadata. Does not search products. |
| `registration resolve --registration-url <url> --catalog-id <id>` | Resolve a selected Catalog id into a route hint. |
| `catalog inspect <manifest-url>` | Read a Catalog manifest: object types, query packs, filter fields, auth, endpoints. |
| `catalog query --query-url <url> [--query-pack <id>] [--query <text>] [--manifest <ref>]` | Search commercial objects with a manifest-declared query pack. |
| `catalog resolve --resolve-url <url> --entry-id <id>` | Resolve one selected entry for details, freshness, policy, and action bindings. |
| `validate manifest <file-or-url>` | Validate a Catalog manifest against the OCP schema. |
| `validate query --manifest <ref> [...]` | Validate a proposed query against a manifest before sending it. |
| `events tail --activity-url <url> [--limit <n>]` | Read the public, redacted Activity API projection. |
| `skill install / update / doctor / uninstall --target <dest>` | Manage the local `ocp-catalog` agent skill. |

Use `--api-key` when an endpoint requires authorization, and `--correlation-id` to link a command
to server-side activity events. Tracing fields stay in headers — never inside strict OCP request bodies.
