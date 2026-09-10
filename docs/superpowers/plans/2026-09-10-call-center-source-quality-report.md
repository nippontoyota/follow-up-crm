# Call Center Manager source quality report implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lazy-loaded, all-time, read-only Source Quality Report for Call Center Managers and Admins, with Referral/TKM grouping, branch breakdown, lead drill-downs, and a deterministic "What needs attention" strip.

**Architecture:** Keep `/api/call-center/analytics` unchanged. Add `/api/call-center/source-quality` as one read-only database query using a scoped leads CTE, follow-up history aggregation, and grouping sets for summary, source, and branch rows. Add a validated `source_group` and `quality_metric` filter to the existing Call Center lead drill-down route so the report reuses the current lead sheet.

**Tech Stack:** Node 22.5+, Express, PostgreSQL, vanilla JavaScript, existing CSS, Node fetch demo smoke tests.

## Global Constraints

- Default report scope is all-time and uses leads assigned to Call Executives, including open and closed leads.
- Source grouping is query-time only: case-insensitive `referral` maps to `Referral`, case-insensitive `tkm` maps to `TKM`, blank sources map to `Unknown`, and other names remain unchanged.
- Every metric is a distinct-lead count, not a call count.
- Do not add the report query to `/api/call-center/analytics`.
- The report request must execute one HTTP request and one read-only database query.
- Do not add a cache table, trigger, write operation, or client-side fetch of all leads.
- Never interpolate user-provided values into SQL.
- Preserve source IDs, lead rows, follow-up rows, assignments, and statuses.
- Rates render `N/A` when their denominator is zero.
- Only the agreed "What needs attention" strip is added beyond the report table and its required controls.

## File map

- Modify `server.js`: source grouping constants, report SQL, authenticated report endpoint, and Call Center source/metric drill-down filters.
- Modify `public/app.js`: role navigation, routing, report rendering, branch selection, attention strip, metric links, and report refresh state.
- Modify `public/style.css`: compact report layout, attention strip, metric table, raw-source details, and narrow-screen behavior.
- Modify `scripts/demo-db.js`: add grouped source fixtures without changing production data.
- Modify `scripts/demo-smoke.js`: verify grouping, metrics, branch filtering, authorization, drill-down filters, and no data mutation.
- Modify `README.md`: document the report and its read-only, all-time behavior.
- Create `docs/superpowers/specs/2026-09-10-call-center-source-quality-report-design.md`: approved design, already committed.

### Task 1: Add the read-only source-quality API

**Files:**
- Modify: `server.js` near the analytics helpers and `/api/call-center/analytics` route.
- Test: `scripts/demo-smoke.js`.

**Interfaces:**
- Produces `GET /api/call-center/source-quality?branch_id=<positive integer>` for `call_center_manager` and `admin`.
- Returns `{ summary, sources, branches, attention, branchId }`.
- Each metric row has `source_group`, `raw_sources`, `leads`, `attempted`, `connected`, `contact_rate`, `open_followup`, `booked`, `retailed`, `won_rate`, `lost`, `lost_rnr`, `average_followups`, and `overdue`.

- [ ] **Step 1: Add the fixed source grouping expression and report metric formatter.**

  Define one SQL expression in `server.js` and reuse it in the report query and drill-down filter:

  ```js
  const SOURCE_GROUP_SQL = `CASE
    WHEN LOWER(COALESCE(NULLIF(TRIM(s.name), ''), '')) LIKE '%referral%' THEN 'Referral'
    WHEN LOWER(COALESCE(NULLIF(TRIM(s.name), ''), '')) LIKE '%tkm%' THEN 'TKM'
    WHEN NULLIF(TRIM(s.name), '') IS NULL THEN 'Unknown'
    ELSE TRIM(s.name)
  END`;
  ```

  Keep arithmetic in SQL. Convert PostgreSQL numeric strings to numbers in a small response formatter before returning JSON.

- [ ] **Step 2: Add branch validation without a second query.**

  Parse `req.query.branch_id` as a positive integer. Pass the value into a `requested_branch AS (SELECT id, name FROM branches WHERE id = ?)` CTE and cross join its one-row `params` projection into the report query. Return `bad(res, 'Invalid branch')` when the value is not an integer or when the query reports no matching branch. Do not create or update branches.

- [ ] **Step 3: Add the single-query report endpoint.**

  Use one PostgreSQL query with this shape:

  ```sql
  WITH scoped AS (... scoped leads and source_group ...),
  history AS (... one row per lead with connected and lost_rnr flags ...)
  SELECT GROUPING(s.branch_id) AS all_branches,
         GROUPING(s.source_group) AS all_sources,
         s.branch_id, s.branch, s.source_group,
         ARRAY_AGG(DISTINCT s.raw_source ORDER BY s.raw_source)
           FILTER (WHERE s.raw_source IS NOT NULL) AS raw_sources,
         COUNT(*)::int AS leads,
         COUNT(*) FILTER (WHERE s.fcount > 0)::int AS attempted,
         COUNT(*) FILTER (WHERE h.connected)::int AS connected,
         COUNT(*) FILTER (WHERE s.status = 'open' AND s.fcount > 0)::int AS open_followup,
         COUNT(*) FILTER (WHERE s.stage = 'Booking Done' AND s.status = 'closed')::int AS booked,
         COUNT(*) FILTER (WHERE s.stage = 'Retail Done' AND s.status = 'closed')::int AS retailed,
         COUNT(*) FILTER (WHERE s.stage = 'Lost Lead' AND s.status = 'closed')::int AS lost,
         COUNT(*) FILTER (WHERE h.lost_rnr)::int AS lost_rnr,
         ROUND(AVG(s.fcount)::numeric, 2) AS average_followups,
         COUNT(*) FILTER (WHERE s.status = 'open' AND s.fcount > 0 AND s.next_date < ?)::int AS overdue
  FROM scoped s LEFT JOIN history h ON h.lead_id = s.id
  GROUP BY GROUPING SETS ((), (s.source_group), (s.branch_id, s.branch, s.source_group))
  ORDER BY all_branches DESC, all_sources DESC, leads DESC, s.branch, s.source_group
  ```

  Scope `scoped` to `l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')`. Apply the optional branch predicate through the bound `params` CTE. In `history`, use `BOOL_OR` over follow-ups joined to `scoped`, so connected and `LOST RNR` are calculated once per lead. Use `COUNT(*)` only after the one-row-per-lead history join.

- [ ] **Step 4: Compute the attention strip from source rows.**

  Return deterministic objects:

  ```js
  const highest = (rows, key, tieBreak = 'leads') => [...rows]
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0) || Number(b[tieBreak] || 0) - Number(a[tieBreak] || 0))[0] || null;
  const eligible = sources.filter(row => Number(row.leads) >= 20);
  const attention = {
    volume: highest(sources, 'leads'),
    conversion: eligible.length ? highest(eligible, 'won_rate', 'leads') : null,
    overdue: highest(sources, 'overdue'),
    unknown: sources.find(row => row.source_group === 'Unknown') || null,
  };
  ```

  Omit `overdue` and `unknown` when their counts are zero. Return a `conversionUnavailable` state when no source has 20 leads. Do not write flags, assignments, or remarks.

- [ ] **Step 5: Run syntax and static checks.**

  Run:

  ```powershell
  node --check server.js
  git diff --check
  ```

  Expected: both commands exit 0.

- [ ] **Step 6: Commit the backend API.**

  ```powershell
  git add server.js
  git commit -m "feat: add read-only source quality API"
  ```

### Task 2: Add validated source-quality drill-downs

**Files:**
- Modify: `server.js` inside `/api/manager/leads`.
- Test: `scripts/demo-smoke.js`.

**Interfaces:**
- Consumes `source_group`, `quality_metric`, and the existing `branch_id`, `scope`, and `bucket` query parameters.
- Produces the existing lead-array response with no response-shape change for old filters.

- [ ] **Step 1: Define the fixed quality filters.**

  Add this map inside the Call Center branch of the route:

  ```js
  const QUALITY_FILTERS = {
    total: '1 = 1',
    attempted: 'l.fcount > 0',
    connected: `EXISTS (SELECT 1 FROM followups f WHERE f.lead_id = l.id AND f.call_status = 'Connected')`,
    open_followup: `l.status = 'open' AND l.fcount > 0`,
    booked: `l.stage = 'Booking Done' AND l.status = 'closed'`,
    retailed: `l.stage = 'Retail Done' AND l.status = 'closed'`,
    won: `l.stage IN ('Booking Done', 'Retail Done')`,
    lost: `l.stage = 'Lost Lead' AND l.status = 'closed'`,
    lost_rnr: `EXISTS (SELECT 1 FROM followups f WHERE f.lead_id = l.id AND f.outcome = 'LOST RNR')`,
    overdue: `l.status = 'open' AND l.fcount > 0 AND l.next_date < ?`,
  };
  ```

- [ ] **Step 2: Validate and apply the source group.**

  Accept a non-empty string up to 80 characters as `source_group`, pass it as a bound value against the shared `SOURCE_GROUP_SQL`, and allow either one of the grouped labels or an unchanged raw source label. Keep the SQL expression fixed. Add `source_group` to the existing `BASE` query's Call Center filter branch.

- [ ] **Step 3: Validate and apply the quality metric.**

  Accept only keys present in `QUALITY_FILTERS`. Add its SQL to the filter list. Bind `today()` only for `overdue`. Preserve all existing bucket behavior when `quality_metric` is absent.

- [ ] **Step 4: Verify read-only drill-downs.**

  Add smoke assertions that `source_group=Referral&quality_metric=won`, `source_group=TKM&quality_metric=connected`, and `source_group=Unknown&quality_metric=total` return 200 and only matching leads.

- [ ] **Step 5: Run the isolated API smoke test and commit.**

  ```powershell
  npm run demo:reset
  npm run demo:seed
  node --env-file=.env.demo scripts/demo-smoke.js
  git add server.js scripts/demo-smoke.js
  git commit -m "feat: add source quality lead drilldowns"
  ```

  Expected: the smoke test exits 0 and the demo database is the only database touched.

### Task 3: Add the Call Center Manager report UI

**Files:**
- Modify: `public/app.js` in `TABS`, `go`, analytics state, and after the existing Call Center view.
- Modify: `public/style.css` in the Call Center section.

**Interfaces:**
- Consumes `/api/call-center/source-quality` response from Task 1.
- Calls `openMetricLeads` with `scope=call_center`, `source_group`, `quality_metric`, and optional `branch_id` from Task 2.

- [ ] **Step 1: Add the role navigation and route.**

  Add `['sourceQuality', 'Source quality', '📊']` after `callCenter` for `call_center_manager` and `admin`. Add `sourceQuality: null` to `analyticsUpdatedAt`, map `sourceQuality` to `sourceQualityView` in `go`, and apply `.cc-mode` to both `callCenter` and `sourceQuality` routes.

- [ ] **Step 2: Add report loading with one request.**

  Implement `async function sourceQualityView(branchId = '')` that renders a compact loading state, calls exactly one endpoint request, records `analyticsUpdatedAt.sourceQuality`, and renders the response. Branch changes call the same function with the selected ID. Refresh calls the same function with the current selected branch.

- [ ] **Step 3: Render the attention strip.**

  Render only the returned deterministic items. Use plain labels such as `Highest volume`, `Best won rate`, `Most overdue`, and `Unknown source`. Show the conversion sample size when present. Do not calculate a different winner in the browser.

- [ ] **Step 4: Render source and branch tables.**

  Use existing `tblHtml` patterns where possible. Make each count a keyboard-reachable button with `callCenterMetricClick`. Render rates with one decimal place and `N/A` for zero denominators. Render raw source names inside a native `<details>` element in the source group cell. Keep the all-source summary row visually distinct and show the branch breakdown below the source table.

- [ ] **Step 5: Add empty, loading, error, and accessibility states.**

  Preserve `analyticsError` retry behavior. Add visible labels for the branch selector. Add `aria-label` text to count buttons. Ensure focus styles work for report controls and reduced-motion users receive no animation requirement.

- [ ] **Step 6: Add styles and responsive rules.**

  Add focused `.cc-quality-*` rules for the report header, selector, attention strip, summary row, table, source details, and metric buttons. Keep the existing light blue and navy palette. At narrow widths, let the table scroll horizontally and stack attention items without changing the data.

- [ ] **Step 7: Run client syntax and diff checks.**

  ```powershell
  node --check public/app.js
  git diff --check
  ```

  Expected: both commands exit 0.

- [ ] **Step 8: Commit the UI.**

  ```powershell
  git add public/app.js public/style.css
  git commit -m "feat: add source quality report UI"
  ```

### Task 4: Add fixture coverage and documentation

**Files:**
- Modify: `scripts/demo-db.js`.
- Modify: `scripts/demo-smoke.js`.
- Modify: `README.md`.

- [ ] **Step 1: Add representative grouped sources to the isolated demo seed.**

  Extend the demo source list with `Customer Referral` and `TKM Website`, and seed one demo lead with a null source ID to exercise `Unknown`. Keep the fixture changes inside `followup_crm_demo`; never add a production migration or mutate existing production source names.

- [ ] **Step 2: Add report assertions before and after the report call.**

  In `scripts/demo-smoke.js`, capture `SELECT COUNT(*)` for leads and follow-ups through a test-only database helper or compare the existing lead and follow-up API values before and after calling the report. Assert:

  - Call Center Manager and Admin receive the report.
  - Other roles receive 403.
  - `Referral` combines `Referral` and `Customer Referral`.
  - `TKM` combines `TKM Website` and any other TKM fixture.
  - `Unknown` is returned for a blank source.
  - `summary.leads` equals the sum of source rows.
  - Branch filtering returns only the requested branch.
  - `attention.conversion` is unavailable below 20 leads and volume/unknown/overdue omission rules are correct.
  - Lead and follow-up counts are unchanged after report and drill-down requests.

- [ ] **Step 3: Document the report.**

  Add a short README section covering all-time scope, source grouping, metrics, branch filter, attention strip, drill-downs, and the fact that opening or refreshing the report does not write CRM data.

- [ ] **Step 4: Run the complete verification suite.**

  ```powershell
  node --check server.js
  node --check public/app.js
  node --check scripts/demo-db.js
  node --check scripts/demo-smoke.js
  git diff --check
  npm run demo:reset
  npm run demo:seed
  node --env-file=.env.demo scripts/demo-smoke.js
  ```

  Expected: all commands exit 0, the smoke output reports source grouping and read-only checks as passed, and no production database connection is used.

- [ ] **Step 5: Commit fixtures and docs.**

  ```powershell
  git add scripts/demo-db.js scripts/demo-smoke.js README.md
  git commit -m "test: cover source quality report"
  ```

### Task 5: Audit and deploy

**Files:**
- Review: `server.js`, `public/app.js`, `public/style.css`, `scripts/demo-smoke.js`, `README.md`.

- [ ] **Step 1: Audit every consumer.**

  Confirm existing `/api/call-center/analytics`, exports, Sales Manager analytics, Admin analytics, AI lost summaries, role permissions, and existing metric drill-downs keep their original response and behavior. Confirm `LOST RNR` remains separate from ordinary lost reasons.

- [ ] **Step 2: Review the diff for data safety and latency.**

  Confirm the report endpoint contains only `SELECT`, the existing dashboard endpoint has no new report query, no source or lead update was added, and no unbounded lead payload is fetched for the report.

- [ ] **Step 3: Run the full verification commands again immediately before deployment.**

  ```powershell
  node --check server.js
  node --check public/app.js
  node --check scripts/demo-db.js
  node --check scripts/demo-smoke.js
  git diff --check
  git status --short
  ```

  Expected: syntax checks and diff check exit 0, and only intended files are changed.

- [ ] **Step 4: Push the verified commits.**

  ```powershell
  git push origin master
  ```

- [ ] **Step 5: Verify deployment.**

  Request the deployed landing page and `app.js`, confirm the deployed asset includes `sourceQualityView`, `source-quality`, `Referral`, and `TKM`, and confirm the working tree is clean. Do not use browser debugging.
