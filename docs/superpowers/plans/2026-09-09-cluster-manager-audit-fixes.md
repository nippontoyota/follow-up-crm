# Cluster Manager Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fixed cluster-manager accounts accurate, branch-transparent, flag-inaccessible, accessible, and safe for a latency-critical CRM without mutating lead data.

**Architecture:** Keep the existing Express/Postgres and vanilla frontend architecture. Reuse the startup-resolved hardcoded branch scope, add small metadata to authenticated responses and analytics payloads, and make bounded queries explicit rather than introducing a broad refactor.

**Tech Stack:** Node.js, Express, PostgreSQL, browser JavaScript, CSS, existing smoke-test script.

## Global Constraints

- Cluster managers must not see or mutate flags.
- Cluster manager accounts remain fixed and cannot be created or edited through Admin.
- Branch scope remains hardcoded and enforced server-side; client branch overrides remain ignored.
- Do not mutate lead, follow-up, user, or branch data during implementation or verification.
- Preserve low-latency indexed branch filtering and bounded drilldowns.

---

### Task 1: Remove cluster-manager flag access

**Files:**
- Modify: `server.js:1133-1148, 1211-1243, 1303-1380`
- Modify: `public/app.js:247-255, 1311-1318, 1584-1616, 2288-2298`
- Modify: `scripts/cluster-manager-smoke.js`

- [ ] Remove `cluster_manager` from the close-flag authorization list and branch-specific close logic.
- [ ] Return analytics results without flag arrays for cluster managers and reject flag-only cluster requests with the existing authorization response.
- [ ] Remove the Flagged Leads tab and flag KPI from the cluster-manager UI.
- [ ] Keep Sales Manager/Admin flag behavior unchanged.
- [ ] Add smoke assertions for hidden tab and rejected flag access/mutation.

### Task 2: Expose branch scope and missing mappings

**Files:**
- Modify: `server.js:49-64, /api/me response area`
- Modify: `public/app.js:260-281, 1284-1322, 1427-1447`
- Modify: `public/style.css` near scope/header styles

- [ ] Return configured branch names, resolved branch names, and missing branch names for cluster managers.
- [ ] Render the exact assigned branches in the header and analytics cards.
- [ ] Render a visible Admin-only warning when a fixed cluster mapping contains a branch absent from the master table.
- [ ] Keep the server-side scope based on resolved IDs only.

### Task 3: Add branch context to cluster results

**Files:**
- Modify: `server.js:1211-1300, 1303-1410`
- Modify: `public/app.js:1298-1384, 1436-1515, 1584-1616`
- Modify: `public/style.css` table and mobile table styles

- [ ] Return branch-aware aggregate rows or branch labels for cluster views.
- [ ] Include Branch in flagged-independent lead drilldowns and officer result tables where multiple branches are possible.
- [ ] Preserve the current branch-specific Sales Manager/Admin behavior.
- [ ] Make the wide status table usable on narrow screens with a clear scroll affordance or prioritized mobile layout.

### Task 4: Make bounded results explicit

**Files:**
- Modify: `server.js:1317-1378`
- Modify: `public/app.js` lead drilldown renderers

- [ ] Preserve bounded query limits for latency.
- [ ] Return `limit` and `hasMore` metadata for capped cluster drilldowns.
- [ ] Show a clear message when a result is capped and offer the existing pagination pattern where the endpoint supports it.

### Task 5: Improve accessibility and interaction consistency

**Files:**
- Modify: `public/app.js:191-203, 2245-2345`
- Modify: `public/style.css` focus, modal, and responsive rules

- [ ] Add accessible labels to login inputs and the password visibility button.
- [ ] Add dialog semantics, focus entry, Escape-to-close, and focus restoration for lead sheets.
- [ ] Preserve visible focus indicators and touch-friendly controls.

### Task 6: Verify and deploy

**Files:**
- No data files modified.

- [ ] Run syntax checks and `git diff --check`.
- [ ] Run the cluster-manager smoke test without creating or mutating records.
- [ ] Inspect the live Biju account for exact scope, allowed tabs, no flag tab, and branch-aware output.
- [ ] Commit and push the verified code.
- [ ] Wait for deployment, then re-run the live checks.
