import { expect, test, vi } from "vitest";
import { ollamaToChunks, toOllamaMessages } from "../src/brain/ollama.js";
import type { Message } from "../src/types.js";

test("maps an ollama tool_call response to a tool_call chunk", () => {
  const chunks = ollamaToChunks({
    message: { content: "ok", tool_calls: [{ function: { name: "calculate", arguments: { expression: "2+2" } } }] },
    prompt_eval_count: 12, eval_count: 7,
  });
  expect(chunks.find(c => c.type === "tool_call")).toMatchObject({ type: "tool_call", call: { name: "calculate", input: { expression: "2+2" } } });
  expect(chunks.find(c => c.type === "usage")).toMatchObject({ tokensIn: 12, tokensOut: 7 });
});

test("ollamaToChunks tolerates a malformed response without throwing", () => {
  const chunks = ollamaToChunks({} as never);
  expect(Array.isArray(chunks)).toBe(true);
  // still emits a usage chunk (zeros) and no crash
  expect(chunks.some(c => c.type === "usage")).toBe(true);
});

test("maps assistant toolCalls into ollama tool_calls wire shape", () => {
  const history: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "x", name: "calculate", input: { expression: "2+2" } }] },
    { role: "tool", content: "4", toolCallId: "x" },
  ];
  const wire = toOllamaMessages(history);
  const asst = wire.find(m => m.role === "assistant");
  expect(asst?.tool_calls?.[0]?.function).toMatchObject({ name: "calculate", arguments: { expression: "2+2" } });
  const toolMsg = wire.find(m => m.role === "tool");
  expect(toolMsg?.content).toBe("4");
  // plain messages have no tool_calls key
  const userMsg = wire.find(m => m.role === "user");
  expect(userMsg && "tool_calls" in userMsg).toBe(false);
});
