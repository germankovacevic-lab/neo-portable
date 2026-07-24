import type { Brain, BrainChunk, BrainInput } from "./index.js";
import type { RunContext } from "../context.js";
import type { Message } from "../types.js";
import type { ToolSchema } from "../tools/registry.js";

interface OllamaResp {
  message: { content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
  prompt_eval_count?: number; eval_count?: number;
}

interface OllamaToolCall { function: { name: string; arguments: unknown }; }
export interface OllamaWireMessage { role: string; content: string; tool_calls?: OllamaToolCall[]; }

export function toOllamaMessages(messages: Message[]): OllamaWireMessage[] {
  return messages.map((m): OllamaWireMessage => {
    if (m.role === "assistant" && m.toolCalls != null && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map(c => ({ function: { name: c.name, arguments: c.input } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function ollamaToChunks(r: OllamaResp): BrainChunk[] {
  const out: BrainChunk[] = [];
  const message = r?.message ?? { content: "" };
  if (message.content) out.push({ type: "text", text: message.content });
  let i = 0;
  for (const tc of message.tool_calls ?? [])
    out.push({ type: "tool_call", call: { id: `oll_${i++}`, name: tc.function.name, input: tc.function.arguments } });
  out.push({ type: "usage", tokensIn: r?.prompt_eval_count ?? 0, tokensOut: r?.eval_count ?? 0 });
  return out;
}

export class OllamaBrain implements Brain {
  readonly id: string;
  constructor(private opts: { model: string; contextLimitTokens: number; baseUrl?: string }) { this.id = `ollama:${opts.model}`; }
  get contextLimitTokens(): number { return this.opts.contextLimitTokens; }
  async *complete(input: BrainInput, _ctx: RunContext): AsyncIterable<BrainChunk> {
    const tools = input.tools.map((s: ToolSchema) => ({ type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } }));
    const res = await fetch(`${this.opts.baseUrl ?? "http://localhost:11434"}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.opts.model, stream: false, messages: toOllamaMessages(input.messages), tools }),
    });
    if (!res.ok) throw { family: "brain", subtype: res.status === 404 ? "auth" : "transient", message: `ollama ${res.status}` };
    for (const c of ollamaToChunks(await res.json() as OllamaResp)) yield c;
  }
}
