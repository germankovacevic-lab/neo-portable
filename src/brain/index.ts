import type { RunContext } from "../context.js";
import type { Message, ToolCall } from "../types.js";
import type { ToolSchema } from "../tools/registry.js";

export interface BrainInput { messages: Message[]; tools: ToolSchema[]; }
export type BrainChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; tokensIn: number; tokensOut: number };

export interface Brain {
  readonly id: string;
  readonly contextLimitTokens: number;
  complete(input: BrainInput, ctx: RunContext): AsyncIterable<BrainChunk>;
}
