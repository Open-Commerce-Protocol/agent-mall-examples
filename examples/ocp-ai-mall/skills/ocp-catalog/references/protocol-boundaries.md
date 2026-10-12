# Protocol Boundaries

OCP Catalog has separate protocol roles:

- Registration Node: catalog discovery, verification, route hints, and metadata search.
- Catalog Node: manifest, contracts, provider registration, object sync, query, resolve, and action binding exposure.
- Provider: authoritative object source and sync participant.
- Activity API: event ingest, redaction, public projection, and rollups.
- CLI / Skill / MCP / WebMCP / plugins: adapter layers that call the protocol and may emit client-side activity events.

Do not make Registration search commercial objects. Do not make Catalog act as the global telemetry hub. Do not make the website accept raw protocol payloads.

Protocol request bodies are strict. Use a separate activity endpoint and trace headers for observability.
