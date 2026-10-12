# Registration Overview

OCP Catalog Registration defines how catalogs register with a registration node and how agents discover them.

The implementation exposes the schema namespace `ocp.catalog.registration.v1` and `Registration*` object names. The protocol role is registration and discovery in a decentralized system, not a central authority.

## Core Responsibility

The Registration node answers:

> Which catalog should I query next?

It does not answer:

> Which object should I choose, and what can I do with it next?

That second question belongs to the catalog itself. A catalog may answer it by resolving a selected entry into a `ResolvableReference` with actions such as `view_product`, `book_slot`, `apply_job`, `send_interview_invite`, or `request_quote`.

## Registration Objects

The package includes:

- `RegistrationDiscovery`
- `RegistrationManifest`
- `CatalogRegistration`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- verification and refresh result types

## Current Runtime Role

In this repository, the Registration node:

- stores catalog registrations
- fetches and indexes manifest snapshots
- exposes catalog search
- returns route hints with trust and health metadata

## Route Hint Principle

The route hint is a summary.

It should tell the agent:

- where the catalog lives
- whether it is trusted and healthy
- which query packs it broadly supports
- which optional metadata hints may help route selection

If the agent needs full capability detail, it should fetch the manifest from `manifest_url`.
