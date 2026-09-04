import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import employees from '../demo-data/payslip-sales-employees.json' with { type: 'json' };

const branches = [
  ['C001B', 'Nippon Toyota - Kalamassery'],
  ['MV01A', 'Nippon Toyota - Muvattupuzha'],
  ['TL01A', 'Nippon Toyota - Thiruvalla'],
];
const officers = branches.flatMap(([code, branch]) => employees
  .filter(e => e.branch === branch.replace('Nippon Toyota - ', '') && e.department.toLowerCase().startsWith('sales'))
  .slice(0, 2)
  .map(e => [e.name, '', code, branch]));
if (officers.length < 3) throw new Error('Payslip sales snapshot does not contain demo-branch employees');
const sources = ['Meta', 'Referral', 'YouTube', 'JustDial'];
const models = ['Hyryder', 'Glanza', 'Innova Hycross'];
const names = [
  'Akhil Nair', 'Amal Varghese', 'Anju Mathew', 'Arjun Das', 'Basil Jose', 'Devika S',
  'Firoz Khan', 'Greeshma R', 'Hari Krishnan', 'Irene Paul', 'Jithin Joseph', 'Kavya Menon',
  'Lijo Thomas', 'Meera Nair', 'Nikhil Raj', 'Olivia George', 'Pranav P', 'Rakesh Kumar',
  'Saniya Ali', 'Thomas Mathew', 'Uma Suresh', 'Vishnu V', 'Waseem A', 'Zoya Joseph',
];

const rows = names.map((name, i) => {
  const officer = officers[i % officers.length];
  return {
    'Customer Name': name,
    Mobile: String(8530001000 + i),
    Source: sources[i % sources.length],
    Branch: i % 3 === 0 ? branches[i % branches.length][0] : branches[i % branches.length][1],
    Location: ['Kochi', 'Aluva', 'Kottayam', 'Thrissur'][i % 4],
    Remarks: i % 3 === 0 ? 'Need more details' : 'Planning for later',
    Model: models[i % models.length],
    'SO Name': officer[0],
    'SO Phone No': officer[1],
    Status: i % 4 === 0 ? 'Called' : 'New',
  };
});

const out = 'demo-data/call-center-demo.xlsx';
await mkdir('demo-data', { recursive: true });
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Leads');
const headers = ['Customer Name', 'Mobile', 'Branch', 'Source', 'Model', 'Location', 'Remarks', 'SO Name', 'SO Phone No', 'Status'];
ws.addRow(headers);
for (const row of rows) ws.addRow(headers.map(h => row[h]));
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A47D4' } };
ws.columns.forEach((column, i) => { column.width = Math.max(headers[i].length + 2, ...rows.map(r => String(r[headers[i]]).length + 2)); });
ws.autoFilter = { from: 'A1', to: `I${rows.length + 1}` };
await wb.xlsx.writeFile(out);
console.log(`Wrote ${rows.length} demo leads to ${out}`);
