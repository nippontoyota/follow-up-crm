# Search cursor and rerender fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep lead search responsive without replacing the input or resetting the cursor after each debounced query.

**Architecture:** Keep the existing search input mounted after the first render. Split `leadsView()` into a stable shell and a results renderer, and update only the KPI, pager, and lead-list region when a query changes. Continue using the existing 300 ms debounce and `AbortController` so stale responses cannot replace newer results.

**Tech Stack:** Vanilla JavaScript, existing `/api/leads` and `/api/leads/stats` endpoints, Node syntax checks.

## Global Constraints

- Do not change API routes or database behavior.
- Do not add polling or extra requests per keystroke.
- Preserve the existing 300 ms debounce, pagination, search fields, and lead-opening behavior.
- Abort stale lead-list and stats requests when a newer render starts.
- Do not mutate leads, follow-ups, assignments, or any other data while searching.

---

### Task 1: Make lead search update results without replacing the input

**Files:**
- Modify: `public/app.js:1938-2045`
- Test: `public/app.js` via Node syntax check and static behavior assertions in the shell

**Interfaces:**
- Consumes: Existing `leadsView()`, `api()`, `leadsQ`, `leadsPage`, `leadsGen`, `leadsCtrl`, and `leadsStatsCache`.
- Produces: A stable `#leadSearch` input and a results container that can be refreshed without replacing the input element.

- [ ] **Step 1: Capture the current search behavior and boundaries**

Run:

```powershell
rg -n "async function leadsView|leadSearch|leadsCtrl|leadsGen|leadsStatsCache" public/app.js
```

Expected: The current input handler calls `leadsView()` after updating `leadsQ`, and `leadsView()` replaces `view.innerHTML`.

- [ ] **Step 2: Refactor the view into stable shell and refreshable results**

Keep the search input, bulk-upload control, and a single `#leadResults` container in the stable shell. Move KPI, pager, empty state, and lead cards into `#leadResults`. On query changes, update only `#leadResults` and rebind its pager and lead-card handlers.

Preserve the current query behavior:

```js
clearTimeout(searchTimer);
searchTimer = setTimeout(() => {
  const q = sInput.value.trim();
  if (q === leadsQ) return;
  leadsQ = q;
  leadsPage = 1;
  leadsView({ preserveShell: true });
}, 300);
```

The refresh path must not call `view.innerHTML = ...` for the whole page and must not call `focus()` on the input after a query update.

- [ ] **Step 3: Keep stale responses from painting newer searches**

Reuse the existing generation counter and `AbortController`. A response may update `#leadResults` only when its generation still matches the latest render and the results container still belongs to the current view.

- [ ] **Step 4: Run syntax and static verification**

Run:

```powershell
node --check public/app.js
rg -n "view\.innerHTML|leadResults|preserveShell|searchTimer|leadsCtrl\.abort" public/app.js
git diff --check
```

Expected: JavaScript syntax succeeds, the search refresh path targets `#leadResults`, stale requests remain abortable, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Commit the focused change**

```powershell
git add public/app.js docs/superpowers/plans/2026-09-10-search-cursor-fix.md
git commit -m "fix: keep lead search cursor stable"
```

