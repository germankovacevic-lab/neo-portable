import { expect, test, vi } from "vitest";
import { mapAnthropicError, assembleToolUse, toAnthropicMessages } from "../src/brain/anthropic.js";
import type { Message } from "../src/types.js";

test("maps 429 to brain.rate_limit", () => {
  expect(mapAnthropicError({ status: 429 }).subtype).toBe("rate_limit");
});
test("maps 401 to brain.auth", () => {
  expect(mapAnthropicError({ status: 401 }).subtype).toBe("auth");
});
test("maps overflow message to context_overflow", () => {
  expect(mapAnthropicError({ status: 400, error: { error: { message: "prompt is too long" } } }).subtype).toBe("context_overflow");
});
test("assembleToolUse joins partial json deltas into a complete ToolCall", () => {
  const call = assembleToolUse({ id: "tu_1", name: "calculate" }, ['{"expr', 'ession":"2', '+2"}']);
  expect(call).toEqual({ id: "tu_1", name: "calculate", input: { expression: "2+2" } });
});

test("maps assistant toolCalls to a tool_use block paired with the tool_result", () => {
  const history: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "calculate", input: { expression: "2+2" } }] },
    { role: "tool", content: "4", toolCallId: "tu_1" },
  ];
  const wire = toAnthropicMessages(history);
  // system is dropped (goes separately); we have user, assistant(tool_use), user(tool_result)
  const asst = wire.find(m => m.role === "assistant");
  expect(asst).toBeTruthy();
  const blocks = asst!.content as { type: string; id?: string; name?: string }[];
  const toolUse = blocks.find(b => b.type === "tool_use");
  expect(toolUse).toMatchObject({ type: "tool_use", id: "tu_1", name: "calculate" });
  // the tool_result references the same id (no orphan tool_result → no 400)
  const toolResultMsg = wire.find(m => Array.isArray(m.content) && (m.content as { type: string; tool_use_id?: string }[]).some(b => b.type === "tool_result" && b.tool_use_id === "tu_1"));
  expect(toolResultMsg).toBeTruthy();
});
