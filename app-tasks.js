// app-tasks.js — Task module (Phase A: standalone + location tasks)
// v4.56 — Aug 2026
// Depends on: AppState, sb, escHtml, showToast
// Loads after app-morning-brief.js — overrides mbAddTask, mbToggleTask

var TasksState = {
  adminTasks: [],
  adminFilter: 'open'
};

// ── Claim expiry ───────────────────────────────────────────────
// Silently resets any claimed tasks from prior work days back to open.
function tasksCheckExpiry(tasks) {
  var today = new Date().toISOString().slice(0, 10);
  var expired = tasks.filter(function(t) {
    return t.status === 'claimed' && t.claimed_at && t.claimed_at.slice(0, 10) < today;
  });
  if (!expired.length) return;
  expired.forEach(function(t) {
    sb.patchWhere('tasks', 'id=eq.' + t.id, {
      status: 'open', claimed_by: null, claimed_at: null,
      modified_at: new Date().toISOString()
    });
  });
}

// ── Morning Brief section renderer ────────────────────────────
// Called from renderMorningBrief / renderMorningBriefDesktop after innerHTML is set.
// container — the shell div to populate
// dateTasks  — tasks for today (task_type='date')
// locTasks   — persistent location tasks (task_type='location')
// tech       — current tech uuid (null = show all, no actions)
// isMobile   — true for mobile bottom-sheet style quick-add
function tasksRenderSection(container, dateTasks, locTasks, tech, isMobile) {
  if (!container) return;

  tasksCheckExpiry(dateTasks.concat(locTasks));

  function isMyTask(t) {
    if (t.assignee_type === 'company') return true;
    if (!Array.isArray(t.task_assignments) || !t.task_assignments.length) return true;
    return t.task_assignments.some(function(a) { return a.tech_id === tech; });
  }

  var myDate = tech ? dateTasks.filter(isMyTask) : dateTasks;
  var myLoc  = tech ? locTasks.filter(isMyTask)  : locTasks;

  var addBtn = tech ? '<button class="tasks-section-add" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">+ Add task</button>' : '';
  var headSize = isMobile ? '14px' : '16px';

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += '<div style="font-size:' + headSize + ';font-weight:700;color:var(--text-primary)">Tasks</div>';
  html += addBtn;
  html += '</div>';

  if (!myDate.length && !myLoc.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No tasks for today</div>';
  } else {
    myDate.forEach(function(t) { html += tasksCardHtml(t, tech); });
    if (myLoc.length) {
      if (myDate.length) {
        html += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin:10px 0 6px">Location Tasks</div>';
      }
      myLoc.forEach(function(t) { html += tasksCardHtml(t, tech); });
    }
  }

  container.innerHTML = html;

  container.addEventListener('click', function(e) {
    if (e.target.closest('.tasks-section-add')) { mbAddTask(); return; }
    var btn = e.target.closest('[data-task-action]');
    if (!btn) return;
    var id = btn.dataset.id;
    var action = btn.dataset.taskAction;
    if (action === 'claim')    { taskClaim(id); return; }
    if (action === 'unclaim')  { taskUnclaim(id); return; }
    if (action === 'complete') { taskComplete(id); return; }
  });
}

function tasksCardHtml(t, tech) {
  var isCompleted   = t.status === 'completed';
  var isClaimed     = t.status === 'claimed';
  var isClaimedByMe = isClaimed && t.claimed_by === tech;
  var isClaimedByOther = isClaimed && !isClaimedByMe;

  var locName = t.locations ? (t.locations.name || '') : '';
  var isLocTask = t.task_type === 'location';

  var claimerName = '';
  if (isClaimedByOther && AppState.technicians) {
    var claimer = AppState.technicians.find(function(x) { return x.id === t.claimed_by; });
    if (claimer) claimerName = claimer.name.split(' ')[0];
  }

  var completedByName = '';
  if (isCompleted && t.completed_by && AppState.technicians) {
    var completer = AppState.technicians.find(function(x) { return x.id === t.completed_by; });
    if (completer) completedByName = completer.name.split(' ')[0];
  }

  var badge = '';
  if (isCompleted) {
    badge = '<span style="font-size:10px;background:#d4b8f0;color:#4a1a8a;border-radius:3px;padding:2px 6px;font-weight:600">DONE</span>';
  } else if (isClaimedByMe) {
    badge = '<span style="font-size:10px;background:#fef3c7;color:#b45309;border-radius:3px;padding:2px 6px;font-weight:600">CLAIMED BY YOU</span>';
  } else if (isClaimedByOther) {
    badge = '<span style="font-size:10px;background:#f0f0f0;color:#666660;border-radius:3px;padding:2px 6px;font-weight:600">CLAIMED' + (claimerName ? ' — ' + escHtml(claimerName) : '') + '</span>';
  }

  var notesHtml = t.notes ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escHtml(t.notes) + '</div>' : '';
  var locHtml   = (isLocTask && locName) ? '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">&#128205; ' + escHtml(locName) + '</div>' : '';
  var completedByHtml = (isCompleted && completedByName) ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">&#10003; Completed by ' + escHtml(completedByName) + '</div>' : '';

  var actions = '';
  if (tech && !isCompleted && !isClaimedByOther) {
    if (isClaimedByMe) {
      actions += '<button data-task-action="unclaim" data-id="' + t.id + '" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">Release</button>';
      actions += '<button data-task-action="complete" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;background:#27ae60;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Complete</button>';
    } else {
      actions += '<button data-task-action="claim" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Claim</button>';
      actions += '<button data-task-action="complete" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;background:#27ae60;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Done</button>';
    }
  }

  var opacity = isCompleted ? 'opacity:0.5;' : '';
  var html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;' + opacity + '">';
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">';
  html += '<div style="flex:1">';
  html += '<div style="font-size:13px;font-weight:500;color:var(--text-primary)">' + escHtml(t.title) + '</div>';
  html += notesHtml + locHtml + completedByHtml;
  html += '</div>';
  if (badge) html += '<div style="flex-shrink:0;margin-top:1px">' + badge + '</div>';
  html += '</div>';
  if (actions) html += '<div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">' + actions + '</div>';
  html += '</div>';
  return html;
}

// ── Claim / complete actions ──────────────────────────────────
function taskClaim(id) {
  var tech = AppState.userTechId;
  if (!tech) { showToast('Cannot identify technician'); return; }
  sb.patchWhere('tasks', 'id=eq.' + id, {
    status: 'claimed', claimed_by: tech, claimed_at: new Date().toISOString(),
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (!r.ok) { showToast('Error claiming task'); return; }
    tasksRefreshBrief();
  });
}

function taskUnclaim(id) {
  sb.patchWhere('tasks', 'id=eq.' + id, {
    status: 'open', claimed_by: null, claimed_at: null,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (!r.ok) { showToast('Error releasing task'); return; }
    tasksRefreshBrief();
  });
}

function taskComplete(id) {
  var tech = AppState.userTechId;
  sb.patchWhere('tasks', 'id=eq.' + id, {
    status: 'completed',
    completed_by: tech || null,
    completed_at: new Date().toISOString(),
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (!r.ok) { showToast('Error completing task'); return; }
    tasksRefreshBrief();
  });
}

function tasksRefreshBrief() {
  if (AppState.deviceMode === 'desktop') {
    initMorningBriefDesktop();
    if (AppState.desktopPanel === 'tasks') initTasksPanel();
  } else {
    initMorningBrief();
  }
}

// ── mbAddTask override ────────────────────────────────────────
// Replaces the version in app-morning-brief.js with a richer quick-add form.
function mbAddTask() {
  if (document.querySelector('.task-quick-add-overlay')) return;
  var today = new Date().toISOString().slice(0, 10);
  var tech  = AppState.userTechId || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var isMobile = AppState.deviceMode !== 'desktop';

  var overlay = document.createElement('div');
  overlay.className = 'task-quick-add-overlay';

  if (isMobile) {
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end';
    overlay.innerHTML =
      '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Add task</div>' +
      '<input type="text" id="task-add-title" placeholder="What needs to be done?" style="width:100%;font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
      '<input type="text" id="task-add-notes" placeholder="Notes (optional)" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Assign to</div>' +
      '<select id="task-add-assignee" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
      '<option value="me">Just me</option><option value="company">Everyone (company-wide)</option>' +
      '</select>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="task-add-cancel" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:14px;cursor:pointer">Cancel</button>' +
      '<button class="task-add-confirm" style="flex:1;padding:12px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:600;cursor:pointer">Add task</button>' +
      '</div></div>';
  } else {
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML =
      '<div style="background:var(--surface);border-radius:12px;padding:24px;width:400px;max-width:90vw">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:16px">Add task</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Task</div>' +
      '<input type="text" id="task-add-title" placeholder="What needs to be done?" style="width:100%;font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Notes (optional)</div>' +
      '<input type="text" id="task-add-notes" placeholder="Notes" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Date</div>' +
      '<input type="date" id="task-add-date" value="' + today + '" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Assign to</div>' +
      '<select id="task-add-assignee" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:16px">' +
      '<option value="me">Just me</option><option value="company">Everyone (company-wide)</option>' +
      '</select>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="task-add-cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:13px;cursor:pointer">Cancel</button>' +
      '<button class="task-add-confirm" style="flex:1;padding:10px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">Add task</button>' +
      '</div></div>';
  }

  overlay.addEventListener('click', function(e) {
    if (e.target.closest('.task-add-cancel')) { overlay.remove(); return; }
    if (e.target.closest('.task-add-confirm')) { tasksSaveQuickAdd(tech, today, overlay); return; }
  });
  document.body.appendChild(overlay);
  setTimeout(function() { var el = document.getElementById('task-add-title'); if (el) el.focus(); }, 100);
}

function tasksSaveQuickAdd(tech, defaultDate, overlay) {
  var titleEl    = document.getElementById('task-add-title');
  var notesEl    = document.getElementById('task-add-notes');
  var dateEl     = document.getElementById('task-add-date');
  var assigneeEl = document.getElementById('task-add-assignee');

  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) { showToast('Enter a task description'); return; }
  var notes        = notesEl && notesEl.value.trim() ? notesEl.value.trim() : null;
  var date         = (dateEl && dateEl.value) ? dateEl.value : defaultDate;
  var assigneeType = (assigneeEl && assigneeEl.value === 'company') ? 'company' : 'tech';

  if (overlay) overlay.remove();

  sb.post('tasks', {
    title: title, notes: notes,
    scheduled_date: date, task_type: 'date',
    status: 'open', priority: 'normal',
    assignee_type: assigneeType,
    created_by: AppState.userEmail || 'field',
    modified_by: AppState.userEmail || 'field'
  }).then(function(r) {
    if (!r.ok) { showToast('Error saving task'); return; }
    var taskId = r.data && r.data[0] && r.data[0].id;
    if (assigneeType === 'tech' && tech && taskId) {
      sb.post('task_assignments', { task_id: taskId, tech_id: tech });
    }
    showToast('Task added');
    tasksRefreshBrief();
  });
}

// mbToggleTask compatibility shim — old checkboxes fall through here if any remain.
function mbToggleTask(id, done) {
  if (done) taskComplete(id); else taskUnclaim(id);
}

// ── Admin panel ───────────────────────────────────────────────
function initTasksPanel() {
  var el = document.getElementById('tasks-panel-inner');
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;color:var(--text-muted)">Loading...</div>';
  sb.get('tasks', '?order=created_at.desc&limit=500&select=*,task_assignments(tech_id),locations(name)').then(function(r) {
    TasksState.adminTasks = Array.isArray(r.data) ? r.data : [];
    tasksRenderAdminPanel(el);
  });
}

function tasksRenderAdminPanel(el) {
  var tasks  = TasksState.adminTasks;
  var filter = TasksState.adminFilter;

  var header = '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">';
  header += '<div style="font-size:18px;font-weight:700">Tasks</div>';
  header += '<button class="tasks-admin-new" style="padding:8px 16px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">+ New task</button>';
  header += '</div>';

  var tabs = '<div style="display:flex;padding:0 20px;border-bottom:1px solid var(--border);flex-shrink:0">';
  ['open','claimed','completed','all'].forEach(function(f) {
    var count = f === 'all' ? tasks.length : tasks.filter(function(t){ return t.status === f; }).length;
    var active = f === filter;
    tabs += '<button class="tasks-admin-filter" data-filter="' + f + '" style="padding:10px 14px;font-size:13px;border:none;background:none;cursor:pointer;border-bottom:2px solid ' + (active ? 'var(--amber)' : 'transparent') + ';font-weight:' + (active ? '700' : '400') + ';color:' + (active ? 'var(--text-primary)' : 'var(--text-secondary)') + '">';
    tabs += (f.charAt(0).toUpperCase() + f.slice(1)) + ' <span style="font-size:11px;color:var(--text-muted)">(' + count + ')</span>';
    tabs += '</button>';
  });
  tabs += '</div>';

  var filtered = filter === 'all' ? tasks : tasks.filter(function(t){ return t.status === filter; });

  var list = '<div style="flex:1;overflow-y:auto;padding:16px 20px">';
  if (!filtered.length) {
    list += '<div style="text-align:center;padding:48px;color:var(--text-muted)">No ' + filter + ' tasks</div>';
  } else {
    filtered.forEach(function(t) {
      var locName = t.locations ? (t.locations.name || '') : '';
      var isLocTask = t.task_type === 'location';
      var techName = '';
      if (AppState.technicians && Array.isArray(t.task_assignments) && t.task_assignments.length) {
        var found = AppState.technicians.find(function(x){ return x.id === t.task_assignments[0].tech_id; });
        if (found) techName = found.name;
      }
      var assigneeLabel = t.assignee_type === 'company' ? 'Company-wide' : (techName || 'Specific tech');
      var sBg    = { open:'#e8f5e9', claimed:'#fef3c7', completed:'#ede0fc' }[t.status] || '#eee';
      var sColor = { open:'#27ae60', claimed:'#b45309', completed:'#4a1a8a' }[t.status] || '#666';
      var dateLabel = isLocTask ? ('&#128205; ' + escHtml(locName || 'No location')) : (t.scheduled_date || 'No date');

      var auditParts = [];
      if (t.claimed_by && AppState.technicians) {
        var claimerA = AppState.technicians.find(function(x){ return x.id === t.claimed_by; });
        if (claimerA) auditParts.push('Claimed by ' + escHtml(claimerA.name.split(' ')[0]) + (t.claimed_at ? ' &middot; ' + t.claimed_at.slice(0,10) : ''));
      }
      if (t.completed_by && AppState.technicians) {
        var completerA = AppState.technicians.find(function(x){ return x.id === t.completed_by; });
        if (completerA) auditParts.push('Completed by ' + escHtml(completerA.name.split(' ')[0]) + (t.completed_at ? ' &middot; ' + t.completed_at.slice(0,10) : ''));
      }

      list += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px">';
      list += '<div style="flex:1">';
      list += '<div style="font-size:14px;font-weight:600;margin-bottom:2px">' + escHtml(t.title) + '</div>';
      if (t.notes) list += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + escHtml(t.notes) + '</div>';
      list += '<div style="font-size:12px;color:var(--text-secondary)">' + dateLabel + ' &middot; ' + escHtml(assigneeLabel) + '</div>';
      if (auditParts.length) list += '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">' + auditParts.join(' &nbsp;&bull;&nbsp; ') + '</div>';
      list += '</div>';
      list += '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">';
      list += '<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;background:' + sBg + ';color:' + sColor + '">' + (t.status||'open').toUpperCase() + '</span>';
      if (t.status !== 'completed') list += '<button class="tasks-admin-complete" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;background:#27ae60;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Complete</button>';
      list += '<button class="tasks-admin-edit" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:none;cursor:pointer">Edit</button>';
      list += '<button class="tasks-admin-delete" data-id="' + t.id + '" style="font-size:12px;padding:4px 10px;border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius);background:none;cursor:pointer">Delete</button>';
      list += '</div></div>';
    });
  }
  list += '</div>';

  el.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';

  // Use a fresh wrapper so re-renders don't accumulate listeners on el.
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
  wrap.innerHTML = header + tabs + list;
  el.innerHTML = '';
  el.appendChild(wrap);

  wrap.addEventListener('click', function(e) {
    if (e.target.closest('.tasks-admin-new'))    { tasksOpenCreate(); return; }
    var fb = e.target.closest('.tasks-admin-filter');
    if (fb) { TasksState.adminFilter = fb.dataset.filter; tasksRenderAdminPanel(el); return; }
    var cb = e.target.closest('.tasks-admin-complete');
    if (cb) { taskComplete(cb.dataset.id); return; }
    var eb = e.target.closest('.tasks-admin-edit');
    if (eb) { tasksOpenEdit(eb.dataset.id); return; }
    var db = e.target.closest('.tasks-admin-delete');
    if (db) { tasksDeleteConfirm(db.dataset.id); return; }
  });
}

// ── Admin form ────────────────────────────────────────────────
function tasksOpenCreate() { tasksOpenTaskForm(null); }
function tasksOpenEdit(id) {
  var t = TasksState.adminTasks.find(function(x){ return x.id === id; });
  tasksOpenTaskForm(t || null);
}

function tasksOpenTaskForm(task) {
  var today   = new Date().toISOString().slice(0, 10);
  var isEdit  = !!task;
  var taskType = (task && task.task_type) || 'date';
  var assigneeType = (task && task.assignee_type) || 'company';
  var assignedTechId = (task && Array.isArray(task.task_assignments) && task.task_assignments.length) ? task.task_assignments[0].tech_id : null;

  var locSource = (LocState && Array.isArray(LocState.locations) && LocState.locations.length)
    ? Promise.resolve(LocState.locations)
    : sb.get('locations', '?active=eq.true&order=name.asc&select=id,name').then(function(r){ return Array.isArray(r.data) ? r.data : []; });

  locSource.then(function(locs) {
    var locOpts = '<option value="">-- No location --</option>';
    locs.forEach(function(l) {
      var sel = (task && task.location_id === l.id) ? ' selected' : '';
      locOpts += '<option value="' + l.id + '"' + sel + '>' + escHtml(l.name || l.id) + '</option>';
    });

    var techOpts = '';
    (AppState.technicians || []).forEach(function(t) {
      var sel = assignedTechId === t.id ? ' selected' : '';
      techOpts += '<option value="' + t.id + '"' + sel + '>' + escHtml(t.name) + '</option>';
    });

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:400;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML =
      '<div style="background:var(--surface);border-radius:12px;padding:24px;width:480px;max-width:100%;max-height:90vh;overflow-y:auto">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:20px">' + (isEdit ? 'Edit task' : 'New task') + '</div>' +

      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">TITLE</div>' +
      '<input type="text" id="task-form-title" value="' + escHtml((task && task.title) || '') + '" placeholder="What needs to be done?" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:14px;margin-bottom:14px">' +

      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">NOTES</div>' +
      '<input type="text" id="task-form-notes" value="' + escHtml((task && task.notes) || '') + '" placeholder="Optional notes" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px;margin-bottom:14px">' +

      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">TASK TYPE</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px">' +
      '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg);font-size:13px">' +
      '<input type="radio" name="tf-type" value="date" ' + (taskType === 'date' ? 'checked' : '') + '> Date task</label>' +
      '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg);font-size:13px">' +
      '<input type="radio" name="tf-type" value="location" ' + (taskType === 'location' ? 'checked' : '') + '> Location task</label>' +
      '</div>' +

      '<div id="tf-date-row" style="' + (taskType !== 'date' ? 'display:none;' : '') + 'margin-bottom:14px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">SCHEDULED DATE</div>' +
      '<input type="date" id="task-form-date" value="' + ((task && task.scheduled_date) || today) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px">' +
      '</div>' +

      '<div id="tf-loc-row" style="' + (taskType !== 'location' ? 'display:none;' : '') + 'margin-bottom:14px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">LOCATION</div>' +
      '<select id="task-form-loc" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px">' + locOpts + '</select>' +
      '</div>' +

      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">ASSIGN TO</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px">' +
      '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg);font-size:13px">' +
      '<input type="radio" name="tf-assignee" value="company" ' + (assigneeType === 'company' ? 'checked' : '') + '> Company-wide</label>' +
      '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--bg);font-size:13px">' +
      '<input type="radio" name="tf-assignee" value="tech" ' + (assigneeType === 'tech' ? 'checked' : '') + '> Specific tech</label>' +
      '</div>' +

      '<div id="tf-tech-row" style="' + (assigneeType !== 'tech' ? 'display:none;' : '') + 'margin-bottom:14px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">TECHNICIAN</div>' +
      '<select id="task-form-tech" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px">' + techOpts + '</select>' +
      '</div>' +

      '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">PRIORITY</div>' +
      '<select id="task-form-priority" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px;margin-bottom:20px">' +
      '<option value="normal"' + ((!task || task.priority === 'normal') ? ' selected' : '') + '>Normal</option>' +
      '<option value="high"' + ((task && task.priority === 'high') ? ' selected' : '') + '>High</option>' +
      '<option value="urgent"' + ((task && task.priority === 'urgent') ? ' selected' : '') + '>Urgent</option>' +
      '</select>' +

      '<div style="display:flex;gap:8px">' +
      '<button class="tf-cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:none;font-size:13px;cursor:pointer">Cancel</button>' +
      '<button class="tf-save" style="flex:1;padding:10px;background:#1a3a5c;color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">' + (isEdit ? 'Save changes' : 'Create task') + '</button>' +
      '</div></div>';

    overlay.addEventListener('change', function(e) {
      var tr = e.target.closest('input[name="tf-type"]');
      if (tr) {
        var dr = document.getElementById('tf-date-row');
        var lr = document.getElementById('tf-loc-row');
        if (dr) dr.style.display = tr.value === 'date' ? '' : 'none';
        if (lr) lr.style.display = tr.value === 'location' ? '' : 'none';
      }
      var ar = e.target.closest('input[name="tf-assignee"]');
      if (ar) {
        var techR = document.getElementById('tf-tech-row');
        if (techR) techR.style.display = ar.value === 'tech' ? '' : 'none';
      }
    });

    overlay.addEventListener('click', function(e) {
      if (e.target.closest('.tf-cancel')) { overlay.remove(); return; }
      if (e.target.closest('.tf-save'))   { tasksSaveAdminForm(task ? task.id : null, overlay); return; }
    });

    document.body.appendChild(overlay);
    setTimeout(function() { var el = document.getElementById('task-form-title'); if (el) el.focus(); }, 100);
  });
}

function tasksSaveAdminForm(id, overlay) {
  var titleEl    = document.getElementById('task-form-title');
  var notesEl    = document.getElementById('task-form-notes');
  var dateEl     = document.getElementById('task-form-date');
  var locEl      = document.getElementById('task-form-loc');
  var priorityEl = document.getElementById('task-form-priority');
  var techEl     = document.getElementById('task-form-tech');
  var typeRadio    = document.querySelector('input[name="tf-type"]:checked');
  var assigneeRadio = document.querySelector('input[name="tf-assignee"]:checked');

  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) { showToast('Enter a task title'); return; }

  var taskType     = typeRadio     ? typeRadio.value     : 'date';
  var assigneeType = assigneeRadio ? assigneeRadio.value : 'company';
  var techId       = (assigneeType === 'tech' && techEl) ? techEl.value : null;

  var record = {
    title:          title,
    notes:          (notesEl && notesEl.value.trim()) ? notesEl.value.trim() : null,
    task_type:      taskType,
    assignee_type:  assigneeType,
    priority:       priorityEl ? priorityEl.value : 'normal',
    scheduled_date: (taskType === 'date' && dateEl && dateEl.value) ? dateEl.value : null,
    location_id:    (taskType === 'location' && locEl && locEl.value) ? locEl.value : null,
    modified_at:    new Date().toISOString(),
    modified_by:    AppState.userEmail || 'admin'
  };
  if (!id) {
    record.status     = 'open';
    record.created_by = AppState.userEmail || 'admin';
  }

  if (overlay) overlay.remove();

  var save = id
    ? sb.patchWhere('tasks', 'id=eq.' + id, record)
    : sb.post('tasks', record);

  save.then(function(r) {
    if (!r.ok) { showToast('Error saving task'); return; }
    var taskId = id || (Array.isArray(r.data) && r.data[0] && r.data[0].id);
    if (taskId) {
      if (assigneeType === 'tech' && techId) {
        sb.deleteWhere('task_assignments', 'task_id=eq.' + taskId).then(function() {
          sb.post('task_assignments', { task_id: taskId, tech_id: techId });
        });
      } else if (assigneeType === 'company') {
        sb.deleteWhere('task_assignments', 'task_id=eq.' + taskId);
      }
    }
    showToast(id ? 'Task updated' : 'Task created');
    initTasksPanel();
  });
}

function tasksDeleteConfirm(id) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  sb.deleteWhere('task_assignments', 'task_id=eq.' + id).then(function() {
    return sb.deleteWhere('tasks', 'id=eq.' + id);
  }).then(function(r) {
    if (!r || !r.ok) { showToast('Error deleting task'); return; }
    showToast('Task deleted');
    initTasksPanel();
  });
}
