# Branch-aware Sales Officer phone resolution

## Goal

Resolve Sales Officer phones from the Payslipportal employee directory using both the officer name and the lead's branch, then make any manual review branch-specific.

## Design

The CRM will read `employees.name`, `employees.mobile_number`, and `employees.branch` from the configured Payslipportal PostgreSQL database. It will normalize both officer names and branch names before matching. CRM branch codes are converted to their canonical branch names first, and the Payslipportal branch value may be either the short branch name or the full `Nippon Toyota - ...` form.

The lookup will prefer an exact normalized name plus branch match. It will only use a name-only fallback when the requested name has one unambiguous employee record. Ambiguous or missing matches stay in the review screen. Existing saved CRM mappings and workbook phone values remain fallbacks and keep the current precedence after the Payslipportal lookup.

The review screen will group unresolved rows by normalized officer name and branch. Each group will display the branch before the phone input, so the Admin knows which branch employee record to contact. Resolving a group applies the submitted phone to every row in that same name-and-branch group and keeps the existing saved-contact behavior.

## Safety

- No employee records are changed in Payslipportal.
- Existing CRM lead snapshots and contact mappings remain compatible.
- No phone is guessed when multiple employee records could match.
- Payslipportal connection errors remain non-fatal and do not expose credentials.

## Verification

- Test name and branch normalization with short and full branch names.
- Run JavaScript syntax and whitespace checks.
- Read the supplied workbook to confirm its dealership and GEM fields reach the branch-aware resolver.
- Verify the deployed review UI shows `Branch:` for unresolved contacts.
