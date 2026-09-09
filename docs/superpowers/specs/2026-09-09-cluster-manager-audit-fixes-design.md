# Cluster manager audit fixes

## Goal

Close the remaining cluster-manager audit gaps without changing existing leads, follow-ups, users, assignments, or branch records. Item 4 from the audit, keyboard and accessibility work, stays out of scope.

## Constraints

- Do not insert, update, or delete production data as part of application startup or this feature.
- Add `KT01B` as the canonical source mapping for `Nippon Toyota - Pala`, but do not create the missing database branch row automatically.
- Keep cluster-manager usernames, roles, and branch assignments application-owned and fixed.
- Read fixed-account passwords from environment variables. Fail clearly if a required password is missing instead of silently changing an account.
- Keep result sets bounded for the latency-critical application.
- Do not expose flag fields or flag actions to cluster managers.
- Do not implement keyboard handlers, focus management, or other item-4 accessibility changes.

## User-facing changes

1. Make the Pala mapping canonical in source data and show the exact missing branch state to Admin and the affected cluster manager. The app must not pretend the branch is available.
2. Add server-side pagination to Lead Analysis and officer aggregate drilldowns. Preserve the existing paginated officer-status drilldown.
3. Add manual refresh and a last-updated timestamp to cluster-manager analytics views. Add Retry actions for failed analytics and search requests.
4. Add a read-only, branch-scoped cluster-manager lead search by customer-name or mobile-number prefix. Return a small, bounded result set.
5. Improve the mobile status-analysis presentation while retaining the desktop table.
6. Remove the dark theme metadata because the app does not ship a dark theme.
7. Explain unavailable role routes instead of silently redirecting without context.
8. Keep fixed passwords out of tracked source files and document the required environment variables.

## Server design

- `cluster-manager.js` remains the single source for fixed usernames, display names, and configured branch names. Password values move to environment-variable keys.
- `demo-data/branch-codes.json` gains `KT01B` for Pala so future imports can resolve the code correctly.
- `loadClusterManagerScopes()` remains read-only. It resolves only existing rows and records missing configured names.
- The two currently capped drilldown endpoints accept `page` and `limit`, return `leads`, `page`, `limit`, `pages`, and `total`, and never load an unbounded result into memory.
- The new search endpoint enforces the authenticated user’s branch scope, uses a bounded prefix query, returns at most 50 rows, and excludes flag fields.
- Existing roles and non-cluster behavior remain unchanged.

## Client design

- Cluster-manager navigation gains a Search view.
- Analytics views show `Last updated` and a manual Refresh button. Refresh re-fetches the current view and does not start polling.
- Failed loads show a Retry button.
- Search uses explicit submit, not per-keystroke requests, to protect latency.
- The mobile status table keeps horizontal scrolling but improves the mobile summary by showing branch and officer context, clearer column labels, and a compact status selector where appropriate.
- The unavailable-route message explains which role can access the destination.
- No item-4 keyboard or focus behavior changes are included.

## Password and deployment behavior

Required variables:

- `CLUSTER_MANAGER_PASSWORD_BIJU`
- `CLUSTER_MANAGER_PASSWORD_PRAVEEN`
- `CLUSTER_MANAGER_PASSWORD_VINOD`
- `CLUSTER_MANAGER_PASSWORD_NIRMAL`

The local `.env` file can hold development values and remains ignored. `.env.example` documents the names without values. Production must define all four values before boot.

## Verification

- Run syntax checks for server and client files.
- Run the existing fixed-account smoke test with all four password variables present.
- Add assertions for Pala’s canonical code, no startup branch writes, paginated totals, search scope, no flag fields, and missing-secret failure.
- Run `git diff --check`.
- Inspect the deployed cluster-manager views for branch scope, refresh state, search, pagination, mobile behavior, and unavailable-route messaging.

## Explicit non-goals

- No automatic insertion of Pala or any other branch.
- No changes to leads, follow-ups, assignments, users, flags, or credentials stored in the database.
- No keyboard or modal accessibility improvements from audit item 4.
