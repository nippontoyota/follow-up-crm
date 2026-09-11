# Fixed CEO Account Design

## Goal

Add one fixed CEO account that can review complete CRM information across every branch while keeping the existing Admin account as the only operational administrator.

## Account and security

- Fixed username: `ceo.nippon`.
- Initial password: the operator-provided value configured through `CEO_PASSWORD`.
- The username and role are defined in source beside the fixed Cluster Manager definitions.
- The password is read from `CEO_PASSWORD`; the documented initial value is supplied to the operator out of band and is not committed to source control.
- Database seeding is additive and idempotent. Existing CEO rows are not overwritten except to synchronize the configured password when `CEO_PASSWORD` is deliberately supplied.

## Access model

Use a distinct `ceo` role rather than aliasing CEO to `admin`.

CEO receives read-only access to:

- An Executive Overview with visual branch comparisons, conversion mix, and workload indicators.
- Branch Analytics across all branches, with branch drill-down.
- Call Center and Source Quality reports across all branches.
- Sales Officer performance and Lead Analysis across all branches, including branch-wise breakdowns.
- Flagged Lead history and lead detail inspection.
- All leads, searchable and paginated, including lead history.

CEO must not receive User management, lead reassignment, master-list editing, uploads, follow-up writes, flag writes, or other Admin mutation actions. Server-side route authorization must enforce this independently of the UI.

## Implementation

- Extend the users role constraint with `ceo`.
- Add a fixed CEO definition and additive seed helper, called during the same startup path as Cluster Manager seeding.
- Permit `ceo` on the existing read/report endpoints needed above and preserve all-branch query behavior for the role.
- Reuse the existing report pages and add only CEO navigation/role checks needed to render branch selectors, branch columns, and flag history correctly.
- Build the Executive Overview from existing aggregate endpoints using dependency-free HTML/CSS/SVG visuals; every visual summary links to the corresponding detailed lead view.
- Keep Cluster Manager branch scoping unchanged.

## Verification

- Static-check changed JavaScript files.
- Verify the CEO seed is idempotent and the role/password authenticate through `/api/login` and `/api/me`.
- Verify CEO can read each intended report and lead detail endpoint.
- Verify CEO receives `403` from user-management, reassignment, upload, follow-up, flag, and master mutation endpoints.
- Verify existing Admin and Cluster Manager account behavior remains unchanged.
- Verify charts render with zero-value and empty-state data without producing invalid widths or misleading totals.
