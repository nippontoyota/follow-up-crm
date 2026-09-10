// Fills the LOCAL DEMO database with realistic follow-up activity (varied
// outcomes, open/closed leads, overdue and upcoming follow-ups, flags) so the
// demo has something worth showing. Never touches the real followup_crm DB.
import { pool, run, all } from '../db.js';

if (process.env.DEMO_MODE !== '1' || process.env.DB_NAME !== 'followup_crm_demo') {
  throw new Error('This script is restricted to followup_crm_demo (run via npm run demo:*)');
}

const OUTCOMES = {
  'Connected':     ['Need Test Drive', 'Showroom Visit', 'Exchange Issue', 'Booking Done', 'Retail Done', 'Customer Busy', 'Call Me Back', 'Details Received', 'Need time', 'Need SO Call', 'Need More Details', 'Discount Issue', 'Not Interested', 'Already Booked', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer'],
  'Not Connected': ['RNR', 'Switch Off', 'Call Me Back', 'Call Forwarding', 'Line Busy', 'Invalid Number', 'LOST RNR'],
};
const CALL_STATUS_OF = {};
for (const [status, list] of Object.entries(OUTCOMES)) for (const o of list) CALL_STATUS_OF[o] = status;
const CLOSING = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer', 'LOST RNR']);

// weighted final-outcome pool: repeats = relative frequency
const FINAL_OUTCOME_POOL = [
  ...Array(12).fill('Booking Done'),
  ...Array(8).fill('Retail Done'),
  ...Array(10).fill('Not Interested'),
  ...Array(3).fill('Lost to Competition'),
  ...Array(2).fill('Finance Rejected'),
  ...Array(2).fill('Dropped'),
  ...Array(2).fill('Lost to co-dealer'),
  ...Array(14).fill('Need Test Drive'),
  ...Array(10).fill('Showroom Visit'),
  ...Array(3).fill('Customer Busy'),
  ...Array(10).fill('Call Me Back'),
  ...Array(3).fill('Details Received'),
  ...Array(6).fill('RNR'),
  ...Array(5).fill('Switch Off'),
  ...Array(4).fill('Need More Details'),
  ...Array(4).fill('Need time'),
  ...Array(3).fill('Discount Issue'),
  ...Array(2).fill('Already Booked'),
  ...Array(2).fill('LOST RNR'),
  ...Array(1).fill('Exchange Issue'),
];
const INTERMEDIATE_POOL = ['RNR', 'Switch Off', 'Line Busy', 'Call Me Back', 'Need Test Drive', 'Showroom Visit', 'Need SO Call', 'Need More Details', 'Call Forwarding'];

const REMARKS = {
  'Need Test Drive': ['Interested, wants to try the vehicle first', 'Booked a test drive slot', 'Will visit showroom for test drive this week'],
  'Showroom Visit': ['Visited showroom, checking variants', 'Walked in, comparing with competitor model', 'Came in with family to see the car'],
  'Customer Busy': ['Customer was busy, requested a later call', 'Asked to continue the discussion another time'],
  'Details Received': ['Customer shared the requested details', 'Collected the required information from customer'],
  'Booking Done': ['Booking confirmed, advance paid', 'Finalized variant and color, booking done', 'Happy customer, booked on the spot'],
  'Retail Done': ['Delivery completed', 'Vehicle handed over to customer', 'Retail closed successfully'],
  'Not Interested': ['Changed mind, not buying a car now', 'Budget did not work out', 'Postponing purchase indefinitely'],
  'Already Booked': ['Already booked elsewhere', 'Went with another dealership'],
  'Lost to Competition': ['Bought a competitor model instead', 'Went with Hyundai Creta', 'Chose a rival brand'],
  'Finance Rejected': ['Loan application rejected', 'Bank did not approve financing'],
  'Dropped': ['Not reachable after multiple attempts', 'Lead went cold'],
  'Lost to co-dealer': ['Purchased from another Toyota dealer', 'Bought from a different branch'],
  'Need time': ['Asked for more time to decide', 'Will confirm next month'],
  'Need SO Call': ['Requested a call from sales officer', 'Wants direct SO callback'],
  'Need More Details': ['Asked for brochure and pricing details', 'Wants more info on variants'],
  'Discount Issue': ['Negotiating on price', 'Asking for additional discount'],
  'Exchange Issue': ['Discussing exchange value for old car', 'Wants exchange bonus clarified'],
  'RNR': ['Ringing, not answering', 'No response on call'],
  'Switch Off': ['Phone switched off', 'Number unreachable'],
  'Call Me Back': ['Asked to call back later', 'Busy, requested callback'],
  'Call Forwarding': ['Call forwarded, could not reach', 'Number on call forwarding'],
  'Line Busy': ['Line busy, will retry', 'Could not connect, busy tone'],
  'Invalid Number': ['Number does not exist', 'Invalid contact number'],
  'LOST RNR': ['No response after three follow-ups', 'Could not connect after repeated attempts'],
};
const remarkFor = o => { const list = REMARKS[o] || ['Follow-up done']; return list[Math.floor(Math.random() * list.length)]; };

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const todayDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const today = fmt(todayDate);

const leads = await all(`SELECT id, mobile, assigned_to FROM leads WHERE status = 'open' AND fcount = 0 ORDER BY id`);
console.log(`Found ${leads.length} untouched leads in followup_crm_demo`);

let touched = 0, closedCount = 0, flaggedCount = 0;
const followupRows = [];
const leadUpdates = [];

for (const lead of leads) {
  // ~25% stay Fresh so the Fresh Leads tab still means something
  if (Math.random() < 0.25) continue;

  const finalOutcome = pick(FINAL_OUTCOME_POOL);
  const closing = CLOSING.has(finalOutcome);
  const fcount = finalOutcome === 'LOST RNR'
    ? 4
    : closing ? Math.floor(Math.random() * 3) + 1 : Math.floor(Math.random() * 5) + 1;

  // build seq history: intermediate attempts, then the final outcome as the last row
  const created = addDays(todayDate, -Math.floor(Math.random() * 25) - 1);
  for (let seq = 1; seq <= fcount; seq++) {
    const isLast = seq === fcount;
    const outcome = isLast ? finalOutcome : pick(INTERMEDIATE_POOL);
    const callStatus = CALL_STATUS_OF[outcome];
    const rowClosing = isLast && closing;
    let nextDate = null;
    if (!rowClosing) {
      nextDate = isLast
        ? fmt(addDays(todayDate, Math.floor(Math.random() * 8) - 4)) // spread: some overdue, some today, some upcoming
        : fmt(addDays(created, seq));
    }
    const createdAt = fmt(addDays(created, Math.floor(seq * (20 / fcount))));
    followupRows.push([lead.id, lead.assigned_to, seq, callStatus, outcome, nextDate, remarkFor(outcome), `${createdAt} ${String(9 + (seq % 8)).padStart(2, '0')}:${String((seq * 13) % 60).padStart(2, '0')}:00`]);
  }

  const lastNextDate = closing ? null : followupRows[followupRows.length - 1][5];
  const flag = !closing && Math.random() < 0.04;
  leadUpdates.push([lead.id, fcount, finalOutcome, closing ? 'closed' : 'open', lastNextDate, flag ? 1 : 0]);
  touched++;
  if (closing) closedCount++;
  if (flag) flaggedCount++;
}

// stage should read "Lost Lead" for the lost-but-not-"Not Interested" outcomes, matching server.js LOST semantics
const LOST = new Set(['Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer', 'LOST RNR']);
for (const u of leadUpdates) {
  const finalOutcome = u[2];
  if (LOST.has(finalOutcome)) u[2] = 'Lost Lead';
}

console.log(`Simulating activity on ${touched} leads (${closedCount} closing, ${flaggedCount} flagged), ${followupRows.length} follow-up rows...`);

for (let i = 0; i < leadUpdates.length; i += 300) {
  const batch = leadUpdates.slice(i, i + 300);
  await Promise.all(batch.map(([id, fcount, stage, status, nextDate, flag]) =>
    run(`UPDATE leads SET fcount = ?, stage = ?, status = ?, next_date = ?, is_flagged = ? WHERE id = ?`,
      fcount, stage, status, nextDate, flag, id)));
}

for (let i = 0; i < followupRows.length; i += 400) {
  const batch = followupRows.slice(i, i + 400);
  const values = batch.flat();
  const placeholders = batch.map((_, r) => `(${Array.from({ length: 8 }, (_, c) => '$' + (r * 8 + c + 1)).join(',')})`).join(',');
  await pool.query(
    `INSERT INTO followups(lead_id,user_id,seq,call_status,outcome,next_date,remarks,created_at) VALUES ${placeholders}`,
    values,
  );
}

console.log(`Done. ${touched} leads now have realistic history; ${leads.length - touched} remain Fresh.`);
await pool.end();
