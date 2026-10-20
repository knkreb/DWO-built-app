// app-wo-status-field.js — Status field on the work order form, same behaviour for New and Edit (v5.02)
// New WO: the field already picked the starting status (draft/active statuses, filled by openNewWO in app-core.js).
// Edit WO: the field now shows the work order's LIVE status and a change is applied through the same code as the
// Status sheet (setWOStatus), so transition rules, the PO lock on cancelling, completion checks and completed_at all
// behave exactly as before. Statuses are read from the statuses table (AppState.statuses), never by number or name.

// Fills the Status dropdown for the work order being edited and selects its current status.
function woStatusFieldFill(wo) {
  var sel = document.getElementById('f-status'); if (!sel || !wo) return;
  var isAdmin = AppState.userRole === 'admin';
  var allowed = (typeof allowedTransitions === 'function') ? allowedTransitions(statusCat(wo.status), isAdmin) : null;
  var list = (AppState.statuses && AppState.statuses.length) ? AppState.statuses : [];
  var opts = list.filter(function(s) {
    if (s.active === false && s.num !== wo.status) return false;
    return s.num === wo.status || !allowed || allowed.indexOf(s.category) >= 0;   // only moves setWOStatus will accept
  });
  var html = opts.map(function(s) {
    return '<option value="' + s.num + '"' + (s.num === wo.status ? ' selected' : '') + '>' + String(s.num).padStart(2, '0') + ' ' + escHtml(s.name) + '</option>';
  }).join('');
  if (!opts.some(function(s){ return s.num === wo.status; })) {   // current status was retired: still show it
    var cur = getStatus(wo.status);
    html = '<option value="' + wo.status + '" selected>' + String(wo.status).padStart(2, '0') + ' ' + escHtml(cur && cur.name || '') + '</option>' + html;
  }
  sel.innerHTML = html;
  sel.value = String(wo.status);
}

// The status number chosen in the form (null if the dropdown is empty)
function woStatusFieldSelected() {
  var s = document.getElementById('f-status'); var n = s ? parseInt(s.value, 10) : NaN;
  return isNaN(n) ? null : n;
}

// Checks that can be answered before saving anything. Returns a message, or '' when the change may go ahead.
// (The "no hours or parts" completion check is asynchronous and stays inside setWOStatus.)
function woStatusFieldCheck(wo, num) {
  if (!wo || num == null || num === wo.status) return '';
  var isAdmin = AppState.userRole === 'admin', fromCat = statusCat(wo.status), toCat = statusCat(num);
  if (toCat === 'cancelled' && typeof poBlocksWOChange === 'function' && poBlocksWOChange(wo.id)) return 'Locked to a PO — untie the PO before cancelling';
  if (typeof allowedTransitions === 'function' && allowedTransitions(fromCat, isAdmin).indexOf(toCat) < 0) return 'Transition not allowed: ' + fromCat + ' → ' + toCat;
  return '';
}
