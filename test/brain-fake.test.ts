import { expect, test } from "vitest";
import { FakeBrain } from "../src/brain/fake.js";

test("FakeBrain yields scripted turns in order", async () => {
  const brain = new FakeBrain([
    [{ type: "text", text: "thinking..." }, { type: "tool_call", call: { id: "1", name: "calculate", input: { expression: "2+2" } } }, { type: "usage", tokensIn: 10, tokensOut: 5 }],
    [{ type: "text", text: "the result is 4" }, { type: "usage", tokensIn: 8, tokensOut: 4 }],
  ]);
  const out1 = []; for await (const c of brain.complete({ messages: [], tools: [] }, {} as never)) out1.push(c);
  expect(out1.find(c => c.type === "tool_call")).toBeTruthy();
  const out2 = []; for await (const c of brain.complete({ messages: [], tools: [] }, {} as never)) out2.push(c);
  expect(out2.some(c => c.type === "text" && c.text.includes("4"))).toBe(true);
});
