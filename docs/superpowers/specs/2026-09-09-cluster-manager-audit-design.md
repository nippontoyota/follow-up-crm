# Cluster Manager Audit Fixes

## Goal

Make the fixed cluster-manager experience accurate and understandable without changing lead data, creating new roles, or weakening the latency-sensitive branch-scope enforcement.

## Approved behavior

- Cluster managers can view only Sales Officers and Lead Analysis for their hardcoded branches.
- Cluster managers do not see flagged leads, flag counts, flag history, flag detail, or flag-closing controls.
- Sales Managers and Admins retain the existing flag workflow.
- The UI shows the actual assigned branches for the signed-in cluster manager.
- Multi-branch summaries and lead lists include branch context so users can interpret aggregated numbers safely.
- Missing configured branches are visible to Admins and do not silently appear as a complete scope.
- Large drilldowns remain bounded for latency, but the UI discloses the limit and supports requesting subsequent pages where practical.
- Accessibility and mobile changes stay incremental and preserve the existing vanilla frontend.

## Design

The server will expose a small cluster-scope summary derived from the existing hardcoded definitions and startup branch lookup. Analytics endpoints will omit flag results for cluster managers and will return branch metadata for cluster responses. The frontend will derive the visible role tabs from the role’s actual permissions, render an “Assigned branches” scope summary, and add branch columns or labels to cluster-manager tables and drilldowns.

The fixed account definitions remain hardcoded. Passwords and role behavior are not changed in this pass. No database writes or lead mutations are part of the implementation.

## Verification

- Regression tests prove cluster managers have no Flagged Leads tab, cannot fetch flag analytics, cannot fetch flagged lead lists, and cannot close a flag.
- Existing branch-scope tests continue to prove client branch overrides are ignored.
- `node --check`, `git diff --check`, and the cluster smoke test pass.
- The deployed Biju account is checked manually for scope display, two allowed tabs, no flag tab, and working branch-aware drilldowns.
