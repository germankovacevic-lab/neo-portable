import type { RunContext } from "../context.js";
import type { ToolResult } from "../types.js";

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
export interface Tool {
  readonly name: string;
  readonly schema: ToolSchema;
  execute(input: unknown, ctx: RunContext): Promise<ToolResult>;
}
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(t: Tool): void { this.tools.set(t.name, t); }
  get(name: string): Tool | undefined { return this.tools.get(name); }
  list(): ToolSchema[] { return [...this.tools.values()].map(t => t.schema); }
}
