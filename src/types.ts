// Input: a sessionized PostHog trace (PLAN.md Stage 0 output) scoped to one flow.

export interface SessionEvent {
  name: string; // "$pageview" | "pay_clicked" | "$exception" | "payment_succeeded" | ...
  ts: string;
  step?: string; // flow_step: "invoice_view" | "card_entry" | "payment_result"
  is_rageclick?: boolean;
  had_network_request?: boolean; // did the click produce a network request?
  exception?: { type: string; message: string };
}

export interface SessionTrace {
  session_id: string;
  flow: string;
  device: string;
  events: SessionEvent[];
}

// Output: a candidate for human triage (P1 keeps a human in the loop, no LLM).

export type Severity = "high" | "medium";

export interface FlaggedIssue {
  session_id: string;
  flow: string;
  failure_mode: string; // e.g. "dead pay button"
  matched_rule: string; // e.g. "dead-cta" — every alert traces to a deterministic rule
  severity: Severity;
  reason: string; // one line of evidence, human-readable
}
