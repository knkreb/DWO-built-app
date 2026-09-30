// app-sites-travel.js — Site travel allowance (v4.93)
// Spec: docs/specs/site-visits-and-claims.md (step 1)
// Travel allowance lives on the site (locations.travel_to_minutes / travel_from_minutes).
// Default 30 minutes each way for customer sites; 0 for everything else. Editable per site.
// Hooks into the Sites manager in app-core.js: locRenderDetail, locRenderEditPanel,
// locEditTypeChange, locSaveEdit.

var LOC_TRAVEL_MAX = 480;
var LOC_TRAVEL_DEFAULT_CUSTOMER = 30;

function locTravelClamp(val) {
  var n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return null;
  return n > LOC_TRAVEL_MAX ? LOC_TRAVEL_MAX : n;
}

function locTravelInputStyle() {
  return 'width:55px;font-size:12px;padding:2px 5px;border:1px solid var(--border);border-radius:3px;background:var(--bg)';
}

// Read-only-detail row with inline editing, same pattern as the Geofence row
function locTravelRowHtml(loc) {
  var to = loc.travel_to_minutes || 0;
  var from = loc.travel_from_minutes || 0;
  var lid = escHtml(loc.id);
  var html = '<tr><td style="padding:3px 0;color:var(--text-secondary);width:110px">Travel allowance</td>';
  html += '<td style="padding:3px 0">';
  html += '<input type="number" id="loc-travel-to" value="' + to + '" min="0" max="' + LOC_TRAVEL_MAX + '" step="5" style="' + locTravelInputStyle() + '" ';
  html += 'onchange="locSaveTravel(\'' + lid + '\',\'travel_to_minutes\',this.value)"> to &nbsp;';
  html += '<input type="number" id="loc-travel-from" value="' + from + '" min="0" max="' + LOC_TRAVEL_MAX + '" step="5" style="' + locTravelInputStyle() + '" ';
  html += 'onchange="locSaveTravel(\'' + lid + '\',\'travel_from_minutes\',this.value)"> from min ';
  html += '<span id="loc-travel-total" style="font-size:10px;color:var(--text-muted)">= ' + (to + from) + ' min total</span>';
  html += '</td></tr>';
  return html;
}

function locSaveTravel(id, field, val) {
  if (field !== 'travel_to_minutes' && field !== 'travel_from_minutes') return;
  var loc = LocState.locations.find(function(l) { return l.id === id; });
  var n = locTravelClamp(val);
  if (n === null) {
    showToast('Enter whole minutes, 0 to ' + LOC_TRAVEL_MAX);
    if (loc) locRenderDetail(loc);
    return;
  }
  var patch = { modified_by: AppState.userEmail, modified_at: new Date().toISOString() };
  patch[field] = n;
  sb.patch('locations', id, patch).then(function(r) {
    if (r.ok) {
      if (loc) loc[field] = n;
      var inputId = field === 'travel_to_minutes' ? 'loc-travel-to' : 'loc-travel-from';
      var inp = document.getElementById(inputId);
      if (inp) inp.value = n;
      var tot = document.getElementById('loc-travel-total');
      if (tot && loc) tot.textContent = '= ' + ((loc.travel_to_minutes || 0) + (loc.travel_from_minutes || 0)) + ' min total';
      showToast('Travel allowance saved');
    } else {
      showToast('Error saving travel allowance');
      if (loc) locRenderDetail(loc);
    }
  });
}

// Add/Edit panel fields. New customer-type sites pre-fill 30/30.
function locTravelEditFieldsHtml(loc, isEdit) {
  var to = isEdit ? (loc.travel_to_minutes || 0) : LOC_TRAVEL_DEFAULT_CUSTOMER;
  var from = isEdit ? (loc.travel_from_minutes || 0) : LOC_TRAVEL_DEFAULT_CUSTOMER;
  var origType = isEdit ? (loc.location_type || '') : '';
  var html = '<div id="loc-edit-travel-row" data-orig-type="' + escHtml(origType) + '" data-orig-to="' + to + '" data-orig-from="' + from + '" ';
  html += 'style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--text-secondary);width:80px;flex-shrink:0">Travel</label>';
  html += '<input type="number" id="loc-edit-travel-to" value="' + to + '" min="0" max="' + LOC_TRAVEL_MAX + '" step="5" oninput="this.dataset.touched=\'1\'" style="' + locTravelInputStyle() + '"> to ';
  html += '<input type="number" id="loc-edit-travel-from" value="' + from + '" min="0" max="' + LOC_TRAVEL_MAX + '" step="5" oninput="this.dataset.touched=\'1\'" style="' + locTravelInputStyle() + '"> from min ';
  html += '<span style="font-size:10px;color:var(--text-muted)">(allowance billed per customer visit)</span>';
  html += '</div>';
  return html;
}

// Type dropdown changed in the Add/Edit panel: re-default the allowance unless the user typed one.
function locTravelTypeChange() {
  var type = document.getElementById('loc-edit-type');
  var row = document.getElementById('loc-edit-travel-row');
  var toEl = document.getElementById('loc-edit-travel-to');
  var fromEl = document.getElementById('loc-edit-travel-from');
  if (!type || !row || !toEl || !fromEl) return;
  if (toEl.dataset.touched === '1' || fromEl.dataset.touched === '1') return;
  if (row.dataset.origType && type.value === row.dataset.origType) {
    toEl.value = row.dataset.origTo;
    fromEl.value = row.dataset.origFrom;
    return;
  }
  var def = type.value === 'customer' ? LOC_TRAVEL_DEFAULT_CUSTOMER : 0;
  toEl.value = def;
  fromEl.value = def;
}

// Values to merge into the locSaveEdit payload. Empty object if the panel has no travel fields.
function locTravelPayload() {
  var toEl = document.getElementById('loc-edit-travel-to');
  var fromEl = document.getElementById('loc-edit-travel-from');
  if (!toEl || !fromEl) return {};
  var to = locTravelClamp(toEl.value);
  var from = locTravelClamp(fromEl.value);
  return {
    travel_to_minutes: to === null ? 0 : to,
    travel_from_minutes: from === null ? 0 : from
  };
}
