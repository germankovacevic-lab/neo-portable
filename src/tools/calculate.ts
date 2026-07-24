import type { Tool } from "./registry.js";
import type { ToolResult } from "../types.js";

// Digits, arithmetic operators, parentheses, dot, and spaces only.
const SAFE = /^[\d+\-*/().\s]+$/;
// Reject exponentiation (** and * *) to avoid a CPU DoS.
const EXPONENT = /\*\s*\*/;

export const calculate: Tool = {
  name: "calculate",
  schema: { name: "calculate", description: "Evaluate an arithmetic expression.",
            parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
  async execute(input): Promise<ToolResult> {
    const expr = (input as { expression?: unknown }).expression;
    if (typeof expr !== "string" || !SAFE.test(expr) || EXPONENT.test(expr))
      return { ok: false, output: "", error: "invalid_output" };
    try {
      const val = Function(`"use strict"; return (${expr});`)() as unknown;
      return { ok: true, output: String(val) };
    } catch { return { ok: false, output: "", error: "eval failed" }; }
  },
};
