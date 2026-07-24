import { expect, test } from "vitest";
import { HeldByDefaultGate } from "../src/gate/held-by-default.js";
import { resolveEscalation } from "../src/gate/escalation.js";
import { createRunContext } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

const ctx = () => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4,
  emit: new StructuredLogEmitter({ runId: "r", businessId: "b", agent: "default" }, () => {}),
});

test("allowlisted tool → allow", async () => {
  const g = new HeldByDefaultGate({ allow: ["calculate"], escalate: [] });
  expect((await g.check({ id: "1", name: "calculate", input: {} }, ctx())).kind).toBe("allow");
});
test("unlisted tool → deny", async () => {
  const g = new HeldByDefaultGate({ allow: ["calculate"], escalate: [] });
  expect((await g.check({ id: "1", name: "send_email", input: {} }, ctx())).kind).toBe("deny");
});
test("escalate-listed tool → escalate", async () => {
  const g = new HeldByDefaultGate({ allow: [], escalate: ["send_email"] });
  expect((await g.check({ id: "1", name: "send_email", input: {} }, ctx())).kind).toBe("escalate");
});
test("no handler → deny immediately", async () => {
  const d = await resolveEscalation(undefined, { call: { id: "1", name: "x", input: {} }, reason: "r", business: { id: "b", name: "B", leash: "long" }, runId: "r" }, ctx(), 50);
  expect(d).toBe("deny");
});
test("handler timeout → deny", async () => {
  const slow = { resolve: () => new Promise<"allow" | "deny">(() => {}) };
  const d = await resolveEscalation(slow, { call: { id: "1", name: "x", input: {} }, reason: "r", business: { id: "b", name: "B", leash: "long" }, runId: "r" }, ctx(), 50);
  expect(d).toBe("deny");
});
