import { expect, test } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { calculate } from "../src/tools/calculate.js";
import { createRunContext } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

const ctx = () => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4,
  emit: new StructuredLogEmitter({ runId: "r", businessId: "b", agent: "default" }, () => {}),
});

test("register + list exposes schema", () => {
  const reg = new ToolRegistry(); reg.register(calculate);
  expect(reg.list().map(s => s.name)).toContain("calculate");
});
test("calculate evaluates and returns ok", async () => {
  const reg = new ToolRegistry(); reg.register(calculate);
  const r = await reg.get("calculate")!.execute({ expression: "1847*2963" }, ctx());
  expect(r).toEqual({ ok: true, output: "5472661" });
});
test("calculate rejects unsafe input", async () => {
  const r = await calculate.execute({ expression: "process.exit(1)" }, ctx());
  expect(r.ok).toBe(false);
});
test("calculate rejects ** exponentiation (DoS guard)", async () => {
  const r = await calculate.execute({ expression: "9**9**9" }, ctx());
  expect(r.ok).toBe(false);
});
test("calculate rejects spaced * * too", async () => {
  const r = await calculate.execute({ expression: "9 * * 9" }, ctx());
  expect(r.ok).toBe(false);
});
test("calculate still allows single multiplication", async () => {
  const r = await calculate.execute({ expression: "6*7" }, ctx());
  expect(r).toEqual({ ok: true, output: "42" });
});
