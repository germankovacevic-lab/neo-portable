import { expect, test } from "vitest";
import { FilePersona } from "../src/persona/index.js";

test("loads file content into the system prompt", async () => {
  const p = new FilePersona(new URL("./fixtures/persona.md", import.meta.url).pathname);
  const sp = await p.systemPrompt();
  expect(sp).toContain("Acme Co's copilot");
});
