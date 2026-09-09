# Fixed Cluster Manager Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four hardcoded, multi-branch `cluster_manager` accounts with read-oriented access to existing Sales Manager dashboards while preserving existing data and keeping Admin visibility read-only for those accounts.

**Architecture:** Add a small immutable configuration module containing the four account definitions and branch-name mappings. Seed only missing accounts during database initialization without overwriting existing usernames, resolve configured branch names once at startup into an in-memory username-to-branch-ID map, and use indexed parameterized branch filters for cluster requests. Extend the existing Sales Manager API/UI paths rather than creating parallel dashboards.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, existing scrypt password hashing, vanilla JavaScript frontend.

## Global Constraints

- Do not update, delete, disable, or rewrite existing leads, follow-ups, branches, assignments, users, or credentials.
- Only the four requested cluster-manager account rows may be inserted, and seeding must be idempotent.
- `cluster_manager` must be visible to Admin in the Users list but unavailable through Admin create/edit/toggle actions.
- Cluster branch access is hardcoded and resolved once at startup; no per-request membership joins or per-row permission queries.
- Missing `Pala` must not cause a branch-table write or startup failure.

### Task 1: Add hardcoded definitions and additive account seeding

**Files:**
- Create: `cluster-managers.js`
- Modify: `db.js` (`DDL` role constraint and `initDb`)
- Test: `scripts/cluster-manager-smoke.js`

**Interfaces:**
- `cluster-managers.js` exports `CLUSTER_MANAGER_DEFINITIONS`, each with `username`, `name`, `password`, and `branches`.
- `db.js` imports the definitions and inserts each missing username with `ON CONFLICT(username) DO NOTHING`.
- The role constraint accepts `cluster_manager`.

- [ ] **Step 1: Define the four fixed accounts and mappings**

Use usernames `biju.cluster`, `praveen.cluster`, `vinod.cluster`, and `nirmal.cluster`; map them to the approved branch names, including `Pala` for Vinod. Use distinct passwords of at least 12 characters and keep the definitions in one module so the seed and runtime access map share the same source.

- [ ] **Step 2: Extend the role constraint additively**

Update the existing `users_role_check` replacement constraint to include `cluster_manager` without changing any user rows.

- [ ] **Step 3: Seed only missing cluster accounts**

After schema initialization, insert each definition with its scrypt hash and `branch_id = NULL`, using `ON CONFLICT(username) DO NOTHING`. Do not use an upsert that changes name, role, active state, or password.

- [ ] **Step 4: Add a smoke-test script for account seeding**

The script logs in to the running app using the four fixed credentials, checks each `/api/me` response for `cluster_manager`, and verifies Admin can list all four accounts. It must not create leads or change existing rows.

- [ ] **Step 5: Run the focused checks**

Run `node --check cluster-managers.js`, `node --check db.js`, and the smoke script against the configured test/demo server after implementation.

### Task 2: Add cached multi-branch authorization and protect Admin mutations

**Files:**
- Modify: `server.js` (startup cache, branch-scope helpers, user endpoints, lead read/flag authorization)

**Interfaces:**
- `loadClusterManagerScopes()` resolves configured branch names once using one startup query and stores `Map<username, number[]>`.
- `branchScope(req)` returns the authorized branch IDs for `sales_manager`, `cluster_manager`, and Admin-selected branch requests.
- `branchPredicate(column, ids)` returns SQL plus parameters using `=` for one ID and `ANY(?)` for multiple IDs.

- [ ] **Step 1: Load fixed branch scopes before listening**

Resolve existing branches by exact name after `initDb` completes. Log missing configured branches, including `Pala`, and keep only found IDs. Start the HTTP listener only after this cache is ready; with `DB_SKIP_INIT=1`, still perform the read-only scope load.

- [ ] **Step 2: Extend Admin user behavior safely**

Leave `cluster_manager` out of the allowed POST roles. Make `/api/users/:id/toggle` reject users whose role is `cluster_manager`. Keep `/api/users` listing unchanged so Admin sees the four accounts and their role label.

- [ ] **Step 3: Add cluster-manager authentication to existing read routes**

Allow `cluster_manager` on the existing Sales Manager analytics, lead-analysis, officer drilldown, and flagged-lead routes. For cluster managers, ignore any client-supplied `branch_id` and use the cached scope from the authenticated username.

- [ ] **Step 4: Replace single-branch filters in those routes**

Use the helper-generated predicate for every leads branch filter in `/api/sales-manager/analytics`, `/lead-analysis`, `/lead-analysis/leads`, `/officer-leads`, and `/officer-status-leads`. Preserve the existing single-branch behavior for Sales Managers and Admins. Return `branchIds` alongside existing response fields where useful without removing current fields.

- [ ] **Step 5: Protect lead detail and flag review by the same scope**

Allow cluster managers to open authorized lead details and close flags only when the lead branch is in their cached scope. Keep all existing write restrictions for other roles unchanged.

- [ ] **Step 6: Run syntax and route-level tests**

Run `node --check server.js` and exercise authorized, cross-cluster, and unauthorized branch requests using the smoke script without creating or modifying leads.

### Task 3: Add the fixed role to the Admin and cluster-manager UI

**Files:**
- Modify: `public/app.js` (`roleLabel`, `TABS`, user-row controls, Sales Manager views)

**Interfaces:**
- `TABS.cluster_manager` mirrors the existing Sales Manager read views.
- Cluster-manager view requests omit branch selection and rely on server-side fixed scope.

- [ ] **Step 1: Label and route the role**

Add `cluster_manager: 'Cluster Manager'` to `roleLabel` and add `salesPerf`, `leadAnalysis`, and `flagged` to `TABS.cluster_manager`.

- [ ] **Step 2: Keep cluster managers out of Admin creation UI**

Do not add a Cluster Manager option to the role select. Hide Disable/Enable controls for rows whose role is `cluster_manager`, while leaving those rows visible.

- [ ] **Step 3: Make performance and analysis views cluster-aware**

Use the authenticated role to call the existing endpoints without a branch override, display a neutral “Assigned cluster” label, and avoid Admin-only branch pickers for cluster managers. Preserve the current Sales Manager and Admin flows.

- [ ] **Step 4: Make flagged-lead view cluster-aware**

Load flagged leads through the same multi-branch endpoint and retain lead detail/flag-review behavior for authorized cluster branches.

- [ ] **Step 5: Run frontend syntax checks and smoke login**

Run `node --check public/app.js` and manually verify each fixed account receives the three expected tabs and Admin sees the accounts without a toggle control.

### Task 4: Verify latency and data immutability

**Files:**
- Modify: `scripts/demo-smoke.js` or add assertions to `scripts/cluster-manager-smoke.js`

- [ ] **Step 1: Snapshot protected row counts and hashes**

Before smoke execution, read counts and stable aggregate hashes for `branches`, `leads`, `followups`, and pre-existing `users` rows. Do not write test leads or follow-ups.

- [ ] **Step 2: Verify fixed account access**

For each account, verify login, `/api/me`, Sales Officer analytics, Lead Analysis, flagged-lead response, and rejection of a branch override outside its hardcoded scope.

- [ ] **Step 3: Verify Admin visibility and mutation rejection**

Verify Admin lists all four accounts, POST `/api/users` rejects `cluster_manager`, and toggling a cluster-manager ID is rejected.

- [ ] **Step 4: Compare protected data after tests**

Confirm all protected counts and hashes are unchanged; only the four intended cluster account rows may have been added.

- [ ] **Step 5: Run the project verification suite**

Run the focused smoke checks, `npm run demo:smoke` where the demo database is available, and `git diff --check`. Record any environment-only limitations without claiming them as passing.
