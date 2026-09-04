# Call-center CRM repurposing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing dealership follow-up CRM into a local-only demo where Admin imports branch and original Sales Officer data, assigns leads to five global Call Guys, Call Guys log follow-ups, Call Center Managers monitor Call Guys, and Branch Sales Managers monitor original Sales Officers.

**Architecture:** Keep the existing Express/vanilla-JS application and PostgreSQL query layer. Add explicit local demo configuration that points only to a localhost database and refuses to start without it. Extend the existing lead model with imported Sales Officer fields and a Call Guy assignment, then reuse the current follow-up history and outcome machinery while adding role-scoped dashboards.

**Tech Stack:** Node.js >=22.5, Express 4, PostgreSQL via `pg`, vanilla JavaScript, HTML/CSS, ExcelJS for demo workbook generation, SheetJS for browser import/export.

## Global Constraints

- The demo must use dummy data and an isolated local PostgreSQL database.
- The implementation must not read from or write to the currently connected database service.
- The existing `.env` must remain unchanged and must not be loaded by the demo command.
- Sales Officers are imported lead data, not platform users in the new workflow.
- Exactly five demo Call Guys form one shared assignment pool across all branches.
- Branch Sales Managers can see only their assigned branch.
- Call Center Managers see Call Guy performance across all branches.
- Admin sees both Call Guy and original Sales Officer performance across all branches.
- Preserve current follow-up validation, F-number history, flags, and outcome-specific fields unless a role/reporting change requires an adjustment.
- Do not delete existing database records or use destructive commands against the connected database.

## File map

- Create `scripts/demo-db.js` for explicit local database creation and reset/seed commands.
- Create `scripts/generate-demo-workbook.js` for the uploadable combined sample workbook.
- Create `scripts/demo-smoke.js` for authenticated API-level end-to-end checks against the demo server.
- Create `.env.demo.example` with safe localhost database settings and demo start instructions.
- Modify `package.json` with demo setup, workbook, and smoke-test commands.
- Modify `db.js` for new role values, imported Sales Officer columns, Call Guy constraints, and demo seed data.
- Modify `server.js` for strict demo configuration, role authorization, import assignment, and scoped analytics.
- Modify `public/app.js` for new role navigation, combined workbook mapping, Call Guy selection, and dashboards.
- Modify `public/index.html` only if the page title or script setup needs demo-compatible changes.
- Modify `public/style.css` only for new dashboard/table states that cannot use existing styles.
- Modify `README.md` with local demo setup, credentials, workbook format, and isolation warnings.

## Task 1: Add an isolated local demo database path

**Files:**
- Create: `.env.demo.example`
- Create: `scripts/demo-db.js`
- Modify: `package.json`
- Modify: `db.js`
- Modify: `server.js`
- Modify: `.gitignore`

**Interfaces:**
- `scripts/demo-db.js` exposes `create`, `reset`, and `seed` commands using only `DB_DEMO_*` variables.
- `db.js` exports the existing `pool`, `get`, `all`, `run`, `ins`, `hash`, `verify`, and `initDb` APIs with the same signatures.
- `server.js` starts in demo mode only when `DEMO_MODE=1` and refuses to start if `DB_HOST` is not `localhost`, `127.0.0.1`, or `::1`.

- [ ] **Step 1: Add safe demo configuration and scripts.** Set `DEMO_MODE=1`, `DB_HOST=localhost`, `DB_PORT=5432`, `DB_NAME=followup_crm_demo`, and document that the local PostgreSQL password is supplied outside the repository. Add `demo:db`, `demo:reset`, `demo:seed`, `demo:workbook`, and `demo:smoke` npm scripts without changing `start` or the existing `.env`.
- [ ] **Step 2: Add the startup guard.** Before `initDb()` or `app.listen()`, reject demo mode when `DEMO_MODE` is not exactly `1`, when the host is not local, or when the database name is not `followup_crm_demo`.
- [ ] **Step 3: Add a demo database creator.** Connect to the local PostgreSQL server using the local admin credentials, create `followup_crm_demo` if absent, and exit with a clear error when localhost PostgreSQL is unavailable. Do not import `.env` or inspect its values.
- [ ] **Step 4: Run the isolation check.** Run `npm run demo:db` with the example values and verify that the command targets `localhost:5432/followup_crm_demo`. Verify that ordinary `npm start` behavior and `.env` are unchanged.
- [ ] **Step 5: Commit.** `git add .env.demo.example scripts/demo-db.js package.json db.js server.js .gitignore && git commit -m "feat: add isolated local demo database"`

## Task 2: Model imported Sales Officers and new platform roles

**Files:**
- Modify: `db.js`
- Modify: `server.js`
- Modify: `scripts/demo-db.js`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- Lead records expose `original_so_name`, `original_so_mobile`, and `assigned_to` where `assigned_to` is a Call Guy user ID.
- User roles are `admin`, `call_guy`, `call_center_manager`, and `sales_manager`; `sales_manager` requires `branch_id`, and Call Guys do not.
- `GET /api/me` returns the authenticated role, branch, `today`, `maxDate`, and outcomes.

- [ ] **Step 1: Write failing API assertions.** Add smoke-test checks that demo users with roles `admin`, `call_guy`, `call_center_manager`, and `sales_manager` can log in, while no Sales Officer account is needed. Assert that a Sales Manager response includes only its branch ID.
- [ ] **Step 2: Extend the schema safely.** Add `original_so_name TEXT` and `original_so_mobile TEXT` to `leads`, extend the user role check, and preserve existing columns and follow-up foreign keys. Add indexes for `leads(original_so_name, branch_id)` and `leads(assigned_to, status, next_date)`.
- [ ] **Step 3: Update role validation.** Require a branch for `sales_manager`, allow Call Guys without a branch, and stop creating new `sales` users in the new demo UI. Keep old records readable without deleting them.
- [ ] **Step 4: Seed demo identities and masters.** Create one Admin, five Call Guys, one Call Center Manager, and one Sales Manager per demo branch with known demo passwords. Seed branches, sources, activities, and models only in the demo database.
- [ ] **Step 5: Run the role smoke test.** Verify login and `/api/me` for each demo identity, including the Sales Manager branch scope.
- [ ] **Step 6: Commit.** `git add db.js server.js scripts/demo-db.js scripts/demo-smoke.js && git commit -m "feat: add call center and branch manager roles"`

## Task 3: Replace assignment with a five-Call-Guy global pool

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- `POST /api/leads/bulk-validate` accepts the combined workbook fields and returns normalized rows with branch/source/model IDs plus original Sales Officer data.
- `POST /api/leads/bulk-assign` accepts validated rows and `call_guy_ids`, rejects any selection other than five active Call Guys, and assigns leads across branches without branch filtering.
- `GET /api/leads` scopes Call Guy results by `assigned_to = req.user.id`.

- [ ] **Step 1: Add failing assignment checks.** Assert that four or six selected Call Guys return HTTP 400, that five valid Call Guy IDs accept rows from multiple branches, and that no lead is assigned to a Sales Officer role.
- [ ] **Step 2: Normalize import columns.** Map `Name`, `Mobile`, `Source`, `Branch`, `Location`, `Model`, `SO Name`, `SO Mobile`, and `Status`. Continue accepting the current separate lead/Salesforce data shape when possible by matching mobile numbers.
- [ ] **Step 3: Implement server-side selection validation.** Validate that every selected ID is an active `call_guy`; require exactly five; assign rows round-robin or through the existing selected-target distribution logic; retain each row’s branch and imported Sales Officer fields.
- [ ] **Step 4: Update the review sheet.** Show branch, original Sales Officer, and intended Call Guy columns. Add a five-person Call Guy selector that works with the existing assignment interaction and makes the shared-all-branches scope explicit.
- [ ] **Step 5: Keep duplicate and master validation.** Preserve mobile normalization, duplicate rejection, branch/source/model resolution, and clear invalid-row messages.
- [ ] **Step 6: Run the import smoke test.** Upload the generated workbook payload, assign all accepted rows, and verify that every lead has a branch, original Sales Officer, and one of the five Call Guys.
- [ ] **Step 7: Commit.** `git add server.js public/app.js public/style.css scripts/demo-smoke.js && git commit -m "feat: assign imported leads to five global call guys"`

## Task 4: Adapt the Call Guy work queue and follow-up permissions

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `README.md`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- Call Guys use the existing `fresh`, `today`, and `leads` tabs and `POST /api/leads/:id/followup`.
- Only the assigned Call Guy or Admin can log a follow-up for an open lead.
- Lead detail responses include branch, original Sales Officer, assigned Call Guy, and full follow-up history.

- [ ] **Step 1: Add permission assertions.** Verify that an assigned Call Guy can open and update a lead, another Call Guy receives `403`, and a Sales Manager cannot log a follow-up.
- [ ] **Step 2: Change follow-up authorization.** Replace the Sales Officer assignment check with the Call Guy assignment check while preserving Admin access, open/closed validation, outcome validation, date limits, required booking/retail/test-drive/exchange fields, and F-number sequencing.
- [ ] **Step 3: Update Call Guy navigation and labels.** Replace Sales Officer labels with Call Guy labels in the active demo path, remove Sales Officer login assumptions, and display the original Sales Officer and branch in lead details.
- [ ] **Step 4: Verify follow-up history.** Log Connected, Not Connected, open, closing, and lost outcomes in the smoke script and assert the lead status, stage, next date, and sequence values.
- [ ] **Step 5: Commit.** `git add server.js public/app.js public/index.html README.md scripts/demo-smoke.js && git commit -m "feat: let call guys process assigned follow-ups"`

## Task 5: Build Call Center Manager reporting

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- Add `GET /api/call-center/analytics`, available to `call_center_manager` and `admin`.
- The response contains `kpi`, `byCallGuy`, `outcomes`, `byStage`, `overdue`, `flagged`, and branch breakdown data.
- Call Center Manager dashboard is the only manager dashboard shown to that role.

- [ ] **Step 1: Add failing analytics assertions.** Assert that the endpoint returns all five Call Guys, includes only leads assigned to Call Guys, and aggregates follow-ups by the Call Guy who performed them.
- [ ] **Step 2: Implement scoped analytics queries.** Reuse the current KPI, outcome, stage, overdue, flag, and export query patterns, replacing Sales Officer assignment joins with Call Guy joins and removing branch restriction for the Call Center Manager.
- [ ] **Step 3: Implement the dashboard.** Add KPI cards, Call Guy performance table, outcome drill-downs, F-stage counts, overdue table, flagged leads, and Excel export where the existing UI already supports it.
- [ ] **Step 4: Verify with mixed-branch seed data.** Confirm that a Call Center Manager can see Call Guys handling leads from all branches and cannot access unrelated admin controls.
- [ ] **Step 5: Commit.** `git add server.js public/app.js public/style.css scripts/demo-smoke.js && git commit -m "feat: add call center manager dashboard"`

## Task 6: Build Branch Sales Manager and Admin Sales Officer reporting

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- Add `GET /api/sales-manager/analytics`, available to `sales_manager` and `admin`, with optional Admin-only `branch_id` filtering.
- The response groups lead and follow-up results by `original_so_name`, not by platform user.
- A Sales Manager request always applies `req.user.branch_id`, regardless of query parameters.

- [ ] **Step 1: Add failing scope assertions.** Verify that a Branch Sales Manager sees only its branch, cannot override its branch with a query parameter, and sees original Sales Officer names even though no Sales Officer accounts exist.
- [ ] **Step 2: Implement Sales Officer aggregation.** Group by imported Sales Officer name and calculate lead count, untouched/open/follow-up counts, bookings, retail, lost leads, latest outcomes, and conversion counts from the Call Guy follow-up records.
- [ ] **Step 3: Implement manager navigation.** Give Sales Managers a branch-scoped dashboard focused on their Sales Officers. Give Admin a branch selector plus an all-branches view.
- [ ] **Step 4: Preserve Call Center separation.** Do not show Call Guy performance as the primary Sales Manager report. Keep the Call Center Manager dashboard separate.
- [ ] **Step 5: Verify reporting.** Use mixed branches and repeated Sales Officer names to confirm branch scoping and correct aggregation.
- [ ] **Step 6: Commit.** `git add server.js public/app.js public/style.css scripts/demo-smoke.js && git commit -m "feat: add branch sales officer performance reporting"`

## Task 7: Generate demo workbook and seed an end-to-end scenario

**Files:**
- Create: `scripts/generate-demo-workbook.js`
- Modify: `scripts/demo-db.js`
- Modify: `package.json`
- Create: `demo-data/call-center-demo.xlsx`
- Test: `scripts/demo-smoke.js`

**Interfaces:**
- `npm run demo:workbook` creates `demo-data/call-center-demo.xlsx` with the nine documented columns.
- `npm run demo:seed` loads deterministic demo identities, masters, leads, and follow-up history only into `followup_crm_demo`.
- The generated workbook has at least 20 leads across at least three branches, at least six original Sales Officers, and rows suitable for duplicate and outcome demonstrations.

- [ ] **Step 1: Write the workbook generator.** Use ExcelJS to create one `Leads` sheet with headers exactly `Name`, `Mobile`, `Source`, `Branch`, `Location`, `Model`, `SO Name`, `SO Mobile`, and `Status`, with deterministic sample rows.
- [ ] **Step 2: Add deterministic scenario data.** Seed leads across three branches and six original Sales Officers, assign them among five Call Guys, and add follow-ups covering fresh, due, overdue, booking, retail, lost, and flagged cases.
- [ ] **Step 3: Generate and inspect the workbook.** Run `npm run demo:workbook`, reopen the file with ExcelJS, and assert the header order, row count, and non-empty branch/Sales Officer/mobile fields.
- [ ] **Step 4: Seed without external access.** Run `npm run demo:reset` and `npm run demo:seed`, then query only the demo database for counts and role names.
- [ ] **Step 5: Commit.** `git add scripts/generate-demo-workbook.js scripts/demo-db.js package.json demo-data/call-center-demo.xlsx scripts/demo-smoke.js && git commit -m "feat: add local call center demo data and workbook"`

## Task 8: Run the full local demonstration and document handoff

**Files:**
- Modify: `README.md`
- Modify: `scripts/demo-smoke.js`
- Modify: `.gitignore` only if demo runtime files need exclusion

- [ ] **Step 1: Start only the demo server.** Use the explicit demo environment file or equivalent environment variables and verify the startup log names `localhost` and `followup_crm_demo`.
- [ ] **Step 2: Run the API smoke test.** Test Admin login/import/assignment, Call Guy login/follow-up, Call Center Manager analytics, Sales Manager branch scoping, and Admin cross-branch reporting.
- [ ] **Step 3: Run the browser walkthrough.** Open the local app and demonstrate the complete flow using the generated workbook and seeded accounts.
- [ ] **Step 4: Verify database isolation.** Stop the demo server, inspect the demo database only, and confirm that the connected database configuration was not loaded or modified.
- [ ] **Step 5: Document handoff.** Add demo credentials, setup commands, workbook location, role walkthrough, reset instructions, and a warning that the demo commands use only `followup_crm_demo`.
- [ ] **Step 6: Commit.** `git add README.md scripts/demo-smoke.js .gitignore && git commit -m "docs: document local call center demonstration"`

## Final verification commands

Run these commands from the repository root:

```powershell
npm install
npm run demo:db
npm run demo:reset
npm run demo:seed
npm run demo:workbook
npm run demo:smoke
```

Then start the app with the demo-only environment and open `http://localhost:3000`. Confirm the browser walkthrough matches the success criteria in the approved design spec.

