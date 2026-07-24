import { expect, test } from "vitest";
import { OpenGate } from "../src/gate/open.js";
import { createRunContext } from "../src/context.js";
import type { RunEvent, Emitter } from "../src/obs/emitter.js";

function capturing(): { emit: Emitter; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: { emit: (e: RunEvent) => events.push(e) }, events };
}
const ctx = (emit: Emitter) => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4, emit,
});

test("OpenGate allows any tool", async () => {
  const g = new OpenGate();
  const a = capturing(), b = capturing();
  expect((await g.check({ id: "1", name: "shell", input: {} }, ctx(a.emit))).kind).toBe("allow");
  expect((await g.check({ id: "2", name: "whatever", input: {} }, ctx(b.emit))).kind).toBe("allow");
});

test("OpenGate emits a gate_decision event", async () => {
  const g = new OpenGate();
  const cap = capturing();
  await g.check({ id: "1", name: "shell", input: {} }, ctx(cap.emit));
  expect(cap.events.some(e => e.t === "gate_decision")).toBe(true);
});
