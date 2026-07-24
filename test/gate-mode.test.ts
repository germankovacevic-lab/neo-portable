import { expect, test } from "vitest";
import { buildRuntime, type NeoConfig } from "../src/cli.js";
import { createRunContext } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

const ctx = () => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4,
  emit: new StructuredLogEmitter({ runId: "r", businessId: "b", agent: "default" }, () => {}),
});
const base: NeoConfig = {
  business: { id: "b", name: "B", leash: "long" },
  agent: "default", persona: "persona.md",
  brain: { provider: "anthropic", model: "claude-haiku-4-5", contextLimitTokens: 1000 },
  gate: { allow: [], escalate: [] }, tools: [], maxTurns: 4,
};
const call = { id: "1", name: "shell", input: {} };

test("gate.mode 'open' builds a gate that allows anything", async () => {
  const rt = await buildRuntime({ ...base, gate: { mode: "open", allow: [], escalate: [] } }, { anthropicApiKey: "x" });
  expect((await rt.gate.check(call, ctx())).kind).toBe("allow");
});

test("no gate.mode stays held-by-default → denies unlisted tool", async () => {
  const rt = await buildRuntime(base, { anthropicApiKey: "x" });
  expect((await rt.gate.check(call, ctx())).kind).toBe("deny");
});

test("shell is registrable from config.tools", async () => {
  const rt = await buildRuntime({ ...base, tools: ["calculate", "shell"] }, { anthropicApiKey: "x" });
  expect(rt.registry.list().map(s => s.name).sort()).toEqual(["calculate", "shell"]);
});
