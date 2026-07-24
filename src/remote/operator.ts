import type { Relay, JobView } from "./types.js";
import { TERMINAL } from "./types.js";

export interface SendDeps {
  relay: Relay;
  task: string;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const realSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// Operator side: enqueue the task and poll GET /jobs/:id every ~2s until a terminal state.
// (Polling, no webhook ni long-poll — ver spec "Canal de retorno del resultado".)
export async function sendTask(d: SendDeps): Promise<JobView> {
  const sleep = d.sleep ?? realSleep;
  const interval = d.pollIntervalMs ?? 2000;
  const { id } = await d.relay.enqueue(d.task);
  for (;;) {
    if (d.signal?.aborted) throw new Error("operator: abortado");
    const view = await d.relay.getJob(id);
    if (!view) throw new Error(`job ${id} not found`);
    if (TERMINAL.has(view.status)) return view;
    await sleep(interval);
  }
}
