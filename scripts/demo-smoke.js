import assert from 'node:assert/strict';
import { get, pool } from '../db.js';

const base = process.env.DEMO_URL || 'http://localhost:3000';
const today = new Date().toISOString().slice(0, 10);
const runMobile = suffix => `8${String(Date.now()).slice(-8)}${suffix}`;

async function login(username) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo123' }),
  });
  assert.equal(res.status, 200, `login failed for ${username}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function api(path, cookie, method = 'GET', body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const admin = await login('demo-admin');
const callManager = await login('call-manager');
const salesManager = await login('sales-manager-kochi');
const callGuy = await login('callguy-1');

const callMe = await api('/api/me', callGuy);
assert.equal(callMe.data.role, 'call_guy');
const callGuys = await api('/api/users?role=call_guy&active=1&limit=100', admin);
const callGuyRows = callGuys.data.users || callGuys.data.items || [];
assert.equal(callGuyRows.length, 5, 'demo must have exactly five active Call Guys');
const callGuyIds = callGuyRows.map(u => u.id);

const records = [
  { customer_name: 'Smoke Test Kalamassery', mobile: runMobile('1'), branch: 'C001B', source: 'Meta', model: 'Hyryder', location: 'Kalamassery', so_name: 'Abhijith V M', so_mobile: '9656341149', so_status: 'New' },
  { customer_name: 'Smoke Test Muvattupuzha', mobile: runMobile('2'), branch: 'Nippon Toyota - Muvattupuzha', source: 'Referral', model: 'Glanza', location: 'Muvattupuzha', so_name: 'Binu Thomas', so_mobile: '9000001002', so_status: 'Called' },
];
const valid = await api('/api/leads/bulk-validate', admin, 'POST', records);
assert.equal(valid.status, 200);
assert.equal(valid.data.valid.length, records.length);
assert.equal(valid.data.valid[0].branch, 'Nippon Toyota - Kalamassery');
const assigned = await api('/api/leads/bulk-assign', admin, 'POST', { leads: valid.data.valid, call_guy_ids: callGuyIds });
assert.equal(assigned.status, 200, assigned.data.error);
assert.equal(assigned.data.added, records.length);

const queue = await api('/api/leads?tab=all&limit=100', callGuy);
assert.equal(queue.status, 200);
assert.ok(queue.data.leads.some(l => l.original_so_name), 'Call Guy queue should expose imported Sales Officer data');
const fresh = await api('/api/leads?tab=fresh&limit=100', callGuy);
const lead = fresh.data.leads[0];
assert.ok(lead, 'Call Guy should have a fresh lead');
const followup = await api(`/api/leads/${lead.id}/followup`, callGuy, 'POST', {
  call_status: 'Connected', outcome: 'Need More Details', next_date: today, remarks: 'Smoke test follow-up',
});
assert.equal(followup.status, 200, followup.data.error);

let followupCount = Number(followup.data.seq ?? lead.fcount ?? 1);
while (followupCount < 3) {
  const rnr = await api(`/api/leads/${lead.id}/followup`, callGuy, 'POST', {
    call_status: 'Not Connected', outcome: 'RNR', next_date: today, remarks: 'Smoke test RNR',
  });
  assert.equal(rnr.status, 200, rnr.data.error);
  followupCount = Number(rnr.data.seq ?? followupCount + 1);
}
const lostRnr = await api(`/api/leads/${lead.id}/followup`, callGuy, 'POST', {
  call_status: 'Not Connected', outcome: 'LOST RNR', next_date: null, remarks: 'Smoke test LOST RNR',
});
assert.equal(lostRnr.status, 200, lostRnr.data.error);
assert.equal(lostRnr.data.closed, true);
const closedLead = await api(`/api/leads/${lead.id}`, callGuy);
assert.equal(closedLead.status, 200, closedLead.data.error);
assert.equal(closedLead.data.stage, 'Lost Lead');
assert.equal(closedLead.data.status, 'closed');
assert.equal(closedLead.data.next_date, null);

const callAnalytics = await api('/api/call-center/analytics', callManager);
assert.equal(callAnalytics.status, 200, callAnalytics.data.error);
assert.equal(callAnalytics.data.byCallGuy.length, 5);
assert.ok(callAnalytics.data.kpi.total >= records.length);

const salesAnalytics = await api('/api/sales-manager/analytics', salesManager);
assert.equal(salesAnalytics.status, 200, salesAnalytics.data.error);
assert.ok(salesAnalytics.data.bySalesOfficer.every(r => r.sales_officer));
assert.ok(salesAnalytics.data.bySalesOfficer.every(r => {
  const total = Number(r.total);
  const booked = Number(r.booked);
  const retailed = Number(r.retailed);
  const due = Number(r.due);
  return [total, booked, retailed, due].every(Number.isFinite)
    && total >= 0 && booked >= 0 && retailed >= 0 && due >= 0
    && booked + retailed <= total;
}), 'Sales Officer outcome counts must be non-negative and fit within total leads');
assert.ok(Array.isArray(salesAnalytics.data.byModel), 'Sales analytics must include model performance');
assert.ok(salesAnalytics.data.byModel.every(r => r.model));
assert.ok(salesAnalytics.data.byModel.every(r => {
  const total = Number(r.total);
  const booked = Number(r.booked);
  const retailed = Number(r.retailed);
  const due = Number(r.due);
  return [total, booked, retailed, due].every(Number.isFinite)
    && total >= 0 && booked >= 0 && retailed >= 0 && due >= 0
    && booked + retailed <= total;
}), 'Model outcome counts must be non-negative and fit within total leads');
const crossBranch = await api('/api/sales-manager/analytics?branch_id=999999', salesManager);
assert.equal(crossBranch.status, 200);
assert.equal(crossBranch.data.branchId, salesAnalytics.data.branchId, 'Sales Manager must not override branch scope');

const adminSales = await api('/api/sales-manager/analytics?branch_id=1', admin);
assert.equal(adminSales.status, 200, adminSales.data.error);
const adminCall = await api('/api/call-center/analytics', admin);
assert.equal(adminCall.status, 200, adminCall.data.error);

const beforeReportCounts = await get(`SELECT
  (SELECT COUNT(*)::int FROM leads) AS leads,
  (SELECT COUNT(*)::int FROM followups) AS followups`);
const sourceQuality = await api('/api/call-center/source-quality', callManager);
assert.equal(sourceQuality.status, 200, sourceQuality.data.error);
const sourceRows = sourceQuality.data.sources || [];
const summary = sourceQuality.data.summary || {};
assert.ok(sourceRows.some(row => row.source_group === 'Referral'), 'Referral group should exist');
const referral = sourceRows.find(row => row.source_group === 'Referral');
assert.ok(referral.raw_sources.includes('Referral'));
assert.ok(referral.raw_sources.includes('Customer Referral'));
const tkm = sourceRows.find(row => row.source_group === 'TKM');
assert.ok(tkm, 'TKM group should exist');
assert.ok(tkm.raw_sources.includes('TKM Website'));
const unknown = sourceRows.find(row => row.source_group === 'Unknown');
assert.ok(unknown && unknown.leads > 0, 'Unknown source group should include blank source leads');
assert.ok(summary.leads > 0, 'Source quality summary should contain leads');
assert.ok(sourceRows.every(row => row.leads > 0), 'Source quality rows should contain leads');
assert.equal(summary.leads, sourceRows.reduce((sum, row) => sum + row.leads, 0));
for (const row of sourceRows) {
  assert.ok(row.connected <= row.attempted && row.attempted <= row.leads, `${row.source_group} funnel counts must be ordered`);
  assert.equal(row.won_rate, row.leads ? (row.booked + row.retailed) / row.leads : null);
}
assert.equal(sourceQuality.data.attention.conversion, null, 'demo source groups should not meet the conversion sample threshold');
assert.equal(sourceQuality.data.attention.conversion_unavailable, true);
assert.equal(sourceQuality.data.attention.unknown.leads, unknown.leads);
const reportBranchId = Number(valid.data.valid[0].branch_id);
const branchQuality = await api(`/api/call-center/source-quality?branch_id=${reportBranchId}`, callManager);
assert.equal(branchQuality.status, 200, branchQuality.data.error);
assert.ok((branchQuality.data.branches || []).every(row => Number(row.branch_id) === reportBranchId));
const invalidBranchQuality = await api('/api/call-center/source-quality?branch_id=999999', callManager);
assert.equal(invalidBranchQuality.status, 400);
const referralWon = await api('/api/manager/leads?scope=call_center&source_group=Referral&quality_metric=won', callManager);
assert.equal(referralWon.status, 200, referralWon.data.error);
assert.ok(referralWon.data.every(row => ['Booking Done', 'Retail Done'].includes(row.stage)));
const tkmConnected = await api('/api/manager/leads?scope=call_center&source_group=TKM&quality_metric=connected', callManager);
assert.equal(tkmConnected.status, 200, tkmConnected.data.error);
const unknownLeads = await api('/api/manager/leads?scope=call_center&source_group=Unknown&quality_metric=total', callManager);
assert.equal(unknownLeads.status, 200, unknownLeads.data.error);
assert.ok(unknownLeads.data.every(row => !row.source));
const callGuyReport = await api('/api/call-center/source-quality', callGuy);
assert.equal(callGuyReport.status, 403);
const adminSourceQuality = await api('/api/call-center/source-quality', admin);
assert.equal(adminSourceQuality.status, 200, adminSourceQuality.data.error);
const afterReportCounts = await get(`SELECT
  (SELECT COUNT(*)::int FROM leads) AS leads,
  (SELECT COUNT(*)::int FROM followups) AS followups`);
assert.deepEqual(afterReportCounts, beforeReportCounts, 'source quality reads must not mutate CRM data');

console.log('Demo smoke test passed: import, five-person assignment, Call Guy follow-up, LOST RNR close, Call Center analytics, source grouping, source drilldowns, read-only checks, Sales Manager scope, and Admin analytics.');
await pool.end();
