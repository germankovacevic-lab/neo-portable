import { createRunContext } from "./context.js";
import { StructuredLogEmitter } from "./obs/log-emitter.js";
import { resolveEscalation } from "./gate/escalation.js";
import { defaultRetryPolicy, decideRetry } from "./errors/retry.js";
import type { RetryPolicy } from "./errors/retry.js";
import type { Brain, BrainChunk } from "./brain/index.js";
import type { Compactor } from "./compactor/index.js";
import type { Gate, EscalationHandler } from "./gate/index.js";
import type { Persona } from "./persona/index.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { Memory, MemoryPolicy } from "./memory/index.js";
import type { BusinessMeta, Message, RunResult, RuntimeError, ToolCall, ToolResult } from "./types.js";

export interface RunInput {
  brain: Brain; registry: ToolRegistry; gate: Gate; compactor: Compactor; persona: Persona;
  business: BusinessMeta; agent: string; maxTurns: number; prompt: string;
  memory?: Memory; memoryPolicy?: MemoryPolicy; escalationHandler?: EscalationHandler; escalationTimeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

let runCounter = 0;
export function newRunId(): string { return `run-${process.pid}-${++runCounter}`; }

function toRuntimeError(e: unknown): RuntimeError {
  if (e && typeof e === "object" && "family" in e && "message" in e) {
    const fam = (e as { family: unknown }).family;
    if (fam === "brain" || fam === "tool" || fam === "gate") return e as RuntimeError;
  }
  return { family: "brain", subtype: "transient", message: e instanceof Error ? e.message : String(e) };
}

export async function run(i: RunInput): Promise<RunResult> {
  const runId = newRunId();
  const emit = new StructuredLogEmitter({ runId, businessId: i.business.id, agent: i.agent });
  const ctx = createRunContext({ runId, agent: i.agent, business: i.business, channel: { source: "cli" }, maxTurns: i.maxTurns, emit });
  ctx.messages.push({ role: "system", content: await i.persona.systemPrompt() }, { role: "user", content: i.prompt });

  const policy = i.retryPolicy ?? defaultRetryPolicy;

  try {
    ctx.emit.emit({ t: "run_start", turn: 0 });

    let lastText = "";
    while (ctx.turn < ctx.maxTurns && !ctx.signal.aborted) {
      if (i.compactor.shouldCompact(ctx.messages, i.brain)) {
        ctx.messages = await i.compactor.compact(ctx.messages, i.brain, ctx);
        ctx.emit.emit({ t: "compaction_triggered", turn: ctx.turn });
      }
      // Buffer the full turn, with retry.
      let text = ""; const calls: ToolCall[] = [];
      let attempt = 0;
      for (;;) {
        attempt++;
        text = ""; calls.length = 0; // reset partial accumulation each attempt
        try {
          ctx.emit.emit({ t: "brain_call_start", turn: ctx.turn });
          for await (const c of i.brain.complete({ messages: ctx.messages, tools: i.registry.list() }, ctx)) {
            if (c.type === "text") text += c.text;
            else if (c.type === "tool_call") calls.push(c.call);
            else ctx.cost.add(c.tokensIn, c.tokensOut);
          }
          ctx.emit.emit({ t: "brain_call_end", turn: ctx.turn });
          break; // success → leave retry loop
        } catch (e) {
          const err = toRuntimeError(e);
          ctx.emit.emit({ t: "error", err, turn: ctx.turn });
          const decision = decideRetry(policy, err, attempt);
          if (decision.special === "compact") {
            ctx.messages = await i.compactor.compact(ctx.messages, i.brain, ctx);
            ctx.emit.emit({ t: "compaction_triggered", turn: ctx.turn });
          }
          if (!decision.retry) throw err; // not retryable → bubble to outer try/catch → ok:false
          if (decision.backoffMs > 0) await new Promise(r => setTimeout(r, decision.backoffMs));
          // else: loop and retry immediately
        }
      }
      lastText = text;

      // Assistant text + tool_use into history BEFORE the tool_results.
      if (text || calls.length > 0)
        ctx.messages.push({ role: "assistant", content: text, ...(calls.length > 0 ? { toolCalls: calls } : {}) });
      ctx.turn++;                    // count this brain round-trip
      if (calls.length === 0) break; // DONE

      for (const call of calls) {
        const decision = await i.gate.check(call, ctx);
        let result: ToolResult;
        if (decision.kind === "allow") result = await execTool(i, call, ctx);
        else if (decision.kind === "deny") result = { ok: false, output: "", error: `denied: ${decision.reason}` };
        else {
          const d = await resolveEscalation(i.escalationHandler, decision.payload, ctx, i.escalationTimeoutMs ?? 30000);
          result = d === "allow" ? await execTool(i, call, ctx) : { ok: false, output: "", error: "escalation denied" };
        }
        ctx.messages.push({ role: "tool", content: result.ok ? result.output : `ERROR: ${result.error}`, toolCallId: call.id });
      }
    }

    if (i.memory && i.memoryPolicy?.onRunEnd) {
      for (const e of await i.memoryPolicy.onRunEnd(ctx)) await i.memory.write(e, ctx);
    }
    ctx.emit.emit({ t: "run_end", turn: ctx.turn });
    return { ok: true, output: lastText, turns: ctx.turn, cost: ctx.cost.snapshot() };
  } catch (e) {
    const error = toRuntimeError(e);
    ctx.emit.emit({ t: "error", err: error, turn: ctx.turn });
    return { ok: false, error, turns: ctx.turn, cost: ctx.cost.snapshot() };
  }
}

async function execTool(i: RunInput, call: ToolCall, ctx: import("./context.js").RunContext): Promise<ToolResult> {
  const tool = i.registry.get(call.name);
  if (!tool) return { ok: false, output: "", error: "not_found" };
  ctx.emit.emit({ t: "tool_execute_start", tool: call.name, turn: ctx.turn });
  try {
    const r = await tool.execute(call.input, ctx);
    ctx.emit.emit({ t: "tool_execute_end", tool: call.name, turn: ctx.turn });
    return r;
  } catch (e) {
    ctx.emit.emit({ t: "tool_execute_end", tool: call.name, turn: ctx.turn });
    return { ok: false, output: "", error: e instanceof Error ? e.message : String(e) };
  }
}
