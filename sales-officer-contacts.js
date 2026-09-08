import pg from 'pg';
import { all, get, run } from './db.js';

const { Pool } = pg;
let payslipPool;
let payslipRestConfigChecked = false;
let payslipRestConfig;

export function normalizeOfficerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeOfficerBranch(value) {
  const branch = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^nippon\s+toyota\s*[-:]?\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    trivandrum: 'kazhakoottam',
    enchakkal: 'enjakkal',
    'kollam 3s': 'kollam',
    thrissur: 'trichur',
  }[branch] || branch;
}

export function officerContactKey(name, branch) {
  return `${normalizeOfficerName(name)}|${normalizeOfficerBranch(branch)}`;
}

export function normalizeOfficerPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function getPayslipPool() {
  if (!process.env.PAYSLIP_DATABASE_URL) return null;
  if (!payslipPool) {
    payslipPool = new Pool({
      connectionString: process.env.PAYSLIP_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return payslipPool;
}

function getPayslipRestConfig() {
  if (payslipRestConfigChecked) return payslipRestConfig;
  payslipRestConfigChecked = true;
  const url = String(process.env.PAYSLIP_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.PAYSLIP_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  payslipRestConfig = url && key ? { url, key } : null;
  return payslipRestConfig;
}

function emptyPayslipContacts() {
  return { exact: new Map(), byName: new Map() };
}

function payslipEntryName(entry) {
  return entry?.name ?? entry?.displayName ?? '';
}

function indexPayslipRows(rows, requestedKeys, requestedNames) {
  const exact = new Map();
  const byName = new Map();
  for (const row of rows) {
    const nameKey = normalizeOfficerName(row.name);
    if (!requestedNames.has(nameKey)) continue;
    const phone = normalizeOfficerPhone(row.mobile_number);
    if (!phone) continue;
    const contact = { display_name: String(row.name).trim(), phone, branch: String(row.branch || '').trim() };
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(contact);
    const key = officerContactKey(row.name, row.branch);
    if (requestedKeys.has(key) && !exact.has(key)) exact.set(key, contact);
  }
  return { exact, byName };
}

async function readPayslipContactsFromRest(entries) {
  const config = getPayslipRestConfig();
  if (!config || !entries.length) return emptyPayslipContacts();

  const requestedKeys = new Set(entries.map(entry => officerContactKey(payslipEntryName(entry), entry.branch)));
  const requestedNames = new Set(entries.map(entry => normalizeOfficerName(payslipEntryName(entry))));
  const rows = [];
  const pageSize = 1000;
  const timeoutMs = 8000;

  try {
    for (let offset = 0; offset < 50000; offset += pageSize) {
      const url = new URL(`${config.url}/rest/v1/employees`);
      url.searchParams.set('select', 'name,mobile_number,branch');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('unexpected response');
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return indexPayslipRows(rows, requestedKeys, requestedNames);
  } catch (err) {
    console.warn('Payslip Sales Officer REST lookup unavailable; using saved/workbook contacts.', err.message);
    return emptyPayslipContacts();
  }
}

export async function readPayslipContacts(entries) {
  const pool = getPayslipPool();
  if (!entries.length) return emptyPayslipContacts();

  const requestedKeys = new Set(entries.map(entry => officerContactKey(payslipEntryName(entry), entry.branch)));
  const requestedNames = new Set(entries.map(entry => normalizeOfficerName(payslipEntryName(entry))));

  if (pool) {
    try {
      const result = await pool.query(`
        SELECT name, mobile_number, branch
        FROM employees
        WHERE name IS NOT NULL AND mobile_number IS NOT NULL AND BTRIM(mobile_number) <> ''
      `);
      const contacts = indexPayslipRows(result.rows, requestedKeys, requestedNames);
      if (contacts.exact.size || contacts.byName.size) return contacts;
    } catch (err) {
      console.warn('Payslip Sales Officer database lookup unavailable; trying REST lookup.', err.message);
    }
  }

  const restContacts = await readPayslipContactsFromRest(entries);
  if (restContacts.exact.size || restContacts.byName.size) return restContacts;

  if (!pool && !getPayslipRestConfig()) {
    console.warn('Payslip Sales Officer lookup is not configured; using saved/workbook contacts.');
  }
  return emptyPayslipContacts();
}

async function saveResolvedContact(displayName, phone) {
  const name = String(displayName || '').trim();
  const nameKey = normalizeOfficerName(name);
  const normalizedPhone = normalizeOfficerPhone(phone);
  if (!nameKey || !normalizedPhone) return;
  await all(`
    INSERT INTO sales_officer_contacts (name_key, display_name, phone, updated_at)
    VALUES (?, ?, ?, TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (name_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      phone = EXCLUDED.phone,
      updated_at = EXCLUDED.updated_at
    RETURNING id
  `, nameKey, name, normalizedPhone);
}

export async function resolveOfficerContacts(entries, workbookPhones = new Map()) {
  const requested = new Map();
  for (const entry of entries || []) {
    const displayName = String(entry?.name || '').trim();
    const branch = String(entry?.branch || '').trim();
    const key = officerContactKey(displayName, branch);
    if (normalizeOfficerName(displayName) && !requested.has(key)) requested.set(key, { displayName, branch });
  }
  if (!requested.size) return new Map();

  const keys = [...requested.keys()];
  const nameKeys = [...new Set([...requested.values()].map(entry => normalizeOfficerName(entry.displayName)))];
  const savedRows = await all(
    `SELECT name_key, display_name, phone FROM sales_officer_contacts WHERE name_key = ANY(?)`,
    nameKeys,
  );
  const saved = new Map(savedRows.map(row => [row.name_key, row]));
  const payslip = await readPayslipContacts([...requested.values()]);
  const requestedKeysByName = new Map();
  for (const key of keys) {
    const nameKey = normalizeOfficerName(requested.get(key).displayName);
    if (!requestedKeysByName.has(nameKey)) requestedKeysByName.set(nameKey, []);
    requestedKeysByName.get(nameKey).push(key);
  }
  const resolved = new Map();

  for (const key of keys) {
    const { displayName } = requested.get(key);
    const nameKey = normalizeOfficerName(displayName);
    const nameKeysForRequest = requestedKeysByName.get(nameKey) || [];
    const hrExact = payslip.exact.get(key);
    const hrNameMatches = payslip.byName.get(nameKey) || [];
    const hr = hrExact || (hrNameMatches.length === 1 ? hrNameMatches[0] : null);
    const local = nameKeysForRequest.length === 1 ? saved.get(nameKey) : null;
    const workbookPhone = normalizeOfficerPhone(workbookPhones.get(key) || workbookPhones.get(nameKey));
    const source = hr ? 'payslip' : local ? 'saved' : workbookPhone ? 'workbook' : null;
    const phone = hr?.phone || normalizeOfficerPhone(local?.phone) || workbookPhone;
    if (!phone) continue;

    const resolvedName = hr?.display_name || local?.display_name || displayName;
    resolved.set(key, { name: resolvedName, phone, source });
    if (source === 'payslip' || !local || source === 'workbook') {
      await saveResolvedContact(resolvedName, phone);
    }
  }
  return resolved;
}

export async function listOfficerContacts(search = '') {
  const q = String(search || '').trim();
  if (!q) {
    return all(`SELECT id, name_key, display_name, phone, updated_at FROM sales_officer_contacts ORDER BY display_name`);
  }
  const pattern = `%${q}%`;
  return all(
    `SELECT id, name_key, display_name, phone, updated_at
     FROM sales_officer_contacts
     WHERE display_name ILIKE ? OR phone ILIKE ?
     ORDER BY display_name`,
    pattern, pattern,
  );
}

export async function saveOfficerContact(displayName, phone) {
  const name = String(displayName || '').trim();
  const nameKey = normalizeOfficerName(name);
  const normalizedPhone = normalizeOfficerPhone(phone);
  if (!nameKey) throw new Error('Sales Officer name is required');
  if (!normalizedPhone) throw new Error('Phone must contain 10 digits');
  const rows = await all(`
    INSERT INTO sales_officer_contacts (name_key, display_name, phone, updated_at)
    VALUES (?, ?, ?, TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (name_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      phone = EXCLUDED.phone,
      updated_at = EXCLUDED.updated_at
    RETURNING id, name_key, display_name, phone, updated_at
  `, nameKey, name, normalizedPhone);
  return rows[0];
}

export async function updateOfficerContact(id, phone) {
  const normalizedPhone = normalizeOfficerPhone(phone);
  if (!normalizedPhone) throw new Error('Phone must contain 10 digits');
  const row = await get(
    `UPDATE sales_officer_contacts
     SET phone = ?, updated_at = TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = ?
     RETURNING id, name_key, display_name, phone, updated_at`,
    normalizedPhone, Number(id),
  );
  if (!row) throw new Error('Sales Officer contact not found');
  return row;
}

export async function deleteOfficerContact(id) {
  const result = await run(
    `DELETE FROM sales_officer_contacts WHERE id = ?`,
    Number(id),
  );
  if (!result.rowCount) throw new Error('Sales Officer contact not found');
}
