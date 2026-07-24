import { expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMemory } from "../src/memory/file-memory.js";
import { RuleBasedPolicy } from "../src/memory/policy.js";
import { createRunContext } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

const ctx = () => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4,
  emit: new StructuredLogEmitter({ runId: "r", businessId: "b", agent: "default" }, () => {}),
});

test("write then read by file kind finds the entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "neomem-"));
  const mem = new FileMemory(dir);
  await mem.write({ title: "note", body: "the client prefers mornings" }, ctx());
  const hits = await mem.read({ kind: "file", query: "mornings" }, ctx());
  expect(hits.some(h => h.body.includes("mornings"))).toBe(true);
});

test("RuleBasedPolicy summarizes at run end", async () => {
  const c = ctx();
  c.messages.push({ role: "user", content: "hola" }, { role: "assistant", content: "buenas" });
  const entries = await new RuleBasedPolicy().onRunEnd!(c);
  expect(entries[0]!.title).toContain("r"); // runId in the title
});
