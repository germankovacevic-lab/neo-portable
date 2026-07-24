import type { RunContext } from "../context.js";
import type { MemoryEntry, MemoryPolicy } from "./index.js";

export class RuleBasedPolicy implements MemoryPolicy {
  async onRunEnd(ctx: RunContext): Promise<MemoryEntry[]> {
    const last = [...ctx.messages].reverse().find(m => m.role === "assistant");
    if (!last) return [];
    return [{ title: `run ${ctx.runId}`, body: last.content.slice(0, 500) }];
  }
}
