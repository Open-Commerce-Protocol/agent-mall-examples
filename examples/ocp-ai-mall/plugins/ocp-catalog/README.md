# OCP Catalog — Claude Code plugin

Agent tooling for the [Open Commerce Protocol](https://github.com/Open-Commerce-Protocol/OCP-Catalog)
Catalog: discover Registration nodes, inspect Catalog manifests, query entries
with manifest-declared query packs, resolve selected entries, and validate OCP
payloads.

## Install

```
/plugin marketplace add Open-Commerce-Protocol/OCP-Catalog
/plugin install ocp-catalog@ocp-catalog
```

Not using Claude Code? `npx @ocp-catalog/skill` installs the same skill for
Codex and other agents that read a skills directory.

## What it provides

The `ocp-catalog` skill, which drives the [`ocp`
CLI](https://www.npmjs.com/package/@ocp-catalog/ocp-cli) rather than
hand-writing HTTP calls, and keeps the protocol layers distinct: a Registration
node searches Catalog *metadata*, a Catalog node searches and resolves
*commercial objects*.

## Source of truth

> This directory is **generated**. The skill lives at
> [`skills/ocp-catalog/`](../../skills/ocp-catalog) in the repo root; run
> `bun run skill:sync` after editing it. `bun run skill:check` fails if this
> copy has drifted.
