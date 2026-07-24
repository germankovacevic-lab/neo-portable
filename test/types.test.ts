import { expect, test } from "vitest";
import { userMessage, toolResultMessage } from "../src/types.js";

test("userMessage builds a user role message", () => {
  expect(userMessage("hola")).toEqual({ role: "user", content: "hola" });
});

test("toolResultMessage carries the toolCallId and result", () => {
  const m = toolResultMessage("call-1", { ok: true, output: "42" });
  expect(m).toEqual({ role: "tool", toolCallId: "call-1", result: { ok: true, output: "42" } });
});
