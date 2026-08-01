import type { Brain, BrainChunk, BrainInput } from "./index.js";
import type { RunContext } from "../context.js";
import type { Message, RuntimeError, ToolCall } from "../types.js";
import type { ToolSchema } from "../tools/registry.js";

type Brn = Extract<RuntimeError, { family: "brain" }>;
const brainErr = (subtype: Brn["subtype"], message: string): Brn => ({ family: "brain", subtype, message });

// --- Google Generative Language wire shapes (v1beta generateContent) ---
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
  // Newer Gemini models attach an opaque thought signature to each functionCall part and
  // require it echoed back on the follow-up turn, else they 400. We capture and replay it.
  thoughtSignature?: string;
}
export interface GeminiContent { role: "user" | "model"; parts: GeminiPart[]; }
interface GeminiResp {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; status?: string; message?: string };
}

export function mapGeminiError(status: number, message: string): Brn {
  if (status === 429) return brainErr("rate_limit", "429");
  if (status === 401 || status === 403) return brainErr("auth", "auth");
  if (status === 400 && /token|context|exceed|too long/i.test(message)) return brainErr("context_overflow", message);
  if (/safety|blocked|policy/i.test(message)) return brainErr("content_filter", message);
  return brainErr("transient", message || `status ${status}`);
}

// Gemini needs the function NAME in each functionResponse, but our tool Message only
// carries toolCallId. Reconstruct id -> name from the assistant turn that emitted the call,
// then merge adjacent same-role contents (Gemini rejects consecutive same-role turns).
export function toGeminiContents(messages: Message[]): GeminiContent[] {
  const idToName = new Map<string, string>();
  for (const m of messages)
    for (const c of m.toolCalls ?? []) idToName.set(c.id, c.name);

  const raw: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") continue; // goes via systemInstruction
    if (m.role === "tool") {
      raw.push({ role: "user", parts: [{ functionResponse: { name: idToName.get(m.toolCallId!) ?? m.toolCallId ?? "tool", response: { result: m.content } } }] });
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        const sig = (c.providerMeta as { thoughtSignature?: string } | undefined)?.thoughtSignature;
        parts.push({ functionCall: { name: c.name, args: c.input }, ...(sig ? { thoughtSignature: sig } : {}) });
      }
      raw.push({ role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] });
    } else {
      raw.push({ role: "user", parts: [{ text: m.content }] });
    }
  }

  const merged: GeminiContent[] = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === c.role) last.parts.push(...c.parts);
    else merged.push({ role: c.role, parts: [...c.parts] });
  }
  return merged;
}

export function geminiToChunks(r: GeminiResp): BrainChunk[] {
  const out: BrainChunk[] = [];
  const parts = r?.candidates?.[0]?.content?.parts ?? [];
  let i = 0;
  for (const p of parts) {
    if (p.text) out.push({ type: "text", text: p.text });
    else if (p.functionCall) out.push({ type: "tool_call", call: { id: `gem_${i++}`, name: p.functionCall.name, input: p.functionCall.args ?? {}, ...(p.thoughtSignature ? { providerMeta: { thoughtSignature: p.thoughtSignature } } : {}) } });
  }
  out.push({ type: "usage", tokensIn: r?.usageMetadata?.promptTokenCount ?? 0, tokensOut: r?.usageMetadata?.candidatesTokenCount ?? 0 });
  return out;
}

const toolsToWire = (t: ToolSchema[]): unknown[] =>
  t.length > 0 ? [{ functionDeclarations: t.map(s => ({ name: s.name, description: s.description, parameters: s.parameters })) }] : [];

export class GeminiBrain implements Brain {
  readonly id: string;
  constructor(private opts: { model: string; apiKey: string; contextLimitTokens: number; baseUrl?: string }) {
    this.id = `gemini:${opts.model}`;
  }
  get contextLimitTokens(): number { return this.opts.contextLimitTokens; }

  async *complete(input: BrainInput, _ctx: RunContext): AsyncIterable<BrainChunk> {
    const system = input.messages.find(m => m.role === "system")?.content;
    const base = this.opts.baseUrl ?? "https://generativelanguage.googleapis.com";
    const url = `${base}/v1beta/models/${this.opts.model}:generateContent?key=${this.opts.apiKey}`;
    const body: Record<string, unknown> = {
      contents: toGeminiContents(input.messages),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(input.tools.length > 0 ? { tools: toolsToWire(input.tools) } : {}),
    };
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { throw brainErr("transient", e instanceof Error ? e.message : "fetch failed"); }
    if (!res.ok) {
      let msg = "";
      try { msg = ((await res.json()) as GeminiResp).error?.message ?? ""; } catch { /* body not JSON */ }
      throw mapGeminiError(res.status, msg);
    }
    for (const c of geminiToChunks((await res.json()) as GeminiResp)) yield c;
  }
}
