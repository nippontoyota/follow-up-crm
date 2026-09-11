# CEO Executive Overview Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the CEO overview into a decision-first executive page and reduce CEO navigation to three useful read-only surfaces.

**Architecture:** Keep the current vanilla JavaScript single-page shell and existing reporting APIs. Make the CEO role use a dedicated navigation set and a dedicated overview renderer, while preserving existing analytics and sales-performance drill-down functions. Scope the visual changes to CEO classes and a CEO shell modifier so other roles are unaffected.

**Tech Stack:** Vanilla JavaScript modules in `public/app.js`, native CSS in `public/style.css`, existing server-rendered API responses, and the existing Node smoke scripts.

## Global Constraints

- CEO navigation contains exactly Executive Overview, Branch performance, and Sales performance, plus Sign out.
- Flagged Leads, Call Center, Source quality, Lead Analysis, and All leads are not CEO-visible navigation destinations.
- Do not change API routes, database schema, CEO permissions, or other role navigation.
- The CEO overview must have loading, empty, error/retry, keyboard focus, responsive, and reduced-motion states.
- Do not add frontend dependencies or a build step.
- Preserve existing branch and sales drill-down behavior.

---

### Task 1: Replace the CEO information architecture

**Files:**
- Modify: `public/app.js:256-264` for `TABS`
- Modify: `public/app.js:300-350` for CEO shell classes and route fallback

**Interfaces:**
- Consumes: existing `me.role`, `TABS`, `go()`, and `boot()` behavior.
- Produces: `TABS.ceo` with `executiveOverview`, `analytics`, and `salesPerf` only, plus a `ceo-shell` body class while a CEO is authenticated.

- [ ] **Step 1: Change the CEO tab definition**

Use the existing tab tuple shape and replace the current CEO list with:

```js
ceo: [
  ['executiveOverview', 'Executive Overview', '◈'],
  ['analytics', 'Branch performance', '▤'],
  ['salesPerf', 'Sales performance', '↗'],
],
```

- [ ] **Step 2: Add a CEO shell modifier during boot/navigation**

Toggle `document.body.classList.toggle('ceo-shell', me?.role === 'ceo')` in `boot()` or `go()` so the CSS can change only the CEO chrome. Keep `cc-mode` behavior unchanged for Call Center and Source quality.

- [ ] **Step 3: Keep invalid CEO hashes safe**

Use the existing allowed-tab fallback so a stale CEO hash such as `#flagged` routes to `#executiveOverview` and displays the existing unavailable-view notice only when appropriate.

- [ ] **Step 4: Run the static check**

Run:

```powershell
node --check public/app.js
```

Expected: exit code 0.

### Task 2: Rebuild the CEO overview renderer

**Files:**
- Modify: `public/app.js:3035-3140` for CEO overview helpers and `ceoOverviewView()`

**Interfaces:**
- Consumes: `/api/analytics`, `/api/call-center/analytics`, `/api/sales-manager/analytics`, `callCenterMetricClick()`, `analyticsView()`, `branchLabel()`, and `esc()`.
- Produces: CEO overview markup with summary metrics, ranked branch health, attention items, conversion mix, loading state, and retry state.

- [ ] **Step 1: Add data normalization helpers**

Normalize numeric values with `Math.max(0, Number(value) || 0)` and derive `wonRate`, `open`, `overdue`, and `followup` without allowing negative values or `NaN` to reach markup. Sort branch rows by overdue descending, then total descending, then branch name.

- [ ] **Step 2: Render the executive summary strip**

Render five linked or static metrics from existing response data:

```text
Total leads | Won | Open | Overdue | Conversion
```

Use the existing call-center summary and sales summary fields. Counts that have an existing metric drill-down remain buttons; zero values remain non-interactive text.

- [ ] **Step 3: Render branch health without an inner scroll area**

Render the sorted branch list in normal page flow. Each row must include the branch name and compact text metrics rather than a large filled track. Show all branches on the page, with a clear row-level click target to `analyticsView(branchId, branchName)`.

- [ ] **Step 4: Render the attention rail and conversion mix**

Show only the top three overdue branches in the attention rail. Use `callCenterMetricClick({ branch_id, bucket: 'overdue' }, ...)` for the link. Render the existing conversion categories as a compact segmented composition and a text legend.

- [ ] **Step 5: Add loading, empty, and retry states**

Use the existing `ceo-loading`, `ceo-empty`, `analyticsError`, and retry wiring patterns. A zero-data response must still render the shell and explain that no branch activity is available.

- [ ] **Step 6: Run static checks**

Run:

```powershell
node --check public/app.js
```

Expected: exit code 0.

### Task 3: Apply the new visual system and responsive states

**Files:**
- Modify: `public/style.css` in the CEO overview section and desktop/mobile shell overrides

**Interfaces:**
- Consumes: `.ceo-shell`, `.ceo-page`, `.ceo-summary`, `.ceo-branch-list`, `.ceo-attention`, `.ceo-mix`, and the existing navigation markup.
- Produces: premium light executive shell with deep ink type, one red attention accent, consistent radius scale, no nested branch scrollbar, keyboard states, and reduced-motion behavior.

- [ ] **Step 1: Define CEO shell tokens**

Use a CEO-specific background, ink, muted text, border, and attention-red palette. Do not change global variables used by other roles. Replace the CEO-specific blue bar treatment with text and divider hierarchy.

- [ ] **Step 2: Style the CEO desktop shell**

Give the CEO sidebar more breathing room and a restrained active state. Keep navigation to one line per item. Give the overview a wide reading column and avoid decorative grid backgrounds.

- [ ] **Step 3: Style summary metrics, branch rows, attention, and conversion**

Use one radius scale, sparse borders, and no repeated floating card shadows. Use red only for overdue/attention semantics. Make the branch rows visibly clickable with hover and focus states.

- [ ] **Step 4: Add explicit mobile and reduced-motion rules**

At widths below 768px, stack the content, use a two-column metric grid, and keep branch rows readable without horizontal overflow. Under `prefers-reduced-motion: reduce`, remove transforms and transitions.

- [ ] **Step 5: Run static diff validation**

Run:

```powershell
git diff --check
```

Expected: exit code 0 with no whitespace errors.

### Task 4: Verify locally and review the rendered CEO surface

**Files:**
- Test: existing `scripts/demo-smoke.js`
- Test: existing `scripts/ceo-smoke.js`

**Interfaces:**
- Consumes: local `.env.demo`, demo database, and CEO smoke environment variables.
- Produces: passing static and runtime verification for existing CRM behavior plus CEO read-only behavior.

- [ ] **Step 1: Start the local demo server**

Run:

```powershell
node --env-file=.env.demo server.js
```

Use the existing local demo server port and keep the process isolated from production.

- [ ] **Step 2: Run the existing demo smoke suite**

Run:

```powershell
node --env-file=.env.demo scripts/demo-smoke.js
```

Expected: the existing import, assignment, follow-up, analytics, source quality, and scope assertions pass.

- [ ] **Step 3: Run the CEO smoke suite**

Run with a temporary local CEO password and the demo base URL:

```powershell
$env:CEO_PASSWORD='<temporary-local-only-value>'
$env:BASE_URL='http://localhost:3000'
node scripts/ceo-smoke.js
```

Expected: identity, all-branch report reads, lead reads, and write denials pass.

- [ ] **Step 4: Inspect the page at desktop and mobile widths**

Verify that the CEO overview has no nested branch scrollbar, no Flagged Leads navigation item, visible summary metrics, readable attention items, and a clean single-column mobile collapse.

- [ ] **Step 5: Run final checks**

Run:

```powershell
node --check public/app.js
git diff --check
git status --short --branch
```

Expected: all checks pass and only the planned files are modified.
