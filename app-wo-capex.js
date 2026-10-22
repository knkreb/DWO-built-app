// app-wo-capex.js — CapEx tag, threshold warnings and capital minimum (v5.12, slice 3)
// Spec: docs/specs/customer-thresholds-and-carryover.md section 2. DB: supabase/migrations/v5.12_work_order_capex.sql
// CapEx WARNS ONLY and never stops work. The tag is set BY HAND by admin on the work order (table work_order_capex).
// Customer settings (threshold, two levels, capital minimum) live on the customer Limits sheet (app-customer-limits.js)
// and are read live from the customer or its parent; they are not copied to work orders the way NTE is.
//   - Untagged work order: the threshold levels warn that it is nearing the capital line (split it, or tag it CapEx).
//   - Tagged work order: when it reaches Completed under the customer's capital minimum, it is flagged
//     "bill as repair and maintenance" (or remove the tag).
// Spend, levels and alerts are computed in the database (views wo_spend / wo_capex_status, same counting as NTE).
// Measured per work order. Combining work orders on one job is a later slice.
// Uses wonIsAdmin, wonMoney and wonIsTM from app-wo-nte.js (loaded before this file).

var WOC = { woId: null, row: null, st: null, token: 0, levels: {}, busy: false };

// ── Work order screen ────────────────────────────────────────────────────
// Called from renderWODetail: returns the shell; the content loads right after the screen is drawn.
function wocShell(wo) {
  if (!wonIsTM(wo)) return '';
  setTimeout(function() { wocRefresh(wo.id); }, 0);
  return '<div id="woc-block"></div>';
}

// Also called from app-core.js after every hours or parts row is saved, edited, deleted or restored.
function wocRefresh(woId) {
  var tok = ++WOC.token;
  Promise.all([
    sb.get('work_order_capex', '?work_order_id=eq.' + woId + '&active=eq.true'),
    sb.get('wo_capex_status', '?work_order_id=eq.' + woId)
  ]).then(function(res) {
    if (tok !== WOC.token) return;
    var box = document.getElementById('woc-block'); if (!box) return;
    var wo = AppState.currentWO; if (!wo || wo.id !== woId) return;
    if (!res[0].ok || !res[1].ok) { box.innerHTML = ''; return; } // migration missing or offline: stay quiet
    WOC.woId = woId;
    WOC.row = (res[0].data && res[0].data[0]) || null;
    WOC.st = (res[1].data && res[1].data[0]) || null;
    wocDraw(box, wo, WOC.row, WOC.st);
    // Toast (admin) when an untagged work order moves up a threshold level while it is open
    var prev = WOC.levels[woId], lvl = WOC.st ? WOC.st.level : 0;
    if (wonIsAdmin() && prev !== undefined && lvl > prev && typeof showToast === 'function') {
      showToast(lvl >= 2 ? 'CapEx threshold reached on ' + wo.wo_number : 'CapEx watch on ' + wo.wo_number + ': ' + Math.round(WOC.st.pct_used) + '% of the threshold');
    }
    WOC.levels[woId] = lvl;
  });
}

function wocBtn(label, col, fn) {
  return '<button style="font-size:11px;padding:3px 8px;border:1px solid ' + col + ';border-radius:3px;background:none;color:' + col + ';cursor:pointer" onclick="' + fn + '">' + label + '</button>';
}

function wocDraw(box, wo, row, st) {
  var admin = wonIsAdmin();
  var tagged = !!(row && row.capex_tagged);

  // Not tagged: only admin sees anything, and only when the customer has CapEx settings switched on.
  if (!tagged) {
    if (!admin || !st) { box.innerHTML = ''; return; }
    var hasThr = st.capex_threshold !== null && st.capex_threshold !== undefined;
    if (st.level >= 1) {
      var col = st.level >= 2 ? '#c0392b' : '#e67e22';
      var rem = parseFloat(st.capex_threshold) - parseFloat(st.spent);
      var msg = st.level >= 2 ? (rem < 0 ? 'Over the CapEx threshold by ' + wonMoney(-rem) : 'At the CapEx threshold') : 'Approaching the CapEx threshold';
      box.innerHTML = '<div style="border:1px solid ' + col + ';background:' + col + '14;border-radius:var(--radius);padding:8px 12px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="font-size:12px;font-weight:700;color:' + col + '">CapEx watch ' + wonMoney(st.capex_threshold) + '</span>'
        + '<span style="font-size:12px;color:var(--text-secondary);flex:1">' + wonMoney(st.spent) + ' spent (' + Math.round(st.pct_used) + '%)</span>'
        + wocBtn('Tag as CapEx', col, 'wocSet(true)') + '</div>'
        + '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-top:5px">' + msg + ': split the work, or tag it CapEx.</div></div>';
      return;
    }
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius);padding:6px 10px;margin-bottom:10px">'
      + '<span style="flex:1">Not tagged CapEx' + (hasThr ? ' · ' + wonMoney(st.spent) + ' of the ' + wonMoney(st.capex_threshold) + ' CapEx threshold (' + Math.round(st.pct_used) + '%)' : '') + '</span>'
      + wocBtn('Tag as CapEx', 'var(--header-bg)', 'wocSet(true)') + '</div>';
    return;
  }

  // Tagged: everyone sees the CapEx badge; the capital minimum check is for admin.
  var accent = '#6d3fa8';
  var line = '', flagCol = accent;
  if (admin && st && st.min_amount !== null && st.min_amount !== undefined) {
    if (st.min_flag) {
      flagCol = '#c0392b';
      line = '<div style="font-size:12px;font-weight:700;color:#c0392b;margin-top:5px">Below the capital minimum of ' + wonMoney(st.min_amount) + ' (' + wonMoney(st.spent) + ' so far). Bill as repair and maintenance, or remove the CapEx tag.</div>';
    } else if (st.below_min) {
      line = '<div style="font-size:12px;color:var(--text-secondary);margin-top:5px">Capital minimum ' + wonMoney(st.min_amount) + ' · ' + wonMoney(st.spent) + ' so far. Checked when the work order is completed.</div>';
    } else {
      line = '<div style="font-size:12px;color:var(--text-secondary);margin-top:5px">Capital minimum ' + wonMoney(st.min_amount) + ' met (' + wonMoney(st.spent) + ').</div>';
    }
  }
  box.innerHTML = '<div style="border:1px solid ' + flagCol + ';background:' + flagCol + '14;border-radius:var(--radius);padding:8px 12px;margin-bottom:10px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:11px;font-weight:700;color:#fff;background:' + accent + ';border-radius:3px;padding:2px 7px">CapEx</span>'
    + '<span style="font-size:12px;color:var(--text-secondary);flex:1">This work order is tracked as capital expense.</span>'
    + (admin ? wocBtn('Remove tag', flagCol, 'wocSet(false)') : '') + '</div>' + line + '</div>';
}

// ── Tag / untag (admin, by hand) ─────────────────────────────────────────
function wocSet(flag) {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin() || WOC.busy) return;
  WOC.busy = true; // ignore a second tap while the first is saving
  var body = { capex_tagged: !!flag, label: wo.wo_number, modified_by: AppState.userEmail };
  var req = WOC.row
    ? sb.patch('work_order_capex', WOC.row.id, body)
    : sb.post('work_order_capex', Object.assign({ work_order_id: wo.id, created_by: AppState.userEmail }, body));
  req.then(function(r) {
    WOC.busy = false;
    if (!r.ok) { showToast('Error saving the CapEx tag. Nothing was changed.'); return; }
    showToast(flag ? 'Tagged CapEx' : 'CapEx tag removed');
    wocRefresh(wo.id);
  });
}

// ── Daily Dashboard card (admin) ─────────────────────────────────────────
// Two kinds of rows: untagged work orders at a threshold level ("watch"), and tagged work orders completed under the capital minimum.
function wocDashRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  var badge = document.getElementById('mb-badge-wocapex');
  sb.get('wo_capex_status', '?or=(level.gte.1,min_flag.eq.true)&order=spent.desc').then(function(r) {
    if (!r.ok) { shell.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">CapEx status is not available.</div>'; if (badge) badge.textContent = ''; return; }
    var rows = (r.data || []).filter(function(x) {
      var w = (AppState.workOrders || []).find(function(y) { return y.id === x.work_order_id; });
      if (!w || w.active === false) return false;
      var cat = statusCat(w.status);
      return cat === 'active' || cat === 'completed';
    });
    var below = rows.filter(function(x) { return x.min_flag; }).length;
    var watch = rows.length - below;
    if (badge) badge.textContent = rows.length ? (below ? below + ' below minimum' : '') + (below && watch ? ' · ' : '') + (watch ? watch + ' watch' : '') : 'none';
    if (!rows.length) { shell.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No work orders are near the CapEx line or under the capital minimum.</div>'; return; }
    var h = '<table class="dt-table" style="width:100%"><thead><tr><th>WO</th><th>Customer</th><th>Title</th><th style="text-align:right">Spent</th><th>CapEx</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x) {
      var c = (AppState.customers || []).find(function(y) { return y.id === x.customer_id; });
      var note, col;
      if (x.min_flag) { col = '#c0392b'; note = 'Below ' + wonMoney(x.min_amount) + ' capital minimum: bill as R&amp;M, or remove the tag'; }
      else { col = x.level >= 2 ? '#c0392b' : '#e67e22'; note = Math.round(x.pct_used) + '% of the ' + wonMoney(x.capex_threshold) + ' threshold: split, or tag CapEx'; }
      h += '<tr><td style="font-weight:600">' + escHtml(x.wo_number) + '</td><td>' + escHtml(c ? getCustName(c) : '') + '</td><td>' + escHtml(x.title || '') + '</td>'
        + '<td style="text-align:right">' + wonMoney(x.spent) + '</td>'
        + '<td style="font-weight:700;color:' + col + '">' + note + '</td>'
        + '<td><button onclick="openWODetail(\'' + x.work_order_id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td></tr>';
    });
    shell.innerHTML = h + '</tbody></table>';
  });
}
