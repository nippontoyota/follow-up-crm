# Call Center Manager source quality report

## Goal

Give Call Center Managers a read-only, all-time view of which lead sources produce reachable leads, sales outcomes, and follow-up workload, without changing any stored source, lead, or follow-up data.

## Scope

The report is available from the Call Center Manager view and Admin view. It loads only when opened, so the existing Call Center dashboard request and first-paint latency do not change.

The default scope is all leads assigned to Call Executives, matching the existing Call Center dashboard. It includes open and closed leads and uses lead creation date only as the report's all-time population definition. A branch selector narrows the same report without changing the stored records.

The report includes:

- Source-group quality table.
- All-branches default with optional branch filtering and compact branch breakdown.
- Read-only lead drill-downs from count cells.
- A short "What needs attention" strip.
- Raw source names associated with each grouped source for auditability.

No date picker, opaque quality score, new write operation, background summary table, or change to existing dashboard response is in scope.

## Source grouping

Grouping happens at query time only. The SQL expression is case-insensitive and matches anywhere in the source name:

1. Names containing `referral` map to `Referral`.
2. Names containing `tkm` map to `TKM`.
3. Blank or missing names map to `Unknown`.
4. All other names keep their current display value.

The report API returns the raw source names found in each group. The source table never updates `sources` or `leads.source_id`.

## Report metrics

All counts are distinct leads, not calls.

| Metric | Definition |
| --- | --- |
| Leads | All scoped leads in the source group. |
| Attempted | Scoped leads with at least one follow-up. |
| Connected | Scoped leads with at least one follow-up whose call status is `Connected`. |
| Contact rate | `Connected / Leads`. |
| Open follow-up | Leads with `status = 'open'` and at least one follow-up. |
| Booked | Leads whose current stage is `Booking Done` and status is closed. |
| Retailed | Leads whose current stage is `Retail Done` and status is closed. |
| Won rate | `(Booked + Retailed) / Leads`. |
| Lost | Leads whose current stage is `Lost Lead` and status is closed. |
| LOST RNR | Leads with a `LOST RNR` follow-up outcome. |
| Average follow-ups | Average `fcount` across scoped leads. |

`Booked` and `Retailed` use the current lead stage, so a lead is counted once. `LOST RNR` remains separate from ordinary lost reasons. Rates show `N/A` when their denominator is zero.

The response includes an all-source summary and source-group rows. The branch breakdown uses the same metrics and scope, grouped by branch and source group.

## What needs attention

The strip is deterministic and read-only. It contains four short items:

- Highest-volume source group, with lead count.
- Best converting source group, based on won rate, only among groups with at least 20 leads. The strip shows the sample size.
- Source group with the most overdue open follow-up leads, with count.
- Unknown-source lead count, when non-zero.

If no source group meets the 20-lead threshold, the best-converting item says that there is not enough data. If there are no overdue leads or no unknown-source leads, those items are omitted. The strip never makes recommendations by writing flags or changing assignment.

## API and data flow

Add a new authenticated GET endpoint:

`GET /api/call-center/source-quality`

Access is limited to `call_center_manager` and `admin`. Admin may pass `branch_id`; the Call Center Manager may pass a valid branch ID. Invalid branch IDs return a client error. Without a branch parameter, the endpoint reports all branches.

The endpoint performs one read-only SQL request using a scoped leads CTE and a latest-follow-up CTE. The query joins `sources`, `branches`, and `followups`, aggregates by source group and branch, and returns JSON. It must not call any `INSERT`, `UPDATE`, `DELETE`, or transaction that writes data.

Lead drill-downs reuse the existing manager lead-list route with a new validated `source_group` filter and optional `branch_id`. The filter uses the same grouping expression as the report, so grouped counts and opened leads cannot disagree.

## UI

Add a `Source quality` entry beside the Call Center Manager's existing dashboard entry. Opening it performs the one report request and shows a loading state, error retry, refresh control, branch selector, attention strip, summary row, source table, and branch breakdown. The existing Call Center dashboard remains unchanged apart from the new navigation entry.

Count cells are keyboard-reachable buttons and open existing lead sheets. The report remains usable on narrow screens through the existing table overflow behavior. No client-side mutation is performed while rendering or filtering.

## Latency and safety constraints

- Do not add the report query to `/api/call-center/analytics`.
- Do not add a report cache table or trigger.
- Keep the first report request to one HTTP request and one database read query.
- Use fixed SQL fragments for source grouping and metric filters. Never interpolate user-provided values into SQL.
- Preserve the existing source IDs, lead rows, follow-up rows, assignments, and statuses.
- Reuse existing indexes where possible. Add only a targeted read index if query planning against the real dataset proves it is needed.
- Do not fetch every lead to the browser to calculate metrics.

## Error handling

The endpoint returns the existing JSON error format. The UI preserves the current analytics loading and retry patterns. A missing source is reported as `Unknown`, and an empty scoped dataset renders an explicit empty state rather than failing.

## Verification

Automated verification must cover:

- Case-insensitive `Referral` and `TKM` grouping.
- Unknown source handling.
- Distinct-lead metrics and rate denominators.
- Branch filtering.
- Attention-strip thresholds and omission rules.
- Read-only behavior, including an assertion that report calls do not change lead or follow-up counts.
- Authorization for Call Center Managers and Admins.
- Existing dashboard and lead drill-down behavior.

Run syntax checks, `git diff --check`, the static audit, and the isolated demo API smoke test before deployment. Verify the deployed asset and endpoint after the commit is pushed.
