import type { RunContext } from "../context.js";
import type { ToolCall } from "../types.js";
import type { Gate, GateDecision } from "./index.js";

export interface GatePolicy { allow: string[]; escalate: string[]; }

export class HeldByDefaultGate implements Gate {
  constructor(private policy: GatePolicy) {}
  async check(call: ToolCall, ctx: RunContext): Promise<GateDecision> {
    let decision: GateDecision;
    if (this.policy.allow.includes(call.name)) decision = { kind: "allow" };
    else if (this.policy.escalate.includes(call.name))
      decision = { kind: "escalate", payload: { call, reason: "not in allowlist", business: ctx.business, runId: ctx.runId } };
    else decision = { kind: "deny", reason: `held-by-default: ${call.name} no permitido` };
    ctx.emit.emit({ t: "gate_decision", decision, turn: ctx.turn });
    return decision;
  }
}
