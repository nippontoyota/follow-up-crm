import assert from 'node:assert/strict';

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
  { customer_name: 'Smoke Test Kochi', mobile: runMobile('1'), branch: 'Nippon Toyota - Kochi', source: 'Meta', model: 'Hyryder', location: 'Kochi', so_name: 'Anil Menon', so_mobile: '9000001001', so_status: 'New' },
  { customer_name: 'Smoke Test Muvattupuzha', mobile: runMobile('2'), branch: 'Nippon Toyota - Muvattupuzha', source: 'Referral', model: 'Glanza', location: 'Muvattupuzha', so_name: 'Binu Thomas', so_mobile: '9000001002', so_status: 'Called' },
];
const valid = await api('/api/leads/bulk-validate', admin, 'POST', records);
assert.equal(valid.status, 200);
assert.equal(valid.data.valid.length, records.length);
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

const callAnalytics = await api('/api/call-center/analytics', callManager);
assert.equal(callAnalytics.status, 200, callAnalytics.data.error);
assert.equal(callAnalytics.data.byCallGuy.length, 5);
assert.ok(callAnalytics.data.kpi.total >= records.length);

const salesAnalytics = await api('/api/sales-manager/analytics', salesManager);
assert.equal(salesAnalytics.status, 200, salesAnalytics.data.error);
assert.ok(salesAnalytics.data.bySalesOfficer.every(r => r.sales_officer));
const crossBranch = await api('/api/sales-manager/analytics?branch_id=999999', salesManager);
assert.equal(crossBranch.status, 200);
assert.equal(crossBranch.data.branchId, salesAnalytics.data.branchId, 'Sales Manager must not override branch scope');

const adminSales = await api('/api/sales-manager/analytics?branch_id=1', admin);
assert.equal(adminSales.status, 200, adminSales.data.error);
const adminCall = await api('/api/call-center/analytics', admin);
assert.equal(adminCall.status, 200, adminCall.data.error);

console.log('Demo smoke test passed: import, five-person assignment, Call Guy follow-up, Call Center Manager analytics, Sales Manager scope, and Admin analytics.');
