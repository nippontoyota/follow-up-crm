import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';

const { Client } = pg;
const envPath = 'E:/Projects/NipponToyota/payslipportal/apps/api/.env';
const env = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/)
  .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (!env.DATABASE_URL) throw new Error('Payslip DATABASE_URL is missing');

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`
    SELECT id, name, department, branch, designation
    FROM employees
    WHERE lower(COALESCE(department, '')) LIKE 'sales%'
    ORDER BY branch, name, id
  `);
  await writeFile('demo-data/payslip-sales-employees.json', JSON.stringify(rows, null, 2) + '\n');
  console.log(`Snapshotted ${rows.length} sales employees to demo-data/payslip-sales-employees.json`);
} finally {
  await client.end();
}
