// app-po-status-map.js — PO status-to-bucket map (v5.20)
// Spec: docs/specs/po-status-bucket-map.md (Part A)
// Admin-only. Each work order status counts toward a customer PO as Billed, Pending or Not counted.
// Stored in po_status_bucket (system_key -> bucket); a status with no row counts as Pending. The map lives
// only inside the PO module. This file owns the PO panel's tab strip and the "Status buckets" tab.

var poPanelTab = 'pos';          // 'pos' | 'buckets'; kept here so a re-render after a PO edit stays on the tab
var PO_BUCKET_LABELS = { billed: 'Billed', pending: 'Pending', none: 'Not counted' };

function poBucketLabel(bucket) { return PO_BUCKET_LABELS[bucket] || PO_BUCKET_LABELS.pending; }

// ── Tab strip (called from poRenderPanelBody in app-po-tracker.js) ─────────
function poPanelTabsHtml(containerId) {
  function tab(key, label) {
    var on = poPanelTab === key;
    return '<button onclick="poSetPanelTab(\'' + key + '\',\'' + containerId + '\')" style="font-size:13px;padding:7px 16px;border:none;background:none;cursor:pointer;'
      + 'border-bottom:2px solid ' + (on ? 'var(--primary, #2563eb)' : 'transparent') + ';font-weight:' + (on ? '700' : '500') + ';color:' + (on ? 'var(--text)' : 'var(--text-muted)') + '">' + label + '</button>';
  }
  return '<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px">'
    + tab('pos', 'Purchase Orders') + tab('buckets', 'Status buckets') + '</div>';
}

function poSetPanelTab(tab, containerId) {
  poPanelTab = tab;
  poRenderPanelBody(containerId);
}

// ── Status buckets tab ─────────────────────────────────────────────────────
function poStatusMapRender(bodyId) {
  var el = document.getElementById(bodyId); if (!el) return;
  el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Loading…</div>';
  // Read the live status table, not the fallback list in app-core.js.
  Promise.all([
    sb.get('wo_statuses', '?select=num,name,system_key,color,sort_order&active=eq.true&order=sort_order.asc'),
    sb.get('po_status_bucket', '?select=system_key,bucket')
  ]).then(function(res) {
    var stR = res[0], mapR = res[1];
    if (!stR.ok || !mapR.ok) { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--danger)">Could not load the status map.</div>'; return; }
    var map = {};
    (mapR.data || []).forEach(function(r) { map[r.system_key] = r.bucket; });
    var html = '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;max-width:640px">'
      + 'Choose how each work order status counts toward a customer PO. A change saves immediately. '
      + 'A status with no choice counts as Pending.</div>'
      + '<table class="po-grid-table"><thead><tr><th>Status</th>'
      + '<th style="text-align:center">Billed</th><th style="text-align:center">Pending</th><th style="text-align:center">Not counted</th></tr></thead><tbody>';
    (stR.data || []).forEach(function(s) {
      var cur = map[s.system_key] || 'pending';
      html += '<tr><td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + escHtml(s.color || '#eee') + '">' + escHtml(s.name) + '</span></td>';
      ['billed', 'pending', 'none'].forEach(function(b) {
        html += '<td style="text-align:center"><input type="radio" name="po-bucket-' + escHtml(s.system_key) + '" value="' + b + '"'
          + (cur === b ? ' checked' : '')
          + ' onchange="poStatusMapSave(\'' + escHtml(s.system_key) + '\',\'' + b + '\',\'' + bodyId + '\')"></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  });
}

// Saves one status. Update first; if no row exists yet for the key, insert one.
function poStatusMapSave(systemKey, bucket, bodyId) {
  var stamp = { bucket: bucket, modified_at: new Date().toISOString(), modified_by: AppState.userEmail };
  sb.patchWhere('po_status_bucket', 'system_key=eq.' + encodeURIComponent(systemKey), stamp).then(function(r) {
    if (r.ok && r.data && r.data.length) return r;
    if (!r.ok) return r;
    return sb.post('po_status_bucket', Object.assign({ system_key: systemKey }, stamp));
  }).then(function(r) {
    if (!r.ok) { showToast('Could not save — try again'); poStatusMapRender(bodyId); return; }
    showToast('Saved: ' + poBucketLabel(bucket));
    poLoadAll();
  });
}
