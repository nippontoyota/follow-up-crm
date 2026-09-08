# Follow-up CRM

Minimal, mobile-first lead follow-up CRM. Node 22.5+, Express, PostgreSQL, vanilla JS. No build step.

## Run

```bash
npm install
npm start
```

For AI lost-lead analysis, configure `GROQ_API_KEY` in the server environment. On Render, add it under the service's Environment Variables (do not commit it or rely on a local `.env` file):

```dotenv
GROQ_API_KEY=gsk_...
```

Without this environment variable, the regular CRM still runs but the AI Summary button reports that the AI integration is not configured.

Open http://localhost:3000. A new database seeds `admin / admin123` on first run.

Data lives in PostgreSQL. `.secret` holds the cookie signing key — keep it out of version control.

## Roles

**Admin** — creates users and manages the master lists: Branches, Sources, Activities, Model names, and Sales Officer Contacts. In the local call-center demo, Admin imports leads and distributes them among five Call Guys.

**Marketing** — legacy lead-entry role retained for compatibility.

**Call Guy** — three tabs:
- **Fresh** — assigned leads with no follow-up logged yet.
- **Today's follow-up** — open leads whose next follow-up date is today or earlier (overdue leads stay visible instead of disappearing). This is where F2…F5 and beyond happen.
- **All** — everything assigned to them, including closed leads.

## Follow-up form

Call status → outcome:

| Connected | Not Connected |
|---|---|
| Need Test Drive | RNR |
| Showroom Visit | Switch Off |
| Booking Done | Call Me Back |
| Retail Done | |
| Not Interested | |

- **Next follow-up date** is mandatory and restricted to **today … today + 3** (the n+3 rule), enforced on both the date input and the server.
- **Booking Done / Retail Done / Not Interested** close the lead — no next date is asked for and it drops out of the follow-up tabs. Every other outcome requires the date.
- Model and Activity dropdowns appear on Connected outcomes and are optional.
- Each entry is numbered F1, F2, F3… and the full history is shown on the lead.

## Layout

- `server.js` — API and auth (HMAC-signed cookie, scrypt password hashing)
- `db.js` — schema, seeding, password helpers
- `public/` — `index.html`, `app.js`, `style.css`

## Local call-center demo

The repository includes an isolated demo flow for the repurposed call-center model. It uses a separate PostgreSQL database named `followup_crm_demo` on `localhost`. The demo refuses to start if its database host or name points elsewhere. It does not load `.env`, and it does not change the connected database service.

Copy `.env.demo.example` to `.env.demo` if needed, then run:

```powershell
npm run demo:db
npm run demo:reset
npm run demo:seed
npm run demo:workbook
npm run demo:smoke
npm run demo
```

Open http://localhost:3000. The generated upload file is [demo-data/call-center-demo.xlsx](demo-data/call-center-demo.xlsx).

All demo accounts use the password `demo123`:

- `demo-admin`
- `callguy-1` through `callguy-5`
- `call-manager`
- `sales-manager-kochi`
- `sales-manager-muv`
- `sales-manager-thiruvalla`

The upload workbook contains `Name`, `Mobile`, `Source`, `Branch`, `Location`, `Model`, `SO Name`, `SO Mobile`, and `Status`. The imported Sales Officer is reporting data. The Call Guys are the platform users who receive and process the leads.

## Lead Assignment workbook

The Admin bulk uploader also accepts the Lead Assignment report format. It detects the report header row, keeps only rows whose `Lead Quality` is Hot, Warm, or Cold, maps `Dealership` codes to CRM branches, uses `GEM` as the Sales Officer, and stores `Quality Type` as lead remarks. `TL`, `Lead Stage`, report dates, and `District` are ignored for this format.

For Sales Officer phones, configure the payslip portal PostgreSQL connection in the server environment without committing credentials:

```dotenv
PAYSLIP_DATABASE_URL=postgresql://...
# Or use the read-only Payslipportal Supabase REST connection:
PAYSLIP_SUPABASE_URL=https://<project>.supabase.co
PAYSLIP_SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
```

The uploader matches the Sales Officer against the payslip employee directory by normalized name and branch first. It then uses a saved Sales Officer contact mapping, followed by any phone supplied by the workbook. If the payslip name is ambiguous or no phone is available, the Admin can resolve the branch-specific Sales Officer group once in the upload review; the saved mapping is reused for future uploads. Admins can edit saved mappings in Lists → Sales Officer Contacts. Existing leads retain their stored Sales Officer phone snapshot after a mapping edit.
