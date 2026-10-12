import type {
  CatalogEntryMatch,
  ResolvableReference,
} from "@ocp-catalog/ocp-schema";
export type Fault = "none" | "missing-data" | "invalid-schema";
export type RunInput = {
  mode: "demo" | "live";
  fault: Fault;
  manifestUrl: string;
  goal: string;
  query: string;
  budget: number;
  currency: string;
};
export type Step = {
  id: string;
  name: string;
  status: "running" | "passed" | "failed" | "skipped";
  method?: string;
  url?: string;
  request?: unknown;
  response?: unknown;
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  transport: "fixture" | "http";
};
export type Check = {
  id: string;
  passed: boolean;
  step: string;
  entryId?: string;
  evidence: string;
  fix: string;
  category: "protocol" | "product";
};
export type ProductEvidence = {
  match: CatalogEntryMatch;
  amount?: number;
  currency?: string;
  actionUrl?: string;
  eligible: boolean;
  reasons: string[];
  resolution?: ResolvableReference;
};
export type Report = {
  version: "1.0";
  runId: string;
  mode: "demo" | "live";
  fixture: Fault;
  startedAt: string;
  finishedAt?: string;
  planner: "deterministic";
  input: RunInput;
  steps: Step[];
  checks: Check[];
  products: ProductEvidence[];
  selectedEntryId?: string;
  outcome: "running" | "passed" | "failed";
  repairTask?: string;
};
export type RunEvent =
  | { type: "step"; step: Step }
  | { type: "report"; report: Report }
  | { type: "error"; error: string };
