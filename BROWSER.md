# Why a browser agent needs this

> A browser agent is brain and eyes. What it's missing is hands — and hands you can trust.

Today's best browser assistants can read the page you're on and reason about it. They see and
they think. What they can't safely do is *act* — send the message, book the slot, run the task
while you're away — because acting unattended on a user's machine is exactly where the risk lives.

NEO Portable is that missing layer: **hands on a leash.**

- **The gate is the leash.** Every action the agent takes passes a held-by-default gate.
  Nothing runs unless it's explicitly allowed; ambiguity resolves to deny. This is the honest
  answer to "how do I let an agent touch the user's tabs, accounts, and files without it being
  a liability?" — the permission model is the product, not an afterthought.

- **It runs on the user's machine, not a vendor's cloud.** Outbound-only, behind NAT, no
  inbound ports, survives a reboot with no admin rights. The user's data and secrets stay with
  the user. For a consumer browser, data sovereignty isn't a feature — it's the trust contract.

- **It's model-agnostic by contract.** The same loop drives local and frontier models across
  three different tool-calling formats. A browser vendor isn't locked to one provider's roadmap,
  pricing, or outage.

- **Every action is observable.** The runtime emits a structured event for each step —
  `run_start → brain_call → gate_decision → tool_execute → run_end` — so what the agent did,
  and why each action was allowed or denied, is auditable rather than a black box.

The bet is simple: the hard part of a browser agent isn't making it smart. It's making it safe
to let go of the wheel. This runtime is built around that from commit one.
