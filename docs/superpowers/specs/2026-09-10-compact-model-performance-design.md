# Compact model performance visualization

## Goal

Replace only the existing “Which models are selling?” section on the Sales Officer Performance view with a compact, visual-first model board. Preserve the existing analytics payload, model ordering, branch scope, refresh behavior, and all other content on the page.

## Scope

In scope:

- Rebuild the model section markup and styling in `public/app.js` and `public/style.css`.
- Keep the existing model metrics and deterministic sort order: final retail sales, converted outcomes, total leads, then model name.
- Represent each model in a dense row with three visual zones:
  1. model rank, model name, and lead volume;
  2. a segmented outcome bar for open, booked, retail, and lost leads, with conversion rate in the bar metadata;
  3. final retail sales as the strongest right-edge result.
- Use high-contrast semantic colors: amber for open, blue for booked, green for retail, and coral/red for lost.
- Keep “Small sample” visible for models with fewer than five leads and “Unknown model” for missing names.
- Make the board fit comfortably inside the existing page width and remain readable on narrow screens.

Out of scope:

- Changing API endpoints, backend aggregation, or model definitions.
- Replacing the Sales Officer Performance board, KPI strip, controls, branch switcher, or flagged lead table.
- Adding new model interactions or navigation behavior.

## Interaction and data behavior

The model board remains informational, matching the current section’s behavior. It must use the existing `models` data from `d.byModel`, the existing `salesModelMetric` normalization, and the existing `sortedModels` ordering. No lead write operations are introduced.

The current model facts remain visible in compact form:

- lead total;
- open count;
- booked count;
- retail count / final sales;
- lost count;
- converted rate and converted count.

Zero-valued outcome segments should still leave a visible minimum-width sliver only when needed for a legible legend/state; their counts remain explicit in the metadata. The outcome bar must include an accessible `role="img"` label describing the model’s conversion rate and outcome counts.

## Visual design

The section uses a light page-level surface with a dark navy inner visualization frame to create contrast against the surrounding CRM UI. The board itself is capped by the available content width rather than introducing a wider horizontal canvas.

Each row is compact and consistent:

- left: rank chip, model name, lead count;
- middle: segmented funnel bar plus small outcome text and conversion rate;
- right: retail count with a short “retail” label.

The bar colors must remain distinguishable for users with reduced color perception by pairing color with text labels and counts. Green is reserved for final retail results and retail segments; red/coral is reserved for lost leads. The row structure must not depend on hover or animation to convey meaning.

## Responsive behavior

- Desktop/tablet: use the three-zone row layout within the model panel; the visualization must not force page-level horizontal scrolling.
- Narrow screens: allow the funnel zone to shrink, keep the model and retail zones readable, and move the small outcome metadata below the bar if needed. Do not introduce a second full card per model.
- Preserve visible keyboard focus for any existing controls around the section and respect `prefers-reduced-motion` by using no required motion.

## Error and empty states

The existing model-section behavior remains unchanged: do not render the panel when there are no models. Existing page loading and analytics error states stay intact.

## Verification

- Run the project’s available smoke/test commands that exercise the frontend/server.
- Start the app locally and inspect the Sales Officer Performance view at desktop and narrow viewport widths.
- Confirm the model board shows the same model names, ordering, totals, and outcome counts as before.
- Confirm no page-level horizontal overflow is introduced.
- Confirm the visible outcome colors maintain readable contrast and the board remains legible without relying on motion.
