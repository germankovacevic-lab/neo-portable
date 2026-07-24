import { expect, test } from "vitest";
import { TruncateCompactor } from "../src/compactor/truncate.js";
import type { Brain } from "../src/brain/index.js";
import type { Message } from "../src/types.js";

const fakeBrain = (limit: number): Brain => ({
  id: "fake", contextLimitTokens: limit,
  async *complete() {},
});
// Realistic messages (~47 chars ≈ 12 tokens) so compaction
// actually triggers under the token-based estimate (chars/4), not at the char level.
const msgs = (n: number): Message[] =>
  [{ role: "system", content: "S" } as Message,
   ...Array.from({ length: n }, (_, i) => ({ role: "user", content: `msg-${i}-${"x".repeat(40)}` }) as Message)];

test("shouldCompact when estimated tokens exceed limit", () => {
  const c = new TruncateCompactor();
  expect(c.shouldCompact(msgs(1000), fakeBrain(50))).toBe(true);
  expect(c.shouldCompact(msgs(1), fakeBrain(100000))).toBe(false);
});
test("compact keeps system + most recent, drops oldest", async () => {
  const c = new TruncateCompactor();
  const out = await c.compact(msgs(20), fakeBrain(50), {} as never);
  expect(out[0]!.role).toBe("system");
  expect(out.at(-1)!.content.startsWith("msg-19-")).toBe(true);
  expect(out.length).toBeLessThan(21);
});
