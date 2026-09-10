# Branch performance visualization

## Goal

Make the Call Center Manager's branch breakdown understandable at a glance. The current wide table exposes useful figures but does not show the shape of each branch or where its leads come from.

## Design

Replace the primary branch breakdown table with one ranked branch health board. Each branch row contains:

- branch name and a clear overdue-work status;
- a lead-volume bar;
- a reached bar sized against that branch's leads;
- a won bar sized against that branch's leads;
- a red overdue bar and count;
- clickable counts that open the existing matching-lead drill-down.

Order rows by overdue count first, then lead volume. Keep exact figures in a collapsed "Show detailed figures" section below the board. The detail view uses the same existing metrics and links, so no reporting capability is removed.

## Data and performance

Do not change the database, API, or source-quality definitions. Group and sort the already-loaded branch rows in the browser. Do not add requests, polling, writes, or chart dependencies. Bars must have text labels and accessible summaries; color must not carry meaning alone.

## States and accessibility

- Render an empty message when no branch data exists.
- Keep the existing loading and error states.
- Make all lead counts keyboard reachable and preserve their current drill-down targets.
- Give the source-mix bar an accessible summary and do not rely on color alone.
- Stack board metrics and keep the detail table horizontally scrollable on narrow screens.
- Preserve the current light blue and navy CRM visual language, using stronger spacing, type scale, and grouping for the board.
