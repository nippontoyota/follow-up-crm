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

function say(msg, kind = 'err') {
  // The open sheet owns the message slot while it is up, otherwise the page does.
  const scope = document.querySelector('.sheet') || document;
  const box = scope.querySelector('#msg') || document.getElementById('msg');
  if (!box) return alert(msg);
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
  view.innerHTML = `
    <form id="lf" style="margin-top:40px">
      <div class="card">
        <h2>Follow-up CRM</h2>
        <label>Username</label>
        <input id="u" autocapitalize="none" autocomplete="username">
        <label>Password</label>
        <input id="p" type="password" autocomplete="current-password">
        <button class="btn" type="submit">Sign in</button>
        <div id="msg"></div>
      </div>
    </form>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/login', 'POST', { username: val('u'), password: document.getElementById('p').value }); boot(); }
    catch (err) { say(err.message); }
  };
}

/* -------------------------------------------------------------------- shell */

const TABS = {
  admin: [['users', 'Users', '👤'], ['lists', 'Lists', '🗂'], ['leads', 'All leads', '📋']],
  marketing: [['new', 'Add lead', '➕'], ['leads', 'My leads', '📋']],
  sales: [['fresh', 'Fresh', '🆕'], ['today', "Today's follow-up", '📅'], ['leads', 'All', '📋']],
};

async function boot() {
  try { me = await api('/me'); } catch { return loginView(); }
  masters = await api('/masters');

  hdr.classList.remove('hide');
  nav.classList.remove('hide');
  document.getElementById('hdrUser').textContent =
    `${me.name} · ${{ admin: 'Admin', marketing: 'Marketing', sales: 'Sales Officer' }[me.role]}`;

  nav.innerHTML = TABS[me.role]
    .map(([k, label, icon]) => `<button data-t="${k}"><b>${icon}</b>${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.t));

  go(TABS[me.role][0][0]);
}

function go(t) {
  tab = t;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.getElementById('hdrTitle').textContent =
    TABS[me.role].find(x => x[0] === t)[1];
  ({ users: usersView, lists: listsView, new: newLeadView, fresh: leadsView, today: leadsView, leads: leadsView })[t]();
}

document.getElementById('logout').onclick = async () => {
  await api('/logout', 'POST');
  me = null;
  loginView();
};

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
      </select>
      <div id="branchWrap" class="hide">
        <label>Branch <span class="req">*</span> <em>(leads from this branch route here)</em></label>
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
    document.getElementById('branchWrap').classList.toggle('hide', e.target.value !== 'sales');

  document.getElementById('save').onclick = async () => {
    try {
      await api('/users', 'POST', {
        name: val('n'), username: val('un'), password: document.getElementById('pw').value,
        role: val('role'), branch_id: val('br') || null,
      });
      usersView();
    } catch (e) { say(e.message); }
  };

  view.querySelectorAll('.row button').forEach(b => b.onclick = async () => {
    try { await api(`/users/${b.dataset.id}/toggle`, 'POST'); usersView(); }
    catch (e) { say(e.message); }
  });
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
      say(r.warning || 'Lead saved and assigned to the branch sales officer.', r.warning ? 'err' : 'ok');
    } catch (err) { say(err.message); e.target.disabled = false; }
  };
}

/* ------------------------------------------------------------------- leads */

async function leadsView() {
  const t = tab === 'leads' ? 'all' : tab;
  view.innerHTML = '<div class="empty">Loading…</div>';
  const leads = await api('/leads?tab=' + t);

  if (!leads.length) {
    const blank = { fresh: 'No fresh leads right now.', today: 'Nothing due today. Nice work.', all: 'No leads yet.' };
    view.innerHTML = `<div class="empty">${blank[t]}</div>`;
    return;
  }

  view.innerHTML = leads.map(l => `
    <button class="card lead" data-id="${l.id}">
      <div class="top"><b>${esc(l.customer_name)}</b>${dueLabel(l)}</div>
      <div class="meta">${esc(l.mobile)} · ${esc(l.branch || '—')}${l.location ? ' · ' + esc(l.location) : ''}</div>
      <div class="meta">${esc(l.source || 'No source')} · ${l.fcount ? 'F' + l.fcount + ' done — ' + esc(l.stage) : 'Not contacted'}${me.role !== 'sales' && l.officer ? ' · ' + esc(l.officer) : ''}</div>
    </button>`).join('');

  view.querySelectorAll('.lead').forEach(b => b.onclick = () => openLead(b.dataset.id));
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
      <div class="kv"><b>Added by</b><span>${esc(l.created_by_name)} · ${esc(l.created_at)}</span></div>
      <div class="kv"><b>Status</b><span>${l.status === 'closed' ? 'Closed — ' + esc(l.stage) : dueLabel(l)}</span></div>
    </div>

    ${l.followups.length ? `<div class="card"><h2>History</h2><div class="tl">${l.followups.map(f => `
      <div><b>F${f.seq} · ${esc(f.call_status)} → ${esc(f.outcome)}</b>
        <em>${esc(f.created_at)} · ${esc(f.by_name)}${f.next_date ? ' · next ' + f.next_date : ''}
        ${f.model ? ' · ' + esc(f.model) : ''}${f.activity ? ' · ' + esc(f.activity) : ''}</em>
        ${f.remarks ? `<div>${esc(f.remarks)}</div>` : ''}</div>`).join('')}</div></div>` : ''}

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
      <div id="dateWrap">
        <label>Next follow-up date <span class="req">*</span>
          <em>(today to ${me.maxDate})</em></label>
        <input id="nd" type="date" min="${me.today}" max="${me.maxDate}" value="${me.today}">
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
  if (!canAct) return;

  const CLOSING = ['Booking Done', 'Retail Done', 'Not Interested'];
  let call = '', outcome = '';

  const pick = (wrap, value, onPick) => {
    wrap.querySelectorAll('button').forEach(b =>
      b.onclick = () => {
        wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        onPick(b.dataset.v);
      });
  };

  pick(sheet.querySelector('#cs'), null, (v) => {
    call = v; outcome = '';
    const out = sheet.querySelector('#out');
    out.innerHTML = me.outcomes[v].map(o => `<button data-v="${o}">${o}</button>`).join('');
    sheet.querySelector('#outWrap').classList.remove('hide');
    sheet.querySelector('#extra').classList.add('hide');
    sheet.querySelector('#dateWrap').classList.remove('hide');
    pick(out, null, (o) => {
      outcome = o;
      sheet.querySelector('#dateWrap').classList.toggle('hide', CLOSING.includes(o));
    });
  });

  sheet.querySelector('#submit').onclick = async (e) => {
    if (!call) return say('Select Connected or Not Connected');
    if (!outcome) return say('Select an outcome');
    const closing = CLOSING.includes(outcome);
    const nd = sheet.querySelector('#nd').value;
    if (!closing && !nd) return say('Next follow-up date is required');

    e.target.disabled = true;
    try {
      await api(`/leads/${l.id}/followup`, 'POST', {
        call_status: call, outcome, next_date: closing ? null : nd,
        remarks: sheet.querySelector('#rm').value.trim(),
      });
      close();
      leadsView();
    } catch (err) { say(err.message); e.target.disabled = false; }
  };
}

boot();
