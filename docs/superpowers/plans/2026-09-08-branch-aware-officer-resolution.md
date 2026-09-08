# Branch-aware Sales Officer resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Payslipportal employee records and the lead branch to resolve Sales Officer phones, and show the branch in manual resolution rows.

**Architecture:** Keep the existing CRM contact table and import API. Extend the server resolver with normalized name-and-branch keys and extend the browser review grouping with the same key. Payslipportal remains read-only and is accessed through the existing `PAYSLIP_DATABASE_URL` pool.

**Tech Stack:** Node.js 22 ESM, Express, PostgreSQL/pg, browser SheetJS parser, vanilla JavaScript UI.

## Global Constraints

- Query Payslipportal employees only; never write to that database.
- Prefer exact normalized name plus branch matches.
- Do not guess when a name has multiple employee records.
- Keep saved CRM contact mappings and manual resolution behavior compatible.
- Preserve existing workbook filtering, duplicate checks, and assignment behavior.

---

### Task 1: Make server contact lookup branch-aware

**Files:**
- Modify: `sales-officer-contacts.js`
- Modify: `server.js`

**Interfaces:**
- `normalizeOfficerBranch(value): string`
- `officerContactKey(name, branch): string`
- `resolveOfficerContacts(entries, workbookPhones): Promise<Map<string, { name: string, phone: string, source: string }>>`
- Each resolver entry is `{ name: string, branch: string }`.

- [ ] Add branch normalization that removes the optional `Nippon Toyota -` prefix, punctuation, and whitespace differences.
- [ ] Query `employees.name`, `employees.mobile_number`, and `employees.branch` from Payslipportal.
- [ ] Match exact normalized name and branch first, then allow a name-only fallback only for one employee record.
- [ ] Key requested contacts and workbook phone fallbacks by normalized name plus branch.
- [ ] Update bulk validation to canonicalize the uploaded branch before resolving contacts and to read the returned contact by the same composite key.
- [ ] Run `node --check server.js`, `node --check sales-officer-contacts.js`, and `git diff --check`.
- [ ] Commit the server change with `feat: resolve officer phones by branch`.

### Task 2: Make manual review branch-specific

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Unresolved contact groups use a normalized officer-name plus branch key.
- Each group contains `{ name, branch, rows }` and one manual phone input.

- [ ] Group unresolved rows by officer name and branch instead of officer name alone.
- [ ] Render `Branch: <branch>` before the phone input for every unresolved group.
- [ ] Keep one manual resolution applied to all rows in that same group.
- [ ] Run `node --check public/app.js` and `git diff --check`.
- [ ] Commit the review change with `feat: show branch during officer resolution`.

### Task 3: Verify, document, and deploy

**Files:**
- Modify: `README.md`

- [ ] Document that Payslipportal matching uses Sales Officer name plus branch and that ambiguous matches remain manual.
- [ ] Run a read-only workbook check confirming the `GEM` and `Dealership` columns are present and the quality filter still produces candidate rows.
- [ ] Run all syntax checks and inspect the final diff.
- [ ] Push `master` and verify the deployed bundle contains branch-aware resolver text.
- [ ] Verify the live upload review renders branch labels without confirming an import.
- [ ] Commit the documentation and deploy verification with `docs: document branch-aware officer resolution`.
