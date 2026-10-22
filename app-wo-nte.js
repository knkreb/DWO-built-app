// app-wo-nte.js — Work order NTE (not to exceed): block on the work order, editor, reset to customer default,
// v5.11: apply-to-open-work-orders picker, prompt after a customer NTE save, dashboard dispatch-row badge,
// "apply to open work orders" from the customer Limits sheet, and the Daily Dashboard NTE card (v5.10, slice 2)
// Spec: docs/specs/customer-thresholds-and-carryover.md section 1. DB: supabase/migrations/v5.10_work_order_nte.sql
// The customer default is COPIED to each T&M work order when it is created (database trigger) and never
// follows the customer afterwards. Admin edits the cap; everyone sees the indicator. Spend, levels and the
// alerts are computed in the database (view wo_nte_status) so every entry path counts the same way.
// Uses helpers from app-customer-limits.js (clLevelHtml, clReadLevels, clValidateLevels, clSectionHead ...).

var WON = { woId: null, row: null, levels: {}, token: 0 };

function wonIsAdmin() { return AppState.userRole === 'admin'; }
function wonMoney(n) { return '$' + (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function wonIsTM(wo) { return wo && wo.form_mode !== 'quoted'; }
function wonOwnerId(wo) {
  var c = (AppState.customers || []).find(function(x) { return x.id === wo.customer_id; });
  return c ? (c.parent_customer_id || c.id) : null;
}
function wonLevelCols(src) {
  var o = {};
  ['nte_amount', 'nte_l1_enabled', 'nte_l1_type', 'nte_l1_direction', 'nte_l1_value', 'nte_l2_enabled', 'nte_l2_type', 'nte_l2_direction', 'nte_l2_value'].forEach(function(k) { o[k] = src[k]; });
  return o;
}

// ── Work order screen ────────────────────────────────────────────────────
// Called from renderWODetail: returns the shell; the content loads right after the screen is drawn.
function woNteShell(wo) {
  if (!wonIsTM(wo)) return '';
  setTimeout(function() { woNteRefresh(wo.id); }, 0);
  return '<div id="won-block"></div>';
}

function woNteRefresh(woId) {
  var tok = ++WON.token;
  Promise.all([
    sb.get('work_order_limits', '?work_order_id=eq.' + woId + '&active=eq.true'),
    sb.get('wo_nte_status', '?work_order_id=eq.' + woId)
  ]).then(function(res) {
    if (tok !== WON.token) return;
    var box = document.getElementById('won-block'); if (!box) return;
    var wo = AppState.currentWO; if (!wo || wo.id !== woId) return;
    if (!res[0].ok || !res[1].ok) { box.innerHTML = ''; return; } // migration missing or offline: stay quiet
    WON.woId = woId;
    WON.row = (res[0].data && res[0].data[0]) || null;
    var st = (res[1].data && res[1].data[0]) || null;
    woNteDraw(box, wo, WON.row, st);
    // Toast when a work order moves up a level while it is open
    var prev = WON.levels[woId], lvl = st ? st.level : 0;
    if (prev !== undefined && lvl > prev && typeof showToast === 'function') {
      showToast(lvl >= 2 ? 'NTE limit reached on ' + wo.wo_number : 'NTE warning on ' + wo.wo_number + ': ' + Math.round(st.pct_used) + '% used');
    }
    WON.levels[woId] = lvl;
  });
}

function woNteDraw(box, wo, row, st) {
  var admin = wonIsAdmin();
  if (!row || !row.nte_enabled || !st) {
    if (!admin) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius);padding:6px 10px;margin-bottom:10px">'
      + '<span style="flex:1">' + (row && !row.nte_enabled ? 'NTE is off for this work order.' : 'No NTE on this work order.') + '</span>'
      + '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--header-bg);border-radius:3px;background:none;color:var(--header-bg);cursor:pointer" onclick="openWoNte()">' + (row ? 'Edit NTE' : 'Set NTE') + '</button></div>';
    return;
  }
  var col = st.level >= 2 ? '#c0392b' : st.level === 1 ? '#e67e22' : '#27ae60';
  var pct = Math.max(0, Math.min(100, st.pct_used));
  var rem = parseFloat(st.remaining);
  var msg = st.level >= 2 ? (rem < 0 ? 'Over the NTE by ' + wonMoney(-rem) : 'NTE limit reached') : st.level === 1 ? 'Approaching the NTE' : 'Within the NTE';
  var h = '<div style="border:1px solid ' + col + ';background:' + col + '14;border-radius:var(--radius);padding:8px 12px;margin-bottom:10px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:12px;font-weight:700;color:' + col + '">NTE ' + wonMoney(st.nte_amount) + '</span>'
    + '<span style="font-size:12px;color:var(--text-secondary);flex:1">' + wonMoney(st.spent) + ' spent (' + Math.round(st.pct_used) + '%) · ' + (rem >= 0 ? wonMoney(rem) + ' remaining' : msg) + '</span>';
  if (admin) {
    h += '<span style="font-size:10px;color:var(--text-muted)">' + (st.source === 'manual' ? 'set on this work order' : 'from customer default') + '</span>'
      + '<button style="font-size:11px;padding:3px 8px;border:1px solid ' + col + ';border-radius:3px;background:none;color:' + col + ';cursor:pointer" onclick="openWoNte()">Edit</button>'
      + '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:3px;background:none;color:var(--text-muted);cursor:pointer" onclick="woNteReset()">Reset to default</button>';
  }
  h += '</div>'
    + '<div style="height:5px;background:var(--border);border-radius:3px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + col + '"></div></div>'
    + (st.level >= 1 ? '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-top:5px">' + msg + '</div>' : '')
    + '</div>';
  box.innerHTML = h;
}

// ── Editor sheet (admin) ─────────────────────────────────────────────────
function wonEnsureSheet() {
  var el = document.getElementById('won-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'won-sheet';
  el.style.alignItems = 'flex-start';
  el.onclick = function(e) { if (e.target === el) closeWoNte(); };
  el.innerHTML = '<div class="bottom-sheet" style="max-width:620px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="won-title">NTE</h3><button class="sheet-close" onclick="closeWoNte()">✕</button></div><div id="won-body" style="padding:14px 16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function closeWoNte() { var el = document.getElementById('won-sheet'); if (el) el.classList.remove('open'); }
function wonErr(msg) { var el = document.getElementById('won-err'); if (el) el.textContent = msg || ''; }

function openWoNte() {
  if (!wonIsAdmin()) return;
  var wo = AppState.currentWO; if (!wo) return;
  var r = WON.row;
  wonEnsureSheet().classList.add('open');
  document.getElementById('won-title').textContent = 'NTE · ' + wo.wo_number;
  var on = r ? r.nte_enabled : true;
  var h = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px">'
    + clSectionHead('won-nte-en', on, 'NTE (not to exceed)')
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Applies to this work order only. Warnings go to the work order screen and the office alerts.</div>'
    + clAmountRow('Limit $', 'won-nte-amt', r && r.nte_amount ? r.nte_amount : '')
    + clLevelHtml('nte', 1, r || {}, 'won-') + clLevelHtml('nte', 2, r || {}, 'won-')
    + '</div>'
    + '<div id="won-err" style="color:var(--danger);font-size:12px;font-weight:600;min-height:16px;margin-top:12px"></div>'
    + '<button class="save-btn" style="margin-top:4px" onclick="woNteSave()">Save</button>';
  document.getElementById('won-body').innerHTML = h;
}

function woNteSave() {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin()) return;
  wonErr('');
  var o = { nte_enabled: clChk('won-nte-en'), nte_amount: clNum('won-nte-amt') };
  Object.assign(o, clReadLevels('nte', 'won-'));
  if (o.nte_enabled && !(o.nte_amount > 0)) { wonErr('Enter the NTE limit amount'); return; }
  var lv = clValidateLevels(o, 'nte'); if (lv) { wonErr(lv); return; }
  if (!o.nte_enabled && !(o.nte_amount > 0)) o.nte_amount = null;
  var body = Object.assign({}, o, { source: 'manual', label: wo.wo_number, modified_by: AppState.userEmail });
  var req = WON.row
    ? sb.patch('work_order_limits', WON.row.id, body)
    : sb.post('work_order_limits', Object.assign({ work_order_id: wo.id, created_by: AppState.userEmail }, body));
  req.then(function(r) {
    if (!r.ok) { wonErr('Error saving the NTE. Nothing was changed.'); return; }
    closeWoNte(); showToast('NTE saved'); woNteRefresh(wo.id);
  });
}

// ── Reset to the customer default ────────────────────────────────────────
function woNteReset() {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin()) return;
  var owner = wonOwnerId(wo);
  if (!owner) { showToast('This work order has no customer'); return; }
  sb.get('customer_thresholds', '?customer_id=eq.' + owner + '&active=eq.true').then(function(r) {
    var t = r.ok && r.data && r.data[0];
    if (!t || !t.nte_enabled || !(t.nte_amount > 0)) { showToast('The customer has no NTE default to reset to'); return; }
    if (!confirm('Reset this work order to the customer default of ' + wonMoney(t.nte_amount) + '? Your changes on this work order will be replaced.')) return;
    var body = Object.assign(wonLevelCols(t), { nte_enabled: true, source: 'customer_default', label: wo.wo_number, modified_by: AppState.userEmail });
    var req = WON.row
      ? sb.patch('work_order_limits', WON.row.id, body)
      : sb.post('work_order_limits', Object.assign({ work_order_id: wo.id, created_by: AppState.userEmail }, body));
    req.then(function(x) {
      if (!x.ok) { showToast('Error resetting the NTE'); return; }
      showToast('NTE reset to customer default'); woNteRefresh(wo.id);
    });
  });
}

// ── Customer Limits sheet: apply the default to open work orders ─────────
function wonOpenTMForOwner(ownerId) {
  var ids = {}; ids[ownerId] = true;
  (AppState.customers || []).forEach(function(c) { if (c.parent_customer_id === ownerId) ids[c.id] = true; });
  return (AppState.workOrders || []).filter(function(w) {
    if (w.active === false || !w.customer_id || !ids[w.customer_id] || w.form_mode === 'quoted') return false;
    var cat = statusCat(w.status);
    return cat === 'active' || cat === 'completed';
  });
}
function woNteApplyHtml(custId) {
  var c = (AppState.customers || []).find(function(x) { return x.id === custId; });
  if (!c || c.parent_customer_id || !CL.row) return '';
  return '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--header-bg);border-radius:3px;background:none;color:var(--header-bg);cursor:pointer" onclick="woNteApplyOpen()">Apply saved limits to open work orders</button>'
    + '<span id="won-apply-msg" style="font-size:12px;color:var(--text-muted)"></span></div>';
}
function wonApplyMsg(t, bad) { var el = document.getElementById('won-apply-msg'); if (el) { el.textContent = t; el.style.color = bad ? 'var(--danger)' : 'var(--text-muted)'; } }

/* SUPERSEDED v5.11 — 2026-10-22 — v5.10 woNteApplyOpen used two confirm() boxes (counts, then "also replace hand-edited?").
   Replaced by the picker below (checkbox list, one row per work order). Kept for reference.
function woNteApplyOpen() {
  var t = CL.row, owner = CL.custId;
  if (!t || !wonIsAdmin()) return;
  var wos = wonOpenTMForOwner(owner);
  if (!wos.length) { wonApplyMsg('No open T&M work orders for this customer.'); return; }
  var on = !!(t.nte_enabled && t.nte_amount > 0);
  wonApplyMsg('Checking…');
  var idList = wos.map(function(w) { return w.id; }).join(',');
  sb.get('work_order_limits', '?work_order_id=in.(' + idList + ')&active=eq.true&select=id,work_order_id,source').then(function(r) {
    if (!r.ok) { wonApplyMsg('Could not read the work orders.', true); return; }
    var byWo = {}; (r.data || []).forEach(function(x) { byWo[x.work_order_id] = x; });
    var none = [], follow = [], manual = [];
    wos.forEach(function(w) {
      var x = byWo[w.id];
      if (!x) none.push(w); else if (x.source === 'manual') manual.push({ w: w, x: x }); else follow.push({ w: w, x: x });
    });
    var msg = (on ? 'Apply ' + wonMoney(t.nte_amount) + ' NTE' : 'Turn the NTE off') + ' on open work orders?\n\n'
      + none.length + ' with no NTE' + (on ? ' (will get this NTE)' : ' (left alone)') + '\n'
      + follow.length + ' using the old default (will be updated)\n'
      + manual.length + ' changed by hand (' + (manual.length ? 'asked next' : 'none') + ')\n\nSaved limits are used; unsaved edits on this sheet are not.';
    if (!confirm(msg)) { wonApplyMsg(''); return; }
    var includeManual = manual.length ? confirm('Also replace the ' + manual.length + ' work order' + (manual.length === 1 ? '' : 's') + ' changed by hand?\n\nOK = replace them too. Cancel = leave them as they are.') : false;
    var jobs = [];
    var cols = Object.assign(wonLevelCols(t), { nte_enabled: on, source: 'customer_default', modified_by: AppState.userEmail });
    if (!on) cols.nte_amount = null;
    follow.concat(includeManual ? manual : []).forEach(function(p) { jobs.push(function() { return sb.patch('work_order_limits', p.x.id, cols); }); });
    if (on) none.forEach(function(w) {
      jobs.push(function() { return sb.post('work_order_limits', Object.assign({ work_order_id: w.id, label: w.wo_number, created_by: AppState.userEmail }, cols)); });
    });
    if (!jobs.length) { wonApplyMsg('Nothing to change.'); return; }
    var okN = 0, badN = 0;
    wonApplyMsg('Applying…');
    jobs.reduce(function(p, j) { return p.then(function() { return j().then(function(x) { if (x.ok) okN++; else badN++; }); }); }, Promise.resolve()).then(function() {
      wonApplyMsg('Updated ' + okN + ' work order' + (okN === 1 ? '' : 's') + (badN ? '. ' + badN + ' failed.' : '.'), !!badN);
    });
  });
}
*/

// ── v5.11: picker — choose which open work orders get the customer NTE ───
// Opens from the "Apply saved limits to open work orders" button (uses the saved limits, CL.row) and, as a prompt,
// right after an admin saves a changed NTE on a customer (uses the values just saved).
var WONP = { rows: [], t: null, on: false, busy: false };

function wonRateFor(typeId) {
  var ht = (AppState.hoursTypes || []).find(function(x) { return x.id === typeId; });
  return parseFloat(AppState.settings && ht && AppState.settings[ht.internal_rate_key]) || 0;
}
// Spend the same way the database view counts it: billable hours x Settings rate, plus parts and services, minus vendor credits.
function wonSpentMap(ids) {
  var list = ids.join(',');
  return Promise.all([
    sb.get('hours_entries', '?work_order_id=in.(' + list + ')&active=eq.true&billable=eq.true&select=work_order_id,hours,hours_type_id&limit=5000'),
    sb.get('line_items', '?work_order_id=in.(' + list + ')&active=eq.true&select=work_order_id,sell_total,transaction_type&limit=5000')
  ]).then(function(res) {
    var m = {}; ids.forEach(function(i) { m[i] = 0; });
    ((res[0].ok && res[0].data) || []).forEach(function(e) { m[e.work_order_id] = (m[e.work_order_id] || 0) + (parseFloat(e.hours) || 0) * wonRateFor(e.hours_type_id); });
    ((res[1].ok && res[1].data) || []).forEach(function(e) { var v = parseFloat(e.sell_total) || 0; m[e.work_order_id] = (m[e.work_order_id] || 0) + (e.transaction_type === 'vendor_credit' ? -v : v); });
    return { ok: !!(res[0].ok && res[1].ok), map: m };
  });
}

function wonPickEnsureSheet() {
  var el = document.getElementById('won-pick-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'won-pick-sheet';
  el.style.alignItems = 'flex-start';
  // No click-outside close: a stray click should not dismiss the prompt.
  el.innerHTML = '<div class="bottom-sheet" style="max-width:720px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="wonp-title">Open work orders</h3><button class="sheet-close" onclick="wonPickClose()">✕</button></div><div id="wonp-body" style="padding:14px 16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function wonPickClose() { var el = document.getElementById('won-pick-sheet'); if (el) el.classList.remove('open'); }

// custId: the customer (parent or standalone) whose saved limits are applied. t: the limits to apply. fromSave: opened by the save prompt.
function woNteApplyOpen(custId, t, fromSave) {
  if (!wonIsAdmin()) return;
  custId = custId || CL.custId; t = t || CL.row;
  if (!t || !custId) return;
  var on = !!(t.nte_enabled && t.nte_amount > 0);
  var wos = wonOpenTMForOwner(custId);
  if (!wos.length) { if (!fromSave) wonApplyMsg('No open T&M work orders for this customer.'); return; }
  if (!fromSave) wonApplyMsg('Checking…');
  var ids = wos.map(function(w) { return w.id; });
  Promise.all([
    sb.get('work_order_limits', '?work_order_id=in.(' + ids.join(',') + ')&active=eq.true&select=id,work_order_id,source,nte_enabled,nte_amount'),
    wonSpentMap(ids)
  ]).then(function(res) {
    if (!res[0].ok) { if (!fromSave) wonApplyMsg('Could not read the work orders.', true); else showToast('Could not read the open work orders'); return; }
    var byWo = {}; (res[0].data || []).forEach(function(x) { byWo[x.work_order_id] = x; });
    var rows = [];
    wos.forEach(function(w) {
      var x = byWo[w.id] || null;
      if (!on && !(x && x.nte_enabled)) return; // turning off: only work orders that have an NTE to turn off
      rows.push({ w: w, x: x, state: !x ? 'none' : (x.source === 'manual' ? 'manual' : 'follow'), spent: res[1].ok ? res[1].map[w.id] : null });
    });
    if (!rows.length) { if (!fromSave) wonApplyMsg('None of the open work orders has an NTE to turn off.'); return; }
    if (!fromSave) wonApplyMsg('');
    rows.sort(function(a, b) { return String(a.w.wo_number).localeCompare(String(b.w.wo_number), undefined, { numeric: true }); });
    WONP.rows = rows; WONP.t = t; WONP.on = on; WONP.busy = false;
    wonPickRender(custId, fromSave);
  });
}

function wonPickRender(custId, fromSave) {
  var c = (AppState.customers || []).find(function(x) { return x.id === custId; });
  var cname = c ? getCustName(c) : '';
  var t = WONP.t, on = WONP.on;
  wonPickEnsureSheet().classList.add('open');
  document.getElementById('wonp-title').textContent = (on ? 'Apply NTE' : 'Turn NTE off') + (cname ? ' · ' + cname : '');
  var tags = { none: ['No NTE', 'var(--text-muted)'], follow: ['Old default', 'var(--text-muted)'], manual: ['Set by hand', '#b45309'] };
  var h = '<div style="font-size:13px;margin-bottom:10px">'
    + (fromSave ? '<strong>Saved.</strong> ' : '')
    + (on ? 'Apply the new NTE of <strong>' + wonMoney(t.nte_amount) + '</strong> (' + wonLevelText(t) + ') to these open work orders now?'
          : 'Turn the NTE off on these open work orders?')
    + '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Work orders set by hand start unchecked. Tick them to replace their NTE. Spent counts billable hours, parts and services, less vendor credits.</div></div>';
  h += '<div style="display:flex;gap:8px;margin-bottom:8px">'
    + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="wonPickAll(true)">Select all</button>'
    + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="wonPickAll(false)">Select none</button></div>';
  h += '<div style="border:1px solid var(--border);border-radius:var(--radius);max-height:52vh;overflow-y:auto">';
  WONP.rows.forEach(function(r, i) {
    var cu = (AppState.customers || []).find(function(x) { return x.id === r.w.customer_id; });
    var tg = tags[r.state];
    var over = on && r.spent !== null && r.spent > t.nte_amount;
    var spentTxt = r.spent === null ? '—' : wonMoney(r.spent);
    var pctTxt = (on && r.spent !== null && t.nte_amount > 0) ? ' (' + Math.round(r.spent / t.nte_amount * 100) + '% of new NTE)' : '';
    h += '<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer">'
      + '<input type="checkbox" id="wonp-c' + i + '" ' + (r.state === 'manual' ? '' : 'checked') + ' onchange="wonPickCount()" style="margin-top:3px;width:18px;height:18px;flex-shrink:0">'
      + '<span style="flex:1;min-width:0">'
      + '<span style="font-size:13px;font-weight:600">' + escHtml(r.w.wo_number || '') + '</span> <span style="font-size:13px">' + escHtml(r.w.title || '') + '</span>'
      + '<span style="display:block;font-size:11px;color:var(--text-muted);margin-top:2px">'
      + escHtml(cu ? getCustName(cu) : '') + ' · ' + escHtml(getStatus(r.w.status).name || '') + ' · '
      + '<span style="' + (over ? 'color:#c0392b;font-weight:700' : '') + '">Spent ' + spentTxt + pctTxt + (over ? ' — over' : '') + '</span>'
      + ' · <span style="color:' + tg[1] + '">' + tg[0] + '</span></span></span></label>';
  });
  h += '</div>';
  h += '<div id="wonp-msg" style="font-size:12px;min-height:16px;margin-top:10px;color:var(--text-muted)"></div>'
    + '<div style="display:flex;gap:8px;margin-top:6px">'
    + '<button class="save-btn" id="wonp-apply" style="flex:1" onclick="wonPickApply()">Apply</button>'
    + '<button id="wonp-skip" style="padding:0 18px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:14px" onclick="wonPickClose()">' + (fromSave ? 'Skip' : 'Close') + '</button></div>';
  document.getElementById('wonp-body').innerHTML = h;
  wonPickCount();
}
function wonLevelText(t) {
  function one(n) {
    var k = 'nte_l' + n;
    if (!t[k + '_enabled']) return 'off';
    var v = t[k + '_value'], p = t[k + '_type'] === 'percent';
    return (t[k + '_direction'] === 'remaining' ? (p ? v + '% left' : wonMoney(v) + ' left') : (p ? v + '%' : wonMoney(v)));
  }
  return 'levels ' + one(1) + ' / ' + one(2);
}
function wonPickAll(flag) { WONP.rows.forEach(function(r, i) { var el = document.getElementById('wonp-c' + i); if (el) el.checked = !!flag; }); wonPickCount(); }
function wonPickSelected() { return WONP.rows.filter(function(r, i) { var el = document.getElementById('wonp-c' + i); return el && el.checked; }); }
function wonPickCount() {
  var n = wonPickSelected().length, b = document.getElementById('wonp-apply'); if (!b) return;
  b.textContent = n ? 'Apply to ' + n + ' work order' + (n === 1 ? '' : 's') : 'Nothing selected';
  b.disabled = !n || WONP.busy;
}
function wonPickMsg(text, bad) { var el = document.getElementById('wonp-msg'); if (el) { el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--text-muted)'; } }

function wonPickApply() {
  if (WONP.busy || !wonIsAdmin()) return;
  var sel = wonPickSelected(); if (!sel.length) return;
  var t = WONP.t, on = WONP.on;
  var cols = Object.assign(wonLevelCols(t), { nte_enabled: on, source: 'customer_default', modified_by: AppState.userEmail });
  if (!on) cols.nte_amount = null;
  var jobs = [];
  sel.forEach(function(r) {
    if (r.x) jobs.push(function() { return sb.patch('work_order_limits', r.x.id, cols); });
    else if (on) jobs.push(function() { return sb.post('work_order_limits', Object.assign({ work_order_id: r.w.id, label: r.w.wo_number, created_by: AppState.userEmail }, cols)); });
  });
  if (!jobs.length) { wonPickMsg('Nothing to change.'); return; }
  WONP.busy = true; wonPickCount(); wonPickMsg('Applying…');
  var okN = 0, badN = 0;
  jobs.reduce(function(p, j) { return p.then(function() { return j().then(function(x) { if (x.ok) okN++; else badN++; }); }); }, Promise.resolve()).then(function() {
    WONP.busy = false;
    var txt = 'Updated ' + okN + ' work order' + (okN === 1 ? '' : 's') + (badN ? '. ' + badN + ' failed.' : '.');
    wonApplyMsg(txt, !!badN);
    if (badN) { wonPickMsg(txt, true); wonPickCount(); return; }
    wonPickClose(); showToast(txt);
    var cur = AppState.currentWO; if (cur && typeof woNteRefresh === 'function') woNteRefresh(cur.id);
  });
}

// Called by clSave (app-customer-limits.js) after a customer's limits are saved. Prompts only when the NTE actually changed.
function woNteAfterCustomerSave(custId, prev, limits) {
  if (!wonIsAdmin() || !limits) return;
  var wasOn = !!(prev && prev.nte_enabled && prev.nte_amount > 0), isOn = !!(limits.nte_enabled && limits.nte_amount > 0);
  if (!wasOn && !isOn) return;
  var changed = wasOn !== isOn;
  if (!changed) {
    ['nte_amount', 'nte_l1_value', 'nte_l2_value'].forEach(function(k) { if ((parseFloat(prev[k]) || 0) !== (parseFloat(limits[k]) || 0)) changed = true; });
    ['nte_l1_enabled', 'nte_l2_enabled'].forEach(function(k) { if (!!prev[k] !== !!limits[k]) changed = true; });
    ['nte_l1_type', 'nte_l1_direction', 'nte_l2_type', 'nte_l2_direction'].forEach(function(k) { if (String(prev[k] || '') !== String(limits[k] || '')) changed = true; });
  }
  if (changed) woNteApplyOpen(custId, limits, true);
}

// ── v5.11: NTE badge on the Daily Dashboard dispatch rows (admin) ────────
// The row renderers in app-morning-brief.js drop a slot next to each work order title; one lookup fills them all.
function woNteBadgeSlot(woId, isQuoted) {
  if (!wonIsAdmin() || isQuoted || !woId) return '';
  return ' <span class="won-badge-slot" data-wo="' + woId + '"></span>';
}
function woNteBadgesFill(root) {
  if (!wonIsAdmin()) return;
  var slots = (root || document).querySelectorAll('.won-badge-slot');
  if (!slots.length) return;
  var seen = {}, ids = [];
  slots.forEach(function(el) { var id = el.getAttribute('data-wo'); if (id && !seen[id]) { seen[id] = true; ids.push(id); } });
  sb.get('wo_nte_status', '?level=gte.1&work_order_id=in.(' + ids.join(',') + ')&select=work_order_id,level,pct_used').then(function(r) {
    if (!r.ok) return;
    var map = {}; (r.data || []).forEach(function(x) { map[x.work_order_id] = x; });
    slots.forEach(function(el) {
      var st = map[el.getAttribute('data-wo')]; if (!st) return;
      var col = st.level >= 2 ? '#c0392b' : '#e67e22';
      el.innerHTML = '<span title="' + (st.level >= 2 ? 'NTE limit reached' : 'Approaching the NTE') + '" style="font-size:10px;font-weight:700;color:' + col + ';background:' + col + '18;border:1px solid ' + col + ';border-radius:3px;padding:1px 5px;white-space:nowrap">NTE ' + Math.round(st.pct_used) + '%</span>';
    });
  });
}

// ── Daily Dashboard card (admin) ─────────────────────────────────────────
function woNteDashRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  var badge = document.getElementById('mb-badge-wonte');
  sb.get('wo_nte_status', '?level=gte.1&order=pct_used.desc').then(function(r) {
    if (!r.ok) { shell.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">NTE status is not available.</div>'; if (badge) badge.textContent = ''; return; }
    var rows = (r.data || []).filter(function(x) {
      var w = (AppState.workOrders || []).find(function(y) { return y.id === x.work_order_id; });
      if (!w || w.active === false) return false;
      var cat = statusCat(w.status);
      return cat === 'active' || cat === 'completed';
    });
    var over = rows.filter(function(x) { return x.level >= 2; }).length;
    if (badge) badge.textContent = rows.length ? (over ? over + ' at limit' : '') + (over && rows.length > over ? ' · ' : '') + (rows.length - over ? (rows.length - over) + ' warning' : '') : 'none';
    if (!rows.length) { shell.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No open work orders are near their NTE.</div>'; return; }
    var h = '<table class="dt-table" style="width:100%"><thead><tr><th>WO</th><th>Customer</th><th>Title</th><th style="text-align:right">Spent</th><th style="text-align:right">NTE</th><th style="text-align:right">Used</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x) {
      var c = (AppState.customers || []).find(function(y) { return y.id === x.customer_id; });
      var col = x.level >= 2 ? '#c0392b' : '#e67e22';
      h += '<tr><td style="font-weight:600">' + escHtml(x.wo_number) + '</td><td>' + escHtml(c ? getCustName(c) : '') + '</td><td>' + escHtml(x.title || '') + '</td>'
        + '<td style="text-align:right">' + wonMoney(x.spent) + '</td><td style="text-align:right">' + wonMoney(x.nte_amount) + '</td>'
        + '<td style="text-align:right;font-weight:700;color:' + col + '">' + Math.round(x.pct_used) + '%</td>'
        + '<td><button onclick="openWODetail(\'' + x.work_order_id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td></tr>';
    });
    shell.innerHTML = h + '</tbody></table>';
  });
}
