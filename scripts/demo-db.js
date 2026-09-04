import pg from 'pg';
import { hash } from '../db.js';
import branchCodes from '../demo-data/branch-codes.json' with { type: 'json' };

const { Client } = pg;
const DEMO_DB = 'followup_crm_demo';
const baseConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS ?? '',
  ssl: false,
};

if (process.env.DEMO_MODE !== '1' || baseConfig.host !== 'localhost' || process.env.DB_NAME !== DEMO_DB) {
  throw new Error('Demo database commands require DEMO_MODE=1, DB_HOST=localhost, and DB_NAME=followup_crm_demo');
}

async function withClient(database, fn) {
  const client = new Client({ ...baseConfig, database });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function create() {
  await withClient('postgres', async client => {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DEMO_DB]);
    if (!found.rowCount) {
      await client.query(`CREATE DATABASE ${DEMO_DB}`);
      console.log(`Created local database ${DEMO_DB}`);
    } else {
      console.log(`Local database ${DEMO_DB} already exists`);
    }
  });
}

async function reset() {
  await create();
  await withClient(DEMO_DB, async client => {
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log(`Reset local database ${DEMO_DB}`);
  });
}

async function seed() {
  await create();
  process.env.DB_NAME = DEMO_DB;
  const { initDb, pool, run, get, all } = await import('../db.js');
  await initDb();

  const branches = [...new Set(['Nippon Toyota - Kochi', ...Object.values(branchCodes)])];
  const sources = ['Meta', 'Referral', 'YouTube', 'JustDial'];
  const activities = ['Website Enquiry', 'Test Drive Camp', 'Dealer Visit'];
  const models = ['Hyryder', 'Glanza', 'Innova Hycross'];
  for (const name of branches) await run('INSERT INTO branches(name) VALUES(?) ON CONFLICT(name) DO NOTHING', name);
  for (const name of sources) await run('INSERT INTO sources(name) VALUES(?) ON CONFLICT(name) DO NOTHING', name);
  for (const name of activities) await run('INSERT INTO activities(name) VALUES(?) ON CONFLICT(name) DO NOTHING', name);
  for (const name of models) await run('INSERT INTO models(name) VALUES(?) ON CONFLICT(name) DO NOTHING', name);

  const branchRows = await import('../db.js').then(m => m.all('SELECT id, name FROM branches ORDER BY id'));
  const branchByName = new Map(branchRows.map(r => [r.name, r.id]));
  const users = [
    ['demo-admin', 'Demo Admin', 'admin', null],
    ['callguy-1', 'Arun Call Guy', 'call_guy', null],
    ['callguy-2', 'Beena Call Guy', 'call_guy', null],
    ['callguy-3', 'Chitra Call Guy', 'call_guy', null],
    ['callguy-4', 'Deepak Call Guy', 'call_guy', null],
    ['callguy-5', 'Esha Call Guy', 'call_guy', null],
    ['call-manager', 'Farhan Call Center Manager', 'call_center_manager', null],
    ['sales-manager-kochi', 'Gita Sales Manager', 'sales_manager', branchByName.get(branches[0])],
    ['sales-manager-muv', 'Hari Sales Manager', 'sales_manager', branchByName.get(branches[1])],
    ['sales-manager-thiruvalla', 'Isha Sales Manager', 'sales_manager', branchByName.get(branches[2])],
    ['sales-manager-kalamassery', 'Jaya Sales Manager', 'sales_manager', branchByName.get('Nippon Toyota - Kalamassery')],
  ];
  for (const [username, name, role, branchId] of users) {
    await run(`INSERT INTO users(username,password,name,role,branch_id) VALUES(?,?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, branch_id=EXCLUDED.branch_id, active=1`,
      username, hash('demo123'), name, role, branchId);
  }
  const admin = await get('SELECT id FROM users WHERE username = ?', 'demo-admin');
  const callGuys = await all('SELECT id FROM users WHERE role = ? ORDER BY username', 'call_guy');
  const sourceRows = await all('SELECT id, name FROM sources ORDER BY id');
  const modelRows = await all('SELECT id, name FROM models ORDER BY id');
  const activityRows = await all('SELECT id, name FROM activities ORDER BY id');
  const sampleNames = ['Akhil Nair', 'Amal Varghese', 'Anju Mathew', 'Arjun Das', 'Basil Jose', 'Devika S', 'Firoz Khan', 'Greeshma R', 'Hari Krishnan', 'Irene Paul', 'Jithin Joseph', 'Kavya Menon', 'Lijo Thomas', 'Meera Nair', 'Nikhil Raj', 'Olivia George', 'Pranav P', 'Rakesh Kumar', 'Saniya Ali', 'Thomas Mathew'];
  const soNames = ['Anil Menon', 'Binu Thomas', 'Catherine Paul', 'Dinesh Kumar', 'Fathima Rahman', 'George Joseph'];
  const outcomes = ['Need Test Drive', 'Showroom Visit', 'Booking Done', 'Retail Done', 'Not Interested', 'RNR', 'Call Me Back', 'Need More Details'];
  for (let i = 0; i < sampleNames.length; i++) {
    const branchId = branchByName.get(branches[i % branches.length]);
    const sourceId = sourceRows[i % sourceRows.length].id;
    const modelId = modelRows[i % modelRows.length].id;
    const activityId = activityRows[i % activityRows.length].id;
    const callGuyId = callGuys[i % callGuys.length].id;
    const soName = soNames[i % soNames.length];
    const mobile = String(8520001000 + i);
    const outcome = outcomes[i % outcomes.length];
    const closing = ['Booking Done', 'Retail Done', 'Not Interested'].includes(outcome);
    const lost = outcome === 'Not Interested';
    const count = i === 0 ? 0 : (i % 5) + 1;
    const nextDate = closing || count === 0 ? null : (i % 3 === 0 ? '2026-09-02' : '2026-09-05');
    await run(`INSERT INTO leads(customer_name,mobile,source_id,branch_id,location,remarks,created_by,assigned_to,model_id,activity_id,original_so_name,original_so_mobile,stage,status,next_date,fcount)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, sampleNames[i], mobile, sourceId, branchId, ['Kochi', 'Aluva', 'Kottayam'][i % 3], 'Demo imported lead', admin.id, callGuyId, modelId, activityId, soName, `900000100${(i % 6) + 1}`, count ? (lost ? 'Lost Lead' : outcome) : 'Fresh', closing ? 'closed' : 'open', nextDate, count);
    if (count) {
      for (let seq = 1; seq <= count; seq++) {
        const fuOutcome = seq === count ? outcome : 'Call Me Back';
        const fuClosing = ['Booking Done', 'Retail Done', 'Not Interested'].includes(fuOutcome);
        await run(`INSERT INTO followups(lead_id,user_id,seq,call_status,outcome,next_date,remarks)
          VALUES((SELECT id FROM leads WHERE mobile=?),?,?,?,?,?,?)`, mobile, callGuyId, seq,
          fuOutcome === 'RNR' ? 'Not Connected' : 'Connected', fuOutcome,
          fuClosing ? null : (seq === count ? nextDate : '2026-09-04'),
          `Demo follow-up F${seq}`);
      }
    }
    if (i === 5) await run('UPDATE leads SET is_flagged = 1 WHERE mobile = ?', mobile);
  }
  console.log(`Seeded demo users, masters, and ${sampleNames.length} demo leads in ${DEMO_DB}`);
  await pool.end();
}

const cmd = process.argv[2] || 'create';
try {
  if (cmd === 'create') await create();
  else if (cmd === 'reset') await reset();
  else if (cmd === 'seed') await seed();
  else throw new Error('Usage: node scripts/demo-db.js [create|reset|seed]');
} catch (e) {
  console.error(e.message || e);
  process.exitCode = 1;
}
