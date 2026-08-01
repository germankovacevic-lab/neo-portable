import { expect, test } from "vitest";
import { geminiToChunks, toGeminiContents, mapGeminiError } from "../src/brain/gemini.js";
import type { Message } from "../src/types.js";

test("maps a gemini functionCall response to a tool_call chunk", () => {
  const chunks = geminiToChunks({
    candidates: [{ content: { parts: [{ text: "let me compute" }, { functionCall: { name: "calculate", args: { expression: "2+2" } } }] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
  });
  expect(chunks.find(c => c.type === "tool_call")).toMatchObject({ type: "tool_call", call: { name: "calculate", input: { expression: "2+2" } } });
  expect(chunks.find(c => c.type === "text")).toMatchObject({ type: "text", text: "let me compute" });
  expect(chunks.find(c => c.type === "usage")).toMatchObject({ tokensIn: 12, tokensOut: 7 });
});

test("geminiToChunks tolerates a malformed response without throwing", () => {
  const chunks = geminiToChunks({} as never);
  expect(Array.isArray(chunks)).toBe(true);
  // still emits a usage chunk (zeros) and no crash
  expect(chunks.some(c => c.type === "usage")).toBe(true);
});

test("functionCall with no args defaults to empty object input", () => {
  const chunks = geminiToChunks({ candidates: [{ content: { parts: [{ functionCall: { name: "ping" } }] } }] });
  expect(chunks.find(c => c.type === "tool_call")).toMatchObject({ call: { name: "ping", input: {} } });
});

test("maps assistant toolCalls into gemini functionCall parts and tool result into functionResponse with the resolved name", () => {
  const history: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "gem_0", name: "calculate", input: { expression: "2+2" } }] },
    { role: "tool", content: "4", toolCallId: "gem_0" },
  ];
  const contents = toGeminiContents(history);
  // system is dropped (goes via systemInstruction)
  expect(contents.some(c => c.parts.some(p => p.text === "sys"))).toBe(false);
  // assistant turn -> model role with a functionCall part
  const model = contents.find(c => c.role === "model");
  expect(model?.parts[0]?.functionCall).toMatchObject({ name: "calculate", args: { expression: "2+2" } });
  // tool result -> user role with functionResponse carrying the function NAME (resolved from the call id)
  const fnResp = contents.flatMap(c => c.parts).find(p => p.functionResponse);
  expect(fnResp?.functionResponse).toMatchObject({ name: "calculate", response: { result: "4" } });
});

test("captures a functionCall thoughtSignature into providerMeta", () => {
  const chunks = geminiToChunks({
    candidates: [{ content: { parts: [{ functionCall: { name: "calculate", args: { expression: "2+2" } }, thoughtSignature: "sig-abc" }] } }],
  });
  expect(chunks.find(c => c.type === "tool_call")).toMatchObject({ call: { name: "calculate", providerMeta: { thoughtSignature: "sig-abc" } } });
});

test("replays the thoughtSignature from providerMeta back onto the functionCall part (newer models 400 without it)", () => {
  const history: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "gem_0", name: "calculate", input: { expression: "2+2" }, providerMeta: { thoughtSignature: "sig-abc" } }] },
    { role: "tool", content: "4", toolCallId: "gem_0" },
  ];
  const model = toGeminiContents(history).find(c => c.role === "model");
  expect(model?.parts[0]).toMatchObject({ functionCall: { name: "calculate" }, thoughtSignature: "sig-abc" });
});

test("omits thoughtSignature when a tool call carries none (older models / no providerMeta)", () => {
  const history: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "gem_0", name: "calculate", input: {} }] },
  ];
  const model = toGeminiContents(history).find(c => c.role === "model");
  expect(model?.parts[0]).not.toHaveProperty("thoughtSignature");
});

test("merges adjacent same-role turns (gemini rejects consecutive same-role)", () => {
  const history: Message[] = [
    { role: "user", content: "a" },
    { role: "user", content: "b" },
  ];
  const contents = toGeminiContents(history);
  expect(contents.length).toBe(1);
  expect(contents[0]?.parts.map(p => p.text)).toEqual(["a", "b"]);
});

test("mapGeminiError classifies by status and message", () => {
  expect(mapGeminiError(429, "quota")).toMatchObject({ family: "brain", subtype: "rate_limit" });
  expect(mapGeminiError(403, "denied")).toMatchObject({ subtype: "auth" });
  expect(mapGeminiError(400, "input token count exceeds")).toMatchObject({ subtype: "context_overflow" });
  expect(mapGeminiError(400, "blocked by safety")).toMatchObject({ subtype: "content_filter" });
  expect(mapGeminiError(500, "boom")).toMatchObject({ subtype: "transient" });
});
