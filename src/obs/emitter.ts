import type { GateDecision } from "../gate/index.js";
import type { RuntimeError } from "../types.js";

export interface RunEventBase { runId: string; turn: number; businessId: string; agent: string; ts: number; }
export type RunEventBody =
  | { t: "run_start" | "run_end" }
  | { t: "brain_call_start" | "brain_call_end" }
  | { t: "gate_decision"; decision: GateDecision }
  | { t: "tool_execute_start" | "tool_execute_end"; tool: string }
  | { t: "compaction_triggered" }
  | { t: "error"; err: RuntimeError };
export type RunEvent = RunEventBody & { turn: number };
export interface Emitter { emit(e: RunEvent): void; }
