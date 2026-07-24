import type { CostSnapshot } from "../types.js";

// Estados del job (ver spec: ciclo de vida). `claimed` soporta recovery a futuro.
export type JobStatus = "pending" | "claimed" | "completed" | "failed" | "cancelled" | "timeout";

export interface Job { id: string; task: string; status: JobStatus; }

// Result of a full run by the remote agent (what the daemon posts back).
export interface JobResult { ok: boolean; output: string; turns: number; cost: CostSnapshot; }

export interface JobView extends Job { result?: JobResult; }

export const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["completed", "failed", "cancelled", "timeout"]);

// The relay contract as seen by clients. The real HTTP implementation (RelayClient) and the
// test fakes share this interface → daemon/operator are tested without a network.
export interface Relay {
  // Operador
  enqueue(task: string): Promise<{ id: string }>;
  getJob(id: string): Promise<JobView | null>;
  cancel(id: string): Promise<{ cancelled: boolean }>;
  health(): Promise<{ busy: boolean; claimedJobId?: string }>;
  // Agente (daemon)
  poll(): Promise<Job | null>;
  postResult(id: string, result: JobResult): Promise<void>;
}
