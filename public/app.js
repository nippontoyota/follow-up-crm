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
      await api('/login', 'POST', { username: val('u'), password: document.getElementById('p').value });
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
  admin: [['analytics', 'Analytics', '📊'], ['users', 'Users', '👤'], ['lists', 'Lists', '🗂'], ['leads', 'All leads', '📋']],
  marketing: [['new', 'Add lead', '➕'], ['leads', 'My leads', '📋']],
  sales: [['fresh', 'Fresh Leads', '🆕'], ['today', 'Today', '📅'], ['leads', 'All', '📋']],
};

async function boot() {
  try { me = await api('/me'); } catch { return loginView(); }
  masters = await api('/masters');

  hdr.classList.remove('hide');
  nav.classList.remove('hide');
  if (me.role !== 'sales') {
    document.getElementById('hdrUser').textContent =
      `${me.name} · ${{ admin: 'Admin', marketing: 'Marketing' }[me.role]}`;
  } else {
    document.getElementById('hdrUser').textContent = '';
  }

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
  ({ analytics: analyticsView, users: usersView, lists: listsView, new: newLeadView, fresh: leadsView, today: leadsView, leads: leadsView })[t]();
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
  view.innerHTML = `
    <div class="card" style="background:var(--brand-light); border: 1px solid var(--brand); box-shadow:none;">
      <h2 style="color:var(--brand); margin-bottom: 4px;">Salesforce Analytics Sync</h2>
      <label style="margin-top:0; margin-bottom:12px; color:var(--muted)">Upload .xlsx sheet (needs Mobile, SO Name & SO Mobile columns).</label>
      <div class="grid2">
        <input type="file" id="sfFile" accept=".xlsx, .xls">
        <button class="btn" id="sfUpload">Upload</button>
      </div>
      <div id="sfMsg" class="msg" style="display:none; margin-top:12px"></div>
    </div>
  ` + Object.entries(LIST_LABELS).map(([key, label]) => `
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

  document.getElementById('sfUpload').onclick = async (e) => {
    const file = document.getElementById('sfFile').files[0];
    const msg = document.getElementById('sfMsg');
    const show = (txt, isErr = false) => { msg.style.display = 'block'; msg.className = 'msg ' + (isErr ? 'err' : 'ok'); msg.textContent = txt; };
    if (!file) return show('Select a file first', true);
    
    e.target.disabled = true;
    show('Parsing file locally...', false);
    
    try {
      const buf = await file.arrayBuffer();
      if (typeof XLSX === 'undefined') throw new Error('SheetJS library failed to load');
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      const records = data.map(r => ({
        mobile: r.Mobile || r['Mobile Number'] || r.Phone || r.UID || r.uid || r.Contact,
        so_name: r['SO Name'] || r.SO || r.Name || r['Sales Officer'] || r.Caller,
        so_mobile: r['SO Mobile'] || r['SO Mobile Number'] || r.so_mobile || ''
      })).filter(r => r.mobile && r.so_name);
      
      show(`Validating ${records.length} records...`, false);
      const valRes = await api('/salesforce-validate', 'POST', records);
      
      if (valRes.duplicates && valRes.duplicates.length > 0) {
        show(`Found ${valRes.duplicates.length} duplicate(s). Waiting for review...`, false);
        showSfReviewSheet(valRes.valid, valRes.duplicates);
      } else {
        show(`Uploading ${valRes.valid.length} new records...`, false);
        const res = await api('/salesforce-upload', 'POST', valRes.valid);
        show(`Done! Processed ${res.processed} records.`, false);
        document.getElementById('sfFile').value = '';
      }
    } catch (err) {
      show(err.message, true);
    }
    e.target.disabled = false;
  };

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

let sfValid = [];
let sfDuplicates = [];

function showSfReviewSheet(valid, duplicates) {
  sfValid = valid;
  sfDuplicates = duplicates;

  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="x">Cancel</button></div>
    <div class="card">
      <h2>Salesforce Upload Review</h2>
      <p><b>${valid.length}</b> new records are ready to import.</p>
      <p style="color:var(--bad)"><b>${duplicates.length}</b> duplicate records found (mobile number already exists).</p>
      <p>Select which duplicates to update/overwrite the existing records.</p>
    </div>
    
    <div id="duplicateList">
      ${duplicates.map((l, i) => `
        <div class="card" data-idx="${i}" style="border-left: 3px solid var(--bad); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size:14px; font-weight:600; margin-bottom:4px;">${esc(l.mobile)}</div>
            <div style="font-size:13px; color:var(--muted);">New SO: ${esc(l.so_name)}</div>
          </div>
          <div>
            <input type="checkbox" class="accept-cb" style="width:24px; height:24px; cursor:pointer;" checked>
            <label style="display:inline; margin-left:4px; vertical-align:top; font-size:13px;">Accept</label>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <button class="btn" id="confirmSfUpload">Confirm & Upload</button>
      <div id="sfReviewMsg"></div>
    </div>
  </div></div>`);

  document.body.appendChild(sheet);
  const close = () => { sheet.remove(); sfValid = []; sfDuplicates = []; document.getElementById('sfFile').value = ''; document.getElementById('sfMsg').style.display = 'none'; };
  sheet.querySelector('#x').onclick = close;

  sheet.querySelector('#confirmSfUpload').onclick = async (e) => {
    const accepted = [];
    sheet.querySelectorAll('#duplicateList .card').forEach(card => {
      const idx = card.dataset.idx;
      const cb = card.querySelector('.accept-cb');
      if (cb.checked) {
        accepted.push(sfDuplicates[idx]);
      }
    });

    const totalToUpload = [...sfValid, ...accepted];
    if (!totalToUpload.length) {
      const msgEl = sheet.querySelector('#sfReviewMsg');
      if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = 'No records selected for upload.'; }
      return;
    }

    e.target.disabled = true;
    e.target.textContent = 'Uploading...';
    try {
      const res = await api('/salesforce-upload', 'POST', totalToUpload);
      close();
      say(`Successfully imported/updated ${res.processed} Salesforce records!`, 'ok');
    } catch (err) {
      const m = sheet.querySelector('#sfReviewMsg');
      if (m) { m.className = 'msg err'; m.textContent = err.message; }
      else alert(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Confirm & Upload';
    }
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
  const bulkBtn = isBulkAdmin ? `
    <div style="display:flex; justify-content: flex-end; margin-bottom: 16px;">
      <input type="file" id="bulkFile" accept=".xlsx, .xls" style="display:none">
      <button class="btn ghost" style="width:auto; margin:0; padding:8px 16px; font-size:13px;" onclick="document.getElementById('bulkFile').click()">Bulk Upload Leads</button>
    </div>
  ` : '';

  if (!leads.length) {
    const blank = { fresh: 'No fresh leads right now.', today: 'Nothing due today. Nice work.', all: 'No leads yet.' };
    view.innerHTML = kpi + bulkBtn + `<div class="empty">${blank[t]}</div>`;
  } else {
    view.innerHTML = kpi + bulkBtn + leads.map(l => `
      <button class="card lead" data-id="${l.id}">
        <div class="top"><b>${esc(l.customer_name)}</b>${dueLabel(l)}</div>
        <div class="meta">${esc(l.mobile)} · ${esc(l.branch || '—')}${l.location ? ' · ' + esc(l.location) : ''}</div>
        <div class="meta">${esc(l.source || 'No source')} · ${l.fcount ? 'F' + l.fcount + ' done — ' + esc(l.stage) : 'Not contacted'}${me.role !== 'sales' && l.officer ? ' · ' + esc(l.officer) : ''}</div>
      </button>`).join('');
  }

  view.querySelectorAll('.lead').forEach(b => b.onclick = () => openLead(b.dataset.id));
  
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
      for (const key of Object.keys(r)) {
        const k = key.toLowerCase().trim();
        const v = r[key];
        if (k.includes('branch')) branch = v;
        else if (k.includes('source')) source = v;
        else if (k.includes('mobile') || k.includes('phone') || k === 'uid' || k === 'contact') mobile = String(v).replace(/\D/g, '').slice(-10);
        else if (k.includes('customer') || k.includes('name')) customer_name = v;
        else if (k.includes('model')) model = v;
        else if (k.includes('activity')) activity = v;
        else if (k.includes('location')) location = v;
        else if (k.includes('remark')) remarks = v;
      }
      return { branch, source, mobile, customer_name, model, activity, location, remarks };
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

function showBulkReviewSheet(duplicates = 0) {
  const sheet = el(`<div class="sheet"><div>
    <div class="close"><button class="btn ghost" id="x">Cancel</button></div>
    <div class="card">
      <h2>Bulk Upload Review</h2>
      <p><b>${bulkValid.length}</b> leads are ready to import.</p>
      ${duplicates ? `<p style="color:var(--text-light)"><b>${duplicates}</b> duplicate leads were automatically skipped.</p>` : ''}
      ${bulkInvalid.length ? `<p style="color:var(--bad)"><b>${bulkInvalid.length}</b> leads have errors (typos or missing data). Please fix them below or they will be skipped.</p>` : ''}
    </div>
    
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
      <button class="btn" id="confirmBulk">Confirm & Auto-Assign</button>
      <div id="msg"></div>
    </div>
  </div></div>`);

  document.body.appendChild(sheet);
  const close = () => { sheet.remove(); bulkValid = []; bulkInvalid = []; };
  sheet.querySelector('#x').onclick = close;

  sheet.querySelector('#confirmBulk').onclick = async (e) => {
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
          activity_id: ac ? Number(ac) : null
        });
      }
    });

    const totalToAssign = [...bulkValid, ...fixed];
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
      else alert(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Confirm & Auto-Assign';
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
      <div id="orderWrap" class="hide">
        <label>Order ID <span class="req">*</span></label>
        <input id="orderId" placeholder="Enter order ID">
      </div>
      <div id="tallyWrap" class="hide">
        <label>Tally Receipt No. <span class="req">*</span></label>
        <input id="tallyNo" placeholder="Enter tally receipt number">
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
        <input id="oscName" class="hide" style="margin-top:8px" placeholder="Enter the SO's name">
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

  const NO_DATE   = new Set(['Booking Done', 'Retail Done', 'Not Interested', 'Lost to Competition', 'Finance Rejected', 'Dropped', 'Lost to co-dealer']);
  const OUT_COLOR = { 'Lost to Competition': 'red', 'Finance Rejected': 'red', 'Dropped': 'red', 'Lost to co-dealer': 'red', 'Not Interested': 'red', 'Booking Done': 'green', 'Retail Done': 'green', 'Need time': 'blue' };
  let call = '', outcome = '';

  const pick = (wrap, onPick) => {
    wrap.querySelectorAll('button').forEach(b =>
      b.onclick = () => {
        wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        onPick(b.dataset.v);
      });
  };

  const oscSelect = sheet.querySelector('#osc');
  const oscName = sheet.querySelector('#oscName');
  if (oscSelect && oscName) {
    oscSelect.onchange = () => {
      const isYes = oscSelect.value === 'Yes';
      oscName.classList.toggle('hide', !isYes);
      if (isYes && !oscName.value && l.salesforce_history && l.salesforce_history.length > 0) {
        oscName.value = l.salesforce_history[0].so_name;
      }
    };
  }

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
    pick(out, (o) => {
      outcome = o;
      const skipDate = NO_DATE.has(o);
      sheet.querySelector('#dateWrap').classList.toggle('hide', skipDate);
      sheet.querySelector('#orderWrap').classList.toggle('hide', o !== 'Booking Done');
      sheet.querySelector('#tallyWrap').classList.toggle('hide', o !== 'Retail Done');
    });
  });

  sheet.querySelector('#submit').onclick = async (e) => {
    if (!call)    return say('Select Connected or Not Connected');
    if (!outcome) return say('Select an outcome');
    const skipDate = NO_DATE.has(outcome);
    const nd = sheet.querySelector('#nd').value;
    if (!skipDate && !nd) return say('Next follow-up date is required');
    if (outcome === 'Booking Done' && !sheet.querySelector('#orderId').value.trim()) return say('Order ID is required');
    if (outcome === 'Retail Done'  && !sheet.querySelector('#tallyNo').value.trim())  return say('Tally Receipt No. is required');

    let oscValue = '';
    if (call === 'Connected') {
      const oscSel = sheet.querySelector('#osc').value;
      if (oscSel === 'Yes') {
        oscValue = sheet.querySelector('#oscName').value.trim();
        if (!oscValue) return say("Please enter the name of the SO who called.");
      } else {
        oscValue = oscSel;
      }
    }

    e.target.disabled = true;
    try {
      await api(`/leads/${l.id}/followup`, 'POST', {
        call_status: call, outcome,
        next_date:     skipDate ? null : nd,
        order_id:      outcome === 'Booking Done' ? sheet.querySelector('#orderId').value.trim() : undefined,
        tally_receipt: outcome === 'Retail Done'  ? sheet.querySelector('#tallyNo').value.trim()  : undefined,
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
