# OCP Catalog CLI

`@ocp-catalog/ocp-cli` is the command-line tool for the Open Commerce Protocol
Catalog workflow. It helps agents and builders discover Registration nodes,
select Catalog routes, inspect Catalog manifests, query commercial objects,
resolve selected entries, manage the local `ocp-catalog` agent skill, and read
public Activity API events.

## Install

```bash
npm install -g @ocp-catalog/ocp-cli
ocp help
```

You can also run it without a global install:

```bash
npx @ocp-catalog/ocp-cli@latest help
```

## Common Commands

```bash
# Install the bundled agent skill
ocp setup --target auto
ocp skill doctor --target both

# Discover and inspect OCP endpoints
ocp registration search --registration-url https://ocp.deeplumen.io/registry --query "commerce"
ocp catalog inspect http://localhost:4000/ocp/manifest

# Validate before sending a Catalog query
ocp validate query --manifest http://localhost:4000/ocp/manifest --query "running shoes"

# Read redacted public activity events
ocp events tail --activity-url https://ocp.deeplumen.io
```

## Skill Workflow

The package ships the standalone `ocp-catalog` skill. Install it into a local
agent skill directory when an agent should use OCP without a monorepo checkout:

```bash
ocp skill install --target both
ocp skill update --target auto
ocp skill doctor --target both
```

`--target` accepts `auto`, `codex`, `agents`, `both`, or an explicit skills
directory.

## Error Handling

The CLI is intentionally fail-loud. Manifest validation rejects unsupported query
packs, undeclared filter fields, invalid pagination, malformed payloads, and
unreachable endpoints with structured JSON errors instead of silently returning
empty successful results.

## Documentation

Full docs live in the OCP Catalog site and repository:

- https://github.com/Open-Commerce-Protocol/OCP-Catalog
- https://www.npmjs.com/package/@ocp-catalog/ocp-cli
