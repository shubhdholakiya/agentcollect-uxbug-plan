import { readFileSync } from "node:fs";
import { detect } from "./detect.ts";
import type { FlaggedIssue, SessionTrace } from "./types.ts";

const tracesPath =
  process.argv[2] ?? new URL("../traces/sample-sessions.json", import.meta.url).pathname;
const sessions: SessionTrace[] = JSON.parse(readFileSync(tracesPath, "utf8"));

const flagged: { session: SessionTrace; issues: FlaggedIssue[] }[] = [];
const clean: string[] = [];

for (const session of sessions) {
  const issues = detect(session);
  if (issues.length > 0) flagged.push({ session, issues });
  else clean.push(session.session_id);
}

console.log("UX-bug candidates — debtor one-time payment (P1 heuristics)");
console.log(`scanned ${sessions.length} sessions · flagged ${flagged.length}\n`);

for (const { session, issues } of flagged) {
  console.log(`${session.session_id}  (${session.device})`);
  for (const issue of issues) {
    const sev = issue.severity.toUpperCase().padEnd(6);
    console.log(`  ${sev} ${issue.matched_rule}: ${issue.failure_mode} — ${issue.reason}`);
  }
  console.log();
}

console.log(`not flagged: ${clean.join(", ") || "(none)"}`);
