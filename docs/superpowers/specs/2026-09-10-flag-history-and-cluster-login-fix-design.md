# Cluster Login and Flag History Fix Design

**Goal:** Make the four fixed Cluster Manager credentials work in Render and keep flagged leads visible after a flag is closed, including Sales Officer-wise totals.

## Constraints

- The four passwords remain Render environment secrets and are not stored in source.
- Do not insert, update, delete, reassign, or backfill existing lead, follow-up, assignment, or flag rows.
- A new flag closure must retain a non-null history marker even when the manager leaves remarks blank.
- Existing branch and role authorization remains unchanged.
- Keep analytics to one existing flag query per response and group returned rows in memory.

## Design

Render receives `CLUSTER_MANAGER_PASSWORD_BIJU`, `CLUSTER_MANAGER_PASSWORD_PRAVEEN`, `CLUSTER_MANAGER_PASSWORD_VINOD`, and `CLUSTER_MANAGER_PASSWORD_NIRMAL` with the supplied values. The current env-backed seed logic remains the source of truth for account creation and password reconciliation.

Sales Manager analytics will return the existing active/resolved flag rows for the authenticated branch scope. Each row will expose a derived `flag_status`, and the same returned rows will be grouped by normalized Sales Officer for the Sales Officer-wise summary. Admin’s global flag list and the legacy manager drilldown will use the same active-or-historical predicate. No additional flag query is added to the analytics request.

The lead detail sheet will render both active and resolved flag records. Only active records show the close action. The close endpoint will save `''` instead of `NULL` for blank remarks, making future closures discoverable through the existing history predicate without rewriting old data.

## Verification

- Verify all four production logins return HTTP 200 and `/api/me` reports `cluster_manager`.
- Run Node syntax checks and static assertions for the active-or-history predicate, status fields, and role redaction.
- Verify git diff and confirm no lead/follow-up/assignment data mutation.

