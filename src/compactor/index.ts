import type { Brain } from "../brain/index.js";
import type { RunContext } from "../context.js";
import type { Message } from "../types.js";

export interface Compactor {
  shouldCompact(messages: Message[], brain: Brain): boolean;
  compact(messages: Message[], brain: Brain, ctx: RunContext): Promise<Message[]>;
}
// Cheap estimate: ~4 chars per token.
export const estimateTokens = (m: Message[]): number => Math.ceil(m.reduce((n, x) => n + x.content.length, 0) / 4);
