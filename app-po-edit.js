// app-po-edit.js — Customer PO edit screen pieces (v5.05)
// Spec: docs/specs/po-edit-screen-and-sidebar-rename.md
// ORIGIN: the customer checkbox list and the "Pending from:" text line were in poRenderEditForm()
// (app-po-tracker.js). They are commented out there with MOVED TO notes and replaced by calls to
// poEditCustomerPickerHtml() and poEditWoTableHtml() below.

AppState.poPickedCusts = AppState.poPickedCusts || [];

// ── Customer picker: search, click to add, chips to remove ───────────────
function poEditCustomerPickerHtml(checkedIds) {
  AppState.poPickedCusts = (checkedIds || []).slice();
  var html = '<div class="form-row"><label class="form-label">Account(s) *</label>';
  html += '<input type="search" id="po-f-pick-search" placeholder="Search customers…" autocomplete="off" oninput="poPickerSearch(this.value)" style="width:100%">';
  html += '<div id="po-f-pick-results" style="display:none;max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);margin-top:4px"></div>';
  html += '<div id="po-f-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + poPickerChipsHtml() + '</div>';
  html += '</div>';
  return html;
}

function poPickedIds() { return AppState.poPickedCusts.slice(); }

function poPickerChipsHtml() {
  if (!AppState.poPickedCusts.length) return '<span style="font-size:12px;color:var(--text-muted)">No customers selected</span>';
  return AppState.poPickedCusts.map(function(id) {
    var c = (AppState.customers || []).find(function(x) { return x.id === id; });
    return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 6px 4px 10px;border:1px solid var(--border);border-radius:14px;background:var(--bg)">'
      + escHtml(getCustName(c))
      + '<button type="button" onclick="poPickerRemove(\'' + id + '\')" title="Remove" style="border:none;background:none;cursor:pointer;font-size:15px;line-height:1;color:var(--text-muted);padding:0 4px">×</button></span>';
  }).join('');
}

function poPickerRefreshChips() {
  var el = document.getElementById('po-f-chips'); if (el) el.innerHTML = poPickerChipsHtml();
}

function poPickerSearch(q) {
  var box = document.getElementById('po-f-pick-results'); if (!box) return;
  q = (q || '').trim().toLowerCase();
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
  var matches = (AppState.customers || []).filter(function(c) {
    if (c.active === false || AppState.poPickedCusts.indexOf(c.id) >= 0) return false;
    return (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.display_name || '').toLowerCase().indexOf(q) >= 0;
  }).sort(function(a, b) { return getCustName(a).localeCompare(getCustName(b)); }).slice(0, 25);
  box.style.display = 'block';
  box.innerHTML = matches.length
    ? matches.map(function(c) {
        return '<div onclick="poPickerAdd(\'' + c.id + '\')" style="padding:7px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border)">' + escHtml(getCustName(c)) + '</div>';
      }).join('')
    : '<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">No matching customers</div>';
}

function poPickerAdd(id) {
  if (AppState.poPickedCusts.indexOf(id) < 0) AppState.poPickedCusts.push(id);
  poPickerRefreshChips();
  var s = document.getElementById('po-f-pick-search'); if (s) { s.value = ''; s.focus(); }
  poPickerSearch('');
}

function poPickerRemove(id) {
  AppState.poPickedCusts = AppState.poPickedCusts.filter(function(x) { return x !== id; });
  poPickerRefreshChips();
}

// ── Linked work orders table ─────────────────────────────────────────────
function poEditWoTableHtml(po) {
  var rows = poBreakdownFor(po.id).slice().sort(function(a, b) { return String(a.wo_number).localeCompare(String(b.wo_number)); });
  var html = '<div style="font-size:13px;font-weight:700;margin:8px 0 4px">Work orders on this PO</div>';
  if (!rows.length) return html + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">No work orders linked yet.</div>';
  html += '<div style="overflow-x:auto;margin-bottom:10px"><table class="po-grid-table"><thead><tr><th>WO #</th><th>Customer</th><th>Description</th><th>Status</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>';
  rows.forEach(function(b) {
    var wo = (AppState.workOrders || []).find(function(w) { return w.id === b.work_order_id; }) || {};
    var custId = b.customer_id || wo.customer_id;
    var cust = (AppState.customers || []).find(function(c) { return c.id === custId; });
    var desc = b.title || wo.title || b.work_description || wo.work_description || '';
    var st = getStatus(b.status);
    var isLockedWO = po.locked && po.locked_work_order_id === b.work_order_id;
    html += '<tr style="cursor:pointer" onclick="poEditOpenWO(\'' + b.work_order_id + '\')">'
      + '<td style="font-weight:600">' + escHtml(b.wo_number) + '</td>'
      + '<td style="font-size:12px">' + escHtml(getCustName(cust || wo.customers)) + '</td>'
      + '<td>' + escHtml(desc) + '</td>'
      + '<td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + escHtml(st.color || '#eee') + '">' + escHtml(st.name) + '</span></td>'
      + '<td style="text-align:right">' + poFmtMoney(b.wo_total) + '</td>'
      + '<td>' + (isLockedWO
          ? '<span title="Locked to this PO — use Untie below" style="font-size:11px">🔒</span>'
          : '<button onclick="event.stopPropagation();poEditUnlinkWO(\'' + po.id + '\',\'' + b.work_order_id + '\')" style="font-size:12px;padding:3px 10px;border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius-sm);background:none;cursor:pointer">Unlink</button>')
      + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function poEditOpenWO(woId) {
  if (typeof openWODetail === 'function') openWODetail(woId);
}

function poEditUnlinkWO(poId, woId) {
  var po = poGet(poId); if (!po) return;
  var b = poBreakdownFor(poId).find(function(x) { return x.work_order_id === woId; }) || {};
  if (po.locked && po.locked_work_order_id === woId) { showToast('This work order is locked to the PO — use Untie'); return; }
  var msg = 'Unlink ' + (b.wo_number || 'this work order') + ' from this PO?';
  if (b.status === 12) {
    msg = (b.wo_number || 'This work order') + ' has already been INVOICED. Unlinking it will remove ' + poFmtMoney(b.wo_total)
      + ' from this PO\'s Billed amount and it will no longer count against the PO.\n\nUnlink anyway?';
  }
  if (!confirm(msg)) return;
  var wo = (AppState.workOrders || []).find(function(w) { return w.id === woId; });
  var patch = { purchase_order_id: null, modified_by: AppState.userEmail };
  // Free-text PO number set from this PO goes too; a different reference number stays.
  if (wo && wo.po_number && wo.po_number === po.po_number) patch.po_number = null;
  sb.patch('work_orders', woId, patch).then(function(r) {
    if (!r.ok) { showToast('Error unlinking work order'); return; }
    if (wo) { wo.purchase_order_id = null; if ('po_number' in patch) wo.po_number = null; }
    showToast('Work order unlinked');
    return poLoadAll().then(function() {
      poRerenderForm();
      if (document.getElementById('potracker-panel-body')) poRenderPanelBody('potracker-panel-body');
    });
  });
}
