# Cluster manager audit fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining cluster-manager data-completeness, drilldown, refresh, search, responsive, theme, route-message, and password-source gaps without changing stored CRM data or touching audit item 4.

**Architecture:** Keep branch scope enforcement in `server.js` and keep fixed identity metadata in `cluster-managers.js`. Add only the Pala code mapping to source configuration; startup remains read-only. Make drilldowns page-based in SQL, add one bounded scoped search endpoint, and let the existing single-page client request those endpoints explicitly.

**Tech Stack:** Node.js 22, Express, PostgreSQL, vanilla JavaScript, CSS, existing Node smoke scripts.

## Global Constraints

- Do not insert, update, or delete production data during startup or this feature.
- Do not change leads, follow-ups, users, assignments, flags, or existing branch rows.
- Keep cluster-manager usernames, roles, and branch assignments fixed in source.
- Read fixed passwords from `CLUSTER_MANAGER_PASSWORD_BIJU`, `CLUSTER_MANAGER_PASSWORD_PRAVEEN`, `CLUSTER_MANAGER_PASSWORD_VINOD`, and `CLUSTER_MANAGER_PASSWORD_NIRMAL`.
- Keep every new result set bounded for the latency-critical application.
- Do not implement keyboard or focus changes from audit item 4.

---

### Task 1: Move fixed-account passwords behind environment variables

**Files:**
- Modify: `cluster-managers.js:1-30`
- Modify: `db.js:154-201`
- Modify: `.env.example`
- Modify: `scripts/cluster-manager-smoke.js:1-124`
- Test: local `.env` only, never commit its values

**Interfaces:**
- `CLUSTER_MANAGER_DEFINITIONS` exposes `passwordEnv` instead of plaintext passwords.
- `getClusterManagerPassword(manager)` returns the required environment value or throws an actionable error.

- [ ] **Step 1: Add a failing source assertion**

Assert that every definition has `passwordEnv` and no `password` property, and that the required variables are documented.

- [ ] **Step 2: Run the smoke test and confirm the missing-secret failure is explicit**

Run `npm run cluster:smoke` without the variables in a controlled child process. Expect a clear error naming the missing variable.

- [ ] **Step 3: Implement environment-backed password lookup**

Use the helper from both seeding and smoke login. Do not add a plaintext fallback in tracked files.

- [ ] **Step 4: Add local-only values to `.env` and placeholders to `.env.example`**

Keep `.env` ignored. Do not print secret values in test output.

- [ ] **Step 5: Run the smoke test with all four variables present**

Run `npm run cluster:smoke`. Expect all four fixed accounts to authenticate.

### Task 2: Add the canonical Pala branch-code mapping without database writes

**Files:**
- Modify: `demo-data/branch-codes.json`
- Modify: `scripts/cluster-manager-smoke.js:43-53`

**Interfaces:**
- `branch-codes.json` maps `KT01B` to `Nippon Toyota - Pala`.
- Startup scope loading remains read-only and continues to report missing Pala when the database row is absent.

- [ ] **Step 1: Add the mapping assertion**

Read the JSON in the smoke script and assert `KT01B` resolves to the exact Pala name.

- [ ] **Step 2: Add only the source mapping**

Do not add an `INSERT` to `db.js`, `server.js`, or a startup script.

- [ ] **Step 3: Run the protected snapshot smoke check**

Confirm the branch, lead, follow-up, and non-cluster-user signatures remain unchanged.

### Task 3: Add SQL-paginated Lead Analysis and officer aggregate drilldowns

**Files:**
- Modify: `server.js:1351-1437`
- Modify: `public/app.js:1516-1582`
- Modify: `scripts/cluster-manager-smoke.js:68-87`

**Interfaces:**
- `GET /api/sales-manager/lead-analysis/leads` accepts `page` and `limit`, capped at 100, and returns `{ leads, total, page, limit, pages }`.
- `GET /api/sales-manager/officer-leads` accepts `page` and `limit`, capped at 100, and returns the same pagination shape.

- [ ] **Step 1: Add endpoint assertions for page metadata and scope**

Call each endpoint as a cluster manager and assert `total`, `page`, `limit`, and `pages` exist. Assert branch IDs remain within the manager’s assigned IDs.

- [ ] **Step 2: Replace `LIMIT 201` plus array slicing with SQL count pagination**

Use a filtered CTE or `COUNT(*) OVER()` and `LIMIT/OFFSET`. Never load all matching leads into Node memory.

- [ ] **Step 3: Update the Lead Analysis sheet to render a pager**

Use the existing `renderPager` and `bindPager` helpers. Preserve the existing 100-row server cap and show the total result count.

- [ ] **Step 4: Update the officer aggregate sheet to render a pager**

Reuse the same pagination behavior as officer-status leads. Remove the misleading “first 200” message.

- [ ] **Step 5: Run the smoke test and syntax checks**

Run the smoke script and `node --check server.js`.

### Task 4: Add bounded branch-scoped lead search

**Files:**
- Modify: `server.js` near the sales-manager endpoints
- Modify: `public/app.js:252-310` and add a search view near the sales-manager views
- Modify: `public/style.css`
- Modify: `scripts/cluster-manager-smoke.js`

**Interfaces:**
- `GET /api/sales-manager/lead-search?q=<prefix>` is available to `cluster_manager`, `sales_manager`, and `admin`.
- The endpoint returns at most 50 rows with `id`, `customer_name`, `mobile`, `branch`, `sales_officer`, `stage`, and `next_date`.
- It never returns flag fields and always applies `managerBranchIds(req)` or the existing manager branch restriction.

- [ ] **Step 1: Add a failing cross-branch search assertion**

Search using a cluster manager and assert every returned branch is in that manager’s scope. Search using a term from outside the scope and assert no result leaks.

- [ ] **Step 2: Add the bounded prefix query**

Normalize the query, require at least two characters, search `customer_name ILIKE prefix` or `mobile LIKE prefix`, order by exactness and newest ID, and apply `LIMIT 50`.

- [ ] **Step 3: Add the cluster Search tab**

Use an explicit submit button. Do not request on every keystroke. Show branch, customer, mobile, officer, stage, and next date.

- [ ] **Step 4: Add retry on search failure**

Keep the last submitted query and re-run it when Retry is clicked.

- [ ] **Step 5: Verify flag fields are absent**

Assert the search JSON keys do not include `is_flagged` or `flag_remarks`.

### Task 5: Add refresh, last-updated state, and retry to analytics

**Files:**
- Modify: `public/app.js` sales-performance and lead-analysis view functions
- Modify: `public/style.css`

**Interfaces:**
- `salesPerformanceView()` and `leadAnalysisView()` render a manual Refresh button and an updated timestamp.
- On request failure, the view renders a Retry button that calls only the failed view.

- [ ] **Step 1: Add view state for the latest successful fetch time**

Store timestamps in memory only. Do not persist or write them to the database.

- [ ] **Step 2: Add the shared analytics toolbar markup**

Keep the toolbar compact and show “Updated just now” or a formatted local time.

- [ ] **Step 3: Wire Refresh without polling**

Disable the button during the request and call the current view function once.

- [ ] **Step 4: Replace bare error messages with Retry states**

Keep the server error text escaped and add a button that reruns the failed request.

- [ ] **Step 5: Verify repeated refresh does not duplicate handlers or data**

Inspect the rendered DOM and run the live browser checks after deployment.

### Task 6: Improve mobile analysis without changing item 4

**Files:**
- Modify: `public/app.js` status-analysis rendering
- Modify: `public/style.css:397-405` and mobile media rules

**Interfaces:**
- Desktop keeps the existing full status matrix.
- Mobile adds an explicit compact summary and preserves a bounded horizontal table for users who need all statuses.

- [ ] **Step 1: Add compact mobile summary markup**

Render branch, officer, total, and non-zero statuses in a readable stacked block before the full table.

- [ ] **Step 2: Add mobile CSS for the summary and table**

Keep the current scroll behavior but improve spacing, sticky context, and contrast.

- [ ] **Step 3: Verify at desktop and mobile widths**

Check that the desktop matrix remains unchanged and the mobile view does not overflow the page itself.

### Task 7: Remove misleading dark-mode metadata and clarify blocked routes

**Files:**
- Modify: `public/index.html:6-7`
- Modify: `public/app.js:307-309` and route handling
- Modify: `public/style.css`

**Interfaces:**
- The document declares only the light theme color that the app actually implements.
- A disallowed hash route shows a short explanation before navigating to the first allowed tab, or presents an in-app message after navigation.

- [ ] **Step 1: Add a route-message assertion**

Exercise a cluster manager navigation to `#flagged` and assert the UI includes the role explanation.

- [ ] **Step 2: Implement the clear route fallback**

Keep the existing role allowlist. Add the message without exposing the destination data.

- [ ] **Step 3: Remove the dark theme metadata**

Do not add a partial dark theme in this change.

### Task 8: Run the complete verification pass

**Files:**
- Test: `scripts/cluster-manager-smoke.js`
- Test: `server.js`, `public/app.js`
- Test: `git diff --check`

- [ ] **Step 1: Run syntax checks**

Run `node --check server.js` and `node --check public/app.js`.

- [ ] **Step 2: Run the fixed-account smoke test**

Run `npm run cluster:smoke` with the four password variables loaded.

- [ ] **Step 3: Run any available package test command**

Run `npm test` only if the package defines it; otherwise record that no package test script exists.

- [ ] **Step 4: Check the diff and protected data snapshot**

Run `git diff --check` and confirm the smoke output reports unchanged protected data.

- [ ] **Step 5: Inspect the live cluster-manager views**

Verify scope, missing Pala warning, search, refresh, pagination, mobile status presentation, and blocked-route messaging. Do not claim deployment success unless the live checks pass.
