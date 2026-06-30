# Auto-detecting AgentCollect UX bugs from PostHog session replays

**Owner:** dholakiyashubh@gmail.com · **Status:** Planning · **Updated:** 2026-06-30

Detect revenue-losing UX bugs in the debtor/client portals from behavior — before anyone reports them.

---

## 1. Framing — why this is AgentCollect-specific

In normal SaaS, you hear about a UX bug because an engaged user files a ticket. **In collections it's the reverse:** a debtor who hits a broken "Pay Now" doesn't complain — they leave, relieved. The bug is self-concealing, and the people most likely to be blocked are the least likely to report. So the usual signal (inbound reports) is missing exactly where it costs the most. **Every silent failure in pay/negotiate/dispute is recovered revenue that never lands.** We have to manufacture the signal from behavior.

Generic rageclick dashboards don't fit because our economics differ:
- **Asymmetric stakes.** A broken settings toggle is cosmetic; a broken Stripe confirm or a plan slider that submits the wrong amount is lost recovery *and* a compliance event. Detection must be **flow-weighted by dollars**, not frequency.
- **Fragile, motivated-to-quit users.** Debtors are stressed, mobile, one-shot. We must separate *bug-driven* abandonment (an error fired, the button was dead) from *chose-to-leave* (no error). Generic drop-off alerts conflate these → false-positive flood.
- **Two portals, opposite incentives.** Debtor portal = high-volume, low-trust, mobile, one-shot. Client portal = low-volume, high-value B2B who *will* report bugs but whose stalls block onboarding revenue. Baselines and priorities must be portal-aware.

**Win condition:** a money-path bug is flagged within hours of deploy, with flow, failure mode, affected-session count, replay link, and a $-impact estimate — at precision high enough that eng doesn't mute it.

**Non-goals (v1):** not general analytics, not real-time (1–6h is fine), not auto-fix, not an APM replacement (we consume Sentry/`$exception`, not replace it).

---

## 2. Flows & failure modes (ranked by $-at-risk)

**Tier 0 — money path (debtor).**
- **One-time Stripe payment:** Element fails to mount (blank iframe); Pay button dead after first click; 3DS modal closes to blank; success page never renders post-`succeeded`; displayed amount ≠ charged; Apple/Google Pay sheet won't open on iOS Safari.
- **Payment-plan negotiation:** slider submits out-of-range value; plan math doesn't reconcile to balance; "Agree" disabled with no visible reason (off-screen validation); date picker silently resets; AI agent proposes a plan the UI can't render.
- **AI-agent chat → CTA handoff:** CTA is a 404/expired tokenized link; agent says "click below" but no button renders; SMS/email deep-link lands on a login wall; token expired → silent redirect loop.

**Tier 1 — trust & access.** Magic-link/OTP entry (expired token shown as "invalid"; autofill OTP rejected; back-button loop); dispute submission (silent upload failure on large/HEIC; no receipt); client SSO callback errors.

**Tier 2 — client ops (stalls onboarding).** Bulk CSV import (mapping rejects valid file; per-row errors hidden; commit spinner hangs); reporting export (dead button; empty file); settings save no-ops.

**Cross-cutting:** dead primary CTA, off-screen validation errors, mobile keyboard/viewport breakage, spinner-never-resolves, auth/validation loops that look like browsing.

---

## 3. PostHog signals

Correlated **per session, scoped to a flow step** (via a `flow_step` property we instrument).

- **Behavioral:** `$rageclick` (dead-CTA tell), **dead clicks** (click → no DOM/nav/network → best dead-button signal), nav U-turns, form-abandon/submit-retry.
- **Errors:** `$exception` (Error Tracking, with fingerprint), console errors (corroborator), **network 4xx/5xx** on Stripe-confirm / plan-create / token-verify (the key signal separating "system failed user" from "user left").
- **Funnel:** *step-level* drop-off (localizes the broken step), step-latency regression, **deploy-SHA-segmented** drop-off (auto-bisects to a release).
- **We must instrument:** `flow_step{flow,step,portal}`; money-path success/fail events with reasons; `amount_bucket` (never raw $) and salted-hash ids; deploy SHA + device on every event.

**Heuristic backbone (signal → failure):** rageclick on `[data-cta=pay]` + no network → dead pay button; `$exception` on `card_entry` → Stripe crash; step drop-off spike since SHA X → regression in X; ≥2 submit attempts + no `*_succeeded` → hidden validation block. Confidence rises when behavior **and** error co-occur.

---

## 4. Detection: cheap heuristics → LLM triage

Principle: **the LLM is the last mile, not the funnel.** Deterministic rules drop ~99% of sessions; the model only ever sees a pre-flagged candidate and confirms/classifies/explains.

```
PostHog ──(cron poll 1–6h; webhook on Tier-0 $exception)──▶
Stage 0  Sessionize: group events, attach flow_step/SHA/device; Tier-0/1 only
Stage 1  Cheap heuristics
         · session rules: rageclick∧no-network, $exception-on-money-step,
           submit-retry, dead-click-on-CTA, auth loop
         · cohort anomaly: step drop-off vs 7/28d baseline (EWMA + z-score),
           segmented by portal×device×SHA, min-sample gate for low-N client flows
Stage 2  Dedupe (no LLM): fingerprint = hash(flow, step, signal,
         exception_fp?, selector?, SHA?) → cluster sessions, suppress open/snoozed
Stage 3  LLM triage (gated): structured, redacted event timeline of 1–3 exemplars
         (NOT raw replay, NOT PII) → real-bug vs benign? failure mode + component?
         severity = f(tier, $-at-risk, count)? human summary + repro hint.
         Haiku for volume, escalate to Sonnet for Tier-0/ambiguous. JSON schema.
Stage 4  Adversarial verify (Tier-0 / hi-sev): 2nd model tries to REFUTE; ship if it can't
Stage 5  Alert: $-impact (Σ amount_bucket), Slack + PagerDuty(Tier-0),
         Linear/GitHub issue keyed by fingerprint, replay deep-links
```

**Why:** LLM cost scales with *incidents* (~tens/day), not *sessions* (~tens of thousands/day). Heuristics give recall; the LLM kills false positives ("user just left"). Every alert traces to a deterministic signature *and* a model rationale.

**Dedupe is make-or-break for trust.** One incident per fingerprint per window; new sessions append count/$ instead of re-alerting. State store (Postgres) tracks `open/ack/snoozed/resolved`; same signature on a new SHA after "resolved" → high-signal **"regression reintroduced."**

**Stack (Vercel-native default):** Cron → Function (Node 24, Fluid) polling PostHog + a webhook for Tier-0 `$exception`; Neon Postgres for incidents/fingerprints/baselines; AI Gateway → `anthropic/claude-haiku-4-5` then `claude-sonnet-4-6`, ZDR on; Slack/PagerDuty/Linear out.

---

## 5. PII / compliance guardrails

Collections is regulated (FDCPA, state law; GLBA-adjacent financial data; card data = PCI scope). Replays can capture balances, last-4, SSNs, dispute narratives. **Design these in from day one.**

- **Capture-time:** mask all inputs/text by default in PostHog replay; explicit block-list for card/amount/DOB/SSN/last-4/dispute-text/name/address. Keep Stripe Elements iframed/out-of-scope. Amounts → buckets; ids → salted hashes. **No raw PII as event properties.**
- **Pipeline-time:** the LLM never sees raw replay or PII — only a structured, **pre-redacted** timeline (step names, signal flags, masked selectors, scrubbed exception fingerprints, bucketed amounts). A regex+NER scrub runs before any model call and **fails closed** if residual PII is detected. ZDR on the model path. The $-reconciliation (account→balance) happens server-side against our own DB, never near PostHog or the prompt.
- **Storage/access:** keep only fingerprints, counts, exemplar ids, $-buckets; triage timelines are ephemeral (TTL). Replay links point back to access-controlled PostHog, RBAC-gated, access logged. Honor debtor opt-out/consent at capture; confirm PostHog region matches residency obligations.
- **Kill switch:** disable replay per-flow via flag, no deploy.

---

## 6. Phased MVP

- **P0 (wk 1–2) Instrument & mask.** Add `flow_step`, money-path events, SHA tagging, buckets, hashed ids; enable Error Tracking + network capture on Tier-0; **manually audit 20 replays for zero PII.** Exit: clean masked data on one-time-payment.
- **P1 (wk 3–4) Heuristics + manual triage, one flow (debtor one-time pay).** Stages 0–2 only; daily Slack digest, **human labels** each candidate. Exit: ≥1 real bug caught that wasn't reported + a ~100–200 labeled set to calibrate.
- **P2 (wk 5–7) LLM triage + dedupe + alerting.** Stage 3 calibrated against P1 labels (target Tier-0 precision ≥0.8); fingerprint dedupe + state store; Slack/PagerDuty/Linear; $-impact. Exit: end-to-end auto-alert, measured precision/recall, no dup complaints.
- **P3 (wk 8–10) Widen.** Add plan negotiation, agent CTA, dispute, magic-link; SHA regression bisection + "reintroduced" alerts; Stage 4 verify for Tier-0. Exit: all Tier-0/1 covered, FP rate eng-acceptable.
- **P4 (wk 11+) Client portal + ROI.** Low-N anomaly detection for import/export/SSO; weekly "$-at-risk caught" report; **backtest historical data** to estimate revenue it would've saved.

Throughout: start narrow, prove precision before widening, human-in-loop per flow until precision holds, PII audit gates each go-live.

---

## 7. Questions I'd ask the team before writing code

Blocking — these change the design or whether it's worth building:

1. **PostHog reality check.** Which plan/region, and does it include Error Tracking + network capture at our replay volume? Self-hosted or cloud — and does that satisfy debtor-data residency? *(If Error Tracking/network capture aren't on, Stage 1 loses its best corroborators and the whole precision story changes.)*
2. **Is deploy SHA on events today?** If not, who adds it in CI before P0? *(No SHA = no regression bisection, the cheapest high-value feature.)*
3. **Can we tag `flow_step` cleanly?** Does the front end's routing/component structure let us scope events to steps without a big refactor — or is that secretly the hardest part of the project?
4. **Where's the authoritative balance, and can the backend join session→account for $-impact** without putting PII near PostHog or the LLM? *(If not, alerts lose their dollar number — the thing that makes eng act.)*
5. **Is "abandoned after a bug" actually lost revenue,** or do debtors retry later / via SMS / phone? Whoever owns recovery numbers needs to confirm, or the ROI story is fiction.
6. **Legal: is behavioral/session capture of debtors disclosed and lawfully based,** any state-collection-law limits on recording, and any opt-out we must honor at capture? Who signs off on the fail-closed redaction design per flow?
7. **What alert volume/precision will eng actually tolerate,** and who owns the triage rotation + snooze workflow? *(Sets thresholds and how long we keep humans in the loop.)*
8. **Latency:** is 1–6h batch fine, or does Tier-0 need real-time `$exception` webhooks from day one?
9. **Ground truth for evaluation:** do we have a list of past UX incidents to backtest against, given bugs are under-reported? Without it, "precision ≥0.8" is unmeasurable.
10. **Build vs buy:** do PostHog's own anomaly/error features (or a replay-AI vendor) cover enough of Stages 1–3 that we only build the AgentCollect-specific flow-weighting + $-impact layer on top?

---

**In one line:** manufacture the bug report debtors will never send — deterministic heuristics over PostHog behavior+error+funnel surface money-path candidates, an LLM confirms and prices them in lost recovery, dedupe keeps it trustworthy, fail-closed redaction keeps it compliant — shipped one flow at a time, precision first.
