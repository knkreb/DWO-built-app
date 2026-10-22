// app-customer-limits.js — Customer parent link and per-customer limits settings (v5.09, slice 1)
// Spec: docs/specs/customer-thresholds-and-carryover.md (slice 1)
// Settings and the parent link ONLY. No warnings, alerts or indicators fire yet (slices 2 and 3).
// Parent link: customers.parent_customer_id already existed (unused). One level only: a parent has no parent,
// and a customer with children cannot be given a parent. Limits live on the "owner": the parent when a
// customer has one, otherwise the customer itself (table customer_thresholds, one row per owner).
// Admin only (RLS enforces it too).
// v5.10: compact one-line layout, sheet opens from the top, inline errors, parent is read-only and set automatically
// from the QBO "Parent:Child" name (clAutoLink), "Apply to open work orders" hook (app-wo-nte.js).

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
  /* v5.13 was: return '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--header-bg);border-radius:3px;background:none;color:var(--header-bg);cursor:pointer" data-clid="' + c.id + '" onclick="openCustomerLimits(this.getAttribute(\'data-clid\'))">Limits</button>'; */
  return '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--header-bg);border-radius:3px;background:none;color:var(--header-bg);cursor:pointer" data-clid="' + c.id + '" onclick="openCustomerLimits(this.getAttribute(\'data-clid\'))">Limits</button>' + (typeof coRowButton === 'function' ? coRowButton(c) : ''); // v5.13: Carryover button next to Limits (app-carryover.js)
}

// ── Sheet ────────────────────────────────────────────────────────────────
function clEnsureSheet() {
  var el = document.getElementById('cl-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'cl-sheet';
  el.onclick = function(e) { if (e.target === el) closeCustomerLimits(); };
  el.style.alignItems = 'flex-start'; // v5.10: opens from the top, not up from the bottom
  /* v5.09 was: el.innerHTML = '<div class="bottom-sheet" style="max-height:92vh;overflow-y:auto"><div class="sheet-header"><h3 id="cl-title">Limits</h3><button class="sheet-close" onclick="closeCustomerLimits()">✕</button></div><div id="cl-body" style="padding:16px"></div></div>'; */
  el.innerHTML = '<div class="bottom-sheet" style="max-width:620px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="cl-title">Limits</h3><button class="sheet-close" onclick="closeCustomerLimits()">✕</button></div><div id="cl-body" style="padding:14px 16px"></div></div>';
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

/* REMOVED v5.10 — 2026-10-21 — manual parent picker. Parent is now read-only and set automatically from the name (clAutoLink). Kept for reference.
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
*/

// ── Limits form pieces ───────────────────────────────────────────────────
/* v5.09 was: function clD(key, def) { var r = CL.row; ... } */
function clD(key, def, row) { var r = row === undefined ? CL.row : row; return (r && r[key] !== null && r[key] !== undefined) ? r[key] : def; }

/* SUPERSEDED v5.10 — 2026-10-21 — stacked layout (clLevelHtml, clLimitsHtml, clRender). Replaced by the compact versions below. Kept for reference.
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
*/

// ── v5.10 compact layout ─────────────────────────────────────────────────
// Global CSS sets input,select{width:100%}, so every control here carries an explicit width.
var CL_CHK = 'width:auto;flex:none;margin:0';
var CL_INP = 'width:84px;flex:none;font-size:12px;padding:4px 6px;box-sizing:border-box';
var CL_SEL = 'flex:none;font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface);box-sizing:border-box';

// One level on one line. ip = id prefix ('cl-' customer sheet, 'won-' work order sheet), row = saved values.
function clLevelHtml(pre, n, row, ip) {
  ip = ip || 'cl-';
  var k = pre + '_l' + n;
  var en = clD(k + '_enabled', true, row), ty = clD(k + '_type', 'percent', row), di = clD(k + '_direction', 'spent', row), va = clD(k + '_value', n === 1 ? 75 : 100, row);
  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">'
    + '<input type="checkbox" id="' + ip + k + '-en" style="' + CL_CHK + '"' + (en ? ' checked' : '') + '>'
    + '<span style="font-size:12px;width:48px;flex:none">Level ' + n + '</span>'
    + '<input type="number" min="0" step="any" id="' + ip + k + '-val" value="' + escHtml(String(va)) + '" style="' + CL_INP + '">'
    + '<select id="' + ip + k + '-type" style="' + CL_SEL + ';width:104px"><option value="percent"' + (ty === 'percent' ? ' selected' : '') + '>% of limit</option><option value="dollar"' + (ty === 'dollar' ? ' selected' : '') + '>$ amount</option></select>'
    + '<select id="' + ip + k + '-dir" style="' + CL_SEL + ';width:96px"><option value="spent"' + (di === 'spent' ? ' selected' : '') + '>spent</option><option value="remaining"' + (di === 'remaining' ? ' selected' : '') + '>remaining</option></select>'
    + '</div>';
}

// Section header: checkbox + title on the left (a real header), nothing floating on the right.
function clSectionHead(id, checked, title) {
  return '<label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px;cursor:pointer">'
    + '<input type="checkbox" id="' + id + '" style="' + CL_CHK + '"' + (checked ? ' checked' : '') + '>' + title + '</label>';
}
function clAmountRow(label, id, val) {
  return '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:12px;width:76px;flex:none">' + label + '</span>'
    + '<input type="number" min="0" step="any" id="' + id + '" value="' + escHtml(String(val)) + '" style="width:120px;flex:none;font-size:12px;padding:4px 6px;box-sizing:border-box"></div>';
}
var CL_BOX = 'border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-top:12px';

function clLimitsHtml() {
  var h = '';
  h += '<div style="' + CL_BOX + '">' + clSectionHead('cl-nte-en', clD('nte_enabled', false), 'NTE (not to exceed)')
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Caps spend on this customer. New T&amp;M work orders start with these numbers; each work order can be changed on its own.</div>'
    + clAmountRow('Limit $', 'cl-nte-amt', clD('nte_amount', ''))
    + clLevelHtml('nte', 1) + clLevelHtml('nte', 2)
    + (typeof woNteApplyHtml === 'function' ? woNteApplyHtml(CL.custId) : '') + '</div>';
  h += '<div style="' + CL_BOX + '">' + clSectionHead('cl-cap-en', clD('capex_enabled', false), 'CapEx threshold')
    /* v5.12 was: Never stops work. Warns the job is nearing the line where it must be split or approved. Not live yet. */
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Never stops work. A T&amp;M work order not tagged CapEx is warned as it nears the threshold, so it can be split or tagged. Tag CapEx by hand on the work order. The minimum flags a CapEx-tagged work order that is completed under it. Applies to every work order live; nothing is copied.</div>'
    + clAmountRow('Threshold $', 'cl-cap-amt', clD('capex_threshold', ''))
    + clLevelHtml('capex', 1) + clLevelHtml('capex', 2)
    + '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap"><input type="checkbox" id="cl-cap-min-en" style="' + CL_CHK + '"' + (clD('capex_min_enabled', false) ? ' checked' : '') + '><span style="font-size:12px">Minimum to bill as capital $</span>'
    + '<input type="number" min="0" step="any" id="cl-cap-min" value="' + escHtml(String(clD('capex_min_amount', ''))) + '" style="width:110px;flex:none;font-size:12px;padding:4px 6px;box-sizing:border-box"></div></div>';
  return h;
}

function clErr(msg) {
  var el = document.getElementById('cl-err'); if (!el) return;
  el.textContent = msg || '';
  if (msg && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function clRender() {
  var c = clCust(CL.custId), body = document.getElementById('cl-body'); if (!c || !body) return;
  var kids = clChildren(c.id), parent = c.parent_customer_id ? clCust(c.parent_customer_id) : null;
  var h = '<div style="font-size:12px;color:var(--text-muted)">' + escHtml(c.name) + '</div>';

  // Parent: read-only, set automatically from the name
  h += '<div style="margin-top:10px;font-size:13px">';
  if (kids.length) {
    h += '<b>Parent account</b> with ' + kids.length + ' site' + (kids.length === 1 ? '' : 's') + ' under it. Sites are linked from the QBO name (Parent:Child) and share these limits.';
  } else if (parent) {
    h += '<b>Parent:</b> ' + escHtml(parent.name) + ' <span style="font-size:11px;color:var(--text-muted)">(set from the name)</span>';
  } else {
    h += '<span style="color:var(--text-muted)">No parent account. A parent is linked automatically when the name is Parent:Child and the parent exists.</span>';
  }
  h += '</div>';

  if (parent) {
    h += '<div style="margin-top:12px;padding:10px;border:1px dashed var(--border);border-radius:var(--radius);font-size:13px">Limits for this site are set on the parent account, <b>' + escHtml(parent.name) + '</b>.'
      + (CL.row ? ' <span style="color:var(--text-muted)">(This customer has limits of its own saved; they are ignored while it has a parent.)</span>' : '')
      + '<div style="margin-top:6px"><button class="btn-dark" style="font-size:12px;padding:4px 10px" onclick="openCustomerLimits(\'' + parent.id + '\')">Edit parent limits</button></div></div>';
    h += '<div style="margin-top:12px"><button class="btn-dark" onclick="closeCustomerLimits()">Close</button></div>';
  } else {
    h += clLimitsHtml();
    h += '<div id="cl-err" style="color:var(--danger);font-size:12px;font-weight:600;min-height:16px;margin-top:12px"></div>';
    h += '<button class="save-btn" style="margin-top:4px" onclick="clSave()">Save</button>';
  }
  body.innerHTML = h;
}

// ── Parent link from the name ────────────────────────────────────────────
// QBO names are "Parent:Child". Parent = everything before the LAST colon, matched case-insensitively against
// exactly one active customer. One level only (a parent has no parent; a site has no sites).
function clParentName(name) { var i = (name || '').lastIndexOf(':'); return i > 0 ? name.slice(0, i) : ''; }
function clActiveByName(lname) {
  return (AppState.customers || []).filter(function(x) { return x.active !== false && (x.name || '').toLowerCase() === lname; });
}
function clLinkOne(child, pid) {
  return sb.patch('customers', child.id, { parent_customer_id: pid, modified_by: AppState.userEmail }).then(function(r) {
    if (r.ok) { child.parent_customer_id = pid; return 1; }
    return 0;
  });
}
// Call after a customer is added or renamed. Links it to its parent, and (if it is a parent) links waiting sites.
function clAutoLink(c) {
  if (!c || c.active === false || (c.name || '').toLowerCase().indexOf('(deleted)') >= 0) return Promise.resolve(0);
  var jobs = [];
  var pn = clParentName(c.name).toLowerCase();
  if (pn && !clChildren(c.id).length) {
    var m = clActiveByName(pn).filter(function(x) { return x.id !== c.id; });
    if (m.length === 1 && !m[0].parent_customer_id && c.parent_customer_id !== m[0].id) jobs.push(function() { return clLinkOne(c, m[0].id); });
  }
  if (!jobs.length && !c.parent_customer_id && clActiveByName((c.name || '').toLowerCase()).length === 1) {
    var mine = (c.name || '').toLowerCase();
    (AppState.customers || []).forEach(function(x) {
      if (x.active === false || x.id === c.id || x.parent_customer_id || (x.name || '').toLowerCase().indexOf('(deleted)') >= 0) return;
      if (clParentName(x.name).toLowerCase() === mine && !clChildren(x.id).length) jobs.push(function() { return clLinkOne(x, c.id); });
    });
  }
  if (!jobs.length) return Promise.resolve(0);
  return jobs.reduce(function(p, j) { return p.then(function(n) { return j().then(function(k) { return n + k; }); }); }, Promise.resolve(0)).then(function(n) {
    if (n) {
      showToast('Parent link set (' + n + ')');
      if (typeof filterCustomerRows === 'function') filterCustomerRows();
    }
    return n;
  });
}

// ── Save ─────────────────────────────────────────────────────────────────
/* v5.09 was: clReadLimits looped the level fields inline; now uses clReadLevels. */
function clReadLimits() {
  var o = {
    nte_enabled: clChk('cl-nte-en'), nte_amount: clNum('cl-nte-amt'),
    capex_enabled: clChk('cl-cap-en'), capex_threshold: clNum('cl-cap-amt'),
    capex_min_enabled: clChk('cl-cap-min-en'), capex_min_amount: clNum('cl-cap-min')
  };
  ['nte', 'capex'].forEach(function(pre) { Object.assign(o, clReadLevels(pre, 'cl-')); });
  return o;
}
// v5.10: level fields for one block, reusable by the work order sheet (ip = 'won-')
function clReadLevels(pre, ip) {
  var o = {};
  [1, 2].forEach(function(n) {
    var k = pre + '_l' + n;
    o[k + '_enabled'] = clChk(ip + k + '-en');
    o[k + '_type'] = clVal(ip + k + '-type') || 'percent';
    o[k + '_direction'] = clVal(ip + k + '-dir') || 'spent';
    o[k + '_value'] = clNum(ip + k + '-val');
  });
  return o;
}
// Level values must always be valid (the table requires them even when the block is off).
function clValidateLevels(o, pre) {
  var msg = '';
  [1, 2].forEach(function(n) {
    var k = pre + '_l' + n, v = o[k + '_value'];
    if (!(v > 0)) msg = msg || 'Every warning level needs a value above zero';
    else if (o[k + '_type'] === 'percent' && v > 100) msg = msg || 'A percent level cannot be above 100';
  });
  return msg;
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
  if (c.parent_customer_id && clCust(c.parent_customer_id)) { closeCustomerLimits(); return; } // limits live on the parent
  clErr('');
  var limits = clReadLimits();
  var err = clValidate(limits);
  if (err) { clErr(err); return; }
  var body = Object.assign({}, limits, { label: clName(c), modified_by: AppState.userEmail });
  var prevRow = CL.row; // v5.11: the limits as they were before this save, to tell whether the NTE changed
  var req = CL.row
    ? sb.patch('customer_thresholds', CL.row.id, body)
    : sb.post('customer_thresholds', Object.assign({ customer_id: c.id, created_by: AppState.userEmail }, body));
  req.then(function(r) {
    if (!r.ok) { clErr('Error saving limits. Nothing was changed.'); return; }
    showToast('Saved');
    closeCustomerLimits();
    if (typeof filterCustomerRows === 'function') filterCustomerRows();
    if (typeof woNteAfterCustomerSave === 'function') woNteAfterCustomerSave(c.id, prevRow, limits); // v5.11: offer to apply a changed NTE to open work orders
  });
}

/* SUPERSEDED v5.10 — 2026-10-21 — v5.09 clSave (saved the manual parent choice and used toasts for errors). Kept for reference.
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
  ...(parent patch, confirm, upsert, finish)
}
*/
