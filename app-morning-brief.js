// app-morning-brief.js — Morning Brief + End of Day module
// Extracted from app-core.js during v4.38 modularization
// Depends on: AppState, MDRState, sb, escHtml, showToast, pushScreen,
//             isProcessedStatus, mdrUpsertDayReview, mdrClockIn,
//             initMobileDailyReview, openWODetail, drFormatTime

function mbGoToFTLDate(dateStr) {
  // Navigate desktop FTL to a specific historical date
  var monday = new Date(dateStr + 'T12:00:00');
  var day = monday.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  DRState.weekStart = monday;
  DRState.selectedDate = dateStr;
  localStorage.setItem('dwo_ftl_week_start', dateStr.substring(0,4) + '-' + String(monday.getMonth()+1).padStart(2,'0') + '-' + String(monday.getDate()).padStart(2,'0'));
  desktopNav('dailyreview');
}

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
    sb.get('tasks', '?task_type=eq.date&scheduled_date=eq.' + today + '&status=neq.completed&select=*,task_assignments(tech_id)'),
    sb.get('tasks', '?task_type=eq.location&status=neq.completed&select=*,task_assignments(tech_id),locations(name)'),
    sb.get('location_event', '?tid=eq.' + (AppState.traccarId || 'KM') + '&timestamp=gte.' + today + 'T04:00:00Z&timestamp=lte.' + today + 'T23:59:59Z&order=timestamp.asc&limit=1&select=timestamp,lat,lng')
  ]).then(function(results) {
    var dispatches  = (results[0].ok ? results[0].data : []) || [];
    var dateTasks   = (results[1].ok ? results[1].data : []) || [];
    var locTasks    = (results[2].ok ? results[2].data : []) || [];
    var firstPing   = results[3].ok && results[3].data && results[3].data.length ? results[3].data[0] : null;
    renderMorningBrief(shell, dispatches, dateTasks, locTasks, clockedIn, firstPing, today, tech);
  }).catch(function() {
    renderMorningBrief(shell, [], [], [], clockedIn, null, today, tech);
  });
}

function renderMorningBrief(shell, dispatches, dateTasks, locTasks, clockedIn, firstPing, today, tech) {
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

  // Tasks — container populated by tasksRenderSection in app-tasks.js
  html += '<div id="mb-tasks-shell" style="margin-bottom:16px"></div>';

  // Bug reports — admin only, loaded after render
  if (AppState.userRole === 'admin') {
    html += '<div id="mb-bug-reports-shell" style="margin-bottom:16px"></div>';
  }

  html += '</div>';
  shell.innerHTML = html;

  // Event delegation for dispatch section
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

  // Populate tasks section via app-tasks.js
  var taskShell = document.getElementById('mb-tasks-shell');
  if (taskShell && typeof tasksRenderSection === 'function') {
    tasksRenderSection(taskShell, dateTasks, locTasks, tech, true);
  }

  // Populate bug reports section (admin only)
  if (AppState.userRole === 'admin' && typeof loadBugReports === 'function') {
    loadBugReports('mb-bug-reports-shell', 'dashboard');
  }
}

// ── Dashboard section card helpers ───────────────────────────
function mbSectionCardStart(sectionId, title, badge, actionsHtml) {
  var expanded = false;
  try { expanded = localStorage.getItem('dwo_mb_sec_' + sectionId) === '1'; } catch(e) {}
  var h = '<div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:20px;overflow:hidden">';
  h += '<div onclick="mbToggleSection(\'' + sectionId + '\')" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);cursor:pointer;user-select:none;border-bottom:1px solid var(--border)">';
  h += '<span style="font-size:14px;font-weight:700">' + title + '</span>';
  h += '<span style="font-size:11px;padding:1px 8px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text-muted)">' + badge + '</span>';
  h += '<div style="flex:1"></div>';
  if (actionsHtml) h += actionsHtml;
  h += '<span id="mb-chevron-' + sectionId + '" style="font-size:11px;color:var(--text-muted);margin-left:8px;display:inline-block;transition:transform 0.15s' + (expanded ? ';transform:rotate(180deg)' : '') + '">&#9662;</span>';
  h += '</div>';
  h += '<div id="mb-sec-' + sectionId + '" data-expanded="' + (expanded ? '1' : '0') + '" style="' + (expanded ? '' : 'max-height:280px;overflow-y:auto;') + 'padding:12px 14px">';
  return h;
}

function mbSectionCardEnd() { return '</div></div>'; }

function mbToggleSection(id) {
  var body = document.getElementById('mb-sec-' + id);
  var chevron = document.getElementById('mb-chevron-' + id);
  if (!body) return;
  var expanded = body.dataset.expanded === '1';
  body.dataset.expanded = expanded ? '0' : '1';
  body.style.maxHeight = expanded ? '280px' : '';
  body.style.overflowY = expanded ? 'auto' : '';
  if (chevron) chevron.style.transform = expanded ? '' : 'rotate(180deg)';
  try { localStorage.setItem('dwo_mb_sec_' + id, expanded ? '0' : '1'); } catch(e) {}
}

// ── Morning Brief — Desktop ───────────────────────────────────
function initMorningBriefDesktop() {
  var body = document.getElementById('desktop-morning-brief-body');
  if (!body) return;
  var today = new Date().toISOString().slice(0,10);
  body.innerHTML = '<div style="padding:8px;text-align:center;color:var(--text-muted)">Loading...</div>';
  Promise.all([
    sb.get('dispatch_assignments', '?scheduled_date=eq.' + today + '&order=sort_order.asc&select=*,work_orders(wo_number,title,status,form_mode,customer_id,customers(name,display_name)),technicians(name)'),
    sb.get('tasks', '?task_type=eq.date&scheduled_date=eq.' + today + '&status=neq.completed&select=*,task_assignments(tech_id)'),
    sb.get('tasks', '?task_type=eq.location&status=neq.completed&select=*,task_assignments(tech_id),locations(name)'),
    sb.get('day_review', '?clock_in=not.is.null&clock_out=is.null&review_date=lt.' + today + '&select=id,tech_id,review_date,clock_in&order=review_date.desc&limit=20')
  ]).then(function(results) {
    var dispatches      = (results[0].ok ? results[0].data : []) || [];
    var dateTasks       = (results[1].ok ? results[1].data : []) || [];
    var locTasks        = (results[2].ok ? results[2].data : []) || [];
    var missingClockOut = (results[3].ok ? results[3].data : []) || [];
    renderMorningBriefDesktop(body, dispatches, dateTasks, locTasks, today, missingClockOut);
  }).catch(function() {
    body.innerHTML = '<div style="color:var(--text-muted)">Could not load morning brief</div>';
  });
}

function renderMorningBriefDesktop(body, dispatches, dateTasks, locTasks, today, missingClockOut) {
  missingClockOut = missingClockOut || [];
  dispatches = (dispatches || []).filter(function(d){
    return !(d.work_orders && isProcessedStatus(d.work_orders.status));
  });
  var dateStr = new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});
  var html = '<div style="max-width:700px">';
  html += '<div style="font-size:22px;font-weight:700;margin-bottom:4px">Daily Dashboard</div>';
  html += '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:20px">' + dateStr + '</div>';

  // Payroll alert — missing clock-outs
  if (missingClockOut.length) {
    html += '<div style="background:#fff0e6;border:1.5px solid #e67e22;border-radius:var(--radius);padding:12px 16px;margin-bottom:20px">';
    html += '<div style="font-size:13px;font-weight:700;color:#c0392b;margin-bottom:8px">&#9888; Payroll Alert — Missing Clock-out</div>';
    html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">'+missingClockOut.length+' day'+(missingClockOut.length===1?'':'s')+' clocked in with no clock-out recorded:</div>';
    missingClockOut.forEach(function(r) {
      var tech = AppState.technicians && AppState.technicians.find(function(t){ return t.id === r.tech_id; });
      var techName = tech ? tech.name : 'Unknown tech';
      var ciTime = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true}) : '';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:0.5px solid #e67e2244">';
      html += '<span style="font-size:12px"><strong>'+escHtml(r.review_date)+'</strong> &mdash; '+escHtml(techName)+' (in: '+escHtml(ciTime)+')</span>';
      html += '<a href="#" onclick="mbGoToFTLDate(\''+r.review_date+'\');return false" style="font-size:11px;color:#c0392b;text-decoration:underline">Fix in FTL</a>';
      html += '</div>';
    });
    html += '</div>';
  }

  var byTech = {};
  dispatches.forEach(function(d) {
    var tName = d.technicians ? d.technicians.name : 'Unassigned';
    if (!byTech[tName]) byTech[tName] = [];
    byTech[tName].push(d);
  });

  var dispBadge = dispatches.length + ' job' + (dispatches.length !== 1 ? 's' : '');
  var dispAction = '<button onclick="mbAddDispatchDesktop();event.stopPropagation()" style="padding:5px 12px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:12px;cursor:pointer;flex-shrink:0">+ Assign job</button>';
  html += mbSectionCardStart('dispatch', 'Dispatch \u2014 ' + today, dispBadge, dispAction);

  if (!dispatches.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No jobs assigned today</div>';
  } else {
    Object.keys(byTech).forEach(function(tName) {
      html += '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">' + escHtml(tName) + '</div>';
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
  html += mbSectionCardEnd();

  // Tasks section card
  var taskCount = ((dateTasks ? dateTasks.length : 0) + (locTasks ? locTasks.length : 0));
  var taskBadge = taskCount + ' task' + (taskCount !== 1 ? 's' : '');
  html += mbSectionCardStart('tasks', 'Tasks', taskBadge, '');
  html += '<div id="mb-dt-tasks-shell"></div>';
  html += mbSectionCardEnd();

  // Bug reports section card — admin only, loaded after render
  if (AppState.userRole === 'admin') {
    html += mbSectionCardStart('bugreports', 'Bug Reports', '<span id="mb-badge-bugreports">…</span>', '');
    html += '<div id="mb-dt-bug-reports-shell"></div>';
    html += mbSectionCardEnd();
  }

  html += '</div>';
  body.innerHTML = html;

  body.addEventListener('click', function(e) {
    if (e.target.closest('[onclick*="mbToggleSection"]')) return;
    var removeBtn = e.target.closest('.mb-dt-remove');
    if (removeBtn) { mbRemoveDispatch(removeBtn.dataset.id); return; }
    var moveBtn = e.target.closest('.mb-dt-move');
    if (moveBtn) { mbMoveDispatch(moveBtn.dataset.id, moveBtn.dataset.dir); return; }
    var woLink = e.target.closest('.mb-dt-wo-link');
    if (woLink) { openWODetail(woLink.closest('.mb-dt-dispatch').dataset.woId); return; }
  });

  // Populate tasks section via app-tasks.js
  var taskShell = document.getElementById('mb-dt-tasks-shell');
  if (taskShell && typeof tasksRenderSection === 'function') {
    var tech = AppState.userTechId || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
    tasksRenderSection(taskShell, dateTasks, locTasks, tech, false);
  }

  // Populate bug reports section (admin only)
  if (AppState.userRole === 'admin' && typeof loadBugReports === 'function') {
    loadBugReports('mb-dt-bug-reports-shell', 'dashboard');
  }
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
    var cat = statusCat(w.status);
    return w.active !== false && (cat === 'active' || cat === 'draft');
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

// ── End of Day / Exception Queue ─────────────────────────────
function mdrGoToEndOfDay() {
  initEndOfDay();
  pushScreen('screen-end-of-day', 'End of Day');
}

function initEndOfDay() {
  var shell = document.getElementById('end-of-day-shell');
  if (!shell) return;
  shell.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Loading...</div>';
  var tech = AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  _eodLoadQueue(shell, tech, false);
}

function initEndOfDayDesktop() {
  var body = document.getElementById('desktop-end-of-day-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;text-align:center;color:var(--text-muted)">Loading...</div>';
  var tech = AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  _eodLoadQueue(body, tech, true);
}

function _eodLoadQueue(container, tech, isDesktop) {
  var today = new Date().toISOString().slice(0, 10);
  var systemStart = AppState.settings.system_start_date || '2024-01-01';
  Promise.all([
    sb.get('day_review', '?tech_id=eq.' + tech + '&review_date=lte.' + today + '&review_date=gte.' + systemStart + '&order=review_date.desc&select=*'),
    sb.get('hours_entries', '?tech_id=eq.' + tech + '&entry_date=gte.' + systemStart + '&entry_date=lte.' + today + '&active=eq.true&select=hours,entry_date')
  ]).then(function(res) {
    var reviews = res[0].ok ? (res[0].data || []) : [];
    var entries = res[1].ok ? (res[1].data || []) : [];
    var billedByDate = {};
    entries.forEach(function(e) {
      billedByDate[e.entry_date] = (billedByDate[e.entry_date] || 0) + parseFloat(e.hours || 0);
    });
    var exceptions = [];
    var weekStart = _eodWeekStart(today);
    var weekOnClockMin = 0, weekBilledH = 0;

    reviews.forEach(function(r) {
      var date = r.review_date;
      var status = r.status || 'none';
      var billedH = billedByDate[date] || 0;
      var onClockMin = 0;
      if (r.clock_in) {
        var ci = new Date(r.clock_in);
        var co = r.clock_out ? new Date(r.clock_out) : (date === today ? new Date() : null);
        if (co) onClockMin = Math.max(0, Math.round((co - ci) / 60000));
      }
      var onClockH = onClockMin / 60;
      var pct = onClockH > 0 ? Math.round((billedH / onClockH) * 100) : null;
      var gapH = Math.max(0, onClockH - billedH);
      if (date >= weekStart && date <= today) { weekOnClockMin += onClockMin; weekBilledH += billedH; }
      if (date === today) {
        exceptions.push({ date: date, status: status, billedH: billedH, onClockH: onClockH, gapH: gapH, pct: pct, clockOut: r.clock_out, clockIn: r.clock_in, isToday: true });
        return;
      }
      var flags = [];
      if (!r.clock_out) flags.push('unclosed');
      if (status === 'kicked_back') flags.push('kicked_back');
      if (status !== 'accepted') flags.push('unreviewed');
      if (gapH > 0.5) flags.push('gap');
      if (flags.length) exceptions.push({ date: date, status: status, billedH: billedH, onClockH: onClockH, gapH: gapH, pct: pct, clockOut: r.clock_out, clockIn: r.clock_in, flags: flags });
    });

    Object.keys(billedByDate).forEach(function(date) {
      if (date === today) return;
      var hasReview = reviews.some(function(r){ return r.review_date === date; });
      if (!hasReview && billedByDate[date] > 0) {
        exceptions.push({ date: date, status: 'no_record', billedH: billedByDate[date], onClockH: 0, gapH: 0, pct: null, flags: ['no_record'] });
      }
    });

    exceptions.sort(function(a, b) {
      if (a.isToday) return -1; if (b.isToday) return 1;
      return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
    });

    _eodRenderQueue(container, exceptions, weekOnClockMin, weekBilledH, isDesktop);
  });
}

function _eodWeekStart(today) {
  var d = new Date(today + 'T12:00:00');
  var day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function _eodRenderQueue(container, exceptions, weekOnClockMin, weekBilledH, isDesktop) {
  var weekOnClockH = weekOnClockMin / 60;
  var weekPct = weekOnClockH > 0 ? Math.round((weekBilledH / weekOnClockH) * 100) : null;
  var pctColor = function(p) { return p >= 80 ? '#27ae60' : p >= 60 ? '#854f0b' : '#a32d2d'; };
  var fmtDate = function(d) {
    var p = d.split('-');
    var dt = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
    return dt.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
  };

  var html = '<div style="padding:16px' + (isDesktop ? ';max-width:700px' : '') + '">';
  html += '<div style="font-size:20px;font-weight:700;margin-bottom:12px">Exceptions Queue</div>';

  // Weekly summary bar
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:16px">';
  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;white-space:nowrap">This Week</div>';
  html += '<div style="display:flex;gap:16px;flex:1">';
  html += '<div style="text-align:center"><div style="font-size:15px;font-weight:700">' + weekOnClockH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">On Clock</div></div>';
  html += '<div style="text-align:center"><div style="font-size:15px;font-weight:700;color:#27ae60">' + weekBilledH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
  if (weekPct !== null) html += '<div style="text-align:center"><div style="font-size:15px;font-weight:700;color:' + pctColor(weekPct) + '">' + weekPct + '%</div><div style="font-size:10px;color:var(--text-muted)">Efficiency</div></div>';
  html += '</div></div>';

  if (!exceptions.length) {
    html += '<div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:14px">&#10003; All caught up</div>';
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  exceptions.forEach(function(ex) {
    var flags = ex.flags || [];
    var isRed = flags.indexOf('kicked_back') >= 0 || flags.indexOf('unclosed') >= 0;
    var isAmber = !isRed && flags.length > 0;
    var borderColor = isRed ? '#e24b4a' : isAmber ? '#ef9f27' : 'var(--border)';
    var headBg = isRed ? '#fcebeb' : isAmber ? '#faeeda' : 'var(--surface)';

    html += '<div style="border:1px solid ' + borderColor + ';border-radius:var(--radius);margin-bottom:10px;overflow:hidden">';
    html += '<div style="padding:10px 12px;background:' + headBg + ';display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
    html += '<div style="font-size:13px;font-weight:700;flex-shrink:0;margin-right:4px">' + (ex.isToday ? 'Today' : fmtDate(ex.date)) + '</div>';
    if (flags.indexOf('kicked_back') >= 0)  html += '<span style="font-size:10px;padding:2px 7px;background:#fcebeb;color:#a32d2d;border-radius:99px;font-weight:700">Kicked Back</span>';
    if (flags.indexOf('unclosed') >= 0)     html += '<span style="font-size:10px;padding:2px 7px;background:#fcebeb;color:#a32d2d;border-radius:99px;font-weight:700">Unclosed</span>';
    if (flags.indexOf('unreviewed') >= 0 && flags.indexOf('kicked_back') < 0) html += '<span style="font-size:10px;padding:2px 7px;background:#faeeda;color:#854f0b;border-radius:99px;font-weight:700">Unreviewed</span>';
    if (flags.indexOf('gap') >= 0)          html += '<span style="font-size:10px;padding:2px 7px;background:#faeeda;color:#854f0b;border-radius:99px;font-weight:700">Gap</span>';
    if (flags.indexOf('no_record') >= 0)    html += '<span style="font-size:10px;padding:2px 7px;background:#faeeda;color:#854f0b;border-radius:99px;font-weight:700">No Record</span>';
    if (ex.status === 'accepted')           html += '<span style="font-size:10px;padding:2px 7px;background:#eaf3de;color:#3b6d11;border-radius:99px;font-weight:700">&#10003; Accepted</span>';
    html += '</div>';

    html += '<div style="padding:8px 12px;display:flex;gap:12px;align-items:center;border-top:1px solid ' + borderColor + '">';
    html += '<div style="text-align:center"><div style="font-size:14px;font-weight:700">' + ex.onClockH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">On Clock</div></div>';
    html += '<div style="text-align:center"><div style="font-size:14px;font-weight:700;color:#27ae60">' + ex.billedH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
    if (ex.pct !== null) html += '<div style="text-align:center"><div style="font-size:14px;font-weight:700;color:' + pctColor(ex.pct) + '">' + ex.pct + '%</div><div style="font-size:10px;color:var(--text-muted)">Billed %</div></div>';
    if (ex.gapH > 0.5)  html += '<div style="text-align:center"><div style="font-size:14px;font-weight:700;color:#854f0b">' + ex.gapH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Gap</div></div>';
    html += '<div style="flex:1"></div>';
    if (ex.isToday && !ex.clockOut) html += '<button onclick="eodClockOut()" style="font-size:12px;padding:5px 12px;background:#a32d2d;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Clock Out</button>';
    html += '<button data-eod-date="' + ex.date + '" onclick="eodGoToFTL(this.getAttribute(\'data-eod-date\'))" style="font-size:12px;padding:5px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);cursor:pointer">&#8594; FTL</button>';
    html += '</div></div>';
  });

  html += '</div>';
  container.innerHTML = html;
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

function eodGoToFTL(dateStr) {
  var isMobile = window.innerWidth < 768;
  if (isMobile) {
    MDRState.selectedDate = dateStr;
    MDRState.weekStart = drGetMonday(new Date(dateStr + 'T12:00:00'));
    initMobileDailyReview();
    pushScreen('screen-mobile-dailyreview', 'Field Travel Log');
  } else {
    mbGoToFTLDate(dateStr);
  }
}
