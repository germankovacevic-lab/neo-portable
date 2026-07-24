import { expect, test } from "vitest";
import { sendTask } from "../src/remote/operator.js";
import type { Relay, JobView, JobResult } from "../src/remote/types.js";

const RESULT: JobResult = { ok: true, output: "42", turns: 2, cost: { tokensIn: 0, tokensOut: 0, usd: 0 } };

// Fake relay that returns a sequence of views on each getJob.
function fakeRelay(views: (JobView | null)[]) {
  let enqueued: string | undefined;
  const relay: Partial<Relay> = {
    async enqueue(task) { enqueued = task; return { id: "j1" }; },
    async getJob() { return views.shift() ?? null; },
  };
  return { relay: relay as Relay, get enqueued() { return enqueued; } };
}

test("enqueues the task and polls until a terminal state, returning the result", async () => {
  const f = fakeRelay([
    { id: "j1", task: "21x2", status: "claimed" },
    { id: "j1", task: "21x2", status: "claimed" },
    { id: "j1", task: "21x2", status: "completed", result: RESULT },
  ]);
  const view = await sendTask({ relay: f.relay, task: "calculate 21x2", pollIntervalMs: 0, sleep: async () => {} });
  expect(f.enqueued).toBe("calculate 21x2");
  expect(view.status).toBe("completed");
  expect(view.result).toEqual(RESULT);
});

test("returns immediately when the job is already terminal on first poll", async () => {
  const f = fakeRelay([{ id: "j1", task: "x", status: "failed", result: { ...RESULT, ok: false } }]);
  const view = await sendTask({ relay: f.relay, task: "x", pollIntervalMs: 0, sleep: async () => {} });
  expect(view.status).toBe("failed");
});

test("throws if the job disappears", async () => {
  const f = fakeRelay([null]);
  await expect(sendTask({ relay: f.relay, task: "x", pollIntervalMs: 0, sleep: async () => {} }))
    .rejects.toThrow(/not found/i);
});
