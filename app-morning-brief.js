// app-morning-brief.js — Morning Brief + End of Day module
// Extracted from app-core.js during v4.38 modularization
// Depends on: AppState, MDRState, sb, escHtml, showToast, pushScreen,
//             isProcessedStatus, mdrUpsertDayReview, mdrClockIn,
//             initMobileDailyReview, openWODetail, drFormatTime

// ── Tech identity resolution ──────────────────────────────────
// Called once from showMainScreen after loadAllData completes.
// Sets AppState.userTechId by matching authenticated email to technicians table.
function resolveUserTechId() {
  if (!AppState.technicians || !AppState.userEmail) return;
  var emailPrefix = AppState.userEmail.split('@')[0].toLowerCase();
  var match = AppState.technicians.find(function(t) {
    return t.name && t.name.toLowerCase().indexOf(emailPrefix) >= 0;
  }) || AppState.technicians.find(function(t) {
    return t.email && t.email.toLowerCase() === AppState.userEmail.toLowerCase();
  });
  AppState.userTechId = match ? match.id : (AppState.technicians[0] ? AppState.technicians[0].id : null);
  // Keep MDRState.tech in sync
  if (AppState.userTechId) MDRState.tech = AppState.userTechId;
}

// ── Morning Brief — Mobile ────────────────────────────────────
function initMorningBrief() {
  var shell = document.getElementById('morning-brief-shell');
  if (!shell) return;
  shell.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Loading...</div>';
  var today = new Date().toISOString().slice(0,10);
  // Use resolved tech identity — set once at login, reliable
  var tech = AppState.userTechId || AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var dayReview = MDRState.currentDayReview || null;
  var clockedIn = dayReview && dayReview.clock_in;

  Promise.all([
    sb.get('dispatch_assignments', '?tech_id=eq.' + tech + '&scheduled_date=eq.' + today + '&order=sort_order.asc&select=*,work_orders(wo_number,title,status,form_mode,customers(name,display_name))'),
    sb.get('tasks', '?scheduled_date=eq.' + today + '&select=*,task_assignments(tech_id)'),
    sb.get('location_event', '?tid=eq.' + (AppState.traccarId || 'KM') + '&timestamp=gte.' + today + 'T04:00:00Z&timestamp=lte.' + today + 'T23:59:59Z&order=timestamp.asc&limit=1&select=timestamp,lat,lng')
  ]).then(function(results) {
    var dispatches = (results[0].ok ? results[0].data : []) || [];
    var allTasks = (results[1].ok ? results[1].data : []) || [];
    var firstPing = results[2].ok && results[2].data && results[2].data.length ? results[2].data[0] : null;
    var myTasks = allTasks.filter(function(t) {
      if (!t.task_assignments || !t.task_assignments.length) return true;
      return t.task_assignments.some(function(a) { return a.tech_id === tech; });
    });
    renderMorningBrief(shell, dispatches, myTasks, clockedIn, firstPing, today, tech);
  }).catch(function() {
    renderMorningBrief(shell, [], [], clockedIn, null, today, tech);
  });
}

function renderMorningBrief(shell, dispatches, tasks, clockedIn, firstPing, today, tech) {
  var now = new Date();
  var greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  var techName = '';
  if (AppState.technicians) {
    var t = AppState.technicians.find(function(t){ return t.id === tech; });
    if (t) techName = ', ' + t.name.split(' ')[0];
  }
  var dateStr = now.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});
  var html = '<div style="padding:16px">';

  // Header
  html += '<div style="margin-bottom:16px">';
  html += '<div style="font-size:20px;font-weight:700;color:var(--text-primary)">' + greeting + techName + '</div>';
  html += '<div style="font-size:13px;color:var(--text-secondary);margin-top:2px">' + dateStr + '</div>';
  html += '</div>';

  // Clock in banner
  if (!clockedIn) {
    html += '<div style="background:#fef3c7;border:1px solid #b45309;border-radius:var(--radius);padding:12px 14px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:600;color:#b45309;margin-bottom:6px">&#9888; You haven&#39;t clocked in yet</div>';
    if (firstPing) {
      var pingTime = new Date(firstPing.timestamp);
      var pingStr = pingTime.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
      html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">GPS shows activity starting at ' + pingStr + ' \u2014 use that as your clock-in time?</div>';
      html += '<div style="display:flex;gap:8px">';
      html += '<button data-suggested-ts="' + firstPing.timestamp + '" class="mb-clock-suggested" style="flex:1;padding:8px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">Clock in at ' + pingStr + '</button>';
      html += '<button onclick="mdrClockIn()" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;cursor:pointer;background:var(--surface)">Choose time</button>';
      html += '</div>';
    } else {
      html += '<button onclick="mdrClockIn()" style="width:100%;padding:8px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">Clock In</button>';
    }
    html += '</div>';
  }

  // Today's jobs
  html += '<div style="margin-bottom:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += '<div style="font-size:14px;font-weight:700;color:var(--text-primary)">Today&#39;s Jobs</div>';
  html += '<button onclick="mbAddDispatch()" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">+ Add job</button>';
  html += '</div>';

  if (!dispatches.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No jobs assigned for today</div>';
  } else {
    dispatches.forEach(function(d, i) {
      var wo = d.work_orders || {};
      var isQuoted = wo.form_mode === 'quoted';
      var custName = wo.customers ? (wo.customers.display_name || wo.customers.name || '') : '';
      if (!custName) {
        var c = AppState.customers && AppState.customers.find(function(c){ return c.id === (wo.customer_id || d.customer_id); });
        if (c) custName = c.display_name || c.name || '';
      }
      var borderColor = isQuoted ? '#b45309' : '#1a3a5c';
      var quotedBadge = isQuoted ? '<span style="font-size:10px;background:#fef3c7;color:#b45309;border:1px solid #b45309;border-radius:3px;padding:1px 5px">QUOTED</span>' : '';
      var upBtn = i > 0 ? '<button class="mb-move-btn" data-id="' + d.id + '" data-dir="up" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8593;</button>' : '';
      var dnBtn = i < dispatches.length - 1 ? '<button class="mb-move-btn" data-id="' + d.id + '" data-dir="down" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8595;</button>' : '';
      var notesHtml = d.notes ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic">' + escHtml(d.notes) + '</div>' : '';
      html += '<div class="mb-dispatch-card" data-wo-id="' + d.work_order_id + '" data-dispatch-id="' + d.id + '" style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ' + borderColor + ';border-radius:0 var(--radius) var(--radius) 0;padding:10px 12px;margin-bottom:6px;cursor:pointer">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between">';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + escHtml(wo.wo_number || '') + ' &#8212; ' + escHtml(wo.title || '') + '</div>';
      html += '<div style="display:flex;gap:4px;align-items:center">' + quotedBadge;
      html += '<button class="mb-remove-btn" data-id="' + d.id + '" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0 2px">&times;</button>';
      html += '</div></div>';
      html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">' + escHtml(custName) + '</div>';
      html += notesHtml;
      html += '<div style="display:flex;gap:6px;margin-top:6px">' + upBtn + dnBtn + '</div>';
      html += '</div>';
    });
  }
  html += '</div>';

  // Tasks
  html += '<div style="margin-bottom:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += '<div style="font-size:14px;font-weight:700;color:var(--text-primary)">Tasks</div>';
  html += '<button onclick="mbAddTask()" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">+ Add task</button>';
  html += '</div>';

  if (!tasks.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No tasks for today</div>';
  } else {
    tasks.forEach(function(t) {
      var done = t.status === 'done';
      var checkedAttr = done ? 'checked' : '';
      var strikeStyle = done ? 'text-decoration:line-through' : '';
      var notesHtml = t.notes ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escHtml(t.notes) + '</div>' : '';
      html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:10px;' + (done ? 'opacity:0.5' : '') + '">';
      html += '<input type="checkbox" class="mb-task-check" data-id="' + t.id + '" ' + checkedAttr + ' style="width:18px;height:18px;cursor:pointer;flex-shrink:0">';
      html += '<div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--text-primary);' + strikeStyle + '">' + escHtml(t.title) + '</div>' + notesHtml + '</div>';
      html += '</div>';
    });
  }
  html += '</div>';
  html += '</div>';
  shell.innerHTML = html;

  // Event delegation
  shell.addEventListener('click', function(e) {
    var suggested = e.target.closest('.mb-clock-suggested');
    if (suggested) { e.stopPropagation(); mdrClockInFromSuggested(suggested.dataset.suggestedTs); return; }
    var removeBtn = e.target.closest('.mb-remove-btn');
    if (removeBtn) { e.stopPropagation(); mbRemoveDispatch(removeBtn.dataset.id); return; }
    var moveBtn = e.target.closest('.mb-move-btn');
    if (moveBtn) { e.stopPropagation(); mbMoveDispatch(moveBtn.dataset.id, moveBtn.dataset.dir); return; }
    var card = e.target.closest('.mb-dispatch-card');
    if (card) { openWODetail(card.dataset.woId); return; }
  });
  shell.addEventListener('change', function(e) {
    var check = e.target.closest('.mb-task-check');
    if (check) mbToggleTask(check.dataset.id, check.checked);
  });
}

// ── Morning Brief — Desktop ───────────────────────────────────
function initMorningBriefDesktop() {
  var body = document.getElementById('desktop-morning-brief-body');
  if (!body) return;
  var today = new Date().toISOString().slice(0,10);
  body.innerHTML = '<div style="padding:8px;text-align:center;color:var(--text-muted)">Loading...</div>';
  Promise.all([
    sb.get('dispatch_assignments', '?scheduled_date=eq.' + today + '&order=sort_order.asc&select=*,work_orders(wo_number,title,status,form_mode,customer_id,customers(name,display_name)),technicians(name)'),
    sb.get('tasks', '?scheduled_date=eq.' + today + '&select=*,task_assignments(tech_id)')
  ]).then(function(results) {
    var dispatches = (results[0].ok ? results[0].data : []) || [];
    var tasks = (results[1].ok ? results[1].data : []) || [];
    renderMorningBriefDesktop(body, dispatches, tasks, today);
  }).catch(function() {
    body.innerHTML = '<div style="color:var(--text-muted)">Could not load morning brief</div>';
  });
}

function renderMorningBriefDesktop(body, dispatches, tasks, today) {
  var dateStr = new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});
  var html = '<div style="max-width:700px">';
  html += '<div style="font-size:22px;font-weight:700;margin-bottom:4px">Morning Brief</div>';
  html += '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:24px">' + dateStr + '</div>';

  var byTech = {};
  dispatches.forEach(function(d) {
    var tName = d.technicians ? d.technicians.name : 'Unassigned';
    if (!byTech[tName]) byTech[tName] = [];
    byTech[tName].push(d);
  });

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  html += '<div style="font-size:16px;font-weight:700">Dispatch \u2014 ' + today + '</div>';
  html += '<button onclick="mbAddDispatchDesktop()" style="padding:6px 14px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;cursor:pointer">+ Assign job</button>';
  html += '</div>';

  if (!dispatches.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:16px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center;margin-bottom:24px">No jobs assigned today</div>';
  } else {
    Object.keys(byTech).forEach(function(tName) {
      html += '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">' + escHtml(tName) + '</div>';
      byTech[tName].forEach(function(d, i) {
        var wo = d.work_orders || {};
        var isQuoted = wo.form_mode === 'quoted';
        var custName = wo.customers ? (wo.customers.display_name || wo.customers.name || '') : '';
        if (!custName) {
          var c = AppState.customers && AppState.customers.find(function(c){ return c.id === (wo.customer_id || d.customer_id); });
          if (c) custName = c.display_name || c.name || '';
        }
        var borderColor = isQuoted ? '#b45309' : '#1a3a5c';
        var quotedBadge = isQuoted ? '<span style="font-size:10px;background:#fef3c7;color:#b45309;border:1px solid #b45309;border-radius:3px;padding:1px 5px">QUOTED</span>' : '';
        var notesHtml = d.notes ? '<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px">' + escHtml(d.notes) + '</div>' : '';
        html += '<div class="mb-dt-dispatch" data-wo-id="' + d.work_order_id + '" data-dispatch-id="' + d.id + '" style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ' + borderColor + ';border-radius:0 var(--radius) var(--radius) 0;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px">';
        html += '<div style="flex:1;cursor:pointer" class="mb-dt-wo-link">';
        html += '<div style="font-size:13px;font-weight:600">' + escHtml(wo.wo_number || '') + ' &#8212; ' + escHtml(wo.title || '') + ' ' + quotedBadge + '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary)">' + escHtml(custName) + '</div>';
        html += notesHtml;
        html += '</div>';
        html += '<div style="display:flex;gap:4px">';
        if (i > 0) html += '<button class="mb-dt-move" data-id="' + d.id + '" data-dir="up" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8593;</button>';
        html += '<button class="mb-dt-move" data-id="' + d.id + '" data-dir="down" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8595;</button>';
        html += '<button class="mb-dt-remove" data-id="' + d.id + '" style="padding:4px 8px;border:1px solid var(--danger);border-radius:var(--radius);color:var(--danger);background:none;cursor:pointer">&times;</button>';
        html += '</div>';
        html += '</div>';
      });
    });
  }

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin:24px 0 10px">';
  html += '<div style="font-size:16px;font-weight:700">Tasks</div>';
  html += '<button onclick="mbAddTask()" style="padding:6px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);font-size:13px;cursor:pointer">+ Add task</button>';
  html += '</div>';

  if (!tasks.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:16px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No tasks today</div>';
  } else {
    tasks.forEach(function(t) {
      var done = t.status === 'done';
      var notesHtml = t.notes ? '<div style="font-size:12px;color:var(--text-muted)">' + escHtml(t.notes) + '</div>' : '';
      html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;' + (done ? 'opacity:0.5' : '') + '">';
      html += '<input type="checkbox" class="mb-task-check" data-id="' + t.id + '" ' + (done ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer">';
      html += '<div style="flex:1"><div style="font-size:13px;font-weight:500;' + (done ? 'text-decoration:line-through' : '') + '">' + escHtml(t.title) + '</div>' + notesHtml + '</div>';
      html += '</div>';
    });
  }

  html += '</div>';
  body.innerHTML = html;

  body.addEventListener('click', function(e) {
    var removeBtn = e.target.closest('.mb-dt-remove');
    if (removeBtn) { mbRemoveDispatch(removeBtn.dataset.id); return; }
    var moveBtn = e.target.closest('.mb-dt-move');
    if (moveBtn) { mbMoveDispatch(moveBtn.dataset.id, moveBtn.dataset.dir); return; }
    var woLink = e.target.closest('.mb-dt-wo-link');
    if (woLink) { openWODetail(woLink.closest('.mb-dt-dispatch').dataset.woId); return; }
  });
  body.addEventListener('change', function(e) {
    var check = e.target.closest('.mb-task-check');
    if (check) mbToggleTask(check.dataset.id, check.checked);
  });
}

// ── Dispatch helpers ──────────────────────────────────────────
function mdrClockInFromSuggested(timestamp) {
  var dt = new Date(timestamp);
  var updates = { clock_in: dt.toISOString(), clock_in_backdated: true, clock_in_source: 'gps_suggested', status: 'pending', sync_status: 'pending' };
  if (!MDRState.currentDayReview) MDRState.currentDayReview = {};
  MDRState.currentDayReview.clock_in = dt.toISOString();
  mdrUpsertDayReview(updates);
  setTimeout(function() { initMorningBrief(); }, 400);
}

function mbGetCustName(wo) {
  var custName = wo.customers ? (wo.customers.display_name || wo.customers.name || '') : '';
  if (!custName) {
    var c = AppState.customers && AppState.customers.find(function(c){ return c.id === wo.customer_id; });
    if (c) custName = c.display_name || c.name || '';
  }
  return custName;
}

function mbBuildWOOptions() {
  return (AppState.workOrders || []).filter(function(w){
    return w.active !== false && !isProcessedStatus(w.status);
  }).map(function(w){
    var isQuoted = w.form_mode === 'quoted';
    var custName = mbGetCustName(w);
    var label = w.wo_number + ' \u2014 ' + (w.title||'') + (custName ? ' (' + custName + ')' : '') + (isQuoted ? ' [QUOTED]' : '');
    return '<option value="' + w.id + '">' + escHtml(label) + '</option>';
  }).join('');
}

function mbAddDispatch() {
  var today = new Date().toISOString().slice(0,10);
  var tech = AppState.userTechId || AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var woOptions = mbBuildWOOptions();
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Add job to today</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Work order</div>' +
    '<select id="mb-add-wo" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px"><option value="">-- Select WO --</option>' + woOptions + '</select>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Notes (optional)</div>' +
    '<input type="text" id="mb-add-notes" placeholder="Anything to know before arriving..." style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button class="mb-overlay-cancel" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button class="mb-overlay-confirm" data-tech="' + tech + '" data-date="' + today + '" style="flex:1;padding:12px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:600;cursor:pointer">Add to today</button>' +
    '</div></div>';
  overlay.addEventListener('click', function(e) {
    if (e.target.closest('.mb-overlay-cancel')) { overlay.remove(); return; }
    var confirm = e.target.closest('.mb-overlay-confirm');
    if (confirm) { mbConfirmAddDispatch(confirm.dataset.tech, confirm.dataset.date, overlay); return; }
  });
  document.body.appendChild(overlay);
}

function mbConfirmAddDispatch(techId, date, overlay) {
  var woEl = document.getElementById('mb-add-wo');
  var notesEl = document.getElementById('mb-add-notes');
  var woId = woEl ? woEl.value : '';
  if (!woId) { showToast('Select a work order'); return; }
  var notes = notesEl ? notesEl.value.trim() : '';
  if (overlay) overlay.remove();
  sb.get('dispatch_assignments', '?tech_id=eq.' + techId + '&scheduled_date=eq.' + date + '&order=sort_order.desc&limit=1&select=sort_order').then(function(r) {
    var maxSort = (r.ok && r.data && r.data.length) ? (r.data[0].sort_order || 0) : 0;
    return sb.post('dispatch_assignments', {
      tech_id: techId, work_order_id: woId, scheduled_date: date,
      sort_order: maxSort + 1, notes: notes || null, status: 'assigned',
      created_by: AppState.userEmail || 'field', modified_by: AppState.userEmail || 'field'
    });
  }).then(function(r) {
    if (r && r.ok) { showToast('Job added to today'); initMorningBrief(); }
    else showToast('Error adding job');
  });
}

function mbAddDispatchDesktop() {
  var today = new Date().toISOString().slice(0,10);
  var techOptions = (AppState.technicians || []).map(function(t){
    return '<option value="' + t.id + '"' + (t.id === AppState.userTechId ? ' selected' : '') + '>' + escHtml(t.name) + '</option>';
  }).join('');
  var woOptions = mbBuildWOOptions();
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML =
    '<div style="background:var(--surface);border-radius:12px;padding:24px;width:420px;max-width:90vw">' +
    '<div style="font-size:16px;font-weight:700;margin-bottom:16px">Assign job</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Technician</div>' +
    '<select id="mb-add-tech" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' + techOptions + '</select>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Date</div>' +
    '<input type="date" id="mb-add-date" value="' + today + '" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Work order</div>' +
    '<select id="mb-add-wo-dt" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px"><option value="">-- Select WO --</option>' + woOptions + '</select>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Notes (optional)</div>' +
    '<input type="text" id="mb-add-notes-dt" placeholder="Anything to know before arriving..." style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button class="mb-overlay-cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:13px;cursor:pointer">Cancel</button>' +
    '<button class="mb-overlay-confirm-dt" style="flex:1;padding:10px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">Assign</button>' +
    '</div></div>';
  overlay.addEventListener('click', function(e) {
    if (e.target.closest('.mb-overlay-cancel')) { overlay.remove(); return; }
    if (e.target.closest('.mb-overlay-confirm-dt')) { mbConfirmAddDispatchDesktop(overlay); return; }
  });
  document.body.appendChild(overlay);
}

function mbConfirmAddDispatchDesktop(overlay) {
  var techEl = document.getElementById('mb-add-tech');
  var dateEl = document.getElementById('mb-add-date');
  var woEl = document.getElementById('mb-add-wo-dt');
  var notesEl = document.getElementById('mb-add-notes-dt');
  var techId = techEl ? techEl.value : '';
  var date = dateEl ? dateEl.value : '';
  var woId = woEl ? woEl.value : '';
  if (!woId) { showToast('Select a work order'); return; }
  var notes = notesEl ? notesEl.value.trim() : '';
  if (overlay) overlay.remove();
  sb.get('dispatch_assignments', '?tech_id=eq.' + techId + '&scheduled_date=eq.' + date + '&order=sort_order.desc&limit=1&select=sort_order').then(function(r) {
    var maxSort = (r.ok && r.data && r.data.length) ? (r.data[0].sort_order || 0) : 0;
    return sb.post('dispatch_assignments', {
      tech_id: techId, work_order_id: woId, scheduled_date: date,
      sort_order: maxSort + 1, notes: notes || null, status: 'assigned',
      created_by: AppState.userEmail || 'field', modified_by: AppState.userEmail || 'field'
    });
  }).then(function(r) {
    if (r && r.ok) { showToast('Job assigned'); initMorningBriefDesktop(); }
    else showToast('Error assigning job');
  });
}

function mbRemoveDispatch(id) {
  if (!confirm('Remove this job from the list?')) return;
  sb.delete('dispatch_assignments', '?id=eq.' + id).then(function() {
    showToast('Removed');
    if (AppState.desktopPanel === 'morningbrief') initMorningBriefDesktop();
    else initMorningBrief();
  });
}

function mbMoveDispatch(id, dir) {
  var today = new Date().toISOString().slice(0,10);
  var tech = AppState.userTechId || AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  sb.get('dispatch_assignments', '?tech_id=eq.' + tech + '&scheduled_date=eq.' + today + '&order=sort_order.asc&select=id,sort_order').then(function(r) {
    if (!r.ok || !r.data) return;
    var items = r.data;
    var idx = items.findIndex(function(i){ return i.id === id; });
    if (idx < 0) return;
    var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    var aSort = items[idx].sort_order;
    var bSort = items[swapIdx].sort_order;
    Promise.all([
      sb.patch('dispatch_assignments', '?id=eq.' + items[idx].id, {sort_order: bSort}),
      sb.patch('dispatch_assignments', '?id=eq.' + items[swapIdx].id, {sort_order: aSort})
    ]).then(function() {
      if (AppState.desktopPanel === 'morningbrief') initMorningBriefDesktop();
      else initMorningBrief();
    });
  });
}

function mbAddTask() {
  var today = new Date().toISOString().slice(0,10);
  var tech = AppState.userTechId || AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Add task</div>' +
    '<input type="text" id="mb-task-title" placeholder="What needs to be done?" style="width:100%;font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
    '<input type="text" id="mb-task-notes" placeholder="Notes (optional)" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button class="mb-overlay-cancel" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button class="mb-overlay-confirm-task" data-tech="' + tech + '" data-date="' + today + '" style="flex:1;padding:12px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:600;cursor:pointer">Add task</button>' +
    '</div></div>';
  overlay.addEventListener('click', function(e) {
    if (e.target.closest('.mb-overlay-cancel')) { overlay.remove(); return; }
    var confirm = e.target.closest('.mb-overlay-confirm-task');
    if (confirm) { mbConfirmAddTask(confirm.dataset.tech, confirm.dataset.date, overlay); return; }
  });
  document.body.appendChild(overlay);
  setTimeout(function(){ var el = document.getElementById('mb-task-title'); if(el) el.focus(); }, 100);
}

function mbConfirmAddTask(techId, date, overlay) {
  var titleEl = document.getElementById('mb-task-title');
  var notesEl = document.getElementById('mb-task-notes');
  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) { showToast('Enter a task description'); return; }
  var notes = notesEl ? notesEl.value.trim() : '';
  if (overlay) overlay.remove();
  sb.post('tasks', {
    scheduled_date: date, title: title, notes: notes || null,
    status: 'open', priority: 'normal',
    created_by: AppState.userEmail || 'field', modified_by: AppState.userEmail || 'field'
  }).then(function(r) {
    if (!r.ok) { showToast('Error saving task'); return; }
    sb.post('task_assignments', { task_id: r.data[0].id, tech_id: techId, role: 'primary' }).then(function() {
      showToast('Task added');
      if (AppState.desktopPanel === 'morningbrief') initMorningBriefDesktop();
      else initMorningBrief();
    });
  });
}

function mbToggleTask(id, done) {
  sb.patch('tasks', '?id=eq.' + id, { status: done ? 'done' : 'open', modified_at: new Date().toISOString() }).then(function() {
    if (AppState.desktopPanel === 'morningbrief') initMorningBriefDesktop();
    else initMorningBrief();
  });
}

// ── End of Day ────────────────────────────────────────────────
function mdrGoToEndOfDay() {
  initEndOfDay();
  pushScreen('screen-end-of-day', 'End of Day');
}

function initEndOfDay() {
  var shell = document.getElementById('end-of-day-shell');
  if (!shell) return;
  shell.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Loading...</div>';
  var today = new Date().toISOString().slice(0,10);
  var tech = AppState.userTechId || AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var dayReview = MDRState.currentDayReview || null;
  sb.get('hours_entries', '?tech_id=eq.' + tech + '&entry_date=eq.' + today + '&select=hours,work_order_id,work_orders(wo_number,title)').then(function(r) {
    var entries = (r.ok ? r.data : []) || [];
    renderEndOfDay(shell, dayReview, entries, today, tech);
  }).catch(function() {
    renderEndOfDay(shell, dayReview, [], today, tech);
  });
}

function renderEndOfDay(shell, dayReview, entries, today, tech) {
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  var now = new Date();
  var onClockMin = 0;
  if (clockIn) {
    var ciTime = new Date(clockIn);
    var coTime = clockOut ? new Date(clockOut) : now;
    onClockMin = Math.round((coTime - ciTime) / 60000);
  }
  var billedMin = 0;
  var woTotals = {};
  entries.forEach(function(e) {
    billedMin += (parseFloat(e.hours) || 0) * 60;
    var woNum = e.work_orders ? e.work_orders.wo_number : e.work_order_id;
    var woTitle = e.work_orders ? e.work_orders.title : '';
    if (!woTotals[woNum]) woTotals[woNum] = { title: woTitle, min: 0 };
    woTotals[woNum].min += (parseFloat(e.hours) || 0) * 60;
  });
  var gapMin = Math.max(0, onClockMin - billedMin);
  var onClockH = (onClockMin / 60).toFixed(1);
  var billedH = (billedMin / 60).toFixed(1);
  var gapH = (gapMin / 60).toFixed(1);
  var html = '<div style="padding:16px">';
  html += '<div style="font-size:20px;font-weight:700;margin-bottom:4px">End of Day</div>';
  html += '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:20px">' + new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + '</div>';
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:16px">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">';
  html += '<div><div style="font-size:22px;font-weight:700;color:var(--text-primary)">' + onClockH + 'h</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">On Clock</div></div>';
  html += '<div><div style="font-size:22px;font-weight:700;color:#27ae60">' + billedH + 'h</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Billed</div></div>';
  html += '<div><div style="font-size:22px;font-weight:700;color:' + (gapMin > 30 ? '#a32d2d' : 'var(--text-primary)') + '">' + gapH + 'h</div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Gap</div></div>';
  html += '</div>';
  if (!clockIn) html += '<div style="margin-top:10px;font-size:12px;color:#b45309;text-align:center">&#9888; No clock-in recorded today</div>';
  html += '</div>';
  if (Object.keys(woTotals).length) {
    html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">Billed today</div>';
    Object.keys(woTotals).forEach(function(woNum) {
      var wo = woTotals[woNum];
      html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
      html += '<div><div style="font-size:13px;font-weight:600">' + escHtml(woNum) + (wo.title ? ' \u2014 ' + escHtml(wo.title) : '') + '</div></div>';
      html += '<div style="font-size:14px;font-weight:700;color:#27ae60">' + (wo.min/60).toFixed(1) + 'h</div>';
      html += '</div>';
    });
  } else {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center;margin-bottom:16px">No hours billed today</div>';
  }
  if (gapMin > 30) {
    html += '<div style="background:#fcebeb;border:1px solid #a32d2d;border-radius:var(--radius);padding:12px 14px;margin-top:8px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:600;color:#a32d2d;margin-bottom:4px">&#9888; ' + gapH + 'h unaccounted</div>';
    html += '<div style="font-size:12px;color:var(--text-secondary)">Review the Field Travel Log to check for unallocated GPS stops.</div>';
    html += '<button onclick="mdrGoToFieldLog()" style="margin-top:8px;width:100%;padding:8px;border:1px solid #a32d2d;border-radius:var(--radius);color:#a32d2d;background:none;font-size:13px;font-weight:600;cursor:pointer">Review Field Travel Log</button>';
    html += '</div>';
  }
  html += '<div style="margin-top:24px">';
  if (!clockOut) {
    html += '<button onclick="eodClockOut()" style="width:100%;padding:14px;background:#a32d2d;color:#fff;border:none;border-radius:var(--radius);font-size:15px;font-weight:700;cursor:pointer">Clock Out &amp; Close Day</button>';
  } else {
    html += '<div style="text-align:center;padding:14px;background:#fcebeb;border-radius:var(--radius);font-size:14px;font-weight:600;color:#a32d2d">Clocked out at ' + drFormatTime(clockOut) + '</div>';
  }
  html += '</div>';
  html += '</div>';
  shell.innerHTML = html;
}

function initEndOfDayDesktop() {
  var body = document.getElementById('desktop-end-of-day-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;text-align:center;color:var(--text-muted)">Loading...</div>';
  var today = new Date().toISOString().slice(0,10);
  sb.get('hours_entries', '?entry_date=eq.' + today + '&select=hours,tech_id,work_order_id,work_orders(wo_number,title),technicians(name)').then(function(r) {
    var entries = (r.ok ? r.data : []) || [];
    var html = '<div style="max-width:700px">';
    html += '<div style="font-size:22px;font-weight:700;margin-bottom:4px">End of Day</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:24px">' + new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + '</div>';
    if (!entries.length) {
      html += '<div style="font-size:13px;color:var(--text-muted)">No hours entries recorded today.</div>';
    } else {
      var byTech = {};
      entries.forEach(function(e) {
        var name = e.technicians ? e.technicians.name : 'Unknown';
        if (!byTech[name]) byTech[name] = { total: 0, entries: [] };
        byTech[name].total += parseFloat(e.hours) || 0;
        byTech[name].entries.push(e);
      });
      Object.keys(byTech).forEach(function(name) {
        html += '<div style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">' + escHtml(name) + ' \u2014 ' + byTech[name].total.toFixed(1) + 'h billed</div>';
        byTech[name].entries.forEach(function(e) {
          var wo = e.work_orders || {};
          html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between">';
          html += '<div style="font-size:13px">' + escHtml(wo.wo_number||'') + (wo.title?' \u2014 '+escHtml(wo.title):'') + '</div>';
          html += '<div style="font-size:13px;font-weight:600;color:#27ae60">' + parseFloat(e.hours).toFixed(1) + 'h</div>';
          html += '</div>';
        });
      });
    }
    html += '</div>';
    body.innerHTML = html;
  });
}

function eodClockOut() {
  var now = new Date();
  var nowStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:4px">Clock Out</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">This will close out your day.</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px">Clock-out time:</div>' +
    '<input type="time" id="eod-clockout-time" value="' + nowStr + '" style="width:100%;font-size:18px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button class="eod-cancel" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button class="eod-confirm" style="flex:1;padding:12px;background:#a32d2d;color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:600;cursor:pointer">Clock Out</button>' +
    '</div></div>';
  overlay.addEventListener('click', function(e) {
    if (e.target.closest('.eod-cancel')) { overlay.remove(); return; }
    if (e.target.closest('.eod-confirm')) { eodConfirmClockOut(overlay); return; }
  });
  document.body.appendChild(overlay);
}

function eodConfirmClockOut(overlay) {
  var timeEl = document.getElementById('eod-clockout-time');
  if (!timeEl) return;
  var timeVal = timeEl.value;
  if (overlay) overlay.remove();
  var today = MDRState.selectedDate || new Date().toISOString().slice(0,10);
  var dt = new Date(today + 'T' + timeVal + ':00');
  var isBackdated = dt < new Date(new Date() - 60000);
  mdrUpsertDayReview({clock_out: dt.toISOString(), clock_out_backdated: isBackdated, clock_out_source: 'manual'});
  showToast('Day closed out');
  setTimeout(function() { initEndOfDay(); }, 400);
}

function mdrGoToFieldLog() {
  initMobileDailyReview();
  pushScreen('screen-mobile-dailyreview', 'Field Travel Log');
}
