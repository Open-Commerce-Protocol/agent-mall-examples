import { handle } from "../../../examples/typescript/src/server";
import {
  catalogManifestSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
} from "@ocp-catalog/ocp-schema";
import type { Fault } from "./types";
export const DEMO_ORIGIN = "https://fixture.ocp.invalid";
// Reuse the repository's minimal Catalog, including its real OCP response shapes.
export async function fixtureFetch(
  url: string,
  init: RequestInit,
  fault: Fault,
): Promise<Response> {
  const request = new Request(url, init);
  const source = await handle(request);
  if (!source.ok) return source;
  const body = await source.json();
  if (body.endpoints)
    for (const endpoint of Object.values(body.endpoints) as { url: string }[])
      endpoint.url = `${DEMO_ORIGIN}${new URL(endpoint.url).pathname}`;
  const path = new URL(url).pathname;
  if (path === "/ocp/manifest") catalogManifestSchema.parse(body);
  if (path === "/ocp/query") {
    catalogQueryResultSchema.parse(body);
    if (fault === "missing-data" && body.entries[0]) {
      delete body.entries[0].entry.attributes.price;
      delete body.entries[0].entry.attributes.product_url;
    }
    if (fault === "invalid-schema")
      body.entries = "invalid fixture: entries must be an array";
  }
  if (path === "/ocp/resolve") {
    resolvableReferenceSchema.parse(body);
    if (fault === "missing-data") {
      delete body.visible_attributes.price;
      body.action_bindings = [];
    }
  }
  return Response.json(body);
}
