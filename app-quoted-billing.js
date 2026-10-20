// app-quoted-billing.js — Quoted work order billing (v5.01)
// Spec: docs/specs/quoted-wo-billing.md
// form_mode ('quoted' | 'time_materials') is the billing type. quoted_invoices rows are the milestones.
// Quoted billing runs in its own lightweight workflow (queue -> export -> accept) inside the
// Customer Invoice Generation panel; it never joins or blocks a T&M invoice run.
//
// Milestone status: pending -> ready -> billed -> paid.
//   "ready" + exported_at set = exported, awaiting acceptance. Accepting sets status 'billed'.
//   The LAST active milestone (highest sort_order) is the final row: read-only amount, always the
//   positive remainder of the quoted amount. Earlier rows can never total the full quote.
// Customization rule: statuses are found by system_key/category, never by number or name.

var QB = { all: [], loaded: false, loading: null, sel: {}, cost: {}, askSnooze: {} };

// ---------- small helpers ----------
function qbMoney(n) { return '$' + (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qbR2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
function qbIsAdmin() { return AppState.userRole === 'admin'; }
function qbFindWO(id) { return AppState.workOrders.find(function(w){ return w.id === id; }); }
function qbCust(wo) {
  var c = AppState.customers.find(function(x){ return x.id === wo.customer_id; });
  return (wo.customers && getCustName(wo.customers) !== '---') ? getCustName(wo.customers) : (c ? getCustName(c) : '---');
}
function qbToday() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function qbIsQuoted(wo) { return !!wo && wo.form_mode === 'quoted'; }
function qbQ(wo) { return qbR2(wo && wo.quoted_amount); }
function qbDefaultWarnPct() { var v = parseFloat(AppState.settings.quoted_cost_warn_default_pct); return isNaN(v) ? 75 : v; }
// null/blank = Settings default, 0 = early warning off
function qbWarnPct(wo) {
  if (wo.cost_warn_pct === null || wo.cost_warn_pct === undefined || wo.cost_warn_pct === '') return qbDefaultWarnPct();
  return parseFloat(wo.cost_warn_pct);
}
function qbBtn(label, onclick, kind, disabled) {
  var bg = kind === 'primary' ? 'var(--header-bg)' : (kind === 'danger' ? '#c0392b' : 'var(--surface)');
  var col = (kind === 'primary' || kind === 'danger') ? '#fff' : 'var(--text)';
  return '<button ' + (disabled ? 'disabled ' : '') + 'onclick="' + onclick + '" style="font-size:12px;padding:5px 11px;border-radius:var(--radius-sm);border:1px solid var(--border);background:'
    + bg + ';color:' + col + ';cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';font-weight:600;opacity:' + (disabled ? '0.5' : '1') + ';margin-right:4px">' + label + '</button>';
}

// ---------- milestone data ----------
function qbSort(list) {
  return (list || []).filter(function(m){ return m.active !== false; }).slice().sort(function(a, b) {
    var d = (a.sort_order || 0) - (b.sort_order || 0);
    return d !== 0 ? d : (new Date(a.created_at) - new Date(b.created_at));
  });
}
function qbMsFor(woId) {
  // the open work order's rows are always the freshest copy
  if (AppState.currentWO && AppState.currentWO.id === woId && AppState.quotedLines) return qbSort(AppState.quotedLines);
  return qbSort((QB.loaded ? QB.all : []).filter(function(m){ return m.work_order_id === woId; }));
}
function qbFinalOf(list) { return list.length ? list[list.length - 1] : null; }
function qbAllocated(list) {
  var fin = qbFinalOf(list);
  return qbR2(list.reduce(function(s, m){ return m === fin ? s : s + (parseFloat(m.amount) || 0); }, 0));
}
function qbIsExported(m) { return !!m.exported_at; }
function qbIsLocked(m) { return qbIsExported(m) || m.status === 'billed' || m.status === 'paid'; }

function qbLoadAll(force) {
  if (QB.loaded && !force) return Promise.resolve(QB.all);
  if (QB.loading && !force) return QB.loading;
  QB.loading = sb.get('quoted_invoices', '?active=eq.true&select=*&order=work_order_id.asc,sort_order.asc,created_at.asc').then(function(r) {
    QB.all = (r.ok && r.data) ? r.data : [];
    QB.loaded = true; QB.loading = null;
    return QB.all;
  });
  return QB.loading;
}

// Replace one work order's milestones in the caches after a change
function qbRefreshWO(woId) {
  return sb.get('quoted_invoices', '?work_order_id=eq.' + woId + '&select=*&order=sort_order.asc,created_at.asc').then(function(r) {
    var rows = (r.ok && r.data) ? r.data : [];
    QB.all = QB.all.filter(function(m){ return m.work_order_id !== woId; }).concat(rows.filter(function(m){ return m.active !== false; }));
    if (AppState.currentWO && AppState.currentWO.id === woId) AppState.quotedLines = rows;
    delete AppState.projectedCache[woId];
    return rows;
  });
}

function qbPatchMs(id, fields) {
  fields.modified_by = AppState.userEmail;
  return sb.patch('quoted_invoices', id, fields);
}
function qbPatchWO(wo, fields) {
  fields.modified_by = AppState.userEmail;
  return sb.patch('work_orders', wo.id, fields).then(function(r) {
    if (r.ok) {
      Object.assign(wo, fields);
      var idx = AppState.workOrders.findIndex(function(w){ return w.id === wo.id; });
      if (idx >= 0) Object.assign(AppState.workOrders[idx], fields);
    }
    return r;
  });
}

// ---------- the money rule ----------
// Recompute percent rows and the locked final row from the quoted amount. Returns patches to write.
function qbPlan(wo, list) {
  var Q = qbQ(wo), fin = qbFinalOf(list), patches = [], err = '';
  var running = 0;
  list.forEach(function(m) {
    if (m === fin) return;
    var amt = m.is_percent ? qbR2(Q * (parseFloat(m.percent_value) || 0) / 100) : qbR2(m.amount);
    if (qbR2(m.amount) !== amt) {
      if (qbIsLocked(m)) { err = 'A billed or exported milestone cannot change (' + (m.description || 'milestone') + ').'; }
      else patches.push({ id: m.id, amount: amt });
    }
    running += amt;
  });
  running = qbR2(running);
  var rest = qbR2(Q - running);
  if (fin) {
    if (rest <= 0) err = err || 'Earlier milestones would use up the whole quote (' + qbMoney(Q) + '). Leave something for the final milestone.';
    else if (qbR2(fin.amount) !== rest) {
      if (qbIsLocked(fin)) err = err || 'The final milestone is already billed. Add a new milestone for any added amount instead.';
      else patches.push({ id: fin.id, amount: rest });
    }
  }
  return { patches: patches, error: err, allocated: running, remaining: rest };
}

function qbApplyPlan(wo, plan) {
  return Promise.all(plan.patches.map(function(p){ return qbPatchMs(p.id, { amount: p.amount }); }))
    .then(function(){ return qbRefreshWO(wo.id); });
}

// Called by saveWO before it patches the work order. Returns an error string, or '' when fine.
function qbValidateQuoteChange(wo, newQ) {
  if (!wo || !qbIsQuoted(wo)) return '';
  var list = qbMsFor(wo.id);
  if (!list.length) return '';
  var probe = Object.assign({}, wo, { quoted_amount: newQ });
  return qbPlan(probe, list).error;
}
// Called by saveWO after the work order saved: pushes the new quote into the milestone rows.
function qbSyncAfterQuoteChange(woId) {
  var wo = qbFindWO(woId); if (!wo || !qbIsQuoted(wo)) return Promise.resolve();
  return qbRefreshWO(woId).then(function() {
    var list = qbMsFor(woId); if (!list.length) return;
    return qbApplyPlan(wo, qbPlan(wo, list));
  });
}

// ---------- work order form fields (billing type / quoted amount / cost warning) ----------
function qbOnModeChange() {
  var q = document.getElementById('f-form-mode') && document.getElementById('f-form-mode').value === 'quoted';
  var row = document.getElementById('f-quoted-row'); if (row) row.style.display = q ? '' : 'none';
}
function qbFillFormFields(wo) {
  var a = document.getElementById('f-quoted-amount'), w = document.getElementById('f-cost-warn');
  if (a) a.value = (wo && wo.quoted_amount != null) ? wo.quoted_amount : '';
  if (w) w.value = (wo && wo.cost_warn_pct != null) ? wo.cost_warn_pct : '';
  qbOnModeChange();
}
// Adds quoted_amount / cost_warn_pct to a work order save. Returns an error string or ''.
function qbReadFormFields(updates, wo) {
  var mode = document.getElementById('f-form-mode').value;
  if (mode !== 'quoted') return '';
  var a = document.getElementById('f-quoted-amount'), w = document.getElementById('f-cost-warn');
  var amt = a && a.value.trim() !== '' ? parseFloat(a.value) : null;
  if (amt !== null && (isNaN(amt) || amt < 0)) return 'Quoted amount must be a positive number.';
  var pct = w && w.value.trim() !== '' ? parseFloat(w.value) : null;
  if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) return 'Cost warning must be 0 to 100 (0 turns the early warning off).';
  updates.quoted_amount = amt === null ? null : qbR2(amt);
  updates.cost_warn_pct = pct;
  if (wo && amt !== null) return qbValidateQuoteChange(wo, qbR2(amt));
  return '';
}

// ---------- cost rollup (actual cost vs quote) ----------
// Labor = all hours at the internal rate (no separate labor cost rate exists yet); parts = cost x qty.
function qbCostFrom(hours, parts) {
  var labor = (hours || []).filter(function(e){ return e.active !== false; }).reduce(function(s, e) {
    var key = e.hours_types && e.hours_types.internal_rate_key;
    var rate = parseFloat(AppState.settings[key] || 0);
    return s + (parseFloat(e.hours) || 0) * rate;
  }, 0);
  var mat = (parts || []).filter(function(e){ return e.active !== false && e.transaction_type !== 'vendor_credit'; }).reduce(function(s, e) {
    return s + (parseFloat(e.cost) || 0) * (parseFloat(e.qty) || 1);
  }, 0);
  var cr = (parts || []).filter(function(e){ return e.active !== false && e.transaction_type === 'vendor_credit'; }).reduce(function(s, e) {
    return s + (parseFloat(e.cost) || 0) * (parseFloat(e.qty) || 1);
  }, 0);
  return { labor: qbR2(labor), parts: qbR2(mat - cr), total: qbR2(labor + mat - cr) };
}

// ---------- warnings (computed, never blocking) ----------
// Each rule: { key, test(ctx) -> text or '' }. Add a rule here to add a warning everywhere.
var QB_RULES = [
  { key: 'setup_incomplete', test: function(c) {
      if (!qbIsQuoted(c.wo)) return '';
      var miss = [];
      if (!(qbQ(c.wo) > 0)) miss.push('no quoted amount');
      if (!c.ms.length) miss.push('no milestones');
      if (!miss.length) return '';
      return (c.hasEntries ? 'Billing mode changed — ' : '') + 'quoted setup incomplete: ' + miss.join(', ');
  } },
  { key: 'switched_back', test: function(c) {
      if (qbIsQuoted(c.wo)) return '';
      return (qbQ(c.wo) > 0 || c.ms.length) ? 'Switched back to T&M but quoted amount/milestones still exist' : '';
  } },
  { key: 'totals_mismatch', test: function(c) {
      if (!qbIsQuoted(c.wo) || !c.ms.length || !(qbQ(c.wo) > 0)) return '';
      var sum = qbR2(c.ms.reduce(function(s, m){ return s + (parseFloat(m.amount) || 0); }, 0));
      return sum !== qbQ(c.wo) ? ('Milestones total ' + qbMoney(sum) + ' but the quote is ' + qbMoney(qbQ(c.wo))) : '';
  } },
  { key: 'cost_threshold', test: function(c) {
      if (!qbIsQuoted(c.wo) || !(qbQ(c.wo) > 0) || !c.cost) return '';
      var pct = c.cost.total / qbQ(c.wo) * 100, thr = qbWarnPct(c.wo);
      if (pct >= 100) return 'Cost is ' + Math.round(pct) + '% of the quote (' + qbMoney(c.cost.total - qbQ(c.wo)) + ' over)';
      if (thr > 0 && pct >= thr) return 'You are at ' + Math.round(pct) + '% of your quote (' + qbMoney(c.cost.total) + ' of ' + qbMoney(qbQ(c.wo)) + ')';
      return '';
  } }
];
function qbWarnings(wo, ms, cost, hasEntries) {
  var ctx = { wo: wo, ms: ms, cost: cost, hasEntries: hasEntries }, out = [];
  QB_RULES.forEach(function(r) { var t = r.test(ctx); if (t) out.push({ key: r.key, text: t }); });
  return out;
}
function qbWarnColor(key, text) { return key === 'cost_threshold' && /over\)/.test(text) ? '#c0392b' : '#b45309'; }

// ---------- "Okay to invoice" indicator (computed, not stored) ----------
function qbReadyMs(wo) { return qbMsFor(wo.id).filter(function(m){ return m.status === 'ready' && !qbIsExported(m); }); }
function qbOkToInvoice(wo) {
  if (!wo || wo.active === false) return null;
  if (qbIsQuoted(wo)) {
    var all = qbMsFor(wo.id), ready = qbReadyMs(wo);
    return ready.length ? { n: ready.length, of: all.length } : null;
  }
  return statusCat(wo.status) === 'completed' ? { n: 0, of: 0 } : null;
}
function qbOkChip(wo) {
  if (qbIsQuoted(wo) && !QB.loaded) { qbLoadAll().then(function(){ if (typeof renderDesktopGrid === 'function') renderDesktopGrid(); }); return ''; }
  var ok = qbOkToInvoice(wo); if (!ok) return '';
  return '<span title="Okay to invoice" style="margin-left:4px;font-size:10px;font-weight:700;background:#27ae6022;color:#1e8449;border:1px solid #1e8449;border-radius:3px;padding:1px 4px">$ OK TO INVOICE'
    + (qbIsQuoted(wo) ? ' ' + ok.n + ' of ' + ok.of : '') + '</span>';
}

// ---------- modal ----------
function qbModal(title, bodyHtml, buttons) {
  qbCloseModal();
  var d = document.createElement('div'); d.id = 'qb-modal';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  d.innerHTML = '<div style="background:var(--surface);color:var(--text);border-radius:var(--radius);max-width:460px;width:100%;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,0.3)">'
    + '<div style="font-size:16px;font-weight:700;margin-bottom:10px">' + title + '</div>'
    + '<div style="font-size:13px;line-height:1.5;margin-bottom:14px">' + bodyHtml + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' + (buttons || []).map(function(b){ return qbBtn(b.label, b.onclick, b.kind); }).join('') + '</div></div>';
  document.body.appendChild(d);
}
function qbCloseModal() { var d = document.getElementById('qb-modal'); if (d) d.remove(); }


// ============================================================================
// Work order screen: Quoted billing panel (desktop)
// ============================================================================
function qbStatusBadge(m) {
  var map = { pending: ['Pending', '#7f8c8d'], ready: ['Ready to bill', '#2980b9'], billed: ['Billed', '#27ae60'], paid: ['Paid', '#1e8449'] };
  var s = map[m.status] || map.pending, label = s[0], col = s[1];
  if (m.status === 'ready' && qbIsExported(m)) { label = 'Exported — awaiting acceptance'; col = '#e67e22'; }
  return '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + col + '22;color:' + col + ';border:1px solid ' + col + '">' + label + '</span>';
}

function qbPanelHtml(wo, hours, parts, isAdmin, isLocked) {
  var ms = qbSort(AppState.quotedLines), Q = qbQ(wo), fin = qbFinalOf(ms);
  var alloc = qbAllocated(ms), remaining = qbR2(Q - alloc);
  var cost = qbCostFrom(hours, parts);
  var hasEntries = (hours && hours.length) || (parts && parts.length);
  var warns = qbWarnings(wo, ms, cost, hasEntries);
  var out = '<div class="dt-section" id="qb-panel">';
  out += '<div class="dt-section-hdr"><span class="dt-section-title">Quoted billing</span>'
    + '<span class="dt-section-meta">Quote <b>' + (Q > 0 ? qbMoney(Q) : 'not set') + '</b> &middot; allocated ' + qbMoney(alloc) + ' &middot; remaining ' + qbMoney(Q > 0 ? remaining : 0) + '</span></div>';
  warns.forEach(function(w) {
    var col = qbWarnColor(w.key, w.text);
    out += '<div style="background:' + col + '14;border:1px solid ' + col + ';border-radius:var(--radius);padding:6px 12px;margin:6px 0;font-size:12px;color:' + col + ';font-weight:600">⚠ ' + escHtml(w.text) + '</div>';
  });
  if (Q > 0) {
    var pct = cost.total / Q * 100, thr = qbWarnPct(wo);
    out += '<div style="font-size:12px;color:var(--text-muted);margin:6px 0">Actual cost to date <b style="color:var(--text)">' + qbMoney(cost.total) + '</b> (labor at internal rate ' + qbMoney(cost.labor) + ' + parts ' + qbMoney(cost.parts) + ') = <b style="color:var(--text)">' + Math.round(pct) + '%</b> of the quote'
      + ' &middot; early warning at ' + (thr > 0 ? thr + '%' : 'off') + (wo.cost_warn_pct == null ? ' (Settings default)' : '') + '</div>';
  }
  if (Q > 0 && !ms.length) {
    out += '<div style="padding:12px;border:1px dashed var(--border);border-radius:var(--radius);font-size:13px;margin:6px 0">No milestones yet. ' + (isAdmin ? qbBtn('Set up milestones', "qbCreateFinal('" + wo.id + "')", 'primary') : 'Office sets these up.') + '</div>';
  } else if (!(Q > 0)) {
    out += '<div style="padding:12px;border:1px dashed var(--border);border-radius:var(--radius);font-size:13px;margin:6px 0">Enter the quoted amount under Edit WO Details to set up milestones.</div>';
  } else {
    out += '<table class="dt-table" style="width:100%"><thead><tr><th>#</th><th>Milestone</th><th>Trigger</th><th style="text-align:right">Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>';
    ms.forEach(function(m, i) {
      var isFin = m === fin, locked = qbIsLocked(m);
      var amtTxt = qbMoney(m.amount) + (m.is_percent && !isFin ? ' <span style="color:var(--text-muted);font-size:11px">(' + (parseFloat(m.percent_value) || 0) + '%)</span>' : '')
        + (isFin ? ' <span title="Locked: always the remainder of the quote" style="color:var(--text-muted);font-size:11px">🔒 remainder</span>' : '');
      var acts = '';
      if (isAdmin && !isLocked) {
        if (m.status === 'pending') acts += qbBtn('Mark ready to bill', "qbMarkReady('" + m.id + "')", 'primary');
        if (m.status === 'ready' && !qbIsExported(m)) acts += qbBtn('Bill now', "qbBillNow('" + m.id + "')", 'primary') + qbBtn('Back to pending', "qbSetStatus('" + m.id + "','pending')");
        if (m.status === 'billed') acts += qbBtn('Mark paid', "qbMarkPaid('" + m.id + "')");
        if (!locked) acts += qbBtn('Edit', "qbOpenMsForm('" + wo.id + "','" + m.id + "')");
        if (!locked && !isFin) acts += qbBtn('Delete', "qbDeleteMs('" + m.id + "')", 'danger');
      } else if (!isAdmin && m.status === 'pending' && !m.ready_requested_at) {
        acts += qbBtn('Request ready', "qbRequestReady('" + m.id + "')");
      }
      if (m.status === 'pending' && m.ready_requested_at) {
        acts = '<span style="font-size:11px;color:#b45309;margin-right:6px">ready? requested by ' + escHtml(m.ready_requested_by || '?') + '</span>' + (isAdmin ? qbBtn('Confirm ready', "qbMarkReady('" + m.id + "')", 'primary') : '') + acts.replace(/Request ready/, 'Request ready');
      }
      out += '<tr><td>' + (i + 1) + '</td><td>' + escHtml(m.description) + '</td><td>' + escHtml(m.trigger_label || '') + '</td>'
        + '<td style="text-align:right;white-space:nowrap">' + amtTxt + '</td><td>' + qbStatusBadge(m) + '</td>'
        + '<td>' + (m.due_date ? fmtDate(m.due_date) : '') + '</td><td style="white-space:nowrap;text-align:right">' + acts + '</td></tr>';
    });
    out += '</tbody></table>';
    if (isAdmin) out += '<div style="margin-top:8px">' + qbBtn('+ Add milestone', "qbOpenMsForm('" + wo.id + "','')") + '</div>';
  }
  out += '</div>';
  return out;
}

// ---------- milestone create / edit / delete ----------
function qbCreateFinal(woId) {
  var wo = qbFindWO(woId); if (!wo) return;
  if (!(qbQ(wo) > 0)) { showToast('Enter the quoted amount first'); return; }
  sb.post('quoted_invoices', { work_order_id: woId, description: 'Final billing', amount: qbQ(wo), sort_order: 1, status: 'pending', po_number: wo.po_number || null, created_by: AppState.userEmail, modified_by: AppState.userEmail })
    .then(function(r) {
      if (!r.ok) { showToast('Error saving'); return; }
      qbRefreshWO(woId).then(function(){ showToast('Final milestone created'); qbRerender(); });
    });
}

function qbRerender() { if (AppState.currentWO) renderWODetail(AppState.currentWO); }

function qbOpenMsForm(woId, msId) {
  var wo = qbFindWO(woId); if (!wo) return;
  var ms = qbSort(AppState.quotedLines), fin = qbFinalOf(ms);
  var m = msId ? ms.find(function(x){ return x.id === msId; }) : null;
  if (!msId && !fin) { showToast('Set up milestones first'); return; }
  if (m && qbIsLocked(m)) { showToast('A billed or exported milestone cannot be edited'); return; }
  var isFin = m && fin && m.id === fin.id;
  var inp = 'width:100%;box-sizing:border-box;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px';
  var body = '<label style="font-size:11px;font-weight:700">Event / description (becomes the invoice line)</label>'
    + '<input id="qb-f-desc" type="text" style="' + inp + '" value="' + escHtml(m ? m.description : '') + '" placeholder="e.g. Parts deposit">'
    + '<label style="font-size:11px;font-weight:700">Trigger (label only)</label>'
    + '<input id="qb-f-trig" type="text" style="' + inp + '" value="' + escHtml(m ? (m.trigger_label || '') : '') + '" placeholder="Parts ordered, % complete, job complete, custom…">';
  if (isFin) {
    body += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">🔒 The final milestone is the remainder of the quote and cannot be typed: ' + qbMoney(m.amount) + '.</div>';
  } else {
    body += '<label style="font-size:11px;font-weight:700">Amount</label>'
      + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input id="qb-f-amt" type="number" min="0" step="0.01" style="flex:1;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)" value="' + (m ? (m.is_percent ? (m.percent_value || '') : m.amount) : '') + '">'
      + '<label style="font-size:12px;white-space:nowrap"><input id="qb-f-pct" type="checkbox"' + (m && m.is_percent ? ' checked' : '') + '> percent of quote</label></div>';
  }
  body += '<label style="font-size:11px;font-weight:700">Due date (optional)</label>'
    + '<input id="qb-f-due" type="date" style="' + inp + '" value="' + escHtml(m && m.due_date ? m.due_date : '') + '">';
  qbModal(m ? 'Edit milestone' : 'Add milestone', body, [
    { label: 'Cancel', onclick: 'qbCloseModal()' },
    { label: 'Save', kind: 'primary', onclick: "qbSaveMs('" + woId + "','" + (msId || '') + "')" }
  ]);
}

function qbSaveMs(woId, msId) {
  var wo = qbFindWO(woId); if (!wo) return;
  var list = qbSort(AppState.quotedLines), fin = qbFinalOf(list), Q = qbQ(wo);
  var desc = document.getElementById('qb-f-desc').value.trim();
  var trig = document.getElementById('qb-f-trig').value.trim();
  var due = document.getElementById('qb-f-due').value || null;
  if (!desc) { showToast('Description is required'); return; }
  var existing = msId ? list.find(function(x){ return x.id === msId; }) : null;
  var isFin = existing && fin && existing.id === fin.id;
  var amtEl = document.getElementById('qb-f-amt'), pctEl = document.getElementById('qb-f-pct');
  var isPct = !isFin && pctEl && pctEl.checked;
  var raw = amtEl ? parseFloat(amtEl.value) : null;
  if (!isFin && (!(raw > 0))) { showToast('Enter an amount greater than zero'); return; }
  if (isPct && raw >= 100) { showToast('A percent row must be under 100%'); return; }
  var amount = isFin ? existing.amount : (isPct ? qbR2(Q * raw / 100) : qbR2(raw));
  var fields = { description: desc, trigger_label: trig || null, due_date: due };
  if (!isFin) { fields.amount = amount; fields.is_percent = !!isPct; fields.percent_value = isPct ? raw : null; }

  var candidate;
  if (existing) {
    candidate = list.map(function(x){ return x.id === existing.id ? Object.assign({}, x, fields) : x; });
  } else {
    var row = Object.assign({ id: '__new', created_at: new Date().toISOString(), status: 'pending' }, fields);
    candidate = list.slice(0, -1).concat([row, fin]);
  }
  var plan = qbPlan(wo, candidate);
  if (plan.error) { showToast(plan.error); return; }
  var others = plan.patches.filter(function(p){ return p.id !== '__new'; });

  var step;
  if (existing) {
    step = qbPatchMs(existing.id, fields);
  } else {
    var post = Object.assign({ work_order_id: woId, sort_order: fin.sort_order || 1, status: 'pending', po_number: wo.po_number || null, created_by: AppState.userEmail, modified_by: AppState.userEmail }, fields);
    step = sb.post('quoted_invoices', post).then(function(r) {
      if (!r.ok) return r;
      return qbPatchMs(fin.id, { sort_order: (fin.sort_order || 1) + 1 });
    });
  }
  step.then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    return Promise.all(others.map(function(p){ return qbPatchMs(p.id, { amount: p.amount }); })).then(function() {
      return qbRefreshWO(woId);
    }).then(function() { qbCloseModal(); showToast('Milestone saved'); qbRerender(); });
  });
}

function qbDeleteMs(msId) {
  var m = (AppState.quotedLines || []).find(function(x){ return x.id === msId; }); if (!m) return;
  var wo = qbFindWO(m.work_order_id), list = qbSort(AppState.quotedLines), fin = qbFinalOf(list);
  if (fin && fin.id === msId) { showToast("The final milestone closes the quote and can't be deleted"); return; }
  if (qbIsLocked(m)) { showToast('A billed or exported milestone cannot be deleted'); return; }
  if (!confirm('Delete milestone "' + m.description + '"? The final milestone will grow by ' + qbMoney(m.amount) + '.')) return;
  var rest = list.filter(function(x){ return x.id !== msId; });
  var plan = qbPlan(wo, rest);
  sb.patch('quoted_invoices', msId, { active: false, deleted_at: new Date().toISOString(), deleted_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error deleting'); return; }
    return Promise.all(plan.patches.map(function(p){ return qbPatchMs(p.id, { amount: p.amount }); })).then(function(){ return qbRefreshWO(wo.id); })
      .then(function(){ showToast('Milestone deleted'); qbRerender(); });
  });
}

// ============================================================================
// Status flow: pending -> ready -> billed -> paid
// ============================================================================
function qbFindMs(id) {
  return (AppState.quotedLines || []).concat(QB.all || []).find(function(m){ return m.id === id; });
}
function qbAfterStatus(woId, msg) {
  return qbRefreshWO(woId).then(function() {
    if (msg) showToast(msg);
    if (AppState.currentWO && AppState.currentWO.id === woId) qbRerender();
    if (typeof qbRefreshView === 'function') qbRefreshView();
  });
}

// Pending -> Ready to bill: one on-screen confirmation, then the billing prompt
function qbMarkReady(msId) {
  var m = qbFindMs(msId); if (!m) return;
  var wo = qbFindWO(m.work_order_id);
  qbModal('Mark ready to bill?',
    '<b>' + escHtml(wo ? wo.wo_number : '') + '</b> &mdash; ' + escHtml(m.description) + '<br><span style="font-size:18px;font-weight:700">' + qbMoney(m.amount) + '</span>'
    + (m.ready_requested_by ? '<br><span style="color:#b45309">Requested by ' + escHtml(m.ready_requested_by) + '</span>' : ''),
    [{ label: 'Cancel', onclick: 'qbCloseModal()' }, { label: 'Mark ready to bill', kind: 'primary', onclick: "qbDoReady('" + msId + "')" }]);
}
function qbDoReady(msId) {
  var m = qbFindMs(msId); if (!m) return;
  qbPatchMs(msId, { status: 'ready', ready_at: new Date().toISOString(), ready_by: AppState.userEmail, ready_requested_by: null, ready_requested_at: null }).then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    qbAfterStatus(m.work_order_id).then(function(){ qbBillingPrompt(msId); });
  });
}
function qbBillingPrompt(msId) {
  var m = qbFindMs(msId); if (!m) return;
  var wo = qbFindWO(m.work_order_id);
  qbModal('Ready to bill — send to invoicing now?',
    escHtml(wo ? wo.wo_number : '') + ' &mdash; ' + escHtml(m.description) + ' (' + qbMoney(m.amount) + ')<br><span style="color:var(--text-muted)">Bill now opens the Quoted billing queue with this milestone selected. Leave in queue keeps it ready for later, alone or with others.</span>',
    [{ label: 'Leave in queue', onclick: 'qbCloseModal()' }, { label: 'Bill now', kind: 'primary', onclick: "qbBillNow('" + msId + "')" }]);
}
// A field user's yes is only a request until office confirms
function qbRequestReady(msId) {
  var m = qbFindMs(msId); if (!m) return;
  qbPatchMs(msId, { ready_requested_by: AppState.userEmail, ready_requested_at: new Date().toISOString() }).then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    qbAfterStatus(m.work_order_id, 'Request sent to the office');
  });
}
function qbSetStatus(msId, status) {
  var m = qbFindMs(msId); if (!m) return;
  if (qbIsExported(m)) { showToast('Already exported — return it from the Quoted billing queue'); return; }
  var f = { status: status };
  if (status === 'pending') { f.ready_at = null; f.ready_by = null; }
  qbPatchMs(msId, f).then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    qbAfterStatus(m.work_order_id, 'Milestone moved back to ' + status);
  });
}
function qbMarkPaid(msId) {
  var m = qbFindMs(msId); if (!m) return;
  if (!confirm('Mark this milestone paid? This is a manual entry; DWO cannot verify payment until QBO is connected.')) return;
  qbPatchMs(msId, { status: 'paid', paid_at: new Date().toISOString(), paid_by: AppState.userEmail }).then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    qbAfterStatus(m.work_order_id, 'Marked paid');
  });
}

// ============================================================================
// "Have we arrived at ____?" completion question (once per day per user per work order)
// ============================================================================
function qbLS(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
function qbAskKey(woId) { return 'qb_ask_' + AppState.userEmail + '_' + woId + '_' + qbToday(); }

function qbAfterDetailRender(wo) {
  if (QB.pendingScroll) {
    QB.pendingScroll = false;
    setTimeout(function(){ var p = document.getElementById('qb-panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }
  var old = document.getElementById('qb-ask'); if (old) old.remove();
  if (!qbIsQuoted(wo) || !(qbQ(wo) > 0) || isProcessedStatus(wo.status)) return;
  if (qbLS(qbAskKey(wo.id))) return;
  var next = qbSort(AppState.quotedLines).filter(function(m){ return m.status === 'pending' && !m.ready_requested_at; })[0];
  if (!next) return;
  var snooze = qbLS('qb_snooze_' + next.id);
  if (snooze && snooze > qbToday()) return;
  var body = document.getElementById('wo-detail-body'); if (!body) return;
  var d = document.createElement('div'); d.id = 'qb-ask';
  d.style.cssText = 'background:#2980b914;border:1px solid #2980b9;border-radius:var(--radius);padding:10px 14px;margin-bottom:10px;font-size:13px';
  d.innerHTML = '<div style="font-weight:700;color:#2980b9;margin-bottom:4px">Have we arrived at “' + escHtml(next.description) + '” (' + qbMoney(next.amount) + ')?</div>'
    + '<div style="color:var(--text-muted);margin-bottom:8px">Has this section of the job been completed for billing?</div>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + qbBtn('Yes', "qbAskYes('" + next.id + "')", 'primary') + qbBtn('Not yet', "qbAskNo('" + wo.id + "')")
    + '<span style="font-size:12px;color:var(--text-muted)">Ask again on</span><input type="date" id="qb-ask-date" style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:var(--radius-sm)">'
    + qbBtn('Snooze', "qbAskSnooze('" + wo.id + "','" + next.id + "')") + '</div>';
  body.insertBefore(d, body.firstChild);
}
function qbAskYes(msId) {
  var m = qbFindMs(msId); if (!m) return;
  qbLS(qbAskKey(m.work_order_id), '1');
  var a = document.getElementById('qb-ask'); if (a) a.remove();
  if (qbIsAdmin()) qbMarkReady(msId); else qbRequestReady(msId);
}
function qbAskNo(woId) { qbLS(qbAskKey(woId), '1'); var a = document.getElementById('qb-ask'); if (a) a.remove(); }
function qbAskSnooze(woId, msId) {
  var v = document.getElementById('qb-ask-date').value;
  if (!v) { showToast('Pick a date'); return; }
  qbLS('qb_snooze_' + msId, v); qbAskNo(woId); showToast('Will ask again on ' + fmtDate(v));
}


// ============================================================================
// Quoted billing workflow (lives in the Customer Invoice Generation panel; view 'quoted')
// confirm milestone -> review the invoice line -> export (Zed Axis) -> accept
// ============================================================================
function qbBillNow(msId) {
  qbCloseModal();
  if (AppState.deviceMode !== 'desktop') { showToast('Open Customer Invoice Generation on the desktop to bill'); return; }
  QB.sel = {}; QB.sel[msId] = true;
  INV_STATE.autoQuoted = true;
  desktopNav('invoicing');
}
function qbOpenQueue() { INV_STATE.view = 'quoted'; qbRefreshView(); }
function qbCloseQueue() { INV_STATE.view = 'entry'; if (typeof invRender === 'function') invRender(); }

function qbRefreshView() {
  if (typeof INV_STATE === 'undefined' || INV_STATE.view !== 'quoted') return Promise.resolve();
  var el = document.getElementById('invoicing-panel-body'); if (!el) return Promise.resolve();
  return Promise.all([loadWorkOrders(), loadCustomers(), qbLoadAll(true)]).then(function() { qbRenderQueue(); });
}
function qbRenderQueue() {
  var el = document.getElementById('invoicing-panel-body'); if (el && INV_STATE.view === 'quoted') el.innerHTML = qbQueueHtml();
}
function qbToggleSel(id, on) { if (on) QB.sel[id] = true; else delete QB.sel[id]; qbRenderQueue(); }
function qbSelectAll(ids, on) { ids.forEach(function(id){ if (on) QB.sel[id] = true; else delete QB.sel[id]; }); qbRenderQueue(); }

function qbQueueHtml() {
  var ms = (QB.all || []).filter(function(m){ return m.active !== false; });
  var reqs = ms.filter(function(m){ return m.status === 'pending' && m.ready_requested_at; });
  var ready = ms.filter(function(m){ return m.status === 'ready' && !m.exported_at; });
  var exp = ms.filter(function(m){ return m.status === 'ready' && m.exported_at; });
  var th = 'font-size:11px;text-transform:uppercase;color:var(--text-muted);text-align:left;padding:4px 8px';
  function wo(m) { return qbFindWO(m.work_order_id); }
  function blocked(m) { var w = wo(m); return !w ? 'work order missing' : ((typeof invInBatch === 'function' && invInBatch(w)) ? 'in a T&M invoice run' : (statusCat(w.status) === 'cancelled' ? 'cancelled' : '')); }
  function head(title, sub) { return '<div style="font-size:14px;font-weight:700;margin:20px 0 4px">' + title + '</div>' + (sub ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">' + sub + '</div>' : ''); }
  function empty(t) { return '<div style="padding:14px;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:var(--radius)">' + t + '</div>'; }
  var out = '<div style="max-width:1000px;padding:20px 0">'
    + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px"><div style="font-size:22px;font-weight:700;flex:1">Quoted billing</div>' + qbBtn('← Back', 'qbCloseQueue()') + '</div>'
    + '<div style="font-size:13px;color:var(--text-muted)">Bill milestones on Quoted work orders. This is separate from the T&amp;M invoice run: no staleness checks, and it never blocks a T&amp;M run. Bill one at a time, or tick several to bill together.</div>';

  // field requests
  if (reqs.length) {
    out += head('Requested by the field', 'A field user says this section is complete. Confirm to mark it ready to bill.');
    out += '<table class="dt-table" style="width:100%"><tbody>' + reqs.map(function(m) {
      var w = wo(m);
      return '<tr><td style="font-weight:600">' + escHtml(w ? w.wo_number : '?') + '</td><td>' + escHtml(w ? qbCust(w) : '') + '</td><td>' + escHtml(m.description) + '</td>'
        + '<td style="text-align:right">' + qbMoney(m.amount) + '</td><td style="color:#b45309">requested by ' + escHtml(m.ready_requested_by || '?') + '</td>'
        + '<td style="text-align:right">' + qbBtn('Confirm ready', "qbMarkReady('" + m.id + "')", 'primary') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  // ready to bill
  var readyIds = ready.filter(function(m){ return !blocked(m); }).map(function(m){ return m.id; });
  var nSel = ready.filter(function(m){ return QB.sel[m.id]; }).length;
  out += head('Ready to bill', 'Review each invoice line, then export. Each milestone becomes its own invoice with the next billing suffix.');
  if (!ready.length) out += empty('No milestones are ready to bill.');
  else {
    out += '<table class="dt-table" style="width:100%"><thead><tr><th></th><th style="' + th + '">WO</th><th style="' + th + '">Customer</th><th style="' + th + '">Invoice line</th><th style="' + th + ';text-align:right">Amount</th><th style="' + th + '">PO</th><th style="' + th + '">Notes</th><th></th></tr></thead><tbody>'
      + ready.map(function(m) {
        var w = wo(m), b = blocked(m), warns = w ? qbWarnings(w, qbSort(ms.filter(function(x){ return x.work_order_id === m.work_order_id; })), null, false).filter(function(x){ return x.key !== 'cost_threshold'; }) : [];
        return '<tr><td>' + (b ? '' : '<input type="checkbox" ' + (QB.sel[m.id] ? 'checked ' : '') + 'onchange="qbToggleSel(\'' + m.id + '\',this.checked)">') + '</td>'
          + '<td style="font-weight:600">' + escHtml(w ? w.wo_number : '?') + '</td><td>' + escHtml(w ? qbCust(w) : '') + '</td>'
          + '<td>' + escHtml(m.description) + '</td><td style="text-align:right;font-weight:600">' + qbMoney(m.amount) + '</td>'
          + '<td>' + escHtml((w && w.po_number) || '') + '</td>'
          + '<td style="font-size:12px;color:#b45309">' + (b ? 'Can’t bill: ' + b : '') + warns.map(function(x){ return escHtml(x.text); }).join('; ') + '</td>'
          + '<td style="text-align:right;white-space:nowrap">' + (b ? '' : qbBtn('Bill this one', "qbToggleSel('" + m.id + "',true);qbExport(['" + m.id + "'])", 'primary')) + '</td></tr>';
      }).join('') + '</tbody></table>'
      + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">'
      + qbBtn('Select all', "qbSelectAll(" + JSON.stringify(readyIds) + ",true)") + qbBtn('Clear', "qbSelectAll(" + JSON.stringify(readyIds) + ",false)")
      + qbBtn('Bill selected together (' + nSel + ')', 'qbExport()', 'primary', !nSel) + '</div>';
  }

  // exported, awaiting acceptance
  out += head('Exported — awaiting acceptance', 'Tick off each invoice after you have verified it in QBO. Anything not accepted stays here. DWO gets no confirmation back from Zed Axis.');
  if (!exp.length) out += empty('Nothing is waiting for acceptance.');
  else {
    var expIds = exp.map(function(m){ return m.id; }), nExp = exp.filter(function(m){ return QB.sel[m.id]; }).length;
    out += '<table class="dt-table" style="width:100%"><thead><tr><th></th><th style="' + th + '">WO</th><th style="' + th + '">Customer</th><th style="' + th + '">Invoice line</th><th style="' + th + ';text-align:right">Amount</th><th style="' + th + '">Billing #</th><th style="' + th + '">Exported</th></tr></thead><tbody>'
      + exp.map(function(m) {
        var w = wo(m), snap = m.exported_snapshot || {};
        return '<tr><td><input type="checkbox" ' + (QB.sel[m.id] ? 'checked ' : '') + 'onchange="qbToggleSel(\'' + m.id + '\',this.checked)"></td>'
          + '<td style="font-weight:600">' + escHtml(w ? w.wo_number : '?') + '</td><td>' + escHtml(w ? qbCust(w) : '') + '</td>'
          + '<td>' + escHtml(snap.description || m.description) + '</td><td style="text-align:right;font-weight:600">' + qbMoney(snap.amount != null ? snap.amount : m.amount) + '</td>'
          + '<td>' + escHtml(snap.suffix || '') + '</td><td>' + fmtDateWithTime(m.exported_at) + '</td></tr>';
      }).join('') + '</tbody></table>'
      + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
      + qbBtn('Accept selected (' + nExp + ')', 'qbAccept()', 'primary', !nExp) + qbBtn('Accept all', "qbAccept(" + JSON.stringify(expIds) + ")")
      + qbBtn('Return selected to ready', 'qbReturnToReady()', '', !nExp) + '</div>';
  }
  return out + '</div>';
}

// ---------- export (Zed Axis workbook: QBWO Form + Quoted Invoice Form, one invoice per milestone) ----------
function qbFmtD(d) {
  if (!d) return '';
  var s = String(d).split('T')[0], p = s.split('-');
  if (p.length === 3) return p[1] + '/' + p[2] + '/' + p[0];
  var dt = new Date(d); return String(dt.getMonth() + 1).padStart(2, '0') + '/' + String(dt.getDate()).padStart(2, '0') + '/' + dt.getFullYear();
}

function qbExport(onlyIds) {
  var ids = onlyIds || Object.keys(QB.sel).filter(function(k){ return QB.sel[k]; });
  var picks = (QB.all || []).filter(function(m){ return ids.indexOf(m.id) >= 0 && m.status === 'ready' && !m.exported_at && m.active !== false; });
  if (!picks.length) { showToast('Nothing selected to bill'); return; }
  var byWO = {};
  picks.forEach(function(m){ (byWO[m.work_order_id] = byWO[m.work_order_id] || []).push(m); });
  var woIds = Object.keys(byWO);
  for (var i = 0; i < woIds.length; i++) {
    var w = qbFindWO(woIds[i]);
    if (!w) { showToast('A work order is missing; refresh and try again'); return; }
    if (typeof invInBatch === 'function' && invInBatch(w)) { showToast(w.wo_number + ' is in a T&M invoice run and cannot be billed here'); return; }
    if (statusCat(w.status) === 'cancelled') { showToast(w.wo_number + ' is cancelled'); return; }
  }
  if (!confirm('Export ' + picks.length + ' milestone invoice' + (picks.length === 1 ? '' : 's') + ' to Zed Axis? Nothing comes back from Zed Axis; you accept them here after checking QBO.')) return;
  showToast('Building export... please wait');
  var now = new Date(), teamMember = AppState.settings.team_member_default || 'Kevin Reb';
  var items = [];
  woIds.forEach(function(id) {
    var w = qbFindWO(id), base = w.invoice_suffix_count || 0;
    byWO[id].forEach(function(m, k) { items.push({ m: m, w: w, suffix: '-' + String(base + k).padStart(2, '0') }); });
  });
  var woN = function(w){ return w.wo_number.replace(/^[A-Za-z]+/, '') + ':' + w.title; };
  var stLabel = function(w){ var st = getStatus(w.status); return String(st.num).padStart(2, '0') + '-' + st.name; };
  var s1 = [['ID', 'Name', 'Team Member', 'Status', 'Customer Billed', 'Date', 'Form Mode', 'PO Number', 'Work Description', 'Exported By', 'Export Date', 'Billing #']];
  var s4 = [['ID', 'Name', 'Team Member', 'Status', 'Date', 'Customer Billed', 'Quoted Amount', 'PO Number', 'Work Description', 'Lead Time', 'Class_1', 'Billing #']];
  items.forEach(function(it) {
    var w = it.w, m = it.m, po = m.po_number || w.po_number || '';
    s1.push([w.id, woN(w), teamMember, stLabel(w), qbCust(w), qbFmtD(w.created_at), 'Quoted', po, '', AppState.userEmail, qbFmtD(now.toISOString()), it.suffix]);
    s4.push([w.id, woN(w), teamMember, stLabel(w), qbFmtD(now.toISOString()), qbCust(w), m.amount, po, m.description, '', '', it.suffix]);
  });
  var s2 = [['ID', 'Name', 'Team Member', 'Status', 'Customer Billed', 'Date', 'Service Tech', 'Hours Type', 'Hours', 'Billable', 'Work Order Descriptor', 'Job Class', 'Billing #']];
  var s3 = [['ID', 'Name', 'Team Member', 'Status', 'Purchased Parts', 'Transaction Date', 'Supplier', 'Invoice', 'Part EDP', 'Part Description', 'Qty', 'Cost', 'Margin Level', 'Sell Each', 'Sell Total', 'Customer Charged', 'WO Number', 'Test WO', 'PO Number', 'Class Type', 'Descriptor', 'Billing #']];
  var s5 = [['ID', 'Name', 'Team Member', 'Status', 'Billing #']];
  var s6 = [['WO Number', 'Billing #', 'Customer', 'PO Number', 'Date', 'Completed Date', 'Type', 'Product / Service', 'Description', 'Tech / Vendor', 'Qty / Hrs', 'Sell Each', 'Sell Total']];
  var go = function() {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'QBWO Form');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'QBWO Form-Hours Entry');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), 'QBWO Form-All Parts Services');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), 'QBWO Form-Quoted Invoice Form');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s5), 'QBWO Form-Vendor Credit Form E');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s6), 'QBO Invoice Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['QBWO Form-Approval Information']]), 'QBWO Form-Approval Information');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['QBWO Form-Site Check-In Check']]), 'QBWO Form-Site Check-In Check');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['QBWO Form-Admin Hour Entry']]), 'QBWO Form-Admin Hour Entry');
    var filename = 'ZedAxis_QuotedExport_' + now.toISOString().slice(0, 10) + '_' + items.length + 'Invoices.xlsx';
    XLSX.writeFile(wb, filename);
    sb.post('export_history', { exported_by: AppState.userEmail, wo_count: woIds.length, wo_ids: woIds, filename: filename });
    var ts = now.toISOString();
    var ops = items.map(function(it) {
      return qbPatchMs(it.m.id, { exported_at: ts, exported_by: AppState.userEmail,
        exported_snapshot: { wo_number: it.w.wo_number, description: it.m.description, amount: it.m.amount, suffix: it.suffix, po_number: it.m.po_number || it.w.po_number || null, exported_at: ts, exported_by: AppState.userEmail } });
    });
    woIds.forEach(function(id) {
      var w = qbFindWO(id);
      ops.push(qbPatchWO(w, { invoice_suffix_count: (w.invoice_suffix_count || 0) + byWO[id].length }));
    });
    Promise.all(ops).then(function() {
      QB.sel = {};
      showToast('Exported ' + items.length + ' invoice' + (items.length === 1 ? '' : 's') + ' - file downloading');
      qbRefreshView();
    });
  };
  if (typeof XLSX === 'undefined') {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = go; script.onerror = function(){ showToast('Could not load Excel library'); };
    document.head.appendChild(script);
  } else go();
}

// ---------- acceptance ----------
function qbAccept(onlyIds) {
  var ids = onlyIds || Object.keys(QB.sel).filter(function(k){ return QB.sel[k]; });
  var picks = (QB.all || []).filter(function(m){ return ids.indexOf(m.id) >= 0 && m.status === 'ready' && m.exported_at; });
  if (!picks.length) { showToast('Nothing selected to accept'); return; }
  var ts = new Date().toISOString(), invSt = getStatusByKey('invoiced');
  var ops = picks.map(function(m) { return qbPatchMs(m.id, { status: 'billed', billed_at: ts, billed_by: AppState.userEmail }); });
  var closing = [];
  picks.forEach(function(m) {
    var list = qbSort((QB.all || []).filter(function(x){ return x.work_order_id === m.work_order_id; })), fin = qbFinalOf(list);
    if (fin && fin.id === m.id) closing.push(m.work_order_id);
  });
  if (closing.length && !invSt) showToast('Setup needed: no "invoiced" status exists; the work order status was not changed');
  else closing.forEach(function(id) {
    var w = qbFindWO(id); if (!w) return;
    ops.push(qbPatchWO(w, { status: invSt.num, exported_at: ts, exported_by: AppState.userEmail }));
  });
  Promise.all(ops).then(function() {
    QB.sel = {};
    showToast('Accepted ' + picks.length + ' milestone' + (picks.length === 1 ? '' : 's') + (closing.length ? ' — ' + closing.length + ' work order' + (closing.length === 1 ? '' : 's') + ' now Invoiced' : ''));
    if (typeof renderDesktopGrid === 'function') renderDesktopGrid();
    qbRefreshView();
  });
}
function qbReturnToReady() {
  var ids = Object.keys(QB.sel).filter(function(k){ return QB.sel[k]; });
  var picks = (QB.all || []).filter(function(m){ return ids.indexOf(m.id) >= 0 && m.status === 'ready' && m.exported_at; });
  if (!picks.length) return;
  if (!confirm('Return ' + picks.length + ' exported milestone(s) to Ready to bill so they can be exported again? Fix or delete the old invoice in QBO first.')) return;
  Promise.all(picks.map(function(m){ return qbPatchMs(m.id, { exported_at: null, exported_by: null, exported_snapshot: null }); })).then(function() {
    QB.sel = {}; showToast('Returned to ready'); qbRefreshView();
  });
}

// ============================================================================
// Daily Dashboard card (admin): warnings with a link straight to the fix, plus billing counts
// ============================================================================
function qbOpenFix(woId) { QB.pendingScroll = true; openWODetail(woId); }

function qbDashboardRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  shell.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:13px">Loading…</div>';
  qbLoadAll(true).then(function() {
    var open = AppState.workOrders.filter(function(w) {
      if (w.active === false) return false;
      var cat = statusCat(w.status);
      if (cat === 'cancelled' || cat === 'processed') return false;
      return qbIsQuoted(w) || qbQ(w) > 0 || QB.all.some(function(m){ return m.work_order_id === w.id; });
    });
    var ids = open.map(function(w){ return w.id; });
    var costP = ids.length ? Promise.all([
      sb.get('hours_entries', '?work_order_id=in.(' + ids.join(',') + ')&active=eq.true&select=work_order_id,hours,hours_types(internal_rate_key)'),
      sb.get('line_items', '?work_order_id=in.(' + ids.join(',') + ')&active=eq.true&select=work_order_id,cost,qty,transaction_type')
    ]) : Promise.resolve([{ ok: true, data: [] }, { ok: true, data: [] }]);
    return costP.then(function(r) {
      var hrs = (r[0].ok && r[0].data) || [], prt = (r[1].ok && r[1].data) || [];
      var rows = [];
      open.forEach(function(w) {
        var h = hrs.filter(function(e){ return e.work_order_id === w.id; }), p = prt.filter(function(e){ return e.work_order_id === w.id; });
        var warns = qbWarnings(w, qbSort(QB.all.filter(function(m){ return m.work_order_id === w.id; })), qbCostFrom(h, p), h.length + p.length > 0);
        if (warns.length) rows.push({ w: w, warns: warns });
      });
      var all = QB.all, nReq = all.filter(function(m){ return m.status === 'pending' && m.ready_requested_at; }).length;
      var nReady = all.filter(function(m){ return m.status === 'ready' && !m.exported_at; });
      var nExp = all.filter(function(m){ return m.status === 'ready' && m.exported_at; });
      var badge = document.getElementById('mb-badge-qbilling');
      if (badge) badge.textContent = rows.length + ' warning' + (rows.length === 1 ? '' : 's') + (nReady.length ? ' · ' + nReady.length + ' ready' : '');
      var sum = function(a){ return a.reduce(function(s, m){ return s + (parseFloat(m.amount) || 0); }, 0); };
      var html = '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px;margin-bottom:10px">'
        + '<span><b>' + nReady.length + '</b> ready to bill (' + qbMoney(sum(nReady)) + ')</span>'
        + '<span><b>' + nExp.length + '</b> exported, awaiting acceptance (' + qbMoney(sum(nExp)) + ')</span>'
        + (nReq ? '<span style="color:#b45309"><b>' + nReq + '</b> requested by the field</span>' : '')
        + qbBtn('Open Quoted billing', "qbBillNow2()", 'primary') + '</div>';
      if (!rows.length) html += '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius)">No Quoted work orders need attention.</div>';
      else {
        html += '<table class="dt-table" style="width:100%"><thead><tr><th>WO</th><th>Customer</th><th>Needs attention</th><th>Waiting</th><th></th></tr></thead><tbody>'
          + rows.map(function(x) {
            var days = Math.max(0, Math.floor((Date.now() - new Date(x.w.created_at).getTime()) / 86400000));
            return '<tr><td style="font-weight:600">' + escHtml(x.w.wo_number) + '</td><td>' + escHtml(qbCust(x.w)) + '</td>'
              + '<td>' + x.warns.map(function(k){ return '<div style="color:' + qbWarnColor(k.key, k.text) + ';font-size:12px;font-weight:600">⚠ ' + escHtml(k.text) + '</div>'; }).join('') + '</td>'
              + '<td>' + days + 'd</td><td style="text-align:right">' + qbBtn('Fix →', "qbOpenFix('" + x.w.id + "')", 'primary') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      shell.innerHTML = html;
    });
  });
}
function qbBillNow2() { INV_STATE.autoQuoted = true; QB.sel = {}; desktopNav('invoicing'); }

// Entry card shown on the Customer Invoice Generation panel (app-invoice-gen.js invEntryHtml)
function qbEntryCardHtml() {
  if (!QB.loaded) return '';
  var ms = QB.all.filter(function(m){ return m.active !== false; });
  var ready = ms.filter(function(m){ return m.status === 'ready' && !m.exported_at; });
  var exp = ms.filter(function(m){ return m.status === 'ready' && m.exported_at; });
  var req = ms.filter(function(m){ return m.status === 'pending' && m.ready_requested_at; });
  var sum = function(a){ return a.reduce(function(s, m){ return s + (parseFloat(m.amount) || 0); }, 0); };
  var hot = exp.length || req.length;
  return '<div style="border:1px solid ' + (hot ? '#e67e22' : 'var(--border)') + ';border-radius:var(--radius);padding:14px 18px;margin-bottom:22px;background:var(--surface);cursor:pointer;max-width:600px" onclick="qbOpenQueue()">'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:4px">&#128176; Quoted billing</div>'
    + '<div style="font-size:13px;color:var(--text-muted)">Bill milestones on Quoted work orders, separate from the T&amp;M run.</div>'
    + '<div style="font-size:13px;margin-top:8px;display:flex;gap:16px;flex-wrap:wrap">'
    + '<span><b>' + ready.length + '</b> ready to bill (' + qbMoney(sum(ready)) + ')</span>'
    + '<span style="' + (exp.length ? 'color:#c0392b;font-weight:700' : '') + '"><b>' + exp.length + '</b> exported, awaiting acceptance (' + qbMoney(sum(exp)) + ')</span>'
    + (req.length ? '<span style="color:#b45309"><b>' + req.length + '</b> requested by the field</span>' : '') + '</div></div>';
}
