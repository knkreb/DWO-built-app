// app-po-tracker.js — PO Tracker module (v4.99)
// Spec: docs/specs/dwo-spec-2026-10-05-po-tracker.md
// Admin-only. Two PO types: dollar-tracked (original amount, change orders, live billed/pending from
// po_ledger/po_wo_breakdown, $ or % warning threshold) and standing/time-based (no amount, optional
// expiration date + lead-time warning). Reference-only PO numbers stay out of this module entirely —
// they're just free text on the work order, same as before.
//
// Work order linkage: work_orders.purchase_order_id is set only when the PO field is in "picker" mode
// (see poField* functions, wired into the WO form in index.html / app-core.js openEditWO/saveWO).
// Free-text mode leaves purchase_order_id null and uses work_orders.po_number alone, exactly as before
// this module existed.

// ── Data load ──────────────────────────────────────────────────────────────
function poLoadAll() {
  return Promise.all([
    sb.get('purchase_orders', '?active=eq.true&order=created_at.desc'),
    sb.get('purchase_order_customers', '?select=*'),
    sb.get('po_change_orders', '?order=created_at.asc'),
    sb.get('po_ledger', '?select=*'),
    sb.get('po_wo_breakdown', '?select=*')
  ]).then(function(results) {
    var poR = results[0], linkR = results[1], coR = results[2], ledgerR = results[3], bdR = results[4];
    AppState.purchaseOrders = (poR.ok && poR.data) || [];
    AppState.poCustomerLinks = (linkR.ok && linkR.data) || [];
    AppState.poChangeOrders = (coR.ok && coR.data) || [];
    AppState.poLedger = {};
    ((ledgerR.ok && ledgerR.data) || []).forEach(function(row) { AppState.poLedger[row.purchase_order_id] = row; });
    AppState.poBreakdown = {};
    ((bdR.ok && bdR.data) || []).forEach(function(row) {
      if (!AppState.poBreakdown[row.purchase_order_id]) AppState.poBreakdown[row.purchase_order_id] = [];
      AppState.poBreakdown[row.purchase_order_id].push(row);
    });
    AppState.poLoaded = true;
    return poRefreshLockedWOIds();
  });
}

function poRefreshLockedWOIds() {
  return sb.get('purchase_orders', '?select=locked_work_order_id&locked=eq.true&active=eq.true&locked_work_order_id=not.is.null').then(function(r) {
    AppState.poLockedWOIds = {};
    if (r.ok && r.data) r.data.forEach(function(p) { if (p.locked_work_order_id) AppState.poLockedWOIds[p.locked_work_order_id] = true; });
  });
}

function poBlocksWOChange(woId) { return !!(AppState.poLockedWOIds && AppState.poLockedWOIds[woId]); }

function poGet(id) { return (AppState.purchaseOrders || []).find(function(p) { return p.id === id; }); }

// ── Computation helpers ──────────────────────────────────────────────────
function poCustomersFor(poId) {
  var links = (AppState.poCustomerLinks || []).filter(function(l) { return l.purchase_order_id === poId; });
  return links.map(function(l) { return AppState.customers.find(function(c) { return c.id === l.customer_id; }); }).filter(Boolean);
}

function poCustomerNames(poId) { return poCustomersFor(poId).map(getCustName).join(', ') || '—'; }
function poCustomerStackHtml(poId) {
  var names = poCustomersFor(poId).map(getCustName);
  if (!names.length) return '—';
  return '<div class="po-cust-stack">' + names.map(function(n) { return '<span>' + escHtml(n) + '</span>'; }).join('') + '</div>';
}

function poChangeOrdersFor(poId, activeOnly) {
  var list = (AppState.poChangeOrders || []).filter(function(c) { return c.purchase_order_id === poId && (!activeOnly || c.active !== false); });
  return list.sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
}

function poCurrentAmount(po) {
  if (po.po_type !== 'dollar') return null;
  var base = parseFloat(po.original_amount) || 0;
  var delta = poChangeOrdersFor(po.id, true).reduce(function(sum, c) { return sum + (parseFloat(c.amount) || 0); }, 0);
  return base + delta;
}

function poLedgerFor(poId) { return (AppState.poLedger && AppState.poLedger[poId]) || { billed: 0, pending: 0 }; }
function poBreakdownFor(poId) { return (AppState.poBreakdown && AppState.poBreakdown[poId]) || []; }

function poRemaining(po) {
  if (po.po_type !== 'dollar') return null;
  var l = poLedgerFor(po.id);
  return poCurrentAmount(po) - ((parseFloat(l.billed) || 0) + (parseFloat(l.pending) || 0));
}

function poRemainingPct(po) {
  if (po.po_type !== 'dollar') return null;
  var cur = poCurrentAmount(po);
  if (!cur) return 0;
  return (poRemaining(po) / cur) * 100;
}

// Returns {level:'ok'|'warn'|'over', text}
function poWarningState(po) {
  if (po.po_type === 'dollar') {
    var remaining = poRemaining(po);
    if (remaining <= 0) return { level: 'over', text: 'Exhausted' };
    var mode = po.warning_mode || AppState.settings.po_default_warning_mode || 'percent';
    var val = po.warning_value != null ? parseFloat(po.warning_value) : parseFloat(AppState.settings.po_default_warning_value || 20);
    if (mode === 'dollar') { if (remaining <= val) return { level: 'warn', text: poFmtMoney(remaining) + ' left' }; }
    else { if (poRemainingPct(po) <= val) return { level: 'warn', text: Math.round(poRemainingPct(po)) + '% left' }; }
    return { level: 'ok', text: '' };
  }
  if (po.po_type === 'standing' && po.expiration_date) {
    var days = Math.ceil((new Date(po.expiration_date) - new Date()) / 86400000);
    var lead = po.expiration_warning_days != null ? po.expiration_warning_days : parseInt(AppState.settings.po_default_expiration_warning_days || 30, 10);
    if (days < 0) return { level: 'over', text: 'Expired' };
    if (days <= lead) return { level: 'warn', text: days + 'd to expiration' };
  }
  return { level: 'ok', text: '' };
}

function poFmtMoney(n) { n = parseFloat(n) || 0; return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function poStatusBadge(status) {
  var colors = { created: '#6b7280', in_progress: '#2563eb', completed: '#15803d', cancelled: '#c0392b' };
  var labels = { created: 'Created', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };
  return '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:' + (colors[status] || '#6b7280') + '22;color:' + (colors[status] || '#6b7280') + '">' + (labels[status] || status) + '</span>';
}

function poWarnBadge(ws) {
  if (ws.level === 'ok') return '';
  var color = ws.level === 'over' ? '#c0392b' : '#b7791f';
  return '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:' + color + '22;color:' + color + ';margin-left:6px">⚠ ' + escHtml(ws.text) + '</span>';
}

// ── Panel (desktop list) ──────────────────────────────────────────────────
function renderPOPanel(containerId) {
  var el = document.getElementById(containerId); if (!el) return;
  el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Loading…</div>';
  poLoadAll().then(function() { poRenderPanelBody(containerId); });
}

function poRenderPanelBody(containerId) {
  var el = document.getElementById(containerId); if (!el) return;
  var q = (document.getElementById('po-panel-search') && document.getElementById('po-panel-search').value || '').toLowerCase();
  var list = (AppState.purchaseOrders || []).filter(function(p) {
    if (!q) return true;
    return (p.po_number || '').toLowerCase().indexOf(q) >= 0
      || (p.description || '').toLowerCase().indexOf(q) >= 0
      || poCustomerNames(p.id).toLowerCase().indexOf(q) >= 0;
  });
  list.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

  var html = '<div style="margin-bottom:12px"><input type="search" id="po-panel-search" placeholder="Search PO #, description, customer…" value="' + escHtml(q) + '" oninput="poRenderPanelBody(\'' + containerId + '\')" style="width:100%;max-width:360px;font-size:13px;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm)"></div>';

  if (!list.length) {
    html += '<div style="padding:30px;text-align:center;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius)">No purchase orders yet.</div>';
    el.innerHTML = html;
    return;
  }

  html += '<table class="po-grid-table"><thead><tr><th>PO #</th><th>Description</th><th>Customer(s)</th><th>Type</th><th>Pending</th><th>Billed</th><th>Remaining $</th><th>Remaining %</th><th>Status</th><th></th></tr></thead><tbody>';
  list.forEach(function(po) {
    var ws = poWarningState(po);
    var isDollar = po.po_type === 'dollar';
    var l = poLedgerFor(po.id);
    html += '<tr style="cursor:pointer" onclick="poOpenEditScreen(\'' + po.id + '\')">'
      + '<td style="font-weight:600">' + escHtml(po.po_number) + (po.locked ? ' <span title="Locked to a work order" style="font-size:11px">🔒</span>' : '') + '</td>'
      + '<td>' + escHtml(po.description) + '</td>'
      + '<td style="font-size:12px;color:var(--text-muted)">' + poCustomerStackHtml(po.id) + '</td>'
      + '<td>' + (isDollar ? 'Dollar' : 'Standing PO' + (po.expiration_date ? ' · exp ' + po.expiration_date : '')) + '</td>'
      + '<td>' + (isDollar ? poFmtMoney(l.pending) : '—') + '</td>'
      + '<td>' + (isDollar ? poFmtMoney(l.billed) : '—') + '</td>'
      + '<td>' + (isDollar ? poFmtMoney(poRemaining(po)) : '—') + '</td>'
      + '<td>' + (isDollar ? Math.round(poRemainingPct(po)) + '%' : '—') + '</td>'
      + '<td>' + poStatusBadge(po.status) + poWarnBadge(ws) + '</td>'
      + '<td><button onclick="event.stopPropagation();poOpenEditScreen(\'' + po.id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ── Dashboard warning reminder ────────────────────────────────────────────
function poWarningReminderRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  poLoadAll().then(function() {
    var flagged = (AppState.purchaseOrders || []).filter(function(p) {
      return (p.status === 'created' || p.status === 'in_progress') && poWarningState(p).level !== 'ok';
    });
    flagged.sort(function(a, b) {
      var aw = poWarningState(a), bw = poWarningState(b);
      if (aw.level !== bw.level) return aw.level === 'over' ? -1 : 1;
      return 0;
    });
    var badge = document.getElementById('mb-badge-powarn');
    if (badge) badge.textContent = flagged.length ? flagged.length + ' flagged' : 'none';
    if (!flagged.length) {
      shell.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No POs nearing their limit or expiration.</div>';
      return;
    }
    var html = '<table class="po-grid-table"><thead><tr><th>PO #</th><th>Description</th><th>Customer(s)</th><th>Status</th><th></th></tr></thead><tbody>';
    flagged.forEach(function(po) {
      var ws = poWarningState(po);
      html += '<tr><td style="font-weight:600">' + escHtml(po.po_number) + '</td>'
        + '<td>' + escHtml(po.description) + '</td>'
        + '<td style="font-size:12px;color:var(--text-muted)">' + poCustomerStackHtml(po.id) + '</td>'
        + '<td>' + poWarnBadge(ws) + '</td>'
        + '<td><button onclick="poOpenEditScreen(\'' + po.id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td></tr>';
    });
    html += '</tbody></table>';
    shell.innerHTML = html;
  });
}

// ── Edit / detail screen (full screen, same pattern as the work order form) ─
function poOpenEditScreen(poId) {
  var body = document.getElementById('po-form-body');
  if (!body) return;
  AppState.poEditingId = poId;
  pushScreen('screen-po-form', poId ? 'Edit PO' : 'New PO');
  var render = function() { body.innerHTML = poRenderEditForm(poId ? poGet(poId) : null); };
  if (!AppState.poLoaded) { poLoadAll().then(render); } else render();
}

function poSetScreenTitle(t) {
  var el = document.getElementById('header-title-text');
  if (el) el.textContent = t;
}

function poRenderEditForm(po) {
  var isNew = !po;
  var type = po ? po.po_type : 'dollar';
  var allCust = (AppState.customers || []).filter(function(c) { return c.active !== false; }).slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
  var checkedIds = po ? poCustomersFor(po.id).map(function(c) { return c.id; }) : [];

  var html = '';
  html += '<div class="form-row-2">'
    + '<div><label class="form-label">PO Number *</label><input type="text" id="po-f-number" value="' + escHtml(po ? po.po_number : '') + '"></div>'
    + '<div><label class="form-label">Type *</label><select id="po-f-type" onchange="poToggleTypeFields(this.value)"' + (po ? ' disabled' : '') + '>'
    + '<option value="dollar"' + (type === 'dollar' ? ' selected' : '') + '>Dollar-tracked</option>'
    + '<option value="standing"' + (type === 'standing' ? ' selected' : '') + '>Standing / time-based</option>'
    + '</select></div></div>';
  html += '<div class="form-row"><label class="form-label">Description *</label><input type="text" id="po-f-description" value="' + escHtml(po ? po.description : '') + '" placeholder="e.g. 4471 — R&M"></div>';

  // Dollar fields
  html += '<div id="po-f-dollar-fields" style="display:' + (type === 'dollar' ? 'block' : 'none') + '">';
  html += '<div class="form-row-2">'
    + '<div><label class="form-label">Original Amount *</label><input type="number" step="0.01" id="po-f-amount" value="' + (po && po.original_amount != null ? po.original_amount : '') + '"></div>'
    + '<div><label class="form-label">Warning Threshold</label><div style="display:flex;gap:6px">'
    + '<select id="po-f-warn-mode" style="flex:1"><option value="percent"' + ((po ? po.warning_mode : AppState.settings.po_default_warning_mode) === 'percent' ? ' selected' : '') + '>% consumed</option><option value="dollar"' + ((po ? po.warning_mode : AppState.settings.po_default_warning_mode) === 'dollar' ? ' selected' : '') + '>$ remaining</option></select>'
    + '<input type="number" step="0.01" id="po-f-warn-value" value="' + (po && po.warning_value != null ? po.warning_value : (AppState.settings.po_default_warning_value || 20)) + '" style="width:90px"></div></div>'
    + '</div>';
  if (po) {
    var l = poLedgerFor(po.id);
    html += '<div style="font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin:8px 0">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span>Current amount</span><strong>' + poFmtMoney(poCurrentAmount(po)) + '</strong></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span>Billed</span><span>' + poFmtMoney(l.billed) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span>Pending (live)</span><span>' + poFmtMoney(l.pending) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--border);padding-top:4px;margin-top:4px"><span>Remaining</span><span>' + poFmtMoney(poRemaining(po)) + ' (' + Math.round(poRemainingPct(po)) + '%)</span></div>'
      + '</div>';
    var bd = poBreakdownFor(po.id).filter(function(b) { return b.status !== 12; });
    if (bd.length) {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Pending from:</div><div style="font-size:12px;margin-bottom:8px">' + bd.map(function(b) { return escHtml(b.wo_number) + ' (' + poFmtMoney(b.wo_total) + ')'; }).join(', ') + '</div>';
    }
  }
  html += '</div>'; // end dollar fields

  // Standing fields
  html += '<div id="po-f-standing-fields" style="display:' + (type === 'standing' ? 'block' : 'none') + '">';
  html += '<div class="form-row-2">'
    + '<div><label class="form-label">Expiration Date</label><input type="date" id="po-f-expiration" value="' + (po && po.expiration_date ? po.expiration_date : '') + '"></div>'
    + '<div><label class="form-label">Warning Lead Time (days)</label><input type="number" id="po-f-exp-warn-days" value="' + (po && po.expiration_warning_days != null ? po.expiration_warning_days : (AppState.settings.po_default_expiration_warning_days || 30)) + '"></div>'
    + '</div>';
  html += '</div>';

  // Account assignment
  html += '<div class="form-row"><label class="form-label">Account(s) *</label>';
  html += '<input type="search" placeholder="Search customers…" oninput="poFilterAccountList(this.value)" style="width:100%;margin-bottom:6px">';
  html += '<div id="po-f-account-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px">';
  allCust.forEach(function(c) {
    html += '<label class="po-acct-row" data-name="' + escHtml((c.name || '').toLowerCase()) + '" style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px">'
      + '<input type="checkbox" class="po-acct-chk" value="' + c.id + '"' + (checkedIds.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + escHtml(getCustName(c)) + '</label>';
  });
  html += '</div></div>';

  // Lock + create WO — new POs only, per the lock-at-creation decision
  if (isNew) {
    html += '<div class="form-row" style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600"><input type="checkbox" class="po-lock-chk" id="po-f-lock" onchange="poToggleLockFields(this.checked)"> Lock this work order to this PO</label>'
      + '<div id="po-f-lock-fields" style="display:none;margin-top:8px;padding:10px;background:var(--bg);border-radius:var(--radius-sm)">'
      + '<div class="form-row"><label class="form-label">Customer for new WO</label><select id="po-f-lock-customer"><option value="">— Select —</option>' + allCust.map(function(c) { return '<option value="' + c.id + '">' + escHtml(getCustName(c)) + '</option>'; }).join('') + '</select></div>'
      + '<div class="form-row"><label class="form-label">WO Title</label><input type="text" id="po-f-lock-title" placeholder="Brief description of work"></div>'
      + '<div class="form-row"><label class="form-label">Form Mode</label><select id="po-f-lock-form-mode"><option value="time_materials">Time &amp; Materials</option><option value="quoted">Quoted</option></select></div>'
      + '</div></div>';
  } else if (po && po.locked) {
    var lockedWO = AppState.workOrders.find(function(w) { return w.id === po.locked_work_order_id; });
    html += '<div class="form-row" style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px;font-size:13px">'
      + '🔒 Locked to ' + (lockedWO ? escHtml(lockedWO.wo_number) + ' — ' + escHtml(lockedWO.title) : 'a work order') + ' '
      + '<button onclick="poUntieLock(\'' + po.id + '\')" style="font-size:12px;padding:3px 10px;border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius-sm);background:none;cursor:pointer;margin-left:6px">Untie</button></div>';
  }

  // Lifecycle status + save
  if (po) {
    html += '<div class="form-row" style="margin-top:10px"><label class="form-label">Status</label>' + poStatusBadge(po.status) + ' ';
    ['created', 'in_progress', 'completed', 'cancelled'].filter(function(s) { return s !== po.status; }).forEach(function(s) {
      html += '<button onclick="poSetStatus(\'' + po.id + '\',\'' + s + '\')" style="font-size:11px;padding:3px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;margin:2px">→ ' + s.replace('_', ' ') + '</button>';
    });
    html += '</div>';
  }

  html += '<div style="display:flex;gap:8px;margin-top:14px"><button class="save-btn" onclick="poSaveForm()">' + (isNew ? 'Create PO' : 'Save Changes') + '</button></div>';

  if (po) html += poRenderChangeOrdersBlock(po);

  return html;
}

function poToggleTypeFields(type) {
  document.getElementById('po-f-dollar-fields').style.display = type === 'dollar' ? 'block' : 'none';
  document.getElementById('po-f-standing-fields').style.display = type === 'standing' ? 'block' : 'none';
}

function poToggleLockFields(checked) {
  var el = document.getElementById('po-f-lock-fields'); if (el) el.style.display = checked ? 'block' : 'none';
}

function poFilterAccountList(q) {
  q = (q || '').toLowerCase();
  document.querySelectorAll('#po-f-account-list .po-acct-row').forEach(function(row) {
    row.style.display = (!q || row.dataset.name.indexOf(q) >= 0) ? 'flex' : 'none';
  });
}

function poSaveForm() {
  var isNew = !AppState.poEditingId;
  var poNumber = document.getElementById('po-f-number').value.trim();
  var description = document.getElementById('po-f-description').value.trim();
  var type = isNew ? document.getElementById('po-f-type').value : poGet(AppState.poEditingId).po_type;
  if (!poNumber || !description) { showToast('PO number and description are required'); return; }
  var acctIds = Array.prototype.slice.call(document.querySelectorAll('.po-acct-chk:checked')).map(function(el) { return el.value; });
  if (!acctIds.length) { showToast('Select at least one account'); return; }

  var payload = { po_number: poNumber, description: description, modified_by: AppState.userEmail };
  if (type === 'dollar') {
    var amt = parseFloat(document.getElementById('po-f-amount').value);
    if (isNaN(amt) || amt <= 0) { showToast('Enter a valid original amount'); return; }
    payload.original_amount = amt;
    payload.warning_mode = document.getElementById('po-f-warn-mode').value;
    payload.warning_value = parseFloat(document.getElementById('po-f-warn-value').value) || 0;
  } else {
    var expEl = document.getElementById('po-f-expiration');
    payload.expiration_date = expEl.value || null;
    payload.expiration_warning_days = parseInt(document.getElementById('po-f-exp-warn-days').value, 10) || null;
  }

  var savePromise;
  if (isNew) {
    payload.po_type = type;
    payload.created_by = AppState.userEmail;
    var lockEl = document.getElementById('po-f-lock-fields');
    var wantsLock = document.getElementById('po-f-lock') && document.getElementById('po-f-lock').checked;
    if (wantsLock) {
      var custId = document.getElementById('po-f-lock-customer').value;
      var title = document.getElementById('po-f-lock-title').value.trim();
      if (!custId || !title) { showToast('Customer and title are required to lock a work order'); return; }
      if (acctIds.indexOf(custId) < 0) { showToast('The locked WO\'s customer must be one of the selected accounts'); return; }
    }
    savePromise = sb.post('purchase_orders', payload).then(function(r) {
      if (!r.ok || !r.data || !r.data.length) { showToast('Error creating PO'); return Promise.reject(); }
      var newPO = r.data[0];
      AppState.purchaseOrders.unshift(newPO);
      return poSyncAccounts(newPO.id, acctIds).then(function() {
        if (wantsLock) {
          return poCreateLockedWO(newPO.id, document.getElementById('po-f-lock-customer').value, document.getElementById('po-f-lock-title').value.trim(), document.getElementById('po-f-lock-form-mode').value);
        }
      }).then(function() { return newPO.id; });
    });
  } else {
    savePromise = sb.patch('purchase_orders', AppState.poEditingId, payload).then(function(r) {
      if (!r.ok) { showToast('Error saving PO'); return Promise.reject(); }
      var idx = AppState.purchaseOrders.findIndex(function(p) { return p.id === AppState.poEditingId; });
      if (idx >= 0) AppState.purchaseOrders[idx] = Object.assign({}, AppState.purchaseOrders[idx], payload);
      return poSyncAccounts(AppState.poEditingId, acctIds).then(function() { return AppState.poEditingId; });
    });
  }

  savePromise.then(function(poId) {
    if (!poId) return;
    showToast(isNew ? 'PO created' : 'PO saved');
    AppState.poEditingId = poId;
    poSetScreenTitle('Edit PO');
    return poLoadAll().then(function() {
      document.getElementById('po-form-body').innerHTML = poRenderEditForm(poGet(poId));
      if (document.getElementById('potracker-panel-body')) poRenderPanelBody('potracker-panel-body');
    });
  }).catch(function() {});
}

function poSyncAccounts(poId, acctIds) {
  // Simplest correct approach: delete existing links for this PO, insert the current selection.
  return sb.req('DELETE', '/rest/v1/purchase_order_customers?purchase_order_id=eq.' + poId).then(function() {
    return sb.post('purchase_order_customers', acctIds.map(function(cid) { return { purchase_order_id: poId, customer_id: cid }; }));
  });
}

function poCreateLockedWO(poId, custId, title, formMode) {
  var nextNum = parseInt(AppState.settings.wo_number_next || '26300', 10);
  var prefix = AppState.settings.wo_number_prefix || 'P';
  var woNum = prefix + nextNum;
  var po = poGet(poId);
  var cust = AppState.customers.find(function(c) { return c.id === custId; });
  var _workReadySt = AppState.statuses.find(function(s) { return s.name === 'Work Ready'; });
  var statusNum = _workReadySt ? _workReadySt.num : 6;
  return sb.post('work_orders', {
    wo_number: woNum, title: title, customer_id: custId, customer_flag: cust && cust.qbo_customer_id === 'SYSTEM',
    form_mode: formMode, po_number: po ? po.po_number : null, purchase_order_id: poId, status: statusNum,
    created_by: AppState.userEmail, modified_by: AppState.userEmail
  }).then(function(r) {
    if (!r.ok || !r.data || !r.data.length) { showToast('PO saved, but the work order could not be created'); return; }
    var newWO = Object.assign({}, r.data[0], { customers: cust });
    AppState.workOrders.push(newWO);
    var savedNum = nextNum;
    sb.patchWhere('settings', 'key=eq.wo_number_next', { value: String(savedNum + 1) });
    AppState.settings.wo_number_next = String(savedNum + 1);
    return sb.patch('purchase_orders', poId, { locked: true, locked_work_order_id: newWO.id, modified_by: AppState.userEmail }).then(function(r2) {
      if (r2.ok) {
        var idx = AppState.purchaseOrders.findIndex(function(p) { return p.id === poId; });
        if (idx >= 0) { AppState.purchaseOrders[idx].locked = true; AppState.purchaseOrders[idx].locked_work_order_id = newWO.id; }
        return poRefreshLockedWOIds();
      }
    }).then(function() {
      if (typeof renderDesktopGrid === 'function') renderDesktopGrid();
      showToast('Work order ' + woNum + ' created and locked to PO');
    });
  });
}

function poUntieLock(poId) {
  if (!confirm('Untie this PO from its locked work order? The work order can then be deleted or cancelled.')) return;
  sb.patch('purchase_orders', poId, { locked: false, locked_work_order_id: null, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error untying PO'); return; }
    var idx = AppState.purchaseOrders.findIndex(function(p) { return p.id === poId; });
    if (idx >= 0) { AppState.purchaseOrders[idx].locked = false; AppState.purchaseOrders[idx].locked_work_order_id = null; }
    poRefreshLockedWOIds().then(function() { showToast('PO untied'); poRerenderForm(); });
  });
}

function poSetStatus(poId, status) {
  var po = poGet(poId); if (!po) return;
  if (status === 'completed' && po.po_type === 'dollar' && poRemaining(po) > 0.004) {
    if (!confirm('This PO still has ' + poFmtMoney(poRemaining(po)) + ' remaining. Mark completed anyway?')) return;
  }
  if (status === 'cancelled' && !confirm('Cancel this PO?')) return;
  sb.patch('purchase_orders', poId, { status: status, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error updating status'); return; }
    var idx = AppState.purchaseOrders.findIndex(function(p) { return p.id === poId; });
    if (idx >= 0) AppState.purchaseOrders[idx].status = status;
    showToast('Status updated');
    poRerenderForm();
    if (document.getElementById('potracker-panel-body')) poRenderPanelBody('potracker-panel-body');
  });
}

function poRerenderForm() {
  var body = document.getElementById('po-form-body');
  if (body && AppState.poEditingId) body.innerHTML = poRenderEditForm(poGet(AppState.poEditingId));
}

// ── Change orders ──────────────────────────────────────────────────────────
function poRenderChangeOrdersBlock(po) {
  var cos = poChangeOrdersFor(po.id, false);
  var html = '<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:10px">';
  html += '<div style="font-size:13px;font-weight:700;margin-bottom:6px">Change Orders</div>';
  if (!cos.length) html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">None yet.</div>';
  else {
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    cos.forEach(function(c) {
      var struck = c.active === false ? 'text-decoration:line-through;color:var(--text-muted)' : '';
      html += '<tr style="border-bottom:1px solid var(--border)">'
        + '<td style="padding:4px 4px;' + struck + '">' + escHtml(c.description) + '</td>'
        + '<td style="padding:4px 4px;text-align:right;' + struck + '">' + (c.amount >= 0 ? '+' : '') + poFmtMoney(c.amount) + '</td>'
        + '<td style="padding:4px 4px;font-size:11px;color:var(--text-muted)">' + new Date(c.created_at).toLocaleDateString() + (c.created_by ? ' · ' + escHtml(c.created_by) : '') + '</td>'
        + '<td style="padding:4px 4px;white-space:nowrap">';
      if (c.active !== false) {
        html += '<button onclick="poEditChangeOrder(\'' + c.id + '\')" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer">Edit</button> '
          + '<button onclick="poDeleteChangeOrder(\'' + c.id + '\')" style="font-size:11px;padding:2px 8px;border:1px solid var(--danger);color:var(--danger);border-radius:3px;background:none;cursor:pointer">Delete</button>';
      } else {
        html += '<span style="font-size:11px;color:var(--text-muted)">deleted' + (c.modified_by ? ' by ' + escHtml(c.modified_by) : '') + '</span>';
      }
      html += '</td></tr>';
    });
    html += '</table>';
  }
  html += '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">'
    + '<input type="text" id="po-co-description" placeholder="Description" style="flex:1;min-width:140px;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px">'
    + '<input type="number" step="0.01" id="po-co-amount" placeholder="+/- amount" style="width:110px;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px">'
    + '<button class="btn-dark" style="font-size:12px;padding:6px 12px" onclick="poAddChangeOrder(\'' + po.id + '\')">+ Add Change Order</button>'
    + '</div></div>';
  return html;
}

function poAddChangeOrder(poId) {
  var desc = document.getElementById('po-co-description').value.trim();
  var amt = parseFloat(document.getElementById('po-co-amount').value);
  if (!desc || isNaN(amt) || amt === 0) { showToast('Enter a description and a non-zero amount'); return; }
  sb.post('po_change_orders', { purchase_order_id: poId, description: desc, amount: amt, created_by: AppState.userEmail, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok || !r.data || !r.data.length) { showToast('Error adding change order'); return; }
    AppState.poChangeOrders.push(r.data[0]);
    showToast('Change order added');
    poLoadAll().then(poRerenderForm);
  });
}

function poEditChangeOrder(coId) {
  var c = AppState.poChangeOrders.find(function(x) { return x.id === coId; }); if (!c) return;
  var newDesc = prompt('Description', c.description); if (newDesc === null) return;
  var newAmtStr = prompt('Amount (+/-)', c.amount); if (newAmtStr === null) return;
  var newAmt = parseFloat(newAmtStr);
  if (!newDesc.trim() || isNaN(newAmt)) { showToast('Invalid description or amount'); return; }
  sb.patch('po_change_orders', coId, { description: newDesc.trim(), amount: newAmt, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error updating change order'); return; }
    c.description = newDesc.trim(); c.amount = newAmt;
    showToast('Change order updated');
    poLoadAll().then(poRerenderForm);
  });
}

function poDeleteChangeOrder(coId) {
  if (!confirm('Delete this change order? It will still show in the history.')) return;
  var c = AppState.poChangeOrders.find(function(x) { return x.id === coId; }); if (!c) return;
  sb.patch('po_change_orders', coId, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error deleting change order'); return; }
    c.active = false;
    showToast('Change order deleted');
    poLoadAll().then(poRerenderForm);
  });
}

// ── WO form PO field: free text vs. picker toggle ──────────────────────────
function poFieldSetMode(mode, poId) {
  var toggle = document.getElementById('f-po-mode-toggle');
  var textInput = document.getElementById('f-po-number');
  var display = document.getElementById('f-po-tracked-display');
  var label = document.getElementById('f-po-tracked-label');
  var hiddenId = document.getElementById('f-po-id');
  if (!toggle || !textInput || !display || !hiddenId) return;
  if (mode === 'picker') {
    textInput.style.display = 'none';
    display.style.display = 'block';
    toggle.textContent = 'Use free text';
    if (poId) {
      hiddenId.value = poId;
      var po = poGet(poId);
      if (po) {
        textInput.value = po.po_number;
        label.textContent = po.po_number + ' — ' + po.description;
        label.style.color = 'inherit';
      } else {
        // PO list not loaded yet (e.g. opening an existing WO before visiting the PO panel) — fetch it
        sb.get('purchase_orders', '?id=eq.' + poId + '&select=po_number,description').then(function(r) {
          if (r.ok && r.data && r.data.length) {
            textInput.value = r.data[0].po_number;
            label.textContent = r.data[0].po_number + ' — ' + r.data[0].description;
            label.style.color = 'inherit';
          }
        });
      }
    } else {
      hiddenId.value = '';
      label.textContent = 'Tap to choose a PO…';
      label.style.color = 'var(--text-muted)';
    }
  } else {
    textInput.style.display = 'block';
    display.style.display = 'none';
    toggle.textContent = 'Use PO picker';
    hiddenId.value = '';
  }
}

function poFieldToggleMode() {
  var hiddenId = document.getElementById('f-po-id');
  var inPicker = hiddenId && document.getElementById('f-po-tracked-display').style.display === 'block';
  if (inPicker) { poFieldSetMode('text'); document.getElementById('f-po-number').value = ''; }
  else { poFieldSetMode('picker'); }
}

function poFieldOpenPicker() {
  var custId = document.getElementById('f-customer-id').value;
  if (!custId) { showToast('Choose a customer first'); return; }
  var body = document.getElementById('po-picker-body');
  var currentWOId = AppState.editingWOId;
  pushScreen('screen-po-picker', 'Select a PO');
  var render = function() {
    var list = (AppState.purchaseOrders || []).filter(function(p) {
      if (p.status === 'cancelled') return false;
      if (p.locked && p.locked_work_order_id !== currentWOId) return false;
      return poCustomersFor(p.id).some(function(c) { return c.id === custId; });
    });
    var html;
    if (!list.length) html = '<div style="padding:30px;text-align:center;color:var(--text-muted)">No tracked POs available for this customer.</div>';
    else {
      html = '<table class="po-grid-table"><thead><tr><th>PO #</th><th>Description</th><th>Type</th><th>Remaining</th><th></th></tr></thead><tbody>';
      list.forEach(function(p) {
        var isDollar = p.po_type === 'dollar';
        html += '<tr><td style="font-weight:600">' + escHtml(p.po_number) + '</td><td>' + escHtml(p.description) + '</td>'
          + '<td>' + (isDollar ? 'Dollar' : 'Standing') + '</td>'
          + '<td>' + (isDollar ? poFmtMoney(poRemaining(p)) : '—') + '</td>'
          + '<td><button onclick="poFieldSelect(\'' + p.id + '\')" style="font-size:12px;padding:4px 10px;border:none;border-radius:3px;background:var(--header-bg);color:#fff;cursor:pointer">Select</button></td></tr>';
      });
      html += '</tbody></table>';
    }
    body.innerHTML = html;
  };
  if (!AppState.poLoaded) poLoadAll().then(render); else render();
}

function poFieldSelect(poId) {
  poFieldSetMode('picker', poId);
  goBack();
}
