import { spawn } from "node:child_process";
import type { Tool } from "./registry.js";
import type { ToolResult } from "../types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024;

interface ShellInput { command?: unknown; cwd?: unknown; timeoutMs?: unknown; maxBytes?: unknown; }
interface ShellOutcome {
  stdout: string; stderr: string; exitCode: number; truncated: boolean; durationMs: number;
}

// Accumulate chunks up to a byte cap; the rest is dropped and flagged as truncated.
class CappedBuffer {
  private parts: string[] = []; private size = 0; truncated = false;
  constructor(private cap: number) {}
  push(chunk: Buffer): void {
    if (this.size >= this.cap) { this.truncated = true; return; }
    const remaining = this.cap - this.size;
    if (chunk.length > remaining) { this.parts.push(chunk.subarray(0, remaining).toString("utf8")); this.truncated = true; this.size = this.cap; }
    else { this.parts.push(chunk.toString("utf8")); this.size += chunk.length; }
  }
  toString(): string { return this.parts.join(""); }
}

function runShell(command: string, cwd: string | undefined, timeoutMs: number, maxBytes: number):
  Promise<{ kind: "done"; outcome: ShellOutcome } | { kind: "timeout"; durationMs: number } | { kind: "spawn_error"; message: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { shell: true, ...(cwd ? { cwd } : {}) });
    const out = new CappedBuffer(maxBytes), err = new CappedBuffer(maxBytes);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      child.kill("SIGKILL");
      resolve({ kind: "timeout", durationMs: Date.now() - started });
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => out.push(c));
    child.stderr?.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ kind: "spawn_error", message: e instanceof Error ? e.message : String(e) });
    });
    child.on("close", (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ kind: "done", outcome: {
        stdout: out.toString(), stderr: err.toString(),
        exitCode: code ?? -1, truncated: out.truncated || err.truncated,
        durationMs: Date.now() - started,
      } });
    });
  });
}

// The hand: runs a shell command on the machine. Cross-platform (uses the OS default shell).
// A non-zero exit code is DATA (ok:true with the detail), not a tool failure — the loop only exposes
// `output` when ok:true, so the brain always sees stdout/stderr/exitCode to reason about.
// ok:false is reserved for when the tool COULD NOT run the command (timeout, spawn error).
export const shell: Tool = {
  name: "shell",
  schema: {
    name: "shell",
    description: "Run a shell command on the machine and return stdout, stderr, exit code, and duration.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run." },
        cwd: { type: "string", description: "Working directory (optional)." },
        timeoutMs: { type: "number", description: "Timeout in ms (default 60000)." },
      },
      required: ["command"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const i = (input ?? {}) as ShellInput;
    if (typeof i.command !== "string" || i.command.trim() === "")
      return { ok: false, output: "", error: "shell: 'command' required (non-empty string)" };
    const cwd = typeof i.cwd === "string" ? i.cwd : undefined;
    const timeoutMs = typeof i.timeoutMs === "number" && i.timeoutMs > 0 ? i.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maxBytes = typeof i.maxBytes === "number" && i.maxBytes > 0 ? i.maxBytes : DEFAULT_MAX_BYTES;

    const res = await runShell(i.command, cwd, timeoutMs, maxBytes);
    if (res.kind === "timeout")
      return { ok: false, output: "", error: `shell: timeout after ${timeoutMs}ms (process killed)` };
    if (res.kind === "spawn_error")
      return { ok: false, output: "", error: `shell: could not execute: ${res.message}` };
    return { ok: true, output: JSON.stringify(res.outcome) };
  },
};
