import type { FlaggedIssue, SessionTrace } from "./types.ts";

// A rule inspects one session and flags at most one issue.
export type Rule = (session: SessionTrace) => FlaggedIssue | null;

// Rage-clicked Pay and no click ever produced a network request: the
// button is dead. This is the plan's canonical "system failed the user"
// tell — a debtor hammering a CTA that does nothing.
function deadCta(session: SessionTrace): FlaggedIssue | null {
  const payClicks = session.events.filter((e) => e.name === "pay_clicked");
  const raged = payClicks.some((e) => e.is_rageclick);
  const anyNetwork = payClicks.some((e) => e.had_network_request);
  if (payClicks.length === 0 || !raged || anyNetwork) return null;
  return {
    session_id: session.session_id,
    flow: session.flow,
    failure_mode: "dead pay button",
    matched_rule: "dead-cta",
    severity: "high",
    reason: `${payClicks.length} Pay clicks incl. rage-clicks, none produced a network request`,
  };
}

// Steps where an exception is a money-path event, not a cosmetic one.
// invoice_view is deliberately excluded: third-party script noise there
// (analytics, widgets) would flood triage with non-bugs.
const MONEY_STEPS = new Set(["card_entry", "payment_result"]);

// A JS exception on a money step. Errors here separate "system failed
// the user" from "user chose to leave" (PLAN.md §1).
function errorOnMoneyStep(session: SessionTrace): FlaggedIssue | null {
  const err = session.events.find(
    (e) => e.name === "$exception" && e.step !== undefined && MONEY_STEPS.has(e.step),
  );
  if (!err) return null;
  const detail = err.exception ? `${err.exception.type}: ${err.exception.message}` : "no detail";
  return {
    session_id: session.session_id,
    flow: session.flow,
    failure_mode: "js error on money step",
    matched_rule: "error-on-money-step",
    severity: "high",
    reason: `$exception on step "${err.step}" (${detail})`,
  };
}

// Clicked Pay but the session ended without payment_succeeded. Requiring
// the click (not just reaching the page) is what keeps chose-to-leave
// sessions out: a debtor who browsed and left is not a bug candidate.
function funnelDrop(session: SessionTrace): FlaggedIssue | null {
  const clickedPay = session.events.some((e) => e.name === "pay_clicked");
  const succeeded = session.events.some((e) => e.name === "payment_succeeded");
  if (!clickedPay || succeeded) return null;
  return {
    session_id: session.session_id,
    flow: session.flow,
    failure_mode: "payment attempt never succeeded",
    matched_rule: "funnel-drop",
    severity: "medium",
    reason: "clicked Pay but session ended without payment_succeeded",
  };
}

// Two or more Pay attempts and still no success — the "hidden validation
// block" tell: submits appear to work but nothing ever lands.
function submitRetry(session: SessionTrace): FlaggedIssue | null {
  const attempts = session.events.filter((e) => e.name === "pay_clicked");
  const succeeded = session.events.some((e) => e.name === "payment_succeeded");
  if (attempts.length < 2 || succeeded) return null;
  return {
    session_id: session.session_id,
    flow: session.flow,
    failure_mode: "repeated submit without success",
    matched_rule: "submit-retry",
    severity: "medium",
    reason: `${attempts.length} Pay attempts, none reached payment_succeeded`,
  };
}

const rules: Rule[] = [deadCta, errorOnMoneyStep, funnelDrop, submitRetry];

// Run every P1 rule over a session. A session can trip several rules —
// co-occurring signals raise confidence, so we report all of them.
export function detect(session: SessionTrace): FlaggedIssue[] {
  return rules.map((rule) => rule(session)).filter((issue) => issue !== null);
}
