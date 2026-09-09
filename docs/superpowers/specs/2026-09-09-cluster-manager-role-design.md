# Fixed Cluster Manager Role

## Goal

Add a latency-conscious, read-oriented `cluster_manager` role for exactly four hardcoded accounts. Cluster managers need visibility across their assigned branches. Admin must be able to see these accounts in the Users list, but must not be able to create or edit additional cluster-manager accounts.

## Fixed access mapping

- Biju: Kalamassery, Nettoor, Kayamkulam
- Praveen: Kazhakoottam, Enjakkal, Kollam
- Vinod: Trichur, Irinjalakuda, Muvattupuzha
- Nirmal: Kottayam, Pala, Pathanamthitta, Thiruvalla

## Design

The existing `users` table remains the source of authentication. The role constraint is extended to accept `cluster_manager`, and the four accounts are seeded idempotently with fixed usernames, display names, and initial passwords. Existing user rows and credentials are never updated, disabled, or deleted by the seed path.

Cluster-manager branch membership is application-owned and hardcoded in a small configuration module. At process startup, branch names are resolved once to existing branch IDs and cached by cluster-manager username. Missing branches are logged and produce no database mutation; in particular, `Pala` is not inserted automatically.

The Admin Users list includes the four accounts and labels them as `Cluster Manager`. The Admin user form does not expose `cluster_manager`, and the users API rejects attempts to create or edit or toggle that role. Cluster-manager requests use the cached branch-ID list with parameterized, indexed branch filters. No per-request membership joins or per-row authorization queries are introduced.

Cluster managers receive the existing performance, lead-analysis, and flagged-lead views, scoped to their assigned branches. Existing roles and their behavior remain unchanged.

## Data safety

The implementation may add the four requested account rows and the role constraint/configuration needed to recognize them. It must not mutate existing leads, follow-ups, branches, users, assignments, or credentials. Seeding is idempotent and must not overwrite an existing username.

## Verification

- Existing test suite and smoke checks pass.
- Static checks confirm Admin can list `cluster_manager` users, while the role is absent from Admin creation options and rejected by create/edit/toggle APIs.
- Read-only database comparison confirms no existing lead, follow-up, branch, or user row changed.
- Login and branch-scoped analytics are verified for each fixed account.
- Missing `Pala` does not cause startup failure or a branch-table write.
