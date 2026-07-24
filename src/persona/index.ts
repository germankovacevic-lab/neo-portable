import { readFile } from "node:fs/promises";

export interface Persona { systemPrompt(): Promise<string>; }

export class FilePersona implements Persona {
  constructor(private path: string) {}
  async systemPrompt(): Promise<string> { return (await readFile(this.path, "utf8")).trim(); }
}
