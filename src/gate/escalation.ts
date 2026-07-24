import type { RunContext } from "../context.js";
import type { EscalationHandler, EscalationPayload } from "./index.js";

export async function resolveEscalation(
  handler: EscalationHandler | undefined, payload: EscalationPayload, ctx: RunContext, timeoutMs: number
): Promise<"allow" | "deny"> {
  if (!handler) return "deny";
  const timeout = new Promise<"deny">((res) => setTimeout(() => res("deny"), timeoutMs));
  return Promise.race([handler.resolve(payload, ctx), timeout]);
}
