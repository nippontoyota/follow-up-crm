import assert from 'node:assert/strict';

const base = String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const password = String(process.env.CEO_PASSWORD || '');
if (!password) throw new Error('CEO_PASSWORD is required for the CEO smoke test');

async function login(username, userPassword) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: userPassword }),
  });
  const body = await res.text();
  assert.ok(res.ok, `login failed for ${username}: ${body}`);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('sid='), `login did not return a sid cookie for ${username}`);
  return cookie;
}

async function request(path, cookie, method = 'GET', body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const ceo = await login('ceo.nippon', password);
const me = await request('/api/me', ceo);
assert.equal(me.status, 200);
assert.equal(me.data.role, 'ceo');

const branchAnalytics = await request('/api/analytics', ceo);
assert.equal(branchAnalytics.status, 200);
assert.ok(Array.isArray(branchAnalytics.data));

const callCenter = await request('/api/call-center/analytics', ceo);
assert.equal(callCenter.status, 200);
assert.ok(callCenter.data.summary && Array.isArray(callCenter.data.byBranch));

const sourceQuality = await request('/api/call-center/source-quality', ceo);
assert.equal(sourceQuality.status, 200);
assert.ok(sourceQuality.data.summary && Array.isArray(sourceQuality.data.branches));

const salesAnalytics = await request('/api/sales-manager/analytics', ceo);
assert.equal(salesAnalytics.status, 200);
assert.ok(Array.isArray(salesAnalytics.data.branchIds));
assert.ok(Array.isArray(salesAnalytics.data.bySalesOfficer));

const leadAnalysis = await request('/api/sales-manager/lead-analysis', ceo);
assert.equal(leadAnalysis.status, 200);
assert.ok(Array.isArray(leadAnalysis.data.branchIds));
assert.ok(Array.isArray(leadAnalysis.data.bySalesOfficer));

const leads = await request('/api/leads?page=1&limit=1', ceo);
assert.equal(leads.status, 200);
assert.ok(Array.isArray(leads.data.leads));
for (const key of ['total', 'page', 'pages']) assert.equal(typeof leads.data[key], 'number', `missing numeric leads.${key}`);

const denied = [
  ['/api/users', {}],
  ['/api/admin/reassign-leads', {}],
  ['/api/masters/branches', {}],
  ['/api/leads', {}],
  ['/api/leads/1/followup', {}],
  ['/api/leads/1/flag', {}],
  ['/api/leads/1/close-flag', {}],
];
for (const [path, body] of denied) {
  const result = await request(path, ceo, 'POST', body);
  assert.equal(result.status, 403, `${path} should reject CEO writes`);
}

if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const admin = await login(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
  const adminMe = await request('/api/me', admin);
  assert.equal(adminMe.status, 200);
  assert.equal(adminMe.data.role, 'admin');
}

console.log('CEO smoke passed: identity, all-branch report reads, lead reads, and write denials.');
