import type { BusinessMeta, ChannelRef, CostSnapshot, Message } from "./types.js";
import type { Emitter } from "./obs/emitter.js";

export class CostAccumulator {
  private tokensIn = 0; private tokensOut = 0;
  constructor(private usdPerInTok = 0, private usdPerOutTok = 0) {}
  add(tokensIn: number, tokensOut: number): void { this.tokensIn += tokensIn; this.tokensOut += tokensOut; }
  snapshot(): CostSnapshot {
    return { tokensIn: this.tokensIn, tokensOut: this.tokensOut,
             usd: this.tokensIn * this.usdPerInTok + this.tokensOut * this.usdPerOutTok };
  }
}

export interface RunContext {
  runId: string; agent: string; business: BusinessMeta; channel: ChannelRef;
  messages: Message[]; turn: number; maxTurns: number;
  cost: CostAccumulator; emit: Emitter; signal: AbortSignal;
  metadata: Record<string, unknown>;
}

export interface CreateCtxInput {
  runId: string; agent: string; business: BusinessMeta; channel: ChannelRef;
  maxTurns: number; emit: Emitter; signal?: AbortSignal;
  usdPerInTok?: number; usdPerOutTok?: number;
}

export function createRunContext(i: CreateCtxInput): RunContext {
  return {
    runId: i.runId, agent: i.agent, business: i.business, channel: i.channel,
    messages: [], turn: 0, maxTurns: i.maxTurns,
    cost: new CostAccumulator(i.usdPerInTok ?? 0, i.usdPerOutTok ?? 0),
    emit: i.emit, signal: i.signal ?? new AbortController().signal, metadata: {},
  };
}
