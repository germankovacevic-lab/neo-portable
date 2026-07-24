import { expect, test } from "vitest";
import { run, newRunId } from "../src/loop.js";
import { FakeBrain } from "../src/brain/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { calculate } from "../src/tools/calculate.js";
import { HeldByDefaultGate } from "../src/gate/held-by-default.js";
import { TruncateCompactor } from "../src/compactor/truncate.js";
import { FilePersona } from "../src/persona/index.js";
import type { Brain, BrainChunk, BrainInput } from "../src/brain/index.js";
import type { RuntimeError, Message } from "../src/types.js";
import { defaultRetryPolicy } from "../src/errors/retry.js";

// zero-backoff policy so retry tests are fast (no real sleeps)
const fastPolicy = Object.fromEntries(
  Object.entries(defaultRetryPolicy).map(([k, v]) => [k, { ...v, backoffMs: 0 }])
);

// no-retry policy for existing error tests so they stay instant after wiring
const noRetryPolicy = Object.fromEntries(
  Object.entries(defaultRetryPolicy).map(([k, v]) => [k, { ...v, maxAttempts: 1, backoffMs: 0 }])
);

const persona = new FilePersona(new URL("./fixtures/persona.md", import.meta.url).pathname);
const reg = () => { const r = new ToolRegistry(); r.register(calculate); return r; };

test("ALLOW path: calls calculate, feeds result, finishes", async () => {
  const brain = new FakeBrain([
    [{ type: "tool_call", call: { id: "1", name: "calculate", input: { expression: "21*2" } } }],
    [{ type: "text", text: "son 42" }],
  ]);
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "what is 21*2",
  });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.output).toContain("42");
});

test("DENY path: gate denies, result fed back, model finishes gracefully", async () => {
  const brain = new FakeBrain([
    [{ type: "tool_call", call: { id: "1", name: "send_email", input: {} } }],
    [{ type: "text", text: "no puedo mandar mails" }],
  ]);
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "send an email",
  });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.output).toContain("no puedo");
});

test("persists assistant tool_use into history before tool results", async () => {
  const seen: BrainInput[] = [];
  let turn = 0;
  const brain: Brain = {
    id: "rec", contextLimitTokens: 100000,
    async *complete(input: BrainInput): AsyncIterable<BrainChunk> {
      seen.push({ messages: input.messages.map(m => ({ ...m })), tools: input.tools });
      if (turn++ === 0) { yield { type: "tool_call", call: { id: "1", name: "calculate", input: { expression: "21*2" } } }; }
      else { yield { type: "text", text: "son 42" }; }
    },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "what is 21*2",
  });
  expect(res.ok).toBe(true);
  // On the 2nd brain call, history must contain: an assistant msg carrying the tool call, THEN a tool result for the same id.
  const secondTurnMsgs = seen[1]!.messages;
  const asst = secondTurnMsgs.find(m => m.role === "assistant" && m.toolCalls?.some(c => c.id === "1"));
  const toolMsg = secondTurnMsgs.find(m => m.role === "tool" && m.toolCallId === "1");
  expect(asst).toBeTruthy();
  expect(toolMsg).toBeTruthy();
  // ordering: assistant tool_use comes before its tool result
  expect(secondTurnMsgs.indexOf(asst!)).toBeLessThan(secondTurnMsgs.indexOf(toolMsg!));
});

test("brain that throws a RuntimeError yields a typed ok:false result", async () => {
  const err: RuntimeError = { family: "brain", subtype: "rate_limit", message: "429" };
  const brain: Brain = {
    id: "boom", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> { throw err; },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: noRetryPolicy,
  });
  expect(res.ok).toBe(false);
  if (!res.ok) { expect(res.error).toEqual(err); expect(typeof res.turns).toBe("number"); expect(res.cost).toBeTruthy(); }
});

test("brain that throws a plain Error is coerced to brain.transient ok:false", async () => {
  const brain: Brain = {
    id: "boom2", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> { throw new Error("socket hang up"); },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: noRetryPolicy,
  });
  expect(res.ok).toBe(false);
  if (!res.ok) { expect(res.error.family).toBe("brain"); expect(res.error.message).toContain("socket hang up"); }
});

test("a throwing tool is fed back as an error result, run still finishes ok", async () => {
  const boomTool = {
    name: "boom",
    schema: { name: "boom", description: "throws", parameters: { type: "object", properties: {} } },
    async execute(): Promise<never> { throw new Error("tool exploded"); },
  };
  const registry = new ToolRegistry(); registry.register(boomTool);
  const brain = new FakeBrain([
    [{ type: "tool_call", call: { id: "1", name: "boom", input: {} } }],
    [{ type: "text", text: "handled it" }],
  ]);
  const res = await run({
    brain, registry, gate: new HeldByDefaultGate({ allow: ["boom"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "use boom",
  });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.output).toContain("handled it");
});

// ── RetryPolicy wiring tests ──────────────────────────────────────────────

test("brain rate_limit retries then succeeds", async () => {
  let n = 0;
  const brain: Brain = {
    id: "rl", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> {
      if (n++ === 0) throw { family: "brain", subtype: "rate_limit", message: "429" } as RuntimeError;
      yield { type: "text", text: "ok recuperado" };
    },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: ["calculate"], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: fastPolicy,
  });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.output).toContain("recuperado");
  expect(n).toBe(2); // threw once, succeeded on retry
});

test("brain content_filter does NOT retry → ok:false", async () => {
  let n = 0;
  const brain: Brain = {
    id: "cf", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> {
      n++; throw { family: "brain", subtype: "content_filter", message: "blocked" } as RuntimeError;
    },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: [], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: fastPolicy,
  });
  expect(res.ok).toBe(false);
  expect(n).toBe(1); // no retry
});

test("brain transient retries up to maxAttempts then gives up ok:false", async () => {
  let n = 0;
  const brain: Brain = {
    id: "tr", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> {
      n++; throw { family: "brain", subtype: "transient", message: "blip" } as RuntimeError;
    },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: [], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: fastPolicy,
  });
  expect(res.ok).toBe(false);
  expect(n).toBe(3); // transient maxAttempts = 3
});

test("turns counts brain round-trips (one-shot text answer = 1)", async () => {
  const brain = new FakeBrain([[{ type: "text", text: "respuesta directa" }]]);
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: [], escalate: [] }),
    compactor: new TruncateCompactor(), persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola",
  });
  expect(res.ok).toBe(true);
  expect(res.turns).toBe(1);
});

test("newRunId is unique across calls in the same process", () => {
  const a = newRunId(); const b = newRunId();
  expect(a).not.toBe(b);
});

test("context_overflow triggers compaction then retries", async () => {
  let n = 0;
  let compacted = false;
  const brain: Brain = {
    id: "ov", contextLimitTokens: 100000,
    async *complete(): AsyncIterable<BrainChunk> {
      if (n++ === 0) throw { family: "brain", subtype: "context_overflow", message: "too long" } as RuntimeError;
      yield { type: "text", text: "achicado y listo" };
    },
  };
  const spyCompactor = {
    shouldCompact: () => false,
    compact: async (m: Message[]) => { compacted = true; return m; },
  };
  const res = await run({
    brain, registry: reg(), gate: new HeldByDefaultGate({ allow: [], escalate: [] }),
    compactor: spyCompactor as never, persona,
    business: { id: "b", name: "B", leash: "long" }, agent: "default", maxTurns: 5,
    prompt: "hola", retryPolicy: fastPolicy,
  });
  expect(res.ok).toBe(true);
  expect(compacted).toBe(true);
  expect(n).toBe(2);
});
