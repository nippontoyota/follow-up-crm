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

**Admin** — creates users and manages the master lists: Branches, Sources, Activities, and Model names. In the local call-center demo, Admin imports leads and distributes them among five Call Guys.

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
