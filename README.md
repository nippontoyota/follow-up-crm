# Follow-up CRM

Minimal, mobile-first lead follow-up CRM. Node 22.5+ (uses built-in `node:sqlite`), Express, vanilla JS. No build step.

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

Open http://localhost:3000 — first run seeds **admin / admin123** (change it by creating a new admin and disabling this one).

Data lives in `crm.db` (SQLite, created on first run). `.secret` holds the cookie signing key — keep both out of version control.

## Roles

**Admin** — creates users (admin / marketing / sales) and manages the master lists: Branches, Sources, Activities, Model names. A sales officer must be given a branch; that's what leads route on.

**Marketing** — adds leads: customer name, mobile (10 digits), source, branch, location, remarks. On save the lead is auto-assigned to the sales officer in that branch who currently holds the fewest open leads.

**Sales Officer** — three tabs:
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
