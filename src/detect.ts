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

const rules: Rule[] = [deadCta];

// Run every P1 rule over a session. A session can trip several rules —
// co-occurring signals raise confidence, so we report all of them.
export function detect(session: SessionTrace): FlaggedIssue[] {
  return rules.map((rule) => rule(session)).filter((issue) => issue !== null);
}
