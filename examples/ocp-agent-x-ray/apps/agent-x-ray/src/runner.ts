import { AsyncLocalStorage } from "node:async_hooks";
import {
  OcpClient,
  validateCatalogQueryRequest,
} from "@ocp-catalog/ocp-client";
import {
  catalogQueryRequestSchema,
  pricePackSchema,
  resolveRequestSchema,
} from "@ocp-catalog/ocp-schema";
import { z } from "zod";
import { fixtureFetch, DEMO_ORIGIN } from "./fixtures";
import { assertAllowedUrl, redact, safeActionUrl } from "./security";
import type { Check, Report, RunEvent, RunInput, Step } from "./types";

export const inputSchema = z
  .object({
    mode: z.enum(["demo", "live"]),
    fault: z.enum(["none", "missing-data", "invalid-schema"]),
    manifestUrl: z.string().max(1000),
    goal: z.string().min(1).max(500),
    query: z.string().min(1).max(500),
    budget: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
type Context = { input: RunInput; origins: string[]; step?: Step };
const context = new AsyncLocalStorage<Context>();
const nativeFetch = globalThis.fetch;
// OcpClient currently has no transport injection. AsyncLocalStorage scopes capture
// to this runner, without changing SDK requests or leaking between concurrent runs.
const tracedFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const ctx = context.getStore();
  if (!ctx) return nativeFetch(input, init);
  const url = input instanceof Request ? input.url : String(input);
  const step = ctx.step;
  if (step) {
    step.url = url;
    step.method = init?.method ?? "GET";
    step.request = init?.body ? JSON.parse(String(init.body)) : null;
  }
  let response: Response;
  if (ctx.input.mode === "demo") {
    if (new URL(url).origin !== DEMO_ORIGIN)
      throw new Error("Fixture request escaped demo origin");
    response = await fixtureFetch(url, init ?? {}, ctx.input.fault);
  } else {
    assertAllowedUrl(url, ctx.origins);
    response = await nativeFetch(url, { ...init, redirect: "error" });
  }
  if (step) {
    step.httpStatus = response.status;
    const raw = await response.clone().text();
    try {
      step.response = redact(JSON.parse(raw));
    } catch {
      step.response = { error: "Response is not JSON", bytes: raw.length };
    }
  }
  return response;
};
globalThis.fetch = Object.assign(tracedFetch, nativeFetch);

export function repairTask(report: Report): string {
  const failures = report.checks.filter((c) => !c.passed);
  return [
    "# OCP Agent X-Ray repair task",
    `Run ${report.runId}. Mode: ${report.mode}. Fixture: ${report.fixture}.`,
    report.mode === "demo"
      ? "Scope: local demo fixture only. Do not modify external Catalogs."
      : "Scope: inspect the Catalog/provider implementation you own. Obtain approval before any remote write.",
    "Use @ocp-catalog/ocp-schema and @ocp-catalog/ocp-client. Preserve manifest-declared packs and strict OCP request bodies.",
    ...failures.map(
      (c) =>
        `- ${c.id} at ${c.step}${c.entryId ? ` / ${c.entryId}` : ""}\n  Evidence: ${c.evidence}\n  Fix: ${c.fix}`,
    ),
    failures.length
      ? "Acceptance: rerun the same input; verify schema, USD budget evidence and HTTP(S) view action. Return the new report.json and compare failed checks. Do not invent prices or URLs."
      : "All executed checks passed. No repair required.",
    report.mode === "demo" && failures.length
      ? "To reproduce and verify the supplied fixture repair: choose Healthy fixture, then rerun the same scenario. The UI repair button does this automatically."
      : "",
    `Input: ${JSON.stringify(redact(report.input))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runScenario(
  raw: RunInput,
  emit: (event: RunEvent) => void = () => {},
  origins = ["http://localhost:4400", "http://127.0.0.1:4400"],
): Promise<Report> {
  const input = inputSchema.parse(raw);
  const report: Report = {
    version: "1.0",
    runId: `xray_${crypto.randomUUID()}`,
    mode: input.mode,
    fixture: input.mode === "demo" ? input.fault : "none",
    startedAt: new Date().toISOString(),
    planner: "deterministic",
    input,
    steps: [],
    checks: [],
    products: [],
    outcome: "running",
  };
  return context.run({ input, origins }, async () => {
    const ctx = context.getStore()!;
    const client = new OcpClient({
      timeoutMs: 8000,
      correlationId: report.runId,
    });
    async function step<T>(
      id: string,
      name: string,
      call: () => Promise<T>,
    ): Promise<T> {
      const current: Step = {
        id,
        name,
        status: "running",
        transport: input.mode === "demo" ? "fixture" : "http",
      };
      report.steps.push(current);
      ctx.step = current;
      emit({ type: "step", step: redact(structuredClone(current)) as Step });
      const start = performance.now();
      try {
        const result = await call();
        current.status = "passed";
        return result;
      } catch (error) {
        current.status = "failed";
        current.error = String(
          redact(error instanceof Error ? error.message : String(error)),
        );
        throw error;
      } finally {
        current.durationMs =
          Math.round((performance.now() - start) * 100) / 100;
        ctx.step = undefined;
        emit({ type: "step", step: redact(structuredClone(current)) as Step });
      }
    }
    const check = (c: Check) => report.checks.push(c);
    try {
      // Direct Catalog discovery is explicitly distinct from Registration discovery.
      const manifestUrl = await step(
        "discovery",
        "Discovery · direct Catalog",
        async () => {
          const url =
            input.mode === "demo"
              ? `${DEMO_ORIGIN}/ocp/manifest`
              : assertAllowedUrl(input.manifestUrl, origins).href;
          ctx.step!.response = {
            source:
              input.mode === "demo"
                ? "repository minimal example"
                : "user supplied manifest URL",
            manifest_url: url,
            registration_search: false,
          };
          return url;
        },
      );
      const manifest = await step("manifest", "Manifest · capabilities", () =>
        client.inspectCatalog(manifestUrl),
      );
      const capability =
        manifest.query_capabilities.find((c) =>
          c.query_packs.some((p) => p.query_modes.includes("keyword")),
        ) ??
        manifest.query_capabilities.find((c) =>
          c.query_packs.some((p) => p.query_modes.includes("semantic")),
        );
      const pack = capability?.query_packs.find(
        (p) =>
          p.query_modes.includes("keyword") ||
          p.query_modes.includes("semantic"),
      );
      const matches = await step(
        "query",
        "Query · product candidates",
        async () => {
          if (!pack)
            throw new Error(
              "No manifest-declared keyword or semantic query pack. This runner requires a text query capability.",
            );
          const request = catalogQueryRequestSchema.parse({
            ocp_version: "1.0",
            kind: "CatalogQueryRequest",
            catalog_id: manifest.catalog_id,
            query: input.query,
            query_pack: pack.pack_id,
            query_mode: pack.query_modes.includes("keyword")
              ? "keyword"
              : "semantic",
            filters: {},
            limit: 12,
            explain: capability?.supports_explain ?? false,
          });
          validateCatalogQueryRequest(manifest, request, {
            queryUrl: manifest.endpoints.query.url,
          });
          const result = await client.queryCatalog(
            manifest.endpoints.query.url,
            request,
          );
          if (
            result.catalog_id !== manifest.catalog_id ||
            result.result_count !== result.entries.length ||
            result.entries.some(
              (m) => m.entry.catalog_id !== manifest.catalog_id,
            )
          )
            throw new Error(
              "Query identity or result count does not match manifest / entries.",
            );
          return result;
        },
      );
      check({
        id: "query.schema",
        passed: true,
        step: "query",
        category: "protocol",
        evidence: `${matches.entries.length} schema-valid entries; pack ${pack!.pack_id}.`,
        fix: "Keep CatalogQueryResult schema-valid.",
      });
      for (const match of matches.entries) {
        const parsedPrice = pricePackSchema.safeParse(
          match.entry.attributes.price,
        );
        const validPrice = parsedPrice.success && parsedPrice.data.amount >= 0;
        const price =
          validPrice && parsedPrice.success ? parsedPrice.data : undefined;
        const eligible =
          !!price &&
          price.currency === input.currency &&
          price.amount <= input.budget;
        const reasons = [...match.explain];
        reasons.push(
          !price
            ? "价格缺失或无效，无法验证预算"
            : price.currency !== input.currency
              ? `币种 ${price.currency} 与 ${input.currency} 不一致，未转换汇率`
              : eligible
                ? `${price.currency} ${price.amount} ≤ ${input.budget}，预算检查通过`
                : `${price.amount} 超出预算 ${input.budget}`,
        );
        report.products.push({
          match,
          amount: price?.amount,
          currency: price?.currency,
          actionUrl: safeActionUrl(match.entry.attributes.product_url),
          eligible,
          reasons,
        });
        check({
          id: "product.price",
          passed: !!price,
          step: "query",
          entryId: match.entry.entry_id,
          category: "product",
          evidence: price
            ? `${price.currency} ${price.amount}`
            : "attributes.price must have a finite nonnegative amount and ISO currency.",
          fix: "Restore the authoritative provider price in attributes.price; do not fabricate a price.",
        });
      }
      const selected =
        [...report.products]
          .filter((p) => p.eligible)
          .sort((a, b) => b.match.score - a.match.score)[0] ??
        report.products.find((p) => p.amount === undefined);
      if (selected) {
        report.selectedEntryId = selected.match.entry.entry_id;
        selected.reasons.push(
          selected.eligible
            ? "在预算合格的候选中 Catalog score 最高；并列时保持 Catalog 顺序"
            : "仅为诊断而 Resolve；价格未知，未推荐购买",
        );
        if (!capability?.supports_resolve)
          throw new Error(
            "Selected query capability does not support Resolve.",
          );
        const resolution = await step(
          "resolve",
          "Resolve · authoritative action",
          async () => {
            const result = await client.resolveCatalogEntry(
              manifest.endpoints.resolve.url,
              resolveRequestSchema.parse({
                ocp_version: "1.0",
                kind: "ResolveRequest",
                catalog_id: manifest.catalog_id,
                entry_id: selected.match.entry.entry_id,
                purpose: "view",
                live_check: true,
              }),
            );
            if (
              result.catalog_id !== manifest.catalog_id ||
              result.entry_id !== selected.match.entry.entry_id
            )
              throw new Error(
                "Resolve identity does not match the selected entry.",
              );
            return result;
          },
        );
        selected.resolution = resolution;
        const fresh = Date.parse(resolution.expires_at) > Date.now();
        const accessGranted =
          !resolution.access ||
          resolution.access.permission_state === "granted";
        const livePassed = !resolution.live_checks.some(
          (c) => c.status === "failed",
        );
        if (selected.amount !== undefined) {
          const resolvedPrice = pricePackSchema.safeParse(
            resolution.visible_attributes.price,
          );
          const budgetPassed =
            resolvedPrice.success &&
            resolvedPrice.data.amount >= 0 &&
            resolvedPrice.data.currency === input.currency &&
            resolvedPrice.data.amount <= input.budget;
          selected.amount = resolvedPrice.success
            ? resolvedPrice.data.amount
            : undefined;
          selected.currency = resolvedPrice.success
            ? resolvedPrice.data.currency
            : undefined;
          selected.eligible = budgetPassed;
          selected.reasons.push(
            budgetPassed
              ? "Resolve 最新价格仍满足预算"
              : "Resolve 最新价格未通过预算校验，撤回候选推荐",
          );
          check({
            id: "resolve.price",
            passed: budgetPassed,
            step: "resolve",
            entryId: selected.match.entry.entry_id,
            category: "product",
            evidence: `Resolved price: ${JSON.stringify(redact(resolution.visible_attributes.price ?? null))}; budget ${input.currency} ${input.budget}.`,
            fix: "Reconcile Query preview with the authoritative Resolve price. Requery and choose an eligible candidate; do not overwrite the actual price to satisfy the budget.",
          });
        }
        check({
          id: "resolve.access",
          passed: accessGranted,
          step: "resolve",
          category: "protocol",
          evidence: resolution.access
            ? JSON.stringify(redact(resolution.access))
            : "No restricted access returned.",
          fix: "Honor Resolve access permission and policy notes. Do not expose an action until access is granted.",
        });
        for (const live of resolution.live_checks)
          check({
            id: `resolve.live.${live.check_id}`,
            passed: live.status !== "failed",
            step: "resolve",
            category: "protocol",
            evidence: JSON.stringify(redact(live)),
            fix: "Inspect the authoritative provider check; repair the reported issue and rerun Resolve. Unknown checks do not prove a successful live verification.",
          });
        selected.eligible =
          selected.eligible && fresh && accessGranted && livePassed;
        selected.actionUrl =
          fresh && accessGranted && livePassed
            ? resolution.action_bindings
                .filter(
                  (a) =>
                    a.action_type === "url" &&
                    a.entrypoint.method === "GET" &&
                    !a.requires_user_confirmation &&
                    (!a.expires_at || Date.parse(a.expires_at) > Date.now()),
                )
                .map((a) => safeActionUrl(a.entrypoint.url))
                .find(Boolean)
            : undefined;
        check({
          id: "resolve.schema",
          passed: true,
          step: "resolve",
          category: "protocol",
          evidence:
            "ResolvableReference parsed by OCP SDK; identity matches selected entry.",
          fix: "Preserve ResolvableReference schema and entry identity.",
        });
        check({
          id: "product.action",
          passed: !!selected.actionUrl,
          step: "resolve",
          entryId: selected.match.entry.entry_id,
          category: "product",
          evidence:
            selected.actionUrl ??
            "No safe HTTP(S) GET view action in action_bindings.",
          fix: "Restore an authoritative action_bindings URL entrypoint with method GET.",
        });
        check({
          id: "resolve.freshness",
          passed: fresh,
          step: "resolve",
          category: "protocol",
          evidence: `expires_at: ${resolution.expires_at}`,
          fix: "Refresh the selected entry and return a future expires_at.",
        });
      } else {
        report.steps.push({
          id: "resolve",
          name: "Resolve · no eligible candidate",
          status: "skipped",
          transport: input.mode === "demo" ? "fixture" : "http",
          response: {
            reason: "No candidate satisfies the stated currency and budget.",
          },
        });
        check({
          id: "selection.empty",
          passed: false,
          step: "query",
          category: "product",
          evidence:
            "No eligible candidates. Search is limited to this response page; no claim about unseen products.",
          fix: "Check the query, budget, currency and provider inventory; do not broaden user constraints silently.",
        });
      }
    } catch (error) {
      const failed = [...report.steps]
        .reverse()
        .find((s) => s.status === "failed");
      check({
        id: "protocol.failure",
        passed: false,
        step: failed?.id ?? "resolve",
        category: "protocol",
        evidence: String(
          redact(error instanceof Error ? error.message : String(error)),
        ),
        fix: "Inspect this step request and raw response. Validate against the matching OCP schema, check declared capabilities, endpoint allowlist and network availability; rerun the same input.",
      });
    }
    for (const s of report.steps)
      if (
        report.checks.some((c) => !c.passed && c.step === s.id) &&
        s.status === "passed"
      )
        s.status = "failed";
    report.outcome = report.checks.some((c) => !c.passed) ? "failed" : "passed";
    report.finishedAt = new Date().toISOString();
    report.repairTask = repairTask(report);
    const safe = redact(report) as Report;
    emit({ type: "report", report: safe });
    return safe;
  });
}
