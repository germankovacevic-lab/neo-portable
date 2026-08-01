import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { AnthropicBrain } from "./brain/anthropic.js";
import { OllamaBrain } from "./brain/ollama.js";
import { GeminiBrain } from "./brain/gemini.js";
import { ToolRegistry } from "./tools/registry.js";
import { calculate } from "./tools/calculate.js";
import { shell } from "./tools/shell.js";
import { HeldByDefaultGate } from "./gate/held-by-default.js";
import { OpenGate } from "./gate/open.js";
import { TruncateCompactor } from "./compactor/truncate.js";
import { FilePersona } from "./persona/index.js";
import { FileMemory } from "./memory/file-memory.js";
import { RuleBasedPolicy } from "./memory/policy.js";
import { run } from "./loop.js";
import { RelayClient } from "./remote/relay-client.js";
import { runDaemon } from "./remote/daemon.js";
import { sendTask } from "./remote/operator.js";
import type { Brain } from "./brain/index.js";
import type { RunResult } from "./types.js";
import type { JobResult } from "./remote/types.js";

const TOOLS = { calculate, shell };

export interface NeoConfig {
  business: { id: string; name: string; leash: "short" | "long" };
  agent: string; persona: string;
  brain: { provider: "anthropic" | "ollama" | "gemini"; model: string; contextLimitTokens: number; baseUrl?: string };
  gate: { mode?: "open" | "held"; allow: string[]; escalate: string[] };
  memory?: { dir: string }; tools: string[]; maxTurns: number;
}

export async function loadConfig(path: string): Promise<NeoConfig> {
  return parse(await readFile(path, "utf8")) as NeoConfig;
}

export async function buildRuntime(cfg: NeoConfig, secrets: { anthropicApiKey?: string; geminiApiKey?: string }) {
  const registry = new ToolRegistry();
  for (const name of cfg.tools) {
    const t = (TOOLS as Record<string, typeof calculate>)[name];
    if (t) registry.register(t);
  }
  let brain: Brain;
  if (cfg.brain.provider === "ollama") {
    brain = new OllamaBrain({
      model: cfg.brain.model,
      contextLimitTokens: cfg.brain.contextLimitTokens,
      ...(cfg.brain.baseUrl ? { baseUrl: cfg.brain.baseUrl } : {}),
    });
  } else if (cfg.brain.provider === "gemini") {
    brain = new GeminiBrain({
      model: cfg.brain.model,
      apiKey: secrets.geminiApiKey ?? "",
      contextLimitTokens: cfg.brain.contextLimitTokens,
      ...(cfg.brain.baseUrl ? { baseUrl: cfg.brain.baseUrl } : {}),
    });
  } else {
    brain = new AnthropicBrain({ model: cfg.brain.model, apiKey: secrets.anthropicApiKey ?? "", contextLimitTokens: cfg.brain.contextLimitTokens });
  }
  return {
    brain, registry,
    gate: cfg.gate.mode === "open" ? new OpenGate() : new HeldByDefaultGate(cfg.gate),
    compactor: new TruncateCompactor(),
    persona: new FilePersona(cfg.persona),
    ...(cfg.memory ? { memory: new FileMemory(cfg.memory.dir) } : {}),
    memoryPolicy: new RuleBasedPolicy(),
    business: cfg.business, agent: cfg.agent, maxTurns: cfg.maxTurns,
  };
}

const secretsFromEnv = () => ({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
});

function mapResult(res: RunResult): JobResult {
  return res.ok
    ? { ok: true, output: res.output, turns: res.turns, cost: res.cost }
    : { ok: false, output: `ERROR: ${JSON.stringify(res.error)}`, turns: res.turns, cost: res.cost };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable: ${name}`);
  return v;
}

// Daemon: runs on the remote machine, polls the relay, and runs tasks with its own agent.
async function runDaemonMode(cfgPath: string): Promise<void> {
  const cfg = await loadConfig(cfgPath);
  const rt = await buildRuntime(cfg, secretsFromEnv());
  const relay = new RelayClient({ baseUrl: requireEnv("RELAY_URL"), token: requireEnv("AGENT_TOKEN") });
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? "2500");
  console.log(`[daemon] ${cfg.agent} polling ${process.env.RELAY_URL} every ${pollIntervalMs}ms — Ctrl-C to stop`);
  await runDaemon({
    relay, signal: ac.signal, pollIntervalMs,
    runTask: async (task) => mapResult(await run({ ...rt, prompt: task })),
    onError: (e) => console.error("[daemon] error:", e),
  });
}

// Operator: enqueue a task on the relay and wait for the result.
async function remoteSend(task: string): Promise<void> {
  const relay = new RelayClient({ baseUrl: requireEnv("RELAY_URL"), token: requireEnv("OPERATOR_TOKEN") });
  const view = await sendTask({ relay, task });
  console.log(view.result ? view.result.output : `(job ${view.id}: ${view.status})`);
}

async function main(): Promise<void> {
  // Load .env if present (Node 22+ native, no dep) so the documented `cp .env.example .env`
  // flow actually populates process.env. Guarded: Ollama-only users need no .env.
  try { process.loadEnvFile(); } catch { /* no .env file — rely on ambient environment */ }
  const argv = process.argv.slice(2);
  if (argv[0] === "--daemon") return runDaemonMode(argv[1]!);
  if (argv[0] === "--remote-send") return remoteSend(argv.slice(1).join(" "));

  // One-shot mode (default): <config> <prompt...>
  const [cfgPath, ...rest] = argv;
  const prompt = rest.join(" ");
  const cfg = await loadConfig(cfgPath!);
  const rt = await buildRuntime(cfg, secretsFromEnv());
  const res = await run({ ...rt, prompt });
  console.log(res.ok ? res.output : `ERROR: ${JSON.stringify(res.error)}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
