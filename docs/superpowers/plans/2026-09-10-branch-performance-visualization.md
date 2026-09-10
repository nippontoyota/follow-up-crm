# Branch performance visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-to-scan branch table with chunky visual branch cards while retaining exact figures and existing lead drill-downs.

**Architecture:** Keep `/api/call-center/source-quality` unchanged. In `public/app.js`, group the existing `branches` rows by branch, derive card summaries and source-mix segments, and render a visual card grid plus a collapsed exact-detail table. Use CSS bars and existing metric-link helpers instead of a chart library or new requests.

**Tech Stack:** Vanilla JavaScript, existing HTML helpers, CSS, PostgreSQL-backed existing API, Node smoke tests.

## Global Constraints

- Do not change the database, API, source-group definitions, or lead data.
- Do not add requests, polling, writes, chart dependencies, or new runtime state beyond the current report response.
- Preserve clickable metric drill-downs, loading/error/empty states, branch filtering, and role boundaries.
- Keep source-mix meaning available in text and accessible labels, not color alone.
- Keep exact figures in a collapsed detail view with narrow-screen scrolling.

---

### Task 1: Add branch-card grouping and rendering helpers

**Files:**
- Modify: `public/app.js` near the existing source-quality helpers

**Interfaces:**
- Consumes: source-quality `branches` rows with branch/source metrics.
- Produces: pure client-side branch grouping and `sourceQualityBranchCards(rows, branchId)` HTML.

- [ ] **Step 1: Group rows by branch**

Add a helper that returns one group per `branch_id`, preserving each group's source rows. It must only transform the already-loaded response and must not call the API or mutate row objects.

- [ ] **Step 2: Derive card summaries**

For each branch group, sum leads, connected, booked, retailed, lost, LOST RNR, and overdue. Calculate contact and won rates from the sums. Select the source row with the most overdue leads for the `Start with` action. Build source-mix percentages from each row's leads divided by the branch total.

- [ ] **Step 3: Render accessible card content**

Render branch name, total leads, overdue count, four large metrics, a proportional source-mix bar, a text legend, and the derived `Start with` action. Use `sourceQualityMetricLink()` for clickable branch metrics and existing drill-down query parameters.

### Task 2: Make cards the primary branch presentation

**Files:**
- Modify: `public/app.js` in `sourceQualityView()` near the current Branch breakdown section

**Interfaces:**
- Consumes: `sourceQualityBranchGroups()` and `sourceQualityBranchCards()`.
- Produces: the branch performance section with cards and an exact detail disclosure.

- [ ] **Step 1: Replace ambiguous section copy**

Change the heading to `Branch performance`. Use helper text explaining that each card compares volume, reach, sales, overdue work, and source mix for one branch.

- [ ] **Step 2: Insert the visual card grid**

Render the cards as the primary view. Preserve the existing no-data message when no branch rows are returned.

- [ ] **Step 3: Preserve exact details**

Put the current exact branch table inside native `<details>` labeled `Show detailed branch figures`. Keep its existing metrics and drill-down links unchanged.

### Task 3: Style and verify the visualization

**Files:**
- Modify: `public/style.css` in the source-quality styles
- Test: `scripts/demo-smoke.js` if a client-side assertion is useful

- [ ] **Step 1: Style the cards**

Add a two-column desktop grid, one-column narrow layout, large branch headers, four metric blocks, proportional mix bars, readable legends, focus states, and a visible `Start with` treatment. Ensure long branch names and zero values remain readable.

- [ ] **Step 2: Run checks**

Run `node --check` for `server.js`, `public/app.js`, `scripts/demo-db.js`, and `scripts/demo-smoke.js`; run `git diff --check`; reset and seed the isolated demo database; run the demo smoke test with the four demo cluster-manager password variables set to `demo123`.

- [ ] **Step 3: Run the UI detector**

Run `node C:\Users\krish\.agents\skills\impeccable\scripts\detect.mjs --json public/app.js public/style.css`, review findings, and fix actual issues before committing.

- [ ] **Step 4: Commit the implementation**

Run `git add public/app.js public/style.css scripts/demo-smoke.js` and commit with `feat: visualize branch source performance`.
