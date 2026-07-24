import { expect, test } from "vitest";
import { RelayClient } from "../src/remote/relay-client.js";
import type { JobResult } from "../src/remote/types.js";

interface Captured { url: string; method: string; auth: string | null; body: unknown; }
function fakeFetch(responder: (c: Captured) => { status: number; json?: unknown }) {
  const calls: Captured[] = [];
  const fn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const c: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(c);
    const { status, json } = responder(c);
    return new Response(json === undefined ? null : JSON.stringify(json), {
      status, headers: { "content-type": "application/json" },
    });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}
const client = (fetchFn: typeof fetch) =>
  new RelayClient({ baseUrl: "https://relay.test", token: "secret-token", fetchFn });

const RESULT: JobResult = { ok: true, output: "ok", turns: 1, cost: { tokensIn: 0, tokensOut: 0, usd: 0 } };

test("enqueue POSTs the task with bearer auth and parses the id", async () => {
  const f = fakeFetch(() => ({ status: 200, json: { id: "j1" } }));
  const r = await client(f.fn).enqueue("do X");
  expect(r).toEqual({ id: "j1" });
  expect(f.calls[0]!.method).toBe("POST");
  expect(f.calls[0]!.url).toBe("https://relay.test/jobs");
  expect(f.calls[0]!.auth).toBe("Bearer secret-token");
  expect(f.calls[0]!.body).toEqual({ task: "do X" });
});

test("poll returns null on 204 and the job on 200", async () => {
  const empty = fakeFetch(() => ({ status: 204 }));
  expect(await client(empty.fn).poll()).toBeNull();
  const full = fakeFetch(() => ({ status: 200, json: { id: "j1", task: "t", status: "claimed" } }));
  expect((await client(full.fn).poll())?.id).toBe("j1");
  expect(full.calls[0]!.url).toBe("https://relay.test/poll");
});

test("getJob returns null on 404", async () => {
  const f = fakeFetch(() => ({ status: 404 }));
  expect(await client(f.fn).getJob("nope")).toBeNull();
});

test("postResult POSTs to /jobs/:id/result with the result body", async () => {
  const f = fakeFetch(() => ({ status: 200 }));
  await client(f.fn).postResult("j1", RESULT);
  expect(f.calls[0]!.url).toBe("https://relay.test/jobs/j1/result");
  expect(f.calls[0]!.method).toBe("POST");
  expect(f.calls[0]!.body).toEqual(RESULT);
});

test("cancel PATCHes the job to cancelled", async () => {
  const f = fakeFetch(() => ({ status: 200, json: { cancelled: true } }));
  const r = await client(f.fn).cancel("j1");
  expect(r).toEqual({ cancelled: true });
  expect(f.calls[0]!.method).toBe("PATCH");
  expect(f.calls[0]!.body).toEqual({ status: "cancelled" });
});

test("throws on 401 unauthorized", async () => {
  const f = fakeFetch(() => ({ status: 401 }));
  await expect(client(f.fn).enqueue("x")).rejects.toThrow(/401|unauthor/i);
});
