# User And Agent Flow

This example flow shows how a user-side agent consumes the protocol.

## Lifecycle

```text
User states intent
-> agent checks local catalog profiles
-> if empty, agent searches Registration node
-> agent selects a candidate catalog
-> user confirms local registration
-> agent queries catalog
-> agent resolves a chosen result
```

## Repository Implementation

The current user demo does two important things:

- it does not expose raw tool results directly to the user
- it lets the agent digest Registration node and Catalog responses and then explain them

The current repository example is now more concrete than a generic "search some catalog" flow:

- Registration node search returns a route hint for the commerce catalog
- the agent queries the commerce catalog with a supported query pack such as `ocp.query.keyword.v1`; `ocp.commerce.product.search.v1` is the catalog capability, not the query pack
- the catalog can use keyword, filter, hybrid, and optionally semantic retrieval
- query results now carry commerce attributes such as price, image, availability, and quality tier
- the agent resolves a selected `entry_id`, not just an `object_id`

The commerce demo resolves to `view_product` because that is the narrow action implemented in this repository. The protocol idea is broader: resolve is the boundary where a chosen entry becomes the next executable step for the caller.

Other catalogs can resolve entries into actions such as:

- `buy_now` for commerce
- `book_slot` for local services
- `apply_job` or `submit_resume` for job search
- `send_interview_invite` for recruiting
- `request_quote` for B2B services

## Why Registration node And Catalog Stay Separate

The agent first solves:

> which catalog should I use?

Then it solves:

> which product from that catalog should I surface?

Keeping those decisions separate is the main point of the two-layer protocol split.

## Current Repository Example

The current verified path in this workspace looks like:

```text
User asks for travel headphones
-> agent searches Registration node for a commerce-capable catalog
-> agent receives the commerce catalog route hint
-> agent queries that catalog with price/image/availability-aware ranking
-> agent gets back rich and basic product candidates
-> agent resolves the chosen entry into a ResolvableReference with visible product fields and view_product action
```

The same shape can apply outside commerce:

```text
User asks for a dentist appointment next Tuesday
-> agent searches Registration node for a local-service catalog
-> agent queries that catalog for clinics, doctors, and available slots
-> agent resolves one slot into a ResolvableReference with book_slot action
```
