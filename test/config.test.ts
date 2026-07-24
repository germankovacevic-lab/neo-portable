import { expect, test } from "vitest";
import { loadConfig, buildRuntime } from "../src/cli.js";

test("loads YAML and builds a runtime with the configured tools/gate", async () => {
  const cfg = await loadConfig(new URL("../config/example.anthropic.yaml", import.meta.url).pathname);
  const rt = await buildRuntime(cfg, { anthropicApiKey: "sk-test" });
  expect(rt.registry.list().map(s => s.name)).toEqual(["calculate"]);
  expect(rt.brain.id).toContain("haiku");
});

test("ollama provider builds an OllamaBrain", async () => {
  const cfg = await loadConfig(new URL("../config/example.ollama.yaml", import.meta.url).pathname);
  const rt = await buildRuntime(cfg, {});
  expect(rt.brain.id).toContain("ollama");
  expect(rt.brain.id).toContain("qwen2.5");
});
