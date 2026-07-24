import { expect, test, vi } from "vitest";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

test("emits structured JSON with base envelope", () => {
  const lines: string[] = [];
  const em = new StructuredLogEmitter(
    { runId: "r1", businessId: "acme", agent: "default" },
    (l) => lines.push(l)
  );
  em.emit({ t: "run_start", turn: 0 });
  const obj = JSON.parse(lines[0]!);
  expect(obj).toMatchObject({ t: "run_start", runId: "r1", businessId: "acme", agent: "default", turn: 0 });
  expect(typeof obj.ts).toBe("number");
});
