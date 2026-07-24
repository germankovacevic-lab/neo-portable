import type { RunContext } from "../context.js";
import type { ToolCall } from "../types.js";
import type { Gate, GateDecision } from "./index.js";

// Fully-trusted gate: ALWAYS allows. Intended for test/controlled environments
// (e.g. a disposable remote machine). Named explicitly so nobody enables it by accident.
// Doesn't touch HeldByDefaultGate; still emits gate_decision so observability isn't lost.
export class OpenGate implements Gate {
  async check(call: ToolCall, ctx: RunContext): Promise<GateDecision> {
    const decision: GateDecision = { kind: "allow" };
    ctx.emit.emit({ t: "gate_decision", decision, turn: ctx.turn });
    return decision;
  }
}
