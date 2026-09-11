# Fixed CEO Account and Executive Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fixed `ceo.nippon` read-only account and give it an all-branch executive dashboard that explains CRM performance visually.

**Architecture:** Keep fixed identity metadata in a small source module and seed one additive `ceo` user during startup, with the password read from `CEO_PASSWORD`. Extend existing all-branch report endpoints for CEO read access, then add a CEO-only Executive Overview that composes their aggregate responses into dependency-free HTML/CSS visualizations with existing lead drill-down links.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, scrypt password hashing, vanilla JavaScript, CSS/SVG, existing no-build frontend.

## Global Constraints

- Fixed username: `ceo.nippon`.
- Initial password: the operator-provided value; configure it through `CEO_PASSWORD`, never commit it in source or documentation.
- CEO is read-only: no user management, reassignment, master-list editing, uploads, follow-up writes, flag writes, or other Admin mutation actions.
- CEO report scope is every branch; Cluster Manager branch scoping must remain unchanged.
- Do not add a charting dependency; use existing aggregate APIs and HTML/CSS/SVG.
- Every visual summary must preserve a textual value and a drill-down path where a matching lead list exists.
- Zero-value and empty datasets must render safely without invalid CSS widths or fabricated totals.

---

## File Map

- Create `ceo-account.js`: immutable CEO username/name/role metadata and environment-backed password lookup.
- Modify `db.js`: accept `ceo` in the role constraint and seed the fixed account idempotently.
- Modify `server.js`: authorize CEO on read/report routes, provide all-branch report scope, and keep every write route Admin-only.
- Modify `public/app.js`: add CEO navigation, Executive Overview rendering, CEO-aware read-only role checks, and visual drill-down wiring.
- Modify `public/style.css`: add responsive, accessible executive chart styles.
- Modify `.env.example`: document `CEO_PASSWORD` without exposing the initial value.
- Create `scripts/ceo-smoke.js`: read-only authentication, access, and denial smoke checks against a configured server.
- Modify `package.json`: add `ceo:smoke` script.

---

### Task 1: Add fixed CEO identity and additive seeding

**Files:**
- Create: `ceo-account.js`
- Modify: `db.js:3, 114-165`
- Modify: `.env.example`
- Test: `scripts/ceo-smoke.js` (created in Task 4)

**Interfaces:**
- Produces `CEO_ACCOUNT_DEFINITION` with `{ username, name, role, passwordEnv }`.
- Produces `getCeoPassword()` which returns `process.env.CEO_PASSWORD` or throws `Missing required environment variable CEO_PASSWORD`.
- Produces `seedCeoAccount()` which inserts or synchronizes only the fixed CEO row.

- [ ] **Step 1: Define the fixed identity module.**

Create `ceo-account.js` with:

```js
export const CEO_ACCOUNT_DEFINITION = Object.freeze({
  username: 'ceo.nippon',
  name: 'Nippon Toyota CEO',
  role: 'ceo',
  passwordEnv: 'CEO_PASSWORD',
});

export function getCeoPassword() {
  const password = String(process.env[CEO_ACCOUNT_DEFINITION.passwordEnv] || '');
  if (!password) throw new Error('Missing required environment variable CEO_PASSWORD');
  return password;
}
```

- [ ] **Step 2: Extend the database role constraint.**

Import the CEO definition and helper in `db.js`. Add `'ceo'` to both role-check constraint definitions. Keep the existing roles and existing user rows unchanged.

- [ ] **Step 3: Implement idempotent CEO seeding.**

Add `seedCeoAccount()` and call it after `seedClusterManagers()` in `initDb()` and in the `DB_SKIP_INIT=1` boot path. The helper must:

1. Query `users` by `ceo.nippon`.
2. If the row is absent and `CEO_PASSWORD` is missing, throw the named missing-variable error.
3. If the row exists and `CEO_PASSWORD` is missing, leave it unchanged so a deployment can start without rotating an existing account.
4. If a password is supplied, update only the stored password when verification fails.
5. Insert a missing row with `name = 'Nippon Toyota CEO'`, `role = 'ceo'`, and `branch_id = NULL` using `ON CONFLICT (username) DO NOTHING`.

- [ ] **Step 4: Document deployment configuration.**

Add `CEO_PASSWORD=...` to `.env.example` near the cluster-manager password variables. Do not add the agreed password value to any tracked file.

- [ ] **Step 5: Run static checks.**

Run:

```text
node --check ceo-account.js
node --check db.js
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the account layer.**

```text
git add ceo-account.js db.js .env.example
git commit -m "feat: seed fixed CEO account"
```

---

### Task 2: Add secure CEO read-only backend access

**Files:**
- Modify: `server.js:45-96, 889-936, 1269-1420, 1509-1770, 1816-1840`
- Test: `scripts/ceo-smoke.js`

**Interfaces:**
- CEO requests use the existing report response shapes.
- `managerBranchIds(req)` returns all current branch IDs for `ceo`, while `cluster_manager` continues using its cached configured scope.

- [ ] **Step 1: Add a server-side all-branch ID cache.**

Declare `allBranchIds` beside the Cluster Manager scope maps. In `loadClusterManagerScopes()`, load all branch IDs in the same startup phase. Update `managerBranchIds(req)` so `ceo` returns a copy of `allBranchIds`; all other roles preserve current behavior.

- [ ] **Step 2: Extend only read endpoint allowlists.**

Add `ceo` to these route authorizations:

```text
GET /api/analytics
GET /api/call-center/analytics
GET /api/call-center/source-quality
GET /api/call-center/leads/export
GET /api/manager/leads
GET /api/sales-manager/analytics
GET /api/sales-manager/lead-search
GET /api/sales-manager/lead-analysis
GET /api/sales-manager/lead-analysis/leads
GET /api/sales-manager/officer-leads
GET /api/sales-manager/officer-status-leads
```

For `/api/manager/leads`, treat CEO as the all-branch call-center reporting scope when `scope=call_center`, so existing metric links work. For sales-manager endpoints, ignore a CEO `branch_id` override and use `allBranchIds` so the CEO cannot narrow or widen authorization through query parameters.

- [ ] **Step 3: Keep sensitive data and writes restricted.**

Do not add CEO to any POST/PATCH/DELETE route. Keep `/api/users`, `/api/admin/*`, `/api/masters/:type` mutations, lead creation, follow-up, order-ID, flag, and close-flag routes unchanged. Keep `CEO` lead detail read access all-branch through the existing unscoped `GET /api/leads` and `GET /api/leads/:id` behavior.

In `/api/call-center/analytics`, include flag history for CEO exactly as for Admin, but do not grant any flag mutation endpoint.

- [ ] **Step 4: Run backend syntax checks.**

Run:

```text
node --check server.js
```

Expected: exit 0.

- [ ] **Step 5: Commit backend authorization.**

```text
git add server.js
git commit -m "feat: allow CEO read-only reporting access"
```

---

### Task 3: Add the CEO Executive Overview visualizations

**Files:**
- Modify: `public/app.js:35,255-264,305-349,1629-1810,1866-1945,2125-2155`
- Modify: `public/style.css` (append executive overview styles)

**Interfaces:**
- Adds `ceo` navigation with `executiveOverview`, `analytics`, `callCenter`, `sourceQuality`, `salesPerf`, `leadAnalysis`, `flagged`, and `leads`.
- Adds `ceoOverviewView()` which fetches `/analytics`, `/call-center/analytics`, and `/sales-manager/analytics` in parallel and renders an executive summary.
- Adds pure rendering helpers `ceoBar(value, max, tone)`, `ceoPercent(value, total)`, and `ceoOverviewBranchRows(branches)`.

- [ ] **Step 1: Add the CEO role and navigation.**

Add `ceo: 'CEO'` to `roleLabel`. Add this tab definition:

```js
ceo: [
  ['executiveOverview', 'Executive Overview', '◈'],
  ['analytics', 'Branch Analytics', '📊'],
  ['callCenter', 'Call Center', '☎️'],
  ['sourceQuality', 'Source quality', '📊'],
  ['salesPerf', 'Sales Officers', '👥'],
  ['leadAnalysis', 'Lead Analysis', '📈'],
  ['flagged', 'Flagged Leads', '🚩'],
  ['leads', 'All leads', '📋'],
],
```

Route the new tab in `go()` and make it the default first tab for CEO.

- [ ] **Step 2: Build safe visual helper functions.**

Implement `ceoBar(value, max, tone)` so it clamps the percentage to `0..100`, uses `0%` when `max <= 0`, and returns a `<span>` with an accessible label. Implement `ceoPercent(value, total)` to return `0%` when `total <= 0`.

- [ ] **Step 3: Render the branch comparison chart.**

Use `/api/analytics` branch rows to render a horizontal bar chart. Each row must show branch name, total leads, open leads, and won leads; the bar must use stacked proportions for won/open/other. Clicking a branch row calls `analyticsView(branch.id, branch.name)`.

- [ ] **Step 4: Render conversion and workload visuals.**

Use the `/api/sales-manager/analytics` summary for all-branch total/booked/retail/lost values and `/api/call-center/analytics` for follow-up/overdue and branch workload. Render:

1. A conversion mix card with proportional bars for open, booked, retail, and lost.
2. A workload card with branch rows showing total, open, won, and overdue proportions.
3. A “needs attention” strip listing the three branches with the highest overdue count, with each item opening the matching lead drill-down when a URL-compatible metric is available.

Keep each count visible beside its visualization. If the API returns no rows, render “No branch data available” instead of a blank chart.

- [ ] **Step 5: Make existing report pages CEO-aware without granting writes.**

Update role checks so CEO gets the Admin-style all-branch columns and flag history, but not Admin branch mutation controls. Specifically:

- Add CEO handling to `flaggedLeadsView()` using the all-branch call-center response.
- Show branch columns for CEO in Sales Officer and Lead Analysis views.
- Keep CEO out of branch-picker-only Admin flows; CEO’s default report query remains all branches.
- Keep `openLead()` action booleans false for CEO and show flag history as read-only.
- Let CEO use existing call-center export and metric drill-down links.

- [ ] **Step 6: Add responsive accessible styling.**

Add `.ceo-*` rules for a two-column desktop grid, stacked mobile layout below `700px`, contrast-safe fills, readable labels, horizontal overflow for long branch names, and `@media (prefers-reduced-motion: reduce)` behavior with no animated chart transitions.

- [ ] **Step 7: Run frontend syntax checks.**

Run:

```text
node --check public/app.js
```

Expected: exit 0.

- [ ] **Step 8: Commit the CEO visual layer.**

```text
git add public/app.js public/style.css
git commit -m "feat: add CEO executive visual overview"
```

---

### Task 4: Add read-only CEO smoke verification

**Files:**
- Create: `scripts/ceo-smoke.js`
- Modify: `package.json`

**Interfaces:**
- Reads `BASE_URL` (default `http://localhost:3000`), `CEO_PASSWORD`, and optionally `ADMIN_USERNAME`/`ADMIN_PASSWORD` for comparison.
- Uses cookie-based login and makes no mutating API requests.

- [ ] **Step 1: Implement login and request helpers.**

Create a Node script using built-in `fetch`. `login(username, password)` must POST `/api/login`, capture the `sid` cookie, and fail with the response body on non-2xx. `get(path, cookie)` must send the cookie and parse JSON.

- [ ] **Step 2: Verify CEO identity and read access.**

Log in as `ceo.nippon` with `CEO_PASSWORD`, then assert:

```text
GET /api/me -> role === 'ceo'
GET /api/analytics -> array response
GET /api/call-center/analytics -> summary and byBranch fields
GET /api/call-center/source-quality -> summary and branches fields
GET /api/sales-manager/analytics -> branchIds and bySalesOfficer fields
GET /api/sales-manager/lead-analysis -> branchIds and bySalesOfficer fields
GET /api/leads?page=1&limit=1 -> leads/total/page/pages fields
```

- [ ] **Step 3: Verify CEO write denials.**

Send harmless validation requests and assert status `403` for:

```text
POST /api/users
POST /api/admin/reassign-leads
POST /api/masters/branches
POST /api/leads
POST /api/leads/1/followup
POST /api/leads/1/flag
POST /api/leads/1/close-flag
```

The script must not retry with alternate payloads or create/update/delete any record.

- [ ] **Step 4: Add the package script.**

Add:

```json
"ceo:smoke": "node --env-file=.env scripts/ceo-smoke.js"
```

- [ ] **Step 5: Run verification.**

Run:

```text
node --check scripts/ceo-smoke.js
npm run ceo:smoke
```

Expected: syntax check exits 0 and the smoke script reports all identity, read, and denial checks passed. If no configured database/server is available, report that environmental limitation without claiming runtime verification.

- [ ] **Step 6: Commit smoke coverage.**

```text
git add scripts/ceo-smoke.js package.json
git commit -m "test: add CEO access smoke checks"
```

---

### Task 5: Final verification and handoff

**Files:**
- Verify: all files changed by Tasks 1-4

- [ ] **Step 1: Run all static checks.**

```text
node --check ceo-account.js
node --check db.js
node --check server.js
node --check public/app.js
node --check scripts/ceo-smoke.js
```

Expected: five exit-0 results.

- [ ] **Step 2: Run the configured CEO smoke test.**

```text
npm run ceo:smoke
```

Expected: all read-only access checks pass, all mutation checks return `403`, and no CRM data is changed.

- [ ] **Step 3: Inspect the final diff.**

```text
git status --short
git diff HEAD~4..HEAD --stat
git diff --check HEAD~4..HEAD
```

Expected: only the CEO account, backend permissions, frontend visualizations, configuration documentation, and smoke-test files are changed; `git diff --check` reports no whitespace errors; no password literal appears in tracked files.

- [ ] **Step 4: Commit any final documentation-only correction.**

```text
git add docs/superpowers/specs/2026-09-11-ceo-account-design.md docs/superpowers/plans/2026-09-11-ceo-account-and-visualizations.md
git commit -m "docs: finalize CEO implementation plan"
```
