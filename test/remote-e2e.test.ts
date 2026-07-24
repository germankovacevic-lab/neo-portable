import { expect, test } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handle, SCHEMA, type D1Like, type D1PreparedStatement, type Env } from "../relay/src/handler.js";
import { RelayClient } from "../src/remote/relay-client.js";
import { runDaemon } from "../src/remote/daemon.js";
import { sendTask } from "../src/remote/operator.js";
import { run } from "../src/loop.js";
import { FakeBrain } from "../src/brain/fake.js";
import { OpenGate } from "../src/gate/open.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { shell } from "../src/tools/shell.js";
import { TruncateCompactor } from "../src/compactor/truncate.js";
import { FilePersona } from "../src/persona/index.js";
import type { BrainChunk } from "../src/brain/index.js";
import type { JobResult } from "../src/remote/types.js";

interface StmtSync { run(...p: unknown[]): { changes: number | bigint }; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; }
interface DbSync { exec(sql: string): void; prepare(sql: string): StmtSync; }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => DbSync };

function d1(db: DbSync): D1Like {
  return {
    prepare(sql: string): D1PreparedStatement {
      const stmt = db.prepare(sql); let bound: unknown[] = [];
      const api: D1PreparedStatement = {
        bind(...vals: unknown[]) { bound = vals; return api; },
        async run() { return { meta: { changes: Number(stmt.run(...(bound as never[])).changes) } }; },
        async first<T>() { return (stmt.get(...(bound as never[])) ?? null) as T | null; },
        async all<T>() { return { results: stmt.all(...(bound as never[])) as T[] }; },
      };
      return api;
    },
  };
}

// Spins up the real relay (handler + SQLite) over an ephemeral HTTP server.
async function startRelay(env: Env): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((nreq: IncomingMessage, nres: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of nreq) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const req = new Request(base + (nreq.url ?? "/"), {
        method: nreq.method ?? "GET", headers: nreq.headers as Record<string, string>,
        ...(body.length > 0 ? { body } : {}),
      });
      const res = await handle(req, env);
      nres.statusCode = res.status;
      res.headers.forEach((v, k) => nres.setHeader(k, v));
      nres.end(Buffer.from(await res.arrayBuffer()));
    })();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => server.close(() => r())) };
}

test("E2E: operator → relay HTTP → daemon → run() → shell executes on the 'remote' → result comes back", async () => {
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const env: Env = { DB: d1(db), OPERATOR_TOKEN: "op", AGENT_TOKEN: "ag" };
  const relay = await startRelay(env);

  // Proof the shell REALLY ran on the daemon side.
  const marker = join(tmpdir(), `neo-e2e-${process.pid}.txt`);
  rmSync(marker, { force: true });
  const writeCmd = `node -e 'require("fs").writeFileSync("${marker}", "hello-remote")'`;

  // Deterministic brain: turn 0 calls shell; turn 1 finishes with text.
  const script: BrainChunk[][] = [
    [{ type: "tool_call", call: { id: "c1", name: "shell", input: { command: writeCmd } } }, { type: "usage", tokensIn: 1, tokensOut: 1 }],
    [{ type: "text", text: "Done, I ran the command on the remote machine." }, { type: "usage", tokensIn: 1, tokensOut: 1 }],
  ];
  const registry = new ToolRegistry(); registry.register(shell);
  const rt = {
    brain: new FakeBrain(script), registry, gate: new OpenGate(),
    compactor: new TruncateCompactor(), persona: new FilePersona("./test/fixtures/persona.md"),
    business: { id: "remote", name: "Remote", leash: "long" as const }, agent: "default", maxTurns: 6,
  };

  const agentRelay = new RelayClient({ baseUrl: relay.baseUrl, token: "ag" });
  const opRelay = new RelayClient({ baseUrl: relay.baseUrl, token: "op" });

  const ac = new AbortController();
  const daemon = runDaemon({
    relay: agentRelay, signal: ac.signal, pollIntervalMs: 10,
    runTask: async (task): Promise<JobResult> => {
      const res = await run({ ...rt, prompt: task });
      return res.ok
        ? { ok: true, output: res.output, turns: res.turns, cost: res.cost }
        : { ok: false, output: `ERROR: ${JSON.stringify(res.error)}`, turns: res.turns, cost: res.cost };
    },
  });

  const view = await sendTask({ relay: opRelay, task: "run the command on the remote", pollIntervalMs: 10 });
  ac.abort();
  await daemon;
  await relay.close();

  expect(view.status).toBe("completed");
  expect(view.result?.output).toContain("Done");
  expect(readFileSync(marker, "utf8")).toBe("hello-remote"); // the shell really ran on the daemon side
  rmSync(marker, { force: true });
});
