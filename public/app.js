/* Follow-up CRM — single-file front end. Mobile first, no build step. */

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const hdr = document.getElementById('hdr');

let me = null;        // current user + server config (today, maxDate, outcomes)
let masters = {};     // branches / sources / activities / models
let tab = '';

/* ------------------------------------------------------------------- utils */

const el = (html) => Object.assign(document.createElement('div'), { innerHTML: html }).firstElementChild;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = (id) => document.getElementById(id).value.trim();

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let _toastTimer;
function toast(msg, kind = 'err') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  clearTimeout(_toastTimer);
  t.className = kind;
  t.textContent = msg;
  t.classList.add('show');
  _toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

function say(msg, kind = 'err') {
  // The open sheet owns the message slot while it is up, otherwise the page does.
  const scope = document.querySelector('.sheet') || document;
  const box = scope.querySelector('#msg') || document.getElementById('msg');
  if (!box) return toast(msg, kind);
  box.className = 'msg ' + kind;
  box.textContent = msg;
  box.scrollIntoView({ block: 'nearest' });
}

const options = (list, sel) => '<option value="">Select…</option>' +
  list.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.name)}</option>`).join('');

function dueLabel(lead) {
  if (lead.status === 'closed') return `<span class="pill">${esc(lead.stage)}</span>`;
  if (!lead.fcount) return '<span class="pill new">Fresh</span>';
  if (lead.next_date < me.today) return `<span class="pill late">Overdue · ${lead.next_date}</span>`;
  if (lead.next_date === me.today) return '<span class="pill due">Due today</span>';
  return `<span class="pill">${lead.next_date}</span>`;
}

/* ------------------------------------------------------------------- login */

function loginView() {
  hdr.classList.add('hide');
  nav.classList.add('hide');
  document.body.style.paddingBottom = '0';
  view.style.padding = '0';
  view.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <img src="logo.png" class="login-logo-img" alt="Logo" onerror="this.style.display='none'">
        <h2 id="loginTitle" style="min-height:1.4em">&nbsp;</h2>

        <form id="lf">
          <div class="input-line">
            <span class="ico">✉</span>
            <input id="u" placeholder="Username" autocapitalize="none" autocomplete="username">
          </div>
          <div class="input-line">
            <span class="ico">🔒</span>
            <input id="p" type="password" placeholder="Password" autocomplete="current-password">
            <button type="button" class="eye" id="togglePw">👁</button>
          </div>
          <button class="btn-login" type="submit">Sign in</button>
          <div id="msg" style="margin-top:16px;font-size:14px;color:#ef4444;text-align:center;min-height:20px"></div>
        </form>
      </div>
    </div>`;

  // Typewriter animation for heading
  (() => {
    const el = document.getElementById('loginTitle');
    if (!el) return;
    const text = 'Welcome back';
    let i = 0;
    el.textContent = '';
    el.style.borderRight = '2px solid var(--brand)';
    const tick = setInterval(() => {
      if (i < text.length) { el.textContent += text[i++]; return; }
      clearInterval(tick);
      let on = true;
      setInterval(() => { el.style.borderRightColor = (on = !on) ? 'var(--brand)' : 'transparent'; }, 530);
    }, 80);
  })();

  document.getElementById('togglePw').onclick = () => {
    const p = document.getElementById('p');
    p.type = p.type === 'password' ? 'text' : 'password';
  };
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-login');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await api('/login', 'POST', { username: val('u'), password: document.getElementById('p').value.trim() });
      document.body.style.paddingBottom = '';
      view.style.padding = '';
      boot();
    } catch (err) {
      document.getElementById('msg').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  };
}

/* -------------------------------------------------------------------- shell */

const TABS = {
  admin:   [['analytics', 'Analytics', '📊'], ['users', 'Users', '👤'], ['lists', 'Lists', '🗂'], ['leads', 'All leads', '📋']],
  marketing: [['new', 'Add lead', '➕'], ['leads', 'My leads', '📋']],
  sales:   [['fresh', 'Fresh Leads', '🆕'], ['today', 'Today', '📅'], ['leads', 'All', '📋']],
  manager: [['dashboard', 'Dashboard', '📊']],
};

async function boot() {
  try { me = await api('/me'); } catch { return loginView(); }
  masters = await api('/masters');

  hdr.classList.remove('hide');
  nav.classList.remove('hide');
  const roleLabel = { admin: 'Admin', marketing: 'Marketing', manager: 'Sales Manager' };
  document.getElementById('hdrUser').textContent = roleLabel[me.role]
    ? `${me.name} · ${roleLabel[me.role]}` : '';

  nav.innerHTML = TABS[me.role]
    .map(([k, label, icon]) => `<button data-t="${k}"><b>${icon}</b><span class="lbl">${label}</span></button>`).join('') +
    `<button id="logout" style="margin-top:auto" title="Sign out"><b><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg></b><span class="lbl">Sign out</span></button>`;
    
  nav.querySelectorAll('button:not(#logout)').forEach(b => b.onclick = () => go(b.dataset.t));
  
  document.getElementById('logout').onclick = async () => {
    await api('/logout', 'POST');
    me = null;
    loginView();
  };

  go(TABS[me.role][0][0]);
}

function go(t) {
  tab = t;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.getElementById('hdrTitle').textContent =
    TABS[me.role].find(x => x[0] === t)[1];
  ({ analytics: analyticsView, users: usersView, lists: listsView, new: newLeadView, fresh: leadsView, today: leadsView, leads: leadsView, dashboard: managerView })[t]();
}

/* ------------------------------------------------------------- admin: users */

async function usersView() {
  const users = await api('/users');
  view.innerHTML = `
    <div class="card">
      <h2>Create user</h2>
      <label>Full name <span class="req">*</span></label><input id="n">
      <label>Username <span class="req">*</span></label><input id="un" autocapitalize="none">
      <label>Password <span class="req">*</span> <em>(min 6 characters)</em></label><input id="pw" type="password">
      <label>Role <span class="req">*</span></label>
      <select id="role">
        <option value="">Select…</option>
        <option value="admin">Admin</option>
        <option value="marketing">Marketing</option>
        <option value="sales">Sales Officer</option>
        <option value="manager">Sales Manager</option>
      </select>
      <div id="branchWrap" class="hide">
        <label>Branch <span class="req">*</span></label>
        <select id="br">${options(masters.branches)}</select>
      </div>
      <button class="btn" id="save">Create user</button>
      <div id="msg"></div>
    </div>
    <div class="card">
      <h2>Users (${users.length})</h2>
      <div class="rows">${users.map(u => `
        <div class="row">
          <span><b>${esc(u.name)}</b><br><em>@${esc(u.username)} · ${u.role}${u.branch ? ' · ' + esc(u.branch) : ''}${u.active ? '' : ' · disabled'}</em></span>
          <button data-id="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
        </div>`).join('')}</div>
    </div>`;

  document.getElementById('role').onchange = (e) =>
    document.getElementById('branchWrap').classList.toggle('hide', !['sales','manager'].includes(e.target.value));

  document.getElementById('save').onclick = async () => {
    try {
      await api('/users', 'POST', {
        name: val('n'), username: val('un'), password: document.getElementById('pw').value.trim(),
        role: val('role'), branch_id: val('br') || null,
      });
      usersView();
    } catch (e) { say(e.message); }
  };

  view.querySelectorAll('.row button').forEach(b => b.onclick = async () => {
    try { await api(`/users/${b.dataset.id}/toggle`, 'POST'); usersView(); }
    catch (e) { say(e.message); }
  });

  // Reassign leads card
  const officers = users.filter(u => u.role === 'sales' && u.active);
  const officerOpts = officers.map(u => `<option value="${u.id}">${esc(u.name)}${u.branch ? ' · ' + esc(u.branch) : ''}</option>`).join('');
  const reassignCard = el(`<div class="card">
    <h2>Reassign Leads</h2>
    <label>From officer</label>
    <select id="raFrom"><option value="">Select officer…</option>${officerOpts}</select>
    <label>Mode</label>
    <select id="raMode">
      <option value="untouched">Untouched leads only (fcount = 0)</option>
      <option value="open">All open leads</option>
    </select>
    <label>To officers <em>(tick all targets — distributed equally)</em></label>
    <div id="raTo" style="display:flex;flex-direction:column;gap:6px;padding:4px 0">
      ${officers.map(u => `<label style="display:flex;align-items:center;gap:8px;font-weight:400">
        <input type="checkbox" value="${u.id}"> ${esc(u.name)}${u.branch ? ' · ' + esc(u.branch) : ''}
      </label>`).join('')}
    </div>
    <button class="btn" id="raBtn" style="margin-top:8px">Reassign</button>
    <div id="raMsg"></div>
  </div>`);
  view.appendChild(reassignCard);

  document.getElementById('raBtn').onclick = async () => {
    const fromId = val('raFrom');
    const toIds = [...document.querySelectorAll('#raTo input:checked')].map(c => Number(c.value));
    const mode  = val('raMode');
    const msgEl = document.getElementById('raMsg');
    if (!fromId) { msgEl.className='msg err'; msgEl.textContent='Select the source officer.'; return; }
    if (!toIds.length) { msgEl.className='msg err'; msgEl.textContent='Tick at least one target officer.'; return; }
    if (toIds.includes(Number(fromId))) { msgEl.className='msg err'; msgEl.textContent='Source cannot also be a target.'; return; }
    document.getElementById('raBtn').disabled = true;
    try {
      const r = await api('/admin/reassign-leads', 'POST', { from_id: Number(fromId), to_ids: toIds, mode });
      msgEl.className = 'msg ok';
      msgEl.textContent = `Done — ${r.moved} lead${r.moved !== 1 ? 's' : ''} reassigned equally across ${toIds.length} officer${toIds.length !== 1 ? 's' : ''}.`;
    } catch (e) { msgEl.className='msg err'; msgEl.textContent=e.message; }
    document.getElementById('raBtn').disabled = false;
  };
}

/* ------------------------------------------------------------- admin: lists */

const LIST_LABELS = { branches: 'Branches', sources: 'Sources', activities: 'Activities', models: 'Model names' };

async function listsView() {
  masters = await api('/masters');
  view.innerHTML = Object.entries(LIST_LABELS).map(([key, label]) => `
    <div class="card">
      <h2>${label} (${masters[key].length})</h2>
      <div class="grid2">
        <input id="in-${key}" placeholder="Add ${label.toLowerCase().replace(/s$/, '')}">
        <button class="btn" data-add="${key}">Add</button>
      </div>
      <div class="rows">${masters[key].map(m => `
        <div class="row"><span>${esc(m.name)}</span>
          <button data-del="${key}" data-id="${m.id}">Remove</button></div>`).join('')}</div>
    </div>`).join('') + '<div id="msg"></div>';

  view.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
    const name = val('in-' + b.dataset.add);
    if (!name) return;
    try { await api('/masters/' + b.dataset.add, 'POST', { name }); listsView(); }
    catch (e) { say(e.message); }
  });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this entry?')) return;
    try { await api(`/masters/${b.dataset.del}/${b.dataset.id}`, 'DELETE'); listsView(); }
    catch (e) { say(e.message); }
  });
}

/* -------------------------------------------------------- marketing: capture */

function newLeadView() {
  view.innerHTML = `
    <div class="card">
      <h2>New lead</h2>
      <label>Customer name <span class="req">*</span></label><input id="cn" autocomplete="off">
      <label>Mobile number <span class="req">*</span></label>
      <input id="mo" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digits">
      <label>Source <span class="req">*</span></label><select id="so">${options(masters.sources)}</select>
      <label>Branch <span class="req">*</span></label><select id="bn">${options(masters.branches)}</select>
      <label>Model</label><select id="ml">${options(masters.models)}</select>
      <label>Activity</label><select id="ac">${options(masters.activities)}</select>
      <label>Location</label><input id="lo">
      <label>Remarks</label><textarea id="re"></textarea>
      <button class="btn" id="save">Save lead</button>
      <div id="msg"></div>
    </div>`;

  document.getElementById('mo').oninput = (e) => e.target.value = e.target.value.replace(/\D/g, '');

  document.getElementById('save').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/leads', 'POST', {
        customer_name: val('cn'), mobile: val('mo'), source_id: val('so'),
        branch_id: val('bn'), location: val('lo'), remarks: val('re'),
        model_id: val('ml') || null, activity_id: val('ac') || null,
      });
      newLeadView();
      say(r.warning || (r.officerName ? `Lead saved and assigned to ${r.officerName}.` : 'Lead saved and assigned.'), r.warning ? 'err' : 'ok');
    } catch (err) { say(err.message); e.target.disabled = false; }
  };
}

/* ------------------------------------------------------------------- leads */

/* --------------------------------------------------------------- manager */

function stageLink(officerId, stage, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  return `<button class="tbl-link" onclick="openStageLeads(${officerId},'${stage}')">${count}</button>`;
}

function outcomeLink(callStatus, outcome, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  const cs = encodeURIComponent(callStatus), oc = encodeURIComponent(outcome);
  return `<button class="tbl-link" onclick="openOutcomeLeads('${cs}','${oc}','${esc(outcome)}')">${count}</button>`;
}

function lostCaseLink(outcome, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  const oc = encodeURIComponent(outcome);
  return `<button class="tbl-link" style="color:var(--bad)" onclick="openLostLeads('${oc}','${esc(outcome)}')">${count}</button>`;
}

async function openOutcomeLeads(callStatus, outcome, label) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="olx">← Back</button></div>
    <div class="card" id="olCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#olx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/manager/leads?call_status=${callStatus}&outcome=${outcome}`);
    const card = sheet.querySelector('#olCard');
    card.innerHTML = `<h2>${esc(decodeURIComponent(label))} · ${leads.length} leads</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Officer</th><th>Next Date</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.officer || '—')}</td>
          <td>${esc(l.next_date || '—')}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#olCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

async function openLostLeads(outcome, label) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="llx">← Back</button></div>
    <div class="card" id="llCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#llx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/manager/leads?latest_outcome=${outcome}`);
    const card = sheet.querySelector('#llCard');
    card.innerHTML = `<h2 style="color:var(--bad)">Lost — ${esc(decodeURIComponent(label))} · ${leads.length} leads</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Officer</th><th>F#</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.officer || '—')}</td>
          <td>${l.fcount}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#llCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

async function openStageLeads(officerId, stage) {
  const label = { pending:'Pending', f1:'F1', f2:'F2', f3:'F3', f4:'F4', f5plus:'F5+' }[stage];
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="slx">← Back</button></div>
    <div class="card" id="slCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#slx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/manager/leads?officer_id=${officerId}&stage=${stage}`);
    const card = sheet.querySelector('#slCard');
    card.innerHTML = `<h2>${label} Leads · ${leads.length}</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Next Date</th><th>F#</th><th>Source</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.next_date || '—')}</td>
          <td>F${l.fcount}</td>
          <td>${esc(l.source || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#slCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

async function openFlaggedLeads(officerId, officerName) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="flx">← Back</button></div>
    <div class="card" id="flCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#flx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/manager/leads?officer_id=${officerId}&flagged=1`);
    const card = sheet.querySelector('#flCard');
    card.innerHTML = `<h2 style="color:#f57c00">⚑ Flagged Leads — ${esc(officerName)} · ${leads.length}</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Stage</th><th>F#</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.stage || '—')}</td>
          <td>F${l.fcount}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No flagged leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#flCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

function tblHtml(cols, rows, empty = 'No data') {
  if (!rows.length) return `<p style="padding:16px;color:var(--muted);text-align:center">${empty}</p>`;
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v ?? 0}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

async function managerView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  let d;
  try { d = await api('/manager/analytics'); }
  catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${e.message}</div>`; return; }

  const { kpi, byOfficer, outcomes, byStage, overdue, officerOutcomes, flagged = [], lostCases = [] } = d;
  const connected    = outcomes.filter(o => o.call_status === 'Connected');
  const notConnected = outcomes.filter(o => o.call_status === 'Not Connected');
  const connTotal    = connected.reduce((s, o) => s + o.cnt, 0);
  const notConnTotal = notConnected.reduce((s, o) => s + o.cnt, 0);
  const lostTotal    = lostCases.reduce((s, o) => s + o.cnt, 0);

  view.innerHTML = `
    ${kpiRow([
      { num: kpi.total,    lbl: 'Total Leads',     col: 'brand' },
      { num: kpi.untouched,lbl: 'Untouched',       col: 'warn'  },
      { num: kpi.followup, lbl: 'Under Follow-up', col: 'brand' },
      { num: kpi.lost,     lbl: 'Lost',            col: 'bad'   },
      { num: kpi.booked,   lbl: 'Booked',          col: 'ok'    },
      { num: kpi.retailed, lbl: 'Retail',          col: 'ok'    },
    ])}

    <div class="card">
      <h2>Sales Officer Performance</h2>
      ${tblHtml(
        ['Officer','Total','Untouched','Under Follow-up','Today\'s Follow-up','Lost','Booked','Retail'],
        byOfficer.map(r => [r.officer, r.total, r.untouched, r.followup, r.today_followup, r.lost, r.booked, r.retailed]),
        'No sales officers in this branch'
      )}
    </div>

    <div class="card">
      <h2>Call Outcome Analysis <span style="font-size:13px;color:var(--muted);font-weight:400">(latest call per lead)</span></h2>
      <div class="outcome-grid">
        <div>
          <div class="outcome-head ok">✓ Connected</div>
          ${tblHtml(['Outcome','Count'], [
            ...connected.map(o => [esc(o.outcome), outcomeLink('Connected', o.outcome, o.cnt)]),
            [`<b>Total Connected</b>`, `<b>${connTotal}</b>`],
          ])}
        </div>
        <div>
          <div class="outcome-head bad">✗ Not Connected</div>
          ${tblHtml(['Outcome','Count'], [
            ...notConnected.map(o => [esc(o.outcome), outcomeLink('Not Connected', o.outcome, o.cnt)]),
            [`<b>Total Not Connected</b>`, `<b>${notConnTotal}</b>`],
          ])}
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted)">
        <span>Untouched (no calls): <b style="color:var(--text)">${kpi.untouched}</b></span>
        <span>Grand Total: <b style="color:var(--text)">${connTotal + notConnTotal + kpi.untouched}</b></span>
      </div>
    </div>

    <div class="card" style="border-color:var(--bad)">
      <h2 style="color:var(--bad)">Lost Case Analysis</h2>
      ${lostCases.length ? `
        ${tblHtml(
          ['Lost Reason', 'Leads'],
          [
            ...lostCases.map(r => [esc(r.outcome), lostCaseLink(r.outcome, r.cnt)]),
            [`<b>Total Lost</b>`, `<b>${lostTotal}</b>`],
          ]
        )}` : '<p style="color:var(--muted);padding:8px 0">No lost leads yet.</p>'}
    </div>

    ${flagged.length ? `<div class="card" style="border-color:#f57c00">
      <h2 style="color:#f57c00">⚑ Flagged Leads by Officer</h2>
      ${tblHtml(
        ['Officer','Flagged Leads'],
        flagged.map(r => [esc(r.officer), `<button class="tbl-link flag-drill" data-oid="${r.officer_id}" data-oname="${esc(r.officer)}">${r.flagged}</button>`]),
      )}
    </div>` : ''}

    <div class="card">
      <h2>Overdue Follow-ups by Officer</h2>
      ${tblHtml(
        ['Officer','Overdue Leads'],
        overdue.map(r => [r.officer, r.overdue]),
        'No overdue follow-ups'
      )}
    </div>

    <div class="card">
      <h2>Salesforce Officer — Call Outcome Analysis</h2>
      ${tblHtml(
        ['SF Sales Officer','Total Leads','Total Calls','Connected','Not Connected',
         'Test Drive','Showroom','Exchange','Booking Done','Retail Done','Need Time','Need SO Call',
         'More Details','Discount','Not Interested','Already Booked','Lost',
         'RNR','Switch Off','Call Back','Call Fwd','Line Busy','Invalid No.'],
        officerOutcomes.map(r => [
          esc(r.so_name), r.total, r.total_calls, r.connected, r.not_connected,
          r.need_test_drive, r.showroom_visit, r.exchange_issue, r.booking_done, r.retail_done,
          r.need_time, r.need_so_call, r.need_more_details, r.discount_issue,
          r.not_interested, r.already_booked, r.lost_calls,
          r.rnr, r.switch_off, r.call_me_back, r.call_forwarding, r.line_busy, r.invalid_number,
        ]),
        'No Salesforce data uploaded for this branch'
      )}
    </div>

    <div class="card">
      <h2>Lead Stage Analysis by Officer</h2>
      ${tblHtml(
        ['Officer','Pending','F1','F2','F3','F4','F5+'],
        byStage.map(r => [
          esc(r.officer),
          stageLink(r.officer_id, 'pending', r.pending),
          stageLink(r.officer_id, 'f1',      r.f1),
          stageLink(r.officer_id, 'f2',      r.f2),
          stageLink(r.officer_id, 'f3',      r.f3),
          stageLink(r.officer_id, 'f4',      r.f4),
          stageLink(r.officer_id, 'f5plus',  r.f5plus),
        ]),
        'No data'
      )}
    </div>`;

  view.querySelectorAll('.flag-drill').forEach(btn => {
    btn.onclick = () => openFlaggedLeads(btn.dataset.oid, btn.dataset.oname);
  });
}

function kpiRow(cards) {
  return `<div class="kpi-row">${cards.map(c =>
    `<div class="kpi-card kpi-${c.col}"><div class="kpi-num">${c.num}</div><div class="kpi-lbl">${c.lbl}</div></div>`
  ).join('')}</div>`;
}

async function leadsView() {
  const t = tab === 'leads' ? 'all' : tab;
  view.innerHTML = '<div class="empty">Loading…</div>';
  const [leads, stats] = await Promise.all([api('/leads?tab=' + t), api('/leads/stats')]);

  const kpi = {
    fresh: kpiRow([
      { num: leads.length,  lbl: 'Fresh Leads', col: 'brand' },
      { num: stats.booked,  lbl: 'Booked',      col: 'ok'    },
      { num: stats.retailed,lbl: 'Retailed',     col: 'ok'    },
      { num: stats.lost,    lbl: 'Lost',         col: 'bad'   },
    ]),
    today: kpiRow([
      { num: leads.length,      lbl: "Today's Follow-ups", col: 'brand' },
      { num: stats.booked,      lbl: 'Booked',             col: 'ok'    },
      { num: stats.retailed,    lbl: 'Retailed',           col: 'ok'    },
      { num: stats.lost,        lbl: 'Lost',               col: 'bad'   },
    ]),
    all: kpiRow([
      { num: stats.total,   lbl: 'All Leads', col: 'brand' },
      { num: stats.booked,  lbl: 'Booked',    col: 'ok'    },
      { num: stats.retailed,lbl: 'Retailed',  col: 'ok'    },
      { num: stats.lost,    lbl: 'Lost',      col: 'bad'   },
    ]),
  }[t] || '';

  const isBulkAdmin = (me.role === 'admin' && t === 'all');
  const searchHtml = `
    <div class="search-bar-wrap">
      <div class="search-bar-inner">
        <svg class="search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="leadSearch" placeholder="Search by name or mobile…" autocomplete="off">
        ${isBulkAdmin ? `
          <input type="file" id="bulkFile" accept=".xlsx,.xls" style="display:none">
          <button class="btn ghost" style="width:auto;margin:0;padding:6px 14px;font-size:13px;white-space:nowrap" onclick="document.getElementById('bulkFile').click()">Bulk Upload</button>
        ` : ''}
      </div>
    </div>`;

  if (!leads.length) {
    const blank = { fresh: 'No fresh leads right now.', today: 'Nothing due today. Nice work.', all: 'No leads yet.' };
    view.innerHTML = kpi + searchHtml + `<div class="empty">${blank[t]}</div>`;
  } else {
    view.innerHTML = kpi + searchHtml + leads.map(l => `
      <div class="card lead" data-id="${l.id}" data-name="${esc(l.customer_name.toLowerCase())}" data-mobile="${esc(l.mobile)}" tabindex="0" role="button">
        <div class="top"><b>${esc(l.customer_name)}</b>${dueLabel(l)}</div>
        <div class="meta">${esc(l.mobile)} · ${esc(l.branch || '—')}${l.location ? ' · ' + esc(l.location) : ''}</div>
        <div class="meta">${esc(l.source || 'No source')} · ${l.fcount ? 'F' + l.fcount + ' done — ' + esc(l.stage) : 'Not contacted'}${me.role !== 'sales' && l.officer ? ' · ' + esc(l.officer) : ''}</div>
        ${me.role === 'sales' ? `<div style="margin-top:10px"><button class="flag-btn${l.is_flagged ? ' flagged' : ''}" data-id="${l.id}" title="${l.is_flagged ? 'Remove flag' : 'Flag to SM/TL'}">⚑ Flag to SM/TL</button></div>` : ''}
      </div>`).join('');
  }

  const sInput = document.getElementById('leadSearch');
  if (sInput) {
    sInput.oninput = () => {
      const q = sInput.value.toLowerCase().trim();
      view.querySelectorAll('.lead').forEach(b => {
        const hit = !q || b.dataset.name.includes(q) || b.dataset.mobile.includes(q);
        b.style.display = hit ? '' : 'none';
      });
    };
    sInput.focus();
  }

  view.querySelectorAll('.lead').forEach(card => {
    card.onclick = (e) => { if (!e.target.closest('.flag-btn')) openLead(card.dataset.id); };
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') openLead(card.dataset.id); };
  });

  view.querySelectorAll('.flag-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        const data = await api(`/leads/${btn.dataset.id}/flag`, 'POST');
        btn.classList.toggle('flagged', !!data.is_flagged);
        btn.title = data.is_flagged ? 'Remove flag' : 'Flag to SM/TL';
      } catch (err) { say(err.message, 'err'); }
      btn.disabled = false;
    };
  });
  
  if (isBulkAdmin) {
    const fb = document.getElementById('bulkFile');
    if (fb) fb.onchange = handleBulkUpload;
  }
}

let bulkValid = [];
let bulkInvalid = [];

async function handleBulkUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  say('Parsing file...', 'ok');
  try {
    const buf = await file.arrayBuffer();
    if (typeof XLSX === 'undefined') throw new Error('SheetJS library failed to load');
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws);

    const records = data.map(r => {
      let branch = null, source = null, mobile = null, customer_name = null;
      let model = null, activity = null, location = null, remarks = null;
      let so_name = null, so_mobile = null;
      for (const key of Object.keys(r)) {
        const k = key.toLowerCase().trim();
        const v = r[key];
        // SO columns must be checked before generic name/phone checks
        if (k === 'so name' || k === 'so_name' || k === 'soname' || k.includes('sales officer name') || k.includes('consultant name')) so_name = String(v || '').trim() || null;
        else if (k === 'so phone' || k === 'so phone no' || k === 'so_phone' || k === 'so_mobile' || k === 'so mobile' || k.includes('sales officer phone') || k.includes('consultant phone')) so_mobile = String(v || '').replace(/\D/g, '').slice(-10) || null;
        else if (k.includes('branch')) branch = v;
        else if (k.includes('source')) source = v;
        else if (k.includes('mobile') || k.includes('phone') || k === 'uid' || k === 'contact') mobile = String(v).replace(/\D/g, '').slice(-10);
        else if (k.includes('customer') || k.includes('name')) customer_name = v;
        else if (k.includes('model')) model = v;
        else if (k.includes('activity')) activity = v;
        else if (k.includes('location')) location = v;
        else if (k.includes('remark')) remarks = v;
      }
      return { branch, source, mobile, customer_name, model, activity, location, remarks, so_name, so_mobile };
    }).filter(r => r.mobile || r.customer_name);

    if (!records.length) throw new Error('No valid rows found in sheet');

    say('Validating leads...', 'ok');
    const res = await api('/leads/bulk-validate', 'POST', records);
    bulkValid = res.valid || [];
    bulkInvalid = res.invalid || [];
    const bulkDuplicates = res.duplicates || 0;
    
    showBulkReviewSheet(bulkDuplicates);
  } catch(err) {
    say(err.message, 'err');
  }
}

async function showBulkReviewSheet(duplicates = 0) {
  // Fetch sales officers to build per-branch assignment selectors
  let allUsers = [];
  try { allUsers = await api('/users'); } catch { /* non-fatal */ }
  const salesOfficers = allUsers.filter(u => u.role === 'sales' && u.active === 1);

  // Group valid leads by branch to show one selector per branch
  const branchMap = {};
  for (const l of bulkValid) {
    if (!branchMap[l.branch_id]) {
      const branchName = masters.branches.find(b => b.id === l.branch_id)?.name || `Branch ${l.branch_id}`;
      branchMap[l.branch_id] = { name: branchName, count: 0 };
    }
    branchMap[l.branch_id].count++;
  }

  const assignHtml = Object.entries(branchMap).map(([branchId, info]) => {
    const bOfficers = salesOfficers.filter(u => u.branch_id === Number(branchId));
    return `<div style="margin-bottom:18px">
      <div style="font-weight:600;margin-bottom:6px">${esc(info.name)} <span style="font-weight:400;color:var(--muted);font-size:13px">(${info.count} lead${info.count !== 1 ? 's' : ''})</span></div>
      ${!bOfficers.length
        ? `<p style="color:var(--bad);font-size:13px">No active sales officers in this branch.</p>`
        : `<div style="display:flex;flex-wrap:wrap;gap:8px">
            ${bOfficers.map(u => `<label style="display:flex;align-items:center;gap:6px;font-size:14px;background:var(--bg);border:1.5px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer">
              <input type="checkbox" class="assign-cb" data-branch="${branchId}" value="${u.id}" style="accent-color:var(--brand);width:15px;height:15px">
              ${esc(u.name)}
            </label>`).join('')}
          </div>`
      }
    </div>`;
  }).join('');

  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="x">Cancel</button></div>
    <div class="card">
      <h2>Bulk Upload Review</h2>
      <p><b>${bulkValid.length}</b> leads are ready to import.</p>
      ${duplicates ? `<p style="color:var(--text-light)"><b>${duplicates}</b> duplicate leads were automatically skipped.</p>` : ''}
      ${bulkInvalid.length ? `<p style="color:var(--bad)"><b>${bulkInvalid.length}</b> leads have errors (typos or missing data). Please fix them below or they will be skipped.</p>` : ''}
    </div>

    ${bulkValid.length ? `<div class="card">
      <h2>Assign to Sales Officer</h2>
      ${assignHtml}
    </div>` : ''}

    ${bulkInvalid.length ? `<div id="invalidList">
      ${bulkInvalid.map((l, i) => `
        <div class="card" data-idx="${i}" style="border-left: 3px solid var(--bad)">
          <div style="font-size:14px; font-weight:600; margin-bottom:4px;">${esc(l.customer_name || '(No name)')} <span style="font-weight:400; color:var(--muted); font-size:13px">· ${esc(l.mobile || '(No mobile)')}</span></div>
          ${l.err_missing ? `<div class="msg err" style="margin-top:0; margin-bottom:12px; padding:6px 10px; font-size:12px;">Missing required fields (Name, Mobile, Branch, or Source)</div>` : ''}
          <div class="kpi-row" style="grid-template-columns: 1fr 1fr; margin-bottom:0; text-align:left;">
            <div><label style="margin-top:0">Branch ${l.err_branch ? '<span class="req" style="font-size:11px"><br>(Typo: '+esc(l.branch)+')</span>' : ''}</label>
                 <select class="fix-br" ${l.err_branch ? 'style="border-color:var(--bad)"' : ''}>${options(masters.branches, l.branch_id)}</select></div>
            <div><label style="margin-top:0">Source ${l.err_source ? '<span class="req" style="font-size:11px"><br>(Typo: '+esc(l.source)+')</span>' : ''}</label>
                 <select class="fix-so" ${l.err_source ? 'style="border-color:var(--bad)"' : ''}>${options(masters.sources, l.source_id)}</select></div>
            <div><label>Model ${l.err_model ? '<span class="req" style="font-size:11px"><br>(Typo: '+esc(l.model)+')</span>' : ''}</label>
                 <select class="fix-mo" ${l.err_model ? 'style="border-color:var(--bad)"' : ''}>${options(masters.models, l.model_id)}</select></div>
            <div><label>Activity ${l.err_activity ? '<span class="req" style="font-size:11px"><br>(Typo: '+esc(l.activity)+')</span>' : ''}</label>
                 <select class="fix-ac" ${l.err_activity ? 'style="border-color:var(--bad)"' : ''}>${options(masters.activities, l.activity_id)}</select></div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="card">
      <button class="btn" id="confirmBulk">Confirm & Assign</button>
      <div id="msg"></div>
    </div>
  </div></div>`);

  document.body.appendChild(sheet);
  const close = () => { sheet.remove(); bulkValid = []; bulkInvalid = []; };
  sheet.querySelector('#x').onclick = close;

  sheet.querySelector('#confirmBulk').onclick = async (e) => {
    // Collect checked officers per branch; require at least one per branch
    const assignMap = {}; // branchId -> [officerId, ...]
    for (const branchId of Object.keys(branchMap)) {
      const checked = [...sheet.querySelectorAll(`.assign-cb[data-branch="${branchId}"]`)].filter(cb => cb.checked).map(cb => Number(cb.value));
      if (!checked.length) {
        const msgEl = sheet.querySelector('#msg');
        if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = `Select at least one officer for ${branchMap[branchId].name}.`; }
        return;
      }
      assignMap[branchId] = checked;
    }

    // Round-robin counter per branch
    const rrIdx = {};
    const pickOfficer = (branchId) => {
      const officers = assignMap[branchId] || [];
      if (!officers.length) return null;
      if (!rrIdx[branchId]) rrIdx[branchId] = 0;
      return officers[rrIdx[branchId]++ % officers.length];
    };

    const fixed = [];
    sheet.querySelectorAll('#invalidList .card').forEach(card => {
      const idx = card.dataset.idx;
      const original = bulkInvalid[idx];
      const br = card.querySelector('.fix-br').value;
      const so = card.querySelector('.fix-so').value;
      const mo = card.querySelector('.fix-mo').value;
      const ac = card.querySelector('.fix-ac').value;
      if (br && so && original.customer_name && original.mobile && original.mobile.length === 10) {
        fixed.push({
          ...original,
          branch_id: Number(br),
          source_id: Number(so),
          model_id: mo ? Number(mo) : null,
          activity_id: ac ? Number(ac) : null,
          assigned_to: pickOfficer(br),
        });
      }
    });

    const totalToAssign = [
      ...bulkValid.map(l => ({ ...l, assigned_to: pickOfficer(String(l.branch_id)) })),
      ...fixed,
    ];
    if (!totalToAssign.length) {
      const msgEl = sheet.querySelector('#msg');
      if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = 'No valid leads to assign.'; }
      return;
    }

    e.target.disabled = true;
    e.target.textContent = 'Assigning...';
    try {
      const res = await api('/leads/bulk-assign', 'POST', totalToAssign);
      close();
      say(`Successfully imported & assigned ${res.added} leads!`, 'ok');
      leadsView();
    } catch (err) {
      const m = sheet.querySelector('#msg');
      if (m) { m.className = 'msg err'; m.textContent = err.message; }
      else toast(err.message, 'err');
      e.target.disabled = false;
      e.target.textContent = 'Confirm & Assign';
    }
  };
}

/* ---------------------------------------------------------- lead detail sheet */

async function openLead(id) {
  const l = await api('/leads/' + id);
  const canAct = (me.role === 'sales' || me.role === 'admin') && l.status === 'open';
  const nextSeq = l.fcount + 1;

  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="x">Close</button></div>
    <div class="card">
      <h2>${esc(l.customer_name)}</h2>
      <div class="kv"><b>Mobile</b><span><a href="tel:${esc(l.mobile)}">${esc(l.mobile)}</a></span></div>
      <div class="kv"><b>Source</b><span>${esc(l.source || '—')}</span></div>
      <div class="kv"><b>Branch</b><span>${esc(l.branch || '—')}</span></div>
      <div class="kv"><b>Location</b><span>${esc(l.location || '—')}</span></div>
      <div class="kv"><b>Remarks</b><span>${esc(l.remarks || '—')}</span></div>
      <div class="kv"><b>Model</b><span>${esc(l.model || '—')}</span></div>
      <div class="kv"><b>Activity</b><span>${esc(l.activity || '—')}</span></div>
      <div class="kv"><b>Officer</b><span>${esc(l.officer || 'Unassigned')}</span></div>
    </div>

    ${l.salesforce_history && l.salesforce_history.length ? `
      <div class="card" style="background:#fff3e0; border-color:#ffb74d">
        <h2 style="color:#e65100; margin-bottom:8px">⚠️ Sales consultant info</h2>
        <div class="tl">${l.salesforce_history.map(sh => `
          <div style="margin-bottom:8px">
            <div><b>Consultant:</b> ${esc(sh.so_name)}</div>
            ${sh.so_mobile ? `<div><b>Phone no:</b> <a href="tel:${esc(sh.so_mobile)}">${esc(sh.so_mobile)}</a></div>` : ''}
          </div>
        `).join('')}</div>
      </div>
    ` : ''}

    ${l.followups.length ? `<div class="card"><h2>History</h2><div class="tl">${l.followups.map(f => `
      <div><b>F${f.seq} · ${esc(f.call_status)} → ${esc(f.outcome)}</b>
        <em>${esc(f.created_at)} · ${esc(f.by_name)}${f.next_date ? ' · next ' + f.next_date : ''}
        ${f.model ? ' · ' + esc(f.model) : ''}${f.activity ? ' · ' + esc(f.activity) : ''}</em>
        ${f.other_so_called ? `<div><b>Other SO called:</b> ${esc(f.other_so_called)}</div>` : ''}
        ${f.test_drive_date ? `<div><b>Test Drive Date:</b> ${esc(f.test_drive_date)}</div>` : ''}
        ${f.exchange_expected_price ? `<div><b>Exchange — Expected: ₹${esc(String(f.exchange_expected_price))} / Offered: ₹${esc(String(f.exchange_offered_price || '—'))}</b></div>` : ''}
        ${f.remarks ? `<div>${esc(f.remarks)}</div>` : ''}</div>`).join('')}</div></div>` : ''}

    ${l.is_flagged && me.role === 'manager' ? `<div class="card" style="border-color:#f57c00">
      <h2 style="color:#f57c00">⚑ Flagged by Sales Officer</h2>
      ${l.flag_remarks ? `<div style="margin-bottom:12px"><b>Previous remarks:</b> ${esc(l.flag_remarks)}</div>` : ''}
      <label>Close Flag with Remarks</label>
      <textarea id="flagRemarks" placeholder="Enter remarks…"></textarea>
      <button class="btn" id="closeFlagBtn" style="background:#f57c00">Close Flag</button>
      <div id="flagMsg"></div>
    </div>` : ''}

    ${canAct ? `<div class="card">
      <h2>Log follow-up F${nextSeq}</h2>
      <label>Call status <span class="req">*</span></label>
      <div class="chips" id="cs">
        <button data-v="Connected">Connected</button>
        <button data-v="Not Connected">Not Connected</button>
      </div>
      <div id="outWrap" class="hide">
        <label>Outcome <span class="req">*</span></label>
        <div class="chips" id="out"></div>
      </div>
      <div id="orderWrap" class="hide">
        <label>Order ID <span class="req">*</span></label>
        <input id="orderId" placeholder="Enter order ID">
      </div>
      <div id="tallyWrap" class="hide">
        <label>Tally Receipt No. <span class="req">*</span></label>
        <input id="tallyNo" placeholder="Enter tally receipt number">
      </div>
      <div id="testDriveWrap" class="hide">
        <label>Test Drive Date <span class="req">*</span></label>
        <input id="testDriveDate" type="date" min="${me.today}" max="${me.maxDate}">
      </div>
      <div id="exchangeWrap" class="hide">
        <label>Expected Price (₹) <span class="req">*</span></label>
        <input id="exExpected" type="number" placeholder="Customer's expected price" min="0">
        <label>Offered Price (₹) <span class="req">*</span></label>
        <input id="exOffered" type="number" placeholder="Price offered to customer" min="0">
      </div>
      <div id="dateWrap" class="hide">
        <label>Next follow-up date <span class="req">*</span></label>
        <input id="nd" type="date" min="${me.today}" max="${me.maxDate}" value="${me.today}">
      </div>
      <div id="oscWrap" class="hide">
        <label>Did any other SO call the customer?</label>
        <select id="osc">
          <option value="">Select…</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>
      <label>Remarks</label><textarea id="rm"></textarea>
      <button class="btn" id="submit">Save follow-up</button>
      <div id="msg"></div>
    </div>` : ''}
  </div></div>`);

  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  sheet.querySelector('#x').onclick = close;

  const closeFlagBtn = sheet.querySelector('#closeFlagBtn');
  if (closeFlagBtn) {
    closeFlagBtn.onclick = async () => {
      const remarks = sheet.querySelector('#flagRemarks').value.trim();
      closeFlagBtn.disabled = true;
      try {
        await api(`/leads/${l.id}/close-flag`, 'POST', { remarks });
        document.querySelectorAll('.sheet').forEach(s => s.remove());
        managerView();
      } catch (err) {
        const m = sheet.querySelector('#flagMsg');
        if (m) { m.className = 'msg err'; m.textContent = err.message; }
        closeFlagBtn.disabled = false;
      }
    };
  }

  if (!canAct) return;

  const NO_DATE   = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer']);
  const OUT_COLOR = { 'Lost to Competition': 'red', 'Finance Rejected': 'red', 'Dropped': 'red', 'Lost to co-dealer': 'red', 'Not Interested': 'red', 'Already Booked': 'red', 'Booking Done': 'green', 'Retail Done': 'green', 'Need time': 'blue', 'Need SO Call': 'blue', 'Need More Details': 'blue', 'Discount Issue': 'blue', 'Exchange Issue': 'blue' };
  let call = '', outcome = '';

  const pick = (wrap, onPick) => {
    wrap.querySelectorAll('button').forEach(b =>
      b.onclick = () => {
        wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        onPick(b.dataset.v);
      });
  };


  pick(sheet.querySelector('#cs'), (v) => {
    call = v; outcome = '';
    const out = sheet.querySelector('#out');
    out.innerHTML = me.outcomes[v].map(o => {
      const c = OUT_COLOR[o] || '';
      return `<button data-v="${esc(o)}"${c ? ` data-color="${c}"` : ''}>${esc(o)}</button>`;
    }).join('');
    sheet.querySelector('#outWrap').classList.remove('hide');
    sheet.querySelector('#oscWrap').classList.toggle('hide', v !== 'Connected');
    sheet.querySelector('#dateWrap').classList.add('hide');
    sheet.querySelector('#orderWrap').classList.add('hide');
    sheet.querySelector('#tallyWrap').classList.add('hide');
    sheet.querySelector('#testDriveWrap').classList.add('hide');
    sheet.querySelector('#exchangeWrap').classList.add('hide');
    pick(out, (o) => {
      outcome = o;
      const skipDate = NO_DATE.has(o);
      sheet.querySelector('#dateWrap').classList.toggle('hide', skipDate);
      sheet.querySelector('#orderWrap').classList.toggle('hide', o !== 'Booking Done');
      sheet.querySelector('#tallyWrap').classList.toggle('hide', o !== 'Retail Done');
      sheet.querySelector('#testDriveWrap').classList.toggle('hide', o !== 'Need Test Drive');
      sheet.querySelector('#exchangeWrap').classList.toggle('hide', o !== 'Exchange Issue');
    });
  });

  sheet.querySelector('#submit').onclick = async (e) => {
    if (!call)    return say('Select Connected or Not Connected');
    if (!outcome) return say('Select an outcome');
    const skipDate = NO_DATE.has(outcome);
    const nd = sheet.querySelector('#nd').value;
    if (!skipDate && !nd) return say('Next follow-up date is required');
    if (outcome === 'Booking Done'   && !sheet.querySelector('#orderId').value.trim())     return say('Order ID is required');
    if (outcome === 'Retail Done'    && !sheet.querySelector('#tallyNo').value.trim())     return say('Tally Receipt No. is required');
    if (outcome === 'Need Test Drive'&& !sheet.querySelector('#testDriveDate').value)      return say('Test drive date is required');
    if (outcome === 'Exchange Issue' && !sheet.querySelector('#exExpected').value.trim())  return say('Expected price is required');
    if (outcome === 'Exchange Issue' && !sheet.querySelector('#exOffered').value.trim())   return say('Offered price is required');

    let oscValue = '';
    if (call === 'Connected') {
      oscValue = sheet.querySelector('#osc').value;
    }

    e.target.disabled = true;
    try {
      await api(`/leads/${l.id}/followup`, 'POST', {
        call_status: call, outcome,
        next_date:     skipDate ? null : nd,
        order_id:      outcome === 'Booking Done'    ? sheet.querySelector('#orderId').value.trim()     : undefined,
        tally_receipt: outcome === 'Retail Done'     ? sheet.querySelector('#tallyNo').value.trim()     : undefined,
        test_drive_date:          outcome === 'Need Test Drive' ? sheet.querySelector('#testDriveDate').value           : undefined,
        exchange_expected_price:  outcome === 'Exchange Issue'  ? sheet.querySelector('#exExpected').value.trim()      : undefined,
        exchange_offered_price:   outcome === 'Exchange Issue'  ? sheet.querySelector('#exOffered').value.trim()       : undefined,
        remarks:       sheet.querySelector('#rm').value.trim(),
        other_so_called: oscValue,
      });
      close();
      leadsView();
    } catch (err) { say(err.message); e.target.disabled = false; }
  };
}

/* -------------------------------------------------------- admin: analytics */

async function analyticsView(branchId = null, branchName = null) {
  const stats = await api(branchId ? `/analytics?branch_id=${branchId}` : '/analytics');
  
  view.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
        <h2 style="margin:0">${branchId ? `Sales Officers: ${esc(branchName)}` : 'Branch Analytics'}</h2>
        ${branchId ? `<button class="btn ghost" style="margin:0; padding:4px 8px" onclick="analyticsView()">← Back</button>` : ''}
      </div>
      ${stats.length ? `<div class="charts">${stats.map(s => `
        <div class="ch-row" ${!branchId ? `style="cursor:pointer" onclick="analyticsView(${s.id}, '${esc(s.name)}')" title="Click for details"` : ''}>
          <div class="ch-lbl"><b>${esc(s.name)}</b><span>${s.total} leads</span></div>
          <div class="ch-bar-wrap">
            <div class="ch-bar won" style="width:${s.total ? (s.won / s.total * 100) : 0}%"></div>
            <div class="ch-bar open" style="width:${s.total ? (s.open / s.total * 100) : 0}%"></div>
          </div>
          <div class="ch-stats">
            <span class="c-won">${s.won} won</span>
            <span class="c-open">${s.open} open</span>
          </div>
        </div>`).join('')}</div>` : '<div class="empty">No data</div>'}
    </div>
  `;
}

boot();
