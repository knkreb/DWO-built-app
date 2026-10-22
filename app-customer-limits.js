// app-customer-limits.js — Customer parent link and per-customer limits settings (v5.09, slice 1)
// Spec: docs/specs/customer-thresholds-and-carryover.md (slice 1)
// Settings and the parent link ONLY. No warnings, alerts or indicators fire yet (slices 2 and 3).
// Parent link: customers.parent_customer_id already existed (unused). One level only: a parent has no parent,
// and a customer with children cannot be given a parent. Limits live on the "owner": the parent when a
// customer has one, otherwise the customer itself (table customer_thresholds, one row per owner).
// Admin only (RLS enforces it too).

var CL = { custId: null, row: null, parentId: null, ownLoaded: false };

function clCust(id) { return (AppState.customers || []).find(function(c) { return c.id === id; }); }
function clName(c) {
  if (!c) return '';
  return (AppState.settings.customer_display_preference || 'display_name') === 'name' ? c.name : (c.display_name || c.name);
}
function clChildren(id) {
  return (AppState.customers || []).filter(function(c) { return c.parent_customer_id === id && c.active !== false; });
}
function clIsAdmin() { return AppState.userRole === 'admin'; }
function clNum(id) { var v = parseFloat((document.getElementById(id) || {}).value); return isNaN(v) ? null : v; }
function clChk(id) { return !!(document.getElementById(id) || {}).checked; }
function clVal(id) { return (document.getElementById(id) || {}).value || ''; }

// ── Customers list hooks (called from app-core.js filterCustomerRows) ────
function clRowBadge(c) {
  var kids = clChildren(c.id).length;
  if (kids) return ' <span style="font-size:10px;font-weight:700;color:var(--header-bg);border:1px solid var(--header-bg);border-radius:3px;padding:1px 5px;margin-left:4px">PARENT · ' + kids + '</span>';
  var p = c.parent_customer_id ? clCust(c.parent_customer_id) : null;
  if (p) return '<div style="font-size:11px;font-weight:400;color:var(--text-muted)">↳ ' + escHtml(clName(p)) + '</div>';
  return '';
}
function clRowButton(c) {
  if (!clIsAdmin()) return '';
  return '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--header-bg);border-radius:3px;background:none;color:var(--header-bg);cursor:pointer" data-clid="' + c.id + '" onclick="openCustomerLimits(this.getAttribute(\'data-clid\'))">Limits</button>';
}

// ── Sheet ────────────────────────────────────────────────────────────────
function clEnsureSheet() {
  var el = document.getElementById('cl-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'cl-sheet';
  el.onclick = function(e) { if (e.target === el) closeCustomerLimits(); };
  el.innerHTML = '<div class="bottom-sheet" style="max-height:92vh;overflow-y:auto"><div class="sheet-header"><h3 id="cl-title">Limits</h3><button class="sheet-close" onclick="closeCustomerLimits()">✕</button></div><div id="cl-body" style="padding:16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function closeCustomerLimits() { var el = document.getElementById('cl-sheet'); if (el) el.classList.remove('open'); }

function openCustomerLimits(custId) {
  if (!clIsAdmin()) { showToast('Admin only'); return; }
  var c = clCust(custId); if (!c) return;
  CL.custId = custId; CL.row = null; CL.parentId = c.parent_customer_id || null; CL.ownLoaded = false;
  clEnsureSheet().classList.add('open');
  document.getElementById('cl-title').textContent = clName(c);
  document.getElementById('cl-body').innerHTML = '<div style="color:var(--text-muted);font-size:13px">Loading…</div>';
  sb.get('customer_thresholds', '?customer_id=eq.' + custId + '&active=eq.true').then(function(r) {
    if (CL.custId !== custId) return;
    if (!r.ok) { document.getElementById('cl-body').innerHTML = '<div style="color:var(--danger);font-size:13px">Could not load limits. Has the v5.09 migration been run?</div>'; return; }
    CL.row = (r.data && r.data[0]) || null; CL.ownLoaded = true;
    clRender();
  });
}

// ── Parent picker ────────────────────────────────────────────────────────
function clParentEligible(c, q) {
  if (c.active === false || c.qbo_customer_id === 'SYSTEM' || c.id === CL.custId) return false;
  if (c.parent_customer_id) return false; // one level only
  if (!q) return true;
  return (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.display_name || '').toLowerCase().indexOf(q) >= 0;
}
function clParentSearch(val) {
  var q = (val || '').toLowerCase().trim(), box = document.getElementById('cl-pick-results'); if (!box) return;
  if (!q) { box.style.display = 'none'; return; }
  var hits = (AppState.customers || []).filter(function(c) { return clParentEligible(c, q); })
    .sort(function(a, b) { return a.name.localeCompare(b.name); }).slice(0, 12);
  box.style.display = 'block';
  box.innerHTML = hits.length ? hits.map(function(c) {
    return '<div style="padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)" data-pid="' + c.id + '" onclick="clPickParent(this.getAttribute(\'data-pid\'))">' + escHtml(c.name) + '</div>';
  }).join('') : '<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">No eligible customers match</div>';
}
function clPickParent(id) { CL.parentId = id; clRender(); }
function clClearParent() { CL.parentId = null; clRender(); }

// ── Limits form pieces ───────────────────────────────────────────────────
function clD(key, def) { var r = CL.row; return (r && r[key] !== null && r[key] !== undefined) ? r[key] : def; }

function clLevelHtml(pre, n) {
  var k = pre + '_l' + n;
  var en = clD(k + '_enabled', true), ty = clD(k + '_type', 'percent'), di = clD(k + '_direction', 'spent'), va = clD(k + '_value', n === 1 ? 75 : 100);
  var sel = 'font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface)';
  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">'
    + '<label style="font-size:12px;display:flex;align-items:center;gap:4px;min-width:74px"><input type="checkbox" id="cl-' + k + '-en"' + (en ? ' checked' : '') + '> Level ' + n + '</label>'
    + '<input type="number" min="0" step="any" id="cl-' + k + '-val" value="' + escHtml(String(va)) + '" style="width:80px;font-size:12px;padding:4px 6px">'
    + '<select id="cl-' + k + '-type" style="' + sel + '"><option value="percent"' + (ty === 'percent' ? ' selected' : '') + '>% of limit</option><option value="dollar"' + (ty === 'dollar' ? ' selected' : '') + '>$ amount</option></select>'
    + '<select id="cl-' + k + '-dir" style="' + sel + '"><option value="spent"' + (di === 'spent' ? ' selected' : '') + '>spent</option><option value="remaining"' + (di === 'remaining' ? ' selected' : '') + '>remaining</option></select>'
    + '</div>';
}

function clLimitsHtml() {
  var h = '';
  h += '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-top:12px">'
    + '<label style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px"><input type="checkbox" id="cl-nte-en"' + (clD('nte_enabled', false) ? ' checked' : '') + '> NTE (not to exceed)</label>'
    + '<div style="font-size:11px;color:var(--text-muted);margin:2px 0 6px">Caps spend on this customer. Warnings are not live yet (next build).</div>'
    + '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:12px">Limit $</span><input type="number" min="0" step="any" id="cl-nte-amt" value="' + escHtml(String(clD('nte_amount', ''))) + '" style="width:120px;font-size:12px;padding:4px 6px"></div>'
    + clLevelHtml('nte', 1) + clLevelHtml('nte', 2) + '</div>';
  h += '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-top:12px">'
    + '<label style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px"><input type="checkbox" id="cl-cap-en"' + (clD('capex_enabled', false) ? ' checked' : '') + '> CapEx threshold</label>'
    + '<div style="font-size:11px;color:var(--text-muted);margin:2px 0 6px">Never stops work. Warns the job is nearing the line where it must be split or approved. Not live yet.</div>'
    + '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:12px">Threshold $</span><input type="number" min="0" step="any" id="cl-cap-amt" value="' + escHtml(String(clD('capex_threshold', ''))) + '" style="width:120px;font-size:12px;padding:4px 6px"></div>'
    + clLevelHtml('capex', 1) + clLevelHtml('capex', 2)
    + '<div style="display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap"><label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="cl-cap-min-en"' + (clD('capex_min_enabled', false) ? ' checked' : '') + '> Minimum to bill as capital $</label>'
    + '<input type="number" min="0" step="any" id="cl-cap-min" value="' + escHtml(String(clD('capex_min_amount', ''))) + '" style="width:120px;font-size:12px;padding:4px 6px"></div></div>';
  return h;
}

function clRender() {
  var c = clCust(CL.custId), body = document.getElementById('cl-body'); if (!c || !body) return;
  var kids = clChildren(c.id), parent = CL.parentId ? clCust(CL.parentId) : null;
  var h = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">' + escHtml(c.name) + '</div>';

  // Parent section
  h += '<div class="form-label">Parent account</div>';
  if (kids.length) {
    h += '<div style="font-size:12px;color:var(--text-muted)">This is a parent account with ' + kids.length + ' site' + (kids.length === 1 ? '' : 's') + ' under it, so it cannot be given a parent.</div>';
  } else {
    h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Optional. Only for customers with several related site accounts. A parent shares its limits with all its sites.</div>';
    if (parent) {
      h += '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:12px;padding:3px 10px;background:var(--bg)">' + escHtml(parent.name) + '</span>'
        + '<button style="font-size:11px;border:none;background:none;color:var(--danger);cursor:pointer" onclick="clClearParent()">Remove</button></div>';
    } else {
      h += '<input type="search" id="cl-pick-search" placeholder="Search for a parent customer…" autocomplete="off" oninput="clParentSearch(this.value)" style="width:100%;box-sizing:border-box">'
        + '<div id="cl-pick-results" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);margin-top:4px"></div>';
    }
  }

  // Limits section
  if (parent) {
    h += '<div style="margin-top:16px;padding:10px;border:1px dashed var(--border);border-radius:var(--radius);font-size:13px">Limits for this site are set on the parent account, <b>' + escHtml(parent.name) + '</b>.'
      + (CL.row ? ' <span style="color:var(--text-muted)">(This customer has limits of its own saved; they are ignored while it has a parent.)</span>' : '')
      + (parent.id !== c.parent_customer_id ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Save first, then open the parent to edit its limits.</div>' : '<div style="margin-top:6px"><button class="btn-dark" style="font-size:12px;padding:4px 10px" onclick="openCustomerLimits(\'' + parent.id + '\')">Edit parent limits</button></div>')
      + '</div>';
  } else {
    h += clLimitsHtml();
  }
  h += '<button class="save-btn" style="margin-top:16px" onclick="clSave()">Save</button>';
  body.innerHTML = h;
}

// ── Save ─────────────────────────────────────────────────────────────────
function clReadLimits() {
  var o = {
    nte_enabled: clChk('cl-nte-en'), nte_amount: clNum('cl-nte-amt'),
    capex_enabled: clChk('cl-cap-en'), capex_threshold: clNum('cl-cap-amt'),
    capex_min_enabled: clChk('cl-cap-min-en'), capex_min_amount: clNum('cl-cap-min')
  };
  ['nte', 'capex'].forEach(function(pre) {
    [1, 2].forEach(function(n) {
      var k = pre + '_l' + n;
      o[k + '_enabled'] = clChk('cl-' + k + '-en');
      o[k + '_type'] = clVal('cl-' + k + '-type') || 'percent';
      o[k + '_direction'] = clVal('cl-' + k + '-dir') || 'spent';
      o[k + '_value'] = clNum('cl-' + k + '-val');
    });
  });
  return o;
}

function clValidate(o) {
  if (o.nte_enabled && !(o.nte_amount > 0)) return 'Enter the NTE limit amount';
  if (o.capex_enabled && !(o.capex_threshold > 0)) return 'Enter the CapEx threshold amount';
  if (o.capex_min_enabled && !(o.capex_min_amount > 0)) return 'Enter the CapEx minimum amount';
  var msg = '';
  [['nte', o.nte_enabled], ['capex', o.capex_enabled]].forEach(function(p) {
    [1, 2].forEach(function(n) {
      var k = p[0] + '_l' + n, v = o[k + '_value'];
      if (!(v > 0)) msg = msg || 'Every warning level needs a value above zero';
      else if (o[k + '_type'] === 'percent' && v > 100) msg = msg || 'A percent level cannot be above 100';
    });
  });
  return msg;
}

function clSave() {
  var c = clCust(CL.custId); if (!c) return;
  var parentChanged = (CL.parentId || null) !== (c.parent_customer_id || null);
  var parent = CL.parentId ? clCust(CL.parentId) : null;
  var limits = null;
  if (!parent) {
    limits = clReadLimits();
    var err = clValidate(limits);
    if (err) { showToast(err); return; }
  }
  if (parentChanged && parent && CL.row && (CL.row.nte_enabled || CL.row.capex_enabled)) {
    if (!confirm(clName(c) + ' has limits of its own. They will be ignored while it has a parent account. Continue?')) return;
  }
  var steps = Promise.resolve(true);
  if (parentChanged) {
    steps = sb.patch('customers', c.id, { parent_customer_id: CL.parentId || null, modified_by: AppState.userEmail }).then(function(r) {
      if (r.ok) { c.parent_customer_id = CL.parentId || null; return true; }
      showToast('Error saving parent'); return false;
    });
  }
  steps.then(function(ok) {
    if (!ok) return;
    if (!limits) { finish(); return; }
    var body = Object.assign({}, limits, { label: clName(c), modified_by: AppState.userEmail });
    var req = CL.row
      ? sb.patch('customer_thresholds', CL.row.id, body)
      : sb.post('customer_thresholds', Object.assign({ customer_id: c.id, created_by: AppState.userEmail }, body));
    req.then(function(r) {
      if (r.ok) { finish(); } else showToast('Error saving limits');
    });
  });
  function finish() {
    showToast('Saved');
    closeCustomerLimits();
    if (typeof filterCustomerRows === 'function') filterCustomerRows();
  }
}
