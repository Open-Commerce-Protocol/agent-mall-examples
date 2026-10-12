# X-Ray acceptance scope

Source: the user's hackathon brief and attached Break & Repair lab image.

- Provide a buyer goal, Catalog/Demo selector and a runnable shopping scenario.
- Show Discovery, Manifest, Query and Resolve steps, their actual requests/responses, measured execution times, HTTP statuses and failures.
- Use the repository OCP SDK and schemas rather than parallel protocol models.
- Show returned products, budget/currency evidence, Catalog explanations, source identifiers and safe action entrypoints.
- Demo must work without external services using the repository minimum example and schema-validated fixtures.
- Live must inspect a real Manifest first, query declared packs and resolve a returned entry. Connection failure must be visible. Proxy destinations must be bounded.
- Break & Repair must reproduce a missing price and action, preserve the actual trace, generate a machine-readable diagnostic and a coding-agent handoff, repair the fixture and rerun the protocol.
- Do not represent fixture execution as network latency or deterministic planning as LLM reasoning.
- Validate the implementation, review it and commit locally on the current branch. Remote publication is outside this authorization.

The brief names four areas after saying three; all four fit on one workspace page. Direct Catalog selection is the implemented Discovery path. Registration browsing and LLM providers are outside this first implementation.
