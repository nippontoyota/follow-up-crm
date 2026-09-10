# Cluster Login and Flag History Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Repair Render Cluster Manager authentication and expose active plus resolved flag history Sales Officer-wise without changing existing lead data.

**Architecture:** Keep the four passwords in Render environment variables. Reuse the existing flag result query, derive status/grouped totals in the API process, and render the history in the existing Sales Manager/Admin flag surfaces and lead detail sheet.

**Tech Stack:** Node.js, Express, PostgreSQL, vanilla JavaScript, Render CLI/API.

## Global Constraints

- Do not modify existing lead, follow-up, assignment, or flag rows.
- Preserve branch scope and role redaction.
- Do not add a second analytics flag query.
- Do not commit passwords.

### Task 1: Extend server flag history safely

**Files:** `server.js`

- [ ] Change manager/admin flag predicates to include `l.is_flagged = 1 OR l.flag_remarks IS NOT NULL`.
- [ ] Add `flag_status` to returned flag rows and derive `flaggedByOfficer` from the same rows.
- [ ] Save an empty string, not `NULL`, for a blank new close remark.
- [ ] Keep Cluster Manager responses free of flag metadata.

### Task 2: Render Sales Officer-wise and historical flags

**Files:** `public/app.js`

- [ ] Add the grouped Sales Officer flag summary to the Sales Manager/Admin performance surface.
- [ ] Add Active/Closed status and remarks to the flag history list.
- [ ] Show resolved flag history in lead details while keeping close controls active-only.

### Task 3: Verify and deploy

**Files:** `server.js`, `public/app.js`

- [ ] Run `node --check` on both JavaScript files.
- [ ] Run static assertions and inspect the diff for forbidden data mutations.
- [ ] Commit, push, wait for Render’s live deploy, and smoke-test production logins and flag API scope.

