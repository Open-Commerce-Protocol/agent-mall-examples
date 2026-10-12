# Query Contract Principles

This page explains why the current catalog query contract is shaped the way it is.

## Query Packs Are The Primary Search Contract

The agent needs a stable answer to:

> how should I search this catalog?

That answer should come from `query_packs`.

Each pack can describe:

- its pack identifier
- supported query modes
- request schema linkage
- optional metadata hints

## Query Modes Belong To A Pack

`keyword`, `filter`, `semantic`, and `hybrid` only make sense in the context of a specific query pack.

Placing them under `query_packs[*]` keeps the protocol coherent.

## Metadata Carries Search Hints

Hints such as:

- supported query languages
- content languages
- filter field hints
- semantic search notes

should remain optional metadata unless they are truly required for interoperability.

## The Catalog Should Be Explicit About Search Shape

The more realistic the catalog gets, the more important it becomes to expose:

- searchable fields
- filterable fields
- sortable fields
- resolve support

The current protocol already leaves room for this without forcing one monolithic search schema.
