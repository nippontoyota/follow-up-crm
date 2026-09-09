# Sales Manager status and flag routing Implementation Plan

**Goal:** Add a paginated, clickable Sales Officer-wise status table for Sales Managers and route flag review to the correct branch Sales Manager without mutating data.

**Architecture:** Extend the existing branch analytics response with latest-outcome aggregates, add one branch-enforced status drilldown endpoint, and remove Call Center Manager flag visibility at both API and UI layers. Keep Admin oversight and reuse the current table, sheet, pagination, and lead-detail patterns.

**Tech Stack:** Node.js, Express, PostgreSQL, vanilla JavaScript.

## Global Constraints

- Read-only analytics and drilldowns; no data migration or backfill.
- Sales Manager access is always restricted to the authenticated manager's branch.
- Initial Sales Manager analytics remains one request; pagination is client-side.
- Preserve existing lead flag creation and all non-flag Call Center analytics.

## Tasks

- [ ] Add latest-outcome status aggregates and branch-scoped status drilldowns.
- [ ] Add the Sales Manager status matrix, 10-row pagination, and clickable counts.
- [ ] Restrict flag review routing to Sales Managers/Admin and update navigation/KPIs.
- [ ] Verify static syntax, read-only role-scoped runtime behavior, UI bundle/version, and deployment.
