#!/usr/bin/env bash
# Smoke test for POST /api/decide with a fixture page model from the Ledgerly site.
# Usage: scripts/decide-smoke.sh [base_url] [mode]
BASE="${1:-http://localhost:8787}"
MODE="${2:-guide}"
read -r -d '' PAGE << 'PM'
URL /ledgerly/setup?step=1   TITLE Pathfinder
[1] h1 "Tell us about your organization"
SECTION "Tell us about your organization"
[2] label "Organization name" visible in-viewport
[3] input(text) "Organization name" value="" visible in-viewport
[4] label "Industry" visible in-viewport
[5] select "Industry" selected="Choose one" visible in-viewport
[6] input(radio) "Just me" checked=false visible in-viewport
[7] input(radio) "2 to 10" checked=false visible in-viewport
[8] button "Continue" disabled visible in-viewport
CONTENT: Step 1 of 5 Tell us about your organization This names your workspace and tunes the defaults on the next steps.
CHANGES SINCE LAST STEP: none
PM
PAYLOAD=$(node -e '
const page = process.argv[1];
console.log(JSON.stringify({
  siteId: "ledgerly", mode: process.argv[2], goal: "help me set up my workspace",
  transcript: [{ role: "user", text: "help me set up my workspace" }],
  recentActions: [], pageModel: page
}));' "$PAGE" "$MODE")
curl -s -w '\nHTTP %{http_code} in %{time_total}s\n' -X POST "$BASE/api/decide" -H 'content-type: application/json' -d "$PAYLOAD"
