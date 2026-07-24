import type { RuntimeError } from "../types.js";
import { errKey } from "./taxonomy.js";

export type Special = "compact" | "feedback_to_model" | null;
export interface RetryRule { retry: boolean; maxAttempts: number; backoffMs: number; special: Special; }
export type RetryPolicy = Record<string, RetryRule>;

const R = (retry: boolean, maxAttempts = 1, backoffMs = 0, special: Special = null): RetryRule =>
  ({ retry, maxAttempts, backoffMs, special });

export const defaultRetryPolicy: RetryPolicy = {
  "brain.rate_limit": R(true, 5, 1000),
  "brain.transient": R(true, 3, 500),
  "brain.context_overflow": R(true, 2, 0, "compact"),
  "brain.content_filter": R(false),
  "brain.auth": R(false),
  "tool.timeout": R(true, 1, 0),
  "tool.invalid_output": R(false, 1, 0, "feedback_to_model"),
  "tool.auth": R(false),
  "tool.not_found": R(false),
  "gate.policy_conflict": R(false),
  "gate.escalation_timeout": R(false),
};

export interface RetryDecision { retry: boolean; backoffMs: number; special: Special; }

export function decideRetry(policy: RetryPolicy, err: RuntimeError, attempt: number): RetryDecision {
  const rule = policy[errKey(err)] ?? R(false);
  const retry = rule.retry && attempt < rule.maxAttempts;
  return { retry, backoffMs: rule.backoffMs, special: rule.special };
}
