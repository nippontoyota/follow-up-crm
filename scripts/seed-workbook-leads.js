import ExcelJS from 'exceljs';
import { pool, all, run } from '../db.js';
import branchCodes from '../demo-data/branch-codes.json' with { type: 'json' };

if (process.env.DEMO_MODE !== '1' || process.env.DB_NAME !== 'followup_crm_demo') {
  throw new Error('Workbook seeding is restricted to followup_crm_demo');
}

const input = process.env.DEMO_WORKBOOK || 'C:/Users/krish/Downloads/bulk_upload_sample.xlsx';
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(input);
const sheet = workbook.worksheets[0];
const headers = sheet.getRow(1).values.slice(1).map(v => String(v || '').trim());
const index = new Map(headers.map((h, i) => [h.toLowerCase(), i + 1]));
const value = (row, ...names) => {
  for (const name of names) {
    const column = index.get(name.toLowerCase());
    if (!column) continue;
    const cell = row.getCell(column).value;
    if (cell !== null && cell !== undefined && String(cell).trim()) return String(cell).trim();
  }
  return '';
};
const canonicalBranch = raw => {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (branchCodes[compact]) return branchCodes[compact];
  const short = raw.replace(/^nippon\s+toyota\s*-\s*/i, '').trim();
  return `Nippon Toyota - ${short}`;
};

const [branches, callGuys] = await Promise.all([
  all('SELECT id, name FROM branches'),
  all("SELECT id FROM users WHERE role = 'call_guy' AND active = 1 ORDER BY username"),
]);
if (!callGuys.length) throw new Error('Expected at least one active Call Guy');
const branchMap = new Map(branches.flatMap(b => [[b.name.toLowerCase(), b.id], [b.name.replace(/^nippon\s+toyota\s*-\s*/i, '').toLowerCase(), b.id]]));

const sourceNames = new Set();
const modelNames = new Set();
const rows = [];
const seen = new Set();
for (let n = 2; n <= sheet.rowCount; n++) {
  const row = sheet.getRow(n);
  const customer = value(row, 'Customer Name', 'Name');
  const mobile = value(row, 'Mobile', 'Phone').replace(/\D/g, '').slice(-10);
  const source = value(row, 'Source');
  const model = value(row, 'Model');
  const branch = canonicalBranch(value(row, 'Branch'));
  if (!customer || mobile.length !== 10 || seen.has(mobile)) continue;
  const branchId = branchMap.get(branch.toLowerCase());
  if (!branchId || !source || !model) continue;
  seen.add(mobile);
  sourceNames.add(source);
  modelNames.add(model);
  rows.push({
    customer, mobile, branchId,
    location: value(row, 'Location'),
    remarks: value(row, 'Remarks'),
    soName: value(row, 'SO Name', 'Sales Officer Name'),
    source, model,
    callGuyId: callGuys[(rows.length) % callGuys.length].id,
  });
}

await run('DELETE FROM leads');
await run('DELETE FROM salesforce_calls');
for (const source of sourceNames) await run('INSERT INTO sources(name) VALUES(?) ON CONFLICT(name) DO NOTHING', source);
for (const model of modelNames) await run('INSERT INTO models(name) VALUES(?) ON CONFLICT(name) DO NOTHING', model);
const sourceMap = new Map((await all('SELECT id, name FROM sources')).map(r => [r.name.toLowerCase(), r.id]));
const modelMap = new Map((await all('SELECT id, name FROM models')).map(r => [r.name.toLowerCase(), r.id]));
const admin = (await all("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"))[0];

for (let start = 0; start < rows.length; start += 400) {
  const batch = rows.slice(start, start + 400);
  const values = batch.flatMap(l => [l.customer, l.mobile, sourceMap.get(l.source.toLowerCase()), l.branchId, l.location || null, l.remarks || null, admin.id, l.callGuyId, modelMap.get(l.model.toLowerCase()), null, l.soName || null, null]);
  const placeholders = batch.map((_, i) => `(${Array.from({ length: 12 }, (_, j) => '$' + (i * 12 + j + 1)).join(',')})`).join(',');
  await pool.query(`INSERT INTO leads(customer_name,mobile,source_id,branch_id,location,remarks,created_by,assigned_to,model_id,activity_id,original_so_name,original_so_mobile) VALUES ${placeholders}`, values);
}
console.log(`Seeded ${rows.length} workbook leads from ${input} across ${callGuys.length} Call Guys`);
await pool.end();
