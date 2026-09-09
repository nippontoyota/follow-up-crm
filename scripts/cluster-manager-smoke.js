import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { all, get, pool } from '../db.js';
import { CLUSTER_MANAGER_DEFINITIONS } from '../cluster-managers.js';

const base = process.env.CLUSTER_BASE_URL || 'http://localhost:3000';
const adminUsername = process.env.CLUSTER_ADMIN_USER || (process.env.DEMO_MODE === '1' ? 'demo-admin' : 'admin');
const adminPassword = process.env.CLUSTER_ADMIN_PASSWORD || (process.env.DEMO_MODE === '1' ? 'demo123' : 'admin123');

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

async function adminSession() {
  try {
    return await login(adminUsername, adminPassword);
  } catch (error) {
    const admin = await get('SELECT id FROM users WHERE username = ? AND role = ? AND active = 1', adminUsername, 'admin');
    if (!admin) throw error;
    const secret = process.env.SESSION_SECRET || readFileSync('.secret', 'utf8').trim();
    const value = String(admin.id);
    const signature = createHmac('sha256', secret).update(value).digest('base64url');
    return `sid=${encodeURIComponent(`${value}.${signature}`)}`;
  }
}

async function protectedSnapshot() {
  const rows = await Promise.all([
    all(`SELECT md5(COALESCE(string_agg(format('%s:%s', id, name), '|' ORDER BY id), '')) AS sig FROM branches`),
    all(`SELECT md5(COALESCE(string_agg(format('%s:%s:%s:%s', id, branch_id, status, stage), '|' ORDER BY id), '')) AS sig FROM leads`),
    all(`SELECT md5(COALESCE(string_agg(format('%s:%s:%s:%s', id, lead_id, user_id, outcome), '|' ORDER BY id), '')) AS sig FROM followups`),
    all(`SELECT md5(COALESCE(string_agg(format('%s:%s:%s:%s', id, username, role, active), '|' ORDER BY id), '')) AS sig FROM users WHERE role <> 'cluster_manager'`),
  ]);
  return rows.map(([row]) => row.sig);
}

const before = await protectedSnapshot();
const admin = await adminSession();
const masters = await api('/api/masters', admin);
assert.equal(masters.status, 200, 'Admin must be able to read masters');
const branchIds = new Map((masters.data.branches || []).map(branch => [branch.name, branch.id]));

for (const manager of CLUSTER_MANAGER_DEFINITIONS) {
  const cookie = await login(manager.username, manager.password);
  const me = await api('/api/me', cookie);
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'cluster_manager');

  const expectedIds = manager.branches.flatMap(name => branchIds.has(name) ? [branchIds.get(name)] : []);
  const analytics = await api('/api/sales-manager/analytics', cookie);
  assert.equal(analytics.status, 200, `${manager.username} analytics failed`);
  assert.deepEqual(analytics.data.branchIds, expectedIds, `${manager.username} scope mismatch`);

  const override = await api('/api/sales-manager/analytics?branch_id=1', cookie);
  assert.equal(override.status, 200, `${manager.username} override request failed`);
  assert.deepEqual(override.data.branchIds, expectedIds, `${manager.username} branch override escaped scope`);

  if (manager.legacyUsername) {
    const oldLogin = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: manager.legacyUsername, password: `${manager.name.split(' ')[0]}Cluster#2026!` }),
    });
    assert.equal(oldLogin.status, 401, `${manager.legacyUsername} should no longer work`);
  }
}

const users = await api('/api/users?limit=100', admin);
assert.equal(users.status, 200);
const clusterRows = (users.data.users || []).filter(user => user.role === 'cluster_manager');
assert.deepEqual(clusterRows.map(user => user.username).sort(), CLUSTER_MANAGER_DEFINITIONS.map(m => m.username).sort());

const createAttempt = await api('/api/users', admin, 'POST', {
  name: 'Should Not Exist', username: 'should-not-exist', password: 'NeverCreated#2026!', role: 'cluster_manager', branch_id: null,
});
assert.equal(createAttempt.status, 400, 'Admin must not create cluster managers');

for (const row of clusterRows) {
  const toggleAttempt = await api(`/api/users/${row.id}/toggle`, admin, 'POST');
  assert.equal(toggleAttempt.status, 400, 'Admin must not toggle cluster managers');
}

assert.deepEqual(await protectedSnapshot(), before, 'Protected data changed during cluster-manager smoke test');
console.log(`Cluster manager smoke passed for ${CLUSTER_MANAGER_DEFINITIONS.length} fixed accounts.`);
await pool.end();
