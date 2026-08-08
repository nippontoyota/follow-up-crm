import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pool, get, all, run, ins, hash, verify, initDb } from './db.js';

const PORT = process.env.PORT || 3000;

if (!existsSync('.secret')) writeFileSync('.secret', randomBytes(32).toString('hex'));
const SECRET = process.env.SESSION_SECRET || readFileSync('.secret', 'utf8').trim();

export const OUTCOMES = {
  'Connected':     ['Need Test Drive', 'Showroom Visit', 'Booking Done', 'Retail Done', 'Need time', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer'],
  'Not Connected': ['RNR', 'Switch Off', 'Call Me Back'],
};
const CLOSING = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer']);
const LOST    = new Set(['Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer']);
const MAX_DAYS_AHEAD = 3;

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* ---------------------------------------------------------------- helpers */

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function sign(value) {
  return value + '.' + createHmac('sha256', SECRET).update(value).digest('base64url');
}

function unsign(signed) {
  const i = String(signed || '').lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const a = Buffer.from(signed.slice(i + 1));
  const b = Buffer.from(createHmac('sha256', SECRET).update(value).digest('base64url'));
  return a.length === b.length && timingSafeEqual(a, b) ? value : null;
}

async function currentUser(req) {
  const raw = (req.headers.cookie || '')
    .split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  const id = raw && unsign(decodeURIComponent(raw.slice(4)));
  if (!id) return null;
  return await get(
    `SELECT id, username, name, role, branch_id FROM users WHERE id = ? AND active = 1`,
    Number(id),
  ) || null;
}

const auth = (...roles) => async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (roles.length && !roles.includes(user.role))
      return res.status(403).json({ error: 'Not allowed' });
    req.user = user;
    next();
  } catch (e) { next(e); }
};

const bad = (res, msg) => res.status(400).json({ error: msg });

/* ------------------------------------------------------------------- auth */

app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const u = await get(
      `SELECT * FROM users WHERE username = ? AND active = 1`,
      String(username || '').trim().toLowerCase(),
    );
    if (!u || !verify(String(password || ''), u.password))
      return res.status(401).json({ error: 'Invalid username or password' });
    res.setHeader('Set-Cookie',
      `sid=${encodeURIComponent(sign(String(u.id)))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
    res.json({ id: u.id, name: u.name, role: u.role });
  } catch (e) { next(e); }
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res, next) => {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    res.json({ ...u, today: today(), maxDate: addDays(today(), MAX_DAYS_AHEAD), outcomes: OUTCOMES });
  } catch (e) { next(e); }
});

/* ---------------------------------------------------------------- masters */

const MASTERS = { branches: 'branches', sources: 'sources', activities: 'activities', models: 'models' };

app.get('/api/masters', auth(), async (req, res, next) => {
  try {
    const out = {};
    for (const t of Object.values(MASTERS)) out[t] = await all(`SELECT * FROM ${t} ORDER BY name`);
    res.json(out);
  } catch (e) { next(e); }
});

app.post('/api/masters/:type', auth('admin'), async (req, res, next) => {
  try {
    const t = MASTERS[req.params.type];
    if (!t) return bad(res, 'Unknown list');
    const name = String(req.body?.name || '').trim();
    if (!name) return bad(res, 'Name is required');
    const id = await ins(`INSERT INTO ${t} (name) VALUES (?)`, name);
    res.json({ id, name });
  } catch (e) {
    if (e.code === '23505') return bad(res, `"${String(req.body?.name || '').trim()}" already exists`);
    next(e);
  }
});

app.delete('/api/masters/:type/:id', auth('admin'), async (req, res, next) => {
  try {
    const t = MASTERS[req.params.type];
    if (!t) return bad(res, 'Unknown list');
    await run(`DELETE FROM ${t} WHERE id = ?`, Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') return bad(res, 'Already in use — cannot delete');
    next(e);
  }
});

app.post('/api/salesforce-validate', auth('admin'), async (req, res, next) => {
  try {
    const records = req.body || [];
    const valid = [];
    const duplicates = [];
    
    // To check file dupes:
    const seen = new Set();
    
    // To check DB dupes:
    const existingMobiles = new Set((await all(`SELECT mobile FROM salesforce_calls`)).map(r => r.mobile));
    
    for (const r of records) {
      if (!r.mobile || !r.so_name) continue;
      const m = String(r.mobile).replace(/\D/g, '').slice(-10);
      if (m.length < 10) continue;
      
      const mapped = { mobile: m, so_name: String(r.so_name).trim(), so_mobile: r.so_mobile ? String(r.so_mobile).trim() : null, status: r.status ? String(r.status).trim() : null };
      
      if (seen.has(m) || existingMobiles.has(m)) {
        duplicates.push(mapped);
      } else {
        seen.add(m);
        valid.push(mapped);
      }
    }
    res.json({ valid, duplicates });
  } catch(e) { next(e); }
});

app.post('/api/salesforce-upload', auth('admin'), async (req, res, next) => {
  try {
    const records = req.body || [];
    let processed = 0;
    for (const r of records) {
      if (!r.mobile || !r.so_name) continue;
      try {
        await run(`
          INSERT INTO salesforce_calls (mobile, so_name, so_mobile, status, created_at) 
          VALUES (?, ?, ?, ?, TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
          ON CONFLICT (mobile) DO UPDATE SET 
            so_name = EXCLUDED.so_name,
            so_mobile = EXCLUDED.so_mobile,
            status = EXCLUDED.status,
            created_at = EXCLUDED.created_at
        `, r.mobile, r.so_name, r.so_mobile, r.status);
        processed++;
      } catch (e) {
        if (e.code !== '23505') throw e;
      }
    }
    res.json({ processed });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ users */

app.get('/api/users', auth('admin'), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT u.id, u.username, u.name, u.role, u.active, b.name AS branch
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.role, u.name`,
    ));
  } catch (e) { next(e); }
});

app.post('/api/users', auth('admin'), async (req, res, next) => {
  try {
    const { name, username, password, role, branch_id } = req.body || {};
    if (!name?.trim() || !username?.trim() || !password || !['admin', 'marketing', 'sales'].includes(role))
      return bad(res, 'Name, username, password and role are required');
    if (String(password).length < 6) return bad(res, 'Password must be at least 6 characters');
    if (role === 'sales' && !branch_id) return bad(res, 'A sales officer needs a branch');
    const id = await ins(
      `INSERT INTO users (username, password, name, role, branch_id) VALUES (?,?,?,?,?)`,
      String(username).trim().toLowerCase(), hash(String(password)), name.trim(), role,
      role === 'sales' ? Number(branch_id) : null,
    );
    res.json({ id });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'That username is taken');
    next(e);
  }
});

app.post('/api/users/:id/toggle', auth('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return bad(res, 'You cannot disable your own account');
    await run(`UPDATE users SET active = 1 - active WHERE id = ?`, id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ leads */

async function pickOfficer(branchId) {
  const row = await get(
    `SELECT u.id FROM users u
     LEFT JOIN leads l ON l.assigned_to = u.id
     WHERE u.role = 'sales' AND u.active = 1 AND u.branch_id = ?
     GROUP BY u.id ORDER BY MAX(l.id) NULLS FIRST, u.id LIMIT 1`,
    branchId,
  );
  return row?.id ?? null;
}

app.post('/api/leads', auth('marketing', 'admin'), async (req, res, next) => {
  try {
    const { customer_name, mobile, source_id, branch_id, location, remarks, model_id, activity_id } = req.body || {};
    if (!customer_name?.trim()) return bad(res, 'Customer name is required');
    if (!/^\d{10}$/.test(String(mobile || '').trim())) return bad(res, 'Mobile must be 10 digits');
    if (!branch_id) return bad(res, 'Branch is required');
    if (!source_id) return bad(res, 'Source is required');

    const assigned = await pickOfficer(Number(branch_id));
    const id = await ins(
      `INSERT INTO leads (customer_name, mobile, source_id, branch_id, location, remarks, created_by, assigned_to, model_id, activity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      customer_name.trim(), String(mobile).trim(), Number(source_id), Number(branch_id),
      location?.trim() || null, remarks?.trim() || null, req.user.id, assigned,
      model_id ? Number(model_id) : null, activity_id ? Number(activity_id) : null,
    );
    let officerName = null;
    if (assigned) {
      const u = await get('SELECT name FROM users WHERE id=?', assigned);
      officerName = u?.name;
    }
    res.json({
      id,
      assigned: assigned !== null,
      officerName,
      warning: assigned === null ? 'Saved, but no active sales officer in that branch yet.' : null,
    });
  } catch (e) { next(e); }
});

app.post('/api/leads/bulk-validate', auth('admin'), async (req, res, next) => {
  try {
    const rows = req.body || [];
    const [branches, sources, models, activities, existingLeads] = await Promise.all([
      all(`SELECT id, name FROM branches`),
      all(`SELECT id, name FROM sources`),
      all(`SELECT id, name FROM models`),
      all(`SELECT id, name FROM activities`),
      all(`SELECT mobile FROM leads`)
    ]);

    const bMap = new Map(branches.map(b => [b.name.toLowerCase().trim(), b.id]));
    const sMap = new Map(sources.map(s => [s.name.toLowerCase().trim(), s.id]));
    const mMap = new Map(models.map(m => [m.name.toLowerCase().trim(), m.id]));
    const aMap = new Map(activities.map(a => [a.name.toLowerCase().trim(), a.id]));

    const existingMobiles = new Set(existingLeads.map(l => l.mobile));
    const seen = new Set();
    const valid = [];
    const invalid = [];
    let duplicates = 0;

    for (const r of rows) {
      const rawMobile = String(r.mobile || '').trim();
      const m = rawMobile.replace(/\D/g, '').slice(-10);
      if (m.length === 10) {
        if (seen.has(m) || existingMobiles.has(m)) {
          duplicates++;
          continue; // skip duplicate lead entirely
        }
        seen.add(m);
        r.mobile = m;
      }

      const bName = String(r.branch || '').trim();
      const sName = String(r.source || '').trim();
      const mName = String(r.model || '').trim();
      const aName = String(r.activity || '').trim();
      
      const bId = bMap.get(bName.toLowerCase());
      const sId = sMap.get(sName.toLowerCase());
      const mId = mName ? mMap.get(mName.toLowerCase()) : null;
      const aId = aName ? aMap.get(aName.toLowerCase()) : null;

      const mapped = {
        ...r,
        branch_id: bId || null,
        source_id: sId || null,
        model_id: mId || null,
        activity_id: aId || null,
        err_branch: !!bName && !bId,
        err_source: !!sName && !sId,
        err_model: !!mName && !mId,
        err_activity: !!aName && !aId,
        err_missing: !bName || !sName || !r.customer_name || !r.mobile
      };

      if (mapped.err_branch || mapped.err_source || mapped.err_model || mapped.err_activity || mapped.err_missing) {
        invalid.push(mapped);
      } else {
        valid.push(mapped);
      }
    }
    res.json({ valid, invalid, duplicates });
  } catch(e) { next(e); }
});

app.post('/api/leads/bulk-assign', auth('admin'), async (req, res, next) => {
  try {
    const leads = req.body || [];
    if (!leads.length) return res.json({ ok: true, added: 0 });

    const byBranch = {};
    for (const l of leads) {
      if (!byBranch[l.branch_id]) byBranch[l.branch_id] = [];
      byBranch[l.branch_id].push(l);
    }

    let added = 0;
    for (const branchId of Object.keys(byBranch)) {
      const sos = await all(`SELECT id FROM users WHERE role = 'sales' AND active = 1 AND branch_id = ? ORDER BY id`, Number(branchId));
      let soIdx = 0;
      
      for (const l of byBranch[branchId]) {
        const assigned_to = sos.length ? sos[soIdx % sos.length].id : null;
        await run(
          `INSERT INTO leads (customer_name, mobile, source_id, branch_id, location, remarks, created_by, assigned_to, model_id, activity_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          String(l.customer_name).trim(), String(l.mobile).trim(), Number(l.source_id), Number(branchId),
          l.location?.trim() || null, l.remarks?.trim() || null, req.user.id, assigned_to,
          l.model_id ? Number(l.model_id) : null, l.activity_id ? Number(l.activity_id) : null
        );
        soIdx++;
        added++;
      }
    }
    res.json({ ok: true, added });
  } catch(e) { next(e); }
});

const LEAD_SELECT = `
  SELECT l.*, b.name AS branch, s.name AS source, u.name AS officer, c.name AS created_by_name,
         m.name AS model, a.name AS activity
  FROM leads l
  LEFT JOIN branches   b ON b.id = l.branch_id
  LEFT JOIN sources    s ON s.id = l.source_id
  LEFT JOIN users      u ON u.id = l.assigned_to
  LEFT JOIN users      c ON c.id = l.created_by
  LEFT JOIN models     m ON m.id = l.model_id
  LEFT JOIN activities a ON a.id = l.activity_id`;

app.get('/api/leads', auth(), async (req, res, next) => {
  try {
    const { tab = 'all' } = req.query;
    const where = [], args = [];

    if (req.user.role === 'sales')     { where.push('l.assigned_to = ?'); args.push(req.user.id); }
    else if (req.user.role === 'marketing') { where.push('l.created_by = ?'); args.push(req.user.id); }

    if (tab === 'fresh') where.push(`l.status = 'open' AND l.fcount = 0`);
    else if (tab === 'today') { where.push(`l.status = 'open' AND l.fcount > 0 AND l.next_date <= ?`); args.push(today()); }

    const sql = `${LEAD_SELECT}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.next_date NULLS FIRST, l.id DESC LIMIT 500`;
    res.json(await all(sql, ...args));
  } catch (e) { next(e); }
});

app.get('/api/leads/stats', auth(), async (req, res, next) => {
  try {
    const isSales = req.user.role === 'sales';
    const isMkt   = req.user.role === 'marketing';
    const filt    = isSales ? 'AND l.assigned_to = ?' : isMkt ? 'AND l.created_by = ?' : '';
    const args    = (isSales || isMkt) ? [today(), req.user.id] : [today()];
    const row = await get(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE l.fcount = 0 AND l.status = 'open')::int AS fresh,
        COUNT(*) FILTER (WHERE l.status = 'open' AND l.fcount > 0 AND l.next_date <= ?)::int AS today_count,
        COUNT(*) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
        COUNT(*) FILTER (WHERE l.stage = 'Retail Done'  AND l.status = 'closed')::int AS retailed,
        COUNT(*) FILTER (WHERE l.stage = 'Lost Lead'    AND l.status = 'closed')::int AS lost
      FROM leads l WHERE 1=1 ${filt}`, ...args);
    res.json(row || { total:0, fresh:0, today_count:0, booked:0, retailed:0, lost:0 });
  } catch (e) { next(e); }
});

app.get('/api/leads/:id', auth(), async (req, res, next) => {
  try {
    const lead = await get(`${LEAD_SELECT} WHERE l.id = ?`, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (req.user.role === 'sales' && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    if (req.user.role === 'marketing' && lead.created_by !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });

    lead.followups = await all(
      `SELECT f.*, m.name AS model, a.name AS activity, u.name AS by_name
       FROM followups f
       LEFT JOIN models     m ON m.id = f.model_id
       LEFT JOIN activities a ON a.id = f.activity_id
       LEFT JOIN users      u ON u.id = f.user_id
       WHERE f.lead_id = ? ORDER BY f.seq`,
      lead.id,
    );
    lead.salesforce_history = await all(
      `SELECT so_name, so_mobile, status, created_at FROM salesforce_calls WHERE mobile = ? ORDER BY id DESC`,
      lead.mobile
    );
    res.json(lead);
  } catch (e) { next(e); }
});

app.post('/api/leads/:id/followup', auth('sales', 'admin'), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = ?`, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (req.user.role === 'sales' && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    if (lead.status !== 'open') return bad(res, 'This lead is already closed');

    const { call_status, outcome, next_date, remarks, model_id, activity_id, other_so_called, order_id, tally_receipt } = req.body || {};
    if (!OUTCOMES[call_status]) return bad(res, 'Select Connected or Not Connected');
    if (!OUTCOMES[call_status].includes(outcome)) return bad(res, 'Select a valid outcome');

    if (outcome === 'Booking Done' && !String(order_id || '').trim()) return bad(res, 'Order ID is required');
    if (outcome === 'Retail Done' && !String(tally_receipt || '').trim()) return bad(res, 'Tally Receipt No. is required');

    const closing = CLOSING.has(outcome);
    const isLost  = LOST.has(outcome);
    let nd = null;
    if (!closing) {
      nd = String(next_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return bad(res, 'Next follow-up date is required');
      if (nd < today()) return bad(res, 'Next follow-up date cannot be in the past');
      if (nd > addDays(today(), MAX_DAYS_AHEAD))
        return bad(res, `Next follow-up date cannot be later than ${addDays(today(), MAX_DAYS_AHEAD)}`);
    }

    const seq   = lead.fcount + 1;
    const stage = isLost ? 'Lost Lead' : outcome;
    await run(
      `INSERT INTO followups (lead_id, user_id, seq, call_status, outcome, model_id, activity_id, next_date, remarks, other_so_called, order_id, tally_receipt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      lead.id, req.user.id, seq, call_status, outcome,
      model_id ? Number(model_id) : null, activity_id ? Number(activity_id) : null,
      nd, remarks?.trim() || null, other_so_called?.trim() || null,
      order_id?.trim() || null, tally_receipt?.trim() || null,
    );
    await run(
      `UPDATE leads SET fcount = ?, stage = ?, next_date = ?, status = ? WHERE id = ?`,
      seq, stage, nd, closing ? 'closed' : 'open', lead.id,
    );
    res.json({ ok: true, seq, closed: closing });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------- dashboards */

app.get('/api/counts', auth(), async (req, res, next) => {
  try {
    const isSales = req.user.role === 'sales';
    const extra = isSales ? ' AND assigned_to = ?' : '';
    const args  = isSales ? [req.user.id] : [];
    const [fr, du] = await Promise.all([
      get(`SELECT COUNT(*)::int AS c FROM leads WHERE status='open' AND fcount=0${extra}`, ...args),
      get(`SELECT COUNT(*)::int AS c FROM leads WHERE status='open' AND fcount>0 AND next_date<=?${extra}`, today(), ...args),
    ]);
    res.json({ fresh: fr.c, due: du.c });
  } catch (e) { next(e); }
});

app.get('/api/analytics', auth('admin'), async (req, res, next) => {
  try {
    const { branch_id } = req.query;
    if (branch_id) {
      res.json(await all(
        `SELECT u.id, u.name, COUNT(l.id)::int AS total,
                SUM(CASE WHEN l.status = 'open' THEN 1 ELSE 0 END)::int AS open,
                SUM(CASE WHEN l.stage IN ('Booking Done', 'Retail Done') THEN 1 ELSE 0 END)::int AS won
         FROM users u
         LEFT JOIN leads l ON l.assigned_to = u.id
         WHERE u.role = 'sales' AND u.branch_id = ?
         GROUP BY u.id, u.name ORDER BY total DESC`,
         Number(branch_id)
      ));
    } else {
      res.json(await all(
        `SELECT b.id, b.name, COUNT(l.id)::int AS total,
                SUM(CASE WHEN l.status = 'open' THEN 1 ELSE 0 END)::int AS open,
                SUM(CASE WHEN l.stage IN ('Booking Done', 'Retail Done') THEN 1 ELSE 0 END)::int AS won
         FROM branches b
         LEFT JOIN leads l ON l.branch_id = b.id
         GROUP BY b.id, b.name ORDER BY total DESC`
      ));
    }
  } catch (e) { next(e); }
});

/* ---------------------------------------------------------- error handler */

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

/* ----------------------------------------------------------------- start */

initDb()
  .then(() => app.listen(PORT, () => console.log(`Follow-up CRM running on http://localhost:${PORT}`)))
  .catch(e => { console.error('DB init failed:', e.message); process.exit(1); });
