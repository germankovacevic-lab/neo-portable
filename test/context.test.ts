import { expect, test } from "vitest";
import { createRunContext, CostAccumulator } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

test("createRunContext seeds identity, channel and cost", () => {
  const ctx = createRunContext({
    runId: "r1", agent: "default",
    business: { id: "acme", name: "Acme Co", leash: "long" },
    channel: { source: "cli" }, maxTurns: 8,
    emit: new StructuredLogEmitter({ runId: "r1", businessId: "acme", agent: "default" }, () => {}),
  });
  expect(ctx.turn).toBe(0);
  expect(ctx.channel.source).toBe("cli");
  expect(ctx.cost.snapshot()).toEqual({ tokensIn: 0, tokensOut: 0, usd: 0 });
});

test("CostAccumulator adds usage", () => {
  const c = new CostAccumulator(3 / 1e6, 15 / 1e6); // $3/$15 per M (example)
  c.add(1000, 500);
  const s = c.snapshot();
  expect(s.tokensIn).toBe(1000);
  expect(s.usd).toBeCloseTo(1000 * 3 / 1e6 + 500 * 15 / 1e6, 9);
});
