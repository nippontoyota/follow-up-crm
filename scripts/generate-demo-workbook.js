import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';

const branches = ['Nippon Toyota - Kochi', 'Nippon Toyota - Muvattupuzha', 'Nippon Toyota - Thiruvalla'];
const officers = [
  ['Anil Menon', '9000001001'], ['Binu Thomas', '9000001002'], ['Catherine Paul', '9000001003'],
  ['Dinesh Kumar', '9000001004'], ['Fathima Rahman', '9000001005'], ['George Joseph', '9000001006'],
];
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
    Name: name,
    Mobile: String(8530001000 + i),
    Source: sources[i % sources.length],
    Branch: branches[i % branches.length],
    Location: ['Kochi', 'Aluva', 'Kottayam', 'Thrissur'][i % 4],
    Model: models[i % models.length],
    'SO Name': officer[0],
    'SO Mobile': officer[1],
    Status: i % 4 === 0 ? 'Called' : 'New',
  };
});

const out = 'demo-data/call-center-demo.xlsx';
await mkdir('demo-data', { recursive: true });
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Leads');
const headers = ['Name', 'Mobile', 'Source', 'Branch', 'Location', 'Model', 'SO Name', 'SO Mobile', 'Status'];
ws.addRow(headers);
for (const row of rows) ws.addRow(headers.map(h => row[h]));
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A47D4' } };
ws.columns.forEach((column, i) => { column.width = Math.max(headers[i].length + 2, ...rows.map(r => String(r[headers[i]]).length + 2)); });
ws.autoFilter = { from: 'A1', to: `I${rows.length + 1}` };
await wb.xlsx.writeFile(out);
console.log(`Wrote ${rows.length} demo leads to ${out}`);
