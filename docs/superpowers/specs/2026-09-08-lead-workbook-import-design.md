# Lead Workbook Import and Sales Officer Contacts

## Goal

Allow Admins to upload the September 2026 Lead Assignment workbook format while preserving the existing bulk-import flow. Imported leads must retain the Sales Officer represented by the workbook's `GEM` column and a usable Sales Officer phone number. Admins must be able to resolve missing phone numbers once and maintain those mappings from the existing Lists screen.

## Scope

### Workbook mapping

The importer will find the header row instead of assuming the first row is the header. It will accept the report columns shown in the supplied workbook:

| Workbook field | CRM field | Behavior |
| --- | --- | --- |
| `Nippon Toyota Lead: Lead Name` | `customer_name` | Required customer name |
| `Mobile` | `mobile` | Normalize to the last 10 digits |
| `Dealership` | `branch` / `branch_id` | Resolve existing dealership codes through the CRM branch-code map |
| `Source` | `source_id` | Resolve against existing Sources |
| `Model` | `model_id` | Resolve against existing Models |
| `Quality Type` | `remarks` | Preserve the uploaded quality detail |
| `GEM` | `original_so_name` | Store as the original Sales Officer |
| Sales Officer phone | `original_so_mobile` | Resolve using the phone-resolution order below |

Rows are imported only when `Lead Quality` contains `Hot`, `Warm`, or `Cold`, regardless of the emoji prefix. Title rows, subtotal rows, blank rows, and other quality values are ignored. `TL`, `Lead Stage`, report dates, and `District` are ignored for this report format.

Existing workbook formats remain supported. Existing explicit Sales Officer phone columns continue to work.

### Sales Officer phone resolution

The server will use a separately configured payslip-portal PostgreSQL connection, without hardcoded credentials. The setting will be supplied as `PAYSLIP_DATABASE_URL` in the deployment environment.

For each Sales Officer name, resolution order is:

1. A non-empty current `employees.mobile_number` value from the payslip database.
2. A saved CRM contact mapping for the normalized Sales Officer name.
3. A valid phone supplied by the workbook, as a fallback.
4. A grouped unresolved item in the import review.

Name matching normalizes case, whitespace, punctuation, and common title prefixes. A valid phone is normalized to 10 digits. A current payslip value refreshes the saved CRM mapping. A workbook or manually resolved value is saved for future imports when no current payslip value is available.

The CRM will add a `sales_officer_contacts` table with a unique normalized name key, display name, normalized phone, and created/updated timestamps. Manual resolution stores the mapping immediately and applies it to all matching rows in the current upload. Future uploads use it automatically.

Rows without a resolved Sales Officer phone remain blocked. The review groups them by Sales Officer name and provides one phone input and Resolve action per name. This avoids asking the Admin to resolve the same person repeatedly.

### Admin maintenance UI

The existing Admin → Lists view will gain a fifth tab named `Sales Officer Contacts`, alongside Branches, Sources, Activities, and Model names.

The tab will show searchable contact mappings with:

- Sales Officer name
- Phone number
- Last updated time
- Inline Edit/Save controls

Only Admins can access or modify these mappings. There will be no delete action in the first version. Editing a mapping affects future imports and does not rewrite existing lead snapshots.

### Lead detail UI

Lead details will show the original Sales Officer name and phone directly in the main details card. The phone will be:

- A `tel:` link for mobile devices.
- A visible Copy button using the Clipboard API with a safe fallback for desktop browsers.
- Clearly labeled as the Sales Officer phone, separate from the customer mobile number.

The existing Salesforce history display remains available and is not removed.

## Data flow

1. The browser reads the first worksheet and detects the row containing the required report headers.
2. The browser maps supported fields, filters Lead Quality, and sends normalized candidate rows to `/api/leads/bulk-validate`.
3. The server resolves branches, masters, duplicate mobiles, and Sales Officer contacts.
4. The server returns valid rows, ordinary field-resolution groups, and grouped unresolved Sales Officer phone items.
5. The Admin resolves missing contacts in the review screen; each successful resolution is persisted and applied to all matching rows.
6. The existing review screen assigns ready rows to any selected active Call Executives.
7. Lead insertion, Salesforce contact snapshot insertion, and any final mapping writes use the existing transaction pattern.

## Error handling and safety

- Missing or ambiguous workbook headers produce a clear upload error without creating data.
- Missing branch, source, model, customer, or phone data remains in the existing review/error flow.
- No row is assigned until its required Sales Officer phone is resolved for this report format.
- Payslip database failures do not expose credentials or raw database errors to the browser. Rows can still use saved CRM mappings or valid workbook fallback phones; otherwise they remain unresolved.
- Duplicate and existing-lead checks remain unchanged.
- Existing leads are never rewritten when an Admin edits a contact mapping.

## Verification

Automated and manual checks will cover:

- Header detection with title, filter, subtotal, and blank rows.
- Filtering to only Hot, Warm, and Cold quality values.
- Dealership code resolution, including the supplied branch codes.
- GEM-to-employee name matching and phone normalization.
- Saved contact fallback after the payslip lookup has no phone.
- Grouped manual resolution applying one phone to all matching rows.
- Admin listing and editing of contact mappings.
- Lead detail tap-to-call and desktop copy behavior.
- Existing workbook import compatibility.
- JavaScript syntax, whitespace checks, and a clean git tree before handoff.
