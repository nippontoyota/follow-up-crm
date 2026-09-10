# Sales Officer Conversion Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Branch Sales Manager view rank and explain Sales Officer performance by conversion quality, not raw lead count.

**Architecture:** Keep the existing `/api/sales-manager/analytics` contract and derive a copied, display-only view model in `public/app.js`. Render a manager-first leaderboard: branch totals at the top, a short attention strip, then paginated officer cards with visible rates and denominators. Use existing click-through filters and one request per view.

**Tech Stack:** Vanilla browser JavaScript, existing HTML template strings, existing CSS variables, Express/Postgres API, Node smoke test.

## Global Constraints

- Outcome conversion is `(Booking Done + Retail Done) / total leads`.
- Retail conversion is `Retail Done / total leads` and is shown separately.
- Rates always show numerator and denominator; zero leads display `N/A`.
- Reuse the existing analytics response; add no network request, dependency, API, schema, or lead-data write.
- Derive metrics from copied objects; never mutate API response rows.
- Preserve branch scope, drill-down links, keyboard navigation, filtering, sorting, and pagination.

---

### Task 1: Add immutable Sales Officer display metrics

**Files:**
- Modify: `public/app.js:1603-1656`

**Interfaces:**
- Produces `salesOfficerMetric(row)`, returning a new object with normalized counts and `outcomes`, `outcomeRate`, and `retailRate`.
- Consumes the existing `d.bySalesOfficer` rows without changing them.

- [ ] **Step 1: Add a pure view-model helper beside the Sales Officer state.**

```js
function salesOfficerMetric(row) {
  const total = Number(row.total) || 0;
  const booked = Number(row.booked) || 0;
  const retailed = Number(row.retailed) || 0;
  return {
    ...row,
    total,
    booked,
    retailed,
    lost: Number(row.lost) || 0,
    due: Number(row.due) || 0,
    followup: Number(row.followup) || 0,
    outcomes: booked + retailed,
    outcomeRate: total ? (booked + retailed) / total : null,
    retailRate: total ? retailed / total : null,
  };
}
```

- [ ] **Step 2: Build the officer list from copied view models and add deterministic conversion sorting.**

```js
const officers = (d.bySalesOfficer || []).map(salesOfficerMetric);
const sorters = {
  conversion: (a, b) => (b.outcomeRate ?? -1) - (a.outcomeRate ?? -1)
    || b.outcomes - a.outcomes
    || b.total - a.total
    || a.sales_officer.localeCompare(b.sales_officer),
  total: (a, b) => b.total - a.total || a.sales_officer.localeCompare(b.sales_officer),
  due: (a, b) => b.due - a.due || b.total - a.total || a.sales_officer.localeCompare(b.sales_officer),
};
```

- [ ] **Step 3: Run syntax and whitespace checks.**

Run: `node --check public/app.js; git diff --check`

Expected: both commands succeed.

- [ ] **Step 4: Commit the display-model change.**

```bash
git add public/app.js
git commit -m "feat: derive sales officer conversion metrics"
```

### Task 2: Make the Branch Sales Manager view conversion-first

**Files:**
- Modify: `public/app.js:1603-1770`

**Interfaces:**
- Consumes `salesOfficerMetric` fields from Task 1.
- Produces the visible branch conversion summary, attention strip, and officer comparison cards.

- [ ] **Step 1: Default state to conversion sorting and add rate formatting helpers.**

```js
let salesPerfSort = 'conversion';
const rateText = rate => rate == null ? 'N/A' : `${(rate * 100).toFixed(1)}%`;
const wonText = (won, total) => total ? `${won} / ${total}` : '—';
```

- [ ] **Step 2: Add summary calculations without changing `d.summary`.**

```js
const totalLeads = Number(s.total) || 0;
const totalOutcomes = (Number(s.booked) || 0) + (Number(s.retailed) || 0);
const overallOutcomeRate = totalLeads ? totalOutcomes / totalLeads : null;
const overallRetailRate = totalLeads ? (Number(s.retailed) || 0) / totalLeads : null;
```

- [ ] **Step 3: Add the action strip with only actionable, explainable rules.**

Use these rows, in this order:

```js
const overdueCount = officers.reduce((sum, o) => sum + o.due, 0);
const highVolumeNoOutcome = officers.filter(o => o.total >= 10 && o.outcomes === 0).length;
const smallSampleWinners = officers.filter(o => o.total > 0 && o.total < 5 && o.outcomes > 0).length;
```

Render a single compact sentence with count-backed labels, omitting zero-count items, and show `No immediate pattern` when all three are zero. Do not call an officer “bad” or “best”; the strip describes work to inspect.

- [ ] **Step 4: Replace the officer row markup with a readable conversion-first card.**

Each row must include:

```html
<div class="sop-conversion-line">
  <span class="sop-conversion-label">Outcome conversion</span>
  <strong>${rateText(o.outcomeRate)}</strong>
  <span>${wonText(o.outcomes, o.total)} outcomes</span>
</div>
<div class="sop-conversion-track" role="img"
  aria-label="${esc(rateText(o.outcomeRate))} outcome conversion for ${esc(o.sales_officer)}">
  <span style="width:${Math.min(100, Math.max(0, (o.outcomeRate || 0) * 100))}%"></span>
</div>
<div class="sop-row-detail">
  <span>${rateText(o.retailRate)} retail · ${o.retailed} final sale${o.retailed === 1 ? '' : 's'}</span>
  <span>${o.total} lead${o.total === 1 ? '' : 's'}</span>
  <button type="button" class="sop-pill sop-pill-brand" data-officer="${esc(o.sales_officer)}" data-bucket="due">${o.due} due</button>
</div>
```

Keep the entire row clickable, preserve the branch label for cluster/admin views, and retain the existing booked/retail/lost counts as text so the bar is never the only signal.

- [ ] **Step 5: Update copy and controls.**

Add the helper sentence `Outcome conversion = booked + retail divided by total leads. Retail conversion is final-sale rate.` above the cards. Add `Conversion` as the first active sort control, followed by `Total` and `Due`. Add an `Overall conversion` KPI and an `Overall retail rate` KPI using the copied summary calculations.

- [ ] **Step 6: Run syntax checks and inspect the diff.**

Run: `node --check public/app.js; git diff --check; git diff -- public/app.js`

Expected: no syntax/whitespace errors; only the conversion view changes are present.

- [ ] **Step 7: Commit the behavior change.**

```bash
git add public/app.js
git commit -m "feat: make sales officer comparison conversion-first"
```

### Task 3: Add compact, high-signal visual styling

**Files:**
- Modify: `public/style.css:771-827`

**Interfaces:**
- Styles the new conversion line, bar, action strip, and details while preserving existing responsive behavior and CSS variables.

- [ ] **Step 1: Add a strong conversion hierarchy.**

Use the existing palette and add styles for `.sop-attention`, `.sop-attention-item`, `.sop-conversion-line`, `.sop-conversion-line strong`, `.sop-conversion-track`, `.sop-conversion-track span`, and `.sop-row-detail`. The rate must be the largest value in each officer card; the numerator/denominator must remain adjacent to it.

- [ ] **Step 2: Keep the bar semantic and readable.**

Use one neutral track and one brand fill. Do not encode the ranking through color alone. Keep outcome text visible and let `N/A` render with a zero-width bar.

- [ ] **Step 3: Add mobile wrapping rules.**

At the existing mobile breakpoint, allow the conversion line and details to wrap, keep the rate readable, and keep the Due button tappable. Do not introduce horizontal scrolling.

- [ ] **Step 4: Run whitespace and detector checks.**

Run: `git diff --check; node C:\Users\krish\.agents\skills\impeccable\scripts\detect.mjs --json public/app.js public/style.css`

Expected: no whitespace errors. Review detector output for newly introduced issues only; existing unrelated warnings do not block this feature.

- [ ] **Step 5: Commit the visual change.**

```bash
git add public/style.css
git commit -m "style: clarify sales officer conversion cards"
```

### Task 4: Verify API invariants, no mutation, and regression safety

**Files:**
- Modify: `scripts/demo-smoke.js:86-94`

**Interfaces:**
- Consumes existing `/api/sales-manager/analytics` data.
- Produces smoke assertions that support the conversion view’s denominator and scope assumptions.

- [ ] **Step 1: Assert officer outcome counts are valid.**

Add assertions that every Sales Officer row has numeric non-negative `total`, `booked`, `retailed`, and `due` values, and that `booked + retailed <= total`. This verifies the client’s rate cannot exceed 100% for valid API data.

- [ ] **Step 2: Run the full demo smoke test against a clean demo database.**

Run:

```powershell
npm run demo:reset
npm run demo:seed
npm run demo:smoke
```

Expected: smoke test exits 0, including the existing before/after lead and follow-up counts. That count check is the authoritative no-mutation evidence.

- [ ] **Step 3: Run final static verification.**

Run:

```powershell
node --check server.js
node --check public/app.js
node --check scripts/demo-smoke.js
git diff --check
git status --short
```

Expected: all checks succeed and the worktree is clean after committing.

- [ ] **Step 4: Commit the verification assertions.**

```bash
git add scripts/demo-smoke.js
git commit -m "test: verify sales officer conversion inputs"
```

### Task 5: Completion audit

- [ ] **Step 1: Confirm changed files are limited to the spec, plan, UI, styles, and smoke assertions.**
- [ ] **Step 2: Confirm no deployment or browser-control action was taken.**
- [ ] **Step 3: Confirm all global constraints from this plan have direct evidence in code or test output.**
- [ ] **Step 4: Mark the goal complete only after all verification commands pass.**
