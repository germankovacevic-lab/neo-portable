import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunContext } from "../context.js";
import type { MemoryQuery } from "../types.js";
import type { Memory, MemoryEntry, MemoryHit } from "./index.js";

export class FileMemory implements Memory {
  constructor(private dir: string) {}
  async write(e: MemoryEntry, _ctx: RunContext): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const slug = e.title.replace(/[^\w]+/g, "-").slice(0, 40);
    await writeFile(join(this.dir, `${slug}.md`), `# ${e.title}\n\n${e.body}\n`, "utf8");
  }
  async read(q: MemoryQuery, _ctx: RunContext): Promise<MemoryHit[]> {
    let files: string[] = [];
    try { files = (await readdir(this.dir)).filter(f => f.endsWith(".md")); } catch { return []; }
    const needle = q.query.toLowerCase();
    const hits: MemoryHit[] = [];
    for (const f of files) {
      const raw = await readFile(join(this.dir, f), "utf8");
      if (raw.toLowerCase().includes(needle)) {
        const [first, ...rest] = raw.split("\n\n");
        hits.push({ title: (first ?? "").replace(/^#\s*/, ""), body: rest.join("\n\n").trim() });
      }
    }
    return hits.slice(0, q.k ?? 5);
  }
}
