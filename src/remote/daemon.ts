import type { Relay, JobResult } from "./types.js";

export interface DaemonDeps {
  relay: Relay;
  // Runs a task (in production: prompt → run({...rt, prompt}) → RunResult mapped to JobResult).
  runTask: (task: string) => Promise<JobResult>;
  signal: AbortSignal;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (e: unknown) => void;
  onIdle?: () => void; // called when a poll returns no job (empty queue)
}

const realSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const failed = (msg: string): JobResult => ({ ok: false, output: `ERROR: ${msg}`, turns: 0, cost: { tokensIn: 0, tokensOut: 0, usd: 0 } });

// Single-flight loop: poll → run → postResult → only then poll again. Never runs two jobs
// at once. Network errors (poll/post) or run errors do NOT kill the daemon: they're logged and it keeps going.
export async function runDaemon(d: DaemonDeps): Promise<void> {
  const sleep = d.sleep ?? realSleep;
  const interval = d.pollIntervalMs ?? 2500;
  while (!d.signal.aborted) {
    let job;
    try { job = await d.relay.poll(); }
    catch (e) { d.onError?.(e); await sleep(interval); continue; }

    if (!job) {
      d.onIdle?.();
      if (d.signal.aborted) break;
      await sleep(interval);
      continue;
    }

    let result: JobResult;
    try { result = await d.runTask(job.task); }
    catch (e) { result = failed(e instanceof Error ? e.message : String(e)); }

    try { await d.relay.postResult(job.id, result); }
    catch (e) { d.onError?.(e); } // the job stays `claimed`; recovery is future work (the schema supports it)
  }
}
