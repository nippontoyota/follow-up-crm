# Call Center Manager dashboard redesign

## Design read

This is an operate surface for Call Center Managers working a live lead queue. The redesign keeps the existing light Nippon Toyota identity and moves the screen toward a restrained dispatch-board layout. The current page remains the anti-reference: saturated metric tiles, weak page context, and equal visual weight across unrelated information.

## User job

The manager should be able to answer three questions immediately:

1. How many open leads are in follow-up?
2. Which follow-up bucket needs attention?
3. What happens when I select that bucket?

## Composition

- Keep the existing navigation and route.
- Add a clear page intro with the live refresh state and export action.
- Make the follow-up queue the first major content block. Use six keyboard-reachable controls for F1, F2, F3, F4, F5, and F6+.
- Show the overall follow-up total as the main workload number and overdue work as the only urgent secondary state.
- Keep executive, branch, outcome, and overdue tables below the queue in a quieter data layout.
- Preserve the current lead drill-down action for every count.

## Visual system

- Use the existing light background, navy text, and Nippon Toyota blue as the main accent.
- Remove the background grid and saturated seven-color KPI wall from this surface.
- Use color for meaning only: blue for the active workload, amber for attention, and red for overdue or high follow-up count.
- Use one soft radius family and shallow, tinted elevation. Avoid nested card stacks.
- Use the existing font stack and plain sentence-case copy. No new dependencies or imagery.

## Interaction and states

- Follow-up controls use real buttons, have hover, focus, active, and disabled states, and open the existing lead sheet.
- Refresh keeps the current route and reloads only the current analytics view.
- Loading uses the existing loading path. Errors keep the existing retry path.
- Empty tables keep their current empty messages.
- Reduced-motion users receive no additional movement.

## Performance and data safety

- Do not change the dashboard endpoints or add requests.
- Derive visible layout labels from the existing analytics response.
- Do not write to leads, follow-ups, or user records from the dashboard.
- Keep table rendering and drill-down behavior intact.
