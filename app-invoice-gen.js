// app-invoice-gen.js — Customer invoice generation workflow (v4.94, slice 1)
// Spec: docs/specs/invoice-generation-workflow.md
// Slice 1 covers: in-progress review (step 2), scope pick + move to Batch Invoice Process (step 3),
// run state in invoice_runs (one active run), progress bar + batch counter ribbon, drop/cancel/finish,
// and the Zed Axis export launch (step 9). Steps 4-8, 10 (acceptance) and 11 come in later slices.
//
// ORIGIN: initInvoicingPanel() MOVED here from app-core.js — v4.94 — 2026-10-04.
//
// Customization rule: statuses are found by system_key or category, never by number or name.
//   ready to bill = category 'completed'; in-run = system_key 'batch_invoice'.

var INV_STEPS = [
  'Trigger', 'Review in-progress', 'Pick scope', 'Vendor invoices', 'Billable time', 'Days accepted',
  'Coalesce', 'Line-item review', 'Export', 'Accept', 'Finish'
];
var INV_STATE = { view: 'entry', scopeType: 'all', custSel: {}, excluded: {} };

// ---------- status lookups (no hardcoded numbers) ----------
function invStatusNum(key) { var s = getStatusByKey(key); return s ? s.num : null; }

function invSetupWarning() {
  var missing = [];
  var hasCompletedCat = (AppState.statuses || []).some(function(s){ return s.category === 'completed' && s.active !== false; });
  if (!hasCompletedCat) missing.push('a status in the Completed category');
  if (invStatusNum('batch_invoice') == null) missing.push('the "batch_invoice" status');
  if (!missing.length) return '';
  return '<div style="background:#c0392b18;border:1px solid #c0392b;border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:13px;color:#c0392b">'
    + '<b>Setup needed:</b> invoice generation needs ' + missing.join(' and ') + '. Add or restore it in Settings &rarr; Statuses before starting a run.</div>';
}

function invIsReady(wo) { return wo.active !== false && statusCat(wo.status) === 'completed'; }
function invIsActiveCat(wo) { return wo.active !== false && statusCat(wo.status) === 'active'; }
function invInBatch(wo) { var b = invStatusNum('batch_invoice'); return b != null && wo.active !== false && wo.status === b; }

// ---------- lock: status 11 is closed to everyone except the person running the invoice ----------
function invWoLockedForMe(wo) {
  if (!wo || !isProcessedStatus(wo.status)) return false;
  var run = AppState.invRun, b = invStatusNum('batch_invoice');
  if (run && b != null && wo.status === b && run.started_by === AppState.userEmail
      && (run.wo_ids || []).indexOf(wo.id) >= 0) return false;
  return true;
}

// ---------- run state ----------
function invLoadActiveRun() {
  return sb.get('invoice_runs', '?status=eq.active&select=*&limit=1').then(function(r) {
    AppState.invRun = (r.ok && r.data && r.data.length) ? r.data[0] : null;
    return AppState.invRun;
  });
}

function invPatchRun(fields) {
  var run = AppState.invRun; if (!run) return Promise.resolve({ ok: false });
  fields.modified_at = new Date().toISOString();
  fields.modified_by = AppState.userEmail;
  return sb.patch('invoice_runs', run.id, fields).then(function(r) {
    if (r.ok && r.data && r.data.length) AppState.invRun = (fields.status && fields.status !== 'active') ? null : r.data[0];
    return r;
  });
}

// Called from _buildXLSX (app-subforms.js) after a Zed export completes
function invRunMarkExported(woIds) {
  var run = AppState.invRun; if (!run) return;
  var inRun = (woIds || []).some(function(id){ return (run.wo_ids || []).indexOf(id) >= 0; });
  if (!inRun) return;
  var done = (run.steps_done || []).slice(); if (done.indexOf(9) < 0) done.push(9);
  invPatchRun({ exported_at: run.exported_at || new Date().toISOString(), step: 10, steps_done: done });
}

// ---------- money / display helpers ----------
function invMoney(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function invProj(wo) { return AppState.projectedCache[wo.id] || 0; }
function invCustName(wo) {
  var c = AppState.customers.find(function(x){ return x.id === wo.customer_id; });
  return getCustName(wo.customers) !== '---' ? getCustName(wo.customers) : (c ? getCustName(c) : '---');
}
function invAgeDays(wo) { return Math.max(0, Math.floor((Date.now() - new Date(wo.created_at).getTime()) / 86400000)); }
function invFindWO(id) { return AppState.workOrders.find(function(w){ return w.id === id; }); }
function invRunWOs(run) { return (run.wo_ids || []).map(invFindWO).filter(Boolean); }

function invBtn(label, onclick, kind, disabled) {
  var bg = kind === 'primary' ? 'var(--header-bg)' : (kind === 'danger' ? '#c0392b' : 'var(--surface)');
  var col = (kind === 'primary' || kind === 'danger') ? '#fff' : 'var(--text)';
  return '<button ' + (disabled ? 'disabled ' : '') + 'onclick="' + onclick + '" style="font-size:13px;padding:7px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);background:'
    + bg + ';color:' + col + ';cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';font-weight:600;opacity:' + (disabled ? '0.5' : '1') + '">' + label + '</button>';
}

// ---------- ribbon: progress bar + batch counter ----------
function invBatchStats() {
  var wos = AppState.workOrders.filter(invInBatch);
  return { count: wos.length, total: wos.reduce(function(s, w){ return s + invProj(w); }, 0) };
}

function invRibbonHtml(currentStep, doneSteps) {
  var done = doneSteps || [];
  var chips = INV_STEPS.map(function(label, i) {
    var n = i + 1, isDone = done.indexOf(n) >= 0, isCur = n === currentStep;
    var bg = isCur ? 'var(--header-bg)' : (isDone ? '#27ae6022' : 'var(--bg)');
    var col = isCur ? '#fff' : (isDone ? '#1e8449' : 'var(--text-muted)');
    return '<span style="font-size:11px;padding:4px 8px;border-radius:12px;border:1px solid var(--border);background:' + bg + ';color:' + col + ';white-space:nowrap;font-weight:' + (isCur ? '700' : '500') + '">'
      + n + '. ' + escHtml(label) + '</span>';
  }).join('');
  var st = invBatchStats();
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:8px 12px;margin-bottom:14px">'
    + '<div style="display:flex;gap:4px;flex-wrap:wrap">' + chips + '</div>'
    + '<div style="font-size:12px;font-weight:700;white-space:nowrap" title="Work orders currently in Batch Invoice Process">Batch Invoice Process: '
    + st.count + ' WO' + (st.count === 1 ? '' : 's') + ' &middot; ' + invMoney(st.total) + '</div>'
    + '</div>';
}

// ---------- shared work order table ----------
function invWoTable(wos, opts) {
  opts = opts || {};
  if (!wos.length) return '<div style="padding:18px;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:var(--radius)">' + escHtml(opts.empty || 'Nothing to show.') + '</div>';
  var head = '<tr>' + (opts.check ? '<th></th>' : '') + '<th>WO</th><th>Customer</th><th>Title</th><th>Status</th><th>Created</th><th>Age</th><th style="text-align:right">Amount</th><th></th></tr>';
  var rows = wos.map(function(wo) {
    var st = getStatus(wo.status), days = invAgeDays(wo);
    var tick = opts.check ? '<td><input type="checkbox" ' + (opts.check(wo) ? 'checked ' : '') + 'onchange="invToggleWO(\'' + wo.id + '\',this.checked)"></td>' : '';
    return '<tr>' + tick
      + '<td style="font-weight:600">' + escHtml(wo.wo_number) + '</td>'
      + '<td>' + escHtml(invCustName(wo)) + '</td>'
      + '<td>' + escHtml(wo.title) + '</td>'
      + '<td><span class="badge" style="background:' + st.color + '">' + escHtml(st.name) + '</span>' + (wo.exported_at ? ' <span style="font-size:11px;color:#1e8449">exported</span>' : '') + '</td>'
      + '<td>' + fmtDate(wo.created_at) + '</td>'
      + '<td style="color:' + (days > 30 ? '#c0392b' : 'inherit') + ';font-weight:' + (days > 30 ? '600' : '400') + '">' + days + 'd</td>'
      + '<td style="text-align:right">' + invMoney(invProj(wo)) + '</td>'
      + '<td style="white-space:nowrap;text-align:right">' + (opts.actions ? opts.actions(wo) : '') + '</td></tr>';
  }).join('');
  return '<table class="dt-table" style="width:100%"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
}

// ---------- render dispatcher ----------
function invHost() { return document.getElementById('invoicing-panel-body'); }

function initInvoicingPanel() {
  var el = invHost(); if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading...</div>';
  Promise.all([loadWorkOrders(), loadCustomers(), invLoadActiveRun()]).then(function() {
    return _ensureProjectedCache();
  }).then(function() {
    INV_STATE.view = 'entry';
    invRender();
  });
}

function invRender() {
  var el = invHost(); if (!el) return;
  var v = INV_STATE.view;
  if (v === 'review') el.innerHTML = invReviewHtml();
  else if (v === 'scope') el.innerHTML = invScopeHtml();
  else if (v === 'run' && AppState.invRun) el.innerHTML = invRunHtml();
  else el.innerHTML = invEntryHtml();
}

function invRefreshAndRender() {
  return Promise.all([loadWorkOrders(), invLoadActiveRun()]).then(function() {
    return _ensureProjectedCache();
  }).then(function() { invRender(); if (typeof renderDesktopGrid === 'function') renderDesktopGrid(); });
}

// ---------- entry screen ----------
function invEntryHtml() {
  var run = AppState.invRun;
  var out = '<div style="max-width:900px;padding:20px 0">'
    + '<div style="font-size:22px;font-weight:700;margin-bottom:6px">Customer Invoice Generation</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Build and review customer invoices by reconciling billable time and materials from the field.</div>';
  out += invSetupWarning();
  if (run) {
    var wos = invRunWOs(run), inB = wos.filter(invInBatch).length;
    out += invRibbonHtml(run.step, run.steps_done);
    out += '<div style="border:1px solid #e67e22;background:#e67e2212;border-radius:var(--radius);padding:14px 16px;margin-bottom:18px">'
      + '<div style="font-size:14px;font-weight:700;margin-bottom:4px">Invoice run in progress</div>'
      + '<div style="font-size:13px;margin-bottom:10px">Started ' + fmtDateWithTime(run.started_at) + ' by ' + escHtml(run.started_by) + ', at step ' + run.step + ' of ' + INV_STEPS.length
      + ' (' + escHtml(INV_STEPS[run.step - 1] || '') + '), ' + (run.wo_ids || []).length + ' work orders (' + inB + ' still in Batch Invoice Process).'
      + (run.exported_at ? ' Exported ' + fmtDateWithTime(run.exported_at) + '.' : '') + '</div>'
      + '<div style="display:flex;gap:8px">' + invBtn('Resume', 'invResume()', 'primary') + invBtn('Cancel run', 'invCancelRun()', 'danger') + '</div></div>';
  } else {
    var st = invBatchStats();
    if (st.count) {
      out += '<div style="border:1px solid #c0392b;background:#c0392b12;border-radius:var(--radius);padding:12px 16px;margin-bottom:18px;font-size:13px">'
        + '<b>' + st.count + ' work order' + (st.count === 1 ? ' is' : 's are') + ' in Batch Invoice Process (' + invMoney(st.total) + ') with no active run.</b> '
        + 'Something was interrupted or left behind. Resolve them from the Work Orders screen.</div>';
    }
    out += '<div style="margin-bottom:22px">' + invBtn('Start invoice run', 'invOpenReview()', 'primary', !!invSetupWarning()) + '</div>';
  }
  out += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Related tools</div>'
    + '<div style="display:flex;flex-direction:column;gap:12px;max-width:600px">'
    + '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;cursor:pointer;background:var(--surface)" onclick="desktopNav(\'reconcile\')">'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:4px">&#9878; Time &amp; Billing Reconciliation</div>'
    + '<div style="font-size:13px;color:var(--text-muted)">Review field time logs against billed hours. Resolve gaps, add travel time, and prepare billing data.</div></div>'
    + '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;cursor:pointer;background:var(--surface)" onclick="desktopNav(\'invoices\')">'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:4px">&#128441; Invoices &amp; Import</div>'
    + '<div style="font-size:13px;color:var(--text-muted)">Import vendor invoices and manage customer invoice records.</div></div>'
    + '</div></div>';
  return out;
}

function invResume() { INV_STATE.view = 'run'; invRefreshAndRender(); }

// ---------- step 2: in-progress review ----------
function invOpenReview() {
  if (AppState.invRun) { showToast('A run is already active'); return; }
  INV_STATE.view = 'review';
  invRefreshAndRender();
}

function invReviewHtml() {
  var wos = AppState.workOrders.filter(invIsActiveCat).sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
  var total = wos.reduce(function(s, w){ return s + invProj(w); }, 0);
  var out = '<div style="padding:20px 0">' + invRibbonHtml(2, [1]);
  out += '<div style="font-size:18px;font-weight:700;margin-bottom:4px">Step 2 &mdash; Review in-progress work orders</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Oldest first. Anything actually finished but never moved to Completed should be completed here so it is billed this run. '
    + wos.length + ' work orders &middot; ' + invMoney(total) + '</div>';
  out += invWoTable(wos, {
    empty: 'No in-progress work orders.',
    actions: function(wo) {
      return invBtn('Open', 'invOpenWO(\'' + wo.id + '\')') + ' ' + invBtn('Mark Completed', 'invMarkCompleted(\'' + wo.id + '\')');
    }
  });
  out += '<div style="display:flex;gap:8px;margin-top:16px">' + invBtn('&larr; Back', 'invBackToEntry()') + invBtn('Continue to scope &rarr;', 'invOpenScope()', 'primary') + '</div></div>';
  return out;
}

function invBackToEntry() { INV_STATE.view = 'entry'; invRender(); }

function invOpenWO(id) {
  if (typeof desktopNav === 'function') desktopNav('wo');
  openWODetail(id);
}

function invMarkCompleted(woId) {
  var wo = invFindWO(woId); if (!wo) return;
  var cSt = (AppState.statuses || []).filter(function(s){ return s.category === 'completed' && s.active !== false; })
    .sort(function(a, b){ return a.sort_order - b.sort_order; })[0];
  var cNum = invStatusNum('completed'); if (cNum == null && cSt) cNum = cSt.num;
  if (cNum == null) { showToast('No Completed status is set up'); return; }
  Promise.all([
    sb.get('hours_entries', '?work_order_id=eq.' + woId + '&active=eq.true&select=id&limit=1'),
    sb.get('line_items', '?work_order_id=eq.' + woId + '&active=eq.true&select=id&limit=1')
  ]).then(function(res) {
    var hasH = res[0].ok && res[0].data && res[0].data.length > 0;
    var hasL = res[1].ok && res[1].data && res[1].data.length > 0;
    if (!hasH && !hasL) { showToast('Cannot complete — no hours or parts/services entries found'); return; }
    if (!hasH && !confirm('No hours entries on ' + wo.wo_number + '. Mark as completed anyway?')) return;
    if (!hasL && !confirm('No parts/services entries on ' + wo.wo_number + '. Mark as completed anyway?')) return;
    var upd = { status: cNum, modified_by: AppState.userEmail };
    if (!wo.completed_at) upd.completed_at = new Date().toISOString();
    sb.patch('work_orders', woId, upd).then(function(r) {
      if (!r.ok) { showToast('Error updating ' + wo.wo_number); return; }
      wo.status = cNum; if (upd.completed_at) wo.completed_at = upd.completed_at;
      delete AppState.projectedCache[woId];
      showToast(wo.wo_number + ' marked completed');
      _ensureProjectedCache().then(invRender);
    });
  });
}

// ---------- step 3: scope ----------
function invOpenScope() { INV_STATE.view = 'scope'; INV_STATE.excluded = {}; invRefreshAndRender(); }

function invEligible() {
  var ready = AppState.workOrders.filter(invIsReady);
  if (INV_STATE.scopeType === 'customers') {
    ready = ready.filter(function(w){ return INV_STATE.custSel[w.customer_id || '_none']; });
  }
  return ready.sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
}

function invScopeHtml() {
  var ready = AppState.workOrders.filter(invIsReady);
  var out = '<div style="padding:20px 0">' + invRibbonHtml(3, [1, 2]) + invSetupWarning();
  out += '<div style="font-size:18px;font-weight:700;margin-bottom:4px">Step 3 &mdash; Pick scope</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Work orders you start the run with move to Batch Invoice Process right away. Untick any you want to hold back.</div>';
  out += '<div style="margin-bottom:10px;font-size:13px"><label style="margin-right:18px"><input type="radio" name="inv-scope" ' + (INV_STATE.scopeType === 'all' ? 'checked ' : '') + 'onchange="invSetScope(\'all\')"> All completed work ready to bill</label>'
    + '<label><input type="radio" name="inv-scope" ' + (INV_STATE.scopeType === 'customers' ? 'checked ' : '') + 'onchange="invSetScope(\'customers\')"> Specific customers</label></div>';
  if (INV_STATE.scopeType === 'customers') {
    var groups = {};
    ready.forEach(function(w) {
      var k = w.customer_id || '_none';
      if (!groups[k]) groups[k] = { name: w.customer_id ? invCustName(w) : 'No customer (e.g. Truck Stock)', n: 0, t: 0 };
      groups[k].n++; groups[k].t += invProj(w);
    });
    var keys = Object.keys(groups).sort(function(a, b){ return groups[a].name.localeCompare(groups[b].name); });
    out += '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;max-height:220px;overflow-y:auto;font-size:13px">'
      + (keys.length ? keys.map(function(k) {
        return '<label style="display:block;padding:2px 0"><input type="checkbox" ' + (INV_STATE.custSel[k] ? 'checked ' : '') + 'onchange="invToggleCust(\'' + k + '\',this.checked)"> '
          + escHtml(groups[k].name) + ' <span style="color:var(--text-muted)">(' + groups[k].n + ' &middot; ' + invMoney(groups[k].t) + ')</span></label>';
      }).join('') : '<span style="color:var(--text-muted)">No completed work orders.</span>') + '</div>';
  }
  var elig = invEligible();
  var picked = elig.filter(function(w){ return !INV_STATE.excluded[w.id]; });
  var total = picked.reduce(function(s, w){ return s + invProj(w); }, 0);
  out += '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + picked.length + ' of ' + elig.length + ' work orders selected &middot; ' + invMoney(total) + '</div>';
  out += invWoTable(elig, {
    empty: INV_STATE.scopeType === 'customers' ? 'Pick one or more customers above.' : 'No completed work orders are ready to bill.',
    check: function(wo){ return !INV_STATE.excluded[wo.id]; },
    actions: function(wo){ return invBtn('Open', 'invOpenWO(\'' + wo.id + '\')'); }
  });
  out += '<div style="display:flex;gap:8px;margin-top:16px">' + invBtn('&larr; Back', 'invOpenReview()')
    + invBtn('Start run &mdash; move ' + picked.length + ' to Batch Invoice Process', 'invStartRun()', 'primary', !picked.length || !!invSetupWarning()) + '</div></div>';
  return out;
}

function invSetScope(t) { INV_STATE.scopeType = t; INV_STATE.excluded = {}; invRender(); }
function invToggleCust(k, on) { if (on) INV_STATE.custSel[k] = true; else delete INV_STATE.custSel[k]; invRender(); }
function invToggleWO(id, on) { if (on) delete INV_STATE.excluded[id]; else INV_STATE.excluded[id] = true; invRender(); }

function invStartRun() {
  var batchNum = invStatusNum('batch_invoice');
  if (batchNum == null) { showToast('Batch Invoice Process status is not set up'); return; }
  var ids = invEligible().filter(function(w){ return !INV_STATE.excluded[w.id]; }).map(function(w){ return w.id; });
  if (!ids.length) { showToast('No work orders selected'); return; }
  if (!confirm('Start an invoice run with ' + ids.length + ' work orders? They will move to Batch Invoice Process now and be locked to everyone but you.')) return;
  invLoadActiveRun().then(function(existing) {
    if (existing) { showToast('A run is already active'); INV_STATE.view = 'entry'; invRender(); return; }
    var custIds = INV_STATE.scopeType === 'customers' ? Object.keys(INV_STATE.custSel).filter(function(k){ return k !== '_none'; }) : [];
    return sb.post('invoice_runs', {
      started_by: AppState.userEmail, scope_type: INV_STATE.scopeType, customer_ids: custIds,
      wo_ids: ids, step: 3, steps_done: [1, 2, 3], modified_by: AppState.userEmail
    }).then(function(r) {
      if (!r.ok || !r.data || !r.data.length) { showToast('Could not start the run (is another run active?)'); return; }
      AppState.invRun = r.data[0];
      return Promise.all(ids.map(function(id) {
        return sb.patch('work_orders', id, { status: batchNum, modified_by: AppState.userEmail }).then(function(res){ return { id: id, ok: res.ok }; });
      })).then(function(results) {
        var okIds = results.filter(function(x){ return x.ok; }).map(function(x){ return x.id; });
        okIds.forEach(function(id){ var wo = invFindWO(id); if (wo) wo.status = batchNum; });
        var failed = ids.length - okIds.length;
        var after = okIds.length ? invPatchRun({ wo_ids: okIds }) : invPatchRun({ status: 'cancelled', cancelled_at: new Date().toISOString() });
        return after.then(function() {
          showToast(okIds.length + ' work orders moved to Batch Invoice Process' + (failed ? ' — ' + failed + ' failed and stayed in Completed' : ''));
          INV_STATE.view = okIds.length ? 'run' : 'entry';
          invRefreshAndRender();
        });
      });
    });
  });
}

// ---------- run screen ----------
function invRunHtml() {
  var run = AppState.invRun;
  var wos = invRunWOs(run);
  var inB = wos.filter(invInBatch);
  var out = '<div style="padding:20px 0">' + invRibbonHtml(run.exported_at ? 10 : 9, run.steps_done);
  out += '<div style="font-size:18px;font-weight:700;margin-bottom:4px">Invoice run &mdash; started ' + fmtDateWithTime(run.started_at) + '</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Steps 4&ndash;8 (staleness checks, coalescing, line-item review) arrive in a later build. '
    + 'You can edit any work order below while the run is open. Export to Zed Axis is available now.</div>';
  out += invWoTable(inB, {
    empty: 'No work orders remain in Batch Invoice Process.',
    actions: function(wo) {
      return invBtn('Open', 'invOpenWO(\'' + wo.id + '\')') + (wo.exported_at ? '' : ' ' + invBtn('Drop', 'invDropWO(\'' + wo.id + '\')'));
    }
  });
  var left = wos.length - inB.length;
  if (left > 0) out += '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">' + left + ' work order' + (left === 1 ? ' has' : 's have') + ' left this run (dropped or moved to another status).</div>';
  out += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">'
    + invBtn('Export to Zed Axis', 'invRunExport()', 'primary', !inB.length)
    + invBtn('Finish run', 'invFinishRun()', '', inB.length > 0)
    + invBtn('Cancel run', 'invCancelRun()', 'danger')
    + invBtn('&larr; Back', 'invBackToEntry()') + '</div>';
  if (inB.length) out += '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">Finish run is available once every work order has left Batch Invoice Process. Acceptance (moving exported work orders to Invoiced) is a later build.</div>';
  out += '</div>';
  return out;
}

function invRunExport() {
  var run = AppState.invRun; if (!run) return;
  var wos = invRunWOs(run).filter(invInBatch);
  if (!wos.length) { showToast('Nothing to export'); return; }
  showExportReview(wos);
}

function invReturnToCompleted(wo) {
  var cNum = invStatusNum('completed');
  if (cNum == null) { var c = (AppState.statuses || []).filter(function(s){ return s.category === 'completed' && s.active !== false; })[0]; cNum = c ? c.num : null; }
  if (cNum == null) return Promise.resolve(false);
  return sb.patch('work_orders', wo.id, { status: cNum, exported_at: null, exported_by: null, modified_by: AppState.userEmail }).then(function(r) {
    if (r.ok) { wo.status = cNum; wo.exported_at = null; wo.exported_by = null; }
    return r.ok;
  });
}

function invDropWO(id) {
  var run = AppState.invRun, wo = invFindWO(id); if (!run || !wo) return;
  if (!confirm('Drop ' + wo.wo_number + ' from this run? It returns to Completed.')) return;
  invReturnToCompleted(wo).then(function(ok) {
    if (!ok) { showToast('Could not drop ' + wo.wo_number); return; }
    var keep = (run.wo_ids || []).filter(function(x){ return x !== id; });
    invPatchRun({ wo_ids: keep }).then(function() { showToast(wo.wo_number + ' returned to Completed'); invRender(); if (typeof renderDesktopGrid === 'function') renderDesktopGrid(); });
  });
}

function invFinishRun() {
  var run = AppState.invRun; if (!run) return;
  if (invRunWOs(run).some(invInBatch)) { showToast('Work orders are still in Batch Invoice Process'); return; }
  if (!confirm('Finish this invoice run?')) return;
  var done = (run.steps_done || []).slice(); if (done.indexOf(11) < 0) done.push(11);
  invPatchRun({ status: 'finished', finished_at: new Date().toISOString(), step: 11, steps_done: done }).then(function() {
    showToast('Invoice run finished'); INV_STATE.view = 'entry'; invRefreshAndRender();
  });
}

// Cancel: work orders not yet exported go back to Completed; exported ones stay until accepted.
function invCancelRun() {
  var run = AppState.invRun; if (!run) return;
  var inB = invRunWOs(run).filter(invInBatch);
  var notExp = inB.filter(function(w){ return !w.exported_at; });
  var exp = inB.filter(function(w){ return w.exported_at; });
  if (!confirm('Cancel this run? ' + notExp.length + ' work order(s) not yet exported will return to Completed.'
      + (exp.length ? ' ' + exp.length + ' already exported will stay in Batch Invoice Process until accepted.' : ''))) return;
  Promise.all(notExp.map(invReturnToCompleted)).then(function(results) {
    var failed = results.filter(function(ok){ return !ok; }).length;
    var returnedIds = notExp.filter(function(w, i){ return results[i]; }).map(function(w){ return w.id; });
    var remaining = (run.wo_ids || []).filter(function(id){ return returnedIds.indexOf(id) < 0; });
    var inBatchLeft = remaining.map(invFindWO).filter(function(w){ return w && invInBatch(w); });
    var p = inBatchLeft.length
      ? invPatchRun({ wo_ids: remaining })
      : invPatchRun({ status: 'cancelled', cancelled_at: new Date().toISOString() });
    p.then(function() {
      showToast(inBatchLeft.length ? 'Run kept open: ' + inBatchLeft.length + ' work order(s) still in Batch Invoice Process' + (failed ? ' (' + failed + ' failed to return)' : '')
        : 'Run cancelled');
      INV_STATE.view = 'entry'; invRefreshAndRender();
    });
  });
}
