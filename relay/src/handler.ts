// Relay for the remote-control channel. A job mailbox backed by D1 (SQLite).
// Pure handler: takes (Request, Env) and depends on no Cloudflare globals → testable
// against real SQLite (node:sqlite), the same code that runs in the Worker.
//
// Typed against a minimal D1-like interface (not @cloudflare/workers-types) so the main repo's
// typecheck doesn't need the Workers types. The real D1Database satisfies this shape.

export interface D1PreparedStatement {
  bind(...vals: unknown[]): D1PreparedStatement;
  run(): Promise<{ meta: { changes: number } }>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
export interface D1Like { prepare(sql: string): D1PreparedStatement; }
export interface Env { DB: D1Like; OPERATOR_TOKEN: string; AGENT_TOKEN: string; }

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
`;

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const empty = (status: number): Response => new Response(null, { status });

function bearer(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/);
  return m?.[1] ?? null;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  const token = bearer(req);
  const isOperator = token != null && token === env.OPERATOR_TOKEN;
  const isAgent = token != null && token === env.AGENT_TOKEN;
  const m = req.method;
  const now = (): number => Date.now();

  // POST /jobs — operator enqueues
  if (m === "POST" && seg.length === 1 && seg[0] === "jobs") {
    if (!isOperator) return empty(401);
    const body = await req.json().catch(() => ({})) as { task?: unknown };
    if (typeof body.task !== "string" || body.task.trim() === "") return json({ error: "task required" }, 400);
    const id = crypto.randomUUID();
    const t = now();
    await env.DB.prepare(
      "INSERT INTO jobs (id, status, task, result, created_at, claimed_at, updated_at) VALUES (?, 'pending', ?, NULL, ?, NULL, ?)",
    ).bind(id, body.task, t, t).run();
    return json({ id });
  }

  // GET /poll — agent claims the oldest pending job (single-flight + atomic claim)
  if (m === "GET" && seg.length === 1 && seg[0] === "poll") {
    if (!isAgent) return empty(401);
    const busy = await env.DB.prepare("SELECT id FROM jobs WHERE status = 'claimed' LIMIT 1").first();
    if (busy) return empty(204); // a job is already in progress → one job at a time
    const row = await env.DB.prepare(
      "SELECT id, task FROM jobs WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT 1",
    ).first<{ id: string; task: string }>();
    if (!row) return empty(204);
    const upd = await env.DB.prepare(
      "UPDATE jobs SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(now(), now(), row.id).run();
    if (upd.meta.changes !== 1) return empty(204); // lost the race (another claimed it) → idempotent
    return json({ id: row.id, task: row.task, status: "claimed" });
  }

  // POST /jobs/:id/result — agent posts the result
  if (m === "POST" && seg.length === 3 && seg[0] === "jobs" && seg[2] === "result") {
    if (!isAgent) return empty(401);
    const id = seg[1]!;
    const body = await req.json().catch(() => null) as { ok?: unknown } | null;
    if (body == null || typeof body.ok !== "boolean") return json({ error: "invalid result" }, 400);
    const status = body.ok ? "completed" : "failed";
    const upd = await env.DB.prepare(
      "UPDATE jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?",
    ).bind(status, JSON.stringify(body), now(), id).run();
    if (upd.meta.changes !== 1) return json({ error: "job not found" }, 404);
    return json({ ok: true });
  }

  // PATCH /jobs/:id — operator cancels (only if still pending)
  if (m === "PATCH" && seg.length === 2 && seg[0] === "jobs") {
    if (!isOperator) return empty(401);
    const id = seg[1]!;
    const upd = await env.DB.prepare(
      "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(now(), id).run();
    return json({ cancelled: upd.meta.changes === 1 });
  }

  // GET /jobs/:id — operator queries status + result
  if (m === "GET" && seg.length === 2 && seg[0] === "jobs") {
    if (!isOperator) return empty(401);
    const id = seg[1]!;
    const row = await env.DB.prepare(
      "SELECT id, task, status, result FROM jobs WHERE id = ?",
    ).bind(id).first<{ id: string; task: string; status: string; result: string | null }>();
    if (!row) return json({ error: "not found" }, 404);
    return json({
      id: row.id, task: row.task, status: row.status,
      ...(row.result ? { result: JSON.parse(row.result) as unknown } : {}),
    });
  }

  // GET /health — operator: is the agent busy?
  if (m === "GET" && seg.length === 1 && seg[0] === "health") {
    if (!isOperator) return empty(401);
    const claimed = await env.DB.prepare("SELECT id FROM jobs WHERE status = 'claimed' LIMIT 1")
      .first<{ id: string }>();
    return json(claimed ? { busy: true, claimedJobId: claimed.id } : { busy: false });
  }

  return json({ error: "not found" }, 404);
}
