import pg from 'pg';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const { Pool } = pg;

const host = process.env.DB_HOST || 'localhost';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
const useSsl = process.env.DB_SSL === 'true' || (!isLocal && process.env.DB_SSL !== 'false');

export const pool = new Pool({
  host,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'followup_crm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS ?? '',
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Convert ? placeholders to $1, $2, ...
const pq = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };

export const get = (sql, ...a) => pool.query(pq(sql), a).then(r => r.rows[0]);
export const all = (sql, ...a) => pool.query(pq(sql), a).then(r => r.rows);
export const run = (sql, ...a) => pool.query(pq(sql), a);
export const ins = (sql, ...a) => pool.query(pq(sql) + ' RETURNING id', a).then(r => Number(r.rows[0].id));

export function hash(pw) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(pw, salt, 64).toString('hex');
}

export function verify(pw, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS branches   (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS sources    (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS activities (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS models     (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS users (
    id        SERIAL PRIMARY KEY,
    username  TEXT NOT NULL UNIQUE,
    password  TEXT NOT NULL,
    name      TEXT NOT NULL,
    role      TEXT NOT NULL CHECK (role IN ('admin','marketing','sales')),
    branch_id INTEGER REFERENCES branches(id),
    active    INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
    id            SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    mobile        TEXT NOT NULL,
    source_id     INTEGER REFERENCES sources(id),
    branch_id     INTEGER NOT NULL REFERENCES branches(id),
    location      TEXT,
    remarks       TEXT,
    created_by    INTEGER NOT NULL REFERENCES users(id),
    assigned_to   INTEGER REFERENCES users(id),
    stage         TEXT NOT NULL DEFAULT 'Fresh',
    status        TEXT NOT NULL DEFAULT 'open',
    next_date     TEXT,
    fcount        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE TABLE IF NOT EXISTS followups (
    id          SERIAL PRIMARY KEY,
    lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    seq         INTEGER NOT NULL,
    call_status TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    model_id    INTEGER REFERENCES models(id),
    activity_id INTEGER REFERENCES activities(id),
    next_date   TEXT,
    remarks     TEXT,
    created_at  TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to, status, next_date)`,
  // Added after initial schema — safe to run repeatedly
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS model_id    INTEGER REFERENCES models(id)`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS activity_id INTEGER REFERENCES activities(id)`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS other_so_called TEXT`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS order_id TEXT`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS tally_receipt TEXT`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS test_drive_date TEXT`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS exchange_expected_price TEXT`,
  `ALTER TABLE followups ADD COLUMN IF NOT EXISTS exchange_offered_price TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_flagged INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS flag_remarks TEXT`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
  `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','marketing','sales','manager'))`,
  `CREATE TABLE IF NOT EXISTS salesforce_calls (
    id SERIAL PRIMARY KEY,
    mobile TEXT NOT NULL UNIQUE,
    so_name TEXT NOT NULL,
    so_mobile TEXT,
    status TEXT,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `ALTER TABLE salesforce_calls ADD COLUMN IF NOT EXISTS so_mobile TEXT`,
  `ALTER TABLE salesforce_calls DROP CONSTRAINT IF EXISTS salesforce_calls_mobile_so_name_status_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_salesforce_calls_mobile ON salesforce_calls(mobile)`,
];

export async function initDb() {
  for (const sql of DDL) await pool.query(sql);

  // Normalize SF officer names: strip MR./MRS./MS./DR. prefix and trailing digits
  await pool.query(`
    UPDATE salesforce_calls
    SET so_name = TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(so_name, '^(MR\\.|MRS\\.|MS\\.|DR\\.)\\s*', '', 'i'),
      '\\s+\\d+$', ''
    ))
    WHERE so_name ~* '^(MR\\.|MRS\\.|MS\\.|DR\\.)' OR so_name ~ '\\s+\\d+$'
  `);

  const row = await get(`SELECT COUNT(*)::int AS c FROM users`);
  if (row.c === 0) {
    await pool.query(
      `INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)`,
      ['admin', hash('admin123'), 'Administrator', 'admin'],
    );
    console.log('Seeded default admin  ->  username: admin  password: admin123');
  }
}
