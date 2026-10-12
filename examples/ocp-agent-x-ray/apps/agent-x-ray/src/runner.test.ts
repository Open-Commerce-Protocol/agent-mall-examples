import { describe, expect, test } from "bun:test";
import { runScenario } from "./runner";
import { assertAllowedUrl, redact, safeActionUrl } from "./security";
import { handle as example } from "../../../examples/typescript/src/server";
import type { RunInput } from "./types";
const input: RunInput = {
  mode: "demo",
  fault: "none",
  manifestUrl: "",
  goal: "帮我找 200 美元以内的无线耳机",
  query: "headphones",
  budget: 200,
  currency: "USD",
};
describe("OCP shopping and repair", () => {
  test("repository fixture executes all protocol steps and selects within budget", async () => {
    const report = await runScenario(input);
    expect(report.outcome).toBe("passed");
    expect(report.steps.map((s) => s.id)).toEqual([
      "discovery",
      "manifest",
      "query",
      "resolve",
    ]);
    expect(report.products[0]?.amount).toBe(199);
    expect(report.products[0]?.actionUrl).toBe(
      "https://example.com/products/aurora-headphones",
    );
    expect(report.steps[2]?.httpStatus).toBe(200);
    expect(report.steps.every((s) => s.durationMs !== undefined)).toBe(true);
  });
  test("broken product data keeps protocol responses and repair reruns every step", async () => {
    const broken = await runScenario({ ...input, fault: "missing-data" });
    expect(broken.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([
      "product.price",
      "product.action",
    ]);
    expect(broken.products[0]?.eligible).toBe(false);
    expect(broken.steps[2]?.httpStatus).toBe(200);
    expect(broken.steps[3]?.httpStatus).toBe(200);
    expect(broken.repairTask).toContain("Do not invent prices or URLs");
    const repaired = await runScenario({ ...broken.input, fault: "none" });
    expect(repaired.runId).not.toBe(broken.runId);
    expect(repaired.outcome).toBe("passed");
  });
  test("malformed query retains raw evidence and stops before Resolve", async () => {
    const report = await runScenario({ ...input, fault: "invalid-schema" });
    expect(report.outcome).toBe("failed");
    expect(report.steps.find((s) => s.id === "query")?.response).toHaveProperty(
      "entries",
      "invalid fixture: entries must be an array",
    );
    expect(report.steps.some((s) => s.id === "resolve")).toBe(false);
  });
  test("budget and currency cannot silently recommend an ineligible product", async () => {
    for (const extra of [
      { budget: 100 },
      { currency: "EUR" },
      { query: "no-match-xyz" },
    ]) {
      const report = await runScenario({ ...input, ...extra });
      expect(report.selectedEntryId).toBeUndefined();
      expect(report.outcome).toBe("failed");
      expect(report.steps.at(-1)?.status).toBe("skipped");
    }
  });
  test("concurrent runs do not share faults or trace response state", async () => {
    const [good, bad] = await Promise.all([
      runScenario(input),
      runScenario({ ...input, fault: "missing-data" }),
    ]);
    expect(good.outcome).toBe("passed");
    expect(bad.outcome).toBe("failed");
  });
  test("live SDK calls use real HTTP and preserve measured response", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req): Promise<Response> {
        const response = await example(req);
        return new Response(
          (await response.text()).replaceAll(
            "http://localhost:4400",
            `http://127.0.0.1:${server.port}`,
          ),
          { status: response.status, headers: response.headers },
        );
      },
    });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const report = await runScenario(
        { ...input, mode: "live", manifestUrl: `${origin}/ocp/manifest` },
        undefined,
        [origin],
      );
      expect(report.outcome).toBe("passed");
      expect(report.steps[1]?.transport).toBe("http");
      expect(report.steps[3]?.httpStatus).toBe(200);
    } finally {
      server.stop(true);
    }
  });
  test("live connection failure never falls back to fixture", async () => {
    const report = await runScenario(
      {
        ...input,
        mode: "live",
        manifestUrl: "http://127.0.0.1:1/ocp/manifest",
      },
      undefined,
      ["http://127.0.0.1:1"],
    );
    expect(report.outcome).toBe("failed");
    expect(report.products).toHaveLength(0);
    expect(report.steps[1]?.transport).toBe("http");
  });
});
test("proxy bounds and export redaction", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://169.254.169.254/latest",
    "http://user:pass@localhost:4400/ocp",
    "http://localhost:4400/?token=secret",
  ])
    expect(() => assertAllowedUrl(url, ["http://localhost:4400"])).toThrow();
  expect(
    redact({
      token: "example-test-secret",
      nested: {
        url: "https://example.com/p?token=test",
        auth_requirements: { api_key: "test" },
      },
    }),
  ).toEqual({
    token: "[REDACTED]",
    nested: { url: "https://example.com/p", auth_requirements: "[REDACTED]" },
  });
  expect(safeActionUrl("javascript:alert(1)")).toBeUndefined();
});

async function mutatedLive(
  mutate: (body: any, path: string) => void,
  emit?: Parameters<typeof runScenario>[1],
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const response = await example(req);
      const body = JSON.parse(
        (await response.text()).replaceAll(
          "http://localhost:4400",
          `http://127.0.0.1:${server.port}`,
        ),
      );
      mutate(body, new URL(req.url).pathname);
      return Response.json(body, { status: response.status });
    },
  });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    return await runScenario(
      { ...input, mode: "live", manifestUrl: `${origin}/ocp/manifest` },
      emit,
      [origin],
    );
  } finally {
    server.stop(true);
  }
}
test("streamed evidence redacts a credential URL even when rejected before fetch", async () => {
  const events: unknown[] = [];
  const report = await mutatedLive(
    (body, path) => {
      if (path === "/ocp/manifest")
        body.endpoints.query.url += "?token=synthetic_credential_marker";
    },
    (event) => events.push(event),
  );
  expect(report.outcome).toBe("failed");
  expect(JSON.stringify(events)).not.toContain("synthetic_credential_marker");
});
test("Resolve authoritative price invalidates a stale budget recommendation", async () => {
  const report = await mutatedLive((body, path) => {
    if (path === "/ocp/resolve") body.visible_attributes.price.amount = 299;
  });
  expect(report.outcome).toBe("failed");
  expect(report.products[0]?.amount).toBe(299);
  expect(report.products[0]?.eligible).toBe(false);
  expect(report.checks.find((c) => c.id === "resolve.price")?.passed).toBe(
    false,
  );
});
test("failed live checks, denied access and expired actions suppress unsafe evidence", async () => {
  for (const fault of ["live", "access", "expiry", "reference-expiry"]) {
    const report = await mutatedLive((body, path) => {
      if (path !== "/ocp/resolve") return;
      if (fault === "live")
        body.live_checks = [
          {
            check_id: "inventory",
            status: "failed",
            checked_at: new Date().toISOString(),
            summary: "Out of stock",
          },
        ];
      if (fault === "access") body.access = { permission_state: "denied" };
      if (fault === "expiry")
        body.action_bindings[0].expires_at = "2000-01-01T00:00:00.000Z";
      if (fault === "reference-expiry")
        body.expires_at = "2000-01-01T00:00:00.000Z";
    });
    expect(report.outcome).toBe("failed");
    expect(report.products[0]?.actionUrl).toBeUndefined();
  }
});
test("live check detail secrets are redacted before becoming string evidence", async () => {
  const report = await mutatedLive((body, path) => {
    if (path === "/ocp/resolve")
      body.live_checks = [
        {
          check_id: "inventory",
          status: "failed",
          checked_at: new Date().toISOString(),
          details: { token: "synthetic_live_secret" },
        },
      ];
  });
  expect(JSON.stringify(report)).not.toContain("synthetic_live_secret");
  expect(
    report.checks.find((c) => c.id === "resolve.live.inventory")?.evidence,
  ).toContain("[REDACTED]");
});
test("URL redaction is case-insensitive", () => {
  expect(
    String(redact("HTTPS://EXAMPLE.COM/path?token=synthetic_uppercase_secret")),
  ).not.toContain("synthetic_uppercase_secret");
});
