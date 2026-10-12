The CLI turns the standard OCP workflow into commands — discover, search, inspect, query, resolve — and returns structured JSON for both help and results, so agents can act on output without parsing terminal prose.

The most useful piece is manifest-based request validation: before a query is sent, the CLI checks it against the Catalog manifest and rejects an unsupported query pack, an unknown filter field, invalid pagination, or a missing query string — keeping agent parameters clean and moving errors earlier.

It is now published on npm as `@ocp-catalog/ocp-cli`. Install it with `npm install -g @ocp-catalog/ocp-cli`, run it directly with `npx @ocp-catalog/ocp-cli@latest`, or install the bundled standalone skill into your agent. See the docs page CLI & Skill (/docs/cli-and-skill) for the full guide.
