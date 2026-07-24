import { expect, test } from "vitest";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { shell } from "../src/tools/shell.js";
import { createRunContext } from "../src/context.js";
import { StructuredLogEmitter } from "../src/obs/log-emitter.js";

const ctx = () => createRunContext({
  runId: "r", agent: "default", business: { id: "b", name: "B", leash: "long" },
  channel: { source: "cli" }, maxTurns: 4,
  emit: new StructuredLogEmitter({ runId: "r", businessId: "b", agent: "default" }, () => {}),
});
const node = (code: string) => `node -e "${code.replace(/"/g, '\\"')}"`;

test("runs a command and captures stdout (ok:true, exitCode 0)", async () => {
  const r = await shell.execute({ command: "echo hola" }, ctx());
  expect(r.ok).toBe(true);
  const out = JSON.parse(r.output) as { stdout: string; exitCode: number };
  expect(out.stdout.trim()).toBe("hola");
  expect(out.exitCode).toBe(0);
});

test("non-zero exit is data, not tool failure: ok:true with exitCode + stderr", async () => {
  const r = await shell.execute({ command: node("process.stderr.write('boom'); process.exit(3)") }, ctx());
  expect(r.ok).toBe(true);
  const out = JSON.parse(r.output) as { stderr: string; exitCode: number };
  expect(out.exitCode).toBe(3);
  expect(out.stderr).toContain("boom");
});

test("truncates output past the byte cap and flags truncated", async () => {
  const r = await shell.execute(
    { command: node("process.stdout.write('x'.repeat(100000))"), maxBytes: 1024 }, ctx());
  const out = JSON.parse(r.output) as { stdout: string; truncated: boolean };
  expect(out.truncated).toBe(true);
  expect(out.stdout.length).toBeLessThanOrEqual(1024);
});

test("kills a command past the timeout (ok:false, error mentions timeout)", async () => {
  const r = await shell.execute(
    { command: node("setTimeout(()=>{}, 10000)"), timeoutMs: 200 }, ctx());
  expect(r.ok).toBe(false);
  expect(r.error?.toLowerCase()).toContain("timeout");
});

test("runs in the provided working directory", async () => {
  const dir = realpathSync(tmpdir());
  const r = await shell.execute({ command: node("process.stdout.write(process.cwd())"), cwd: dir }, ctx());
  const out = JSON.parse(r.output) as { stdout: string };
  expect(realpathSync(out.stdout.trim())).toBe(dir);
});

test("reports durationMs", async () => {
  const r = await shell.execute({ command: "echo hi" }, ctx());
  const out = JSON.parse(r.output) as { durationMs: number };
  expect(typeof out.durationMs).toBe("number");
  expect(out.durationMs).toBeGreaterThanOrEqual(0);
});
