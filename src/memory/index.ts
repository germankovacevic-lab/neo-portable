import type { RunContext } from "../context.js";
import type { MemoryQuery } from "../types.js";

export interface MemoryEntry { title: string; body: string; }
export interface MemoryHit extends MemoryEntry { score?: number; }
export interface Memory {
  read(q: MemoryQuery, ctx: RunContext): Promise<MemoryHit[]>;
  write(e: MemoryEntry, ctx: RunContext): Promise<void>;
}
export interface MemoryPolicy {
  onTurnEnd?(ctx: RunContext): Promise<MemoryEntry[]>;
  onRunEnd?(ctx: RunContext): Promise<MemoryEntry[]>;
}
