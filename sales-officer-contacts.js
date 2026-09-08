import pg from 'pg';
import { all, get, run } from './db.js';

const { Pool } = pg;
let payslipPool;

export function normalizeOfficerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

async function readPayslipContacts(keys) {
  const pool = getPayslipPool();
  if (!pool || !keys.length) return new Map();

  try {
    const result = await pool.query(`
      SELECT name, mobile_number
      FROM employees
      WHERE name IS NOT NULL AND mobile_number IS NOT NULL AND BTRIM(mobile_number) <> ''
    `);
    const contacts = new Map();
    for (const row of result.rows) {
      const key = normalizeOfficerName(row.name);
      const phone = normalizeOfficerPhone(row.mobile_number);
      if (keys.includes(key) && phone && !contacts.has(key)) {
        contacts.set(key, { display_name: String(row.name).trim(), phone });
      }
    }
    return contacts;
  } catch (err) {
    console.warn('Payslip Sales Officer lookup unavailable; using saved/workbook contacts.', err.message);
    return new Map();
  }
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

export async function resolveOfficerContacts(names, workbookPhones = new Map()) {
  const requested = new Map();
  for (const name of names || []) {
    const displayName = String(name || '').trim();
    const key = normalizeOfficerName(displayName);
    if (key && !requested.has(key)) requested.set(key, displayName);
  }
  if (!requested.size) return new Map();

  const keys = [...requested.keys()];
  const savedRows = await all(
    `SELECT name_key, display_name, phone FROM sales_officer_contacts WHERE name_key = ANY(?)`,
    keys,
  );
  const saved = new Map(savedRows.map(row => [row.name_key, row]));
  const payslip = await readPayslipContacts(keys);
  const resolved = new Map();

  for (const key of keys) {
    const displayName = requested.get(key);
    const hr = payslip.get(key);
    const local = saved.get(key);
    const workbookPhone = normalizeOfficerPhone(workbookPhones.get(key));
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
