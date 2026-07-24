import type { Emitter, RunEvent } from "./emitter.js";

type Ctx = { runId: string; businessId: string; agent: string };
const now = (): number => Date.now();

export class StructuredLogEmitter implements Emitter {
  constructor(private ctx: Ctx, private sink: (line: string) => void = console.log) {}
  emit(e: RunEvent): void {
    this.sink(JSON.stringify({ ...e, runId: this.ctx.runId, businessId: this.ctx.businessId, agent: this.ctx.agent, ts: now() }));
  }
}
