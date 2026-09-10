# Branch performance visualization

## Goal

Make the Call Center Manager's branch breakdown understandable at a glance. The current wide table exposes useful figures but does not show the shape of each branch or where its leads come from.

## Design

Replace the primary branch breakdown table with a responsive grid of branch cards. Each card contains:

- branch name, total leads, and overdue count in the header;
- large summary figures for lead volume, reach rate, won rate, and overdue work;
- a proportional source-mix bar using the existing grouped source data;
- a compact source legend with grouped source names and lead counts;
- one derived "Start with" action line pointing to the branch/source combination with the most overdue work, when available;
- clickable counts that open the existing matching-lead drill-down.

Keep exact figures in a collapsed "Show detailed figures" section below the cards. The detail view uses the same existing metrics and links, so no reporting capability is removed.

## Data and performance

Do not change the database, API, or source-quality definitions. Group the already-loaded branch rows in the browser. Do not add requests, polling, writes, or chart dependencies. Source colors remain consistent within the section and the mix bar has a text legend for accessibility.

## States and accessibility

- Render an empty message when no branch data exists.
- Keep the existing loading and error states.
- Make all lead counts keyboard reachable and preserve their current drill-down targets.
- Give the source-mix bar an accessible summary and do not rely on color alone.
- Stack cards and keep the detail table horizontally scrollable on narrow screens.
- Preserve the current light blue and navy CRM visual language, using stronger spacing, type scale, and grouping for the cards.
