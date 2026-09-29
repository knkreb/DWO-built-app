// app-alerts.js — v4.88 — Slice 1: Alerts center (admin only)
// Bell, Dashboard card, Alerts panel, Settings → Alerts tab, Settings → Audit Log tab.
// Depends on: AppState, sb, escHtml, showToast, saveSetting, toggleSettingsBlock

var AlertsState = {
  list: [],
  filter: 'open', // open|unread|in_progress|resolved|all
  loaded: false,
  auditPage: 0,
  auditRows: [],
};

var STATUS_LABELS = { unread: 'Unread', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved' };
var SEVERITY_COLORS = { info: '#3498db', warning: '#e67e22', urgent: '#c0392b' };

// A delete snapshot is a single "field: value; field: value" string — render one pair per line
// instead of a run-on sentence. Plain field updates (no "; ") render as before.
function formatAuditOldNew(oldVal, newVal) {
  function fmt(v) {
    if (!v) return '';
    if (v.indexOf('; ') >= 0) return v.split('; ').map(function(part) { return escHtml(part); }).join('<br>');
    return escHtml(v);
  }
  if (oldVal && !newVal) return fmt(oldVal);
  if (!oldVal && newVal) return fmt(newVal);
  return fmt(oldVal) + ' &rarr; ' + fmt(newVal);
}

function loadAlerts() {
  if (AppState.userRole !== 'admin') return Promise.resolve();
  return sb.get('alerts', '?select=*&order=created_at.desc&limit=200').then(function(r) {
    if (r.ok) { AlertsState.list = r.data || []; AlertsState.loaded = true; }
    updateAlertsBadges();
  });
}

function unreadCount() { return AlertsState.list.filter(function(a) { return a.status === 'unread'; }).length; }
function inProgressCount() { return AlertsState.list.filter(function(a) { return a.status === 'in_progress'; }).length; }

function updateAlertsBadges() {
  var n = unreadCount();
  var bellBadge = document.getElementById('alerts-bell-badge');
  if (bellBadge) {
    if (n > 0) { bellBadge.textContent = n > 99 ? '99+' : String(n); bellBadge.style.display = ''; }
    else bellBadge.style.display = 'none';
  }
  var hbItem = document.getElementById('hamburger-alerts-item');
  var hbBadge = document.getElementById('hamburger-alerts-badge');
  if (hbItem) hbItem.style.display = (AppState.userRole === 'admin') ? '' : 'none';
  if (hbBadge) {
    if (n > 0) { hbBadge.textContent = n > 99 ? '99+' : String(n); hbBadge.style.display = ''; }
    else hbBadge.style.display = 'none';
  }
  renderAlertsDashboardCard();
}

function renderAlertsDashboardCard() {
  var mobileEl = document.getElementById('alerts-dashboard-card-mobile');
  var desktopEl = document.getElementById('alerts-dashboard-card-desktop');
  if (AppState.userRole !== 'admin' || !AlertsState.loaded) {
    if (mobileEl) mobileEl.style.display = 'none';
    if (desktopEl) desktopEl.style.display = 'none';
    return;
  }
  var unread = unreadCount(), inProg = inProgressCount();
  if (!unread && !inProg) {
    if (mobileEl) mobileEl.style.display = 'none';
    if (desktopEl) desktopEl.style.display = 'none';
    return;
  }
  var top = AlertsState.list.filter(function(a) { return a.status !== 'resolved'; }).slice(0, 3);
  var html = '<div style="background:var(--surface);border:1.5px solid #e67e22;border-radius:var(--radius);padding:12px 16px;margin:10px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div style="font-size:13px;font-weight:700">&#128276; Alerts &mdash; ' + unread + ' Unread' + (inProg ? ', ' + inProg + ' In progress' : '') + '</div>'
    + '<a href="#" onclick="openAlertsPanel();return false" style="font-size:12px;color:var(--header-bg)">View all</a>'
    + '</div>';
  top.forEach(function(a) {
    html += '<div style="font-size:12px;padding:4px 0;border-top:1px solid var(--border)">' + escHtml(a.message) + '</div>';
  });
  html += '</div>';
  if (mobileEl) { mobileEl.innerHTML = html; mobileEl.style.display = ''; }
  if (desktopEl) { desktopEl.innerHTML = html; desktopEl.style.display = ''; }
}

function openAlertsPanel() {
  if (AppState.userRole !== 'admin') return;
  loadAlerts().then(function() {
    renderAlertsPanelBody();
    document.getElementById('alerts-panel-sheet').classList.add('open');
  });
}
function closeAlertsPanel(e) { if (!e || e.target === document.getElementById('alerts-panel-sheet')) document.getElementById('alerts-panel-sheet').classList.remove('open'); }

function setAlertsFilter(f) { AlertsState.filter = f; renderAlertsPanelBody(); }

function filteredAlerts() {
  var f = AlertsState.filter;
  return AlertsState.list.filter(function(a) {
    if (f === 'all') return true;
    if (f === 'open') return a.status !== 'resolved';
    return a.status === f;
  });
}

function renderAlertsPanelBody() {
  var body = document.getElementById('alerts-panel-body');
  if (!body) return;
  var html = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  [['open', 'Open'], ['unread', 'Unread'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['all', 'All']].forEach(function(f) {
    var active = AlertsState.filter === f[0];
    html += '<button onclick="setAlertsFilter(\'' + f[0] + '\')" style="font-size:12px;padding:4px 10px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:' + (active ? 'var(--header-bg)' : 'none') + ';color:' + (active ? '#fff' : 'var(--text-primary)') + '">' + f[1] + '</button>';
  });
  html += '</div>';
  if (unreadCount() > 0) html += '<button class="btn-dark" style="margin-bottom:10px" onclick="acknowledgeAllUnread()">Acknowledge all unread</button>';
  var rows = filteredAlerts();
  if (!rows.length) html += '<div style="font-size:12px;color:var(--text-muted)">No alerts.</div>';
  rows.forEach(function(a) {
    var col = SEVERITY_COLORS[a.severity] || '#999';
    html += '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:8px">';
    html += '<div style="display:flex;gap:8px;align-items:flex-start">';
    html += '<span style="width:8px;height:8px;border-radius:50%;background:' + col + ';margin-top:5px;flex-shrink:0"></span>';
    html += '<div style="flex:1">';
    html += '<div style="font-size:13px">' + escHtml(a.message) + '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + new Date(a.created_at).toLocaleString() + ' &middot; <span onclick="toggleAlertHistory(\'' + a.id + '\')" style="cursor:pointer;text-decoration:underline">' + STATUS_LABELS[a.status] + (a.status_changed_by ? (' — ' + escHtml(a.status_changed_by) + ', ' + new Date(a.status_changed_at).toLocaleDateString()) : '') + '</span></div>';
    html += '<div id="alert-history-' + a.id + '" style="display:none;margin-top:6px;font-size:11px;color:var(--text-secondary)"></div>';
    html += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">';
    if (a.status !== 'acknowledged' && a.status !== 'resolved') html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="setAlertStatus(\'' + a.id + '\',\'acknowledged\')">Acknowledge</button>';
    if (a.status !== 'in_progress' && a.status !== 'resolved') html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="promptAlertStatus(\'' + a.id + '\',\'in_progress\')">Mark in progress</button>';
    if (a.status !== 'resolved') html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="promptAlertStatus(\'' + a.id + '\',\'resolved\')">Resolve</button>';
    if (a.status === 'resolved') html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="setAlertStatus(\'' + a.id + '\',\'acknowledged\')">Reopen</button>';
    html += '</div></div></div></div>';
  });
  body.innerHTML = html;
}

function setAlertStatus(id, status, note) {
  var updates = { status: status };
  if (typeof note !== 'undefined') updates.status_note = note;
  sb.patch('alerts', id, updates).then(function(r) {
    if (!r.ok) { showToast('Error updating alert'); return; }
    loadAlerts().then(renderAlertsPanelBody);
  });
}

function promptAlertStatus(id, status) {
  var note = prompt(status === 'resolved' ? 'Resolution note (optional):' : 'Note (optional):');
  if (note === null) return; // cancelled
  setAlertStatus(id, status, note || null);
}

function acknowledgeAllUnread() {
  var unread = AlertsState.list.filter(function(a) { return a.status === 'unread'; });
  if (!unread.length) return;
  Promise.all(unread.map(function(a) { return sb.patch('alerts', a.id, { status: 'acknowledged' }); })).then(function() {
    loadAlerts().then(renderAlertsPanelBody);
  });
}

function toggleAlertHistory(id) {
  var el = document.getElementById('alert-history-' + id);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = '';
    el.textContent = 'Loading...';
    sb.get('audit_log', '?table_name=eq.alerts&record_id=eq.' + id + '&select=*&order=changed_at.asc').then(function(r) {
      if (!r.ok || !r.data) { el.textContent = 'Could not load history.'; return; }
      el.innerHTML = r.data.map(function(row) {
        return '<div style="padding:2px 0">' + new Date(row.changed_at).toLocaleString() + ' &mdash; ' + escHtml(row.changed_by) + ': ' + escHtml(row.old_value || '') + ' &rarr; ' + escHtml(row.new_value || '') + '</div>';
      }).join('') || 'No history.';
    });
  } else {
    el.style.display = 'none';
  }
}

// Refresh every 5 minutes while the app is open (admin only).
setInterval(function() {
  if (AppState.userRole === 'admin' && AppState.session) loadAlerts();
}, 5 * 60 * 1000);

// ── Settings → Alerts tab ──────────────────────────────────────
function renderAlertsSettingsTab() {
  var html = '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Alerts</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">No GPS alert after (minutes)</div><input class="settings-row-input" type="number" min="1" value="' + (AppState.settings.alert_gps_silence_minutes || 60) + '" onchange="saveSetting(\'alert_gps_silence_minutes\',this.value)"></div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin:2px 0 10px">Takes effect when GPS monitoring (slice 1b) ships.</div>';
  var tidEnabled = (AppState.settings.alert_tid_changed_enabled !== 'false');
  html += '<div class="settings-row"><div class="settings-row-label">Alert me when a user changes their own tracker ID</div>';
  html += '<input type="checkbox" ' + (tidEnabled ? 'checked' : '') + ' onchange="saveSetting(\'alert_tid_changed_enabled\',this.checked?\'true\':\'false\')"></div>';
  html += '</div></div>';
  return html;
}

// ── Settings → Audit Log tab (read-only, searchable) ───────────
function renderAuditLogTab() {
  var html = '<div class="settings-block"><div class="settings-block-header open"><span class="settings-block-title">Audit Log</span></div><div class="settings-block-body open">';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">';
  html += '<div style="flex:1;min-width:200px"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Search</label>'
    + '<input type="text" id="audit-search-text" placeholder="WO number, customer, value, email..." style="width:100%;box-sizing:border-box;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)" onkeydown="if(event.key===\'Enter\')applyAuditFilters()"></div>';
  html += '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">From</label>'
    + '<input type="date" id="audit-search-from" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"></div>';
  html += '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">To</label>'
    + '<input type="date" id="audit-search-to" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"></div>';
  html += '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Module</label>'
    + '<select id="audit-search-module" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">'
    + AUDIT_MODULES.map(function(m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('')
    + '</select></div>';
  html += '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Action</label>'
    + '<select id="audit-search-action" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">'
    + AUDIT_ACTIONS.map(function(a) { return '<option value="' + a[0] + '">' + a[1] + '</option>'; }).join('')
    + '</select></div>';
  html += '<button class="btn-dark" onclick="applyAuditFilters()">Search</button>';
  html += '<button onclick="clearAuditFilters()" style="padding:6px 14px;border:1px solid var(--border);border-radius:var(--radius);background:none;cursor:pointer;font-size:13px">Clear</button>';
  html += '</div>';
  html += '<div id="audit-log-rows"><div style="font-size:12px;color:var(--text-muted)">Loading...</div></div>';
  html += '<button class="btn-dark" id="audit-log-more-btn" style="margin-top:10px;display:none" onclick="loadMoreAuditLog()">Load more</button>';
  html += '</div></div>';
  return html;
}

var AUDIT_MODULES = [
  ['', 'All modules'],
  ['work_orders', 'Work Orders'], ['hours_entries', 'Hours Entries'], ['line_items', 'Line Items (Parts/Invoices)'],
  ['day_review', 'Day Review'], ['tasks', 'Tasks'], ['task_assignments', 'Task Assignments'],
  ['customers', 'Customers'], ['customer_contacts', 'Customer Contacts'], ['vendors', 'Vendors'],
  ['technicians', 'Technicians'], ['locations', 'Locations'], ['hours_types', 'Hours Types'],
  ['qbo_items', 'QBO Items'], ['quoted_invoices', 'Quoted Invoices'], ['wo_flags', 'WO Flags'],
  ['wo_statuses', 'WO Statuses'], ['settings', 'Settings'], ['contact_role_types', 'Contact Role Types'],
  ['bug_reports', 'Bug Reports'], ['bug_report_statuses', 'Bug Report Statuses'],
  ['dispatch_assignments', 'Dispatch Assignments'], ['profiles', 'Users'], ['alerts', 'Alerts'],
];
var AUDIT_ACTIONS = [
  ['', 'All actions'], ['create', 'Create'], ['update', 'Update'], ['deactivate', 'Deactivate'], ['reactivate', 'Reactivate'],
  ['email_change', 'Email change'], ['reset_password', 'Password reset'], ['tid_change', 'Tracker ID change'],
  ['tid_change_by_user', 'Tracker ID change (self)'], ['status_change', 'Status change'],
];

function initAuditLogTab() {
  AlertsState.auditPage = 0;
  AlertsState.auditRows = [];
  AlertsState.auditFilters = { text: '', from: '', to: '', module: '', action: '' };
  loadMoreAuditLog();
}

// Settings renders into both a desktop and mobile container at once, so an id can exist twice —
// pick whichever copy is actually visible rather than always grabbing the first (possibly hidden) one.
function getVisibleEl(id) {
  var els = document.querySelectorAll('[id="' + id + '"]');
  for (var i = 0; i < els.length; i++) { if (els[i].offsetParent !== null) return els[i]; }
  return els[0] || null;
}

function applyAuditFilters() {
  var textEl = getVisibleEl('audit-search-text');
  var fromEl = getVisibleEl('audit-search-from');
  var toEl = getVisibleEl('audit-search-to');
  var moduleEl = getVisibleEl('audit-search-module');
  var actionEl = getVisibleEl('audit-search-action');
  AlertsState.auditFilters = {
    text: textEl ? textEl.value.trim() : '',
    from: fromEl ? fromEl.value : '',
    to: toEl ? toEl.value : '',
    module: moduleEl ? moduleEl.value : '',
    action: actionEl ? actionEl.value : '',
  };
  AlertsState.auditPage = 0;
  AlertsState.auditRows = [];
  loadMoreAuditLog();
}

function clearAuditFilters() {
  ['audit-search-text', 'audit-search-from', 'audit-search-to', 'audit-search-module', 'audit-search-action'].forEach(function(id) {
    document.querySelectorAll('[id="' + id + '"]').forEach(function(el) { el.value = ''; });
  });
  applyAuditFilters();
}

function buildAuditQuery() {
  var pageSize = 50;
  var offset = AlertsState.auditPage * pageSize;
  var f = AlertsState.auditFilters || {};
  var params = ['select=*', 'order=changed_at.desc', 'limit=' + pageSize, 'offset=' + offset];
  if (f.module) params.push('table_name=eq.' + f.module);
  if (f.action) params.push('action=eq.' + f.action);
  if (f.from) params.push('changed_at=gte.' + f.from + 'T00:00:00');
  if (f.to) params.push('changed_at=lte.' + f.to + 'T23:59:59');
  if (f.text) {
    var safe = f.text.replace(/[,()."]/g, ' ').replace(/\s+/g, ' ').trim();
    if (safe) {
      var term = '*' + safe.split(' ').join('*') + '*';
      var orCols = ['context', 'changed_by', 'field_name', 'old_value', 'new_value', 'table_name'];
      params.push('or=(' + orCols.map(function(col) { return col + '.ilike.' + term; }).join(',') + ')');
    }
  }
  return '?' + params.join('&');
}

function loadMoreAuditLog() {
  sb.get('audit_log', buildAuditQuery()).then(function(r) {
    if (!r.ok) return;
    AlertsState.auditRows = AlertsState.auditRows.concat(r.data || []);
    AlertsState.auditPage++;
    // Settings renders into both a desktop and a mobile container, so this id can exist twice — update all of them.
    var rowsEls = document.querySelectorAll('[id="audit-log-rows"]');
    if (!rowsEls.length) return;
    var moduleLabels = {}; AUDIT_MODULES.forEach(function(m) { moduleLabels[m[0]] = m[1]; });
    var html = '<table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="border-bottom:2px solid var(--border)">'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">When</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Who</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Module</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Context</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Action</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Field</th>'
      + '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Old &rarr; New</th>'
      + '</tr></thead><tbody>';
    if (!AlertsState.auditRows.length) html += '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--text-muted)">No matching audit entries</td></tr>';
    AlertsState.auditRows.forEach(function(row) {
      html += '<tr style="border-bottom:1px solid var(--border)">'
        + '<td style="padding:4px 6px;white-space:nowrap">' + new Date(row.changed_at).toLocaleString() + '</td>'
        + '<td style="padding:4px 6px">' + escHtml(row.changed_by || '') + '</td>'
        + '<td style="padding:4px 6px">' + escHtml(moduleLabels[row.table_name] || row.table_name || '') + '</td>'
        + '<td style="padding:4px 6px">' + escHtml(row.context || '') + '</td>'
        + '<td style="padding:4px 6px">' + escHtml(row.action || '') + '</td>'
        + '<td style="padding:4px 6px">' + escHtml(row.field_name || '') + '</td>'
        + '<td style="padding:4px 6px">' + formatAuditOldNew(row.old_value, row.new_value) + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';
    rowsEls.forEach(function(el) { el.innerHTML = html; });
    var showMore = (r.data && r.data.length === 50);
    document.querySelectorAll('[id="audit-log-more-btn"]').forEach(function(btn) { btn.style.display = showMore ? '' : 'none'; });
  });
}
