// app-po-reminder.js — Daily Dashboard reminder: work orders missing a PO (v4.96, invoice generation slice 3)
// Spec: docs/specs/invoice-generation-workflow.md section 3c.
// Lists work orders in the ACTIVE or COMPLETED category (by category, never by status number) that belong to a
// customer marked "PO required" and have an empty PO number, oldest first, with days waiting. The PO is entered
// right from the list (same save as the work order screen's inline PO entry). Customers whose "PO required"
// attribute is not set yet are listed with a Required / Not required prompt.
// A PO is "live" only when the PO number field on the work order is populated.

function poRemCust(wo) { return AppState.customers.find(function(c){ return c.id === wo.customer_id; }); }

function poRemOpenWOs() {
  return AppState.workOrders.filter(function(w) {
    if (w.active === false || !w.customer_id) return false;
    var cat = statusCat(w.status);
    return cat === 'active' || cat === 'completed';
  });
}

function poRemCompute() {
  var missing = [], unknown = {};
  poRemOpenWOs().forEach(function(w) {
    var c = poRemCust(w); if (!c) return;
    if (c.po_required === true && !(w.po_number || '').trim()) missing.push(w);
    else if (c.po_required === null || c.po_required === undefined) {
      if (!unknown[c.id]) unknown[c.id] = { cust: c, count: 0 };
      unknown[c.id].count++;
    }
  });
  missing.sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
  var unk = Object.keys(unknown).map(function(k){ return unknown[k]; })
    .sort(function(a, b){ return getCustName(a.cust).localeCompare(getCustName(b.cust)); });
  return { missing: missing, unknown: unk };
}

// Called by the Daily Dashboard after it renders (admin only)
function poReminderRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  var d = poRemCompute();
  var badge = document.getElementById('mb-badge-poreminder');
  if (badge) badge.textContent = d.missing.length + ' missing' + (d.unknown.length ? ' · ' + d.unknown.length + ' to set' : '');
  var html = '';
  if (!d.missing.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center;margin-bottom:8px">No work orders are waiting on a PO.</div>';
  } else {
    html += '<table class="dt-table" style="width:100%"><thead><tr><th>WO</th><th>Customer</th><th>Title</th><th>Waiting</th><th>PO number</th><th></th></tr></thead><tbody>';
    d.missing.forEach(function(w) {
      var days = Math.max(0, Math.floor((Date.now() - new Date(w.created_at).getTime()) / 86400000));
      html += '<tr><td style="font-weight:600">' + escHtml(w.wo_number) + '</td>'
        + '<td>' + escHtml(getCustName(poRemCust(w))) + '</td>'
        + '<td>' + escHtml(w.title) + '</td>'
        + '<td style="color:' + (days > 14 ? '#c0392b' : 'inherit') + ';font-weight:' + (days > 14 ? '600' : '400') + '">' + days + 'd</td>'
        + '<td style="white-space:nowrap"><input type="text" id="po-rem-' + w.id + '" placeholder="Enter PO" onkeydown="if(event.key===\'Enter\')poRemSave(\'' + w.id + '\',\'' + shellId + '\')" style="width:110px;font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm)"> '
        + '<button onclick="poRemSave(\'' + w.id + '\',\'' + shellId + '\')" style="font-size:12px;padding:4px 10px;border:none;border-radius:var(--radius-sm);background:var(--header-bg);color:#fff;cursor:pointer">Save</button></td>'
        + '<td><button onclick="openWODetail(\'' + w.id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td></tr>';
    });
    html += '</tbody></table>';
  }
  if (d.unknown.length) {
    html += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:14px 0 6px">PO requirement not set</div>';
    d.unknown.forEach(function(u) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--border);font-size:13px">'
        + '<span style="flex:1">' + escHtml(getCustName(u.cust)) + ' <span style="color:var(--text-muted)">(' + u.count + ' open work order' + (u.count === 1 ? '' : 's') + ')</span></span>'
        + '<button onclick="poRemSetReq(\'' + u.cust.id + '\',true,\'' + shellId + '\')" style="font-size:12px;padding:4px 10px;border:1px solid #c0392b;color:#c0392b;border-radius:var(--radius-sm);background:none;cursor:pointer">PO required</button>'
        + '<button onclick="poRemSetReq(\'' + u.cust.id + '\',false,\'' + shellId + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Not required</button></div>';
    });
  }
  shell.innerHTML = html;
}

function poRemSave(woId, shellId) {
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; }); if (!wo) return;
  var inp = document.getElementById('po-rem-' + woId);
  var po = inp ? inp.value.trim() : '';
  if (!po) { showToast('Enter a PO number'); return; }
  if (validatePONumber(po).needsFlag) { showToast('"need" is not a valid PO number'); return; }
  sb.patch('work_orders', woId, { po_number: po, flag_needs_po: false, flag_needs_po_note: null, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error saving PO'); return; }
    wo.po_number = po; wo.flag_needs_po = false; wo.flag_needs_po_note = null;
    showToast('PO saved for ' + wo.wo_number);
    poReminderRender(shellId);
    if (typeof renderDesktopGrid === 'function') renderDesktopGrid();
  });
}

function poRemSetReq(custId, required, shellId) {
  sb.patch('customers', custId, { po_required: required, modified_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error updating customer'); return; }
    var c = AppState.customers.find(function(x){ return x.id === custId; });
    if (c) c.po_required = required;
    showToast(required ? 'PO required set' : 'No PO needed set');
    poReminderRender(shellId);
  });
}
