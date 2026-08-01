# Design decisions

This file records the reasoning behind the shape of the runtime. Each entry is: the
context, what was chosen, what was rejected, and why.

The bar for every decision was the same: the runtime has to be safe to run unattended
across models it wasn't written for. That constraint drove most of what follows.

---

## 1. The brain is behind an interface, not baked into the loop

**Context.** Most "personal agent" runtimes are a thin loop around one vendor's SDK. The
provider's message shape, tool-call format, and error semantics leak into the core.

**Chosen.** A `Brain` contract that streams `text` / `tool_call` / `usage` and declares its
own `contextLimitTokens`. The loop never sees a provider. Three real implementations —
`AnthropicBrain`, `OllamaBrain`, `GeminiBrain` — plus a `FakeBrain` for deterministic tests.

**Rejected.** Coding directly against one SDK and "abstracting later." Later never comes;
by then the provider's assumptions are load-bearing in a hundred places.

**Why.** Model-agnosticism is only real if it's a contract from commit one. Proven, not
claimed: the same `run()` loop drove three genuinely different tool-calling wire formats
(Anthropic `tool_use`, OpenAI-style `tool_calls`, Google `functionCall`) with no change to
the loop, the gate, or the tools.

---

## 2. Cost is a routing problem, not `N × frontier-model`

**Context.** Running everything through a frontier model is the obvious path and the
expensive one. A single always-on job can burn tens of millions of tokens a month.

**Chosen.** Brain-per-role. A cheap/local model (Ollama/Qwen) handles the leaf work; the
expensive frontier model is lit up only when judgment is required. The brain is swappable
per agent in one line of YAML.

**Rejected.** One model for everything, tuned by prompt. Simpler to ship, but the variable
cost is structural and can't be prompted away.

**Why.** If the brain is behind an interface (decision 1), routing by role is nearly free
to implement and it's the difference between a runtime you can afford to run 24/7 and one
you can't.

---

## 3. Held-by-default gate — ambiguity resolves to deny

**Context.** An agent that can call tools unattended is a security surface. The failure
mode isn't "wrong answer," it's "did something it shouldn't have, on your machine."

**Chosen.** Every tool call passes a gate that returns `allow | deny | escalate`. Nothing
runs unless explicitly allowed. Anything unlisted, any escalation with no handler, any
escalation that times out, any unknown tool at exec time — all resolve to **deny**. Defense
in depth: the gate denies, *and* the executor independently refuses a name it can't resolve.

**Rejected.** Allow-by-default with a blocklist. A blocklist can only stop what you thought
of in advance; the whole point is the things you didn't.

**Why.** This is the actual differentiator — not TDD, not strict types. A security membrane
designed in from commit one, not bolted on after an incident.

---

## 4. Denials are fed back to the model, not thrown as exceptions

**Context.** When the gate denies a call, the run could crash, or it could tell the model.

**Chosen.** A denied call returns an error *result* to the model, so it can self-correct and
try a permitted path, instead of blowing up the run.

**Rejected.** Throwing on denial. It's less code, but it turns a recoverable situation into
a dead run and teaches the model nothing.

**Why.** Fail-closed shouldn't mean fail-brittle. The safe choice and the robust choice can
be the same choice.

---

## 5. Escalation is blocking, per turn

**Context.** Some calls are too risky to auto-allow but shouldn't be a hard deny either —
they need a supervisor or a human to approve.

**Chosen.** On `escalate`, the loop waits for the decision (with a timeout) before returning
to the brain. No parallel work mid-escalation. Timeout or no handler → deny.

**Rejected.** Non-blocking escalation with the run continuing optimistically. It races: the
model acts on an assumption that may be denied a beat later.

**Why.** This is the seam where a human approver plugs in. Blocking is the only version that
is actually safe, and it's the honest default for "ask before you act."

---

## 6. Memory: read is a pull, write is a push

**Context.** An agent needs durable memory, but "let the model write whatever it wants,
whenever" is both a cost and a safety problem.

**Chosen.** `read` is model-driven — the model pulls context by calling memory as an explicit
tool, deciding what's relevant. `write` is policy-driven — the runtime pushes durable writes
via hooks (`onRunEnd`), not at the model's discretion.

**Rejected.** Symmetric read/write both controlled by the model. Cleaner on paper, but it
hands the model control over what persists, which is exactly what you don't want persisted.

**Why.** Split the asymmetry along the trust line: the model is good at deciding what it
needs *now*; policy should decide what survives the run.

---

## 7. Errors collapse into three families with a tunable retry policy

**Context.** LLM runtimes fail in many ways — rate limits, malformed output, context
overflow, auth, tool errors. Handling each ad hoc turns the loop into a swamp.

**Chosen.** Errors collapse into three families — `brain` / `tool` / `gate` — each with
subtypes. A `RetryPolicy` maps `(family, subtype) → {retry, backoff, maxAttempts}`, with
code defaults overridable per agent via YAML. `context_overflow` triggers the compactor
instead of a blind retry; `auth` fails fast; `invalid_output` is returned to the model to fix.

**Rejected.** Retry-everything-N-times. It papers over auth failures (which will never
succeed) and blind-retries context overflow (which will never fit).

**Why.** The right response to an error depends on *why* it happened. A taxonomy makes that
routable instead of guessed.

---

## 8. Remote control dials out — no inbound ports

**Context.** To drive an agent on a machine you don't have a shell on, the naive design opens
a port. Behind NAT/firewall that means asking IT to open it — a non-starter in most real orgs.

**Chosen.** The remote machine dials *out* only (`GET /poll`, `POST .../result`) to a tiny
Cloudflare Worker + D1 mailbox. No listening socket. Atomic claim (`UPDATE … WHERE
status='pending'`) so a lost ACK never double-executes a job. Bearer-token auth both ways.
The gate stays in charge on the remote side; secrets stay in the user's environment and never
travel over the relay.

**Rejected.** An inbound control port, or a heavyweight message broker. One is a security and
deployment problem; the other is infrastructure the design doesn't need.

**Why.** Outbound-only is what makes this deployable on a real user's machine without a
security review. Proven live: relay on Cloudflare, daemon on a real Windows PC that survived
a reboot and re-registered on its own, no admin rights.

---

## 9. Provider wire-state rides an opaque bag, not the neutral contract

**Context.** A provider sometimes needs state echoed back on the *next* turn that has no
place in a neutral tool-call. In August 2026 Google's newer Gemini models started attaching
a `thoughtSignature` to each `functionCall` part and rejecting (`400`) the follow-up turn if
it wasn't echoed back verbatim. The shared `ToolCall` type was deliberately minimal —
`{ id, name, input }` — with nowhere to carry a Google-specific token, and that state has to
survive across turns via the message history.

**Chosen.** An opaque, provider-local `providerMeta?: Record<string, unknown>` on `ToolCall`.
The Gemini brain stashes the signature there when it reads a `functionCall`, and replays it
when it rebuilds the turn. The loop, gate, and tools never read the bag — it rides the
history untouched.

**Rejected.** Adding a `thoughtSignature` field straight onto `ToolCall`. It's two fewer
lines, but it bakes one vendor's vocabulary into the contract that the entire design exists
to keep provider-free — the leak decision 1 is built to prevent.

**Why.** This is decision 1 tested under maintenance pressure, not just at first build. When
the wire format changed underneath the runtime, the fix was one optional field on the neutral
type plus two call sites inside the Gemini brain — the loop, the gate, and the tools did not
move. A contract is only "model-agnostic" if it survives the providers changing their minds;
this is the seam that lets it.
