import { mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { inputSchema, runScenario } from "./runner";
import type { RunEvent } from "./types";
const port = Number(process.env.X_RAY_PORT ?? 4410);
const allowedOrigins = (
  process.env.X_RAY_CATALOG_ORIGINS ??
  "http://localhost:4400,http://127.0.0.1:4400"
)
  .split(",")
  .map((v) => new URL(v.trim()).origin);
const dist = resolve(import.meta.dir, "../dist");
const reports = resolve(import.meta.dir, "../reports");
const json = (body: unknown, status = 200) => Response.json(body, { status });
let active = 0;
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/config" && request.method === "GET")
    return json({ allowedOrigins, planner: "deterministic" });
  if (url.pathname === "/api/run" && request.method === "POST") {
    const origin = request.headers.get("origin");
    const localOrigins = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://localhost:5174",
      "http://127.0.0.1:5174",
    ];
    if (origin && !localOrigins.includes(origin))
      return json({ error: "Origin not allowed" }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return json({ error: "Expected application/json" }, 415);
    if (active >= 4)
      return json({ error: "Too many active runs. Try again shortly." }, 429);
    let input;
    try {
      const text = await request.text();
      if (text.length > 8000) return json({ error: "Request too large" }, 413);
      input = inputSchema.parse(JSON.parse(text));
    } catch {
      return json(
        { error: "Invalid scenario. Check goal, query, budget and currency." },
        400,
      );
    }
    active++;
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: RunEvent) => {
          if (!closed)
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        void (async () => {
          try {
            const report = await runScenario(
              input,
              (event) => {
                if (event.type !== "report") emit(event);
              },
              allowedOrigins,
            );
            await mkdir(reports, { recursive: true });
            await Bun.write(
              resolve(reports, `${report.runId}.json`),
              JSON.stringify(report, null, 2),
            );
            emit({ type: "report", report });
          } catch {
            emit({
              type: "error",
              error:
                "Run or report persistence failed. Check local server availability and writable reports directory.",
            });
          } finally {
            active--;
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (url.pathname.startsWith("/api/"))
    return json({ error: "Not found" }, 404);
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405);
  const path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
  if (path !== dist && !path.startsWith(`${dist}/`))
    return json({ error: "Not found" }, 404);
  const file = Bun.file(path);
  if (await file.exists()) return new Response(file);
  if (extname(path)) return json({ error: "Not found" }, 404);
  const index = Bun.file(resolve(dist, "index.html"));
  if (await index.exists()) return new Response(index);
  return new Response(
    "Run bun run xray:build first, or use bun run xray:ui for Vite development.",
    { status: 503 },
  );
}
if (import.meta.main) {
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 60,
    maxRequestBodySize: 8192,
    fetch: handle,
  });
  console.log(`OCP Agent X-Ray: http://127.0.0.1:${port}`);
}
