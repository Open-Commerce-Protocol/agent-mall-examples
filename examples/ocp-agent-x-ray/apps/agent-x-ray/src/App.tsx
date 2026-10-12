import { lazy, Suspense, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  Copy,
  Download,
  FlaskConical,
  Headphones,
  LoaderCircle,
  Play,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "./components/ui/button";
const Trace = lazy(() =>
  import("./Trace").then((module) => ({ default: module.Trace })),
);
import type { Fault, Report, RunEvent, RunInput, Step } from "./types";
const initial: RunInput = {
  mode: "demo",
  fault: "none",
  manifestUrl: "http://localhost:4400/ocp/manifest",
  goal: "帮我找 200 美元以内的无线耳机",
  query: "headphones",
  budget: 200,
  currency: "USD",
};
function download(report: Report) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "report.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const reduced = useReducedMotion();
  const [input, setInput] = useState(initial);
  const [steps, setSteps] = useState<Step[]>([]);
  const [report, setReport] = useState<Report>();
  const [before, setBefore] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("query");
  const [tab, setTab] = useState<"response" | "request">("response");
  const [message, setMessage] = useState("");
  const [origins, setOrigins] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setOrigins(c.allowedOrigins))
      .catch(() => {});
  }, []);
  const failed = report?.checks.filter((c) => !c.passed) ?? [];
  const activeStep = steps.find((s) => s.id === selected);
  const passed = report?.checks.filter((c) => c.passed).length ?? 0;
  const isBroken = input.mode === "demo" && input.fault !== "none";
  function update<K extends keyof RunInput>(key: K, value: RunInput[K]) {
    setInput((s) => ({ ...s, [key]: value }));
  }
  function plan(goal: string) {
    setInput((s) => ({
      ...s,
      goal,
      query: /耳机|headphone|earbud/i.test(goal)
        ? "headphones"
        : goal.trim() || s.query,
      budget: Number(
        goal.match(/(?:\$\s*|USD\s*)(\d+(?:\.\d+)?)/i)?.[1] ??
          goal.match(/(\d+(?:\.\d+)?)\s*(?:美元|美金|USD)/i)?.[1] ??
          s.budget,
      ),
    }));
  }
  async function run(next = input, repairing = false) {
    setBusy(true);
    setSteps([]);
    setReport(undefined);
    setMessage("");
    setSelected("query");
    if (!repairing) setBefore(undefined);
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Streaming unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let finalReceived = false;
      function consume(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line) as RunEvent;
        if (event.type === "step")
          setSteps((s) => [
            ...s.filter((x) => x.id !== event.step.id),
            event.step,
          ]);
        if (event.type === "report") {
          finalReceived = true;
          setReport(event.report);
          setSteps(event.report.steps);
        }
        if (event.type === "error") throw new Error(event.error);
      }
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop()!;
        lines.forEach(consume);
        if (done) {
          consume(pending);
          break;
        }
      }
      if (!finalReceived)
        throw new Error(
          "Connection closed before report completed. Rerun to verify.",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function copyTask() {
    if (!report?.repairTask) return;
    try {
      await navigator.clipboard.writeText(report.repairTask);
      setMessage("修复任务已复制，可交给 Codex 或 Claude Code。");
    } catch {
      setMessage(
        "浏览器未授予剪贴板权限。可从下方选中任务文本复制，或下载 report.json。",
      );
    }
  }
  function repair() {
    if (!report || report.mode !== "demo") return;
    setBefore(report);
    const next = { ...report.input, fault: "none" as Fault };
    setInput(next);
    void run(next, true);
  }
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand-mark">
          <ScanLine size={25} />
        </div>
        <a
          className="rail-item active"
          href="#workspace"
          aria-label="X-Ray workspace"
        >
          <Activity size={20} />
        </a>
        <a className="rail-item" href="#repair" aria-label="Break and repair">
          <FlaskConical size={20} />
        </a>
        <a className="rail-item" href="#evidence" aria-label="Product evidence">
          <ShieldCheck size={20} />
        </a>
        <span className="rail-line" />
        <span className="rail-bottom">
          OCP
          <br />
          1.0
        </span>
      </aside>
      <div className="workspace" id="workspace">
        <header className="topbar">
          <a href="#workspace" className="brand">
            OCP <span>Agent X-Ray</span>
            <span className="badge muted">LAB / 01</span>
          </a>
          <div className="top-right">
            <span className="local-dot" /> LOCAL WORKSPACE
            <span className="separator" />
            <span>PROTOCOL v1.0</span>
          </div>
        </header>
        <main>
          <motion.div
            className="hero"
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div>
              <div className="eyebrow">
                <span /> THE AI COMMERCE INSPECTOR
              </div>
              <h1>
                Watch it shop.
                <br />
                <span>Understand every step.</span>
              </h1>
              <p>看见购物调用，检查推荐证据，把故障交给 Coding Agent。</p>
            </div>
            <div className="hero-note">
              <ScanLine size={38} />
              <span>
                DISCOVER. INSPECT.
                <br />
                BREAK. REPAIR.
              </span>
              <small>One scenario. Every protocol call.</small>
            </div>
          </motion.div>
          <div className="scenario panel">
            <div className="section-title">
              <div>
                <span className="index">01</span>
                <h2>Buyer scenario</h2>
              </div>
              <span className="badge">
                <CircleDot size={12} />{" "}
                {input.mode === "demo" ? "OFFLINE FIXTURE" : "REAL HTTP"}
              </span>
            </div>
            <div className="scenario-row">
              <div className="goal-input">
                <Terminal size={18} />
                <input
                  aria-label="购物目标"
                  value={input.goal}
                  onChange={(e) => plan(e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button
                onClick={() => void run()}
                disabled={busy || !input.goal.trim() || !input.query.trim()}
                className="run-button"
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
                {busy ? "Tracing…" : "Run scenario"}
                <span>↵</span>
              </Button>
            </div>
            <div className="scenario-options">
              <div className="mode-toggle">
                <button
                  disabled={busy}
                  className={input.mode === "demo" ? "chosen" : ""}
                  onClick={() => update("mode", "demo")}
                >
                  <FlaskConical size={13} /> Demo
                </button>
                <button
                  disabled={busy}
                  className={input.mode === "live" ? "chosen" : ""}
                  onClick={() => update("mode", "live")}
                >
                  <Zap size={13} /> Live
                </button>
              </div>
              {input.mode === "demo" ? (
                <label className="catalog-select">
                  CATALOG
                  <select
                    aria-label="故障样例"
                    disabled={busy}
                    value={input.fault}
                    onChange={(e) => update("fault", e.target.value as Fault)}
                  >
                    <option value="none">Minimal Catalog · healthy</option>
                    <option value="missing-data">
                      Break & Repair · missing data
                    </option>
                    <option value="invalid-schema">
                      Break & Repair · invalid schema
                    </option>
                  </select>
                </label>
              ) : (
                <label className="catalog-select live-url">
                  MANIFEST
                  <input
                    aria-label="Live manifest URL"
                    disabled={busy}
                    value={input.manifestUrl}
                    onChange={(e) => update("manifestUrl", e.target.value)}
                  />
                </label>
              )}
              <label className="query-input">
                QUERY
                <input
                  aria-label="查询关键词"
                  disabled={busy}
                  value={input.query}
                  onChange={(e) => update("query", e.target.value)}
                />
              </label>
              <label className="budget-input">
                BUDGET
                <input
                  aria-label="预算"
                  type="number"
                  min="0"
                  disabled={busy}
                  value={input.budget}
                  onChange={(e) =>
                    update("budget", Math.max(0, Number(e.target.value)))
                  }
                />
                <select
                  aria-label="币种"
                  disabled={busy}
                  value={input.currency}
                  onChange={(e) => update("currency", e.target.value)}
                >
                  <option>USD</option>
                  <option>EUR</option>
                  <option>CNY</option>
                </select>
              </label>
            </div>
            <div className="scenario-foot">
              规则规划器 · 可编辑查询 ·
              预算在客户端证据层检查，不发送未声明的过滤字段
              {input.mode === "live" && (
                <span>允许来源：{origins.join(", ") || "读取中"}</span>
              )}
            </div>
          </div>
          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}
          <div className="main-grid">
            <section className="trace-panel panel">
              <div className="section-title">
                <div>
                  <span className="index">02</span>
                  <h2>Protocol trace</h2>
                </div>
                <span
                  className={`badge ${report?.outcome === "failed" ? "danger" : ""}`}
                >
                  {busy
                    ? "RUNNING"
                    : report
                      ? report.outcome.toUpperCase()
                      : "READY TO INSPECT"}
                </span>
              </div>
              <Suspense
                fallback={
                  <div className="trace-canvas" aria-label="加载协议流程图" />
                }
              >
                <Trace
                  steps={steps}
                  selected={selected}
                  onSelect={setSelected}
                />
              </Suspense>
              <div className="inspector">
                <div className="inspector-header">
                  <div className="inspector-tabs">
                    <button
                      className={tab === "response" ? "selected" : ""}
                      onClick={() => setTab("response")}
                    >
                      Response
                    </button>
                    <button
                      className={tab === "request" ? "selected" : ""}
                      onClick={() => setTab("request")}
                    >
                      Request
                    </button>
                  </div>
                  <span className="mono">
                    {activeStep?.httpStatus
                      ? `HTTP ${activeStep.httpStatus}`
                      : "NO HTTP STATUS"}{" "}
                    <span className="dim">
                      /{" "}
                      {activeStep?.durationMs !== undefined
                        ? `${activeStep.durationMs} ms`
                        : "—"}
                    </span>
                  </span>
                </div>
                <div className="endpoint">
                  <span className="method">
                    {activeStep?.method ?? "LOCAL"}
                  </span>
                  <span>
                    {activeStep?.url ?? `${selected} · waiting for execution`}
                  </span>
                </div>
                {activeStep?.error && (
                  <div className="error-line">
                    <TriangleAlert size={14} />
                    {activeStep.error}
                  </div>
                )}
                <pre aria-label="协议调用 JSON">
                  {activeStep
                    ? JSON.stringify(
                        tab === "request"
                          ? (activeStep.request ?? {
                              note: "Direct Catalog selection. No HTTP discovery request.",
                            })
                          : (activeStep.response ?? {
                              note: activeStep.error ?? "Awaiting response",
                            }),
                        null,
                        2,
                      )
                    : "// Run a scenario to inspect actual protocol evidence.\n// Request and response payloads appear here.\n// No simulated network timings."}
                </pre>
                <div className="inspector-foot">
                  <ShieldCheck size={12} />{" "}
                  {(activeStep?.transport ??
                    (input.mode === "demo" ? "fixture" : "http")) === "fixture"
                    ? "Fixture 执行耗时 · 不代表网络延迟"
                    : "真实 HTTP 执行耗时，包含解析与 Schema 校验"}
                  <span>敏感字段已脱敏</span>
                </div>
              </div>
            </section>
            <section className="evidence-panel panel" id="evidence">
              <div className="section-title">
                <div>
                  <span className="index">03</span>
                  <h2>Product evidence</h2>
                </div>
                <span className="mono dim">
                  {report?.products.length ?? 0} FOUND
                </span>
              </div>
              {(!report || report.products.length === 0) && (
                <div className="empty-products">
                  <div className="headphone-art">
                    <Headphones size={76} strokeWidth={1} />
                  </div>
                  <h3>
                    {report ? "No verified candidates." : "Show the evidence."}
                  </h3>
                  <p>
                    {report ? (
                      "本次运行没有可展示的商品。检查 Query 响应或失败证据。"
                    ) : (
                      <>
                        商品、预算检查和 Catalog 的解释
                        <br />
                        随真实执行结果出现在这里。
                      </>
                    )}
                  </p>
                  <div className="empty-tags">
                    <span>PRICE</span>
                    <span>PROVENANCE</span>
                    <span>ACTIONS</span>
                  </div>
                </div>
              )}
              <div className="product-list">
                {report?.products.map((product) => (
                  <article
                    className={`product-card ${product.eligible ? "" : "ineligible"}`}
                    key={product.match.entry.entry_id}
                  >
                    <div className="product-top">
                      <div className="product-icon">
                        <Headphones size={30} strokeWidth={1.5} />
                      </div>
                      <span
                        className={`badge ${product.eligible ? "" : "danger"}`}
                      >
                        {product.eligible ? "BUDGET MATCH" : "UNVERIFIED"}
                      </span>
                    </div>
                    <h3>{product.match.entry.title}</h3>
                    <p>{product.match.entry.summary}</p>
                    <div className="price">
                      {product.amount !== undefined ? (
                        <>
                          {product.currency}{" "}
                          <strong>{product.amount.toFixed(2)}</strong>
                        </>
                      ) : (
                        <span className="red">Price missing</span>
                      )}
                      <span className="dim">
                        Catalog score {product.match.score}
                      </span>
                    </div>
                    <div className="product-reasons">
                      {product.reasons.map((reason, i) => (
                        <div key={i}>
                          <ChevronRight size={12} />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                    <div className="product-source">
                      <span>SOURCE / {product.match.entry.provider_id}</span>
                      <small>{product.match.entry.entry_id}</small>
                    </div>
                    {product.actionUrl && report.mode === "live" ? (
                      <Button asChild variant="outline" className="view-action">
                        <a
                          href={product.actionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View product <ArrowUpRight size={14} />
                        </a>
                      </Button>
                    ) : (
                      <div className="action-note">
                        {product.actionUrl
                          ? "Demo 示例入口 · example.com，不是实际商品链接"
                          : "没有可验证的商品详情入口"}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className="evidence-foot">
                <CircleDot size={12} />{" "}
                只解释当前响应中的候选；不推断未返回的商品。
              </div>
            </section>
          </div>
          <section className="repair-panel panel" id="repair">
            <div className="section-title">
              <div>
                <span className="index">04</span>
                <h2>Break & Repair lab</h2>
                <span className="badge muted">AGENT REPAIR</span>
              </div>
              <span className={`badge ${failed.length ? "danger" : ""}`}>
                {report
                  ? failed.length
                    ? `${failed.length} CHECKS FAILED`
                    : "CHECKS PASSED"
                  : isBroken
                    ? "BROKEN FIXTURE SELECTED"
                    : "AWAITING TEST"}
              </span>
            </div>
            <div className="repair-grid">
              <div>
                <div className="repair-heading">
                  {failed.length ? (
                    <TriangleAlert className="red" size={22} />
                  ) : (
                    <ShieldCheck size={22} />
                  )}
                  <h3>
                    {report
                      ? failed.length
                        ? `${failed.length} 个问题，证据已定位。`
                        : "每一步都有依据。"
                      : "Make it break. Then make it right."}
                  </h3>
                </div>
                <p className="repair-copy">
                  {failed.length
                    ? "把失败检查、响应证据和验收条件一起交给编程 Agent。修复后，用同一购物目标重新验证。"
                    : "选择故障 Fixture，观察红色节点；生成修复任务，再执行完整协议链。"}
                </p>
                <div className="check-list">
                  {report
                    ? report.checks.map((check, i) => (
                        <div key={`${check.id}-${i}`}>
                          <span>
                            {check.id}
                            <small>{check.step}</small>
                          </span>
                          {check.passed ? (
                            <CheckCircle2 className="green" size={16} />
                          ) : (
                            <XCircle className="red" size={16} />
                          )}
                        </div>
                      ))
                    : [
                        "Catalog query schema",
                        "Product price",
                        "Product action URL",
                        "Resolve response",
                      ].map((label) => (
                        <div key={label}>
                          <span>{label}</span>
                          <CircleDot className="dim" size={15} />
                        </div>
                      ))}
                </div>
                {before && report && (
                  <div className="comparison">
                    <RotateCcw size={15} /> 修复前{" "}
                    {before.checks.filter((c) => !c.passed).length} 项失败{" "}
                    <ArrowRight size={14} /> 修复后 {failed.length} 项失败 ·
                    新执行 {report.runId.slice(-8)}
                  </div>
                )}
              </div>
              <div className="repair-task">
                <div className="task-header">
                  <Code2 size={16} />
                  <span>CODING AGENT HANDOFF</span>
                  <span className="mono dim">report.json</span>
                </div>
                <pre tabIndex={0}>
                  {report?.repairTask ??
                    "# Evidence first. Repair second.\n\n运行后生成结构化诊断。\n包含失败步骤、字段证据、修复范围和复测要求。\n\n兼容 Codex / Claude Code / 其他 Coding Agent。"}
                </pre>
                <div className="repair-actions">
                  <Button
                    disabled={!report || busy}
                    onClick={() => void copyTask()}
                  >
                    <Copy size={14} />
                    Generate Fix for Coding Agent
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!report || busy}
                    onClick={() => report && download(report)}
                    aria-label="下载 report.json"
                  >
                    <Download size={15} />
                  </Button>
                </div>
                {report?.mode === "demo" && failed.length > 0 && (
                  <Button
                    variant="outline"
                    className="apply-repair"
                    disabled={busy}
                    onClick={repair}
                  >
                    <Wrench size={15} />
                    Apply fixture repair & rerun
                    <ArrowRight size={14} />
                  </Button>
                )}
                <p className="fixture-scope">
                  仅替换当前运行的本地 Fixture
                  故障状态，然后重新请求和校验全部步骤。不会修改远端 Catalog。
                </p>
              </div>
            </div>
            <div className="repair-footer">
              <span>
                <Terminal size={12} />{" "}
                {report
                  ? `${passed}/${report.checks.length} checks passed`
                  : "Machine-readable by design"}
              </span>
              <span>
                {report
                  ? report.runId
                  : "No API key required · Demo runs offline"}
              </span>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              OCP AGENT X-RAY{" "}
              <span className="dim">/ OPEN COMMERCE PROTOCOL</span>
            </span>
            <span>Watch an AI shop. See every decision. Fix what breaks.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
