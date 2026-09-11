# CEO Executive Overview Redesign

## Goal

Replace the current CEO overview with a calm, decision-first executive surface and remove operational CRM views that are not useful to the CEO.

## Audience and design read

This is an internal automotive executive dashboard for a CEO. The visual language should feel premium, precise, and boardroom-ready: cool white surfaces, deep ink typography, one restrained Toyota-red attention accent, thin dividers, generous whitespace, and minimal motion.

Design dials: variance 6, motion 3, density 4.

## Information architecture

CEO navigation contains only:

- Executive Overview
- Branch performance
- Sales performance

The CEO navigation must not expose Flagged Leads, Call Center, Source quality, Lead Analysis, or All leads. Existing report endpoints and server-side read-only access remain unchanged so approved drill-down links continue to work.

## Executive overview

The first screen answers “where should leadership look first?” in this order:

1. A compact summary strip with total leads, won, open, overdue, and conversion rate.
2. A ranked branch health list with no nested scroll container. Each visible row shows branch name, total volume, win rate, open work, and overdue count. Rows remain clickable and open branch analytics.
3. A focused attention rail with the three highest-overdue branches. Each item links to its read-only overdue lead report.
4. A compact conversion mix showing open, booked, retail, and lost outcomes without competing with the branch ranking.

The page must provide loading, empty, and retry states. It must remain readable on mobile by collapsing summary metrics into two columns and branch rows into single-column metric groups.

## Implementation boundaries

- Modify `public/app.js` for CEO navigation and the CEO overview renderer.
- Modify `public/style.css` for CEO-specific shell, overview, responsive, focus, and reduced-motion styles.
- Do not change API routes, database schema, CEO permissions, or other role navigation.
- Keep existing branch analytics and sales performance routes as CEO drill-down destinations.
- Preserve existing click behavior and authentication.

## Acceptance criteria

- CEO sees exactly three navigation destinations plus Sign out.
- Flagged Leads is absent from the CEO navigation and cannot be reached through a CEO-visible tab.
- No inner branch-list scrollbar is needed for the primary overview.
- Above-the-fold content establishes the summary and highest-priority branch workload.
- All labels and numbers have WCAG AA-readable contrast and keyboard focus states.
- `prefers-reduced-motion` disables nonessential transitions.
- Existing local demo smoke and CEO smoke still pass.
- `node --check public/app.js` and `git diff --check` pass.
