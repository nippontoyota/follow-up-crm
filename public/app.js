/* Follow-up CRM — single-file front end. Mobile first, no build step. */

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const hdr = document.getElementById('hdr');

let me = null;        // current user + server config (today, maxDate, outcomes)
let masters = {};     // branches / sources / activities / models
let tab = '';
let leadsPage = 1;
let leadsQ = '';
const LEADS_PER_PAGE = 25;
let usersPage = 1;
const USERS_PER_PAGE = 25;
const LISTS_PER_PAGE = 25;
const PAGINATED_LISTS = new Set(['branches', 'sources']);
let listsPage = { branches: 1, sources: 1 };
let listsTab = 'branches';
let leadsGen = 0;
let leadsCtrl = null;
let leadsStatsCache = null;
let searchTimer = null;
const inflightGets = new Map();

function invalidateLeadsStats() { leadsStatsCache = null; }

/* ------------------------------------------------------------------- utils */

const el = (html) => Object.assign(document.createElement('div'), { innerHTML: html }).firstElementChild;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = (id) => document.getElementById(id).value.trim();
const roleLabel = { admin: 'Admin', marketing: 'Marketing', sales: 'Sales Officer', call_guy: 'Call Executive', manager: 'Sales Manager', call_center_manager: 'Call Center Manager', sales_manager: 'Sales Manager' };

async function copyContactPhone(phone, button) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(phone);
    else {
      const input = document.createElement('textarea');
      input.value = phone;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = old; }, 1400);
  } catch { say('Could not copy the phone number', 'err'); }
}

async function api(path, method = 'GET', body, { signal } = {}) {
  const key = `${method}:${path}:${body ? JSON.stringify(body) : ''}`;
  if (method === 'GET' && !signal && inflightGets.has(key)) return inflightGets.get(key);

  const run = async () => {
    const r = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };

  const p = run().finally(() => { if (method === 'GET' && !signal) inflightGets.delete(key); });
  if (method === 'GET' && !signal) inflightGets.set(key, p);
  return p;
}

const formatDate = (s) => {
  const d = new Date(s);
  return isNaN(d) ? '' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()%12||12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
};

async function fetchAiLostSummary(branchId) {
  const box = document.getElementById('aiSummaryBox');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div class="ai-loading">Generating AI Summary...</div>';
  try {
    const url = branchId ? `/api/manager/ai-lost-summary?branch_id=${branchId}` : '/api/manager/ai-lost-summary';
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch AI summary');
    const data = await res.json();
    const raw = data.summary.replace(/\*+/g, '').replace(/^#+\s*/gm, '').trim();
    // Split on ~ bullet markers or fallback to line breaks
    const lines = raw.split(/(?:^|\n)\s*~\s*/).filter(l => l.trim());
    if (lines.length > 1 || raw.includes('~')) {
      // Bullet-point mode: render as styled list
      const items = lines.map(l => {
        // Bold numbers and percentages
        const formatted = esc(l.trim()).replace(/(\d+[\d,.]*\s*%?)/g, '<b style="color:var(--text);font-size:15px">$1</b>');
        return `<li style="margin-bottom:8px;line-height:1.6;color:var(--text-light)">${formatted}</li>`;
      }).join('');
      box.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${items}</ul>`;
    } else {
      // Fallback: paragraph mode with bold numbers
      const formatted = esc(raw).replace(/(\d+[\d,.]*\s*%?)/g, '<b style="color:var(--text);font-size:15px">$1</b>');
      box.innerHTML = `<p style="margin:0;line-height:1.7;color:var(--text-light)">${formatted}</p>`;
    }
  } catch (err) {
    box.innerHTML = '<span style="color:var(--bad)">Error: ' + esc(err.message) + '</span>';
  }
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

function showBulkValidationProgress() {
  const sheet = el(`<div class="sheet" role="status" aria-live="polite"><div>
    <div class="card" style="max-width:520px;margin:18vh auto;text-align:center;padding:32px 28px">
      <div style="font-size:30px;margin-bottom:12px">⏳</div>
      <h2 style="margin:0 0 8px">Checking employee directory…</h2>
      <p style="margin:0;color:var(--muted)">Matching Sales Officers and preparing the upload.</p>
      <div style="height:6px;background:var(--line);border-radius:99px;overflow:hidden;margin:22px 0 10px"><div style="height:100%;width:35%;background:var(--brand);border-radius:99px;animation:bulkProgress 1.2s ease-in-out infinite"></div></div>
      <div class="bulk-validation-elapsed" style="font-size:12px;color:var(--muted)">Usually takes a few seconds</div>
    </div>
  </div></div>`);
  document.body.appendChild(sheet);
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += 1;
    const label = sheet.querySelector('.bulk-validation-elapsed');
    if (label) label.textContent = `Still working… ${elapsed}s`;
  }, 1000);
  return () => { clearInterval(timer); sheet.remove(); };
}

const options = (list, sel, addNewLabel) => '<option value="">Select…</option>' +
  list.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.name)}</option>`).join('') +
  (addNewLabel ? `<option value="__add__">${esc(addNewLabel)}</option>` : '');

function displayDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function displayDateTime(value) {
  const raw = String(value || '').trim();
  const date = displayDate(raw);
  const time = raw.match(/[ T](\d{2}:\d{2})(?::\d{2})?/);
  return time ? `${date} ${time[1]}` : date;
}

function dueLabel(lead) {
  if (lead.status === 'closed') return `<span class="pill">${esc(lead.stage)}</span>`;
  if (!lead.fcount) return '<span class="pill new">Fresh</span>';
  if (lead.next_date < me.today) return `<span class="pill late">Overdue · ${displayDate(lead.next_date)}</span>`;
  if (lead.next_date === me.today) return '<span class="pill due">Due today</span>';
  return `<span class="pill">${displayDate(lead.next_date)}</span>`;
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
  admin:   [['analytics', 'Branch Analytics', '📊'], ['callCenter', 'Call Center', '☎️'], ['salesPerf', 'Sales Officers', '👥'], ['leadAnalysis', 'Lead Analysis', '📈'], ['flagged', 'Flagged Leads', '🚩'], ['users', 'Users', '👤'], ['reassign', 'Reassign', '🔀'], ['lists', 'Lists', '🗂'], ['leads', 'All leads', '📋']],
  marketing: [['new', 'Add lead', '➕'], ['leads', 'My leads', '📋']],
  sales:   [['fresh', 'Fresh Leads', '🆕'], ['today', 'Today', '📅'], ['leads', 'All', '📋']],
  call_guy: [['fresh', 'Fresh Leads', '🆕'], ['today', 'Today', '📅'], ['leads', 'All', '📋']],
  manager: [['dashboard', 'Dashboard', '📊']],
  call_center_manager: [['callCenter', 'Call Center', '☎️']],
  sales_manager: [['salesPerf', 'Sales Officers', '👥'], ['leadAnalysis', 'Lead Analysis', '📈'], ['flagged', 'Flagged Leads', '🚩']],
};

async function boot() {
  try { me = await api('/me'); } catch { return loginView(); }
  masters = await api('/masters');

  hdr.classList.remove('hide');
  nav.classList.remove('hide');
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

  const requestedTab = location.hash.slice(1).split('?')[0];
  const allowedTabs = TABS[me.role].map(([key]) => key);
  go(allowedTabs.includes(requestedTab) ? requestedTab : TABS[me.role][0][0]);
}

function go(t) {
  tab = t;
  if (['fresh', 'today', 'leads'].includes(t)) { leadsPage = 1; leadsQ = ''; invalidateLeadsStats(); }
  if (t === 'users') usersPage = 1;
  if (t === 'lists') { listsPage = { branches: 1, sources: 1 }; listsTab = 'branches'; }
  if (location.hash.slice(1).split('?')[0] !== t) location.hash = t;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.getElementById('hdrTitle').textContent =
    TABS[me.role].find(x => x[0] === t)[1];
  ({ analytics: analyticsView, callCenter: callCenterView, salesPerf: salesPerformanceView, leadAnalysis: leadAnalysisView, flagged: flaggedLeadsView, users: usersView, reassign: reassignView, lists: listsView, new: newLeadView, fresh: leadsView, today: leadsView, leads: leadsView, dashboard: managerView })[t]();
}

/* ------------------------------------------------------------- admin: users */

async function usersView() {
  const data = await api(`/users?page=${usersPage}&limit=${USERS_PER_PAGE}`);
  const { items: users, total, page, pages } = parsePage(data, 'users', usersPage, USERS_PER_PAGE);
  const pg = renderPager(page, pages, total);

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
        <option value="call_guy">Call Executive</option>
        <option value="call_center_manager">Call Center Manager</option>
        <option value="sales_manager">Branch Sales Manager</option>
      </select>
      <div id="branchWrap" class="hide">
        <label>Branch <span class="req">*</span></label>
        <select id="br">${options(masters.branches)}</select>
      </div>
      <button class="btn" id="save">Create user</button>
      <div id="msg"></div>
    </div>
    <div class="card">
      <h2>Users (${total})</h2>
      ${pg}
      <div class="rows">${users.length ? users.map(u => `
        <div class="row">
          <span><b>${esc(u.name)}</b><br><em>@${esc(u.username)} · ${esc(roleLabel[u.role] || u.role)}${u.branch ? ' · ' + esc(u.branch) : ''}${u.active ? '' : ' · disabled'}</em></span>
          <button data-id="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
        </div>`).join('') : '<div class="empty">No users on this page.</div>'}</div>
    </div>`;

  bindPager(p => { usersPage = p; usersView(); });

  document.getElementById('role').onchange = (e) =>
    document.getElementById('branchWrap').classList.toggle('hide', !['sales','manager','sales_manager'].includes(e.target.value));

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
}

async function reassignView() {
  const { items: officers } = await api('/admin/call-guy-load');

  if (!officers.length) {
    view.innerHTML = `<div class="card"><p class="empty" style="padding:24px 16px">No active call executives to reassign between.</p></div>`;
    return;
  }

  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
  const maxCount = Math.max(1, ...officers.map(o => o.open_count));
  const byId = Object.fromEntries(officers.map(o => [String(o.id), o]));

  const rowHtml = u => `
    <button type="button" class="reload-row" data-id="${u.id}">
      <span class="reload-row-badge">${esc(initials(u.name))}</span>
      <span class="reload-row-main">
        <span class="reload-row-top">
          <span class="reload-row-name">${esc(u.name)}</span>
          <span class="reload-row-count">${u.open_count} open<span class="reload-row-sub">${u.untouched_count} untouched</span></span>
        </span>
        <span class="reload-row-bar"><span class="reload-row-fill" style="transform:scaleX(${(u.open_count / maxCount).toFixed(3)})"></span></span>
      </span>
      <span class="reload-row-state">
        <span class="reload-row-source-tag">Source</span>
        <span class="reload-row-dot"></span>
      </span>
    </button>`;

  view.innerHTML = `
    <div class="card reload-card">
      <div class="reload-head">
        <h2>Reassign Leads</h2>
        <p class="reload-desc">Tap a call executive to mark them the source, then tap others to receive their open leads. The split previews before it moves anything.</p>
      </div>
      <div class="reload-roster" id="rlRoster">${officers.map(rowHtml).join('')}</div>
      <div class="reload-scope">
        <div class="reload-scope-toggle" id="rlScope">
          <button type="button" class="reload-scope-opt on" data-mode="untouched">Untouched only</button>
          <button type="button" class="reload-scope-opt" data-mode="open">All open</button>
        </div>
        <p class="reload-scope-hint" id="rlScopeHint">Leads with zero follow-ups yet.</p>
      </div>
      <div class="reload-preview" id="rlPreview">
        <p class="reload-preview-empty">Select a call executive above to begin.</p>
      </div>
      <div class="reload-actions">
        <button class="btn" id="rlBtn" disabled>Reassign leads</button>
      </div>
      <div id="rlMsg"></div>
    </div>`;

  const state = { source: null, targets: new Set(), mode: 'untouched' };
  const roster  = document.getElementById('rlRoster');
  const preview = document.getElementById('rlPreview');
  const btn     = document.getElementById('rlBtn');
  const msgEl   = document.getElementById('rlMsg');

  const countFor = u => state.mode === 'untouched' ? u.untouched_count : u.open_count;

  function render() {
    roster.querySelectorAll('.reload-row').forEach(row => {
      const id = row.dataset.id;
      row.classList.toggle('is-source', id === state.source);
      row.classList.toggle('is-target', state.targets.has(id));
    });

    if (!state.source) {
      preview.innerHTML = '<p class="reload-preview-empty">Select a call guy above to begin.</p>';
      btn.disabled = true;
      return;
    }

    const src = byId[state.source];
    const total = countFor(src);
    const n = state.targets.size;

    if (!total) {
      preview.innerHTML = `<p class="reload-preview-empty">${esc(src.name)} has no matching leads right now.</p>`;
      btn.disabled = true;
      return;
    }
    if (!n) {
      preview.innerHTML = `<p class="reload-preview-empty"><b>${esc(src.name)}</b> has <b>${total}</b> lead${total !== 1 ? 's' : ''} to move. Tap who should receive them.</p>`;
      btn.disabled = true;
      return;
    }

    const base = Math.floor(total / n), extra = total % n;
    const split = extra ? `${base + 1} lead${base + 1 !== 1 ? 's' : ''} to ${extra}, ${base} to the rest` : `${base} each`;
    preview.innerHTML = `<p class="reload-preview-line"><b>${total}</b> lead${total !== 1 ? 's' : ''} from <b>${esc(src.name)}</b> split across <b>${n}</b> call gu${n !== 1 ? 'ys' : 'y'} — ${split}.</p>`;
    btn.disabled = false;
  }

  roster.addEventListener('click', (e) => {
    const row = e.target.closest('.reload-row');
    if (!row) return;
    const id = row.dataset.id;
    if (state.source === id) { state.source = null; state.targets.clear(); }
    else if (state.source === null) { state.source = id; }
    else if (state.targets.has(id)) { state.targets.delete(id); }
    else { state.targets.add(id); }
    render();
  });

  document.getElementById('rlScope').addEventListener('click', (e) => {
    const opt = e.target.closest('.reload-scope-opt');
    if (!opt) return;
    state.mode = opt.dataset.mode;
    document.querySelectorAll('.reload-scope-opt').forEach(o => o.classList.toggle('on', o === opt));
    document.getElementById('rlScopeHint').textContent = state.mode === 'untouched'
      ? 'Leads with zero follow-ups yet.'
      : 'Every open lead currently assigned to the source.';
    render();
  });

  btn.onclick = async () => {
    const toIds = [...state.targets].map(Number);
    btn.disabled = true;
    msgEl.textContent = '';
    try {
      const r = await api('/admin/reassign-leads', 'POST', { from_id: Number(state.source), to_ids: toIds, mode: state.mode });
      const fresh = await api('/admin/call-guy-load');
      fresh.items.forEach(u => { if (byId[u.id]) Object.assign(byId[u.id], u); });
      roster.querySelectorAll('.reload-row').forEach(row => {
        const u = byId[row.dataset.id];
        row.querySelector('.reload-row-count').innerHTML = `${u.open_count} open<span class="reload-row-sub">${u.untouched_count} untouched</span>`;
        row.querySelector('.reload-row-fill').style.transform = `scaleX(${(u.open_count / maxCount).toFixed(3)})`;
      });
      state.source = null; state.targets.clear();
      msgEl.className = 'msg ok';
      msgEl.textContent = `Done — ${r.moved} lead${r.moved !== 1 ? 's' : ''} reassigned.`;
      render();
    } catch (e) { msgEl.className = 'msg err'; msgEl.textContent = e.message; }
    btn.disabled = false;
  };

  render();
}

/* ------------------------------------------------------------- admin: lists */

const LIST_LABELS = { branches: 'Branches', sources: 'Sources', activities: 'Activities', models: 'Model names', salesOfficerContacts: 'Sales Officer Contacts' };
const LIST_PLACEHOLDER = { branches: 'branch', sources: 'source', activities: 'activity', models: 'model name' };

async function salesOfficerContactsView() {
  const [contactData, masterData] = await Promise.all([api('/sales-officer-contacts'), api('/masters')]);
  masters = masterData;
  const contacts = contactData.contacts || [];
  const tabs = Object.entries(LIST_LABELS).map(([k, label]) => `
    <button type="button" class="mst-tab${k === listsTab ? ' on' : ''}" data-tab="${k}">${esc(label)}<span class="mst-tab-count">${k === 'salesOfficerContacts' ? contacts.length : (masters[k] || []).length}</span></button>
  `).join('');

  view.innerHTML = `
    <div class="card mst-card">
      <div class="mst-tabs" id="mstTabs">${tabs}</div>
      <p class="contact-list-note">Saved Sales Officer numbers are used for future uploads. Existing leads keep their stored phone snapshot.</p>
      <input id="mstFilter" class="mst-filter" placeholder="Filter Sales Officer contacts…"${contacts.length ? '' : ' disabled'}>
      <div class="mst-rows" id="mstRows">${contacts.length ? contacts.map(c => `
        <div class="mst-row soc-contact-row" data-search="${esc(`${c.display_name} ${c.phone}`.toLowerCase())}">
          <div class="soc-contact-copy"><b>${esc(c.display_name)}</b><span>${esc(c.phone)} · updated ${esc(displayDateTime(c.updated_at || '—'))}</span></div>
          <div class="soc-contact-actions"><button class="mst-edit" data-id="${c.id}" data-name="${esc(c.display_name)}" data-phone="${esc(c.phone)}">Edit</button><button class="mst-remove" data-id="${c.id}" data-name="${esc(c.display_name)}">Remove</button></div>
        </div>`).join('') : '<div class="empty">No Sales Officer contacts saved yet.</div>'}</div>
    </div>
    <div id="msg"></div>`;

  view.querySelectorAll('.mst-tab').forEach(b => b.onclick = () => { listsTab = b.dataset.tab; listsView(); });
  const filterInput = document.getElementById('mstFilter');
  filterInput.oninput = () => {
    const q = filterInput.value.trim().toLowerCase();
    document.querySelectorAll('#mstRows .soc-contact-row').forEach(row => row.classList.toggle('hide', !!q && !row.dataset.search.includes(q)));
  };

  view.querySelectorAll('.mst-edit').forEach(button => {
    button.onclick = () => {
      const row = button.closest('.soc-contact-row');
      row.innerHTML = `<div class="soc-contact-edit"><b>${esc(button.dataset.name)}</b><input class="soc-contact-phone" inputmode="numeric" maxlength="10" value="${esc(button.dataset.phone)}"></div>
        <div class="soc-contact-actions"><button class="mst-save">Save</button><button class="mst-cancel">Cancel</button></div>`;
      const input = row.querySelector('.soc-contact-phone');
      row.querySelector('.mst-cancel').onclick = () => salesOfficerContactsView();
      row.querySelector('.mst-save').onclick = async () => {
        const phone = input.value.replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) { input.focus(); return; }
        try {
          await api(`/sales-officer-contacts/${button.dataset.id}`, 'PATCH', { phone });
          salesOfficerContactsView();
        } catch (err) { say(err.message, 'err'); }
      };
      input.focus();
      input.select();
    };
  });

  view.querySelectorAll('.mst-remove').forEach(button => {
    button.onclick = async () => {
      if (!confirm(`Remove saved contact for ${button.dataset.name}?`)) return;
      try {
        await api(`/sales-officer-contacts/${button.dataset.id}`, 'DELETE');
        salesOfficerContactsView();
      } catch (err) { say(err.message, 'err'); }
    };
  });
}

async function listsView() {
  if (listsTab === 'salesOfficerContacts') return salesOfficerContactsView();
  const [masterData, contactData] = await Promise.all([api('/masters'), api('/sales-officer-contacts')]);
  masters = masterData;
  const contactCount = (contactData.contacts || []).length;

  const paged = {
    branches: parsePage(masters.branches, 'items', listsPage.branches, LISTS_PER_PAGE),
    sources: parsePage(masters.sources, 'items', listsPage.sources, LISTS_PER_PAGE),
  };
  const countOf = key => key === 'salesOfficerContacts' ? contactCount : (PAGINATED_LISTS.has(key) ? paged[key].total : masters[key].length);

  const key = listsTab;
  const pg = PAGINATED_LISTS.has(key) ? paged[key] : null;
  const items = pg ? pg.items : masters[key];
  const pager = pg ? renderPager(pg.page, pg.pages, pg.total) : '';

  view.innerHTML = `
    <div class="card mst-card">
      <div class="mst-tabs" id="mstTabs">${Object.entries(LIST_LABELS).map(([k, label]) => `
        <button type="button" class="mst-tab${k === key ? ' on' : ''}" data-tab="${k}">${esc(label)}<span class="mst-tab-count">${countOf(k)}</span></button>
      `).join('')}</div>
      <div class="grid2">
        <input id="mstAddInput" placeholder="Add ${esc(LIST_PLACEHOLDER[key])}">
        <button class="btn" id="mstAddBtn">Add</button>
      </div>
      <input id="mstFilter" class="mst-filter" placeholder="Filter ${esc(LIST_LABELS[key].toLowerCase())}…"${items.length ? '' : ' disabled'}>
      <div class="mst-rows" id="mstRows">${items.length ? items.map(m => `
        <div class="mst-row" data-name="${esc(m.name.toLowerCase())}">
          <span>${esc(m.name)}</span>
          <button class="mst-remove" data-id="${m.id}">Remove</button>
        </div>`).join('') : '<div class="empty">No entries yet.</div>'}</div>
      ${pager}
    </div>
    <div id="msg"></div>`;

  view.querySelectorAll('.mst-tab').forEach(b => b.onclick = () => { listsTab = b.dataset.tab; listsView(); });

  const card = view.querySelector('.mst-card');
  if (PAGINATED_LISTS.has(key)) bindPager(p => { listsPage[key] = p; listsView(); }, card);

  document.getElementById('mstAddBtn').onclick = async () => {
    const name = val('mstAddInput');
    if (!name) return;
    try { await api('/masters/' + key, 'POST', { name }); listsView(); }
    catch (e) { say(e.message); }
  };

  view.querySelectorAll('.mst-remove').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this entry?')) return;
    try { await api(`/masters/${key}/${b.dataset.id}`, 'DELETE'); listsView(); }
    catch (e) { say(e.message); }
  });

  const filterInput = document.getElementById('mstFilter');
  filterInput.oninput = () => {
    const q = filterInput.value.trim().toLowerCase();
    document.querySelectorAll('#mstRows .mst-row').forEach(row => {
      row.classList.toggle('hide', !!q && !row.dataset.name.includes(q));
    });
  };
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

function overdueLink(callGuyId, callGuy, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  const id = encodeURIComponent(String(callGuyId));
  const label = encodeURIComponent(callGuy || 'Call Executive');
  return `<button class="tbl-link" onclick="openOverdueLeads('${id}','${label}')">${count}</button>`;
}

function callCenterMetricQuery(filters) {
  return new URLSearchParams({ scope: 'call_center', ...filters }).toString();
}

function callCenterMetricClick(filters, label) {
  const query = callCenterMetricQuery(filters);
  return `openMetricLeads('${query}','${encodeURIComponent(label)}')`;
}

function callCenterMetricLink(filters, label, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  return `<button class="tbl-link" onclick="${callCenterMetricClick(filters, label)}">${count}</button>`;
}

function lostCaseLink(outcome, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  const oc = encodeURIComponent(outcome);
  return `<button class="tbl-link" style="color:var(--bad)" onclick="openLostLeads('${oc}','${esc(outcome)}')">${count}</button>`;
}

function leadAnalysisLink(kind, status, count) {
  if (!count) return `<span style="color:var(--muted)">0</span>`;
  const tone = kind === 'lost' ? ' style="color:var(--bad)"' : '';
  return `<button type="button" class="tbl-link lead-analysis-link"${tone} data-kind="${esc(kind)}" data-status="${esc(status)}">${count}</button>`;
}

async function openOutcomeLeads(callStatus, outcome, label) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="olx">← Back</button></div>
    <div class="card" id="olCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#olx').onclick = () => sheet.remove();

  try {
    const scope = tab === 'callCenter' ? '&scope=call_center' : '';
    const leads = await api(`/manager/leads?call_status=${callStatus}&outcome=${outcome}${scope}`);
    const card = sheet.querySelector('#olCard');
    card.innerHTML = `<h2>${esc(decodeURIComponent(label))} · ${leads.length} leads</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Officer</th><th>Next Date</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.officer || '—')}</td>
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
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

async function openOverdueLeads(callGuyId, label) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="odx">← Back</button></div>
    <div class="card" id="odCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#odx').onclick = () => sheet.remove();

  try {
    const scope = tab === 'callCenter' ? '&scope=call_center' : '';
    const leads = await api(`/manager/leads?overdue=1&call_guy_id=${callGuyId}${scope}`);
    const card = sheet.querySelector('#odCard');
    card.innerHTML = `<h2>Overdue — ${esc(decodeURIComponent(label))} · ${leads.length} leads</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Call Executive</th><th>Next Date</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.officer || '—')}</td>
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No overdue leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#odCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

async function openMetricLeads(query, label) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="mlx">← Back</button></div>
    <div class="card" id="mlCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#mlx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/manager/leads?${query}`);
    const card = sheet.querySelector('#mlCard');
    card.innerHTML = `<h2>${esc(decodeURIComponent(label))} · ${leads.length} leads</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Branch</th><th>Call Executive</th><th>Next Date</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.branch || '—')}</td>
          <td>${esc(l.officer || '—')}</td>
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No matching leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) {
    sheet.querySelector('#mlCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
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
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
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
    card.innerHTML = `<h2 style="color:#B91C1C">⚑ Flagged Leads — ${esc(officerName)} · ${leads.length}</h2>
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

function downloadFlagHistoryExcel() {
  if (typeof XLSX === 'undefined') return say('SheetJS not loaded — try refreshing');
  const btn = document.getElementById('flagExportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const rows = (window._flagHistory || []).map(r => ({
      'Customer Name':  r.customer_name,
      'Mobile':         r.mobile,
      'Officer':        r.officer || '',
      'SO Name':        r.so_name || '',
      'Follow-up Count':r.fcount,
      'Stage':          r.stage || '',
      'Flag Status':    r.is_flagged ? 'Active' : 'Resolved',
      'SM Remarks':     r.flag_remarks || '',
    }));
    if (!rows.length) { say('No flag history to export', 'err'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(h => {
      const max = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length);
      return { wch: Math.min(max + 2, 50) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Flag History');
    XLSX.writeFile(wb, `flag_history_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { say(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Excel'; } }
}

async function downloadLeadsExcel() {
  if (typeof XLSX === 'undefined') return say('SheetJS not loaded — try refreshing');
  const btn = document.getElementById('exportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const leads = await api(tab === 'callCenter' ? '/call-center/leads/export' : '/manager/leads/export');
    const rows = leads.map(l => ({
      'Customer Name':       l.customer_name,
      'Mobile':              l.mobile,
      'Branch':              l.branch || '',
      'Source':              l.source || '',
      'Officer':             l.officer || '',
      'SO Name':             l.so_name || '',
      'Follow-up Count':     l.fcount,
      'Stage':               l.stage || '',
      'Status':              l.status || '',
      'Next Follow-up Date': l.next_date ? displayDate(l.next_date) : '',
      'Location':            l.location || '',
      'Lead Remarks':        l.lead_remarks || '',
      'Latest Call Status':  l.latest_call_status || '',
      'Latest Outcome':      l.latest_outcome || '',
      'Latest Call Remarks': l.latest_remarks || '',
      'Latest Call Date':    l.latest_call_date ? displayDateTime(l.latest_call_date) : '',
      'Lead Created':        l.created_at ? displayDateTime(l.created_at) : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // auto-fit column widths
    const headers = Object.keys(rows[0] || {});
    ws['!cols'] = headers.map(h => {
      const max = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length);
      return { wch: Math.min(max + 2, 40) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Follow-up Leads');
    XLSX.writeFile(wb, `followup_leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { say(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Excel'; } }
}

async function managerView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  let d;
  try { d = await api('/manager/analytics'); }
  catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${e.message}</div>`; return; }

  const { kpi, byOfficer, outcomes, byStage, overdue, officerOutcomes, flagged = [], lostCases = [], flagHistory = [] } = d;
  window._flagHistory = flagHistory;
  const connected    = outcomes.filter(o => o.call_status === 'Connected');
  const notConnected = outcomes.filter(o => o.call_status === 'Not Connected');
  const connTotal    = connected.reduce((s, o) => s + o.cnt, 0);
  const notConnTotal = notConnected.reduce((s, o) => s + o.cnt, 0);
  const lostTotal    = lostCases.reduce((s, o) => s + o.cnt, 0);

  view.innerHTML = `
    <div style="display:flex;justify-content:flex-end;padding:0 4px 8px">
      <button id="exportBtn" class="btn" style="width:auto;padding:8px 18px;font-size:13px" onclick="downloadLeadsExcel()">⬇ Download Excel</button>
    </div>
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="color:var(--bad);margin:0;">Lost Case Analysis</h2>
        ${lostCases.length ? `<button class="btn" style="background:var(--primary);font-size:13px;padding:4px 8px;" onclick="fetchAiLostSummary()">✨ AI Summary</button>` : ''}
      </div>
      <div id="aiSummaryBox" class="ai-summary-box" style="display:none;"></div>
      ${lostCases.length ? `
        ${tblHtml(
          ['Lost Reason', 'Leads'],
          [
            ...lostCases.map(r => [esc(r.outcome), lostCaseLink(r.outcome, r.cnt)]),
            [`<b>Total Lost</b>`, `<b>${lostTotal}</b>`],
          ]
        )}` : '<p style="color:var(--muted);padding:8px 0">No lost leads yet.</p>'}
    </div>

    ${flagged.length ? `<div class="card" style="border-color:#B91C1C">
      <h2 style="color:#B91C1C">⚑ Flagged Leads by Officer</h2>
      ${tblHtml(
        ['Officer','Flagged Leads'],
        flagged.map(r => [esc(r.officer), `<button class="tbl-link flag-drill" data-oid="${r.officer_id}" data-oname="${esc(r.officer)}">${r.flagged}</button>`]),
      )}
    </div>` : ''}

    ${flagHistory.length ? `<div class="card" style="border-color:#B91C1C">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="color:#B91C1C;margin:0">⚑ Flag History (All Flagged Leads)</h2>
        <button id="flagExportBtn" class="btn" style="width:auto;padding:6px 14px;font-size:13px" onclick="downloadFlagHistoryExcel()">⬇ Download Excel</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Customer</th><th>Mobile</th><th>Officer</th><th>SO Name</th>
          <th>Follow-ups</th><th>Stage</th><th>Flag Status</th><th>SM Remarks</th>
        </tr></thead>
        <tbody>${flagHistory.map(r => `<tr class="lead-row flag-hist-row" data-id="${r.id}" style="cursor:pointer">
          <td>${esc(r.customer_name)}</td>
          <td>${esc(r.mobile)}</td>
          <td>${esc(r.officer || '—')}</td>
          <td>${esc(r.so_name || '—')}</td>
          <td>${r.fcount}</td>
          <td>${esc(r.stage || '—')}</td>
          <td><span style="color:${r.is_flagged ? '#B91C1C' : 'var(--ok)'}">
            ${r.is_flagged ? '⚑ Active' : '✓ Resolved'}
          </span></td>
          <td style="color:var(--muted)">${esc(r.flag_remarks || '—')}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
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
         'Test Drive','Showroom','Exchange','Booking Done','Retail Done','Customer Busy','Details Received',
         'Need Time','Need SO Call',
         'More Details','Discount','Not Interested','Already Booked','Lost',
         'RNR','Switch Off','Call Back','Call Fwd','Line Busy','Invalid No.'],
        officerOutcomes.map(r => [
          esc(r.so_name), r.total, r.total_calls, r.connected, r.not_connected,
          r.need_test_drive, r.showroom_visit, r.exchange_issue, r.booking_done, r.retail_done,
          r.customer_busy, r.details_received,
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
  view.querySelectorAll('.flag-hist-row').forEach(row => {
    row.onclick = () => openLead(Number(row.dataset.id));
  });
}

async function callCenterView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const d = await api('/call-center/analytics');
    const s = d.summary || d.kpi || {};
    view.innerHTML = `<div style="display:flex;justify-content:flex-end;padding:0 4px 8px">
      <button id="exportBtn" class="btn" style="width:auto;padding:8px 18px;font-size:13px" onclick="downloadLeadsExcel()">⬇ Download Excel</button>
    </div>${kpiRow([
      { num: s.total || 0, lbl: 'Total Leads', col: 'brand', onClick: callCenterMetricClick({ bucket: 'total' }, 'Total leads') },
      { num: s.untouched || 0, lbl: 'Untouched', col: 'warn', onClick: callCenterMetricClick({ bucket: 'untouched' }, 'Untouched leads') },
      { num: s.followup || 0, lbl: 'Under Follow-up', col: 'brand', onClick: callCenterMetricClick({ bucket: 'followup' }, 'Leads under follow-up') },
      { num: s.overdue || 0, lbl: 'Overdue', col: 'bad', onClick: callCenterMetricClick({ bucket: 'overdue' }, 'Overdue leads') },
      { num: s.booked || 0, lbl: 'Booked', col: 'ok', onClick: callCenterMetricClick({ bucket: 'booked' }, 'Booked leads') },
      { num: s.retailed || 0, lbl: 'Retail', col: 'ok', onClick: callCenterMetricClick({ bucket: 'retailed' }, 'Retail leads') },
      { num: s.lost || 0, lbl: 'Lost', col: 'bad', onClick: callCenterMetricClick({ bucket: 'lost' }, 'Lost leads') },
      ...(me.role === 'admin' ? [{ num: (d.flagged || []).length, lbl: '🚩 Flagged', col: 'flag', onClick: "go('flagged')" }] : []),
    ])}
    <div class="card"><h2>Call Executive Performance</h2>${tblHtml(
      ['Call Executive','Total','Untouched','Follow-up','Due','Booked','Retail','Lost'],
      d.byCallGuy.map(r => [
        esc(r.call_guy),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'total' }, `${r.call_guy} total leads`, r.total),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'untouched' }, `${r.call_guy} untouched leads`, r.untouched),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'followup' }, `${r.call_guy} follow-up leads`, r.followup),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'due' }, `${r.call_guy} due leads`, r.due),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'booked' }, `${r.call_guy} booked leads`, r.booked),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'retailed' }, `${r.call_guy} retail leads`, r.retailed),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'lost' }, `${r.call_guy} lost leads`, r.lost),
      ]),
      'No Call Executives found'
    )}</div>
    <div class="card"><h2>Follow-up stages</h2>${tblHtml(
      ['Call Executive','F1','F2','F3','F4','F5+'],
      d.byCallGuy.map(r => [
        esc(r.call_guy),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'f1' }, `${r.call_guy} F1 leads`, r.f1),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'f2' }, `${r.call_guy} F2 leads`, r.f2),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'f3' }, `${r.call_guy} F3 leads`, r.f3),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'f4' }, `${r.call_guy} F4 leads`, r.f4),
        callCenterMetricLink({ call_guy_id: r.id, bucket: 'f5plus' }, `${r.call_guy} F5 and later leads`, r.f5plus),
      ]),
      'No follow-up stages found'
    )}</div>
    <div class="card"><h2>Performance by Branch</h2>${tblHtml(
      ['Branch','Total','Open','Won'], d.byBranch.map(r => [
        esc(r.branch),
        callCenterMetricLink({ branch_id: r.branch_id, bucket: 'total' }, `${r.branch} total leads`, r.total),
        callCenterMetricLink({ branch_id: r.branch_id, bucket: 'open' }, `${r.branch} open leads`, r.open),
        callCenterMetricLink({ branch_id: r.branch_id, bucket: 'won' }, `${r.branch} won leads`, r.won),
      ]), 'No branch data'
    )}</div>
    <div class="card"><h2>Call Outcomes</h2>${tblHtml(
      ['Call Status','Outcome','Count'], d.outcomes.map(r => [esc(r.call_status), esc(r.outcome), outcomeLink(r.call_status, r.outcome, r.count)]), 'No calls logged'
    )}</div>
    <div class="card"><h2>Overdue Work</h2>${tblHtml(
      ['Call Executive','Overdue Leads'], d.overdue.map(r => [esc(r.call_guy), overdueLink(r.call_guy_id, r.call_guy, r.overdue)]), 'No overdue follow-ups'
    )}</div>`;
  } catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
}

const SO_BUCKETS = [
  { key: 'followup',  label: 'Follow-up' },
  { key: 'booked',    label: 'Booked' },
  { key: 'retailed',  label: 'Retail' },
  { key: 'lost',      label: 'Lost' },
];

const SO_STATUS_ORDER = [
  'Fresh', 'RNR', 'Switch Off', 'Call Me Back', 'Call Forwarding', 'Line Busy', 'Invalid Number',
  'Need Test Drive', 'Showroom Visit', 'Exchange Issue', 'Booking Done', 'Retail Done',
  'Customer Busy', 'Details Received', 'Need time', 'Need SO Call', 'Need More Details',
  'Discount Issue', 'Not Interested', 'Already Booked', 'Lost to Competition', 'Finance Rejected',
  'Dropped', 'Lost to co-dealer', 'Lost Lead', 'Unknown',
];
const SO_STATUS_PAGE_SIZE = 10;
let salesStatusPage = 1;

function renderSalesOfficerStatusTable(root, statusRows, officers, branchId, page = 1) {
  const statusByOfficer = new Map();
  const observedStatuses = new Set();
  statusRows.forEach(row => {
    const officer = String(row.sales_officer || 'Unknown Sales Officer');
    const status = String(row.status || 'Unknown');
    if (!statusByOfficer.has(officer)) statusByOfficer.set(officer, new Map());
    statusByOfficer.get(officer).set(status, Number(row.count) || 0);
    observedStatuses.add(status);
  });
  const statuses = SO_STATUS_ORDER.filter(status => status !== 'Unknown' || observedStatuses.has(status))
    .concat([...observedStatuses].filter(status => !SO_STATUS_ORDER.includes(status)).sort());
  const pages = Math.max(1, Math.ceil(officers.length / SO_STATUS_PAGE_SIZE));
  salesStatusPage = Math.min(Math.max(1, page), pages);
  const start = (salesStatusPage - 1) * SO_STATUS_PAGE_SIZE;
  const visibleOfficers = officers.slice(start, start + SO_STATUS_PAGE_SIZE);
  const statusHeader = statuses.map(status => `<th>${esc(status)}</th>`).join('');
  const countCell = (officer, status, count) => count
    ? `<button type="button" class="tbl-link so-status-link" data-officer="${esc(officer)}" data-status="${esc(status)}" title="View ${esc(status)} leads for ${esc(officer)}">${count}</button>`
    : '<span class="tbl-zero">0</span>';
  const rows = visibleOfficers.map(officer => {
    const counts = statusByOfficer.get(officer.sales_officer) || new Map();
    return `<tr><td><b>${esc(officer.sales_officer)}</b></td><td>${officer.total}</td>${statuses.map(status => `<td>${countCell(officer.sales_officer, status, counts.get(status) || 0)}</td>`).join('')}</tr>`;
  }).join('');

  root.innerHTML = `<div class="card so-status-card">
    <div class="sop-head">
      <div><h2>Sales Officer-wise Lead Status</h2><p class="sop-pick-desc">Latest follow-up status by Sales Officer. Select a count to view those leads.</p></div>
    </div>
    ${officers.length ? `<div class="tbl-wrap"><table class="tbl so-status-table">
      <thead><tr><th>Sales Officer</th><th>Total</th>${statusHeader}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${renderPager(salesStatusPage, pages, officers.length)}` : '<div class="empty">No Sales Officer status data found</div>'}
  </div>`;

  root.querySelectorAll('.so-status-link').forEach(button => {
    button.onclick = () => openOfficerStatusLeads(branchId, button.dataset.officer, button.dataset.status);
  });
  bindPager(nextPage => renderSalesOfficerStatusTable(root, statusRows, officers, branchId, nextPage), root);
}

let salesPerfSort = 'total';
const SO_PERFORMANCE_PAGE_SIZE = 10;
let salesPerfPage = 1;
let salesPerfFilter = '';

async function salesPerformanceView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    let branchId = '';
    let branchName = '';
    if (me.role === 'sales_manager') branchId = me.branch_id;
    else if (me.role === 'admin') {
      const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
      branchId = new URLSearchParams(hashQuery).get('branch_id') || '';
    }

    if (!branchId && me.role === 'admin') {
      const branches = await api('/analytics');
      view.innerHTML = `
        <div class="card sop-pick-card">
          <h2>Sales Officer Performance</h2>
          <p class="sop-pick-desc">Pick a branch to see how its imported sales officers are performing.</p>
          <div class="sop-pick-list">${branches.map(b => `
            <button type="button" class="sop-pick-row" data-id="${b.id}">
              <span class="sop-pick-name">${esc(b.name)}</span>
              <span class="sop-pick-stats">
                <span>${b.total} total</span><span>${b.open} open</span><span class="sop-pick-won">${b.won} won</span>
              </span>
            </button>`).join('')}
          </div>
        </div>`;
      view.querySelectorAll('.sop-pick-row').forEach(row => {
        row.onclick = () => { salesPerfPage = 1; salesPerfFilter = ''; location.hash = 'salesPerf?branch_id=' + row.dataset.id; salesPerformanceView(); };
      });
      return;
    }

    branchName = masters.branches.find(b => String(b.id) === String(branchId))?.name || '';
    const d = await api(`/sales-manager/analytics?branch_id=${encodeURIComponent(branchId)}`);
    const s = d.summary || {};
    const flagged = d.flagged || [];
    const officers = d.bySalesOfficer || [];

    const sorters = {
      total: (a, b) => b.total - a.total,
      due: (a, b) => b.due - a.due,
    };
    const sorted = [...officers].sort(sorters[salesPerfSort] || sorters.total);

    const rowHtml = o => `
      <div class="sop-row" data-name="${esc(o.sales_officer.toLowerCase())}" data-officer="${esc(o.sales_officer)}" role="link" tabindex="0" aria-label="View all leads for ${esc(o.sales_officer)}">
        <div class="sop-row-top">
          <button type="button" class="sop-row-name sop-row-name-btn" data-officer="${esc(o.sales_officer)}">${esc(o.sales_officer)}</button>
          <span class="sop-row-total">${o.total} lead${o.total !== 1 ? 's' : ''}</span>
        </div>
        <div class="sop-row-bar">${SO_BUCKETS.map(b => o[b.key] ? `<span class="sop-seg sop-seg-${b.key}" style="flex:${o[b.key]}" title="${esc(b.label)}: ${o[b.key]}"></span>` : '').join('')}</div>
        <div class="sop-row-pills">
          <button type="button" class="sop-pill sop-pill-brand" data-officer="${esc(o.sales_officer)}" data-bucket="due">${o.due} due</button>
          <span class="sop-row-outcome">${o.booked}B · ${o.retailed}R · ${o.lost}L</span>
        </div>
      </div>`;

    view.innerHTML = `${kpiRow([
      { num: s.total || 0, lbl: 'Total Leads', col: 'brand' },
      { num: s.followup || 0, lbl: 'Under Follow-up', col: 'brand' },
      { num: s.booked || 0, lbl: 'Booked', col: 'ok' },
      { num: s.retailed || 0, lbl: 'Retail', col: 'ok' },
      { num: s.lost || 0, lbl: 'Lost', col: 'bad' },
      { num: flagged.length, lbl: '🚩 Flagged', col: 'flag', onClick: "go('flagged')" },
    ])}
    <div class="card sop-card">
      <div class="sop-head">
        <h2>Sales Officer Performance${branchName ? ` · ${esc(branchName)}` : ''}</h2>
        ${me.role === 'admin' ? `<div class="sop-head-actions">
          <button type="button" class="btn ghost sop-back" id="salesBranchBack">← All branches</button>
          <label class="sop-switch-wrap">Branch<select id="salesBranchSwitch" class="sop-switch">${options(masters.branches, Number(branchId))}</select></label>
        </div>` : ''}
      </div>
      ${officers.length ? `
      <div class="sop-controls">
        <div class="sop-sort" id="sopSort">
          <button type="button" class="sop-sort-opt${salesPerfSort === 'total' ? ' on' : ''}" data-sort="total">Total</button>
          <button type="button" class="sop-sort-opt${salesPerfSort === 'due' ? ' on' : ''}" data-sort="due">Due</button>
        </div>
        <input id="sopFilter" class="sop-filter" placeholder="Filter officers…">
      </div>
      <div class="sop-rows" id="sopRows"></div>
      <div id="sopPager"></div>
      ` : '<div class="empty">No imported Sales Officer data found</div>'}
    </div>`;

    if (me.role === 'admin') {
      document.getElementById('salesBranchSwitch').onchange = (e) => {
        const id = e.target.value;
        if (!id) return;
        salesPerfPage = 1;
        salesPerfFilter = '';
        location.hash = 'salesPerf?branch_id=' + id;
        salesPerformanceView();
      };
      document.getElementById('salesBranchBack').onclick = () => {
        salesPerfPage = 1;
        salesPerfFilter = '';
        location.hash = 'salesPerf';
        salesPerformanceView();
      };
    }

    if (officers.length) {
      document.getElementById('sopSort').querySelectorAll('.sop-sort-opt').forEach(b => b.onclick = () => {
        salesPerfSort = b.dataset.sort;
        salesPerfPage = 1;
        salesPerformanceView();
      });
      const renderRows = () => {
        const query = salesPerfFilter.trim().toLowerCase();
        const filtered = query ? sorted.filter(o => o.sales_officer.toLowerCase().includes(query)) : sorted;
        const pages = Math.max(1, Math.ceil(filtered.length / SO_PERFORMANCE_PAGE_SIZE));
        salesPerfPage = Math.min(Math.max(1, salesPerfPage), pages);
        const start = (salesPerfPage - 1) * SO_PERFORMANCE_PAGE_SIZE;
        const visible = filtered.slice(start, start + SO_PERFORMANCE_PAGE_SIZE);
        document.getElementById('sopRows').innerHTML = visible.length
          ? visible.map(rowHtml).join('')
          : '<div class="empty">No matching Sales Officers</div>';
        const pager = document.getElementById('sopPager');
        pager.innerHTML = renderPager(salesPerfPage, pages, filtered.length);
        view.querySelectorAll('#sopRows .sop-row').forEach(row => {
          const openTotal = () => openOfficerLeads(branchId, row.dataset.officer, 'total');
          row.onclick = openTotal;
          row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTotal(); } };
        });
        view.querySelectorAll('#sopRows .sop-pill').forEach(b => b.onclick = (e) => {
          e.stopPropagation();
          openOfficerLeads(branchId, b.dataset.officer, b.dataset.bucket);
        });
        bindPager(nextPage => { salesPerfPage = nextPage; renderRows(); }, pager);
      };
      document.getElementById('sopFilter').value = salesPerfFilter;
      document.getElementById('sopFilter').oninput = (e) => {
        salesPerfFilter = e.target.value;
        salesPerfPage = 1;
        renderRows();
      };
      renderRows();
    }
  } catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
}

async function leadAnalysisView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    let branchId = '';
    let branchName = '';
    if (me.role === 'sales_manager') branchId = me.branch_id;
    else if (me.role === 'admin') {
      const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
      branchId = new URLSearchParams(hashQuery).get('branch_id') || '';
    }

    if (!branchId && me.role === 'admin') {
      const branches = await api('/analytics');
      view.innerHTML = `
        <div class="card sop-pick-card">
          <h2>Lead Analysis</h2>
          <p class="sop-pick-desc">Pick a branch to review its lead status and lost lead breakdown.</p>
          <div class="sop-pick-list">${branches.map(b => `
            <button type="button" class="sop-pick-row" data-id="${b.id}">
              <span class="sop-pick-name">${esc(b.name)}</span>
              <span class="sop-pick-stats"><span>${b.total} total</span><span>${b.open} open</span><span class="sop-pick-won">${b.won} won</span></span>
            </button>`).join('')}
          </div>
        </div>`;
      view.querySelectorAll('.sop-pick-row').forEach(row => {
        row.onclick = () => { location.hash = 'leadAnalysis?branch_id=' + row.dataset.id; leadAnalysisView(); };
      });
      return;
    }

    branchName = masters.branches.find(b => String(b.id) === String(branchId))?.name || '';
    const d = await api(`/sales-manager/lead-analysis?branch_id=${encodeURIComponent(branchId)}`);
    const leadStatusCounts = d.leadStatusCounts || [];
    const lostStatusCounts = d.lostStatusCounts || [];
    const officers = d.bySalesOfficer || [];
    const statusRows = d.bySalesOfficerStatus || [];

    view.innerHTML = `
      <div class="card">
        <div class="sop-head">
          <h2>Lead Analysis${branchName ? ` · ${esc(branchName)}` : ''}</h2>
          ${me.role === 'admin' ? `<div class="sop-head-actions">
            <button type="button" class="btn ghost sop-back" id="leadAnalysisBack">← All branches</button>
            <label class="sop-switch-wrap">Branch<select id="leadAnalysisBranch" class="sop-switch">${options(masters.branches, Number(branchId))}</select></label>
          </div>` : ''}
        </div>
      </div>
      <div class="card">
        <h2>Lead Status Analysis</h2>
        ${tblHtml(
          ['Lead Status', 'Count'],
          leadStatusCounts.map(r => [esc(r.status), leadAnalysisLink('status', r.status, r.count)]),
          'No lead status data'
        )}
      </div>
      <div class="card" style="border-color:var(--bad)">
        <h2 style="color:var(--bad)">Lost Lead Analysis</h2>
        ${tblHtml(
          ['Lost Lead Status', 'Count'],
          lostStatusCounts.map(r => [esc(r.status), leadAnalysisLink('lost', r.status, r.count)]),
          'No lost leads yet'
        )}
      </div>
      <div id="leadAnalysisSoStatusPanel"></div>`;

    if (me.role === 'admin') {
      document.getElementById('leadAnalysisBranch').onchange = (e) => {
        const id = e.target.value;
        if (!id) return;
        location.hash = 'leadAnalysis?branch_id=' + id;
        leadAnalysisView();
      };
      document.getElementById('leadAnalysisBack').onclick = () => {
        location.hash = 'leadAnalysis';
        leadAnalysisView();
      };
    }
    view.querySelectorAll('.lead-analysis-link').forEach(button => {
      button.onclick = () => openLeadAnalysisLeads(button.dataset.kind, button.dataset.status);
    });
    salesStatusPage = 1;
    renderSalesOfficerStatusTable(document.getElementById('leadAnalysisSoStatusPanel'), statusRows, officers, branchId);
  } catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
}

async function openLeadAnalysisLeads(kind, status) {
  const label = String(status || 'Selected leads');
  const branchId = me.role === 'sales_manager'
    ? me.branch_id
    : new URLSearchParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '').get('branch_id') || '';
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="lalx">← Back</button></div>
    <div class="card" id="laLeadsCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#lalx').onclick = () => sheet.remove();

  try {
    const query = new URLSearchParams({ branch_id: String(branchId), kind, value: label });
    const leads = await api(`/sales-manager/lead-analysis/leads?${query}`);
    const card = sheet.querySelector('#laLeadsCard');
    const heading = kind === 'lost' ? `Lost · ${label}` : label;
    card.innerHTML = `<h2>${esc(heading)} · ${leads.length}</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Sales Officer</th><th>Next Date</th><th>F#</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.sales_officer)}</td>
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
          <td>F${l.fcount}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => { row.onclick = () => openLead(Number(row.dataset.id)); });
  } catch (e) {
    sheet.querySelector('#laLeadsCard').innerHTML = `<p style="color:var(--bad);padding:16px">${esc(e.message)}</p>`;
  }
}

async function openOfficerLeads(branchId, officer, bucket) {
  const label = { total: 'Total', untouched: 'Untouched', due: 'Due' }[bucket] || bucket;
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="solx">← Back</button></div>
    <div class="card" id="solCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#solx').onclick = () => sheet.remove();

  try {
    const leads = await api(`/sales-manager/officer-leads?branch_id=${encodeURIComponent(branchId)}&officer=${encodeURIComponent(officer)}&bucket=${bucket}`);
    const card = sheet.querySelector('#solCard');
    card.innerHTML = `<h2>${esc(label)} — ${esc(officer)} · ${leads.length}</h2>
      ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Next Date</th><th>F#</th><th>Stage</th></tr></thead>
        <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
          <td>${esc(l.customer_name)}</td>
          <td>${esc(l.mobile)}</td>
          <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
          <td>F${l.fcount}</td>
          <td>${esc(l.stage || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
    card.querySelectorAll('.lead-row').forEach(row => { row.onclick = () => openLead(Number(row.dataset.id)); });
  } catch (e) {
    sheet.querySelector('#solCard').innerHTML = `<p style="color:var(--bad);padding:16px">${e.message}</p>`;
  }
}

async function openOfficerStatusLeads(branchId, officer, status) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="soslx">← Back</button></div>
    <div class="card" id="soslCard"><div class="empty">Loading…</div></div>
  </div></div>`);
  document.body.appendChild(sheet);
  sheet.querySelector('#soslx').onclick = () => sheet.remove();

  const card = sheet.querySelector('#soslCard');
  const loadPage = async (page = 1) => {
    card.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const query = new URLSearchParams({ branch_id: String(branchId), officer, status, page: String(page), limit: '25' });
      const data = await api(`/sales-manager/officer-status-leads?${query}`);
      const leads = data.leads || [];
      card.innerHTML = `<h2>${esc(status)} — ${esc(officer)} · ${data.total || 0}</h2>
        ${leads.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Customer</th><th>Mobile</th><th>Next Date</th><th>F#</th><th>Latest Outcome</th><th>Stage</th></tr></thead>
          <tbody>${leads.map(l => `<tr class="lead-row" data-id="${l.id}">
            <td>${esc(l.customer_name)}</td>
            <td>${esc(l.mobile)}</td>
            <td>${esc(l.next_date ? displayDate(l.next_date) : '—')}</td>
            <td>F${l.fcount}</td>
            <td>${esc(l.latest_outcome || (l.fcount === 0 ? 'Fresh' : '—'))}</td>
            <td>${esc(l.stage || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>${renderPager(data.page, data.pages, data.total)}` : '<p style="color:var(--muted);padding:16px;text-align:center">No leads</p>'}`;
      card.querySelectorAll('.lead-row').forEach(row => { row.onclick = () => openLead(Number(row.dataset.id)); });
      bindPager(nextPage => loadPage(nextPage), card);
    } catch (e) {
      card.innerHTML = `<p style="color:var(--bad);padding:16px">${esc(e.message)}</p>`;
    }
  };
  await loadPage();
}

async function flaggedLeadsView() {
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    let flagged = [], cols, rows;
    if (me.role === 'sales_manager') {
      const d = await api(`/sales-manager/analytics?branch_id=${encodeURIComponent(me.branch_id)}`);
      flagged = d.flagged || [];
      cols = ['Customer', 'Mobile', 'Sales Officer', 'Call Executive', 'Stage'];
      rows = flagged.map(r => [esc(r.customer_name), esc(r.mobile), esc(r.sales_officer), esc(r.call_guy || '—'), esc(r.stage || '—')]);
    } else if (me.role === 'admin') {
      const d = await api('/call-center/analytics');
      flagged = d.flagged || [];
      cols = ['Customer', 'Branch', 'Sales Officer', 'Call Executive', 'Sales Manager'];
      rows = flagged.map(r => [esc(r.customer_name), esc(r.branch || '—'), esc(r.original_so_name || '—'), esc(r.call_guy || '—'), esc(r.sales_manager || 'Unassigned')]);
    } else {
      view.innerHTML = '<div class="empty">Flag review is handled by Branch Sales Managers.</div>';
      return;
    }
    const ids = flagged.map(r => r.id);
    view.innerHTML = `<div class="card flag-card">
      <h2 class="flag-card-h2">🚩 Flagged Leads · ${flagged.length}</h2>
      ${flagged.length ? `<p class="flag-card-note">${me.role === 'sales_manager' ? 'Tap a lead to review and close its flag.' : 'Escalated by Call Executives, routed to the Sales Manager of the flagged lead\'s branch.'}${me.role === 'admin' && flagged.some(r => !r.sales_manager) ? ' Some flagged leads have no active Branch Sales Manager and need assignment.' : ''}</p>` : ''}
      <div class="tbl-wrap"><table class="tbl tbl-flag">
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="lead-row" data-id="${ids[i]}">${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${!flagged.length ? '<div class="empty">Nothing flagged right now.</div>' : ''}
    </div>`;
    view.querySelectorAll('.lead-row').forEach(row => {
      row.onclick = () => openLead(Number(row.dataset.id));
    });
  } catch (e) { view.innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
}

function kpiRow(cards) {
  return `<div class="kpi-row">${cards.map(c =>
    `<div class="kpi-card kpi-${c.col}${c.onClick ? ' kpi-click' : ''}"${c.onClick ? ` onclick="${c.onClick}" role="button" tabindex="0"` : ''}><div class="kpi-num">${c.num}</div><div class="kpi-lbl">${c.lbl}</div></div>`
  ).join('')}</div>`;
}

function parsePage(data, itemKey, page, limit) {
  if (Array.isArray(data)) {
    const total = data.length;
    const start = (page - 1) * limit;
    return {
      items: data.slice(start, start + limit),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }
  return {
    items: data[itemKey] || [],
    total: data.total ?? 0,
    page: data.page ?? page,
    limit: data.limit ?? limit,
    pages: data.pages ?? 1,
  };
}

function pageNumbers(current, total) {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const items = [];
  if (current <= 3) {
    for (let i = 1; i <= Math.min(4, total); i++) items.push(i);
    if (total > 5) { items.push('…'); items.push(total); }
    else if (total === 5) items.push(5);
  } else if (current >= total - 2) {
    items.push(1, '…');
    for (let i = total - 3; i <= total; i++) items.push(i);
  } else {
    items.push(1, '…', current - 1, current, current + 1, '…', total);
  }
  return items;
}

function renderPager(page, pages, total) {
  if (!total || pages <= 1) return '';
  const nums = pageNumbers(page, pages).map(n =>
    n === '…'
      ? `<span class="pager-ellipsis">…</span>`
      : `<button type="button" class="pager-num${n === page ? ' on' : ''}" data-page="${n}">${n}</button>`,
  ).join('');
  const opts = Array.from({ length: pages }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}"${n === page ? ' selected' : ''}>${n}</option>`;
  }).join('');
  const prev = page > 1 ? page - 1 : null;
  const next = page < pages ? page + 1 : null;
  return `<div class="pager">
    <div class="pager-bar">
      <button type="button" class="pager-prev" data-page="${prev || ''}" aria-label="Previous page"${prev ? '' : ' disabled'}>‹</button>
      <span class="pager-info" aria-live="polite">Page ${page} of ${pages}</span>
      <div class="pager-nums">${nums}</div>
      <button type="button" class="pager-next" data-page="${next || ''}" aria-label="Next page"${next ? '' : ' disabled'}>›</button>
      <label class="pager-jump">
        <span class="pager-jump-lbl">Go to</span>
        <select class="pager-select" aria-label="Jump to page">${opts}</select>
      </label>
    </div>
  </div>`;
}

function bindPager(onPage, root = view) {
  root.querySelectorAll('.pager-num:not(.on), .pager-prev:not([disabled]), .pager-next:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      onPage(Number(btn.dataset.page));
      root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
  root.querySelectorAll('.pager-select').forEach(sel => {
    sel.onchange = () => {
      onPage(Number(sel.value));
      root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
}

async function leadsView() {
  const gen = ++leadsGen;
  leadsCtrl?.abort();
  leadsCtrl = new AbortController();
  const sig = leadsCtrl.signal;

  const t = tab === 'leads' ? 'all' : tab;
  view.innerHTML = '<div class="empty">Loading…</div>';
  const params = new URLSearchParams({ tab: t, page: leadsPage, limit: LEADS_PER_PAGE });
  if (leadsQ) params.set('q', leadsQ);

  let data, stats;
  try {
    const statsP = leadsStatsCache
      ? Promise.resolve(leadsStatsCache)
      : api('/leads/stats', 'GET', undefined, { signal: sig }).then(s => (leadsStatsCache = s, s));
    [data, stats] = await Promise.all([
      api('/leads?' + params, 'GET', undefined, { signal: sig }),
      statsP,
    ]);
  } catch (e) {
    if (e.name === 'AbortError') return;
    view.innerHTML = `<div class="empty msg err">${esc(e.message)}</div>`;
    return;
  }
  if (gen !== leadsGen) return;

  const { items: leads, total, page, pages } = parsePage(data, 'leads', leadsPage, LEADS_PER_PAGE);
  const pg = renderPager(page, pages, total);

  const kpi = {
    fresh: kpiRow([
      { num: stats.fresh,  lbl: 'Fresh Leads', col: 'brand' },
      { num: stats.booked,  lbl: 'Booked',      col: 'ok'    },
      { num: stats.retailed,lbl: 'Retailed',     col: 'ok'    },
      { num: stats.lost,    lbl: 'Lost',         col: 'bad'   },
    ]),
    today: kpiRow([
      { num: stats.today_count, lbl: "Today's Follow-ups", col: 'brand' },
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
        <input type="search" id="leadSearch" placeholder="Search by name or mobile…" autocomplete="off" value="${esc(leadsQ)}">
        ${isBulkAdmin ? `
          <input type="file" id="bulkFile" accept=".xlsx,.xls" style="display:none">
          <button class="btn ghost" style="width:auto;margin:0;padding:6px 14px;font-size:13px;white-space:nowrap" onclick="document.getElementById('bulkFile').click()">Bulk Upload</button>
        ` : ''}
      </div>
    </div>`;

  if (!leads.length) {
    const blank = {
      fresh: leadsQ ? 'No matching fresh leads.' : 'No fresh leads right now.',
      today: leadsQ ? 'No matching follow-ups.' : 'Nothing due today. Nice work.',
      all: leadsQ ? 'No matching leads.' : 'No leads yet.',
    };
    view.innerHTML = kpi + searchHtml + pg + `<div class="empty">${blank[t]}</div>`;
  } else {
    view.innerHTML = kpi + searchHtml + pg + `
      <div id="leadList">${leads.map((l, i) => {
        const num = (page - 1) * LEADS_PER_PAGE + i + 1;
        return `
      <div class="card lead" data-id="${l.id}" tabindex="0" role="button">
        <span class="lead-num" aria-hidden="true">${num}</span>
        <div class="lead-body">
          <div class="top"><b>${esc(l.customer_name)}</b>${dueLabel(l)}</div>
          <div class="meta">${esc(l.mobile)} · ${esc(l.branch || '—')}${l.location ? ' · ' + esc(l.location) : ''}</div>
          <div class="meta">${esc(l.source || 'No source')} · ${l.fcount ? 'F' + l.fcount + ' done — ' + esc(l.stage) : 'Not contacted'}${me.role !== 'sales' && l.officer ? ' · ' + esc(l.officer) : ''}</div>
          ${['sales', 'call_guy'].includes(me.role) ? `<div style="margin-top:10px"><button class="flag-btn${l.is_flagged ? ' flagged' : ''}" data-id="${l.id}" title="${l.is_flagged ? 'Remove flag' : 'Flag to Sales Manager'}">⚑ Flag to Sales Manager</button></div>` : ''}
        </div>
      </div>`;
      }).join('')}</div>`;
  }

  bindPager(p => { leadsPage = p; leadsView(); });

  const sInput = document.getElementById('leadSearch');
  if (sInput) {
    sInput.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = sInput.value.trim();
        if (q === leadsQ) return;
        leadsQ = q;
        leadsPage = 1;
        leadsView();
      }, 300);
    };
    if (leadsQ) sInput.focus();
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
        btn.title = data.is_flagged ? 'Remove flag' : 'Flag to Sales Manager';
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

function workbookHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function reportColumn(headers, matcher) {
  return headers.findIndex(h => matcher(workbookHeader(h)));
}

function parseAssignmentReport(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let headerIndex = -1;
  let columns = null;
  for (let i = 0; i < rows.length; i++) {
    const headers = rows[i].map(workbookHeader);
    const leadName = reportColumn(headers, h => h.includes('lead name'));
    const mobile = reportColumn(headers, h => h === 'mobile');
    const quality = reportColumn(headers, h => h.includes('lead quality'));
    const gem = reportColumn(headers, h => h === 'gem');
    const dealership = reportColumn(headers, h => h === 'dealership');
    if ([leadName, mobile, quality, gem, dealership].every(n => n >= 0)) {
      headerIndex = i;
      columns = {
        leadName, mobile, quality, gem, dealership,
        source: reportColumn(headers, h => h === 'source'),
        model: reportColumn(headers, h => h === 'model'),
        qualityType: reportColumn(headers, h => h === 'quality type'),
        soMobile: reportColumn(headers, h => (
          h !== 'mobile' && ((h.includes('sales officer') || h.startsWith('so ') || h.startsWith('gem ')) && (h.includes('phone') || h.includes('mobile')))
        )),
      };
      break;
    }
  }
  if (headerIndex < 0) return null;

  const cell = (row, index) => index >= 0 ? row[index] : '';
  return rows.slice(headerIndex + 1).map(row => {
    const quality = String(cell(row, columns.quality) || '').trim();
    if (!/\b(?:hot|warm|cold)\b/i.test(quality)) return null;
    const customer_name = String(cell(row, columns.leadName) || '').trim();
    const mobile = String(cell(row, columns.mobile) || '').trim();
    const so_name = String(cell(row, columns.gem) || '').trim();
    if (!customer_name && !mobile) return null;
    return {
      customer_name,
      mobile,
      branch: cell(row, columns.dealership),
      source: cell(row, columns.source),
      model: cell(row, columns.model),
      activity: null,
      location: null,
      remarks: cell(row, columns.qualityType),
      so_name,
      so_mobile: columns.soMobile >= 0 ? String(cell(row, columns.soMobile) || '').trim() : null,
      so_status: null,
      requires_so_contact: true,
    };
  }).filter(Boolean);
}

function parseGenericWorkbook(ws) {
  const data = XLSX.utils.sheet_to_json(ws);
  return data.map(r => {
    let branch = null, source = null, mobile = null, customer_name = null;
    let model = null, activity = null, location = null, remarks = null;
    let so_name = null, so_mobile = null, so_status = null;
    for (const key of Object.keys(r)) {
      const k = key.toLowerCase().trim();
      const v = r[key];
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
      else if (k === 'status' || k.includes('salesforce status')) so_status = String(v || '').trim() || null;
    }
    return { branch, source, mobile, customer_name, model, activity, location, remarks, so_name, so_mobile, so_status, requires_so_contact: true };
  }).filter(r => r.mobile || r.customer_name);
}

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
    const records = parseAssignmentReport(ws) || parseGenericWorkbook(ws);

    if (!records.length) throw new Error('No valid rows found in sheet');

    const closeProgress = showBulkValidationProgress();
    const res = await api('/leads/bulk-validate', 'POST', records);
    closeProgress();
    bulkValid = res.valid || [];
    bulkInvalid = res.invalid || [];
    const bulkDuplicates = res.duplicates || 0;
    
    showBulkReviewSheet(bulkDuplicates);
  } catch(err) {
    document.querySelectorAll('.sheet[role="status"]').forEach(node => node.remove());
    say(err.message, 'err');
  }
}

const MASTER_LABEL = { branches: 'branch', sources: 'source', models: 'model', activities: 'activity' };
const GROUP_FIELDS = [
  { kind: 'branches', errField: 'err_branch', idField: 'branch_id', title: 'Branch', valueOf: l => l.branch, subOf: l => l.original_branch && l.original_branch !== l.branch ? l.original_branch : null },
  { kind: 'sources', errField: 'err_source', idField: 'source_id', title: 'Source', valueOf: l => l.source },
  { kind: 'models', errField: 'err_model', idField: 'model_id', title: 'Model', valueOf: l => l.model },
  { kind: 'activities', errField: 'err_activity', idField: 'activity_id', title: 'Activity', valueOf: l => l.activity },
];
// Officer phone is useful context but is not required to import the lead.
// Branch, source, model, activity and customer identity errors remain blocking.
const isRowReady = l => !l.err_branch && !l.err_source && !l.err_model && !l.err_activity && !l.err_missing && !l.err_so_name;

const officerKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const officerBranchKey = value => String(value || '').toLowerCase().replace(/^nippon\s+toyota\s*[-:]?\s*/i, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const contactGroupKey = (name, branch) => `${officerKey(name)}|${officerBranchKey(branch)}`;

// Collapse potentially thousands of error rows into one entry per distinct
// unrecognized value, so fixing "Kalamassery" once resolves every row that used it.
function buildInvalidGroups(rows) {
  const groups = {};
  for (const f of GROUP_FIELDS) groups[f.kind] = new Map();
  const blocked = [];
  const noSalesOfficer = [];
  const contacts = new Map();
  for (const l of rows) {
    if (l.err_missing) blocked.push(l);
    if (l.warning_no_so) noSalesOfficer.push(l);
    if (l.err_so_mobile && l.so_name) {
      const key = contactGroupKey(l.so_name, l.branch || l.original_branch);
      if (!contacts.has(key)) contacts.set(key, { name: l.so_name, branch: l.branch || l.original_branch || 'Unknown branch', rows: [] });
      contacts.get(key).rows.push(l);
    }
    for (const f of GROUP_FIELDS) {
      if (!l[f.errField]) continue;
      const value = f.valueOf(l);
      if (!value) continue;
      if (!groups[f.kind].has(value)) groups[f.kind].set(value, { rows: [], sub: f.subOf ? f.subOf(l) : null });
      groups[f.kind].get(value).rows.push(l);
    }
  }
  return { groups, blocked, contacts, noSalesOfficer };
}

function missingFieldNames(l) {
  const out = [];
  if (!l.branch) out.push('Branch');
  if (!l.source) out.push('Source');
  if (!l.customer_name) out.push('Name');
  return out.join(', ') || 'Required data';
}

async function showBulkReviewSheet(duplicates = 0) {
  // Fetch the shared Call Executive pool. Branch does not limit assignment.
  let callGuys = [];
  try {
    const data = await api('/users?role=call_guy&active=1&limit=100');
    callGuys = parsePage(data, 'users', 1, 100).items;
  } catch { /* non-fatal */ }

  const assignHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px">
      ${callGuys.map(u => `<label style="display:flex;align-items:center;gap:6px;font-size:14px;background:var(--bg);border:1.5px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer">
        <input type="checkbox" class="assign-cb" value="${u.id}" style="accent-color:var(--brand);width:15px;height:15px">
        ${esc(u.name)}
      </label>`).join('')}
    </div>`;

  const { groups, blocked, contacts, noSalesOfficer } = buildInvalidGroups(bulkInvalid);

  const groupSectionHtml = f => {
    const entries = [...groups[f.kind].entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);
    if (!entries.length) return '';
    return `<div class="resolve-section" data-kind="${f.kind}">
      <h3 class="resolve-section-title">${f.title} <span>${entries.length} unrecognized value${entries.length !== 1 ? 's' : ''}</span></h3>
      ${entries.map(([value, g]) => `
        <div class="resolve-row" data-kind="${f.kind}" data-value="${esc(value)}">
          <div class="resolve-row-main">
            <div class="resolve-row-label">${esc(value)}</div>
            ${g.sub ? `<div class="resolve-row-sub">as uploaded: ${esc(g.sub)}</div>` : ''}
          </div>
          <span class="resolve-row-count">${g.rows.length} lead${g.rows.length !== 1 ? 's' : ''}</span>
          <div class="resolve-row-action">
            <select class="resolve-select">${options(masters[f.kind], null, `+ Add “${value}” as new ${MASTER_LABEL[f.kind]}`)}</select>
          </div>
        </div>
      `).join('')}
    </div>`;
  };

  const groupsHtml = GROUP_FIELDS.map(groupSectionHtml).join('');
  const contactsHtml = contacts.size ? `<div class="resolve-section" data-kind="contacts">
      <h3 class="resolve-section-title">Sales Officer phone <span>optional · ${contacts.size} contact${contacts.size !== 1 ? 's' : ''} to resolve</span></h3>
      ${[...contacts.entries()].map(([key, g]) => `
        <div class="contact-resolve-row" data-contact-key="${esc(key)}">
          <div class="resolve-row-main"><div class="resolve-row-sub">Branch: ${esc(g.branch)}</div><div class="resolve-row-label">Sales Officer: ${esc(g.name)}</div></div>
          <span class="resolve-row-count">${g.rows.length} lead${g.rows.length !== 1 ? 's' : ''}</span>
          <div class="contact-resolve-action">
            <input class="contact-phone-input" inputmode="numeric" maxlength="10" placeholder="10-digit phone">
            <button type="button" class="btn contact-resolve-btn">Resolve</button>
          </div>
        </div>
      `).join('')}
    </div>` : '';
  const readyCount = () => bulkValid.length + bulkInvalid.filter(isRowReady).length;
  const issueCount = () => GROUP_FIELDS.reduce((n, f) => n + groups[f.kind].size, 0);
  const reviewHint = groupsHtml
    ? `Resolve each required issue below once — Sales Officer phone numbers are optional; unresolved phones import as blank.`
    : contactsHtml
      ? 'Sales Officer phone resolution is optional — unresolved phones import as blank.'
      : 'Everything matched existing branches, sources, models and activities.';

  const sheet = el(`<div class="sheet"><div>
    <div class="close bulk-toolbar">
      <div class="bulk-toolbar-stats">
        <span class="is-ready"><b id="bulkReadyStat">${readyCount()}</b> ready</span>
        ${issueCount() ? `<span class="is-issue"><b id="bulkIssueStat">${issueCount()}</b> value${issueCount() !== 1 ? 's' : ''} to resolve</span>` : ''}
        ${duplicates ? `<span>${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped</span>` : ''}
      </div>
      <button class="btn ghost" id="x">Cancel</button>
    </div>

    <div class="card">
      <h2>Bulk Upload Review</h2>
      <p style="color:var(--muted);font-size:13px;margin:0">${bulkValid.length + bulkInvalid.length} lead${bulkValid.length + bulkInvalid.length !== 1 ? 's' : ''} parsed.
        ${reviewHint}</p>
      ${noSalesOfficer.length ? `<p class="bulk-no-so-note">${noSalesOfficer.length} lead${noSalesOfficer.length !== 1 ? 's have' : ' has'} no Sales Officer name attached — they will be imported without one.</p>` : ''}
    </div>

    ${bulkValid.length + bulkInvalid.length ? `<div class="card">
      <h2>Assign to Call Executives</h2>
      <p style="color:var(--muted);font-size:13px">Select one or more Call Executives. Ready leads will be distributed across the shared pool.</p>
      ${assignHtml}
    </div>` : ''}

    ${groupsHtml ? `<div class="card" id="resolveGroups">${groupsHtml}</div>` : ''}
    ${contactsHtml ? `<div class="card" id="resolveContacts">${contactsHtml}</div>` : ''}

    ${blocked.length ? `<div class="card">
      <details class="bulk-blocked">
        <summary>${blocked.length} lead${blocked.length !== 1 ? 's' : ''} missing required data — will be skipped</summary>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Customer</th><th>Mobile</th><th>Missing</th></tr></thead>
          <tbody>${blocked.map(l => `<tr><td>${esc(l.customer_name || '—')}</td><td>${esc(l.mobile || '—')}</td><td>${esc(missingFieldNames(l))}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </div>` : ''}

    ${noSalesOfficer.length ? `<div class="card">
      <details class="bulk-no-so">
        <summary>${noSalesOfficer.length} lead${noSalesOfficer.length !== 1 ? 's have' : ' has'} no Sales Officer name attached — will be imported without one</summary>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Customer</th><th>Mobile</th><th>Sales Officer</th></tr></thead>
          <tbody>${noSalesOfficer.map(l => `<tr><td>${esc(l.customer_name || '—')}</td><td>${esc(l.mobile || '—')}</td><td>Not attached</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </div>` : ''}

    <div class="bulk-footer">
      <button class="btn" id="confirmBulk">Confirm & Assign</button>
      <div id="msg"></div>
    </div>
  </div></div>`);

  document.body.appendChild(sheet);
  const close = () => { sheet.remove(); bulkValid = []; bulkInvalid = []; };
  sheet.querySelector('#x').onclick = close;

  const refreshStats = () => {
    const ready = sheet.querySelector('#bulkReadyStat');
    if (ready) ready.textContent = readyCount();
    const issue = sheet.querySelector('#bulkIssueStat');
    if (issue) issue.textContent = issueCount();
  };

  sheet.querySelectorAll('.contact-resolve-row').forEach(row => {
    const key = row.dataset.contactKey;
    const group = contacts.get(key);
    const input = row.querySelector('.contact-phone-input');
    const button = row.querySelector('.contact-resolve-btn');
    button.onclick = async () => {
      const phone = input.value.replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) { input.focus(); return; }
      button.disabled = true;
      try {
        const contact = await api('/sales-officer-contacts/resolve', 'POST', { name: group.name, phone });
        for (const l of group.rows) { l.so_name = contact.display_name; l.so_mobile = contact.phone; l.err_so_mobile = false; }
        row.remove();
        contacts.delete(key);
        refreshStats();
      } catch (err) {
        say(err.message, 'err');
        button.disabled = false;
      }
    };
  });

  sheet.querySelectorAll('.resolve-row').forEach(row => {
    const kind = row.dataset.kind;
    const value = row.dataset.value;
    const f = GROUP_FIELDS.find(x => x.kind === kind);
    const g = groups[kind].get(value);
    const sel = row.querySelector('.resolve-select');
    const actionBox = row.querySelector('.resolve-row-action');

    const applyToGroup = id => {
      for (const l of g.rows) { l[f.idField] = id; l[f.errField] = false; }
      row.classList.add('is-done');
      setTimeout(() => {
        row.remove();
        const section = sheet.querySelector(`.resolve-section[data-kind="${kind}"]`);
        if (section && !section.querySelector('.resolve-row')) section.remove();
        const container = sheet.querySelector('#resolveGroups');
        if (container && !container.querySelector('.resolve-section')) container.remove();
        refreshStats();
      }, 180);
    };

    sel.addEventListener('change', () => {
      if (sel.value === '__add__') {
        const label = MASTER_LABEL[kind];
        const form = el(`<div class="resolve-add-form">
          <input type="text" placeholder="New ${esc(label)} name" value="${esc(value)}">
          <button type="button" class="btn">Add</button>
          <button type="button" class="btn ghost">Cancel</button>
        </div>`);
        const [input, addBtn, cancelBtn] = form.children;
        actionBox.replaceChildren(form);
        input.focus();
        input.select();

        const revert = () => { actionBox.replaceChildren(sel); sel.value = ''; };
        cancelBtn.onclick = revert;
        const submit = async () => {
          const name = input.value.trim();
          if (!name) return input.focus();
          addBtn.disabled = true;
          addBtn.textContent = 'Adding…';
          try {
            const created = await api(`/masters/${kind}`, 'POST', { name });
            masters[kind].push(created);
            masters[kind].sort((a, b) => a.name.localeCompare(b.name));
            applyToGroup(created.id);
          } catch (err) {
            addBtn.disabled = false;
            addBtn.textContent = 'Add';
            form.insertAdjacentHTML('afterend', `<div class="msg err" style="margin-top:4px">${esc(err.message)}</div>`);
          }
        };
        addBtn.onclick = submit;
        input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') revert(); };
      } else if (sel.value) {
        applyToGroup(Number(sel.value));
      }
    });
  });

  sheet.querySelector('#confirmBulk').onclick = async (e) => {
    const selectedCallGuys = [...sheet.querySelectorAll('.assign-cb:checked')].map(cb => Number(cb.value));
    if (!selectedCallGuys.length) {
      const msgEl = sheet.querySelector('#msg');
      if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = 'Select at least one Call Executive.'; }
      return;
    }

    const totalToAssign = [...bulkValid, ...bulkInvalid.filter(isRowReady)];
    if (!totalToAssign.length) {
      const msgEl = sheet.querySelector('#msg');
      if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = 'No valid leads to assign.'; }
      return;
    }

    e.target.disabled = true;
    e.target.textContent = 'Assigning...';
    try {
      const res = await api('/leads/bulk-assign', 'POST', { leads: totalToAssign, call_guy_ids: selectedCallGuys });
      close();
      say(`Successfully imported & assigned ${res.added} leads!`, 'ok');
      invalidateLeadsStats();
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
  const canAct = (['sales', 'call_guy'].includes(me.role) || me.role === 'admin') && l.status === 'open';
  const canFillOrderId = me.role === 'admin' || (['sales', 'call_guy'].includes(me.role) && l.assigned_to === me.id);
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
      <div class="kv"><b>Original Sales Officer</b><span>${esc(l.original_so_name || 'Not provided')}</span></div>
      <div class="kv"><b>Sales Officer phone</b><span class="lead-contact-phone">${l.original_so_mobile ? `<a href="tel:${esc(l.original_so_mobile)}">${esc(l.original_so_mobile)}</a><button type="button" class="copy-contact" data-phone="${esc(l.original_so_mobile)}">Copy</button>` : 'Not provided'}</span></div>
      <div class="kv"><b>Assigned Call Executive</b><span>${esc(l.officer || 'Unassigned')}</span></div>
    </div>

    ${l.salesforce_history && l.salesforce_history.length ? `
      <div class="card" style="background:#fff3e0; border-color:#ffb74d">
        <h2 style="color:#9A3412; margin-bottom:8px">⚠️ Sales consultant info</h2>
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
        <em>${esc(displayDateTime(f.created_at))} · ${esc(f.by_name)}${f.next_date ? ' · next ' + displayDate(f.next_date) : ''}
        ${f.model ? ' · ' + esc(f.model) : ''}${f.activity ? ' · ' + esc(f.activity) : ''}</em>
        ${f.other_so_called ? `<div><b>Other SO called:</b> ${esc(f.other_so_called)}</div>` : ''}
        ${f.outcome === 'Booking Done' ? (f.order_id
          ? `<div><b>Order ID:</b> ${esc(f.order_id)}</div>`
          : `<div class="order-id-missing" data-seq="${f.seq}">
               <b style="color:#B91C1C">Order ID not filled</b>
               ${canFillOrderId ? `<button type="button" class="btn ghost fill-order-id" data-seq="${f.seq}" style="margin-left:8px;padding:2px 8px">Add now</button>` : ''}
             </div>`) : ''}
        ${f.test_drive_date ? `<div><b>Test Drive Date:</b> ${esc(displayDate(f.test_drive_date))}</div>` : ''}
        ${f.exchange_expected_price ? `<div><b>Exchange — Expected: ₹${esc(String(f.exchange_expected_price))} / Offered: ₹${esc(String(f.exchange_offered_price || '—'))}</b></div>` : ''}
        ${f.remarks ? `<div>${esc(f.remarks)}</div>` : ''}</div>`).join('')}</div></div>` : ''}

    ${l.is_flagged && ['manager', 'sales_manager', 'admin'].includes(me.role) ? `<div class="card" style="border-color:#B91C1C">
      <h2 style="color:#B91C1C">⚑ Flagged for Sales Manager</h2>
      ${l.original_so_name ? `<div style="margin-bottom:12px"><b>Sales Officer:</b> ${esc(l.original_so_name)}</div>` : ''}
      ${l.flag_remarks ? `<div style="margin-bottom:12px"><b>Previous remarks:</b> ${esc(l.flag_remarks)}</div>` : ''}
      ${me.role === 'sales_manager' || me.role === 'admin' ? `
        <label>Close Flag with Remarks</label>
        <textarea id="flagRemarks" placeholder="Enter remarks…"></textarea>
        <button class="btn" id="closeFlagBtn" style="background:#B91C1C">Close Flag</button>
        <div id="flagMsg"></div>
      ` : `<div style="color:var(--muted);font-size:13px">Awaiting resolution by the Sales Manager.</div>`}
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
      <div id="testDriveWrap" class="hide">
        <label>Test Drive Date <span style="color:var(--muted)">(optional)</span></label>
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
        <label>Did SO Call The Customer</label>
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
  sheet.querySelectorAll('.copy-contact').forEach(button => {
    button.onclick = () => copyContactPhone(button.dataset.phone, button);
  });

  sheet.querySelectorAll('.fill-order-id').forEach(button => {
    button.onclick = () => {
      const row = sheet.querySelector(`.order-id-missing[data-seq="${button.dataset.seq}"]`);
      row.innerHTML = `
        <input type="text" class="order-id-input" placeholder="Enter order ID" style="width:60%;display:inline-block">
        <button type="button" class="btn save-order-id" style="margin-left:8px;padding:2px 8px">Save</button>
        <div class="msg" style="margin-top:4px"></div>`;
      const input = row.querySelector('.order-id-input');
      input.focus();
      row.querySelector('.save-order-id').onclick = async (e) => {
        const order_id = input.value.trim();
        const msg = row.querySelector('.msg');
        if (!order_id) { msg.className = 'msg err'; msg.textContent = 'Order ID is required'; return; }
        e.target.disabled = true;
        try {
          await api(`/leads/${l.id}/order-id`, 'POST', { order_id });
          row.innerHTML = `<b>Order ID:</b> ${esc(order_id)}`;
        } catch (err) {
          msg.className = 'msg err'; msg.textContent = err.message;
          e.target.disabled = false;
        }
      };
    };
  });

  const closeFlagBtn = sheet.querySelector('#closeFlagBtn');
  if (closeFlagBtn) {
    closeFlagBtn.onclick = async () => {
      const remarks = sheet.querySelector('#flagRemarks').value.trim();
      closeFlagBtn.disabled = true;
      try {
        await api(`/leads/${l.id}/close-flag`, 'POST', { remarks });
        document.querySelectorAll('.sheet').forEach(s => s.remove());
        go(tab);
      } catch (err) {
        const m = sheet.querySelector('#flagMsg');
        if (m) { m.className = 'msg err'; m.textContent = err.message; }
        closeFlagBtn.disabled = false;
      }
    };
  }

  if (!canAct) return;

  const NO_DATE   = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer']);
  const OUT_COLOR = { 'Lost to Competition': 'red', 'Finance Rejected': 'red', 'Dropped': 'red', 'Lost to co-dealer': 'red', 'Not Interested': 'red', 'Already Booked': 'blue', 'Booking Done': 'green', 'Retail Done': 'green', 'Need time': 'blue', 'Need SO Call': 'blue', 'Need More Details': 'blue', 'Discount Issue': 'blue', 'Exchange Issue': 'blue', 'Customer Busy': 'blue', 'Call Me Back': 'blue', 'Details Received': 'blue' };
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
    sheet.querySelector('#testDriveWrap').classList.add('hide');
    sheet.querySelector('#exchangeWrap').classList.add('hide');
    pick(out, (o) => {
      outcome = o;
      const skipDate = NO_DATE.has(o);
      sheet.querySelector('#dateWrap').classList.toggle('hide', skipDate);
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
        test_drive_date:          outcome === 'Need Test Drive' ? sheet.querySelector('#testDriveDate').value || null    : undefined,
        exchange_expected_price:  outcome === 'Exchange Issue'  ? sheet.querySelector('#exExpected').value.trim()      : undefined,
        exchange_offered_price:   outcome === 'Exchange Issue'  ? sheet.querySelector('#exOffered').value.trim()       : undefined,
        remarks:       sheet.querySelector('#rm').value.trim(),
        other_so_called: oscValue,
      });
      close();
      invalidateLeadsStats();
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
      ${stats.length ? `<div class="charts">${stats.map(s => s.total ? `
        <div class="ch-row" ${!branchId ? `style="cursor:pointer" onclick="analyticsView(${s.id}, '${esc(s.name)}')" title="Click for details"` : ''}>
          <div class="ch-lbl"><b>${esc(s.name)}</b><span>${s.total} leads</span></div>
          <div class="ch-bar-wrap">
            <div class="ch-bar won" style="width:${(s.won / s.total * 100)}%"></div>
            <div class="ch-bar open" style="width:${(s.open / s.total * 100)}%"></div>
          </div>
          <div class="ch-stats">
            <span class="c-won">${s.won} won</span>
            <span class="c-open">${s.open} open</span>
          </div>
        </div>` : `
        <div class="ch-row ch-row-empty" ${!branchId ? `style="cursor:pointer" onclick="analyticsView(${s.id}, '${esc(s.name)}')" title="Click for details"` : ''}>
          <span class="ch-empty-name">${esc(s.name)}</span>
          <span class="ch-empty-tag">No leads</span>
        </div>`).join('')}</div>` : '<div class="empty">No data</div>'}
    </div>

    <section class="card ai-analysis" aria-labelledby="ai-analysis-title">
      <div class="ai-analysis-head">
        <div class="ai-analysis-heading">
          <span class="ai-analysis-eyebrow">AI analysis</span>
          <h2 id="ai-analysis-title">🤖 Lost-Lead Analysis</h2>
          <span class="ai-analysis-scope">${branchId ? esc(branchName) : 'All Branches'}</span>
        </div>
        <button type="button" class="btn ai-analysis-action" onclick="fetchAiLostSummary(${branchId || ''})">
          <span aria-hidden="true">✨</span>
          <span>Generate summary</span>
        </button>
      </div>
      <p class="ai-analysis-desc">Analyze lost lead remarks to find patterns and actionable insights.</p>
      <div id="aiSummaryBox" class="ai-summary-box" style="display:none;"></div>
    </section>
  `;
}

boot();
