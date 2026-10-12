# Resolve And Actions

`resolve` is the step that turns a candidate catalog entry into the next executable reference for the current user, context, policy, and object state.

It is not limited to opening a detail page. A URL is only the simplest possible action binding.

## The Core Idea

Query answers:

> What candidates exist?

Resolve answers:

> What can this caller do next with this candidate?

That next step can be a page, an API call, a workflow entry, a guarded contact channel, or a domain-specific action exposed by an action provider.

## Why Resolve Is Separate From Query

Search results should stay fast, cacheable, explainable, and safe to show broadly.

Resolve can be stricter. It can apply current permissions, check freshness, expose guarded fields, confirm availability, and return action bindings only when the caller is allowed to use them.

This separation lets the protocol support very different industries without forcing every search result to carry every possible execution detail.

## Examples

```text
commerce product
-> resolve can return view_product, add_to_cart, buy_now, request_quote

local service
-> resolve can return view_store, book_slot, request_appointment

job search
-> resolve can return view_job, apply_job, submit_resume

talent recruiting
-> resolve can return view_profile, request_contact, send_interview_invite

B2B service
-> resolve can return view_capability, request_quote, start_procurement_flow
```

## ResolvableReference

A `ResolvableReference` is the standard resolve output.

It can include:

- visible attributes for the current caller
- provenance and freshness
- permission state
- match explanation
- live checks such as availability, eligibility, access, or endpoint health
- action bindings

The reference is contextual. It is not the same thing as a permanent object ID, a complete object record, or a guaranteed final transaction.

## Action Binding

An action binding describes a next step the caller may take.

Typical fields include:

```json
{
  "action_id": "book_slot",
  "action_type": "api",
  "label": "Book appointment",
  "url": "https://service.example.com/appointments/book",
  "method": "POST",
  "input_schema": "https://service.example.com/schemas/book-slot-request.json"
}
```

The catalog exposes the action entrance and calling requirements. It does not become the booking system, order system, ATS, CRM, ERP, or approval workflow.

That boundary matters: OCP Catalog standardizes discovery, resolution, and action exposure while leaving execution and state transitions close to the authoritative service.

## Phase Discipline

Search, resolve, and action have different visibility, freshness, permission, and audit profiles.

- Search should not expose pricing internals, exact inventory, contact information, or payment credentials.
- Resolve is not bulk detail retrieval. Call it after a user or agent has selected a candidate and needs restricted fields, live validation, or an action entry point.
- Action happens through the Action Provider or business system after confirmation, idempotency, expiry, schema, and risk checks pass.

Concrete integrations follow the same shape: browser demos may expose search tools, commerce providers map resolve to checkout creation, and payment-aware agents create checkout only after resolve and explicit user authorization.
