import express from 'express';
import Groq from 'groq-sdk';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pool, get, all, run, ins, hash, verify, initDb, seedClusterManagers } from './db.js';
import branchCodes from './demo-data/branch-codes.json' with { type: 'json' };
import { CLUSTER_MANAGER_DEFINITIONS } from './cluster-managers.js';
import {
  listOfficerContacts,
  normalizeOfficerName,
  officerContactKey,
  resolveOfficerContacts,
  saveOfficerContact,
  updateOfficerContact,
  deleteOfficerContact,
} from './sales-officer-contacts.js';

const PORT = process.env.PORT || 3000;

if (process.env.DEMO_MODE === '1') {
  const demoHost = String(process.env.DB_HOST || '').toLowerCase();
  const demoName = String(process.env.DB_NAME || '');
  if (!['localhost', '127.0.0.1', '::1'].includes(demoHost) || demoName !== 'followup_crm_demo') {
    throw new Error('Demo mode requires DB_HOST=localhost and DB_NAME=followup_crm_demo');
  }
}

if (!existsSync('.secret')) writeFileSync('.secret', randomBytes(32).toString('hex'));
const SECRET = process.env.SESSION_SECRET || readFileSync('.secret', 'utf8').trim();

export const OUTCOMES = {
  'Connected':     ['Need Test Drive', 'Showroom Visit', 'Exchange Issue', 'Booking Done', 'Retail Done', 'Customer Busy', 'Call Me Back', 'Details Received', 'Need time', 'Need SO Call', 'Need More Details', 'Discount Issue', 'Not Interested', 'Already Booked', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer'],
  'Not Connected': ['RNR', 'Switch Off', 'Call Me Back', 'Call Forwarding', 'Line Busy', 'Invalid Number', 'LOST RNR'],
};
const CLOSING = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer', 'LOST RNR']);
const LOST    = new Set(['Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer', 'LOST RNR']);
const LOST_RNR = 'LOST RNR';
const SOURCE_GROUP_SQL = `CASE
  WHEN LOWER(COALESCE(NULLIF(TRIM(s.name), ''), '')) LIKE '%referral%' THEN 'Referral'
  WHEN LOWER(COALESCE(NULLIF(TRIM(s.name), ''), '')) LIKE '%tkm%' THEN 'TKM'
  WHEN NULLIF(TRIM(s.name), '') IS NULL THEN 'Unknown'
  ELSE TRIM(s.name)
END`;
const MAX_DAYS_AHEAD = 3;
const clusterManagerScopes = new Map();
const clusterManagerScopeDetails = new Map();

function canonicalBranchInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (branchCodes[compact]) return branchCodes[compact];
  const name = raw.replace(/^nippon\s+toyota\s*-\s*/i, '').trim();
  return `Nippon Toyota - ${name}`;
}

async function loadClusterManagerScopes() {
  const branchNames = [...new Set(CLUSTER_MANAGER_DEFINITIONS.flatMap(manager => manager.branches))];
  const rows = branchNames.length
    ? await all('SELECT id, name FROM branches WHERE name = ANY(?)', branchNames)
    : [];
  const branchIds = new Map(rows.map(row => [row.name, Number(row.id)]));

  clusterManagerScopes.clear();
  clusterManagerScopeDetails.clear();
  for (const manager of CLUSTER_MANAGER_DEFINITIONS) {
    const assigned = manager.branches.flatMap(name => {
      const id = branchIds.get(name);
      if (!id) console.warn(`Cluster manager ${manager.username}: branch not found: ${name}`);
      return id ? [{ id, name }] : [];
    });
    clusterManagerScopes.set(manager.username, assigned.map(branch => branch.id));
    clusterManagerScopeDetails.set(manager.username, {
      configured: [...manager.branches],
      assigned,
      missing: manager.branches.filter(name => !branchIds.has(name)),
    });
  }
}

function clusterScopeFor(username) {
  return clusterManagerScopeDetails.get(username) || { configured: [], assigned: [], missing: [] };
}

function managerBranchIds(req) {
  if (req.user.role === 'cluster_manager')
    return clusterManagerScopes.get(req.user.username) || [];
  const branchId = req.user.role === 'sales_manager'
    ? Number(req.user.branch_id)
    : Number(req.query.branch_id || 0);
  return branchId ? [branchId] : [];
}

function branchFilter(column, branchIds) {
  if (branchIds.length === 1) return { sql: `${column} = ?`, args: [branchIds[0]] };
  if (branchIds.length > 1) return { sql: `${column} = ANY(?)`, args: [branchIds] };
  return { sql: '1 = 0', args: [] };
}

function canManagerAccessBranch(req, branchId) {
  return managerBranchIds(req).includes(Number(branchId));
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', {
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

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
    if (!u || !verify(String(password || '').trim(), u.password))
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
    res.json({
      ...u,
      today: today(),
      maxDate: addDays(today(), MAX_DAYS_AHEAD),
      outcomes: OUTCOMES,
      cluster_scope: u.role === 'cluster_manager' ? clusterScopeFor(u.username) : null,
    });
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

app.get('/api/masters/:type', auth('admin'), async (req, res, next) => {
  try {
    const t = MASTERS[req.params.type];
    if (!t) return bad(res, 'Unknown list');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const total = (await get(`SELECT COUNT(*)::int AS c FROM ${t}`))?.c || 0;
    const items = await all(`SELECT * FROM ${t} ORDER BY name LIMIT ? OFFSET ?`, limit, offset);
    res.json({ items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
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

app.get('/api/sales-officer-contacts', auth('admin'), async (req, res, next) => {
  try {
    res.json({ contacts: await listOfficerContacts(req.query.q) });
  } catch (e) { next(e); }
});

app.post('/api/sales-officer-contacts/resolve', auth('admin'), async (req, res, next) => {
  try {
    const contact = await saveOfficerContact(req.body?.name, req.body?.phone);
    res.json(contact);
  } catch (e) {
    if (e.message === 'Sales Officer name is required' || e.message === 'Phone must contain 10 digits') return bad(res, e.message);
    next(e);
  }
});

app.patch('/api/sales-officer-contacts/:id', auth('admin'), async (req, res, next) => {
  try {
    res.json(await updateOfficerContact(req.params.id, req.body?.phone));
  } catch (e) {
    if (e.message === 'Phone must contain 10 digits' || e.message === 'Sales Officer contact not found') return bad(res, e.message);
    next(e);
  }
});

app.delete('/api/sales-officer-contacts/:id', auth('admin'), async (req, res, next) => {
  try {
    await deleteOfficerContact(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'Sales Officer contact not found') return bad(res, e.message);
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
      
      const mapped = { mobile: m, so_name: String(r.so_name).trim(), so_mobile: r.so_mobile ? String(r.so_mobile).trim() : null };
      
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
          INSERT INTO salesforce_calls (mobile, so_name, so_mobile, created_at) 
          VALUES (?, ?, ?, TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
          ON CONFLICT (mobile) DO UPDATE SET 
            so_name = EXCLUDED.so_name,
            so_mobile = EXCLUDED.so_mobile,
            created_at = EXCLUDED.created_at
        `, r.mobile, r.so_name, r.so_mobile);
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const where = [], args = [];

    if (req.query.role) { where.push('u.role = ?'); args.push(req.query.role); }
    if (req.query.active === '1') { where.push('u.active = 1'); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get(`SELECT COUNT(*)::int AS c FROM users u ${whereSql}`, ...args))?.c || 0;
    const users = await all(
      `SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name AS branch
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       ${whereSql} ORDER BY u.role, u.name LIMIT ? OFFSET ?`,
      ...args, limit, offset,
    );
    res.json({
      users: users.map(user => ({
        ...user,
        cluster_scope: user.role === 'cluster_manager' ? clusterScopeFor(user.username) : null,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) { next(e); }
});

app.post('/api/users', auth('admin'), async (req, res, next) => {
  try {
    const { name, username, role, branch_id } = req.body || {};
    const password = String(req.body?.password || '').trim();
    if (!name?.trim() || !username?.trim() || !password || !['admin', 'call_guy', 'call_center_manager', 'sales_manager'].includes(role))
      return bad(res, 'Name, username, password and role are required');
    if (password.length < 6) return bad(res, 'Password must be at least 6 characters');
    if (['sales', 'manager', 'sales_manager'].includes(role) && !branch_id) return bad(res, 'A branch is required for this role');
    const id = await ins(
      `INSERT INTO users (username, password, name, role, branch_id) VALUES (?,?,?,?,?)`,
      String(username).trim().toLowerCase(), hash(password), name.trim(), role,
      ['sales', 'manager', 'sales_manager'].includes(role) ? Number(branch_id) : null,
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
    const target = await get(`SELECT role FROM users WHERE id = ?`, id);
    if (target?.role === 'cluster_manager') return bad(res, 'Cluster Manager accounts are fixed and cannot be changed here');
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

    const bMap = new Map(branches.flatMap(b => {
      const canonical = canonicalBranchInput(b.name).toLowerCase();
      const short = b.name.replace(/^nippon\s+toyota\s*-\s*/i, '').toLowerCase().trim();
      return [[b.name.toLowerCase().trim(), b.id], [canonical, b.id], [short, b.id]];
    }));
    const sMap = new Map(sources.map(s => [s.name.toLowerCase().trim(), s.id]));
    const mMap = new Map(models.map(m => [m.name.toLowerCase().trim(), m.id]));
    const aMap = new Map(activities.map(a => [a.name.toLowerCase().trim(), a.id]));

    const existingMobiles = new Set(existingLeads.map(l => l.mobile));
    const seen = new Set();
    const valid = [];
    const invalid = [];
    let duplicates = 0;

    const workbookPhones = new Map();
    const officerEntries = [];
    for (const r of rows) {
      const branch = canonicalBranchInput(r.branch);
      const key = officerContactKey(r.so_name, branch);
      if (normalizeOfficerName(r.so_name)) officerEntries.push({ name: r.so_name, branch });
      if (normalizeOfficerName(r.so_name) && r.so_mobile) workbookPhones.set(key, r.so_mobile);
    }
    const officerContacts = await resolveOfficerContacts(
      officerEntries,
      workbookPhones,
    );

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
      } else {
        // No usable mobile (e.g. an SO-only walk-in lead) — allowed through with a blank mobile.
        r.mobile = '';
      }

      const uploadedBranch = String(r.branch || '').trim();
      const bName = canonicalBranchInput(uploadedBranch);
      const sName = String(r.source || '').trim();
      const mName = String(r.model || '').trim();
      const aName = String(r.activity || '').trim();
      const soName = String(r.so_name || '').trim();
      const soKey = officerContactKey(soName, bName);
      const contact = officerContacts.get(soKey);
      if (contact) {
        r.so_name = contact.name;
        r.so_mobile = contact.phone;
      } else if (r.so_mobile) {
        r.so_mobile = String(r.so_mobile).replace(/\D/g, '').slice(-10);
        if (r.so_mobile.length !== 10) r.so_mobile = null;
      }
      
      const bId = bMap.get(bName.toLowerCase());
      const sId = sMap.get(sName.toLowerCase());
      const mId = mName ? mMap.get(mName.toLowerCase()) : null;
      const aId = aName ? aMap.get(aName.toLowerCase()) : null;

      const mapped = {
        ...r,
        original_branch: uploadedBranch,
        branch: bName,
        branch_id: bId || null,
        source_id: sId || null,
        model_id: mId || null,
        activity_id: aId || null,
        err_branch: !!bName && !bId,
        err_source: !!sName && !sId,
        err_model: !!mName && !mId,
        err_activity: !!aName && !aId,
        err_missing: !bName || !sName || !r.customer_name,
        err_so_name: false,
        warning_no_so: !!r.requires_so_contact && !soName,
        err_so_mobile: !!r.requires_so_contact && !!soName && !r.so_mobile,
      };

      if (mapped.err_branch || mapped.err_source || mapped.err_model || mapped.err_activity || mapped.err_missing || mapped.err_so_name || mapped.err_so_mobile) {
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
    const leads = Array.isArray(req.body) ? req.body : (req.body?.leads || []);
    const selectedCallGuys = Array.isArray(req.body) ? [] : (req.body?.call_guy_ids || []);
    if (!leads.length) return res.json({ ok: true, added: 0 });

    const callGuyIds = [...new Set((selectedCallGuys.length ? selectedCallGuys : leads.map(l => l.assigned_to))
      .map(Number).filter(Number.isInteger))];
    if (!callGuyIds.length) return bad(res, 'Select at least one Call Executive');
    const validCallGuys = await all(
      `SELECT id FROM users WHERE id = ANY(?) AND role = 'call_guy' AND active = 1`,
      callGuyIds,
    );
    if (validCallGuys.length !== callGuyIds.length) return bad(res, 'All selected users must be active Call Executives');

    const byBranch = {};
    for (const l of leads) {
      if (!byBranch[l.branch_id]) byBranch[l.branch_id] = [];
      byBranch[l.branch_id].push(l);
    }

    const leadRows = [];
    const sfRows = [];
    let globalIndex = 0;
    for (const branchId of Object.keys(byBranch)) {
      const branchLeads = byBranch[branchId];

      for (const l of branchLeads) {
        const assigned_to = callGuyIds[globalIndex++ % callGuyIds.length];
        const mobile = String(l.mobile).trim();
        leadRows.push([
          String(l.customer_name).trim(), mobile, Number(l.source_id), Number(branchId),
          l.location?.trim() || null, l.remarks?.trim() || null, req.user.id, assigned_to,
          l.model_id ? Number(l.model_id) : null, l.activity_id ? Number(l.activity_id) : null,
          l.so_name?.trim() || l.original_so_name?.trim() || null,
          l.so_mobile?.trim() || l.original_so_mobile?.trim() || null,
        ]);
        // mobile is unique in salesforce_calls — blank mobiles (SO-only leads) would collide with each other, so skip.
        if (mobile && l.so_name?.trim()) sfRows.push([mobile, l.so_name.trim(), l.so_mobile?.trim() || null, l.so_status?.trim() || null]);
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const leadValues = leadRows.flat();
      const leadPlaceholders = leadRows.map((_, row) => `(${Array.from({ length: 12 }, (_, col) => '$' + (row * 12 + col + 1)).join(',')})`).join(',');
      await client.query(`INSERT INTO leads (customer_name,mobile,source_id,branch_id,location,remarks,created_by,assigned_to,model_id,activity_id,original_so_name,original_so_mobile) VALUES ${leadPlaceholders}`, leadValues);
      if (sfRows.length) {
        const sfValues = sfRows.flat();
        const sfPlaceholders = sfRows.map((_, row) => `($${row * 4 + 1},$${row * 4 + 2},$${row * 4 + 3},$${row * 4 + 4},TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'))`).join(',');
        await client.query(`INSERT INTO salesforce_calls(mobile,so_name,so_mobile,status,created_at) VALUES ${sfPlaceholders}
          ON CONFLICT(mobile) DO UPDATE SET so_name=EXCLUDED.so_name,so_mobile=EXCLUDED.so_mobile,status=EXCLUDED.status,created_at=EXCLUDED.created_at`, sfValues);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
    res.json({ ok: true, added: leadRows.length });
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
    const { tab = 'all', q = '' } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const where = [], args = [];

    if (['sales', 'call_guy'].includes(req.user.role)) { where.push('l.assigned_to = ?'); args.push(req.user.id); }
    else if (req.user.role === 'marketing') { where.push('l.created_by = ?'); args.push(req.user.id); }
    else if (['manager', 'sales_manager'].includes(req.user.role)) { where.push('l.branch_id = ?'); args.push(req.user.branch_id); }

    if (tab === 'fresh') where.push(`l.status = 'open' AND l.fcount = 0`);
    else if (tab === 'today') { where.push(`l.status = 'open' AND l.fcount > 0 AND l.next_date <= ?`); args.push(today()); }

    const search = String(q).trim();
    if (search) {
      const pat = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
      where.push(`(l.customer_name ILIKE ? OR l.mobile ILIKE ?)`);
      args.push(pat, pat);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get(`SELECT COUNT(*)::int AS c FROM leads l ${whereSql}`, ...args))?.c || 0;
    const leads = await all(
      `${LEAD_SELECT} ${whereSql} ORDER BY l.next_date NULLS FIRST, l.id DESC LIMIT ? OFFSET ?`,
      ...args, limit, offset,
    );
    const visibleLeads = req.user.role === 'call_center_manager'
      ? leads.map(({ is_flagged, flag_remarks, ...lead }) => lead)
      : leads;
    res.json({ leads: visibleLeads, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { next(e); }
});

app.get('/api/manager/analytics', auth('manager', 'admin'), async (req, res, next) => {
  try {
    const branchId = req.user.branch_id;
    if (!branchId) return bad(res, 'No branch assigned');

    const [kpi, byOfficer, outcomes, byStage, overdue, officerOutcomes, flagged, lostCases, flagHistory] = await Promise.all([
      get(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE l.fcount = 0 AND l.status = 'open')::int AS untouched,
        COUNT(*) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
        COUNT(*) FILTER (WHERE l.stage = 'Lost Lead'    AND l.status = 'closed')::int AS lost,
        COUNT(*) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
        COUNT(*) FILTER (WHERE l.stage = 'Retail Done'  AND l.status = 'closed')::int AS retailed
       FROM leads l WHERE l.branch_id = ?`, branchId),

      all(`SELECT u.name AS officer,
        COUNT(l.id)::int AS total,
        COUNT(l.id) FILTER (WHERE l.fcount = 0 AND l.status = 'open')::int AS untouched,
        COUNT(l.id) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
        COUNT(l.id) FILTER (WHERE l.next_date = ? AND l.status = 'open')::int AS today_followup,
        COUNT(l.id) FILTER (WHERE l.stage = 'Lost Lead'    AND l.status = 'closed')::int AS lost,
        COUNT(l.id) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
        COUNT(l.id) FILTER (WHERE l.stage = 'Retail Done'  AND l.status = 'closed')::int AS retailed
       FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
       WHERE u.branch_id = ? AND u.role = 'sales' AND u.active = 1
       GROUP BY u.id, u.name ORDER BY u.name`, today(), branchId),

      all(`SELECT f.call_status, f.outcome, COUNT(*)::int AS cnt
       FROM (
         SELECT DISTINCT ON (f2.lead_id) f2.lead_id, f2.call_status, f2.outcome
         FROM followups f2
         JOIN leads l2 ON l2.id = f2.lead_id
         WHERE l2.branch_id = ?
        ORDER BY f2.lead_id, f2.created_at DESC, f2.id DESC
       ) f
       GROUP BY f.call_status, f.outcome
       ORDER BY f.call_status, cnt DESC`, branchId),

      all(`SELECT u.id AS officer_id, u.name AS officer,
        COUNT(l.id) FILTER (WHERE l.status = 'open' AND l.fcount > 0)::int AS pending,
        COUNT(l.id) FILTER (WHERE l.fcount = 1 AND l.status = 'open')::int AS f1,
        COUNT(l.id) FILTER (WHERE l.fcount = 2 AND l.status = 'open')::int AS f2,
        COUNT(l.id) FILTER (WHERE l.fcount = 3 AND l.status = 'open')::int AS f3,
        COUNT(l.id) FILTER (WHERE l.fcount = 4 AND l.status = 'open')::int AS f4,
        COUNT(l.id) FILTER (WHERE l.fcount >= 5 AND l.status = 'open')::int AS f5plus
       FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
       WHERE u.branch_id = ? AND u.role = 'sales' AND u.active = 1
       GROUP BY u.id, u.name ORDER BY u.name`, branchId),

      all(`SELECT u.name AS officer,
        COUNT(l.id)::int AS overdue
       FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
         AND l.status = 'open' AND l.fcount > 0 AND l.next_date < ?
       WHERE u.branch_id = ? AND u.role = 'sales' AND u.active = 1
       GROUP BY u.id, u.name ORDER BY overdue DESC, u.name`, today(), branchId),

      all(`SELECT
        MIN(sc.so_name) AS so_name,
        COUNT(DISTINCT l.id)::int AS total,
        COUNT(f.id)::int AS total_calls,
        COUNT(f.id) FILTER (WHERE f.call_status = 'Connected')::int                                                        AS connected,
        COUNT(f.id) FILTER (WHERE f.call_status = 'Not Connected')::int                                                    AS not_connected,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Need Test Drive')::int                                                      AS need_test_drive,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Showroom Visit')::int                                                       AS showroom_visit,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Booking Done')::int                                                         AS booking_done,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Retail Done')::int                                                          AS retail_done,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Customer Busy')::int                                                        AS customer_busy,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Details Received')::int                                                     AS details_received,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Need time')::int                                                            AS need_time,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Need SO Call')::int                                                         AS need_so_call,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Need More Details')::int                                                    AS need_more_details,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Exchange Issue')::int                                                       AS exchange_issue,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Discount Issue')::int                                                       AS discount_issue,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Not Interested')::int                                                       AS not_interested,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Already Booked')::int                                                       AS already_booked,
        COUNT(f.id) FILTER (WHERE f.outcome IN ('Lost to Competition','Finance Rejected','Dropped','Lost to co-dealer'))::int AS lost_calls,
        COUNT(f.id) FILTER (WHERE f.outcome = 'LOST RNR')::int                                                               AS lost_rnr,
        COUNT(f.id) FILTER (WHERE f.outcome = 'RNR')::int                                                                  AS rnr,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Switch Off')::int                                                           AS switch_off,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Call Me Back')::int                                                         AS call_me_back,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Call Forwarding')::int                                                      AS call_forwarding,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Line Busy')::int                                                            AS line_busy,
        COUNT(f.id) FILTER (WHERE f.outcome = 'Invalid Number')::int                                                       AS invalid_number
       FROM salesforce_calls sc
       JOIN leads l ON l.mobile = sc.mobile AND l.branch_id = ?
       LEFT JOIN followups f ON f.lead_id = l.id
       GROUP BY COALESCE(sc.so_mobile, sc.so_name)
       ORDER BY total DESC`, branchId),

      all(`SELECT u.id AS officer_id, u.name AS officer, COUNT(l.id)::int AS flagged
           FROM users u
           LEFT JOIN leads l ON l.assigned_to = u.id AND (l.is_flagged = 1 OR l.flag_remarks IS NOT NULL)
           WHERE u.branch_id = ? AND u.role = 'sales' AND u.active = 1
           GROUP BY u.id, u.name
           HAVING COUNT(l.id) > 0
           ORDER BY flagged DESC`, branchId),

      all(`SELECT f.outcome, COUNT(*)::int AS cnt
           FROM (
             SELECT DISTINCT ON (f2.lead_id) f2.lead_id, f2.outcome
             FROM followups f2
             JOIN leads l2 ON l2.id = f2.lead_id
             WHERE l2.branch_id = ?
           ORDER BY f2.lead_id, f2.created_at DESC, f2.id DESC
           ) f
           WHERE f.outcome IN ('Not Interested','Lost to Competition','Finance Rejected','Dropped','Lost to co-dealer','LOST RNR')
           GROUP BY f.outcome
           ORDER BY cnt DESC`, branchId),

      all(`SELECT l.id, l.customer_name, l.mobile, l.fcount, l.is_flagged, l.flag_remarks,
                  u.name AS officer, sc.so_name, l.stage, l.status
           FROM leads l
           LEFT JOIN users            u  ON u.id      = l.assigned_to
           LEFT JOIN salesforce_calls sc ON sc.mobile  = l.mobile
           WHERE l.branch_id = ? AND (l.is_flagged = 1 OR l.flag_remarks IS NOT NULL)
           ORDER BY l.is_flagged DESC, l.id DESC`, branchId),
    ]);

    res.json({ kpi, byOfficer, outcomes, byStage, overdue, officerOutcomes, flagged, lostCases, flagHistory });
  } catch (e) { next(e); }
});

app.get('/api/manager/leads/export', auth('manager', 'admin'), async (req, res, next) => {
  try {
    const branchId = req.user.branch_id;
    if (!branchId) return bad(res, 'No branch assigned');
    const leads = await all(`
      SELECT l.customer_name, l.mobile, b.name AS branch, s.name AS source,
             u.name AS officer, sc.so_name, l.fcount, l.stage, l.status, l.next_date,
             l.location, l.remarks AS lead_remarks, l.created_at,
             f.call_status AS latest_call_status, f.outcome AS latest_outcome,
             f.remarks AS latest_remarks, f.created_at AS latest_call_date
      FROM leads l
      LEFT JOIN users          u  ON u.id  = l.assigned_to
      LEFT JOIN branches       b  ON b.id  = l.branch_id
      LEFT JOIN sources        s  ON s.id  = l.source_id
      LEFT JOIN salesforce_calls sc ON sc.mobile = l.mobile
      LEFT JOIN LATERAL (
        SELECT call_status, outcome, remarks, created_at
        FROM followups WHERE lead_id = l.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) f ON true
      WHERE l.branch_id = ? AND l.fcount > 0
      ORDER BY l.next_date NULLS FIRST, l.id DESC
    `, branchId);
    res.json(leads);
  } catch (e) { next(e); }
});

app.get('/api/manager/ai-lost-summary', auth('manager', 'admin'), async (req, res, next) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured in the server environment' });
    }

    // Admin can pass branch_id as query param; manager uses their assigned branch
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : req.user.branch_id;

    // Fetch remarks from followups where outcome is a lost outcome
    const branchFilter = branchId ? 'AND l.branch_id = $1' : '';
    const branchArgs = branchId ? [branchId] : [];
    const lostFollowups = await all(`
      SELECT f.remarks, f.outcome, l.customer_name
      FROM followups f
      JOIN leads l ON l.id = f.lead_id
      WHERE f.outcome IN ('Not Interested','Lost to Competition','Finance Rejected','Dropped','Lost to co-dealer','LOST RNR')
        AND f.remarks IS NOT NULL
        ${branchFilter}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT 100
    `, ...branchArgs);

    if (lostFollowups.length === 0) {
      return res.json({ summary: 'No recent lost leads remarks available for analysis.' });
    }

    const groq = new Groq({ apiKey });

    const remarksText = lostFollowups
      .map(f => `[Reason: ${f.outcome}] Customer: ${f.customer_name} - Remarks: ${f.remarks}`)
      .join('\n');

    const totalLost = lostFollowups.length;
    const reasonCounts = {};
    for (const f of lostFollowups) {
      reasonCounts[f.outcome] = (reasonCounts[f.outcome] || 0) + 1;
    }
    const breakdownLine = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `${r}: ${c}`)
      .join(', ');

    const prompt = `You are a business analyst for an automobile dealership CRM. Below are ${totalLost} recent lost lead records with their loss reasons and sales officer remarks.

Loss reason breakdown: ${breakdownLine}

OUTPUT FORMAT — follow this EXACTLY:
- Start each point on a new line beginning with the ~ character.
- Each point should be one concise sentence.
- Include exact numbers and percentages in every point.
- Do NOT use asterisks, hashtags, bold markers, markdown, or any other formatting.
- Do NOT use numbered lists or sub-bullets.
- Do NOT include section headings.
- Do NOT include recommendations or suggestions.

CONTENT RULES:
- First 3 to 4 points: top loss reasons with count and percentage out of ${totalLost} total.
- Next 1 to 2 points: correlations or patterns found across the remarks (e.g. finance + drop-off link, pricing gaps).
- Last 1 to 2 points: specific competitor names or recurring objections mentioned in remarks.
- Maximum 8 points total. Keep each point under 25 words.

Remarks data:
${remarksText}`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'openai/gpt-oss-20b',
      temperature: 0.3,
      max_completion_tokens: 2048,
      reasoning_effort: 'low',
      include_reasoning: false,
    });

    let summary = chatCompletion.choices[0]?.message?.content || 'Unable to generate summary.';
    // Clean stray markdown but preserve ~ bullet markers
    summary = summary.replace(/\*+/g, '').replace(/^#+\s*/gm, '').trim();
    res.json({ summary });

  } catch (e) {
    console.error('Groq AI Error:', e);
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

app.get('/api/call-center/leads/export', auth('call_center_manager', 'admin'), async (req, res, next) => {
  try {
    const leads = await all(`
      SELECT l.customer_name, l.mobile, b.name AS branch, s.name AS source,
             u.name AS officer, sc.so_name, l.fcount, l.stage, l.status, l.next_date,
             l.location, l.remarks AS lead_remarks, l.created_at,
             f.call_status AS latest_call_status, f.outcome AS latest_outcome,
             f.remarks AS latest_remarks, f.created_at AS latest_call_date
      FROM leads l
      LEFT JOIN users          u  ON u.id  = l.assigned_to
      LEFT JOIN branches       b  ON b.id  = l.branch_id
      LEFT JOIN sources        s  ON s.id  = l.source_id
      LEFT JOIN salesforce_calls sc ON sc.mobile = l.mobile
      LEFT JOIN LATERAL (
        SELECT call_status, outcome, remarks, created_at
        FROM followups WHERE lead_id = l.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) f ON true
      WHERE l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')
        AND l.fcount > 0
      ORDER BY l.next_date NULLS FIRST, l.id DESC
    `);
    res.json(leads);
  } catch (e) { next(e); }
});

app.get('/api/manager/leads', auth('manager', 'call_center_manager', 'admin'), async (req, res, next) => {
  try {
    const branchId = req.user.branch_id;
    const isCallCenter = req.user.role === 'call_center_manager' ||
      (req.user.role === 'admin' && req.query.scope === 'call_center');
    if (!isCallCenter && !branchId) return bad(res, 'No branch assigned');
    const scopeSql = isCallCenter
      ? `l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')`
      : `l.branch_id = ?`;
    const scopeArgs = isCallCenter ? [] : [branchId];
    const { officer_id, stage, call_status, outcome, latest_outcome, flagged, overdue, call_guy_id, branch_id, bucket, source_group, quality_metric } = req.query;
    if (req.user.role === 'call_center_manager' && flagged === '1')
      return res.status(403).json({ error: 'Flag review is handled by Sales Managers' });
    const flagFields = req.user.role === 'call_center_manager'
      ? ''
      : 'l.is_flagged, l.flag_remarks,';

    const BASE = `
      SELECT l.id, l.customer_name, l.mobile, l.fcount, l.next_date, l.stage,
             l.location, l.remarks, l.created_at, ${flagFields}
             u.name AS officer, b.name AS branch, s.name AS source
      FROM leads l
      LEFT JOIN users    u ON u.id = l.assigned_to
      LEFT JOIN branches b ON b.id = l.branch_id
      LEFT JOIN sources  s ON s.id = l.source_id`;

    let leads;
    if (overdue === '1') {
      if (!isCallCenter || !Number.isInteger(Number(call_guy_id)) || Number(call_guy_id) < 1)
        return bad(res, 'A valid Call Executive is required');
      leads = await all(`${BASE}
        WHERE ${scopeSql} AND l.assigned_to = ? AND l.status = 'open' AND l.next_date < ?
        ORDER BY l.next_date ASC, l.id DESC
      `, ...scopeArgs, Number(call_guy_id), today());
    } else if (isCallCenter && (bucket || call_guy_id || branch_id || source_group || quality_metric)) {
      const BUCKET_FILTERS = {
        total:    '1 = 1',
        open:     `l.status = 'open'`,
        untouched: `l.fcount = 0 AND l.status = 'open'`,
        followup:  `l.fcount > 0 AND l.status = 'open'`,
        due:       `l.status = 'open' AND l.next_date <= ?`,
        overdue:   `l.status = 'open' AND l.next_date < ?`,
        booked:    `l.stage = 'Booking Done' AND l.status = 'closed'`,
        retailed:  `l.stage = 'Retail Done' AND l.status = 'closed'`,
        won:       `l.stage IN ('Booking Done', 'Retail Done')`,
        lost:      `l.stage = 'Lost Lead' AND l.status = 'closed'`,
        f1:        `l.fcount = 1 AND l.status = 'open'`,
        f2:        `l.fcount = 2 AND l.status = 'open'`,
        f3:        `l.fcount = 3 AND l.status = 'open'`,
        f4:        `l.fcount = 4 AND l.status = 'open'`,
        f5:        `l.fcount = 5 AND l.status = 'open'`,
        f6plus:    `l.fcount >= 6 AND l.status = 'open'`,
        f5plus:    `l.fcount >= 5 AND l.status = 'open'`,
      };
      const QUALITY_FILTERS = {
        total:        '1 = 1',
        attempted:    'l.fcount > 0',
        connected:    `EXISTS (SELECT 1 FROM followups f WHERE f.lead_id = l.id AND f.call_status = 'Connected')`,
        open_followup:`l.status = 'open' AND l.fcount > 0`,
        booked:       `l.stage = 'Booking Done' AND l.status = 'closed'`,
        retailed:     `l.stage = 'Retail Done' AND l.status = 'closed'`,
        won:          `l.stage IN ('Booking Done', 'Retail Done')`,
        lost:         `l.stage = 'Lost Lead' AND l.status = 'closed'`,
        lost_rnr:     `EXISTS (SELECT 1 FROM followups f WHERE f.lead_id = l.id AND f.outcome = 'LOST RNR')`,
        overdue:      `l.status = 'open' AND l.fcount > 0 AND l.next_date < ?`,
      };
      const bucketSql = BUCKET_FILTERS[bucket || 'total'];
      if (!bucketSql) return bad(res, 'Invalid Call Center filter');
      const filters = [scopeSql, bucketSql];
      const args = [...scopeArgs];
      if (['due', 'overdue'].includes(bucket || '')) args.push(today());
      if (call_guy_id) {
        if (!Number.isInteger(Number(call_guy_id)) || Number(call_guy_id) < 1)
          return bad(res, 'Invalid Call Executive');
        filters.push('l.assigned_to = ?');
        args.push(Number(call_guy_id));
      }
      if (branch_id) {
        if (!Number.isInteger(Number(branch_id)) || Number(branch_id) < 1)
          return bad(res, 'Invalid branch');
        filters.push('l.branch_id = ?');
        args.push(Number(branch_id));
      }
      if (source_group !== undefined) {
        const sourceGroup = String(source_group).trim();
        if (!sourceGroup || sourceGroup.length > 80)
          return bad(res, 'Invalid source group');
        filters.push(`${SOURCE_GROUP_SQL} = ?`);
        args.push(sourceGroup);
      }
      if (quality_metric !== undefined) {
        const qualitySql = QUALITY_FILTERS[String(quality_metric)];
        if (!qualitySql) return bad(res, 'Invalid source quality metric');
        filters.push(qualitySql);
        if (quality_metric === 'overdue') args.push(today());
      }
      leads = await all(`${BASE}
        WHERE ${filters.join(' AND ')}
        ORDER BY l.next_date NULLS FIRST, l.id DESC
      `, ...args);
    } else if (flagged === '1' && officer_id) {
      leads = await all(`${BASE}
        WHERE ${scopeSql} AND l.assigned_to = ? AND (l.is_flagged = 1 OR l.flag_remarks IS NOT NULL)
        ORDER BY l.id DESC
      `, ...scopeArgs, Number(officer_id));
    } else if (call_status && outcome) {
      leads = await all(`${BASE}
        WHERE ${scopeSql}
          AND (SELECT f.call_status FROM followups f WHERE f.lead_id = l.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) = ?
          AND (SELECT f.outcome     FROM followups f WHERE f.lead_id = l.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) = ?
        ORDER BY l.next_date NULLS FIRST, l.id DESC
      `, ...scopeArgs, call_status, outcome);
    } else if (latest_outcome) {
      leads = await all(`${BASE}
        WHERE ${scopeSql}
          AND (SELECT f.outcome FROM followups f WHERE f.lead_id = l.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) = ?
        ORDER BY l.next_date NULLS FIRST, l.id DESC
      `, ...scopeArgs, latest_outcome);
    } else {
      if (isCallCenter) return bad(res, 'A drill-down filter is required');
      if (!officer_id) return bad(res, 'officer_id required');
      const STAGE_FILTER = {
        pending: `l.fcount > 0 AND l.status = 'open'`,
        f1:      `l.fcount = 1 AND l.status = 'open'`,
        f2:      `l.fcount = 2 AND l.status = 'open'`,
        f3:      `l.fcount = 3 AND l.status = 'open'`,
        f4:      `l.fcount = 4 AND l.status = 'open'`,
        f5plus:  `l.fcount >= 5 AND l.status = 'open'`,
      };
      const stageSql = STAGE_FILTER[stage];
      if (!stageSql) return bad(res, 'Invalid stage');
      leads = await all(`${BASE}
        WHERE ${scopeSql} AND l.assigned_to = ? AND ${stageSql}
        ORDER BY l.next_date NULLS FIRST, l.id DESC
      `, ...scopeArgs, Number(officer_id));
    }
    res.json(leads);
  } catch (e) { next(e); }
});

app.get('/api/leads/stats', auth(), async (req, res, next) => {
  try {
    const isSales = ['sales', 'call_guy'].includes(req.user.role);
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
    if (['sales', 'call_guy'].includes(req.user.role) && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    if (req.user.role === 'marketing' && lead.created_by !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    if (['manager', 'sales_manager'].includes(req.user.role) && lead.branch_id !== req.user.branch_id)
      return res.status(403).json({ error: 'Not your branch' });
    if (req.user.role === 'cluster_manager' && !canManagerAccessBranch(req, lead.branch_id))
      return res.status(403).json({ error: 'Not your branch' });

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
      `SELECT so_name, so_mobile, created_at FROM salesforce_calls WHERE mobile = ? ORDER BY id DESC`,
      lead.mobile
    );
    if (['call_center_manager', 'cluster_manager'].includes(req.user.role)) {
      delete lead.is_flagged;
      delete lead.flag_remarks;
    }
    res.json(lead);
  } catch (e) { next(e); }
});

app.post('/api/leads/:id/followup', auth('sales', 'call_guy', 'admin'), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = ?`, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (['sales', 'call_guy'].includes(req.user.role) && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    if (lead.status !== 'open') return bad(res, 'This lead is already closed');

    const { call_status, outcome, next_date, remarks, model_id, activity_id, other_so_called, order_id, tally_receipt, test_drive_date, exchange_expected_price, exchange_offered_price } = req.body || {};
    if (!OUTCOMES[call_status]) return bad(res, 'Select Connected or Not Connected');
    if (!OUTCOMES[call_status].includes(outcome)) return bad(res, 'Select a valid outcome');
    if (outcome === LOST_RNR && !['call_guy', 'admin'].includes(req.user.role))
      return res.status(403).json({ error: 'Only Call Executives can close a lead as LOST RNR' });
    if (outcome === LOST_RNR && call_status !== 'Not Connected')
      return bad(res, 'LOST RNR is only valid for a Not Connected call');
    if (outcome === LOST_RNR && lead.fcount < 3)
      return bad(res, 'LOST RNR is available only after three follow-ups');

    if (outcome === 'Exchange Issue' && !String(exchange_expected_price || '').trim()) return bad(res, 'Expected price is required');
    if (outcome === 'Exchange Issue' && !String(exchange_offered_price || '').trim()) return bad(res, 'Offered price is required');

    const testDriveDate = String(test_drive_date || '').trim();
    if (outcome === 'Need Test Drive' && testDriveDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(testDriveDate) || testDriveDate < today() || testDriveDate > addDays(today(), MAX_DAYS_AHEAD)))
      return bad(res, `Test Drive Date must be between ${today()} and ${addDays(today(), MAX_DAYS_AHEAD)}`);

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
      `INSERT INTO followups (lead_id, user_id, seq, call_status, outcome, model_id, activity_id, next_date, remarks, other_so_called, order_id, tally_receipt, test_drive_date, exchange_expected_price, exchange_offered_price)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      lead.id, req.user.id, seq, call_status, outcome,
      model_id ? Number(model_id) : null, activity_id ? Number(activity_id) : null,
      nd, remarks?.trim() || null, other_so_called?.trim() || null,
      order_id?.trim() || null, tally_receipt?.trim() || null,
      outcome === 'Need Test Drive' ? testDriveDate || null : null,
      outcome === 'Exchange Issue' ? String(exchange_expected_price).trim() : null,
      outcome === 'Exchange Issue' ? String(exchange_offered_price).trim() : null,
    );
    await run(
      `UPDATE leads SET fcount = ?, stage = ?, next_date = ?, status = ? WHERE id = ?`,
      seq, stage, nd, closing ? 'closed' : 'open', lead.id,
    );
    res.json({ ok: true, seq, closed: closing });
  } catch (e) { next(e); }
});

app.post('/api/leads/:id/order-id', auth('sales', 'call_guy', 'admin'), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = ?`, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (['sales', 'call_guy'].includes(req.user.role) && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });

    const order_id = String(req.body?.order_id || '').trim();
    if (!order_id) return bad(res, 'Order ID is required');

    const fu = await get(
      `SELECT id FROM followups WHERE lead_id = ? AND outcome = 'Booking Done' ORDER BY seq DESC LIMIT 1`,
      lead.id,
    );
    if (!fu) return bad(res, 'No Booking Done follow-up found for this lead');

    await run(`UPDATE followups SET order_id = ? WHERE id = ?`, order_id, fu.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/leads/:id/flag', auth('sales', 'call_guy', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lead = await get(`SELECT assigned_to, is_flagged FROM leads WHERE id = ?`, id);
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (['sales', 'call_guy'].includes(req.user.role) && lead.assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Not your lead' });
    const newFlag = lead.is_flagged ? 0 : 1;
    await run(`UPDATE leads SET is_flagged = ? WHERE id = ?`, newFlag, id);
    res.json({ ok: true, is_flagged: newFlag });
  } catch (e) { next(e); }
});

app.post('/api/leads/:id/close-flag', auth('manager', 'sales_manager', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { remarks } = req.body || {};
    if (['manager', 'sales_manager'].includes(req.user.role)) {
      const lead = await get(`SELECT branch_id FROM leads WHERE id = ?`, id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (lead.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'Not your branch' });
    }
    await run(`UPDATE leads SET is_flagged = 0, flag_remarks = ? WHERE id = ?`, typeof remarks === 'string' ? remarks.trim() : '', id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------- repurposed dashboards */

function sourceQualityRow(row) {
  const leads = Number(row.leads) || 0;
  const attempted = Number(row.attempted) || 0;
  const connected = Number(row.connected) || 0;
  const booked = Number(row.booked) || 0;
  const retailed = Number(row.retailed) || 0;
  return {
    branch_id: row.branch_id == null ? null : Number(row.branch_id),
    branch: row.branch || null,
    source_group: row.source_group || null,
    raw_sources: Array.isArray(row.raw_sources) ? row.raw_sources : [],
    leads,
    attempted,
    connected,
    contact_rate: leads ? connected / leads : null,
    open_followup: Number(row.open_followup) || 0,
    booked,
    retailed,
    won_rate: leads ? (booked + retailed) / leads : null,
    lost: Number(row.lost) || 0,
    lost_rnr: Number(row.lost_rnr) || 0,
    average_followups: row.average_followups == null ? 0 : Number(row.average_followups) || 0,
    overdue: Number(row.overdue) || 0,
  };
}

function highestSourceQualityRow(rows, key) {
  return [...rows].sort((a, b) =>
    Number(b[key] || 0) - Number(a[key] || 0) ||
    Number(b.leads || 0) - Number(a.leads || 0) ||
    String(a.source_group || '').localeCompare(String(b.source_group || ''))
  )[0] || null;
}

function sourceQualityAttention(sources) {
  const eligible = sources.filter(row => row.leads >= 20);
  const volume = highestSourceQualityRow(sources, 'leads');
  const conversion = eligible.length ? highestSourceQualityRow(eligible, 'won_rate') : null;
  const overdue = highestSourceQualityRow(sources, 'overdue');
  const unknown = sources.find(row => row.source_group === 'Unknown') || null;
  return {
    volume: volume ? { source_group: volume.source_group, leads: volume.leads } : null,
    conversion: conversion ? {
      source_group: conversion.source_group,
      leads: conversion.leads,
      won_rate: conversion.won_rate,
    } : null,
    conversion_unavailable: !conversion,
    overdue: overdue?.overdue ? { source_group: overdue.source_group, overdue: overdue.overdue } : null,
    unknown: unknown?.leads ? { source_group: unknown.source_group, leads: unknown.leads } : null,
  };
}

app.get('/api/call-center/source-quality', auth('call_center_manager', 'admin'), async (req, res, next) => {
  try {
    const rawBranchId = String(req.query.branch_id ?? '').trim();
    let branchId = null;
    if (rawBranchId) {
      if (!/^\d+$/.test(rawBranchId) || Number(rawBranchId) < 1)
        return bad(res, 'Invalid branch');
      branchId = Number(rawBranchId);
    }

    const rows = await all(`
      WITH requested_branch AS (
        SELECT id, name FROM branches WHERE id = ?
      ),
      params AS (
        SELECT (SELECT id FROM requested_branch) AS requested_id,
               (SELECT name FROM requested_branch) AS requested_name
      ),
      scoped AS (
        SELECT l.id, l.branch_id, b.name AS branch, l.fcount, l.status, l.stage, l.next_date,
               NULLIF(TRIM(s.name), '') AS raw_source,
               ${SOURCE_GROUP_SQL} AS source_group
        FROM leads l
        LEFT JOIN branches b ON b.id = l.branch_id
        LEFT JOIN sources s ON s.id = l.source_id
        CROSS JOIN params
        WHERE l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')
          AND (params.requested_id IS NULL OR l.branch_id = params.requested_id)
      ),
      history AS (
        SELECT f.lead_id,
               BOOL_OR(f.call_status = 'Connected') AS connected,
               BOOL_OR(f.outcome = 'LOST RNR') AS lost_rnr
        FROM followups f
        JOIN scoped s ON s.id = f.lead_id
        GROUP BY f.lead_id
      ),
      grouped AS (
        SELECT GROUPING(s.branch_id)::int AS all_branches,
               GROUPING(s.source_group)::int AS all_sources,
               s.branch_id, s.branch, s.source_group,
               ARRAY_AGG(DISTINCT s.raw_source ORDER BY s.raw_source)
                 FILTER (WHERE s.raw_source IS NOT NULL) AS raw_sources,
               COUNT(*)::int AS leads,
               COUNT(*) FILTER (WHERE s.fcount > 0)::int AS attempted,
               COUNT(*) FILTER (WHERE h.connected)::int AS connected,
               COUNT(*) FILTER (WHERE s.status = 'open' AND s.fcount > 0)::int AS open_followup,
               COUNT(*) FILTER (WHERE s.stage = 'Booking Done' AND s.status = 'closed')::int AS booked,
               COUNT(*) FILTER (WHERE s.stage = 'Retail Done' AND s.status = 'closed')::int AS retailed,
               COUNT(*) FILTER (WHERE s.stage = 'Lost Lead' AND s.status = 'closed')::int AS lost,
               COUNT(*) FILTER (WHERE h.lost_rnr)::int AS lost_rnr,
               ROUND(AVG(s.fcount)::numeric, 2) AS average_followups,
               COUNT(*) FILTER (WHERE s.status = 'open' AND s.fcount > 0 AND s.next_date < ?)::int AS overdue
        FROM scoped s
        LEFT JOIN history h ON h.lead_id = s.id
        GROUP BY GROUPING SETS ((), (s.source_group), (s.branch_id, s.branch, s.source_group))
      )
      SELECT grouped.*, params.requested_id AS requested_branch_id,
             params.requested_name AS requested_branch_name
      FROM grouped CROSS JOIN params
      ORDER BY all_branches DESC, all_sources DESC, leads DESC, branch, source_group
    `, branchId, today());

    if (branchId && rows[0]?.requested_branch_id == null)
      return bad(res, 'Invalid branch');

    const normalized = rows.map(sourceQualityRow);
    const summaryRow = normalized.find((_, index) =>
      Number(rows[index].all_branches) === 1 && Number(rows[index].all_sources) === 1
    ) || sourceQualityRow({});
    const sources = normalized.filter((_, index) =>
      Number(rows[index].all_branches) === 1 && Number(rows[index].all_sources) === 0
    );
    const branches = normalized.filter((_, index) => Number(rows[index].all_branches) === 0);
    res.json({
      summary: summaryRow,
      sources,
      branches,
      attention: sourceQualityAttention(sources),
      branchId,
      branchName: rows[0]?.requested_branch_name || null,
    });
  } catch (e) { next(e); }
});

app.get('/api/call-center/analytics', auth('call_center_manager', 'admin'), async (req, res, next) => {
  try {
    const day = today();
    const includeFlags = req.user.role === 'admin';
    const [kpi, byCallGuy, outcomes, byBranch, overdue, flagged] = await Promise.all([
      get(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE fcount = 0 AND status = 'open')::int AS untouched,
          COUNT(*) FILTER (WHERE fcount > 0 AND status = 'open')::int AS followup,
          COUNT(*) FILTER (WHERE next_date < ? AND status = 'open')::int AS overdue,
          COUNT(*) FILTER (WHERE stage = 'Booking Done' AND status = 'closed')::int AS booked,
          COUNT(*) FILTER (WHERE stage = 'Retail Done' AND status = 'closed')::int AS retailed,
          COUNT(*) FILTER (WHERE stage = 'Lost Lead' AND status = 'closed')::int AS lost,
          COUNT(*) FILTER (WHERE fcount = 1 AND status = 'open')::int AS f1,
          COUNT(*) FILTER (WHERE fcount = 2 AND status = 'open')::int AS f2,
          COUNT(*) FILTER (WHERE fcount = 3 AND status = 'open')::int AS f3,
          COUNT(*) FILTER (WHERE fcount = 4 AND status = 'open')::int AS f4,
          COUNT(*) FILTER (WHERE fcount = 5 AND status = 'open')::int AS f5,
          COUNT(*) FILTER (WHERE fcount >= 6 AND status = 'open')::int AS f6plus
        FROM leads WHERE assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')`, day),
      all(`SELECT u.id, u.name AS call_guy, COUNT(l.id)::int AS total,
          COUNT(l.id) FILTER (WHERE l.fcount = 0 AND l.status = 'open')::int AS untouched,
          COUNT(l.id) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
          COUNT(l.id) FILTER (WHERE l.next_date <= ? AND l.status = 'open')::int AS due,
          COUNT(l.id) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
          COUNT(l.id) FILTER (WHERE l.stage = 'Retail Done' AND l.status = 'closed')::int AS retailed,
          COUNT(l.id) FILTER (WHERE l.stage = 'Lost Lead' AND l.status = 'closed')::int AS lost,
          COUNT(l.id) FILTER (WHERE l.fcount = 1 AND l.status = 'open')::int AS f1,
          COUNT(l.id) FILTER (WHERE l.fcount = 2 AND l.status = 'open')::int AS f2,
          COUNT(l.id) FILTER (WHERE l.fcount = 3 AND l.status = 'open')::int AS f3,
          COUNT(l.id) FILTER (WHERE l.fcount = 4 AND l.status = 'open')::int AS f4,
          COUNT(l.id) FILTER (WHERE l.fcount = 5 AND l.status = 'open')::int AS f5,
          COUNT(l.id) FILTER (WHERE l.fcount >= 6 AND l.status = 'open')::int AS f6plus
        FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
        WHERE u.role = 'call_guy' AND u.active = 1
        GROUP BY u.id, u.name ORDER BY u.name`, day),
      all(`SELECT f.call_status, f.outcome, COUNT(*)::int AS count
        FROM followups f JOIN leads l ON l.id = f.lead_id
        WHERE l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')
        GROUP BY f.call_status, f.outcome ORDER BY count DESC`),
      all(`SELECT b.id AS branch_id, b.name AS branch, COUNT(l.id)::int AS total,
          COUNT(l.id) FILTER (WHERE l.status = 'open')::int AS open,
          COUNT(l.id) FILTER (WHERE l.stage IN ('Booking Done','Retail Done'))::int AS won
        FROM branches b LEFT JOIN leads l ON l.branch_id = b.id
          AND l.assigned_to IN (SELECT id FROM users WHERE role = 'call_guy')
        GROUP BY b.id, b.name ORDER BY total DESC, b.name`),
      all(`SELECT u.id AS call_guy_id, u.name AS call_guy, COUNT(l.id)::int AS overdue
        FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
          AND l.status = 'open' AND l.next_date < ?
        WHERE u.role = 'call_guy' AND u.active = 1
        GROUP BY u.id, u.name ORDER BY overdue DESC, u.name`, day),
      includeFlags ? all(`SELECT l.id, l.customer_name, l.mobile, l.branch_id, b.name AS branch, l.original_so_name,
          l.fcount, l.stage, l.status,
          CASE WHEN l.is_flagged = 1 THEN 'Active' ELSE 'Closed' END AS flag_status,
          l.flag_remarks, u.name AS call_guy,
          (SELECT sm.name FROM users sm WHERE sm.role = 'sales_manager' AND sm.branch_id = l.branch_id AND sm.active = 1
           ORDER BY sm.id LIMIT 1) AS sales_manager
        FROM leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        LEFT JOIN branches b ON b.id = l.branch_id
        WHERE (l.is_flagged = 1 OR l.flag_remarks IS NOT NULL)
        ORDER BY l.id DESC LIMIT 200`) : Promise.resolve([]),
    ]);
    res.json({ kpi, byCallGuy, outcomes, byBranch, overdue, flagged });
  } catch (e) { next(e); }
});

app.get('/api/sales-manager/analytics', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const branchIds = managerBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const [bySalesOfficer, byModel, summary, flaggedRows] = await Promise.all([
      all(`SELECT l.branch_id, b.name AS branch,
          COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') AS sales_officer,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
          COUNT(*) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
          COUNT(*) FILTER (WHERE l.stage = 'Retail Done' AND l.status = 'closed')::int AS retailed,
          COUNT(*) FILTER (WHERE l.stage = 'Lost Lead' AND l.status = 'closed')::int AS lost,
          COUNT(*) FILTER (WHERE l.status = 'open' AND l.next_date <= ?)::int AS due
        FROM leads l LEFT JOIN branches b ON b.id = l.branch_id
        WHERE ${leadFilter.sql}
        GROUP BY l.branch_id, b.name, COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer')
        ORDER BY total DESC, branch, sales_officer`, today(), ...leadFilter.args),

      all(`SELECT COALESCE(NULLIF(TRIM(m.name), ''), 'Unknown model') AS model,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
          COUNT(*) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
          COUNT(*) FILTER (WHERE l.stage = 'Retail Done' AND l.status = 'closed')::int AS retailed,
          COUNT(*) FILTER (WHERE l.stage = 'Lost Lead' AND l.status = 'closed')::int AS lost,
          COUNT(*) FILTER (WHERE l.status = 'open' AND l.next_date <= ?)::int AS due
        FROM leads l LEFT JOIN models m ON m.id = l.model_id
        WHERE ${leadFilter.sql}
        GROUP BY COALESCE(NULLIF(TRIM(m.name), ''), 'Unknown model')
        ORDER BY retailed DESC, booked DESC, total DESC, model`, today(), ...leadFilter.args),

      get(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE fcount > 0 AND status = 'open')::int AS followup,
          COUNT(*) FILTER (WHERE stage = 'Booking Done' AND status = 'closed')::int AS booked,
          COUNT(*) FILTER (WHERE stage = 'Retail Done' AND status = 'closed')::int AS retailed,
          COUNT(*) FILTER (WHERE stage = 'Lost Lead' AND status = 'closed')::int AS lost
        FROM leads l WHERE ${leadFilter.sql}`, ...leadFilter.args),

      req.user.role !== 'cluster_manager'
        ? all(`SELECT l.id, l.customer_name, l.mobile,
            l.branch_id, b.name AS branch,
            COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') AS sales_officer,
            l.fcount, l.stage, l.status,
            CASE WHEN l.is_flagged = 1 THEN 'Active' ELSE 'Closed' END AS flag_status,
            u.name AS call_guy, l.flag_remarks
          FROM leads l
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN users u ON u.id = l.assigned_to
          WHERE ${leadFilter.sql} AND (l.is_flagged = 1 OR l.flag_remarks IS NOT NULL)
          ORDER BY l.is_flagged DESC, l.id DESC`, ...leadFilter.args)
        : Promise.resolve([]),

    ]);
    const flaggedByOfficer = [];
    if (req.user.role !== 'cluster_manager') {
      const grouped = new Map();
      for (const row of flaggedRows) {
        const key = `${row.branch_id}:${row.sales_officer}`;
        if (!grouped.has(key)) grouped.set(key, {
          branch_id: row.branch_id,
          branch: row.branch,
          sales_officer: row.sales_officer,
          flagged: 0,
          active: 0,
          closed: 0,
        });
        const group = grouped.get(key);
        group.flagged++;
        group[row.flag_status === 'Active' ? 'active' : 'closed']++;
      }
      flaggedByOfficer.push(...grouped.values());
      flaggedByOfficer.sort((a, b) => b.flagged - a.flagged || a.sales_officer.localeCompare(b.sales_officer));
    }
    const response = {
      branchId: branchIds.length === 1 ? branchIds[0] : null,
      branchIds,
      branches: req.user.role === 'cluster_manager' ? clusterScopeFor(req.user.username).assigned : [],
      summary,
      bySalesOfficer,
      byModel,
    };
    if (req.user.role !== 'cluster_manager') {
      response.flagged = flaggedRows;
      response.flaggedByOfficer = flaggedByOfficer;
    }
    res.json(response);
  } catch (e) { next(e); }
});

app.get('/api/sales-manager/lead-search', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().replace(/[\\%_]/g, '').slice(0, 80);
    if (query.length < 2) return bad(res, 'Enter at least 2 characters to search');
    const branchIds = managerBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const prefix = `${query}%`;
    const rows = await all(
      `SELECT l.id, l.customer_name, l.mobile, l.branch_id, b.name AS branch,
          COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') AS sales_officer,
          l.stage, l.next_date
       FROM leads l
       LEFT JOIN branches b ON b.id = l.branch_id
       WHERE ${leadFilter.sql}
         AND (LOWER(l.customer_name) LIKE LOWER(?) OR l.mobile LIKE ?)
       ORDER BY l.id DESC
       LIMIT 51`,
      ...leadFilter.args, prefix, prefix,
    );
    res.json({
      query,
      leads: rows.slice(0, 50),
      hasMore: rows.length > 50,
    });
  } catch (e) { next(e); }
});

app.get('/api/sales-manager/lead-analysis', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const branchIds = managerBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const [leadStatusCounts, lostStatusCounts, bySalesOfficer, bySalesOfficerStatus] = await Promise.all([
      all(`SELECT COALESCE(NULLIF(TRIM(l.stage), ''), CASE WHEN l.status = 'open' THEN 'Open' ELSE 'Closed' END) AS status,
          COUNT(*)::int AS count
        FROM leads l
        WHERE ${leadFilter.sql}
        GROUP BY COALESCE(NULLIF(TRIM(l.stage), ''), CASE WHEN l.status = 'open' THEN 'Open' ELSE 'Closed' END)
        ORDER BY count DESC, status`, ...leadFilter.args),

      all(`SELECT COALESCE(NULLIF(TRIM(latest.outcome), ''), 'Unknown') AS status,
          COUNT(*)::int AS count
        FROM leads l
        LEFT JOIN LATERAL (
          SELECT f.outcome
          FROM followups f
          WHERE f.lead_id = l.id
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) latest ON true
        WHERE ${leadFilter.sql} AND l.stage = 'Lost Lead' AND l.status = 'closed'
        GROUP BY COALESCE(NULLIF(TRIM(latest.outcome), ''), 'Unknown')
        ORDER BY count DESC, status`, ...leadFilter.args),

      all(`SELECT l.branch_id, b.name AS branch,
          COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') AS sales_officer,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE l.fcount > 0 AND l.status = 'open')::int AS followup,
          COUNT(*) FILTER (WHERE l.stage = 'Booking Done' AND l.status = 'closed')::int AS booked,
          COUNT(*) FILTER (WHERE l.stage = 'Retail Done' AND l.status = 'closed')::int AS retailed,
          COUNT(*) FILTER (WHERE l.stage = 'Lost Lead' AND l.status = 'closed')::int AS lost,
          COUNT(*) FILTER (WHERE l.status = 'open' AND l.next_date <= ?)::int AS due
        FROM leads l LEFT JOIN branches b ON b.id = l.branch_id
        WHERE ${leadFilter.sql}
        GROUP BY l.branch_id, b.name, COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer')
        ORDER BY total DESC, branch, sales_officer`, today(), ...leadFilter.args),

      all(`WITH latest AS (
          SELECT DISTINCT ON (l.id)
            l.branch_id, b.name AS branch,
            COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') AS sales_officer,
            CASE WHEN l.fcount = 0 THEN 'Fresh'
              ELSE COALESCE(NULLIF(TRIM(f.outcome), ''), NULLIF(TRIM(l.stage), ''), 'Unknown')
            END AS status
          FROM leads l
          LEFT JOIN followups f ON f.lead_id = l.id
          LEFT JOIN branches b ON b.id = l.branch_id
          WHERE ${leadFilter.sql}
          ORDER BY l.id, f.created_at DESC NULLS LAST, f.id DESC NULLS LAST
        )
         SELECT branch_id, branch, sales_officer, status, COUNT(*)::int AS count
         FROM latest
         GROUP BY branch_id, branch, sales_officer, status
         ORDER BY branch, sales_officer, status`, ...leadFilter.args),
    ]);
    res.json({
      branchId: branchIds.length === 1 ? branchIds[0] : null,
      branchIds,
      branches: req.user.role === 'cluster_manager' ? clusterScopeFor(req.user.username).assigned : [],
      leadStatusCounts,
      lostStatusCounts,
      bySalesOfficer,
      bySalesOfficerStatus,
    });
  } catch (e) { next(e); }
});

app.get('/api/sales-manager/lead-analysis/leads', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const branchIds = managerBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const kind = String(req.query.kind || '').trim();
    const value = String(req.query.value || '').trim();
    if (!['status', 'lost'].includes(kind) || !value) return bad(res, 'A valid analysis filter is required');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const stageExpr = `COALESCE(NULLIF(TRIM(l.stage), ''), CASE WHEN l.status = 'open' THEN 'Open' ELSE 'Closed' END)`;
    const officerExpr = `COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer')`;
    const select = `SELECT l.id, l.customer_name, l.mobile, l.branch_id, b.name AS branch,
        ${officerExpr} AS sales_officer, l.fcount, l.stage, l.status, l.next_date`;

    if (kind === 'status') {
      const rows = await all(
        `WITH filtered AS (
           ${select}
           FROM leads l
           LEFT JOIN branches b ON b.id = l.branch_id
           WHERE ${leadFilter.sql} AND ${stageExpr} = ?
         )
         SELECT filtered.*, COUNT(*) OVER()::int AS total_count
         FROM filtered
         ORDER BY filtered.id DESC
         LIMIT ? OFFSET ?`,
        ...leadFilter.args, value, limit, offset,
      );
      const total = rows[0]?.total_count || 0;
      const leads = rows.map(({ total_count, ...lead }) => lead);
      return res.json({ leads, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    const rows = await all(
      `WITH filtered AS (
         ${select}
         FROM leads l
         LEFT JOIN branches b ON b.id = l.branch_id
         LEFT JOIN LATERAL (
           SELECT f.outcome
           FROM followups f
           WHERE f.lead_id = l.id
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT 1
         ) latest ON true
         WHERE ${leadFilter.sql}
           AND l.stage = 'Lost Lead'
           AND l.status = 'closed'
           AND COALESCE(NULLIF(TRIM(latest.outcome), ''), 'Unknown') = ?
       )
       SELECT filtered.*, COUNT(*) OVER()::int AS total_count
       FROM filtered
       ORDER BY filtered.id DESC
       LIMIT ? OFFSET ?`,
       ...leadFilter.args, value, limit, offset,
    );
    const total = rows[0]?.total_count || 0;
    const leads = rows.map(({ total_count, ...lead }) => lead);
    res.json({ leads, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { next(e); }
});

const SO_BUCKET_FILTERS = {
  total:    '1 = 1',
  untouched: 'l.fcount = 0 AND l.status = \'open\'',
  followup:  'l.fcount > 0 AND l.status = \'open\'',
  due:       'l.status = \'open\' AND l.next_date <= ?',
  booked:    'l.stage = \'Booking Done\' AND l.status = \'closed\'',
  retailed:  'l.stage = \'Retail Done\' AND l.status = \'closed\'',
  lost:      'l.stage = \'Lost Lead\' AND l.status = \'closed\'',
};

function managerDrilldownBranchIds(req) {
  const allowed = managerBranchIds(req);
  const requested = Number(req.query.branch_id || 0);
  return requested && allowed.includes(requested) ? [requested] : allowed;
}

app.get('/api/sales-manager/officer-leads', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const branchIds = managerDrilldownBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const officer = String(req.query.officer || '').trim();
    const bucket = String(req.query.bucket || '');
    if (!officer || !SO_BUCKET_FILTERS[bucket]) return bad(res, 'officer and a valid bucket are required');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const args = [...leadFilter.args, officer];
    if (bucket === 'due') args.push(today());
    const rows = await all(
      `WITH filtered AS (
         SELECT l.id, l.customer_name, l.mobile, l.branch_id, b.name AS branch,
            l.stage, l.status, l.fcount, l.next_date
         FROM leads l
         LEFT JOIN branches b ON b.id = l.branch_id
         WHERE ${leadFilter.sql}
           AND COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer') = ?
           AND ${SO_BUCKET_FILTERS[bucket]}
       )
       SELECT filtered.*, COUNT(*) OVER()::int AS total_count
       FROM filtered
       ORDER BY filtered.id DESC
       LIMIT ? OFFSET ?`,
       ...args, limit, offset,
    );
    const total = rows[0]?.total_count || 0;
    const leads = rows.map(({ total_count, ...lead }) => lead);
    res.json({ leads, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { next(e); }
});

app.get('/api/sales-manager/officer-status-leads', auth('sales_manager', 'cluster_manager', 'admin'), async (req, res, next) => {
  try {
    const branchIds = managerDrilldownBranchIds(req);
    if (!branchIds.length) return bad(res, 'No assigned branches');
    const leadFilter = branchFilter('l.branch_id', branchIds);
    const officer = String(req.query.officer || '').trim();
    const status = String(req.query.status || '').trim();
    if (!officer || !status) return bad(res, 'officer and status are required');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const officerExpr = `COALESCE(NULLIF(TRIM(l.original_so_name), ''), 'Unknown Sales Officer')`;
    const statusExpr = `CASE WHEN l.fcount = 0 THEN 'Fresh'
      ELSE COALESCE(NULLIF(TRIM(latest.outcome), ''), NULLIF(TRIM(l.stage), ''), 'Unknown') END`;
    const rows = await all(
      `WITH filtered AS (
         SELECT l.id, l.customer_name, l.mobile, l.branch_id, b.name AS branch,
             ${officerExpr} AS sales_officer,
             l.fcount, l.stage, l.status, l.next_date,
             NULLIF(TRIM(latest.outcome), '') AS latest_outcome
         FROM leads l
         LEFT JOIN LATERAL (
           SELECT f.outcome
           FROM followups f
           WHERE f.lead_id = l.id
           ORDER BY f.created_at DESC NULLS LAST, f.id DESC NULLS LAST
           LIMIT 1
          ) latest ON true
          LEFT JOIN branches b ON b.id = l.branch_id
         WHERE ${leadFilter.sql} AND ${officerExpr} = ? AND ${statusExpr} = ?
       )
       SELECT filtered.*, COUNT(*) OVER()::int AS total_count
       FROM filtered
       ORDER BY filtered.id DESC
       LIMIT ? OFFSET ?`,
      ...leadFilter.args, officer, status, limit, offset,
    );
    const total = rows[0]?.total_count || 0;
    const leads = rows.map(({ total_count, ...lead }) => lead);
    res.json({ leads, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------- dashboards */

app.get('/api/counts', auth(), async (req, res, next) => {
  try {
    const isSales = ['sales', 'call_guy'].includes(req.user.role);
    const extra = isSales ? ' AND assigned_to = ?' : '';
    const args  = isSales ? [req.user.id] : [];
    const [fr, du] = await Promise.all([
      get(`SELECT COUNT(*)::int AS c FROM leads WHERE status='open' AND fcount=0${extra}`, ...args),
      get(`SELECT COUNT(*)::int AS c FROM leads WHERE status='open' AND fcount>0 AND next_date<=?${extra}`, today(), ...args),
    ]);
    res.json({ fresh: fr.c, due: du.c });
  } catch (e) { next(e); }
});

app.get('/api/admin/call-guy-load', auth('admin'), async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT u.id, u.name,
              SUM(CASE WHEN l.status = 'open' THEN 1 ELSE 0 END)::int AS open_count,
              SUM(CASE WHEN l.status = 'open' AND l.fcount = 0 THEN 1 ELSE 0 END)::int AS untouched_count
       FROM users u
       LEFT JOIN leads l ON l.assigned_to = u.id
       WHERE u.role = 'call_guy' AND u.active = 1
       GROUP BY u.id, u.name ORDER BY u.name`,
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

app.post('/api/admin/reassign-leads', auth('admin'), async (req, res, next) => {
  try {
    const { from_id, to_ids, mode } = req.body || {};
    if (!from_id || !Array.isArray(to_ids) || !to_ids.length)
      return bad(res, 'from_id and to_ids[] are required');
    const filter = mode === 'untouched'
      ? `assigned_to = ? AND fcount = 0 AND status = 'open'`
      : `assigned_to = ? AND status = 'open'`;
    const leads = await all(`SELECT id FROM leads WHERE ${filter} ORDER BY id`, Number(from_id));
    if (!leads.length) return res.json({ moved: 0 });
    for (let i = 0; i < leads.length; i++)
      await run(`UPDATE leads SET assigned_to = ? WHERE id = ?`, Number(to_ids[i % to_ids.length]), leads[i].id);
    res.json({ moved: leads.length });
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
  res.status(500).json({ error: err.message || 'Server error' });
});

/* ----------------------------------------------------------------- start */

const boot = process.env.DB_SKIP_INIT === '1' ? seedClusterManagers() : initDb();
boot
  .then(loadClusterManagerScopes)
  .then(() => app.listen(PORT, () => console.log(`Follow-up CRM running on http://localhost:${PORT}`)))
  .catch(e => { console.error('DB init failed:', e.message); process.exit(1); });
