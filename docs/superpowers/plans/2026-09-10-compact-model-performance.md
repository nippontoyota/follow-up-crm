# Compact Model Performance Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only the “Which models are selling?” section with a compact, high-contrast, visual-first model board.

**Architecture:** Keep the current analytics response, `salesModelMetric` normalization, and `sortedModels` ordering. Replace the model panel’s card-per-model HTML with a dense three-zone row: model identity, segmented outcome bar plus metadata, and final retail sales. Use the incumbent light-blue/white CRM surfaces with larger chunky typography and responsive grid styles that fit inside the current page width.

**Tech Stack:** Vanilla JavaScript template rendering, existing CSS custom properties, semantic HTML, CSS grid/flex, Express static frontend.

## Global Constraints

- Change only the existing model-performance section; preserve the rest of the Sales Officer Performance screen.
- Do not change analytics endpoints, backend aggregation, role scope, or model ordering.
- Preserve `Small sample` and `Unknown model` behavior.
- Outcome colors must be paired with visible text/counts for non-color access.
- Match the incumbent light-blue/white page surfaces and navy heading typography; do not use a dark visualization frame.
- Do not introduce page-level horizontal overflow or required motion.

---

### Task 1: Replace model section markup with compact three-zone rows

**Files:**
- Modify: `public/app.js:1697-1711`

**Interfaces:**
- Consumes: `models`, `sortedModels`, `salesPerfRateText`, `salesPerfWonText`, `esc`.
- Produces: `.sop-model-panel` markup with `.sop-model-row`, `.sop-model-identity`, `.sop-model-funnel`, `.sop-model-outcomes`, and `.sop-model-sales` hooks for CSS and accessibility.

- [ ] **Step 1: Replace the current model card template**

Keep the surrounding `models.length ? ... : ''` conditional and heading. Replace the current `.sop-model-grid` mapping with this structure:

```js
<div class="sop-model-grid">
  ${sortedModels.map((m, index) => {
    const modelOpen = Math.max(0, m.total - m.outcomes - m.lost);
    const modelName = m.model || 'Unknown model';
    const rateText = salesPerfRateText(m.outcomeRate);
    const aria = `${modelName}: ${m.total} leads, ${modelOpen} open, ${m.booked} booked, ${m.retailed} retail, ${m.lost} lost, ${rateText} converted`;
    return `<article class="sop-model-row ${m.retailed ? 'has-sale' : 'no-sale'}">
      <div class="sop-model-identity">
        <span class="sop-model-rank" aria-hidden="true">${index + 1}</span>
        <div class="sop-model-name"><h3>${esc(modelName)}</h3><span>${m.total} lead${m.total === 1 ? '' : 's'}</span>${m.total > 0 && m.total < 5 ? '<small class="sop-sample-tag">Small sample</small>' : ''}</div>
      </div>
      <div class="sop-model-funnel">
        <div class="sop-model-outcome-bar" role="img" aria-label="${esc(aria)}">
          <span class="sop-model-segment open" style="flex:${modelOpen}" aria-hidden="true"></span>
          <span class="sop-model-segment booked" style="flex:${m.booked}" aria-hidden="true"></span>
          <span class="sop-model-segment retail" style="flex:${m.retailed}" aria-hidden="true"></span>
          <span class="sop-model-segment lost" style="flex:${m.lost}" aria-hidden="true"></span>
        </div>
        <div class="sop-model-outcome-meta" aria-hidden="true">
          <span><b>${modelOpen}</b> open · <b>${m.booked}</b> booked · <b>${m.lost}</b> lost</span>
          <strong>${rateText} converted</strong>
        </div>
      </div>
      <div class="sop-model-sales ${m.retailed ? 'has-sale' : 'no-sale'}"><strong>${m.retailed}</strong><span>retail</span></div>
    </article>`;
  }).join('')}
</div>
```

- [ ] **Step 2: Confirm data semantics in the template**

Use `modelOpen = Math.max(0, m.total - m.outcomes - m.lost)` exactly as the existing view. Treat `m.outcomes` as converted count and `m.retailed` as final retail sales. Do not recalculate or reorder the model array inside the template.

- [ ] **Step 3: Run a syntax check**

Run: `node --check public/app.js`

Expected: exits 0 with no syntax errors.

### Task 2: Style the compact, colorful model board responsively

**Files:**
- Modify: `public/style.css:768-830`

**Interfaces:**
- Consumes: the class hooks from Task 1 and existing `--text`, `--muted`, `--brand-dark`, `--line`, `--ok`, `--bad` tokens.
- Produces: a capped, high-contrast model panel with readable desktop/tablet/narrow layouts and no page-level horizontal overflow.

- [ ] **Step 1: Replace the existing model-card rules**

Keep `.sop-model-panel`, `.sop-model-head`, `.sop-model-count`, and `.sop-model-grid` naming where useful, but replace card-specific rules with:

```css
.sop-model-panel { padding: 16px 18px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.sop-model-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:10px; }
.sop-model-head h2 { margin:0 0 3px; }
.sop-model-head p { margin:0; color:var(--muted); font-size:12px; line-height:1.4; }
.sop-model-count { flex:0 0 auto; color:var(--muted); font-size:11px; font-weight:700; }
.sop-model-grid { display:flex; flex-direction:column; gap:5px; max-width:900px; margin:0 auto; padding:12px; border-radius:14px; background:#10233B; }
.sop-model-row { display:grid; grid-template-columns:minmax(130px,.9fr) minmax(180px,1.7fr) 42px; gap:12px; align-items:center; padding:7px 9px; border-radius:9px; background:#F8FBFF; color:var(--text); }
.sop-model-identity { display:flex; align-items:center; gap:7px; min-width:0; }
.sop-model-name { min-width:0; }
.sop-model-name h3 { margin:0; overflow:hidden; color:var(--text); font-size:11px; line-height:1.15; text-overflow:ellipsis; white-space:nowrap; }
.sop-model-name > span { color:#667D96; font-size:8px; }
.sop-model-name .sop-sample-tag { display:inline-flex; margin-left:5px; padding:1px 4px; font-size:8px; }
.sop-model-rank { display:inline-flex; align-items:center; justify-content:center; width:19px; height:19px; border-radius:5px; background:#DCE8F6; color:#173B60; font-size:8px; font-weight:900; }
.sop-model-funnel { min-width:0; }
.sop-model-outcome-bar { display:flex; height:16px; overflow:hidden; border-radius:99px; background:#E1E9F2; box-shadow:inset 0 0 0 1px rgba(16,42,70,.08); }
.sop-model-segment { display:block; min-width:2px; }
.sop-model-segment.open { background:#F2A900; }.sop-model-segment.booked { background:#5AA9E6; }.sop-model-segment.retail { background:#16B57B; }.sop-model-segment.lost { background:#EC6478; }
.sop-model-outcome-meta { display:flex; justify-content:space-between; gap:8px; margin-top:3px; color:#647992; font-size:8px; }
.sop-model-outcome-meta strong { color:#173B60; }
.sop-model-sales { text-align:center; color:#087D54; }.sop-model-sales strong { display:block; font-size:15px; line-height:1; }.sop-model-sales span { display:block; color:#6F849A; font-size:8px; }
.sop-model-row.no-sale .sop-model-sales { color:var(--bad); }
```

- [ ] **Step 2: Add visible legend text below the rows**

Render or style a compact legend in the model panel using the same four semantic colors and labels: Open, Booked, Retail, Lost. The legend is required because the segmented bars also use color.

- [ ] **Step 3: Add narrow-screen rules**

At `max-width: 599px`, reduce panel/grid padding, use `grid-template-columns: minmax(96px,.85fr) minmax(120px,1.4fr) 34px`, reduce the gap to 8px, and allow `.sop-model-outcome-meta` to wrap. Keep row height compact and do not create a second card layout.

- [ ] **Step 4: Run stylesheet checks**

Run: `rg -n "sop-model-card|sop-model-main|sop-model-status|sop-model-bar" public/style.css public/app.js`

Expected: no old model-card selectors remain in the model section implementation.

### Task 3: Verify the rendered view and regression surface

**Files:**
- Modify: none
- Test: existing browser/server smoke checks plus manual viewport inspection

**Interfaces:**
- Consumes: completed model panel from Tasks 1–2.
- Produces: evidence that the section renders with unchanged model data and no layout overflow.

- [ ] **Step 1: Run available project checks**

Run: `npm run demo:smoke`

Expected: command exits 0. If the demo environment is unavailable, record the exact failure and continue with the local server check.

- [ ] **Step 2: Start the app and open the Sales Officer Performance route**

Run: `npm run demo` with the repository’s demo environment available, then inspect the branch-scoped `salesPerf` route using the existing demo credentials/data.

- [ ] **Step 3: Check desktop and narrow viewport behavior**

Confirm all of the following:

```text
desktop:  rows stay within the content panel; bars and retail values align
narrow:   no horizontal page scroll; model names remain readable; metadata wraps
data:     names, rank order, lead totals, outcome counts, conversion rates, retail totals match the API
semantic: outcome bar has an accessible label; legend text is visible
regression: branch switcher, refresh, officer board, and flagged table still render
```

- [ ] **Step 4: Run final diff and status checks**

Run: `git diff --check; git status --short`

Expected: no whitespace errors, and only the intended frontend files plus the implementation plan are changed.
