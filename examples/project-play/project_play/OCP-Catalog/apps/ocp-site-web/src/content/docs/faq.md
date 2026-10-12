# FAQ

This page answers the simplest practical questions that new builders usually ask first.

## Do I Need A Domain To Register A Catalog To A Registration node?

For local development in the current repository, no. The demo Registration node does not require an extra domain-verification challenge.

For public or production-style participation, usually yes:

- many registration nodes will want a stable domain
- many registration nodes will require HTTPS
- domain verification is how a Registration node decides whether to trust and index your catalog

So the short answer is:

- local demo: domain not required
- public network participation: expect to need one

## Does A Provider Need Its Own Public Endpoint?

Not always.

In the current repository's main example, the negotiated capability is `ocp.push.batch`, so the provider can simply push registration and objects into the catalog's endpoints.

You only need provider-hosted endpoints when the selected capability requires them, for example:

- provider-hosted feed pull
- provider-hosted API pull
- streaming or webhook-style delivery

## Does A Provider Need To Be Always On?

Not always.

Under the current push-based example:

- the provider does not need to be a long-running public service just to stay registered
- it only needs to be available when it performs registration or object sync

But under pull- or stream-based models, the answer changes:

- a provider-hosted feed or API should stay available
- a streaming provider may need a more persistent runtime

## Does A Catalog Need To Be Always On?

In practice, yes, if you want agents to query it.

A catalog is the query-serving node. If it goes offline:

- the Registration node may still have a route hint
- but real query and resolve calls will fail
- health checks may mark it unhealthy

So a catalog is usually a long-running service.

## Does A Provider Need To Store Registration Versions?

Yes, or at least manage them deterministically.

Registration is versioned for a reason:

- catalogs use the version to decide which declaration is active
- stale versions should not silently win
- sync requests may be required to match the active registration version

In other words, registration version is not just metadata. It is part of the runtime contract boundary.

## Can I Join OCP Without Using One Official Registration node?

Yes.

OCP is not designed around one mandatory global Registration node:

- anyone can run an OCP Catalog Registration node
- catalogs can register with one registration node, many registration nodes, or a private registration node
- agents can decide which registration node or nodes they trust

One public Registration node may be useful for discovery, but it does not centralize the protocol itself.

## Can I Run A Private Registration node?

Yes.

A private Registration node can be useful for:

- internal enterprise routing
- vertical or domain-specific catalog discovery
- curated trust policies
- staging and partner integration

Nothing in the protocol requires a Registration node to be public.

## What Is The Smallest Useful Catalog I Can Build?

A very small catalog can still be useful if it can:

- expose discovery
- expose a manifest
- answer query requests
- optionally resolve entries

If it also wants provider onboarding, then it should additionally support provider registration and object sync.

The minimal concrete example in this repository's docs is the `hello_catalog` pattern in [Getting Started](/getting-started):

- one boolean field: `example_filed`
- one deterministic query response
- one catalog registration request to a Registration node

## What Is The Smallest Useful Provider I Can Build?

A very small provider can still participate if it can:

- build a valid `ProviderRegistration`
- send that registration to a catalog
- map its source data into valid `CommercialObject` payloads
- sync those payloads with a supported capability

It does not need to model every optional field on day one.

## What Happens After Registration?

### Catalog -> Registration node

Typical lifecycle:

```text
register
-> fetch discovery/manifest
-> verify
-> index
-> refresh over time
```

### Provider -> Catalog

Typical lifecycle:

```text
register
-> registration becomes active
-> sync objects
-> catalog projects objects into entries
-> query/resolve becomes useful to downstream agents
```

## Where Should I Start If I Want To Build?

Start here:

- [Getting Started](/getting-started)
- [Minimal Catalog](/examples/minimal-catalog)
- [Minimal Provider](/examples/minimal-provider)
- [Roles](/roles)
- [Provider Flow](/examples/provider-flow)
- [Registration Flow](/examples/registration-flow)
