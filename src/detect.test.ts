import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { detect } from "./detect.ts";
import type { SessionTrace } from "./types.ts";

const sessions: SessionTrace[] = JSON.parse(
  readFileSync(new URL("../traces/sample-sessions.json", import.meta.url), "utf8"),
);

function session(id: string): SessionTrace {
  const s = sessions.find((s) => s.session_id === id);
  assert.ok(s, `fixture ${id} missing`);
  return s;
}

function rulesFor(id: string): string[] {
  return detect(session(id)).map((i) => i.matched_rule);
}

test("dead-cta fires on the rage-clicked dead Pay button (ph-sess-004)", () => {
  assert.ok(rulesFor("ph-sess-004").includes("dead-cta"));
});

test("a dead button is not double-flagged as a hidden validation block", () => {
  // ph-sess-004's clicks never reached the network, so submit-retry
  // (submits that DO reach the server, no success) must stay silent.
  assert.ok(!rulesFor("ph-sess-004").includes("submit-retry"));
});

test("error-on-money-step fires on the card_entry exception (ph-sess-005)", () => {
  assert.ok(rulesFor("ph-sess-005").includes("error-on-money-step"));
});

test("funnel-drop fires when Pay was clicked but never succeeded (ph-sess-006)", () => {
  assert.deepEqual(rulesFor("ph-sess-006"), ["funnel-drop"]);
});

test("submit-retry fires on repeated submits with no success (ph-sess-007)", () => {
  assert.ok(rulesFor("ph-sess-007").includes("submit-retry"));
});

test("clean and chose-to-leave sessions are not flagged", () => {
  // 001/002 succeeded (002 despite a benign invoice_view exception);
  // 003 browsed and left without clicking Pay.
  for (const id of ["ph-sess-001", "ph-sess-002", "ph-sess-003"]) {
    assert.deepEqual(detect(session(id)), [], `${id} should not be flagged`);
  }
});
