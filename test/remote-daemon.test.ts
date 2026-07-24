import { expect, test } from "vitest";
import { runDaemon } from "../src/remote/daemon.js";
import type { Relay, Job, JobResult } from "../src/remote/types.js";

const RESULT: JobResult = { ok: true, output: "listo", turns: 1, cost: { tokensIn: 0, tokensOut: 0, usd: 0 } };

// Fake relay: serves a queue of jobs, records posted results, and watches single-flight.
function fakeRelay(jobs: Job[]) {
  const posted: { id: string; result: JobResult }[] = [];
  let inFlight = false; let pollViolation = false;
  const relay: Partial<Relay> = {
    async poll() {
      if (inFlight) { pollViolation = true; }   // polled while a job was still not posted
      const j = jobs.shift() ?? null;
      if (j) inFlight = true;
      return j;
    },
    async postResult(id, result) { posted.push({ id, result }); inFlight = false; },
  };
  return { relay: relay as Relay, posted, get pollViolation() { return pollViolation; } };
}

test("processes a pending job: polls, runs it, posts the result", async () => {
  const ac = new AbortController();
  const f = fakeRelay([{ id: "j1", task: "decime hola", status: "claimed" }]);
  await runDaemon({
    relay: f.relay, signal: ac.signal, pollIntervalMs: 0, sleep: async () => {},
    runTask: async () => RESULT,
    onIdle: () => ac.abort(),   // when the queue drained, we stop
  });
  expect(f.posted).toEqual([{ id: "j1", result: RESULT }]);
});

test("a throwing runTask becomes a failed result; the daemon survives", async () => {
  const ac = new AbortController();
  const f = fakeRelay([{ id: "j1", task: "break", status: "claimed" }]);
  await runDaemon({
    relay: f.relay, signal: ac.signal, pollIntervalMs: 0, sleep: async () => {},
    runTask: async () => { throw new Error("boom"); },
    onIdle: () => ac.abort(),
  });
  expect(f.posted).toHaveLength(1);
  expect(f.posted[0]!.result.ok).toBe(false);
  expect(f.posted[0]!.result.output).toContain("boom");
});

test("single-flight: never polls a new job before posting the current one", async () => {
  const ac = new AbortController();
  const f = fakeRelay([
    { id: "j1", task: "uno", status: "claimed" },
    { id: "j2", task: "dos", status: "claimed" },
  ]);
  await runDaemon({
    relay: f.relay, signal: ac.signal, pollIntervalMs: 0, sleep: async () => {},
    runTask: async () => RESULT,
    onIdle: () => ac.abort(),
  });
  expect(f.posted.map(p => p.id)).toEqual(["j1", "j2"]);
  expect(f.pollViolation).toBe(false);
});
