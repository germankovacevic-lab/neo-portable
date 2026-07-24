import type { RunContext } from "../context.js";
import type { BusinessMeta, ToolCall } from "../types.js";

export interface EscalationPayload { call: ToolCall; reason: string; business: BusinessMeta; runId: string; }
export type GateDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "escalate"; payload: EscalationPayload };
export interface Gate { check(call: ToolCall, ctx: RunContext): Promise<GateDecision>; }
export interface EscalationHandler { resolve(p: EscalationPayload, ctx: RunContext): Promise<"allow" | "deny">; }
