# OCP Site Web

This app is the public OCP website for the OCP Catalog demo workspace. It
contains the official homepage, protocol documentation, and latest updates.

## Purpose

It provides:

- the Open Commerce Protocol homepage
- latest updates for protocol, docs, examples, and implementation progress
- OCP Catalog overview and roles
- `ocp.catalog.handshake.v1`
- `ocp.catalog.registration.v1`
- example flows and implementation notes

## Content Model

Docs Markdown content lives under [`src/content`](./src/content):

- `docs/` for top-level protocol pages.
- `handshake/` for `ocp.catalog.handshake.v1` pages.
- `registration/` for `ocp.catalog.registration.v1` pages.
- `examples/` for scenario walkthroughs and runtime flows.
- `locales/zh/` for the Chinese mirror of the same route tree.

The latest updates model currently lives in
[`src/content/updates.ts`](./src/content/updates.ts).

The left navigation defines the canonical route structure in
[`src/content/navigation.ts`](./src/content/navigation.ts).

The rendered site intentionally has its own user-facing Markdown. Formal
protocol and architecture source documents live under the repository root
[`docs`](../../docs):

- `docs/specs/` for stable protocol specifications.
- `docs/architecture/` for system and repository architecture.
- `docs/integrations/` for scenario and platform integration designs.
- `docs/archive/` for superseded planning material.

Keep these layers aligned through review and integrity checks; do not add a
second untracked copy of protocol truth in the site.

## Development

From the repository root:

```bash
bun run site:dev
```

Or from this app directly:

```bash
bun run dev
```

## Current behavior

- `/` is the public homepage
- `/docs` is the documentation landing page
- `/docs/*` pages are markdown-driven
- `/updates` and `/updates/:slug` are update-driven pages
- `/zh/*` is the Chinese route mirror
- right-side table of contents is generated from page headings

## Integrity

Run the site integrity check from the repository root before changing route
structure or artifacts:

```bash
bun run site:check
```
