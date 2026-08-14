/**
 * Temporary test leads for testuser14august.
 *
 *   node --env-file=.env scripts/test-leads.js seed
 *   node --env-file=.env scripts/test-leads.js cleanup
 *   node --env-file=.env scripts/test-leads.js teardown
 *   node --env-file=.env scripts/test-leads.js list
 */
import { get, all, run } from '../db.js';

const TAG = 'TEST-14AUG-temp';
const USERNAME = 'testuser14august';

const TEST_LEADS = [
  { customer_name: 'Test Customer Alpha', mobile: '9999901401', location: 'Netoor' },
  { customer_name: 'Test Customer Beta', mobile: '9999901402', location: 'Ernakulam' },
  { customer_name: 'Test Customer Gamma', mobile: '9999901403', location: 'Kochi' },
  { customer_name: 'Test Customer Delta', mobile: '9999901404', location: 'Aluva' },
  { customer_name: 'Test Customer Epsilon', mobile: '9999901405', location: 'Tripunithura' },
];

async function resolveUser() {
  const user = await get(
    'SELECT id, username, name, branch_id FROM users WHERE username = ? AND active = 1',
    USERNAME,
  );
  if (!user) throw new Error(`User "${USERNAME}" not found or inactive`);
  return user;
}

async function seed() {
  const user = await resolveUser();
  const admin = await get('SELECT id FROM users WHERE role = ? LIMIT 1', 'admin');
  if (!admin) throw new Error('No admin user found');

  const source = await get('SELECT id FROM sources ORDER BY id LIMIT 1');
  if (!source) throw new Error('No sources in database — add at least one source first');

  const existing = await all('SELECT mobile FROM leads WHERE remarks = ?', TAG);
  const existingMobiles = new Set(existing.map(r => r.mobile));

  let added = 0;
  for (const lead of TEST_LEADS) {
    if (existingMobiles.has(lead.mobile)) continue;
    await run(
      `INSERT INTO leads (customer_name, mobile, source_id, branch_id, location, remarks, created_by, assigned_to)
       VALUES (?,?,?,?,?,?,?,?)`,
      lead.customer_name,
      lead.mobile,
      source.id,
      user.branch_id,
      lead.location,
      TAG,
      admin.id,
      user.id,
    );
    added++;
  }

  const total = await get('SELECT COUNT(*)::int AS c FROM leads WHERE remarks = ?', TAG);
  console.log(`Seeded ${added} lead(s) for ${user.name} (@${user.username}, id ${user.id}).`);
  console.log(`Total tagged "${TAG}": ${total.c}`);
}

async function cleanup() {
  const preview = await all(
    'SELECT id, customer_name, mobile FROM leads WHERE remarks = ? ORDER BY id',
    TAG,
  );
  if (!preview.length) {
    console.log(`No leads tagged "${TAG}" — nothing to remove.`);
    return;
  }
  console.log(`Removing ${preview.length} test lead(s):`);
  for (const l of preview) console.log(`  #${l.id}  ${l.customer_name}  ${l.mobile}`);

  const result = await run('DELETE FROM leads WHERE remarks = ?', TAG);
  console.log(`Deleted ${result.rowCount} lead(s) (follow-ups cascade automatically).`);
}

async function teardown() {
  await cleanup();

  const user = await get('SELECT id, username FROM users WHERE username = ?', USERNAME);
  if (!user) {
    console.log(`User "${USERNAME}" not found — nothing else to remove.`);
    return;
  }

  const remainingLeads = await run(
    'DELETE FROM leads WHERE assigned_to = ? OR created_by = ?',
    user.id,
    user.id,
  );
  if (remainingLeads.rowCount) {
    console.log(`Removed ${remainingLeads.rowCount} additional lead(s) tied to the test user.`);
  }

  const remainingFus = await run('DELETE FROM followups WHERE user_id = ?', user.id);
  if (remainingFus.rowCount) {
    console.log(`Removed ${remainingFus.rowCount} follow-up(s) by the test user.`);
  }

  await run('DELETE FROM users WHERE id = ?', user.id);
  console.log(`Deleted user ${USERNAME} (id ${user.id}).`);
}

async function list() {
  const user = await resolveUser();
  const rows = await all(
    `SELECT id, customer_name, mobile, stage, status, remarks
     FROM leads WHERE assigned_to = ? OR remarks = ?
     ORDER BY id`,
    user.id,
    TAG,
  );
  if (!rows.length) {
    console.log(`No test leads for ${USERNAME}.`);
    return;
  }
  console.log(`Leads for ${USERNAME} (id ${user.id}):`);
  for (const l of rows) {
    const tag = l.remarks === TAG ? ' [temp]' : '';
    console.log(`  #${l.id}  ${l.customer_name}  ${l.mobile}  ${l.stage}/${l.status}${tag}`);
  }
}

const cmd = process.argv[2] || 'seed';
try {
  if (cmd === 'seed') await seed();
  else if (cmd === 'cleanup') await cleanup();
  else if (cmd === 'teardown') await teardown();
  else if (cmd === 'list') await list();
  else {
    console.error('Usage: node --env-file=.env scripts/test-leads.js [seed|cleanup|teardown|list]');
    process.exit(1);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  process.exit(0);
}
