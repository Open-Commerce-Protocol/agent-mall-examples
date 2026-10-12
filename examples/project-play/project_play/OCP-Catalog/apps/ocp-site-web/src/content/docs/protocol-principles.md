# Protocol Principles

This page captures the main design principles behind the current OCP Catalog protocol shape.

## Keep The Protocol Split By Responsibility

The protocol is intentionally divided into:

- `Provider -> Catalog`
- `Catalog -> Registration node`

This separation avoids forcing one schema package to carry both supply-side and discovery-side concerns.

## Keep The Minimal Core Small

The minimal protocol should only freeze what is required for interoperable routing and object exchange.

Examples:

- identity
- endpoint discovery
- versioned registration
- route hints
- shared object envelope

Everything else should be evaluated carefully before becoming a required top-level field.

## Favor Stable Contracts Over Convenience Flags

The protocol should tell an agent how to interact through structured contracts, not through ad hoc flags alone.

That is why `query_packs` matter more than a flat list of modes.

## Treat Hints As Hints

Language support, semantic search guidance, ranking notes, and similar metadata are valuable, but they should not automatically become hard protocol axes.

The current design places these under `metadata` so they remain useful without bloating the required shape.

## Separate Route Selection From Object Retrieval

Registration node should help answer:

> which catalog should I ask?

Catalog should help answer:

> which object should I return?

Keeping these stages separate is one of the main reasons the current design scales beyond a single catalog.

## Treat Resolve As The Next-Step Boundary

Query should not be forced to carry every execution detail.

Resolve is where a selected candidate becomes a contextual `ResolvableReference`: visible fields, permissions, freshness checks, and action bindings for what the caller can do next.

Those action bindings can point to pages, APIs, contact channels, or workflow entries. The catalog exposes the entrance, but the authoritative service still owns the actual order, booking, application, invitation, quote, or approval state machine.

## Versioned Declarations Are Required

Both provider registration and catalog registration are versioned for a reason:

- they make changes auditable
- they prevent stale writes from silently winning
- they give sync operations a clear contract boundary
