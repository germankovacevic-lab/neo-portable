import type { Relay, Job, JobView, JobResult } from "./types.js";

export interface RelayClientOpts {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

// HTTP implementation of the Relay contract. No deps: uses native `fetch` (like Ollama/Gemini).
// Every request carries an AbortController with a timeout (fetch without one hangs on long loops).
export class RelayClient implements Relay {
  private base: string;
  private token: string;
  private f: typeof fetch;
  private timeoutMs: number;

  constructor(o: RelayClientOpts) {
    this.base = o.baseUrl.replace(/\/+$/, "");
    this.token = o.token;
    this.f = o.fetchFn ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.base}${path}`, {
        ...init,
        signal: ac.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...init?.headers },
      });
      if (res.status === 401) throw new Error("relay: 401 unauthorized");
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async enqueue(task: string): Promise<{ id: string }> {
    const r = await this.req("/jobs", { method: "POST", body: JSON.stringify({ task }) });
    return await r.json() as { id: string };
  }
  async getJob(id: string): Promise<JobView | null> {
    const r = await this.req(`/jobs/${id}`);
    if (r.status === 404) return null;
    return await r.json() as JobView;
  }
  async cancel(id: string): Promise<{ cancelled: boolean }> {
    const r = await this.req(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
    return await r.json() as { cancelled: boolean };
  }
  async health(): Promise<{ busy: boolean; claimedJobId?: string }> {
    const r = await this.req("/health");
    return await r.json() as { busy: boolean; claimedJobId?: string };
  }
  async poll(): Promise<Job | null> {
    const r = await this.req("/poll");
    if (r.status === 204) return null;
    return await r.json() as Job;
  }
  async postResult(id: string, result: JobResult): Promise<void> {
    await this.req(`/jobs/${id}/result`, { method: "POST", body: JSON.stringify(result) });
  }
}
