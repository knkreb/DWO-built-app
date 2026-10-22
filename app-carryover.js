// app-carryover.js — Carryover ledger (v5.13, slice 4)
// Spec: docs/specs/customer-thresholds-and-carryover.md section 3. DB: supabase/migrations/v5.13_carryover.sql
// A carryover entry is money deliberately left off a job so it can be billed on other work orders later
// (e.g. P26500 priced $2,500, quoted $2,000: $500 carried over). Kevin records applications against open work orders
// (e.g. $250 applied to P26505) and the balance goes down. THE APP NEVER CHANGES A WORK ORDER'S HOURS OR PARTS:
// Kevin adjusts the work order himself; this is the ledger and the written reference (every change is audited).
// Admin only. The entry belongs to the "owner" customer (the parent, or the customer itself), so any site under
// the same parent can absorb it. Applications go on open T&M work orders (active or completed, not quoted);
// quoted work orders and committed_pending come in a later slice. Balance and status are kept by the database.
// v5.14: applications can be edited (amount, note, work order) and removed from the work order block as well as the ledger.
// Uses wonIsAdmin, wonMoney, wonIsTM, wonOwnerId, wonOpenTMForOwner from app-wo-nte.js (loaded before this file).

var CO = { owner: null, entries: [], allocs: [], busy: false, token: 0, form: null };
var CO_COL = '#0f766e';

function coAdmin() { return AppState.userRole === 'admin'; }
function coOwnerOf(custId) {
  var c = (AppState.customers || []).find(function(x) { return x.id === custId; });
  return c ? (c.parent_customer_id || c.id) : null;
}
function coOwnerName(id) {
  var c = (AppState.customers || []).find(function(x) { return x.id === id; });
  return c ? getCustName(c) : '';
}
function coWoById(id) { return (AppState.workOrders || []).find(function(w) { return w.id === id; }) || null; }
// Work order number for an application: from the loaded work orders, else the second half of its saved "A > B" label.
function coWoNum(id, label) {
  var w = coWoById(id); if (w) return w.wo_number;
  var p = String(label || '').split(' > ');
  return p.length > 1 ? p[1] : '';
}
function coWho(e) { return String(e || '').split('@')[0]; }
function coErr(r, fallback) { return (r && r.data && r.data.message) ? r.data.message : fallback; }
function coAmt(id) {
  var v = parseFloat((document.getElementById(id) || {}).value);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
}
function coBtn(label, col, fn) {
  return '<button style="font-size:11px;padding:3px 8px;border:1px solid ' + col + ';border-radius:3px;background:none;color:' + col + ';cursor:pointer;white-space:nowrap" onclick="' + fn + '">' + label + '</button>';
}
function coOpenSum() {
  var t = 0; CO.entries.forEach(function(e) { var b = parseFloat(e.balance) || 0; if (b > 0) t += b; });
  return Math.round(t * 100) / 100;
}

// One load for the whole owner group: entries with balances, and every active application on them.
function coLoad(owner) {
  return sb.get('carryover_balance', '?customer_id=eq.' + owner + '&order=created_at.asc').then(function(r) {
    if (!r.ok) return { ok: false, entries: [], allocs: [] };
    var entries = r.data || [];
    if (!entries.length) return { ok: true, entries: entries, allocs: [] };
    var ids = entries.map(function(e) { return e.id; }).join(',');
    return sb.get('carryover_allocations', '?carryover_id=in.(' + ids + ')&active=eq.true&order=created_at.asc').then(function(a) {
      return { ok: !!a.ok, entries: entries, allocs: (a.ok && a.data) || [] };
    });
  });
}
// After any change: reload the group, redraw the ledger sheet if it is open and the work order block if one is showing.
function coReloadAll() {
  var owner = CO.owner; if (!owner) return Promise.resolve();
  return coLoad(owner).then(function(res) {
    if (CO.owner !== owner || !res.ok) return;
    CO.entries = res.entries; CO.allocs = res.allocs;
    var sh = document.getElementById('co-sheet');
    if (sh && sh.classList.contains('open')) coSheetRender();
    var wo = AppState.currentWO, box = document.getElementById('co-block');
    if (wo && box) coDraw(box, wo);
  });
}

// ── Customers screen button ──────────────────────────────────────────────
function coRowButton(c) {
  if (!coAdmin()) return '';
  return ' <button style="font-size:11px;padding:3px 8px;border:1px solid ' + CO_COL + ';border-radius:3px;background:none;color:' + CO_COL + ';cursor:pointer" data-coid="' + c.id + '" onclick="openCarryover(this.getAttribute(\'data-coid\'))">Carryover</button>';
}

// ── Ledger sheet (admin) ─────────────────────────────────────────────────
function coEnsureSheet() {
  var el = document.getElementById('co-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'co-sheet';
  el.style.alignItems = 'flex-start';
  el.onclick = function(e) { if (e.target === el) closeCarryover(); };
  el.innerHTML = '<div class="bottom-sheet" style="max-width:720px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="co-title">Carryover</h3><button class="sheet-close" onclick="closeCarryover()">✕</button></div><div id="co-body" style="padding:14px 16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function closeCarryover() { var el = document.getElementById('co-sheet'); if (el) el.classList.remove('open'); }

function openCarryover(custId) {
  if (!coAdmin()) { showToast('Admin only'); return; }
  var owner = coOwnerOf(custId); if (!owner) return;
  CO.owner = owner; CO.entries = []; CO.allocs = [];
  coEnsureSheet().classList.add('open');
  document.getElementById('co-title').textContent = 'Carryover · ' + coOwnerName(owner);
  document.getElementById('co-body').innerHTML = '<div style="color:var(--text-muted);font-size:13px">Loading…</div>';
  coLoad(owner).then(function(res) {
    if (CO.owner !== owner) return;
    if (!res.ok) { document.getElementById('co-body').innerHTML = '<div style="color:var(--danger);font-size:13px">Could not load carryover. Has the v5.13 migration been run?</div>'; return; }
    CO.entries = res.entries; CO.allocs = res.allocs;
    coSheetRender();
  });
}

function coSheetRender() {
  var body = document.getElementById('co-body'); if (!body) return;
  var open = CO.entries.filter(function(e) { return (parseFloat(e.balance) || 0) > 0; });
  var done = CO.entries.filter(function(e) { return (parseFloat(e.balance) || 0) <= 0; });
  var h = '<div style="font-size:13px;margin-bottom:10px"><b style="color:' + CO_COL + '">' + coMoneyS(coOpenSum()) + '</b> outstanding'
    + ' <span style="font-size:11px;color:var(--text-muted)">· shared by every account under ' + escHtml(coOwnerName(CO.owner)) + '. Add carryover from the job it was left off; record applications here or on the work order. This never changes a work order.</span></div>';
  if (!CO.entries.length) {
    h += '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No carryover yet.</div>';
  }
  open.concat(done).forEach(function(e) { h += coEntryHtml(e); });
  body.innerHTML = h;
}
function coMoneyS(n) { return wonMoney(n); }

function coAllocLine(a, withRemove) {
  var num = coWoNum(a.work_order_id, a.label);
  return '<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;border-top:1px dashed var(--border)">'
    + '<span style="flex:1;min-width:0">Applied to <a href="#" style="color:var(--header-bg);font-weight:600" onclick="coOpenWO(\'' + a.work_order_id + '\');return false">' + escHtml(num || 'work order') + '</a>'
    + ' <b>' + wonMoney(a.amount) + '</b> <span style="color:var(--text-muted)">· ' + escHtml(fmtDate(a.created_at)) + ' · ' + escHtml(coWho(a.created_by)) + (a.note ? ' · ' + escHtml(a.note) : '') + '</span></span>'
    + (withRemove ? coBtn('Edit', 'var(--text-muted)', 'coOpenForm(\'editapp\',\'' + a.id + '\')') + ' ' + coBtn('Remove', 'var(--danger)', 'coRemoveAlloc(\'' + a.id + '\')') : '') + '</div>';
}

function coEntryHtml(e) {
  var bal = parseFloat(e.balance) || 0, isOpen = bal > 0.004;
  var allocs = CO.allocs.filter(function(a) { return a.carryover_id === e.id; });
  var stMap = { outstanding: ['Outstanding', '#b45309'], committed_pending: ['Committed pending', '#6d3fa8'], resolved: ['Resolved', '#27ae60'] };
  var st = stMap[e.status] || [e.status, 'var(--text-muted)'];
  var ow = coWoById(e.origin_work_order_id);
  var h = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:10px' + (isOpen ? '' : ';opacity:.8') + '">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:13px;font-weight:700">From <a href="#" style="color:var(--header-bg)" onclick="coOpenWO(\'' + e.origin_work_order_id + '\');return false">' + escHtml(e.label || (ow && ow.wo_number) || 'work order') + '</a></span>'
    + (ow && ow.title ? '<span style="font-size:12px;color:var(--text-muted);flex:1;min-width:0">' + escHtml(ow.title) + '</span>' : '<span style="flex:1"></span>')
    + '<span style="font-size:10px;font-weight:700;color:' + st[1] + ';border:1px solid ' + st[1] + ';border-radius:3px;padding:1px 6px">' + st[0] + '</span></div>'
    + '<div style="font-size:13px;margin-top:4px">' + wonMoney(e.amount) + ' carried over · ' + wonMoney(e.applied) + ' applied · <b style="color:' + (isOpen ? CO_COL : 'var(--text-muted)') + '">' + wonMoney(bal) + ' left</b></div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Added ' + escHtml(fmtDate(e.created_at)) + ' by ' + escHtml(coWho(e.created_by)) + (e.note ? ' · ' + escHtml(e.note) : '') + '</div>';
  allocs.forEach(function(a) { h += coAllocLine(a, true); });
  h += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
    + (isOpen ? coBtn('Record application', CO_COL, 'coOpenForm(\'apply\',\'' + e.id + '\')') : '')
    + coBtn('Edit', 'var(--text-muted)', 'coOpenForm(\'edit\',\'' + e.id + '\')')
    + (allocs.length ? '' : coBtn('Remove', 'var(--danger)', 'coRemoveEntry(\'' + e.id + '\')'))
    + '</div></div>';
  return h;
}

function coOpenWO(id) { closeCarryover(); if (typeof openWODetail === 'function') openWODetail(id); }

// ── Forms: add carryover (from a work order), edit, record application ───
function coEnsureFormSheet() {
  var el = document.getElementById('co-form-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'co-form-sheet';
  el.style.alignItems = 'flex-start';
  el.style.zIndex = '10000'; // above the ledger sheet when opened from it
  // No click-outside close: a stray click should not dismiss a half-filled form.
  el.innerHTML = '<div class="bottom-sheet" style="max-width:560px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="cof-title">Carryover</h3><button class="sheet-close" onclick="coFormClose()">✕</button></div><div id="cof-body" style="padding:14px 16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function coFormClose() { var el = document.getElementById('co-form-sheet'); if (el) el.classList.remove('open'); CO.form = null; }
function coFormErr(msg) { var el = document.getElementById('cof-err'); if (el) el.textContent = msg || ''; }
function coEntry(id) { return CO.entries.find(function(e) { return e.id === id; }) || null; }

var CO_IN = 'width:100%;box-sizing:border-box;font-size:13px;padding:6px 8px';
function coField(label, html) { return '<div style="margin-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:3px">' + label + '</div>' + html + '</div>'; }

// mode: 'add' (entryId unused, woId = the job it was left off), 'edit' (entryId), 'apply' (entryId optional, woId optional preselect)
function coOpenForm(mode, entryId, woId) {
  if (!coAdmin()) return;
  var wo = AppState.currentWO;
  if (mode === 'add') {
    if (!wo) return;
    CO.owner = coOwnerOf(wo.customer_id);
    if (!CO.owner) { showToast('This work order has no customer'); return; }
    woId = wo.id;
  }
  CO.form = { mode: mode, entryId: entryId || null, woId: woId || null };
  coEnsureFormSheet().classList.add('open');
  var title, h = '';
  if (mode === 'add') {
    title = 'Add carryover · ' + wo.wo_number;
    h += '<div style="font-size:12px;color:var(--text-muted)">Money left off this job so it can be billed on other work orders for <b>' + escHtml(coOwnerName(CO.owner)) + '</b>. This does not change this work order.</div>'
      + coField('Amount carried over ($)', '<input type="number" min="0" step="0.01" id="cof-amt" style="' + CO_IN + '">')
      + coField('Note (optional)', '<input type="text" id="cof-note" placeholder="e.g. priced $2,500, quoted $2,000" style="' + CO_IN + '">');
  } else if (mode === 'edit') {
    var e = coEntry(entryId); if (!e) { coFormClose(); return; }
    title = 'Edit carryover · ' + (e.label || '');
    h += '<div style="font-size:12px;color:var(--text-muted)">' + wonMoney(e.applied) + ' is already applied, so the amount cannot go below that.</div>'
      + coField('Amount carried over ($)', '<input type="number" min="0" step="0.01" id="cof-amt" value="' + escHtml(String(e.amount)) + '" style="' + CO_IN + '">')
      + coField('Note (optional)', '<input type="text" id="cof-note" value="' + escHtml(e.note || '') + '" style="' + CO_IN + '">');
  } else if (mode === 'editapp') {
    var ap = CO.allocs.find(function(x) { return x.id === entryId; }), src = ap ? coEntry(ap.carryover_id) : null;
    if (!ap || !src) { coFormClose(); showToast('That application is no longer there'); return; }
    var maxAmt = Math.round(((parseFloat(src.balance) || 0) + (parseFloat(ap.amount) || 0)) * 100) / 100;
    var ewos = wonOpenTMForOwner(CO.owner).slice();
    if (!ewos.some(function(w) { return w.id === ap.work_order_id; })) { var cur = coWoById(ap.work_order_id); if (cur) ewos.push(cur); } // keep the current work order even if it is no longer open
    ewos.sort(function(a, b) { return String(a.wo_number).localeCompare(String(b.wo_number), undefined, { numeric: true }); });
    title = 'Edit application · ' + (src.label || '');
    h += '<div style="font-size:12px;color:var(--text-muted)">From <b>' + escHtml(src.label || '') + '</b>. Up to <b>' + wonMoney(maxAmt) + '</b> can go on this application (what is left plus what it holds now). Changing it does not change any work order; adjust the work order itself as needed.</div>'
      + coField('Applied to work order', '<select id="cof-wo" style="' + CO_IN + '">' + ewos.map(function(w) {
          return '<option value="' + w.id + '"' + (w.id === ap.work_order_id ? ' selected' : '') + '>' + escHtml(w.wo_number + ' — ' + (w.title || '') + ' (' + (getStatus(w.status).name || '') + ')') + '</option>';
        }).join('') + '</select>')
      + coField('Amount applied ($)', '<input type="number" min="0" step="0.01" id="cof-amt" value="' + escHtml(String(ap.amount)) + '" style="' + CO_IN + '">')
      + coField('Note (optional)', '<input type="text" id="cof-note" value="' + escHtml(ap.note || '') + '" style="' + CO_IN + '">');
  } else {
    var avail = CO.entries.filter(function(x) { return (parseFloat(x.balance) || 0) > 0; });
    if (entryId) avail = avail.filter(function(x) { return x.id === entryId; });
    if (!avail.length) { coFormClose(); showToast('No carryover balance to apply'); return; }
    var wos = wonOpenTMForOwner(CO.owner).slice().sort(function(a, b) { return String(a.wo_number).localeCompare(String(b.wo_number), undefined, { numeric: true }); });
    if (!wos.length) { coFormClose(); showToast('No open T&M work orders for this customer'); return; }
    title = 'Record application';
    h += '<div style="font-size:12px;color:var(--text-muted)">Record that you added this amount to a work order. Adjust the work order itself first or after; this only keeps the ledger and the reference.</div>'
      + coField('Carryover', '<select id="cof-entry" onchange="coFormEntryChange()" style="' + CO_IN + '">' + avail.map(function(x, i) {
          return '<option value="' + x.id + '"' + (i === 0 ? ' selected' : '') + '>From ' + escHtml(x.label || '') + ' · ' + wonMoney(x.balance) + ' left</option>';
        }).join('') + '</select>')
      + coField('Applied to work order', '<select id="cof-wo" style="' + CO_IN + '">' + wos.map(function(w) {
          return '<option value="' + w.id + '"' + (w.id === woId ? ' selected' : '') + '>' + escHtml(w.wo_number + ' — ' + (w.title || '') + ' (' + (getStatus(w.status).name || '') + ')') + '</option>';
        }).join('') + '</select>')
      + coField('Amount applied ($) <span id="cof-left" style="font-weight:400;color:var(--text-muted)"></span>', '<input type="number" min="0" step="0.01" id="cof-amt" style="' + CO_IN + '">')
      + coField('Note (optional)', '<input type="text" id="cof-note" placeholder="e.g. added as additional service time" style="' + CO_IN + '">');
  }
  h += '<div id="cof-err" style="color:var(--danger);font-size:12px;font-weight:600;min-height:16px;margin-top:12px"></div>'
    + '<button class="save-btn" id="cof-save" style="margin-top:4px" onclick="coFormSave()">Save</button>';
  document.getElementById('cof-title').textContent = title;
  document.getElementById('cof-body').innerHTML = h;
  if (mode === 'apply') coFormEntryChange();
}
function coFormEntryChange() {
  var sel = document.getElementById('cof-entry'), el = document.getElementById('cof-left'); if (!sel || !el) return;
  var e = coEntry(sel.value);
  el.textContent = e ? '· up to ' + wonMoney(e.balance) : '';
}

function coFormSave() {
  var f = CO.form; if (!f || CO.busy || !coAdmin()) return;
  coFormErr('');
  var amt = coAmt('cof-amt'), note = ((document.getElementById('cof-note') || {}).value || '').trim() || null;
  if (!(amt > 0)) { coFormErr('Enter an amount above zero'); return; }
  var me = AppState.userEmail, req;
  if (f.mode === 'add') {
    var wo = AppState.currentWO; if (!wo) return;
    req = sb.post('carryover', { customer_id: CO.owner, origin_work_order_id: wo.id, label: wo.wo_number, amount: amt, note: note, created_by: me, modified_by: me });
  } else if (f.mode === 'edit') {
    req = sb.patch('carryover', f.entryId, { amount: amt, note: note, modified_by: me });
  } else if (f.mode === 'editapp') {
    var ap = CO.allocs.find(function(x) { return x.id === f.entryId; }), src = ap ? coEntry(ap.carryover_id) : null, newWo = (document.getElementById('cof-wo') || {}).value;
    if (!ap || !src || !newWo) { coFormErr('That application is no longer there'); return; }
    var maxAmt = Math.round(((parseFloat(src.balance) || 0) + (parseFloat(ap.amount) || 0)) * 100) / 100;
    if (amt > maxAmt + 0.004) { coFormErr('That is more than the ' + wonMoney(maxAmt) + ' available on this carryover'); return; }
    var tgt = coWoById(newWo);
    req = sb.patch('carryover_allocations', f.entryId, { work_order_id: newWo, amount: amt, note: note, label: (src.label || '') + ' > ' + (tgt ? tgt.wo_number : ''), modified_by: me });
  } else {
    var e = coEntry((document.getElementById('cof-entry') || {}).value), woId = (document.getElementById('cof-wo') || {}).value;
    if (!e || !woId) { coFormErr('Choose the carryover and the work order'); return; }
    if (amt > (parseFloat(e.balance) || 0) + 0.004) { coFormErr('That is more than the ' + wonMoney(e.balance) + ' left on this carryover'); return; }
    var target = coWoById(woId);
    req = sb.post('carryover_allocations', { carryover_id: e.id, work_order_id: woId, label: (e.label || '') + ' > ' + (target ? target.wo_number : ''), amount: amt, note: note, status: 'resolved', created_by: me, modified_by: me });
  }
  CO.busy = true; var b = document.getElementById('cof-save'); if (b) b.disabled = true; // ignore a second tap while saving
  req.then(function(r) {
    CO.busy = false; if (b) b.disabled = false;
    if (!r.ok) { coFormErr(coErr(r, 'Error saving. Nothing was changed.')); return; }
    coFormClose();
    showToast(f.mode === 'apply' ? 'Application recorded' : f.mode === 'editapp' ? 'Application updated' : f.mode === 'edit' ? 'Carryover updated' : 'Carryover added');
    coReloadAll();
  });
}

function coRemoveAlloc(id) {
  if (!coAdmin() || CO.busy) return;
  var a = CO.allocs.find(function(x) { return x.id === id; }); if (!a) return;
  if (!confirm('Remove this application of ' + wonMoney(a.amount) + ' to ' + (coWoNum(a.work_order_id, a.label) || 'the work order') + '? The amount goes back on the carryover balance. The work order itself is not changed.')) return;
  CO.busy = true;
  sb.patch('carryover_allocations', id, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    CO.busy = false;
    if (!r.ok) { showToast(coErr(r, 'Error removing the application')); return; }
    showToast('Application removed'); coReloadAll();
  });
}
function coRemoveEntry(id) {
  if (!coAdmin() || CO.busy) return;
  var e = coEntry(id); if (!e) return;
  if (!confirm('Remove the ' + wonMoney(e.amount) + ' carryover from ' + (e.label || 'this job') + '? Every change is kept in the audit log.')) return;
  CO.busy = true;
  sb.patch('carryover', id, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    CO.busy = false;
    if (!r.ok) { showToast(coErr(r, 'Error removing the carryover')); return; }
    showToast('Carryover removed'); coReloadAll();
  });
}

// ── Work order screen (admin): balance prompt, add, record, references ────
function coShell(wo) {
  if (!coAdmin()) return '';
  setTimeout(function() { coRefresh(wo.id); }, 0);
  return '<div id="co-block"></div>';
}

function coRefresh(woId) {
  var wo = AppState.currentWO; if (!wo || wo.id !== woId) return;
  var owner = wonOwnerId(wo);
  var box0 = document.getElementById('co-block'); if (!box0) return;
  if (!owner) { box0.innerHTML = ''; return; }
  var tok = ++CO.token;
  coLoad(owner).then(function(res) {
    if (tok !== CO.token) return;
    var box = document.getElementById('co-block'); if (!box) return;
    var cur = AppState.currentWO; if (!cur || cur.id !== woId) return;
    if (!res.ok) { box.innerHTML = ''; return; } // migration missing or offline: stay quiet
    CO.owner = owner; CO.entries = res.entries; CO.allocs = res.allocs;
    coDraw(box, cur);
  });
}

function coDraw(box, wo) {
  var bal = coOpenSum();
  var here = CO.entries.filter(function(e) { return e.origin_work_order_id === wo.id; });
  var applied = CO.allocs.filter(function(a) { return a.work_order_id === wo.id; });
  var cat = statusCat(wo.status);
  var canApply = wonIsTM(wo) && (cat === 'active' || cat === 'completed') && bal > 0;
  var owner = escHtml(coOwnerName(CO.owner));
  if (!CO.entries.length) {
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius);padding:6px 10px;margin-bottom:10px">'
      + '<span style="flex:1">No carryover for ' + owner + '</span>' + coBtn('Add carryover', CO_COL, 'coOpenForm(\'add\')') + '</div>';
    return;
  }
  var h = '<div style="border:1px solid ' + CO_COL + ';background:' + CO_COL + '10;border-radius:var(--radius);padding:8px 12px;margin-bottom:10px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:12px;font-weight:700;color:' + CO_COL + '">Carryover</span>'
    + '<span style="font-size:12px;color:var(--text-secondary);flex:1">' + (bal > 0 ? '<b>' + wonMoney(bal) + '</b> outstanding for ' + owner : 'All applied for ' + owner) + '</span>'
    + (canApply ? coBtn('Record application', CO_COL, 'coOpenForm(\'apply\',null,\'' + wo.id + '\')') : '')
    + coBtn('Add carryover', CO_COL, 'coOpenForm(\'add\')')
    + coBtn('Ledger', 'var(--text-muted)', 'openCarryover(\'' + wo.customer_id + '\')') + '</div>';
  here.forEach(function(e) {
    h += '<div style="font-size:12px;margin-top:5px">Carried over from this job: <b>' + wonMoney(e.amount) + '</b> <span style="color:var(--text-muted)">(' + wonMoney(e.balance) + ' left)</span></div>';
  });
  applied.forEach(function(a) {
    var src = CO.entries.find(function(e) { return e.id === a.carryover_id; });
    h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;margin-top:5px"><span style="flex:1;min-width:0"><b>' + wonMoney(a.amount) + '</b> carryover applied to this job from ' + escHtml(src ? src.label || '' : '') + ' <span style="color:var(--text-muted)">· ' + escHtml(fmtDate(a.created_at)) + ' · ' + escHtml(coWho(a.created_by)) + (a.note ? ' · ' + escHtml(a.note) : '') + '</span></span>'
      + coBtn('Edit', CO_COL, 'coOpenForm(\'editapp\',\'' + a.id + '\')') + coBtn('Remove', 'var(--danger)', 'coRemoveAlloc(\'' + a.id + '\')') + '</div>';
  });
  box.innerHTML = h + '</div>';
}
