# Sales Manager status and flag routing design

## Goal

Give each Branch Sales Manager a fast, branch-scoped view of Sales Officer-wise lead status counts, with direct lead drilldowns, and make flagged leads a Sales Manager workflow rather than a Call Center Manager workflow.

## Decisions

- Status counts use the latest follow-up outcome for each lead. Leads with no follow-up are `Fresh`; legacy records without a usable outcome fall back to their stored stage or `Unknown`.
- The status table is branch-scoped, uses the existing analytics request, and paginates the officer rows locally at 10 per page. Counts are read-only links; each non-zero count opens the matching leads.
- Sales Manager drilldowns remain branch-enforced on the server, including for Admin branch views.
- Call Executives can still flag their assigned leads. Call Center Managers no longer receive flagged-lead data or flag-review controls; the branch Sales Manager and Admin retain review access.
- No lead, follow-up, assignment, or flag data is changed by this feature.

## Performance and verification

The initial Sales Manager page uses one analytics request. Pagination does not refetch data. Drilldowns are capped at 200 leads, match the same branch/status definition as the count query, and use existing lead-detail navigation. Verification covers SQL syntax, role-scoped API responses, client bundle checks, and live deployment smoke checks.
