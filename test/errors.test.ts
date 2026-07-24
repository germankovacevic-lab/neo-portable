import { expect, test } from "vitest";
import { defaultRetryPolicy, decideRetry } from "../src/errors/retry.js";
import type { RuntimeError } from "../src/types.js";

const rl: RuntimeError = { family: "brain", subtype: "rate_limit", message: "429" };
const cf: RuntimeError = { family: "brain", subtype: "content_filter", message: "blocked" };
const ov: RuntimeError = { family: "brain", subtype: "context_overflow", message: "too big" };
const inval: RuntimeError = { family: "tool", subtype: "invalid_output", tool: "x", message: "bad" };

test("rate_limit retries with backoff", () => {
  expect(decideRetry(defaultRetryPolicy, rl, 1)).toMatchObject({ retry: true });
});
test("content_filter never retries", () => {
  expect(decideRetry(defaultRetryPolicy, cf, 1).retry).toBe(false);
});
test("context_overflow signals compaction not blind retry", () => {
  expect(decideRetry(defaultRetryPolicy, ov, 1).special).toBe("compact");
});
test("tool invalid_output feeds back to model", () => {
  expect(decideRetry(defaultRetryPolicy, inval, 1).special).toBe("feedback_to_model");
});
