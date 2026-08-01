export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
// `providerMeta` is an opaque, provider-local bag: a brain may stash wire details it must
// echo back on later turns (e.g. Gemini's `thoughtSignature`). The loop, gate, and tools
// never read it — it rides the message history untouched, keeping the contract model-agnostic.
export interface ToolCall { id: string; name: string; input: unknown; providerMeta?: Record<string, unknown>; }
export interface ToolResult { ok: boolean; output: string; error?: string; }
export interface ToolResultMessage { role: "tool"; toolCallId: string; result: ToolResult; }

export interface BusinessMeta { id: string; name: string; leash: "short" | "long"; }
export interface ChannelRef { source: string; replyTo?: string; }
export interface MemoryQuery { kind: "semantic" | "file" | "hybrid"; query: string; k?: number; }
export interface CostSnapshot { tokensIn: number; tokensOut: number; usd: number; }

export type RuntimeError =
  | { family: "brain"; subtype: "rate_limit" | "context_overflow" | "content_filter" | "auth" | "transient"; message: string; cause?: unknown }
  | { family: "tool"; subtype: "timeout" | "auth" | "invalid_output" | "not_found"; tool: string; message: string }
  | { family: "gate"; subtype: "policy_conflict" | "escalation_timeout"; message: string };

export type RunResult =
  | { ok: true; output: string; turns: number; cost: CostSnapshot }
  | { ok: false; error: RuntimeError; turns: number; cost: CostSnapshot };

export const userMessage = (content: string): Message => ({ role: "user", content });
export const toolResultMessage = (toolCallId: string, result: ToolResult): ToolResultMessage =>
  ({ role: "tool", toolCallId, result });
