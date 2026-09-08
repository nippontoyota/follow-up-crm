# Lead Workbook Import and Sales Officer Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support the supplied Lead Assignment workbook, persist Sales Officer phone mappings, and expose copyable Sales Officer contact details to Call Executives.

**Architecture:** Keep the existing browser review and assignment flow. Add a CRM-side contact-mapping table plus a lazy payslip-portal PostgreSQL lookup, so the server enriches parsed rows before assignment. Add the contact editor as a fifth Admin Lists tab and render the resolved contact in lead details without changing existing lead snapshots when mappings are later edited.

**Tech Stack:** Node.js 22 ESM, Express, PostgreSQL/pg, browser SheetJS parser, existing vanilla JS/CSS UI, ExcelJS for read-only verification of the supplied workbook.

## Global Constraints

- Only Admins may read or edit saved Sales Officer contact mappings.
- Import only rows whose Lead Quality is Hot, Warm, or Cold.
- Resolve phone in order: current payslip employee phone, saved CRM mapping, workbook fallback phone, manual review.
- Block assignment of rows without a resolved Sales Officer phone.
- Existing leads retain their stored phone snapshot when a mapping changes.
- Do not hardcode payslip database credentials.
- Preserve existing duplicate, master resolution, and Call Executive assignment behavior.

---

### Task 1: Add the Sales Officer contact data model and server lookup helpers

**Files:**
- Modify: `db.js` DDL list
- Create: `sales-officer-contacts.js`
- Modify: `server.js` imports and bulk-validation helpers
- Modify: `README.md` configuration/import notes

**Interfaces:**
- `normalizeOfficerName(value): string`
- `normalizeOfficerPhone(value): string | null`
- `resolveOfficerContacts(names, workbookPhones): Promise<Map<string, { name: string, phone: string, source: string }>>`
- `GET /api/sales-officer-contacts` returns `{ contacts: [{ id, display_name, name_key, phone, updated_at }] }`.
- `PATCH /api/sales-officer-contacts/:id` accepts `{ phone }` and returns the updated contact.
- `POST /api/sales-officer-contacts/resolve` accepts `{ name, phone }` and returns the saved contact.

- [ ] **Step 1: Add the CRM contact table DDL**

Add an idempotent `sales_officer_contacts` table with a unique normalized name key, display name, normalized 10-digit phone, and created/updated timestamps. Add an index on the normalized name key. Keep the existing database initialization pattern so startup remains repeatable.

- [ ] **Step 2: Add pure name and phone normalization helpers**

Implement `normalizeOfficerName` by trimming, lowercasing, removing common `mr/mrs/ms/dr` prefixes, replacing punctuation with spaces, and collapsing whitespace. Implement `normalizeOfficerPhone` by stripping non-digits and returning the last 10 digits only when exactly 10 digits remain; otherwise return null.

- [ ] **Step 3: Add a lazy payslip database pool**

Create a separate `pg.Pool` only when `PAYSLIP_DATABASE_URL` is configured. Use SSL with certificate verification disabled for hosted PostgreSQL, matching the existing app’s remote-database behavior. Query only `employees.name` and `employees.mobile_number`, normalize results, and close the pool on process shutdown. Do not return connection details or raw database errors to clients.

- [ ] **Step 4: Implement contact resolution precedence**

Load saved CRM mappings by normalized name. Query payslip employees for requested names when the external pool is available, preferring a non-empty current employee phone. Fall back to saved mappings and then valid workbook phones. Upsert any newly resolved phone so future imports reuse it. Return unresolved names for review instead of silently assigning them.

- [ ] **Step 5: Add Admin-only contact endpoints**

Add list, manual resolve, and edit endpoints guarded by `auth('admin')`. Validate phone numbers before writing. Return a friendly 400 for invalid or empty numbers and a generic 502-style error for an unavailable payslip lookup where appropriate.

- [ ] **Step 6: Document configuration**

Document `PAYSLIP_DATABASE_URL`, the workbook field mapping, and the one-time unresolved-contact resolution flow in the README without including any credential value.

- [ ] **Step 7: Run server syntax and diff checks**

Run:
```bash
node --check server.js
node --check sales-officer-contacts.js
git diff --check
```
Expected: all commands succeed.

- [ ] **Step 8: Commit the data and server layer**

```bash
git add db.js sales-officer-contacts.js server.js README.md
git commit -m "feat: persist sales officer contact mappings"
```

---

### Task 2: Normalize and filter the supplied workbook in the upload review

**Files:**
- Modify: `public/app.js` bulk-upload parser and review state
- Modify: `public/style.css` unresolved-contact review styles

**Interfaces:**
- Browser parser finds the first row containing the required report headers and returns normalized candidate rows.
- Each candidate contains `customer_name`, `mobile`, `branch`, `source`, `model`, `remarks`, `so_name`, `so_mobile`, and `so_status`.
- Review state includes grouped unresolved Sales Officer contact names and applies one resolved phone to all matching rows.

- [ ] **Step 1: Detect the actual report header row**

Read the first worksheet as arrays, find the row containing the lead-name, mobile, lead-quality, GEM, and dealership labels, and map later rows by header index. If the required headers are missing, show a clear upload error and create no candidate rows.

- [ ] **Step 2: Filter report rows**

Ignore title, filter, blank, subtotal, and footer rows. Keep only rows whose Lead Quality text contains Hot, Warm, or Cold after removing emoji and case differences.

- [ ] **Step 3: Map the report fields**

Map the supplied report into the existing API shape: Lead Name to customer name, Mobile to mobile, Dealership to branch, Source to source, Model to model, Quality Type to remarks, GEM to Sales Officer name, and any recognized Sales Officer phone column to fallback phone. Leave location blank and ignore TL, Lead Stage, date, and District.

- [ ] **Step 4: Extend validation response handling**

Display unresolved Sales Officer names in a grouped review section. Each row must show the affected lead count, a 10-digit phone input, and a Resolve button. Keep unresolved leads out of the ready count and assignment payload.

- [ ] **Step 5: Persist and apply manual resolutions**

Call the Admin resolution endpoint when a phone is submitted, update every matching candidate row’s `so_mobile`, clear its contact error, and remove the group from the unresolved section. Reuse the existing review controls for branch/source/model fixes.

- [ ] **Step 6: Verify the supplied workbook parser**

Use the supplied workbook path with a small read-only Node/ExcelJS check and the browser parser logic to confirm the header row, total data rows, and allowed quality values. Confirm non-quality rows are excluded and dealership codes are preserved for server mapping.

- [ ] **Step 7: Run client syntax and whitespace checks**

Run:
```bash
node --check public/app.js
git diff --check
```
Expected: all commands succeed.

- [ ] **Step 8: Commit the workbook review changes**

```bash
git add public/app.js public/style.css
git commit -m "feat: support lead assignment workbook format"
```

---

### Task 3: Add Admin contact management to Lists

**Files:**
- Modify: `public/app.js` Lists view and navigation state
- Modify: `public/style.css` contact list/editor styles

**Interfaces:**
- Lists has a fifth tab key `salesOfficerContacts` labeled `Sales Officer Contacts`.
- The tab consumes `GET /api/sales-officer-contacts` and `PATCH /api/sales-officer-contacts/:id`.
- It renders name, phone, updated time, filter input, and inline Edit/Save controls.

- [ ] **Step 1: Add the Lists tab**

Add the fifth tab without changing existing branch/source/activity/model behavior. Do not expose remove controls for contact mappings.

- [ ] **Step 2: Render searchable contact rows**

Show a friendly empty state, search by name or phone, and render the saved mapping fields with escaped output.

- [ ] **Step 3: Add inline edit/save**

Validate the phone client-side, submit the PATCH request, show server errors inline, and reload the list after a successful save.

- [ ] **Step 4: Run client syntax and whitespace checks**

Run:
```bash
node --check public/app.js
git diff --check
```
Expected: all commands succeed.

- [ ] **Step 5: Commit the Admin Lists UI**

```bash
git add public/app.js public/style.css
git commit -m "feat: manage sales officer contacts in lists"
```

---

### Task 4: Show copyable Sales Officer contact details to Call Executives

**Files:**
- Modify: `server.js` lead detail select if needed
- Modify: `public/app.js` lead detail sheet
- Modify: `public/style.css` contact detail/copy controls

**Interfaces:**
- Lead detail response includes the existing `original_so_name` and `original_so_mobile` snapshot fields.
- The lead detail sheet renders a `tel:` link and a Copy button for the Sales Officer phone.

- [ ] **Step 1: Add the Sales Officer phone row**

Show the original Sales Officer name and phone in the main lead details card. Use a clear unavailable state when the snapshot is empty.

- [ ] **Step 2: Add mobile and desktop copy behavior**

Implement a Copy button using `navigator.clipboard.writeText` with a temporary textarea fallback. Show a short success state and keep the phone accessible as a tel link.

- [ ] **Step 3: Verify role behavior**

Confirm Call Executives can see the contact in their assigned lead detail and Admin can see it in any accessible lead. Do not add edit controls to lead detail.

- [ ] **Step 4: Run syntax and whitespace checks**

Run:
```bash
node --check server.js
node --check public/app.js
git diff --check
```
Expected: all commands succeed.

- [ ] **Step 5: Commit the lead detail UI**

```bash
git add server.js public/app.js public/style.css
git commit -m "feat: show copyable sales officer contacts"
```

---

### Task 5: End-to-end verification, documentation, and deployment

**Files:**
- Modify: `README.md` if verification reveals missing operator instructions
- Test: supplied workbook and local demo database where safe

- [ ] **Step 1: Run all static checks**

Run:
```bash
node --check server.js
node --check public/app.js
node --check sales-officer-contacts.js
git diff --check
```
Expected: all commands succeed.

- [ ] **Step 2: Verify workbook structure and quality filtering**

Read `C:\Users\krish\Downloads\Lead Assignment detail(Gem model wise)-2026-09-08-05-10-36.xlsx` with ExcelJS and assert that the header row contains the required fields, data rows include only Hot/Warm/Cold candidates after filtering, and Dealership/GEM values are present.

- [ ] **Step 3: Verify database schema**

Run the app database initialization against the configured CRM database and query the contact-table definition. Confirm the table exists and no leads are created by initialization.

- [ ] **Step 4: Verify contact resolution without mutating production leads**

Use a temporary/demo database or isolated test inputs to cover HR phone, saved mapping, workbook fallback, manual resolve, and unresolved blocking. Do not import the supplied workbook into production during verification.

- [ ] **Step 5: Verify the browser-facing endpoints**

With the app running, authenticate as Admin and verify contact list, resolve, and edit responses. Authenticate as a Call Executive and verify the lead detail response exposes the stored snapshot without exposing Admin contact-edit endpoints.

- [ ] **Step 6: Review the final diff and status**

Run:
```bash
git diff --stat origin/master...HEAD
git status --short --branch
```
Expected: only intended files are changed and the tree is clean.

- [ ] **Step 7: Push deployment**

```bash
git push origin master
```

- [ ] **Step 8: Verify the deployed branch**

Run:
```bash
git status --short --branch
git log -1 --oneline
```
Expected: local master matches origin/master and the deployment commit is present.

