# Sales Officer Conversion Comparison

## Goal

Help a Branch Sales Manager identify which Sales Officers convert leads into meaningful outcomes, without mistaking raw lead volume for performance.

## Definitions

- **Outcome conversion**: `(Booking Done + Retail Done) / total leads`. This preserves the existing product definition of “won” while making the denominator visible.
- **Retail conversion**: `Retail Done / total leads`. This is the final-sale rate and is shown separately so bookings are not mistaken for completed sales.
- **Sample size**: the numerator and denominator are shown beside every rate. A one-lead result must not look equivalent to a high-volume result.
- Zero leads display `N/A`, never a fabricated percentage.

## User experience

The Branch Sales Manager view answers, in order:

1. What is the branch outcome and final-sale rate?
2. Which officers are producing outcomes at a reliable volume?
3. Which officers or lead queues need action?

The page will:

- default to Outcome conversion, descending;
- tie-break by outcome count, then total leads, then officer name;
- retain Total and Due sorting;
- show each officer’s outcome rate, `outcomes / leads`, final-sale rate, lead volume, overdue count, and a compact outcome composition bar;
- keep existing row and Due drill-down behavior;
- show a concise attention strip for overdue workload, high-volume zero-outcome officers, and high rates based on very small samples;
- keep branch context and cluster/admin scope unchanged.

## Performance and data safety

- Reuse the existing `/api/sales-manager/analytics` response.
- Derive display metrics in memory from copied officer view models; do not mutate API objects.
- Make no database, lead, API, or schema writes.
- Add no network request and no chart dependency.
- Keep filtering, sorting, and pagination client-side; render only the visible page.

## Accessibility

- Rates are text, not color-only signals.
- Bars have descriptive labels and are supplementary to the text metrics.
- Existing keyboard row navigation remains intact.
- Outcome colors retain sufficient text labels for color-blind users.

## Non-goals

- No changes to lead statuses or conversion definitions stored in the database.
- No reassignment, coaching workflow, or automated ranking action.
- No statistical scoring that hides the raw numerator/denominator.
