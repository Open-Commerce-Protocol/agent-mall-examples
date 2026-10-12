# Verification And Refresh

The Registration node package also includes control-plane objects for catalog verification, refresh, and token rotation.

## Verification Request

The current verification request is intentionally small.

```json
{
  "properties": {
    "ocp_version": { "const": "1.0" },
    "kind": { "const": "CatalogVerificationRequest" },
    "challenge_id": { "type": "string" }
  }
}
```

Registration nodes may use this object when they want an extra verification handshake, but the protocol does not require every registration node to gate registration on a DNS or HTTPS challenge.

## Refresh Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "status",
    "health_status",
    "indexed",
    "warnings",
    "refreshed_at"
  ]
}
```

This result tells the catalog whether a refresh successfully produced a healthy, indexable snapshot.

## Token Rotation Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "catalog_access_token",
    "token_issued_at"
  ]
}
```

## Why These Objects Matter

These objects do not affect agent-facing product search directly, but they matter for operating a multi-catalog network:

- verification keeps registration trustworthy
- refresh keeps snapshots current
- token rotation keeps operational access bounded
