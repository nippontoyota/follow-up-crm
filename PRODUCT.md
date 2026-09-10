# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Call Center Managers use the CRM during the workday to monitor assigned lead workload, find leads by follow-up count, review executive performance, and open lead records.

## Product Purpose

The CRM gives Nippon Toyota teams one place to manage imported leads, log follow-ups, route work, and review branch performance. The Call Center Manager needs to identify the next queue to work without scanning several competing panels.

## Positioning

The CRM combines lead assignment, follow-up history, call outcomes, and branch-aware management views in one role-based workflow.

## Operating Context

The Call Center Manager dashboard is used repeatedly during the day on desktop and mobile-sized screens. Counts are live analytics, and clicking a count opens the matching lead list. The dashboard must remain quick to load and must not write lead data while it is being viewed.

## Capabilities and Constraints

- The Call Center Manager has one primary Call Center view.
- Existing analytics endpoints and lead drill-down routes must remain unchanged.
- Follow-up counts represent open leads grouped by current follow-up count. F6+ means six or more follow-ups.
- Existing export, refresh, error, loading, and lead-opening behavior must continue to work.
- Flag history remains available only to the roles already allowed to see it.

## Brand Commitments

The product is Nippon Toyota's internal CRM. The existing light blue and navy identity remains recognizable on this screen. Visible copy should stay plain, operational, and free of decorative claims.

## Evidence on Hand

The current Call Center Manager view is implemented in `public/app.js` and `public/style.css`. The supplied screenshot shows a light page with a left navigation rail, saturated KPI tiles, and a follow-up summary card.

## Product Principles

- Show the next useful decision first.
- Keep counts tied to a clear action.
- Preserve role boundaries and existing data.
- Prefer fast, readable controls over decoration.

## Accessibility & Inclusion

Interactive counts must be keyboard reachable and visibly focused. Text and controls must keep readable contrast on desktop and narrow screens. Reduced-motion users must receive the same information without movement.
