// =============================================================
// app-ftl-mobile.js — v5.19 — Mobile Field Travel Log: account picker, nearby sites, allocation list and edit-in-place.
// Spec: docs/specs/ftl-allocation-and-account-fixes.md (Slice B: M1 to M6). Loaded after field-travel-log.js.
//
// ORIGIN NOTES (CLAUDE.md: never hard-delete code during a refactor). These were moved here from field-travel-log.js in
// v5.19 and the old copies are commented out there with a matching "MOVED TO app-ftl-mobile.js" note:
//   mdrRebuildAllocationsFromEntries, mdrBuildAllocateSheet, mdrAddAllocRow, mdrUpdateAllocSummary, mdrSaveAllocations,
//   and the expanded-tile body of mdrRenderDay (now mdrRenderStopBody).
// The shared nearby-sites helper (ftlNearbySites / ftlNearbySearch) is used by desktop (drNearbySites, drNearbySearch) and mobile.
// =============================================================

// ── Shared helpers (desktop and mobile) ───────────────────────
function ftlLocDistLabel(d) {
  return Math.round(d) + ' m / ' + Math.round(d * 3.28084) + ' ft';
}

function ftlLocCustName(loc) {
  var c = loc.customer_id ? (AppState.customers || []).find(function(x){ return x.id === loc.customer_id; }) : null;
  var n = c ? (c.display_name || c.name || '') : '';
  return (n && n !== loc.name) ? n : '';
}

// Every other active site with coordinates, nearest first. No radius limit, nothing blocked (spec decision 9).
// limit 0 / undefined returns them all.
function ftlNearbySites(locations, stop, excludeIds, limit) {
  var out = [];
  (locations || []).forEach(function(l) {
    if (!l.lat || !l.lng || l.active === false || (excludeIds || []).indexOf(l.id) >= 0) return;
    out.push({ loc: l, dist: drHaversineMeters(stop.lat, stop.lng, l.lat, l.lng) });
  });
  out.sort(function(a, b) { return a.dist - b.dist; });
  return limit ? out.slice(0, limit) : out;
}

// Search any active site by name or customer, nearest first.
function ftlNearbySearch(locations, stop, excludeIds, query) {
  var q = (query || '').toLowerCase().trim();
  if (!q) return [];
  return ftlNearbySites(locations, stop, excludeIds, 0).filter(function(r) {
    return (((r.loc.name || '') + ' ' + ftlLocCustName(r.loc)).toLowerCase().indexOf(q) >= 0);
  });
}

function ftlParseJson(v, dflt) {
  if (!v) return dflt;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return dflt; }
}

// =============================================================
// M6 — rebuild allocations from hours entries (entryId on every allocation; time attaches by chosen site first)
// ORIGIN: moved from field-travel-log.js (mdrRebuildAllocationsFromEntries), v5.19
// =============================================================
function mdrRebuildAllocationsFromEntries() {
  var ASSOC_RADIUS = parseInt(AppState.settings.geofence_radius_default || '100') * 3;
  MDRState.stops.forEach(function(stop){ stop.allocations = []; });
  MDRState.hoursEntries.forEach(function(entry) {
    if (entry.active === false) return;
    if (!entry.location_id) return;
    var entryLoc = MDRState.locations.find(function(l){ return l.id === entry.location_id; });
    if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
    var bestStop = null;
    var bestDist = Infinity;
    // A stop whose chosen site IS this entry's site claims it, at any distance (nearest such stop if several).
    MDRState.stops.forEach(function(s) {
      var ids = (s.confirmedAccounts || []).map(function(l){ return l.id; });
      if (s.location) ids.push(s.location.id);
      if (ids.indexOf(entry.location_id) < 0) return;
      var d = drHaversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
      if (d < bestDist) { bestDist = d; bestStop = s; }
    });
    var bySite = !!bestStop;
    if (!bySite) {
      MDRState.stops.forEach(function(s) {
        var dist = drHaversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
        if (dist < bestDist) { bestDist = dist; bestStop = s; }
      });
    }
    if (bestStop && (bySite || bestDist <= ASSOC_RADIUS)) {
      var wo = AppState.workOrders.find(function(w){ return w.id === entry.work_order_id; });
      var cust = wo ? AppState.customers.find(function(c){ return c.id === wo.customer_id; }) : null;
      var ht = AppState.hoursTypes.find(function(t){ return t.id === entry.hours_type_id; });
      bestStop.allocations.push({
        custId: cust ? cust.id : '',
        customerName: cust ? getCustName(cust) : '',
        woId: entry.work_order_id,
        woNumber: wo ? wo.wo_number : '',
        formMode: wo ? (wo.form_mode || 'time_materials') : 'time_materials',
        hours: parseFloat(entry.hours||0),
        htId: entry.hours_type_id,
        rateName: ht ? ht.name : '',
        isPaid: entry.paid !== false,
        isBillable: entry.billable !== false,
        entryId: entry.id
      });
    }
  });
}

// =============================================================
// M1 — restore saved site choices (day_review.stop_locations) onto freshly detected stops
// Same rules as desktop drProcessAndRender: a saved choice among the geofence matches resolves a multi-account stop;
// a saved site that is NOT a geofence match (picked from the nearby list) is resolved against all active sites.
// Stops already resolved by geofence are left as they are. Mobile also applies the paid/billable defaults here,
// because the engine marks multi-account and unmatched stops unpaid and non-billable.
// =============================================================
function mdrRestoreStopChoices() {
  var dr = MDRState.currentDayReview;
  var stopLocs = dr ? ftlParseJson(dr.stop_locations, {}) : {};
  if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) return;
  var flags = dr ? ftlParseJson(dr.stop_flags, {}) : {};
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) flags = {};
  MDRState.stops.forEach(function(stop) {
    var savedVal = stopLocs[stop.arrivedAt];
    if (!savedVal) return;
    var ids = Array.isArray(savedVal) ? savedVal : [savedVal];
    var multi = stop.locationMatches && stop.locationMatches.length > 1;
    var found = [];
    if (multi && !stop.location) {
      found = ids.map(function(id){ return stop.locationMatches.find(function(l){ return l.id === id; }); }).filter(Boolean);
    }
    if (!found.length) {
      if (stop.location || stop.confirmedAccounts) return;
      found = ids.map(function(id){ return (MDRState.locations || []).find(function(l){ return l.id === id && l.active !== false; }); }).filter(Boolean);
    }
    if (!found.length) return;
    if (multi) { stop.confirmedAccounts = found; stop.location = found[0]; }
    else { stop.location = found[0]; stop._nearbyAssigned = true; }
    var f = flags[stop.arrivedAt] || {};
    var lt = found[0].location_type;
    stop.isPaid = f.paid !== undefined ? f.paid !== false : !(lt === 'personal' || lt === 'office');
    stop.isBillable = f.billable !== undefined ? f.billable !== false : found[0].billable_default !== false;
  });
}

// Saves (or clears, value === null) the site chosen for a stop in day_review.stop_locations — the field the desktop picker uses.
// The local day review is updated first so the re-render that follows restores the choice.
function mdrSaveStopChoice(stop, value, msg) {
  var dr = MDRState.currentDayReview;
  if (!dr || !dr.id) { if (msg) showToast(msg + ' — no day record yet, so this will not be kept after a reload'); return; }
  var stopLocs = ftlParseJson(dr.stop_locations, {});
  if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) stopLocs = {};
  if (value === null) delete stopLocs[stop.arrivedAt]; else stopLocs[stop.arrivedAt] = value;
  dr.stop_locations = stopLocs;
  sb.patch('day_review', dr.id, {
    stop_locations: stopLocs,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r && r.ok === false) showToast('Error saving site — this choice will not be kept after a reload');
    else if (msg) showToast(msg);
  });
}

function mdrConfirmAccounts(idx) {
  var stop = MDRState.stops[idx];
  if (!stop || !stop.locationMatches) return;
  var ids = [];
  document.querySelectorAll('[data-mdr-acct="' + idx + '"]').forEach(function(cb) {
    if (cb.checked) ids.push(cb.getAttribute('data-locid'));
  });
  if (!ids.length) { showToast('Please select at least one account'); return; }
  MDRState.nearbyIdx = null;
  mdrSaveStopChoice(stop, ids.length === 1 ? ids[0] : ids, 'Account' + (ids.length > 1 ? 's' : '') + ' confirmed');
  mdrRenderDay(null);
}

// Change: clears the confirmed accounts / nearby choice and puts the stop back to unresolved.
function mdrClearStopChoice(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  MDRState.nearbyIdx = null;
  mdrSaveStopChoice(stop, null, '');
  mdrRenderDay(null);
}

// =============================================================
// M2 — Nearby sites step ("None of these" and "Identify this stop")
// =============================================================
function mdrStartNearby(idx) {
  MDRState.nearbyIdx = idx;
  mdrRenderDay(null);
}

function mdrCloseNearby() {
  MDRState.nearbyIdx = null;
  mdrRenderDay(null);
}

function mdrNearbyRowHtml(loc, dist, idx) {
  var cn = ftlLocCustName(loc);
  return '<div onclick="event.stopPropagation();mdrAssignNearby(' + idx + ',\'' + escHtml(loc.id) + '\')" style="display:flex;align-items:center;gap:8px;padding:10px 10px;min-height:44px;margin-bottom:4px;border:1px solid #c4bef0;border-radius:8px;cursor:pointer;background:var(--surface)">'
    + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#534ab7">' + escHtml(loc.name || '(unnamed)') + '</div>'
    + (cn ? '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(cn) + '</div>' : '')
    + '</div><div style="font-size:11px;color:var(--text-muted);white-space:nowrap">' + ftlLocDistLabel(dist) + '</div></div>';
}

function mdrRenderNearbyForm(idx, stop) {
  var exclude = (stop.locationMatches || []).map(function(l){ return l.id; });
  var near = ftlNearbySites(MDRState.locations, stop, exclude, 12);
  var multi = stop.locationMatches && stop.locationMatches.length > 1;
  var html = '<div id="mdr-nearby-form" style="background:#f1efff;border:1px solid #a89fe8;border-radius:10px;padding:10px 12px;margin-bottom:8px">';
  html += '<div style="font-size:12px;font-weight:600;color:#534ab7;margin-bottom:8px">Is it one of these nearby sites?</div>';
  if (near.length) {
    near.forEach(function(n) { html += mdrNearbyRowHtml(n.loc, n.dist, idx); });
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">No other sites near this stop.</div>';
  }
  html += '<input type="text" id="mdr-nearby-search" placeholder="Search all sites by name or customer..." oninput="mdrNearbySearch(' + idx + ',this.value)" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);box-sizing:border-box;margin:4px 0 6px">';
  html += '<div id="mdr-nearby-results"></div>';
  html += '<div style="display:flex;gap:6px;margin-top:8px">';
  html += '<button onclick="event.stopPropagation();mdrStartTag(' + idx + ')" style="flex:1;padding:10px;background:#534ab7;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Create a new site</button>';
  html += '<button onclick="event.stopPropagation();mdrCloseNearby()" style="padding:10px 14px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">' + (multi ? 'Back to accounts' : 'Back') + '</button>';
  html += '</div></div>';
  return html;
}

function mdrNearbySearch(idx, val) {
  var el = document.getElementById('mdr-nearby-results');
  var stop = MDRState.stops[idx];
  if (!el || !stop) return;
  if (!(val || '').trim()) { el.innerHTML = ''; return; }
  var exclude = (stop.locationMatches || []).map(function(l){ return l.id; });
  var rows = ftlNearbySearch(MDRState.locations, stop, exclude, val);
  if (!rows.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:2px 0">No sites match.</div>'; return; }
  el.innerHTML = rows.slice(0, 8).map(function(r) { return mdrNearbyRowHtml(r.loc, r.dist, idx); }).join('');
}

// Assigns an existing site to the stop. No site row is created and nothing about the site changes.
function mdrAssignNearby(idx, locId) {
  var stop = MDRState.stops[idx];
  var loc = (MDRState.locations || []).find(function(l){ return l.id === locId; });
  if (!stop || !loc) return;
  MDRState.nearbyIdx = null;
  mdrSaveStopChoice(stop, loc.id, loc.name + ' selected');
  mdrRenderDay(null);
}

// =============================================================
// Tile pieces used by mdrRenderDay
// =============================================================
function mdrIsMultiUnresolved(stop) {
  return !stop.location && !!(stop.locationMatches && stop.locationMatches.length > 1);
}

function mdrStopDisplayName(stop) {
  if (stop.confirmedAccounts && stop.confirmedAccounts.length > 1) return stop.confirmedAccounts.map(function(a){ return a.name; }).join(' + ');
  if (stop.location) return stop.location.name;
  return mdrIsMultiUnresolved(stop) ? 'Multiple accounts at this location' : 'Unknown stop';
}

function mdrRenderAccountPicker(origIdx, stop) {
  var html = '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:10px;padding:10px 12px;margin-bottom:8px">';
  html += '<div style="font-size:12px;font-weight:600;color:#534ab7;margin-bottom:10px">Which accounts did you work at this location?</div>';
  stop.locationMatches.forEach(function(loc) {
    var custObj = AppState.customers && AppState.customers.find(function(c){ return c.id === loc.customer_id; });
    var custName = loc.name || (custObj ? (custObj.display_name || custObj.name || '') : '');
    html += '<label style="display:flex;align-items:center;gap:10px;padding:10px 8px;min-height:44px;margin-bottom:4px;border:1px solid #c4bef0;border-radius:8px;cursor:pointer;background:var(--surface)">';
    html += '<input type="checkbox" checked data-mdr-acct="' + origIdx + '" data-locid="' + escHtml(loc.id) + '" style="width:20px;height:20px;flex-shrink:0">';
    html += '<span style="font-size:13px;font-weight:600;color:#534ab7">' + escHtml(custName) + '</span></label>';
  });
  html += '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">';
  html += '<button onclick="event.stopPropagation();mdrConfirmAccounts(' + origIdx + ')" style="flex:1;min-width:90px;padding:10px;background:#534ab7;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Confirm</button>';
  html += '<button onclick="event.stopPropagation();mdrStartNearby(' + origIdx + ')" style="padding:10px 12px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">None of these</button>';
  html += '<button onclick="event.stopPropagation();mdrMarkNotBillable(' + origIdx + ')" style="padding:10px 12px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">Mark not billable</button>';
  html += '</div></div>';
  return html;
}

// The expanded body of a selected stop tile.
// ORIGIN: replaces the inline block that was in mdrRenderDay (moved here in v5.19).
// idx is the index in the filtered work-stops list; origIdx is the index in MDRState.stops. Paid/Billable toggles keep
// receiving idx exactly as before (see CHANGELOG: found while building).
function mdrRenderStopBody(stop, origIdx, idx, locType, isUntagged) {
  var html = '<div onclick="event.stopPropagation()" style="padding:10px 12px;background:var(--bg);border-top:1px solid var(--border)">';
  if (isUntagged) {
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">' + stop.lat.toFixed(5) + '&deg; N, ' + Math.abs(stop.lng).toFixed(5) + '&deg; W</div>';
    html += '<a href="https://maps.google.com/?q=' + stop.lat + ',' + stop.lng + '" target="_blank" style="font-size:11px;color:var(--text-accent);display:block;margin-bottom:8px">Open in Google Maps</a>';
    if (MDRState.nearbyIdx === origIdx) {
      html += mdrRenderNearbyForm(origIdx, stop);
    } else if (mdrIsMultiUnresolved(stop)) {
      html += mdrRenderAccountPicker(origIdx, stop);
    } else {
      html += '<div style="display:flex;gap:6px;margin-top:4px">';
      html += '<button onclick="event.stopPropagation();mdrStartNearby(' + origIdx + ')" style="flex:1;padding:8px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer">Identify this stop</button>';
      html += '<button onclick="event.stopPropagation();mdrMarkNotBillable(' + origIdx + ')" style="padding:8px 14px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">Mark not billable</button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  var addr = [stop.location.address_street, stop.location.city, stop.location.state].filter(Boolean).join(', ');
  if (addr) html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">' + escHtml(addr) + '</div>';

  // Chosen site banners, each with a Change button
  if (stop.confirmedAccounts && stop.confirmedAccounts.length) {
    html += '<div style="background:#eaf3de;border:1px solid #7eb85a;border-radius:8px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:12px;color:#3b6d11;font-weight:600">&#10003; ' + stop.confirmedAccounts.map(function(a){ return escHtml(a.name); }).join(' &amp; ') + '</span>';
    html += '<button onclick="event.stopPropagation();mdrClearStopChoice(' + origIdx + ')" style="margin-left:auto;font-size:12px;padding:6px 10px;background:none;border:1px solid #7eb85a;border-radius:6px;color:#3b6d11;cursor:pointer">Change</button>';
    html += '</div>';
  } else if (stop._nearbyAssigned) {
    html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:8px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:12px;color:#534ab7;font-weight:600">&#10003; ' + escHtml(stop.location.name) + '</span>';
    html += '<button onclick="event.stopPropagation();mdrClearStopChoice(' + origIdx + ')" style="margin-left:auto;font-size:12px;padding:6px 10px;background:none;border:1px solid #a89fe8;border-radius:6px;color:#534ab7;cursor:pointer">Change</button>';
    html += '</div>';
  }

  // Pay/Bill toggles
  var isPaid = stop.isPaid !== false;
  var isBillable = stop.isBillable !== false && locType === 'customer';
  html += '<div style="display:flex;gap:8px;margin-bottom:10px">';
  html += '<div onclick="event.stopPropagation();mdrTogglePaid(' + idx + ')" style="flex:1;padding:12px 8px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;border:1.5px solid var(--border);cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:center;background:' + (isPaid?'#eaf3de;color:#3b6d11':'var(--surface);color:var(--text-muted)') + '">' + (isPaid?'&#10003; Paid':'Unpaid') + '</div>';
  if (locType === 'customer') {
    html += '<div onclick="event.stopPropagation();mdrToggleBillable(' + idx + ')" style="flex:1;padding:12px 8px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;border:1.5px solid var(--border);cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:center;background:' + (isBillable?'#e6f1fb;color:#185fa5':'var(--surface);color:var(--text-muted)') + '">' + (isBillable?'&#10003; Billable':'Non-billable') + '</div>';
  }
  html += '</div>';

  // M3 — allocation list; tapping a work order number offers Open work order or Edit this allocation
  var allocs = stop.allocations || [];
  if (allocs.length) {
    var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);
    var totalAlloc = allocs.reduce(function(s, a){ return s + parseFloat(a.hours || 0); }, 0);
    var gpsH = drElapsedMin(stop) / 60;
    var hasTM = allocs.some(function(a){ return a.formMode !== 'quoted'; });
    var hasQuoted = allocs.some(function(a){ return a.formMode === 'quoted'; });
    if (hasTM && hasQuoted) {
      html += '<div style="font-size:11px;padding:6px 8px;background:#faeeda;color:#854f0b;border-radius:6px;margin-bottom:6px;border:1px solid #ef9f27">&#9888; Both T&amp;M and quoted work orders here — make sure T&amp;M time is billed correctly.</div>';
    }
    html += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">Allocations</div>';
    allocs.forEach(function(a, ai) {
      var effH = parseFloat(a.hours || 0);
      var belowMin = effH > 0 && effH < minBilling;
      var badge = a.formMode === 'quoted'
        ? '<span style="font-size:9px;padding:1px 5px;background:#eaf3de;color:#3b6d11;border-radius:99px;margin-left:4px;font-weight:600">Quoted</span>'
        : '<span style="font-size:9px;padding:1px 5px;background:#e6f1fb;color:#185fa5;border-radius:99px;margin-left:4px;font-weight:600">T&amp;M</span>';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">';
      html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(a.customerName || '—') + '</div>';
      html += '<div><span onclick="event.stopPropagation();mdrAllocWoMenu(' + origIdx + ',' + ai + ',event)" style="display:inline-block;padding:6px 0;font-size:12px;cursor:pointer;color:var(--text-accent);text-decoration:underline;font-weight:600">' + escHtml(a.woNumber || '(no WO)') + '</span>' + badge + '</div></div>';
      html += '<div style="font-size:13px;font-weight:600;white-space:nowrap">' + effH.toFixed(2) + 'h' + (belowMin ? ' <span style="color:#854f0b;font-size:10px">(min ' + minBilling + 'h)</span>' : '') + '</div>';
      html += '</div>';
    });
    var diff = totalAlloc - gpsH;
    if (Math.abs(diff) > 0.08) {
      html += '<div style="font-size:11px;margin:6px 0 2px">' + (diff < 0 ? '<span style="color:#a32d2d">&#9888; ' + Math.abs(diff).toFixed(2) + 'h under GPS time</span>' : '<span style="color:#854f0b">&#9888; ' + diff.toFixed(2) + 'h over GPS time</span>') + '</div>';
    }
    html += '<div style="height:8px"></div>';
  }

  html += '<button onclick="event.stopPropagation();mdrStartAllocate(' + origIdx + ')" style="width:100%;padding:8px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer">' + (allocs.length ? 'Edit allocation' : 'Allocate time') + '</button>';
  html += '</div>';
  return html;
}

// ── M3 — work order menu on an allocation row ─────────────────
function mdrCloseAllocWoMenu() {
  var m = document.getElementById('mdr-alloc-wo-menu');
  if (m) m.remove();
}

function mdrAllocWoMenu(stopIdx, ai, ev) {
  mdrCloseAllocWoMenu();
  var stop = MDRState.stops[stopIdx];
  if (!stop || !stop.allocations || !stop.allocations[ai]) return;
  var m = document.createElement('div');
  m.id = 'mdr-alloc-wo-menu';
  var x = Math.max(8, Math.min((ev && ev.clientX) || 40, window.innerWidth - 228));
  var y = Math.max(8, Math.min(((ev && ev.clientY) || 100) + 8, window.innerHeight - 120));
  m.style.cssText = 'position:fixed;z-index:300;left:' + x + 'px;top:' + y + 'px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,0.25);padding:4px;min-width:210px';
  var btn = 'display:block;width:100%;text-align:left;font-size:14px;padding:12px 14px;min-height:44px;background:none;border:none;border-radius:8px;cursor:pointer;color:var(--text-primary)';
  m.innerHTML = '<button id="mdr-awm-edit" style="' + btn + '">Edit this allocation</button><button id="mdr-awm-open" style="' + btn + '">Open work order &#x2197;</button>';
  document.body.appendChild(m);
  document.getElementById('mdr-awm-edit').onclick = function(e) { e.stopPropagation(); mdrCloseAllocWoMenu(); mdrEditAllocation(stopIdx, ai); };
  document.getElementById('mdr-awm-open').onclick = function(e) { e.stopPropagation(); mdrCloseAllocWoMenu(); var a = stop.allocations[ai]; if (a) openWODetail(a.woId); };
  setTimeout(function() { document.addEventListener('click', mdrCloseAllocWoMenu, { once: true }); }, 0);
}

function mdrEditAllocation(stopIdx, ai) {
  MDRState.allocFocus = ai;
  mdrStartAllocate(stopIdx);
}

// =============================================================
// M4 — allocation sheet: preloaded with the stop's existing allocations, each carrying its entryId
// ORIGIN: replaces mdrBuildAllocateSheet / mdrAddAllocRow / mdrUpdateAllocSummary from field-travel-log.js (v5.19)
// =============================================================
function mdrWoIsProcessed(woId) {
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  // From Batch Invoice Process on (Processed category) the time has gone to invoicing: no moves (spec decision 5).
  return !!(wo && statusCat(wo.status) === 'processed');
}

function mdrLockedWoMsg() {
  showToast('This work order has gone to invoicing; adjust it from the work order');
}

function mdrStopCustomerIds(stop) {
  var ids = [];
  var locs = (stop.confirmedAccounts && stop.confirmedAccounts.length) ? stop.confirmedAccounts : (stop.location ? [stop.location] : []);
  locs.forEach(function(l){ if (l && l.customer_id && ids.indexOf(l.customer_id) < 0) ids.push(l.customer_id); });
  return ids;
}

// Work order options: live work orders, the site's customer(s) first (all customers when asked or when there is no customer),
// the row's current work order always present and marked.
function mdrAllocWoOptions(stop, selectedWoId, origWoId) {
  var custIds = mdrStopCustomerIds(stop);
  var allLive = AppState.workOrders.filter(function(w){
    if (w.active === false) return false;
    if (isProcessedStatus && isProcessedStatus(w.status)) return false;
    return true;
  });
  var filtered = (!MDRState.allocAllCust && custIds.length)
    ? allLive.filter(function(w){ return custIds.indexOf(w.customer_id) >= 0; })
    : allLive;
  var woList = filtered.length ? filtered : allLive;
  var seen = {};
  var arr = [];
  [selectedWoId, origWoId].forEach(function(id) {
    if (!id || seen[id]) return;
    var w = AppState.workOrders.find(function(x){ return x.id === id; });
    if (w) { arr.push(w); seen[id] = true; }
  });
  woList.slice(0, 100).forEach(function(w){ if (!seen[w.id]) { arr.push(w); seen[w.id] = true; } });
  return '<option value="">-- Select WO --</option>' + arr.map(function(w) {
    var isQuoted = w.form_mode === 'quoted';
    var label = escHtml(w.wo_number) + ' — ' + escHtml(w.title || '(no title)') + (isQuoted ? ' [QUOTED]' : '') + (origWoId && w.id === origWoId ? ' (current)' : '');
    return '<option value="' + w.id + '"' + (w.id === selectedWoId ? ' selected' : '') + (isQuoted ? ' style="color:#b45309;font-weight:600"' : '') + '>' + label + '</option>';
  }).join('');
}

function mdrToggleAllCust(checked) {
  MDRState.allocAllCust = !!checked;
  var stop = MDRState.stops[MDRState.tagStopIdx];
  if (!stop) return;
  document.querySelectorAll('#mdr-alloc-rows > [data-alloc-row] select.mdr-ar-wo').forEach(function(sel) {
    var row = sel.closest('[data-alloc-row]');
    sel.innerHTML = mdrAllocWoOptions(stop, sel.value, row ? row.getAttribute('data-orig-wo') : '');
  });
}

function mdrBuildAllocateSheet(div, stop) {
  var gpsH = drElapsedMin(stop) / 60;
  var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);
  var belowMin = gpsH > 0 && gpsH < minBilling;
  MDRState.allocRemoved = [];
  MDRState.allocAllCust = false;
  MDRState._allocSaving = false;
  var existing = stop.allocations || [];
  var html = '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  html += '<div style="font-size:14px;font-weight:600">' + (existing.length ? 'Edit allocation' : 'Allocate time') + '</div>';
  html += '<button onclick="mdrCloseTagSheet()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">&times;</button>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border)">';
  html += '<div style="font-size:13px;font-weight:600">' + escHtml(mdrStopDisplayName(stop)) + '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted)">Elapsed: ' + drFormatDuration(drElapsedMin(stop)) + (belowMin ? ' <span style="color:#854f0b">&#9888; under ' + minBilling + 'h minimum — review before export</span>' : '') + '</div>';
  html += '</div>';
  html += '<div style="padding:12px 16px;flex:1;overflow-y:auto">';
  if (mdrStopCustomerIds(stop).length) {
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);margin-bottom:8px;cursor:pointer"><input type="checkbox" onchange="mdrToggleAllCust(this.checked)" style="width:18px;height:18px"> Show work orders for all customers</label>';
  }
  html += '<div id="mdr-alloc-rows"></div>';
  html += '<button onclick="mdrAddAllocRow()" style="width:100%;padding:10px;border:1px dashed var(--border);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;margin-top:4px">+ Assign time to WO</button>';
  html += '<div id="mdr-alloc-summary" style="margin-top:8px;font-size:12px;color:var(--text-muted)"></div>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-top:1px solid var(--border)">';
  html += '<button id="mdr-alloc-save" onclick="mdrSaveAllocations(' + MDRState.tagStopIdx + ')" style="width:100%;padding:12px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Save &amp; Close</button>';
  html += '</div>';
  div.innerHTML = html;
  // The sheet is not attached to the page yet, so rows are added into its own container.
  var container = div.querySelector('#mdr-alloc-rows');
  if (existing.length) {
    existing.forEach(function(a) {
      mdrAddAllocRow({ entryId: a.entryId || '', woId: a.woId, hours: a.hours, htId: a.htId || '' }, container);
    });
  } else {
    mdrAddAllocRow(null, container);
  }
  var focus = MDRState.allocFocus;
  MDRState.allocFocus = null;
  setTimeout(function() {
    mdrUpdateAllocSummary(MDRState.tagStopIdx);
    if (focus !== null && focus !== undefined) {
      var rows = document.querySelectorAll('#mdr-alloc-rows > [data-alloc-row]');
      var el = rows[focus];
      if (el) {
        el.style.background = '#fff8e1';
        el.style.outline = '2px solid #ef9f27';
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      }
    }
  }, 0);
}

// prefill: { entryId, woId, hours, htId } for an existing allocation; omitted for a new blank row.
function mdrAddAllocRow(prefill, container) {
  container = container || document.getElementById('mdr-alloc-rows');
  if (!container) return null;
  var stop = MDRState.stops[MDRState.tagStopIdx];
  if (!stop) return null;
  prefill = prefill || {};
  var isExisting = !!prefill.entryId;
  var locked = isExisting && mdrWoIsProcessed(prefill.woId);
  var htOptions = (isExisting && !prefill.htId ? '<option value="">—</option>' : '') + AppState.hoursTypes.map(function(t){
    return '<option value="' + t.id + '"' + (prefill.htId && t.id === prefill.htId ? ' selected' : '') + '>' + escHtml(t.name) + '</option>';
  }).join('');
  var div = document.createElement('div');
  div.setAttribute('data-alloc-row', '1');
  div.setAttribute('data-entry-id', prefill.entryId || '');
  div.setAttribute('data-orig-wo', prefill.woId || '');
  div.setAttribute('data-orig-hours', isExisting ? String(prefill.hours) : '');
  div.setAttribute('data-orig-ht', prefill.htId || '');
  div.style.cssText = 'padding:8px 6px;border-bottom:1px solid var(--border);margin-bottom:6px;border-radius:6px';
  var woHtml;
  if (locked) {
    var lw = AppState.workOrders.find(function(w){ return w.id === prefill.woId; });
    woHtml = '<div class="mdr-ar-locked" data-wo-id="' + prefill.woId + '" onclick="mdrLockedWoMsg()" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-muted);margin-bottom:5px;box-sizing:border-box">'
      + escHtml(lw ? (lw.wo_number + ' — ' + (lw.title || '(no title)')) : 'Work order') + ' &#128274;</div>';
  } else {
    woHtml = '<select class="mdr-ar-wo" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);margin-bottom:5px">'
      + mdrAllocWoOptions(stop, prefill.woId || '', isExisting ? prefill.woId : '') + '</select>';
  }
  div.innerHTML = woHtml
    + '<div style="display:flex;gap:6px"><input class="mdr-ar-hours" type="number" inputmode="decimal" placeholder="Hours" min="0" step="0.25" value="' + (isExisting ? prefill.hours : '') + '" style="flex:1;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)" oninput="mdrUpdateAllocSummary(' + MDRState.tagStopIdx + ')">'
    + '<select class="mdr-ar-ht" style="flex:2;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">' + htOptions + '</select>'
    + '<button onclick="mdrRemoveAllocRow(this)" style="padding:8px 12px;border:1px solid var(--danger);border-radius:6px;color:var(--danger);background:none;cursor:pointer">&times;</button></div>';
  container.appendChild(div);
  return div;
}

// Removing an existing row only takes effect on Save & Close (the X abandons it), then marks the hours entry inactive.
function mdrRemoveAllocRow(btn) {
  var row = btn.closest('[data-alloc-row]');
  if (!row) return;
  var entryId = row.getAttribute('data-entry-id');
  if (entryId) { MDRState.allocRemoved = MDRState.allocRemoved || []; if (MDRState.allocRemoved.indexOf(entryId) < 0) MDRState.allocRemoved.push(entryId); }
  row.remove();
  mdrUpdateAllocSummary(MDRState.tagStopIdx);
}

function mdrUpdateAllocSummary(idx) {
  var el = document.getElementById('mdr-alloc-summary');
  if (!el) return;
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var total = 0;
  document.querySelectorAll('#mdr-alloc-rows > [data-alloc-row] .mdr-ar-hours').forEach(function(inp){ total += parseFloat(inp.value || 0); });
  var gpsH = stop.durationMin / 60;
  var diff = total - gpsH;
  var html = 'Allocated: <strong>' + total.toFixed(1) + 'h</strong> of ' + gpsH.toFixed(1) + 'h GPS';
  if (Math.abs(diff) > 0.08) {
    if (diff < 0) html += ' <span style="color:#a32d2d">&#9888; ' + Math.abs(diff).toFixed(1) + 'h unaccounted</span>';
    else html += ' <span style="color:#854f0b">&#9888; over GPS (min billing)</span>';
  } else if (total > 0) {
    html += ' <span style="color:#3b6d11">&#10003;</span>';
  }
  el.innerHTML = html;
}

// =============================================================
// M5 — Save & Close: edit in place by entry id
// Patch the rows that changed, post new rows, mark removed rows inactive (never delete). Nothing else is touched.
// Audit trail (docs/specs/operational-audit-trail.md, v4.89; not re-verified against the live database): hours_entries has the generic audit trigger on insert and update
// (not delete), so patches log one row per changed field, a removal logs one deactivate row with a snapshot, and a new row
// logs a create. The old mobile save hard-deleted and re-created every row, which the trigger could not log at all.
// =============================================================
function mdrSaveAllocations(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  if (MDRState._allocSaving) return;
  var rows = document.querySelectorAll('#mdr-alloc-rows > [data-alloc-row]');
  var patches = [];
  var posts = [];
  var valid = true;
  rows.forEach(function(row) {
    if (!valid) return;
    var entryId = row.getAttribute('data-entry-id') || '';
    var woSel = row.querySelector('select.mdr-ar-wo');
    var locked = row.querySelector('.mdr-ar-locked');
    var woId = locked ? locked.getAttribute('data-wo-id') : (woSel ? woSel.value : '');
    var hoursInp = row.querySelector('.mdr-ar-hours');
    var hours = parseFloat(hoursInp ? hoursInp.value : 0);
    var htSel = row.querySelector('select.mdr-ar-ht');
    var htId = htSel ? htSel.value : '';
    if (!woId) { valid = false; showToast('Select a work order for each row'); return; }
    if (!hours || hours <= 0) { valid = false; showToast('Enter hours for each allocation'); return; }
    if (entryId) {
      var origWo = row.getAttribute('data-orig-wo') || '';
      var origHours = parseFloat(row.getAttribute('data-orig-hours') || 0);
      var origHt = row.getAttribute('data-orig-ht') || '';
      var changes = {};
      if (woId !== origWo) {
        if (mdrWoIsProcessed(origWo)) { valid = false; mdrLockedWoMsg(); return; }
        var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
        var techName = (findTechAny(MDRState.tech) || {}).name || '';
        changes.work_order_id = woId;
        changes.descriptor = (wo ? wo.wo_number : '') + ' - ' + techName + ' - ' + (wo ? (wo.title || '') : '');
      }
      if (Math.abs(hours - origHours) > 0.0001) changes.hours = hours;
      if (htId !== origHt) {
        var ht = AppState.hoursTypes.find(function(t){ return t.id === htId; });
        var internalRate = ht ? (ht.internal_rate_key ? parseFloat(ht.internal_rate_key) : 0) : 0;
        changes.hours_type_id = htId || null;
        changes.internal_rate = internalRate || null;
      }
      if (Object.keys(changes).length) patches.push({ row: row, entryId: entryId, changes: changes, woId: woId, hours: hours, htId: htId });
    } else {
      posts.push({ row: row, woId: woId, hours: hours, htId: htId });
    }
  });
  if (!valid) return;
  var removed = (MDRState.allocRemoved || []).slice();
  if (!rows.length && !removed.length) { showToast('Add at least one WO allocation'); return; }
  if (!patches.length && !posts.length && !removed.length) { mdrCloseTagSheet(); return; }

  var tech = AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var entryDate = MDRState.selectedDate || DRState.selectedDate || new Date().toISOString().slice(0,10);
  var locationId = stop.location ? stop.location.id : null;
  var descriptor = stop.location ? stop.location.name : 'GPS stop';
  var who = AppState.userEmail || 'field';
  var now = new Date().toISOString();
  MDRState._allocSaving = true;
  var saveBtn = document.getElementById('mdr-alloc-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  var jobs = [];
  patches.forEach(function(p) {
    var body = {};
    Object.keys(p.changes).forEach(function(k){ body[k] = p.changes[k]; });
    body.modified_by = who;
    body.modified_at = now;
    jobs.push(Promise.resolve(sb.patch('hours_entries', p.entryId, body)).then(function(r) {
      if (!r || r.ok === false) return false;
      // remember what is now saved so a retry only sends what is still unsaved
      p.row.setAttribute('data-orig-wo', p.woId);
      p.row.setAttribute('data-orig-hours', String(p.hours));
      p.row.setAttribute('data-orig-ht', p.htId);
      return true;
    }));
  });
  posts.forEach(function(p) {
    var ht = AppState.hoursTypes.find(function(t){ return t.id === p.htId; });
    var internalRate = ht ? (ht.internal_rate_key ? parseFloat(ht.internal_rate_key) : 0) : 0;
    jobs.push(Promise.resolve(sb.post('hours_entries', {
      work_order_id: p.woId,
      tech_id: tech,
      entry_date: entryDate,
      hours_type_id: p.htId || null,
      hours: p.hours,
      billable: true,
      location_id: locationId,
      descriptor: descriptor,
      internal_rate: internalRate || null,
      line_total: null,
      created_by: who,
      modified_by: who
    })).then(function(r) {
      if (!r || !r.ok || !r.data || !r.data[0]) return false;
      // the new row is now an existing row, so a retry patches it instead of posting a duplicate
      p.row.setAttribute('data-entry-id', r.data[0].id);
      p.row.setAttribute('data-orig-wo', p.woId);
      p.row.setAttribute('data-orig-hours', String(p.hours));
      p.row.setAttribute('data-orig-ht', p.htId);
      return true;
    }));
  });
  removed.forEach(function(entryId) {
    jobs.push(Promise.resolve(sb.patch('hours_entries', entryId, { active: false, modified_by: who })).then(function(r) {
      if (!r || r.ok === false) return false;
      MDRState.allocRemoved = (MDRState.allocRemoved || []).filter(function(id){ return id !== entryId; });
      return true;
    }));
  });

  Promise.all(jobs).then(function(results) {
    MDRState._allocSaving = false;
    var failed = results.filter(function(ok){ return !ok; }).length;
    if (failed) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save &amp; Close'; }
      showToast('Error saving ' + failed + ' change' + (failed > 1 ? 's' : '') + ' — tap Save & Close to retry');
      return;
    }
    mdrCloseTagSheet();
    showToast('Allocations saved');
    var reloadTech = MDRState.tech || tech;
    sb.get('hours_entries', '?tech_id=eq.' + reloadTech + '&entry_date=eq.' + entryDate + '&active=eq.true&select=*,work_orders(wo_number,customers(display_name,name))&order=created_at.asc')
      .then(function(r) {
        MDRState.hoursEntries = (r.ok && r.data) ? r.data : [];
        mdrRenderDay(null);
      });
  }).catch(function() {
    MDRState._allocSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save &amp; Close'; }
    showToast('Save failed — check connection');
  });
}
