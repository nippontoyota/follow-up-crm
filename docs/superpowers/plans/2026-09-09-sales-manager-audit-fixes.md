# Sales Manager audit fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Sales Manager/CAC metrics and flag permissions, make status drilldowns complete and scalable, and preserve all lead data.

**Architecture:** Keep the current branch analytics API and vanilla client, but make role-specific response shaping explicit. Reuse the existing pagination helper for status drilldowns, use deterministic latest-follow-up ordering everywhere, and add read-only PostgreSQL indexes for the query paths.

**Tech Stack:** Node.js, Express, PostgreSQL, vanilla JavaScript.

## Global Constraints

- Do not insert, update, delete, reassign, or backfill lead, follow-up, flag, or user rows.
- Sales Manager data is always restricted to the authenticated manager's branch.
- Untouched remains a Call Center workload metric; Sales Manager status reporting uses `Fresh` for leads with no follow-up.
- Flagged leads are reviewable by the correct branch Sales Manager and Admin; Call Center Managers receive no flag metadata.
- Status drilldowns must expose every matching lead through server pagination.

---

### Task 1: Correct role-specific metrics and flag scope

**Files:**
- Modify: `server.js:535-560, 1090-1198`
- Modify: `public/app.js:1290-1310, 1540-1568, 2240-2255`
- Modify: `db.js` index declarations

- [x] Remove Sales Manager Untouched fields/UI while retaining CAC Untouched metrics.
- [x] Redact flag fields from CAC Manager generic lead list/detail responses.
- [x] Make Admin's global flag query include all flagged leads, with explicit unassigned-manager copy.
- [x] Add supporting indexes without changing row data.

### Task 2: Align outcome semantics and latest ordering

**Files:**
- Modify: `public/app.js:2348-2349`
- Modify: `server.js` latest-follow-up queries

- [x] Keep `Already Booked` visually aligned with its current open/date-required behavior.
- [x] Add `id DESC` to every latest-follow-up ordering path.

### Task 3: Paginate status drilldowns

**Files:**
- Modify: `server.js:1306-1340`
- Modify: `public/app.js:1510-1540`

- [x] Return `{ leads, total, page, limit, pages }` from the status drilldown endpoint.
- [x] Render page controls inside the drilldown sheet and keep the branch/officer/status filter on every page request.
- [x] Preserve lead-row click-through and show the full result total.

### Task 4: Verify and deploy

**Files:**
- Verify: `server.js`, `public/app.js`, `db.js`, `public/index.html`

- [x] Run syntax, diff, and static assertions.
- [x] Run role-scoped read-only API tests and before/after row-count checks.
- [x] Push, verify the live asset version, and smoke-test Sales Manager and CAC-visible behavior.
