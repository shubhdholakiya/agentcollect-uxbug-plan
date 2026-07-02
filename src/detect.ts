import type { FlaggedIssue, SessionTrace } from "./types.ts";

// A rule inspects one session and flags at most one issue.
export type Rule = (session: SessionTrace) => FlaggedIssue | null;

const rules: Rule[] = [];

// Run every P1 rule over a session. A session can trip several rules —
// co-occurring signals raise confidence, so we report all of them.
export function detect(session: SessionTrace): FlaggedIssue[] {
  return rules.map((rule) => rule(session)).filter((issue) => issue !== null);
}
