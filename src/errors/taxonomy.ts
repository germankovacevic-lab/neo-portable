import type { RuntimeError } from "../types.js";
export type Family = RuntimeError["family"];
export const isBrain = (e: RuntimeError): e is Extract<RuntimeError, { family: "brain" }> => e.family === "brain";
export const errKey = (e: RuntimeError): string => `${e.family}.${e.subtype}`;
