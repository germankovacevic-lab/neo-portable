import { expect, test, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { handle, SCHEMA, type D1Like, type D1PreparedStatement, type Env } from "../relay/src/handler.js";

// node:sqlite is newer than vite's builtins list → load it with node's real require
// to dodge vite's resolver (which tries to bundle it as "sqlite" and fails).
interface StmtSync { run(...p: unknown[]): { changes: number | bigint }; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; }
interface DbSync { exec(sql: string): void; prepare(sql: string): StmtSync; }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => DbSync };

// D1-like adapter over node:sqlite (real SQLite → genuine atomic claim, not a fake).
function d1(db: DbSync): D1Like {
  return {
    prepare(sql: string): D1PreparedStatement {
      const stmt = db.prepare(sql);
      let bound: unknown[] = [];
      const api: D1PreparedStatement = {
        bind(...vals: unknown[]) { bound = vals; return api; },
        async run() { const r = stmt.run(...(bound as never[])); return { meta: { changes: Number(r.changes) } }; },
        async first<T>() { return (stmt.get(...(bound as never[])) ?? null) as T | null; },
        async all<T>() { return { results: stmt.all(...(bound as never[])) as T[] }; },
      };
      return api;
    },
  };
}

let env: Env;
beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  env = { DB: d1(db), OPERATOR_TOKEN: "op-tok", AGENT_TOKEN: "ag-tok" };
});

const OP = { authorization: "Bearer op-tok" };
const AG = { authorization: "Bearer ag-tok" };
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`https://relay.test${path}`, {
    method, headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const RESULT = { ok: true, output: "42", turns: 2, cost: { tokensIn: 1, tokensOut: 1, usd: 0 } };

async function enqueue(task: string): Promise<string> {
  const r = await handle(req("POST", "/jobs", OP, { task }), env);
  return ((await r.json()) as { id: string }).id;
}

test("no token → 401; wrong-role token → 401", async () => {
  expect((await handle(req("POST", "/jobs", {}, { task: "x" }), env)).status).toBe(401);
  // operator token NO puede pollear (endpoint de agente)
  expect((await handle(req("GET", "/poll", OP), env)).status).toBe(401);
  // agent token CANNOT enqueue (operator endpoint)
  expect((await handle(req("POST", "/jobs", AG, { task: "x" }), env)).status).toBe(401);
});

test("enqueue returns an id and the job starts pending", async () => {
  const id = await enqueue("do X");
  const view = await (await handle(req("GET", `/jobs/${id}`, OP), env)).json() as { status: string; task: string };
  expect(view.status).toBe("pending");
  expect(view.task).toBe("do X");
});

test("poll claims the oldest pending; a second poll is single-flight (204, no double-serve)", async () => {
  const id1 = await enqueue("uno");
  await enqueue("dos");
  const first = await handle(req("GET", "/poll", AG), env);
  expect(first.status).toBe(200);
  const job = await first.json() as { id: string; status: string };
  expect(job.id).toBe(id1);          // FIFO: the oldest
  expect(job.status).toBe("claimed");
  // a claimed job is still unfinished → doesn't hand out another
  expect((await handle(req("GET", "/poll", AG), env)).status).toBe(204);
});

test("the claim UPDATE is guarded by status: re-claiming a claimed job changes 0 rows", async () => {
  // Prueba directa del WHERE status='pending': segundo poll del mismo job (ACK perdido) no lo re-sirve.
  const id = await enqueue("uno");
  await handle(req("GET", "/poll", AG), env);                 // claim j -> claimed
  const view = await (await handle(req("GET", `/jobs/${id}`, OP), env)).json() as { status: string };
  expect(view.status).toBe("claimed");
  expect((await handle(req("GET", "/poll", AG), env)).status).toBe(204); // no re-servido
});

test("postResult marks completed/failed and stores the result", async () => {
  const id = await enqueue("uno");
  await handle(req("GET", "/poll", AG), env);
  expect((await handle(req("POST", `/jobs/${id}/result`, AG, RESULT), env)).status).toBe(200);
  const view = await (await handle(req("GET", `/jobs/${id}`, OP), env)).json() as { status: string; result: typeof RESULT };
  expect(view.status).toBe("completed");
  expect(view.result.output).toBe("42");
  // after completing, the agent is free → can poll again
  expect((await handle(req("GET", "/poll", AG), env)).status).toBe(204);
});

test("a !ok result marks the job failed", async () => {
  const id = await enqueue("uno");
  await handle(req("GET", "/poll", AG), env);
  await handle(req("POST", `/jobs/${id}/result`, AG, { ...RESULT, ok: false }), env);
  const view = await (await handle(req("GET", `/jobs/${id}`, OP), env)).json() as { status: string };
  expect(view.status).toBe("failed");
});

test("cancel works on pending, is a no-op on claimed", async () => {
  const id = await enqueue("uno");
  const c1 = await (await handle(req("PATCH", `/jobs/${id}`, OP, { status: "cancelled" }), env)).json() as { cancelled: boolean };
  expect(c1.cancelled).toBe(true);
  // ya cancelado / no pending → no-op
  const id2 = await enqueue("dos");
  await handle(req("GET", "/poll", AG), env); // claim j2
  const c2 = await (await handle(req("PATCH", `/jobs/${id2}`, OP, { status: "cancelled" }), env)).json() as { cancelled: boolean };
  expect(c2.cancelled).toBe(false);
});

test("health reflects busy + claimedJobId", async () => {
  expect(await (await handle(req("GET", "/health", OP), env)).json()).toEqual({ busy: false });
  const id = await enqueue("uno");
  await handle(req("GET", "/poll", AG), env);
  expect(await (await handle(req("GET", "/health", OP), env)).json()).toEqual({ busy: true, claimedJobId: id });
});

test("getJob returns 404 for unknown id", async () => {
  expect((await handle(req("GET", "/jobs/nope", OP), env)).status).toBe(404);
});
