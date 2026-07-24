import type { Brain } from "../brain/index.js";
import type { RunContext } from "../context.js";
import type { Message } from "../types.js";
import { estimateTokens, type Compactor } from "./index.js";

export class TruncateCompactor implements Compactor {
  // Leave headroom: compact to 75% of the brain's limit.
  shouldCompact(messages: Message[], brain: Brain): boolean {
    return estimateTokens(messages) > brain.contextLimitTokens * 0.75;
  }
  async compact(messages: Message[], brain: Brain, _ctx: RunContext): Promise<Message[]> {
    const system = messages.filter(m => m.role === "system");
    const rest = messages.filter(m => m.role !== "system");
    const budget = brain.contextLimitTokens * 0.5;
    const kept: Message[] = [];
    for (let i = rest.length - 1; i >= 0; i--) {
      const candidate = [rest[i]!, ...kept];
      if (estimateTokens([...system, ...candidate]) > budget && kept.length > 0) break;
      kept.unshift(rest[i]!);
    }
    return [...system, ...kept];
  }
}
