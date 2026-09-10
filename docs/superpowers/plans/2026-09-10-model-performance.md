# Branch Model Performance Implementation Plan

**Goal:** Show a Branch Sales Manager which vehicle models are producing the strongest sales outcomes in the branch.

**Architecture:** Extend the existing `/api/sales-manager/analytics` response with a concurrent, read-only model aggregate using the current branch scope. Render a simple model-performance board above the Sales Officer board, using retail sales as the primary business result and conversion counts/rates as supporting context.

**Tech Stack:** Express, PostgreSQL, vanilla JavaScript, existing CRM CSS, GitHub-to-Render deployment.

## Global Constraints

- Keep the page latency-critical: one browser request and concurrent database aggregates.
- Do not mutate lead rows, model rows, or API response objects while rendering.
- Preserve existing branch permissions, refresh behavior, officer pagination, and lead drilldowns.
- Use plain language, chunky numbers, and saturated status colors that a regular person can scan.
- Treat `Retail Done` as final sales; treat `Booking Done` plus `Retail Done` as converted leads.
- Mark unknown models and small samples clearly; never present a tiny 100% rate as definitive.

---

### Task 1: Add the read-only model aggregate

**Files:**
- Modify: `server.js:1420-1490`
- Test: `scripts/demo-smoke.js` assertions for `/api/sales-manager/analytics`

**Interfaces:**
- Consumes: existing `managerBranchIds(req)`, `branchFilter()`, `today()`, and `models` table.
- Produces: `response.byModel`, rows with `model`, `total`, `followup`, `booked`, `retailed`, `lost`, and `due`.

- [ ] Add a third `Promise.all` query grouped by `COALESCE(NULLIF(TRIM(m.name), ''), 'Unknown model')`.
- [ ] Order deterministically by `retailed DESC`, converted count descending, total descending, and model name.
- [ ] Add a smoke assertion that every model row has nonnegative numeric counts and `booked + retailed <= total`.
- [ ] Run the isolated demo smoke test and confirm no write-count changes.

### Task 2: Render the model performance board

**Files:**
- Modify: `public/app.js:1620-1830`
- Modify: `public/style.css:780-920`

**Interfaces:**
- Consumes: `d.byModel` from Task 1.
- Produces: a read-only `sop-models` section with plain-language model cards.

- [ ] Copy model rows into display metrics before sorting or formatting.
- [ ] Render the section above officer comparison with the heading `Which models are selling?`.
- [ ] Make each card show model name, final sales, converted leads with denominator, total leads, and colored Open / Booked / Retail / Lost blocks.
- [ ] Sort by final retail sales first, then converted leads, then lead volume; show `Small sample` for fewer than five leads and `Unknown model` for missing model names.
- [ ] Keep the card layout responsive without adding another API request or changing lead data.

### Task 3: Verify, commit, and deploy

**Files:**
- Modify: `public/index.html` only if the asset version must change.

- [ ] Run `node --check public/app.js`, `node --check scripts/demo-smoke.js`, `git diff --check`, the Impeccable detector, and the read-only metric test.
- [ ] Run `node --env-file=.env.demo scripts/demo-smoke.js` against the local demo server.
- [ ] Commit the validated source and plan, push `master`, and confirm the live bundle contains the model board marker.
