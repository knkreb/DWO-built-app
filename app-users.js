// app-users.js — v4.88 — Slice 1: User Identity
// Real login identity via profiles (keyed to auth user id), the Users screen (admin),
// and self-service tracker ID. See docs/specs/slice-1-user-identity.md
// Depends on: AppState, sb, escHtml, showToast, showScreen, showHeader, renderSettings,
//             loadTechnicians, loadAllData, showMainScreen, continueLoginAfterIdentity

// ── Login identity ────────────────────────────────────────────
function loadProfileAndIdentity() {
  var userId = AppState.session && AppState.session.user && AppState.session.user.id;
  return sb.get('profiles', '?user_id=eq.' + encodeURIComponent(userId) + '&select=*').then(function(r) {
    var profile = (r.ok && r.data && r.data.length) ? r.data[0] : null;
    if (!profile || !profile.active) {
      AppState.profile = null; AppState.userRole = null; AppState.userTechId = null;
      var msgEl = document.getElementById('not-setup-message');
      if (msgEl) msgEl.textContent = "Your login isn't set up in DWO yet. Contact Kevin.";
      showScreen('screen-not-setup'); showHeader(false);
      return 'not_setup';
    }
    AppState.profile = profile;
    AppState.userRole = profile.template;
    AppState.userTechId = profile.technician_id || null;
    if (profile.must_change_password) {
      document.getElementById('set-password-new').value = '';
      document.getElementById('set-password-confirm').value = '';
      document.getElementById('set-password-error').textContent = '';
      showScreen('screen-set-password'); showHeader(false);
      return 'must_change_password';
    }
    return 'ok';
  });
}

function submitForcedPasswordChange() {
  var pw = document.getElementById('set-password-new').value;
  var pw2 = document.getElementById('set-password-confirm').value;
  var errEl = document.getElementById('set-password-error');
  errEl.textContent = '';
  if (!pw || pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }
  var btn = document.getElementById('btn-set-password');
  btn.disabled = true; btn.textContent = 'Saving...';
  sb.invoke('admin-users', { action: 'change_own_password', new_password: pw }).then(function(r) {
    btn.disabled = false; btn.textContent = 'Save';
    if (!r.ok) { errEl.textContent = (r.data && r.data.error) || 'Could not save password.'; return; }
    AppState.profile.must_change_password = false;
    continueLoginAfterIdentity();
  });
}

// Called once from showMainScreen after loadAllData completes.
// Sets AppState.userTechId from the login's own profile (never a name/email guess).
function resolveUserTechId() {
  if (!AppState.profile) return;
  AppState.userTechId = AppState.profile.technician_id || null;
  if (AppState.userTechId && typeof MDRState !== 'undefined') MDRState.tech = AppState.userTechId;
  maybeShowTrackerPrompt();
}

// ── Tracker ID: startup prompt + self-service ─────────────────
function maybeShowTrackerPrompt() {
  if (!AppState.userTechId || AppState._trackerPromptShownThisSession) return;
  var tech = (AppState.allTechnicians || AppState.technicians || []).find(function(t){ return t.id === AppState.userTechId; });
  if (tech && !tech.tid) {
    AppState._trackerPromptShownThisSession = true;
    openTrackerIdSheet(true);
  }
}

function openTrackerIdSheet(isStartupPrompt) {
  var tech = (AppState.allTechnicians || AppState.technicians || []).find(function(t){ return t.id === AppState.userTechId; });
  var input = document.getElementById('tracker-id-input');
  input.value = (tech && tech.tid) || '';
  document.getElementById('tracker-id-error').textContent = '';
  document.getElementById('tracker-id-sheet-title').textContent = isStartupPrompt ? 'GPS tracker ID' : 'My tracker ID';
  document.getElementById('tracker-id-sheet-help').textContent = isStartupPrompt
    ? 'Enter the ID set in your tracking app.'
    : 'View, change or clear the tracker ID for your device.';
  document.getElementById('tracker-id-later-btn').style.display = isStartupPrompt ? '' : 'none';
  document.getElementById('tracker-id-sheet').classList.add('open');
}
function openMyTrackerIdSheet() { if (typeof closeHamburger === 'function') closeHamburger(); openTrackerIdSheet(false); }
function closeTrackerIdSheet(e) { if (!e || e.target === document.getElementById('tracker-id-sheet')) document.getElementById('tracker-id-sheet').classList.remove('open'); }

function saveOwnTrackerId() {
  var val = document.getElementById('tracker-id-input').value.trim().toUpperCase();
  var errEl = document.getElementById('tracker-id-error');
  errEl.textContent = '';
  sb.invoke('admin-users', { action: 'set_own_tid', tid: val }).then(function(r) {
    if (!r.ok) { errEl.textContent = (r.data && r.data.error) || 'Could not save.'; return; }
    [AppState.allTechnicians, AppState.technicians].forEach(function(list) {
      var t = (list || []).find(function(x){ return x.id === AppState.userTechId; });
      if (t) t.tid = val || null;
    });
    closeTrackerIdSheet();
    showToast('Tracker ID saved');
  });
}

// ── Users screen (Settings, admin only) ───────────────────────
function loadProfilesList() {
  return sb.get('profiles', '?select=*&order=display_name.asc').then(function(r) { if (r.ok) AppState._profilesList = r.data || []; });
}

function setUsersFilter(f) {
  AppState._usersFilter = f;
  renderSettings('settings-body-desktop'); renderSettings('settings-body-mobile');
}

function renderUsersBlock() {
  if (AppState.userRole !== 'admin') return '';
  if (!AppState._profilesList) {
    loadProfilesList().then(function() { renderSettings('settings-body-desktop'); renderSettings('settings-body-mobile'); });
    return '<div class="settings-block"><div class="settings-block-header open"><span class="settings-block-title">Users</span></div><div class="settings-block-body open"><div style="font-size:12px;color:var(--text-muted)">Loading users...</div></div></div>';
  }
  var filter = AppState._usersFilter || 'active';
  var html = '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Users</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div style="display:flex;gap:6px;margin-bottom:10px">';
  ['active', 'inactive', 'all'].forEach(function(f) {
    var active = filter === f;
    html += '<button onclick="setUsersFilter(\'' + f + '\')" style="font-size:12px;padding:4px 10px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:' + (active ? 'var(--header-bg)' : 'none') + ';color:' + (active ? '#fff' : 'var(--text-primary)') + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
  });
  html += '</div>';

  var rows = AppState._profilesList.filter(function(p) {
    if (filter === 'active') return p.active;
    if (filter === 'inactive') return !p.active;
    return true;
  });
  if (!rows.length) html += '<div style="font-size:12px;color:var(--text-muted)">No users.</div>';
  rows.forEach(function(p) {
    var tech = (AppState.allTechnicians || []).find(function(t) { return t.id === p.technician_id; });
    var col = tech ? (tech.color || '#cccccc') : '#cccccc';
    html += '<div class="lookup-item" style="align-items:center;flex-wrap:wrap;gap:6px' + (p.active ? '' : ';opacity:.55') + '">';
    html += '<span style="width:12px;height:12px;border-radius:50%;background:' + col + ';display:inline-block;flex-shrink:0"></span>';
    html += '<span class="lookup-item-name">' + escHtml(p.display_name) + '</span>';
    html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(p.email) + '</span>';
    html += '<span class="lookup-item-badge">' + (p.template === 'admin' ? 'Admin' : 'Field Tech') + '</span>';
    if (tech) {
      html += '<span style="font-size:11px;color:var(--text-muted)">TID:</span>';
      html += '<input type="text" value="' + (tech.tid || '') + '" placeholder="e.g. KM" maxlength="4" style="width:44px;font-size:12px;padding:2px 5px;border:1px solid var(--border);border-radius:3px;background:var(--bg);text-align:center" onblur="saveTechFieldAudited(\'' + tech.id + '\',\'tid\',this.value)">';
      if (!tech.tid) html += '<span style="font-size:10px;color:#e67e22">No tracker ID</span>';
      html += '<span style="font-size:11px;color:var(--text-muted)">Color:</span>';
      html += '<input type="color" value="' + col + '" style="width:28px;height:22px;padding:0;border:1px solid var(--border);border-radius:3px;cursor:pointer" onchange="saveTechColor(\'' + tech.id + '\',this.value)">';
    }
    if (!p.active) {
      html += '<span style="font-size:11px;color:var(--text-muted)">Deactivated ' + (p.deactivated_at ? new Date(p.deactivated_at).toLocaleDateString() : '') + ' by ' + escHtml(p.deactivated_by || '') + '</span>';
      html += '<button class="btn-dark" style="font-size:11px;padding:2px 8px;margin-left:auto" onclick="confirmReactivateUser(\'' + p.id + '\',\'' + escHtml(p.display_name) + '\')">Reactivate</button>';
    } else {
      html += '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">';
      html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="openResetPasswordSheet(\'' + p.id + '\',\'' + escHtml(p.display_name) + '\')">Reset password</button>';
      html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer" onclick="openChangeEmailSheet(\'' + p.id + '\',\'' + escHtml(p.email) + '\')">Change email</button>';
      html += '<button style="font-size:11px;padding:2px 8px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="confirmDeactivateUser(\'' + p.id + '\',\'' + escHtml(p.display_name) + '\')">Deactivate</button>';
      html += '</span>';
    }
    html += '</div>';
  });
  html += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"><button class="btn-dark" onclick="openAddUserSheet()">+ Add User</button></div>';
  html += '</div></div>';
  return html;
}

function saveTechFieldAudited(techId, field, value) {
  var tech = (AppState.allTechnicians || []).find(function(t) { return t.id === techId; });
  var oldVal = tech ? (tech[field] || null) : null;
  var newVal = value.trim ? (value.trim() || null) : (value || null);
  if (oldVal === newVal) return;
  var updates = {}; updates[field] = newVal;
  sb.patch('technicians', techId, updates).then(function(r) {
    if (!r.ok) { showToast('Error saving'); return; }
    [AppState.allTechnicians, AppState.technicians].forEach(function(list) {
      var t = (list || []).find(function(x) { return x.id === techId; });
      if (t) t[field] = newVal;
    });
    sb.post('audit_log', {
      table_name: 'technicians', record_id: techId, action: 'tid_change',
      field_name: field, old_value: oldVal, new_value: newVal,
      changed_by: AppState.userEmail, changed_at: new Date().toISOString(),
    });
    showToast(field + ' saved');
  });
}

// ── Generic confirm/form sheet for Users screen actions ───────
function openUserActionSheet(title, bodyHtml) {
  document.getElementById('user-action-sheet-title').textContent = title;
  document.getElementById('user-action-sheet-body').innerHTML = bodyHtml;
  document.getElementById('user-action-sheet').classList.add('open');
}
function closeUserActionSheet(e) { if (!e || e.target === document.getElementById('user-action-sheet')) document.getElementById('user-action-sheet').classList.remove('open'); }

function refreshUsersScreen() {
  AppState._profilesList = null;
  return loadTechnicians().then(function() { renderSettings('settings-body-desktop'); renderSettings('settings-body-mobile'); });
}

function confirmDeactivateUser(profileId, name) {
  openUserActionSheet('Deactivate ' + name + '?',
    '<p style="font-size:13px;color:var(--text-secondary)">' + escHtml(name) + " can't sign in and is removed from dropdowns. All history is kept. You can reactivate any time.</p>"
    + '<div id="user-action-error" style="color:var(--danger);font-size:12px;margin-top:6px"></div>'
    + '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn-dark" style="flex:1;background:var(--danger)" onclick="submitSetActive(\'' + profileId + '\',false)">Deactivate</button>'
    + '<button style="flex:1;border:1px solid var(--border);border-radius:var(--radius);background:none;cursor:pointer" onclick="closeUserActionSheet()">Cancel</button></div>');
}
function confirmReactivateUser(profileId, name) {
  openUserActionSheet('Reactivate ' + name + '?',
    '<p style="font-size:13px;color:var(--text-secondary)">' + escHtml(name) + ' will be able to sign in again and reappear in dropdowns.</p>'
    + '<div id="user-action-error" style="color:var(--danger);font-size:12px;margin-top:6px"></div>'
    + '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn-dark" style="flex:1" onclick="submitSetActive(\'' + profileId + '\',true)">Reactivate</button>'
    + '<button style="flex:1;border:1px solid var(--border);border-radius:var(--radius);background:none;cursor:pointer" onclick="closeUserActionSheet()">Cancel</button></div>');
}
function submitSetActive(profileId, active) {
  sb.invoke('admin-users', { action: 'set_active', profile_id: profileId, active: active }).then(function(r) {
    if (!r.ok) { var el = document.getElementById('user-action-error'); if (el) el.textContent = (r.data && r.data.error) || 'Error'; return; }
    closeUserActionSheet();
    refreshUsersScreen();
  });
}

function openResetPasswordSheet(profileId, name) {
  openUserActionSheet('Reset password for ' + name,
    '<div class="form-group"><label class="form-label">Temporary password</label><input type="text" id="ua-temp-password" placeholder="At least 8 characters"></div>'
    + '<div id="user-action-error" style="color:var(--danger);font-size:12px;margin-top:6px"></div>'
    + '<button class="btn-dark" style="margin-top:10px;width:100%" onclick="submitResetPassword(\'' + profileId + '\')">Save</button>');
}
function submitResetPassword(profileId) {
  var pw = document.getElementById('ua-temp-password').value;
  sb.invoke('admin-users', { action: 'reset_password', profile_id: profileId, temp_password: pw }).then(function(r) {
    var el = document.getElementById('user-action-error');
    if (!r.ok) { if (el) el.textContent = (r.data && r.data.error) || 'Error'; return; }
    closeUserActionSheet();
    showToast('Password reset — temp password: ' + pw);
  });
}

function openChangeEmailSheet(profileId, currentEmail) {
  openUserActionSheet('Change email',
    '<div class="form-group"><label class="form-label">New email</label><input type="email" id="ua-new-email" value="' + escHtml(currentEmail) + '"></div>'
    + '<div id="user-action-error" style="color:var(--danger);font-size:12px;margin-top:6px"></div>'
    + '<button class="btn-dark" style="margin-top:10px;width:100%" onclick="submitChangeEmail(\'' + profileId + '\')">Save</button>');
}
function submitChangeEmail(profileId) {
  var email = document.getElementById('ua-new-email').value.trim();
  sb.invoke('admin-users', { action: 'change_email', profile_id: profileId, new_email: email }).then(function(r) {
    var el = document.getElementById('user-action-error');
    if (!r.ok) { if (el) el.textContent = (r.data && r.data.error) || 'Error'; return; }
    closeUserActionSheet();
    refreshUsersScreen();
    showToast('Email updated');
  });
}

function openAddUserSheet() {
  openUserActionSheet('Add user',
    '<div class="form-group"><label class="form-label">Full name</label><input type="text" id="ua-name"></div>'
    + '<div class="form-group"><label class="form-label">Email</label><input type="email" id="ua-email"></div>'
    + '<div class="form-group"><label class="form-label">Template</label><select id="ua-template" onchange="uaTemplateChanged()"><option value="field">Field Tech</option><option value="admin">Admin</option></select></div>'
    + '<div class="form-group"><label class="form-label">Color</label><input type="color" id="ua-color" value="#3498db"></div>'
    + '<div class="form-group"><label class="form-label">Tracker ID (optional)</label><input type="text" id="ua-tid" maxlength="4"></div>'
    + '<div class="form-group"><label class="form-label">Temp password</label><input type="text" id="ua-temp-password2" placeholder="At least 8 characters"></div>'
    + '<div class="form-group"><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="ua-make-tech" checked> Tracked field worker</label></div>'
    + '<div id="user-action-error" style="color:var(--danger);font-size:12px;margin-top:6px"></div>'
    + '<button class="btn-dark" style="margin-top:10px;width:100%" onclick="submitCreateUser()">Create</button>');
}
function uaTemplateChanged() {
  var tmpl = document.getElementById('ua-template').value;
  var cb = document.getElementById('ua-make-tech');
  if (cb) cb.checked = (tmpl === 'field');
}
function submitCreateUser() {
  var tempPw = document.getElementById('ua-temp-password2').value;
  var body = {
    action: 'create_user',
    email: document.getElementById('ua-email').value.trim(),
    display_name: document.getElementById('ua-name').value.trim(),
    template: document.getElementById('ua-template').value,
    color: document.getElementById('ua-color').value,
    tid: document.getElementById('ua-tid').value.trim(),
    temp_password: tempPw,
    make_technician: document.getElementById('ua-make-tech').checked,
  };
  sb.invoke('admin-users', body).then(function(r) {
    var el = document.getElementById('user-action-error');
    if (!r.ok) { if (el) el.textContent = (r.data && r.data.error) || 'Error'; return; }
    closeUserActionSheet();
    refreshUsersScreen();
    showToast('User created — temp password: ' + tempPw);
  });
}
