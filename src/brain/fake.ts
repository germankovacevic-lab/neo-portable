import type { Brain, BrainChunk } from "./index.js";

export class FakeBrain implements Brain {
  readonly id = "fake";
  readonly contextLimitTokens = 100000;
  private turn = 0;
  constructor(private script: BrainChunk[][]) {}
  async *complete(_input?: unknown, _ctx?: unknown): AsyncIterable<BrainChunk> {
    const chunks = this.script[this.turn] ?? [];
    this.turn++;
    for (const c of chunks) yield c;
  }
}
