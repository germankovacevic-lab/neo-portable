import Anthropic from "@anthropic-ai/sdk";
import type { Brain, BrainChunk, BrainInput } from "./index.js";
import type { RunContext } from "../context.js";
import type { Message, RuntimeError, ToolCall } from "../types.js";
import type { ToolSchema } from "../tools/registry.js";

type Brn = Extract<RuntimeError, { family: "brain" }>;
const brainErr = (subtype: Brn["subtype"], message: string): Brn => ({ family: "brain", subtype, message });

export function mapAnthropicError(e: unknown): Brn {
  const err = (e ?? {}) as { status?: number; error?: { error?: { message?: string } } };
  const msg = err.error?.error?.message ?? "";
  if (err.status === 429) return brainErr("rate_limit", "429");
  if (err.status === 401 || err.status === 403) return brainErr("auth", "auth");
  if (/too long|context|exceed/i.test(msg)) return brainErr("context_overflow", msg);
  if (/content|safety|policy/i.test(msg)) return brainErr("content_filter", msg);
  return brainErr("transient", msg || `status ${err.status ?? "?"}`);
}

export function assembleToolUse(meta: { id: string; name: string }, jsonParts: string[]): ToolCall {
  const raw = jsonParts.join("") || "{}";
  return { id: meta.id, name: meta.name, input: JSON.parse(raw) as unknown };
}

const toWireOne = (m: Message): Anthropic.MessageParam | null => {
  if (m.role === "system") return null; // goes separately
  if (m.role === "tool")
    return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId!, content: m.content }] };
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const blocks: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return { role: "assistant", content: blocks };
  }
  return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
};

export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map(toWireOne).filter((x): x is Anthropic.MessageParam => x !== null);
}

const toolsToWire = (t: ToolSchema[]): Anthropic.Tool[] =>
  t.map(s => ({ name: s.name, description: s.description, input_schema: s.parameters as Anthropic.Tool.InputSchema }));

export class AnthropicBrain implements Brain {
  readonly id: string;
  private client: Anthropic;
  constructor(private opts: { model: string; apiKey: string; contextLimitTokens: number; maxTokens?: number }) {
    this.id = `anthropic:${opts.model}`;
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }
  get contextLimitTokens(): number { return this.opts.contextLimitTokens; }

  async *complete(input: BrainInput, _ctx: RunContext): AsyncIterable<BrainChunk> {
    const system = input.messages.find(m => m.role === "system")?.content;
    const messages = toAnthropicMessages(input.messages);
    let stream;
    try {
      stream = this.client.messages.stream({
        model: this.opts.model, max_tokens: this.opts.maxTokens ?? 2048,
        ...(system ? { system } : {}), messages, tools: toolsToWire(input.tools),
      });
    } catch (e) { throw mapAnthropicError(e); }

    let cur: { id: string; name: string; parts: string[] } | null = null;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use")
          cur = { id: ev.content_block.id, name: ev.content_block.name, parts: [] };
        else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
          yield { type: "text", text: ev.delta.text };
        else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta" && cur)
          cur.parts.push(ev.delta.partial_json);
        else if (ev.type === "content_block_stop" && cur) { yield { type: "tool_call", call: assembleToolUse(cur, cur.parts) }; cur = null; }
        else if (ev.type === "message_delta" && ev.usage)
          yield { type: "usage", tokensIn: 0, tokensOut: ev.usage.output_tokens ?? 0 };
      }
      const final = await stream.finalMessage();
      yield { type: "usage", tokensIn: final.usage.input_tokens, tokensOut: 0 };
    } catch (e) { throw mapAnthropicError(e); }
  }
}
