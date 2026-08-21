// field-travel-log.js — Desktop and Mobile Field Travel Log
// Extracted from app-core.js — v4.41 — Aug 18 2026
// Pure move — no behavior changes from v4.40
// v4.42 — Aug 18 2026 — merge bar trigger fix, tbMergeStops duration fix, totalDurationMin added
// DR  = Desktop Field Travel Log (DRState + dr* functions)
// MDR = Mobile Field Travel Log  (MDRState + mdr* functions)

// =============================================================
// DAILY REVIEW PANEL — v2
// =============================================================

var DRState = {
  tech: null,
  weekStart: null,
  selectedDate: null,
  dayReviews: [],
  pings: [],
  stops: [],
  locations: [],
  hoursEntries: [],
  selectedStop: null,
  unreviewed: false,
  map: null,
  mapReady: false,
  mergeSelected: [],
  trail: null,
  stopMarkers: [],
  infoWindow: null,
  tagStep: 0,
  tagStopIdx: null,
  stopFlags: {}
};

// ── Timezone helpers ─────────────────────────────────────────
function drGetTZOffset() {
  // Returns offset in hours for current local timezone (e.g. -4 for EDT)
  return -new Date().getTimezoneOffset() / 60;
}

function drGetTimezone() {
  return AppState.settings.timezone || 'America/New_York';
}

function drLocalMidnightUTC(dateStr) {
  // Eastern day starts at 04:00 UTC (midnight Eastern Standard, covers EDT too)
  // This ensures evening GPS pings don't fall into the next UTC date
  return dateStr + 'T04:00:00.000Z';
}

function drNextLocalMidnightUTC(dateStr) {
  var parts = dateStr.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1])-1, d = parseInt(parts[2]);
  var next = new Date(Date.UTC(y, m, d+1, 4, 0, 0, 0));
  return next.toISOString();
}

// ── Entry point ──────────────────────────────────────────────
function renderDailyReviewPanel() {
  var el = document.getElementById('dailyreview-panel-inner');
  if (!el) return;
  DRState.mode = 'travel';
  DRState.weekStart = drGetMonday(new Date());
  DRState.selectedDate = DRState.selectedDate || drTodayStr();
  DRState.tech = drGetDefaultTech();
  DRState.locations = LocState.locations.length ? LocState.locations : [];
  DRState.map = null;
  DRState.mapReady = false;
  DRState.tagStep = 0;
  el.innerHTML = drBuildShell();
  drPopulateTechSelect();
  drLoadWeek();
}

function drBuildShell() {
  var html = '<div id="dr-shell">';
  html += '<div id="dr-topbar" style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap">';
  html += '<div id="dr-screen-title" style="font-size:15px;font-weight:700;white-space:nowrap">Field Travel Log</div>';
  html += '<select id="dr-tech-select" onchange="drOnTechChange(this.value)" style="font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);min-width:120px;max-width:200px"><option>Loading...</option></select>';
  html += '<div id="dr-sync-badge" style="font-size:11px;color:var(--text-muted);margin-left:auto"></div>';
  html += '<div id="dr-reconcile-datepicker" style="display:none;align-items:center;gap:6px">';
  html += '<button onclick="drReconcileNavDay(-1)" style="padding:3px 9px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:13px">&#8249;</button>';
  html += '<input type="date" id="dr-reconcile-date" onchange="drReconcileSetDate(this.value)" style="font-size:13px;padding:3px 7px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">';
  html += '<button onclick="drReconcileNavDay(1)" style="padding:3px 9px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:13px">&#8250;</button>';
  html += '</div>';
  html += '</div>';
  html += '<div id="dr-week-bar"></div>';
  html += '<div id="dr-body">';
  html += '<div id="dr-timeline-col"><div style="padding:20px;color:var(--text-muted);font-size:13px">Select a day to view timeline</div></div>';
  html += '<div id="dr-map-col"><div id="dr-map"></div>';
  html += '<div id="dr-alloc-panel">';
  html += '<div id="dr-alloc-panel-head">';
  html += '<div id="dr-alloc-panel-title" style="font-size:13px;font-weight:700"></div>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<div id="dr-alloc-gps-summary" style="font-size:11px;color:var(--text-muted)"></div>';
  html += '<button onclick="drCloseAllocPanel()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted)">&times;</button>';
  html += '</div></div>';
  html += '<div id="dr-alloc-panel-body"><table class="dr-alloc-grid"><thead><tr>';
  html += '<th style="width:22%">Customer</th><th style="width:28%">Work Order</th><th style="width:9%">Hours</th><th style="width:14%">Rate</th><th style="width:8%">Paid</th><th style="width:8%">Bill</th><th style="width:6%"></th>';
  html += '</tr></thead><tbody id="dr-alloc-tbody"></tbody></table></div>';
  html += '<div id="dr-alloc-panel-foot">';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<button onclick="drAllocAddRow()" style="font-size:12px;padding:5px 12px;border:1px dashed var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">+ Add row</button>';
  html += '<div id="dr-alloc-remaining" style="font-size:12px;color:var(--text-muted)"></div>';
  html += '<button onclick="drAllocSave()" style="margin-left:auto;font-size:12px;padding:6px 16px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Save to timecard</button>';
  html += '</div></div>';
  html += '</div></div>';
  // Billing column — shown in reconcile mode, hidden in travel mode
  html += '<div id="dr-billing-col" style="display:none;flex-direction:column;overflow-y:auto;border-left:.5px solid var(--border)">';
  html += '<div id="dr-billing-summary" style="padding:10px 14px;border-bottom:.5px solid var(--border);display:flex;gap:20px;flex-shrink:0"></div>';
  html += '<div id="dr-billing-body" style="padding:14px;flex:1"></div>';
  html += '</div>';
  html += '</div>';
  html += '<div id="dr-bottom"></div>';
  html += '</div>';
  return html;
}

// ── Tech select ───────────────────────────────────────────────
function drGetDefaultTech() {
  var def = localStorage.getItem('dwo_default_tech');
  if (def) return def;
  if (AppState.technicians.length) return AppState.technicians[0].id;
  return null;
}

function drPopulateTechSelect() {
  var el = document.getElementById('dr-tech-select');
  if (!el) return;
  el.innerHTML = AppState.technicians.map(function(t) {
    return '<option value="' + t.id + '"' + (t.id === DRState.tech ? ' selected' : '') + '>' + escHtml(t.name) + '</option>';
  }).join('');
}

function drOnTechChange(id) {
  DRState.tech = id;
  setDefaultTech(id);
  drLoadWeek();
}

// ── Date helpers ──────────────────────────────────────────────
function drTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function drDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function drGetMonday(d) {
  var day = d.getDay();
  var diff = (day === 0 ? -6 : 1 - day);
  var mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0,0,0,0);
  return mon;
}

function drAddDays(d, n) {
  var r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function drFormatTime(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', hour12:true});
}

function drFormatDuration(minutes) {
  if (!minutes && minutes !== 0) return '--';
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (h === 0) return m + 'm';
  return h + 'h ' + (m > 0 ? m + 'm' : '');
}

// drElapsedMin — v4.44 — elapsed wall clock time for a stop (arrivedAt to leftAt)
// This is the authoritative time value for display and billing throughout the app.
// GPS durationMin is internal engine data only — never shown to users.
function drElapsedMin(stop) {
  if (!stop || !stop.arrivedAt) return 0;
  // v4.46 — merged stops use totalDurationMin (sum of actual segment durations)
  // Wall clock (leftAt - arrivedAt) includes gaps between segments (lunch, travel to other sites)
  // which is wrong — e.g. 10am-11am + 4pm-4pm = 2h billed, not 6h wall clock
  var dayReview = DRState && DRState.dayReviews && DRState.dayReviews.find(function(r) {
    return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech;
  });
  if (dayReview && dayReview.merged_stops) {
    var ms = [];
    try { ms = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
    if (!Array.isArray(ms)) ms = [];
    var mergeRec = ms.find(function(m){ return m.primaryArrivedAt === stop.arrivedAt; });
    if (mergeRec && mergeRec.totalDurationMin) return mergeRec.totalDurationMin;
  }
  // Non-merged — wall clock elapsed
  if (!stop.leftAt) return 0;
  return Math.round((new Date(stop.leftAt) - new Date(stop.arrivedAt)) / 60000);
}

// ── Week navigation ───────────────────────────────────────────
function drNavWeek(dir) {
  DRState.weekStart = drAddDays(DRState.weekStart, dir * 7);
  drLoadWeek();
}

function drLoadWeek() {
  if (!DRState.tech) return;
  var weekEnd = drAddDays(DRState.weekStart, 6);
  var startStr = drDateStr(DRState.weekStart);
  var endStr = drDateStr(weekEnd);
  sb.get('day_review', '?tech_id=eq.' + DRState.tech + '&review_date=gte.' + startStr + '&review_date=lte.' + endStr + '&select=*')
    .then(function(r) {
      if (!r.ok) { drShowLoadError(); return; }
      DRState.dayReviews = r.data || [];
      var systemStart = AppState.settings.system_start_date || '2026-01-01';
      sb.get('day_review', '?tech_id=eq.' + DRState.tech + '&review_date=lt.' + startStr + '&review_date=gte.' + systemStart + '&status=neq.accepted&select=id&limit=1')
        .then(function(r2) {
          DRState.unreviewed = r2.ok && r2.data && r2.data.length > 0;
          drRenderWeekBar();
          if (DRState.selectedDate >= startStr && DRState.selectedDate <= endStr) {
            drLoadDay(DRState.selectedDate);
          } else {
            DRState.selectedDate = startStr;
            drLoadDay(startStr);
          }
        }).catch(function(){ drShowLoadError(); });
    }).catch(function(){ drShowLoadError(); });
}

function drShowLoadError() {
  var el = document.getElementById('dr-timeline-col');
  if (el) el.innerHTML = '<div style="padding:40px;text-align:center"><div style="font-size:14px;color:var(--text-muted);margin-bottom:12px">Connection error — could not load data.</div><button onclick="drLoadWeek()" style="padding:8px 20px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:13px">Retry</button></div>';
}


function drRenderWeekBar() {
  var el = document.getElementById('dr-week-bar');
  if (!el) return;
  var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var weekEnd = drAddDays(DRState.weekStart, 6);
  var html = '<button onclick="drNavWeek(-1)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:13px;flex-shrink:0">&#8249;</button>';
  html += '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;margin:0 4px">' + drDateStr(DRState.weekStart) + ' &ndash; ' + drDateStr(weekEnd) + '</div>';
  for (var i = 0; i < 7; i++) {
    var d = drAddDays(DRState.weekStart, i);
    var ds = drDateStr(d);
    var review = DRState.dayReviews.find(function(r) { return r.review_date === ds; });
    var status = review ? review.status : 'none';
    var cls = 'gray';
    if (status === 'accepted') cls = 'green';
    else if (status === 'kicked_back') cls = 'red';
    else if (status === 'submitted' || status === 'ready') cls = 'amber';
    else if (ds === drTodayStr()) cls = 'amber';
    var isActive = ds === DRState.selectedDate;
    html += '<div class="dr-day-chip ' + cls + (isActive ? ' active' : '') + '" onclick="drLoadDay(\'' + ds + '\')">';
    html += '<div style="font-size:9px;margin-bottom:1px">' + days[i] + '</div>';
    html += '<div style="font-size:12px;font-weight:500;line-height:1">' + d.getDate() + '</div>';
    if (status === 'accepted') html += '<div style="font-size:8px;margin-top:1px">&#10003;</div>';
    else if (status === 'kicked_back') html += '<div style="font-size:8px;margin-top:1px">!</div>';
    else if (ds === drTodayStr()) html += '<div style="font-size:8px;margin-top:1px">&bull;</div>';
    else html += '<div style="font-size:8px;margin-top:1px">&ndash;</div>';
    html += '</div>';
  }
  html += '<button onclick="drNavWeek(1)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:13px;flex-shrink:0">&#8250;</button>';
  if (DRState.unreviewed) {
    html += '<div class="dr-unreviewed">&#9888; Unreviewed days in prior weeks</div>';
  }
  el.innerHTML = html;
}

// ── Day loading ───────────────────────────────────────────────
function drLoadDay(dateStr) {
  DRState.selectedDate = dateStr;
  DRState.selectedStop = null;
  DRState.tagStep = 0;
  drRenderWeekBar();
  var tlEl = document.getElementById('dr-timeline-col');
  if (tlEl) tlEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">Loading...</div>';
  drRenderBottomStrip(null);
  drCloseTagOverlay();

  var tid = drGetTechTid();
  if (!tid) {
    if (tlEl) tlEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">No OwnTracks ID set for this technician. Set it in Settings &rarr; General &rarr; Technicians.</div>';
    return;
  }

  // Use local midnight boundaries to avoid UTC offset issues
  var fromUTC = drLocalMidnightUTC(dateStr);
  var toUTC = drNextLocalMidnightUTC(dateStr);

  Promise.all([
    sb.get('location_event', '?tid=eq.' + tid + '&timestamp=gte.' + fromUTC + '&timestamp=lt.' + toUTC + '&select=id,tid,timestamp,lat,lng,accuracy,speed,battery&order=timestamp.asc&limit=10000'),
    sb.get('hours_entries', '?tech_id=eq.' + DRState.tech + '&entry_date=eq.' + dateStr + '&select=*,work_orders(wo_number,customers(display_name,name))&order=created_at.asc')
  ]).then(function(results) {
    DRState.pings = (results[0].ok && results[0].data) ? results[0].data : [];
    DRState.hoursEntries = (results[1].ok && results[1].data) ? results[1].data : [];
    if (!DRState.locations.length) {
      sb.get('locations', '?active=eq.true&select=*').then(function(r) {
        DRState.locations = (r.ok && r.data) ? r.data : [];
        drProcessAndRender();
      });
    } else {
      drProcessAndRender();
    }
  });
}

function drGetTechTid() {
  var tech = AppState.technicians.find(function(t) { return t.id === DRState.tech; });
  if (!tech) return null;
  return tech.tid || null;
}

// ── Stop detection ────────────────────────────────────────────
function drDetectMergeGroups(allStops, workStops) {
  var mergeGapMin = parseInt(AppState.settings.gps_merge_gap_threshold || '120');
  // Build set of arrivedAt keys already recorded in merged_stops (primary or secondary)
  var alreadyMergedKeys = {};
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview && dayReview.merged_stops) {
    var existingMerges = [];
    try { existingMerges = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
    if (!Array.isArray(existingMerges)) existingMerges = [];
    existingMerges.forEach(function(m){
      alreadyMergedKeys[m.primaryArrivedAt] = true;
      (m.mergedSegments||[]).forEach(function(seg){ if (seg.arrivedAt) alreadyMergedKeys[seg.arrivedAt] = true; });
    });
  }
  // Build set of work stop arrivedAt timestamps for filtering
  var workKeys = {};
  workStops.forEach(function(s){ workKeys[s.arrivedAt] = true; });
  var groups = {};
  allStops.forEach(function(stop, idx) {
    if (!stop.location) return;
    if (!workKeys[stop.arrivedAt]) return;
    if (alreadyMergedKeys[stop.arrivedAt]) return; // skip already-merged stops
    var locId = stop.location.id;
    if (!groups[locId]) groups[locId] = [];
    groups[locId].push(idx);
  });
  var result = [];
  Object.keys(groups).forEach(function(locId) {
    var indices = groups[locId];
    if (indices.length < 2) return;
    var eligible = [indices[0]];
    for (var i = 1; i < indices.length; i++) {
      var prev = allStops[indices[i-1]];
      var curr = allStops[indices[i]];
      var gapMin = Math.round((new Date(curr.arrivedAt) - new Date(prev.leftAt)) / 60000);
      if (gapMin <= mergeGapMin) eligible.push(indices[i]);
    }
    if (eligible.length >= 2) {
      result.push({ locId: locId, locName: allStops[eligible[0]].location.name, indices: eligible });
    }
  });
  return result;
}

function drRenderMergeBanner(group, allStops) {
  var totalMin = group.indices.reduce(function(s, idx){ return s + allStops[idx].durationMin; }, 0);
  var bannerId = 'merge-banner-' + group.locId.replace(/[^a-z0-9]/gi,'');
  var html = '<div id="' + bannerId + '" style="background:#faeeda;border:1px solid #ef9f27;border-radius:var(--radius);padding:8px 10px;margin-bottom:8px;font-size:12px">';
  html += '<div style="font-weight:600;color:#854f0b;margin-bottom:4px">&#9889; ' + group.indices.length + ' stops at ' + escHtml(group.locName) + ' today — same job?</div>';
  html += '<div style="color:#854f0b;margin-bottom:6px">Total: ' + drFormatDuration(totalMin) + ' across ' + group.indices.length + ' segments</div>';
  // Segment chips
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
  group.indices.forEach(function(idx) {
    var s = allStops[idx];
    html += '<div style="font-size:11px;background:#fff8ee;border:1px solid #ef9f27;border-radius:4px;padding:3px 7px;color:#854f0b">' + drFormatTime(s.arrivedAt) + ' · ' + drFormatDuration(s.durationMin) + '</div>';
  });
  html += '</div>';
  // Buttons row
  html += '<div id="' + bannerId + '-btns" style="display:flex;gap:6px;flex-wrap:wrap">';
  html += '<button onclick="drMergeStops(' + JSON.stringify(group.indices) + ')" style="font-size:12px;padding:5px 12px;background:#854f0b;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Merge all</button>';
  html += '<button onclick="drShowSegmentSelect(\'' + bannerId + '\',' + JSON.stringify(group.indices) + ')" style="font-size:12px;padding:5px 12px;background:#fff8ee;color:#854f0b;border:1px solid #ef9f27;border-radius:var(--radius);cursor:pointer">Select segments</button>';
  html += '<button onclick="document.getElementById(\'' + bannerId + '\').style.display=\'none\'" style="font-size:12px;padding:5px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Keep separate</button>';
  html += '</div>';
  // Inline segment selector (hidden by default)
  html += '<div id="' + bannerId + '-select" style="display:none;margin-top:10px;border-top:1px solid #ef9f27;padding-top:8px">';
  html += '<div style="font-size:11px;font-weight:600;color:#854f0b;margin-bottom:6px">Select segments to merge:</div>';
  group.indices.forEach(function(idx, i) {
    var s = allStops[idx];
    html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff8ee;border:1px solid #ef9f27;border-radius:var(--radius);margin-bottom:4px;cursor:pointer">';
    html += '<input type="checkbox" id="' + bannerId + '-cb-' + i + '" checked style="width:16px;height:16px;cursor:pointer;flex-shrink:0">';
    html += '<span style="font-size:12px;color:#854f0b;flex:1">' + drFormatTime(s.arrivedAt) + ' — ' + drFormatTime(s.leftAt) + '</span>';
    html += '<span style="font-size:12px;font-weight:600;color:#854f0b">' + drFormatDuration(s.durationMin) + '</span>';
    html += '</label>';
  });
  html += '<div style="font-size:11px;color:#854f0b;margin:6px 0" id="' + bannerId + '-total">Total selected: ' + drFormatDuration(totalMin) + '</div>';
  html += '<div style="display:flex;gap:6px;margin-top:6px">';
  html += '<button onclick="drMergeSelected(\'' + bannerId + '\',' + JSON.stringify(group.indices) + ')" style="font-size:12px;padding:5px 12px;background:#854f0b;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Merge selected</button>';
  html += '<button onclick="drHideSegmentSelect(\'' + bannerId + '\')" style="font-size:12px;padding:5px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Cancel</button>';
  html += '</div></div>';
  html += '</div>';
  return html;
}

function drShowSegmentSelect(bannerId, indices) {
  var btns = document.getElementById(bannerId + '-btns');
  var sel = document.getElementById(bannerId + '-select');
  if (btns) btns.style.display = 'none';
  if (sel) sel.style.display = 'block';
  // Wire checkboxes to update total
  indices.forEach(function(idx, i) {
    var cb = document.getElementById(bannerId + '-cb-' + i);
    if (cb) cb.onchange = function(){ drUpdateSegmentTotal(bannerId, indices); };
  });
}

function drHideSegmentSelect(bannerId) {
  var btns = document.getElementById(bannerId + '-btns');
  var sel = document.getElementById(bannerId + '-select');
  if (btns) btns.style.display = 'flex';
  if (sel) sel.style.display = 'none';
}

function drUpdateSegmentTotal(bannerId, indices) {
  var totalEl = document.getElementById(bannerId + '-total');
  if (!totalEl) return;
  var total = 0;
  indices.forEach(function(idx, i) {
    var cb = document.getElementById(bannerId + '-cb-' + i);
    if (cb && cb.checked) total += DRState.stops[idx] ? DRState.stops[idx].durationMin : 0;
  });
  totalEl.textContent = 'Total selected: ' + drFormatDuration(total);
}

function drMergeSelected(bannerId, indices) {
  var selected = [];
  indices.forEach(function(idx, i) {
    var cb = document.getElementById(bannerId + '-cb-' + i);
    if (cb && cb.checked) selected.push(idx);
  });
  if (selected.length < 2) { showToast('Select at least 2 segments to merge'); return; }
  drMergeStops(selected);
}

function drMergeStops(indices) {
  var stops = DRState.stops;
  var primary = stops[indices[0]];
  var merged = {
    arrivedAt: primary.arrivedAt,
    leftAt: stops[indices[indices.length-1]].leftAt,
    lat: primary.lat,
    lng: primary.lng,
    location: primary.location,
    allocations: [],
    hoursEntries: [],
    isPaid: primary.isPaid,
    isBillable: primary.isBillable
  };
  // Sum of individual stop durations — correct (wall clock includes gaps between stops)
  var totalMergedMin = indices.reduce(function(sum, idx){ return sum + (stops[idx] ? stops[idx].durationMin : 0); }, 0);
  merged.durationMin = totalMergedMin;
  // Merge allocations from all segments
  indices.forEach(function(idx){ (stops[idx].allocations||[]).forEach(function(a){ merged.allocations.push(a); }); });
  // Replace first stop with merged — secondary segments suppressed via merged_stops check in render
  stops[indices[0]] = merged;
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    var mergedStops = dayReview.merged_stops ? JSON.parse(typeof dayReview.merged_stops === 'string' ? dayReview.merged_stops : JSON.stringify(dayReview.merged_stops)) : [];
    if (!Array.isArray(mergedStops)) mergedStops = [];
    var mergeRecord = {
      primaryArrivedAt: merged.arrivedAt,
      mergedSegments: indices.slice(1).map(function(idx){ return { arrivedAt: stops[idx] ? stops[idx].arrivedAt : null, leftAt: stops[idx] ? stops[idx].leftAt : null, durationMin: stops[idx] ? stops[idx].durationMin : 0 }; }).filter(function(s){ return s.arrivedAt; }),
      originalDurationMin: stops[indices[0]] ? stops[indices[0]].durationMin : merged.durationMin,
      totalDurationMin: totalMergedMin,
      mergedAt: new Date().toISOString()
    };
    mergedStops.push(mergeRecord);
    sb.patch('day_review', dayReview.id, { merged_stops: mergedStops, modified_by: AppState.userEmail, modified_at: new Date().toISOString() });
    dayReview.merged_stops = mergedStops;
  }
  DRState.selectedStop = null;
  showToast('Stops merged');
  drRenderTimeline();
}

function drProcessAndRender() {
  DRState.stops = drDetectStops(DRState.pings, DRState.locations);
  drRebuildAllocationsFromEntries();
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  drLoadStopFlags(dayReview || null);
  // Apply saved stop location selections — v4.45
  // stop_locations value can be:
  //   string  → single account (legacy format)
  //   array   → multiple confirmed accounts (new format)
  if (dayReview && dayReview.stop_locations) {
    var stopLocs = {};
    try { stopLocs = typeof dayReview.stop_locations === 'string' ? JSON.parse(dayReview.stop_locations) : dayReview.stop_locations; } catch(e){}
    if (stopLocs && typeof stopLocs === 'object' && !Array.isArray(stopLocs)) {
      DRState.stops.forEach(function(stop) {
        var savedVal = stopLocs[stop.arrivedAt];
        if (!savedVal || !stop.locationMatches || stop.locationMatches.length < 2) return;
        if (Array.isArray(savedVal)) {
          // Multi-account confirmed — store array of matched locations
          var matched = savedVal.map(function(id) {
            return stop.locationMatches.find(function(l){ return l.id === id; });
          }).filter(Boolean);
          if (matched.length) {
            stop.confirmedAccounts = matched;
            stop.location = matched[0]; // primary for backward compat
          }
        } else {
          // Legacy single string
          var saved = stop.locationMatches.find(function(l){ return l.id === savedVal; });
          if (saved) {
            stop.confirmedAccounts = [saved];
            stop.location = saved;
          }
        }
      });
    }
  }
  drRenderTimeline();
  drInitMap();
}

function drRebuildAllocationsFromEntries() {
  var ASSOC_RADIUS = parseInt(AppState.settings.geofence_radius_default || '100') * 3;
  DRState.stops.forEach(function(stop){ stop.allocations = []; });
  DRState.hoursEntries.forEach(function(entry) {
    if (!entry.location_id) return;
    var entryLoc = DRState.locations.find(function(l){ return l.id === entry.location_id; });
    if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
    var bestStop = null;
    var bestDist = Infinity;
    DRState.stops.forEach(function(s) {
      var dist = drHaversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
      if (dist < bestDist) { bestDist = dist; bestStop = s; }
    });
    if (bestStop && bestDist <= ASSOC_RADIUS) {
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
        isBillable: entry.billable !== false
      });
    }
  });
}


/* DEPRECATED — moved to gps-engine.js — 2026-08-07
   Speed-based simplified stop detection replaces this implementation.
   Keep for historical reference during build phase.
   Remove in cleanup phase once gps-engine.js is proven stable.
*/
/*
function drDetectStops(pings, locations) {
  if (!pings.length) return [];

  var KNOWN_MIN_MINUTES = parseInt(AppState.settings.gps_known_stop_min_duration || '5');
  var KNOWN_GAP_TOLERANCE = parseInt(AppState.settings.gps_known_gap_tolerance || '30');
  var KNOWN_MIN_PINGS = parseInt(AppState.settings.gps_known_min_pings || '3');
  var UNKNOWN_MIN_MINUTES = parseInt(AppState.settings.gps_unknown_stop_min_duration || '10');
  var UNKNOWN_CLUSTER_RADIUS = 100;
  var ACC_THRESHOLD = parseInt(AppState.settings.gps_accuracy_threshold || '100');
  var GEOFENCE_DEFAULT = parseInt(AppState.settings.geofence_radius_default || '100');

  var goodPings = pings.filter(function(p) {
    return !(p.acc && parseInt(p.acc) > ACC_THRESHOLD);
  });
  if (!goodPings.length) return [];

  var stops = [];

  function getMatchingLoc(ping) {
    var bestMatch = null;
    var bestDist = Infinity;
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || GEOFENCE_DEFAULT);
      var dist = drHaversineMeters(ping.lat, ping.lng, loc.lat, loc.lng);
      if (dist <= radius && dist < bestDist) { bestDist = dist; bestMatch = loc; }
    });
    return bestMatch;
  }

  function getAllMatchesAt(lat, lng) {
    var matches = [];
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || GEOFENCE_DEFAULT);
      var dist = drHaversineMeters(lat, lng, loc.lat, loc.lng);
      if (dist <= radius) matches.push({ loc: loc, dist: dist });
    });
    matches.sort(function(a,b){ return a.dist - b.dist; });
    return matches;
  }

  // flushKnownWindow: arrivedAt = first ping in window, leftAt = last ping in window
  // The minimum dwell check is a gate only — does not shift boundaries
  function flushKnownWindow(firstIdx, lastIdx, pingCount) {
    var arrivedAt = goodPings[firstIdx].timestamp;  // always the true first ping
    var leftAt = goodPings[lastIdx].timestamp;       // always the true last ping
    var durationMin = Math.round((new Date(leftAt) - new Date(arrivedAt)) / 60000);

    // Gate 1: must meet minimum dwell time
    if (durationMin < KNOWN_MIN_MINUTES) return;

    // Gate 2: must meet minimum ping count before gap tolerance can have extended this window
    if (pingCount < KNOWN_MIN_PINGS) return;

    var centerLat = goodPings[firstIdx].lat;
    var centerLng = goodPings[firstIdx].lng;
    var allMatches = getAllMatchesAt(centerLat, centerLng);
    var bestMatch = allMatches.length ? allMatches[0].loc : null;
    stops.push({
      arrivedAt: arrivedAt,
      leftAt: leftAt,
      lat: centerLat,
      lng: centerLng,
      durationMin: durationMin,
      pingCount: pingCount,
      location: allMatches.length > 1 ? null : bestMatch,
      locationMatches: allMatches.length > 1 ? allMatches.map(function(m){ return m.loc; }) : null,
      allocations: [],
      hoursEntries: [],
      isPaid: allMatches.length === 1 && bestMatch ? true : false,
      isBillable: allMatches.length === 1 && bestMatch ? (bestMatch.billable_default !== false) : false
    });
  }

  // State for known location tracking
  var currentLocId = null;
  var windowFirstIdx = null;   // original first ping — never overwritten during gap
  var windowLastIdx = null;    // last confirmed ping inside geofence
  var pingCount = 0;           // confirmed pings inside geofence
  var gapStartIdx = null;      // first ping outside geofence (may re-enter)

  var unknownPings = [];

  function flushCurrentWindow() {
    if (currentLocId !== null && windowFirstIdx !== null && windowLastIdx !== null) {
      flushKnownWindow(windowFirstIdx, windowLastIdx, pingCount);
    }
    currentLocId = null;
    windowFirstIdx = null;
    windowLastIdx = null;
    pingCount = 0;
    gapStartIdx = null;
  }

  goodPings.forEach(function(ping, idx) {
    var matchedLoc = getMatchingLoc(ping);
    var matchedId = matchedLoc ? matchedLoc.id : null;

    if (matchedId) {
      if (matchedId === currentLocId) {
        // Continuing same known window — extend it, cancel any gap
        windowLastIdx = idx;
        pingCount++;
        gapStartIdx = null;

      } else if (currentLocId !== null && gapStartIdx !== null) {
        // We were in a gap — check if this is a return to same location
        var gapMin = Math.round((new Date(ping.timestamp) - new Date(goodPings[gapStartIdx].timestamp)) / 60000);

        if (matchedId === currentLocId) {
          // Returned to same location within gap — absorb, extend window
          windowLastIdx = idx;
          pingCount++;
          gapStartIdx = null;
        } else if (gapMin <= KNOWN_GAP_TOLERANCE && pingCount >= KNOWN_MIN_PINGS) {
          // Different location but within tolerance and we had enough pings — flush old, start new
          flushCurrentWindow();
          if (unknownPings.length) { flushUnknownCluster(unknownPings); unknownPings = []; }
          currentLocId = matchedId;
          windowFirstIdx = idx;
          windowLastIdx = idx;
          pingCount = 1;
        } else if (gapMin > KNOWN_GAP_TOLERANCE) {
          // Gap exceeded tolerance — flush old window, start new
          flushCurrentWindow();
          if (unknownPings.length) { flushUnknownCluster(unknownPings); unknownPings = []; }
          currentLocId = matchedId;
          windowFirstIdx = idx;
          windowLastIdx = idx;
          pingCount = 1;
        } else {
          // Gap within tolerance but not enough pings yet — absorb gap, extend to new loc
          windowLastIdx = idx;
          pingCount++;
          gapStartIdx = null;
          // Note: currentLocId stays same — this new loc may be overlapping geofence
        }

      } else {
        // Entering a new known location fresh
        if (currentLocId !== null) {
          flushCurrentWindow();
        } else {
          if (unknownPings.length) { flushUnknownCluster(unknownPings); unknownPings = []; }
        }
        currentLocId = matchedId;
        windowFirstIdx = idx;
        windowLastIdx = idx;
        pingCount = 1;
        gapStartIdx = null;
      }

    } else {
      // Outside any known geofence
      if (currentLocId !== null) {
        if (gapStartIdx === null) {
          // Just left — record gap start, keep window open
          gapStartIdx = idx;
        } else {
          // Already in gap — check if exceeded tolerance
          var gapMin = Math.round((new Date(ping.timestamp) - new Date(goodPings[gapStartIdx].timestamp)) / 60000);
          if (gapMin > KNOWN_GAP_TOLERANCE) {
            // Flush window with last known position as departure
            flushCurrentWindow();
            unknownPings.push(ping);
          }
          // else still within tolerance — wait for re-entry
        }
      } else {
        unknownPings.push(ping);
      }
    }
  });

  // End of day — flush any open window and remaining unknown pings
  if (currentLocId !== null) {
    flushCurrentWindow();
  }
  if (unknownPings.length) {
    flushUnknownCluster(unknownPings);
  }

  function flushUnknownCluster(pingArr) {
    if (!pingArr.length) return;
    var clusterPings = [pingArr[0]];
    var clusterCenter = { lat: pingArr[0].lat, lng: pingArr[0].lng };

    function emitCluster(cPings) {
      if (!cPings.length) return;
      var first = cPings[0];
      var last = cPings[cPings.length-1];
      var dur = Math.round((new Date(last.timestamp) - new Date(first.timestamp)) / 60000);
      if (dur < UNKNOWN_MIN_MINUTES) return;
      var cLat = cPings.reduce(function(s,p){ return s+p.lat; }, 0) / cPings.length;
      var cLng = cPings.reduce(function(s,p){ return s+p.lng; }, 0) / cPings.length;
      stops.push({
        arrivedAt: first.timestamp,
        leftAt: last.timestamp,
        lat: cLat,
        lng: cLng,
        durationMin: dur,
        pingCount: cPings.length,
        location: null,
        locationMatches: null,
        allocations: [],
        hoursEntries: [],
        isPaid: false,
        isBillable: false
      });
    }

    for (var j = 1; j < pingArr.length; j++) {
      var uPing = pingArr[j];
      var d = drHaversineMeters(uPing.lat, uPing.lng, clusterCenter.lat, clusterCenter.lng);
      if (d <= UNKNOWN_CLUSTER_RADIUS) {
        clusterPings.push(uPing);
        clusterCenter.lat = clusterPings.reduce(function(s,p){ return s+p.lat; }, 0) / clusterPings.length;
        clusterCenter.lng = clusterPings.reduce(function(s,p){ return s+p.lng; }, 0) / clusterPings.length;
      } else {
        emitCluster(clusterPings);
        clusterPings = [uPing];
        clusterCenter = { lat: uPing.lat, lng: uPing.lng };
      }
    }
    emitCluster(clusterPings);
  }

  // Sort stops chronologically
  stops.sort(function(a,b){ return new Date(a.arrivedAt) - new Date(b.arrivedAt); });

  // Associate hours entries to stops by proximity
  var GEOFENCE_DEFAULT_ASSOC = parseInt(AppState.settings.geofence_radius_default || '100');
  DRState.hoursEntries.forEach(function(entry) {
    if (!entry.location_id) return;
    var entryLoc = DRState.locations.find(function(l){ return l.id === entry.location_id; });
    if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
    var assocRadius = parseInt(entryLoc.geofence_radius || GEOFENCE_DEFAULT_ASSOC) * 3;
    var bestStop = null;
    var bestDist = Infinity;
    stops.forEach(function(s) {
      var dist = drHaversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
      if (dist < bestDist) { bestDist = dist; bestStop = s; }
    });
    if (bestStop && bestDist <= assocRadius) bestStop.hoursEntries.push(entry);
  });

  return stops;
}


*/

function drFlushStop(stopPings, stops, locations, defaultRadius, minMinutes, minPings) {
  minMinutes = minMinutes || 5;
  minPings = minPings || 4;
  if (stopPings.length < minPings) return;
  var first = stopPings[0];
  var last = stopPings[stopPings.length-1];
  var durationMin = Math.round((new Date(last.timestamp) - new Date(first.timestamp)) / 60000);
  if (durationMin < minMinutes) return;
  var centerLat = stopPings.reduce(function(s,p){return s+p.lat;},0) / stopPings.length;
  var centerLng = stopPings.reduce(function(s,p){return s+p.lng;},0) / stopPings.length;
  var matched = drMatchLocation(centerLat, centerLng, locations, defaultRadius);
  stops.push({
    arrivedAt: first.timestamp,
    leftAt: last.timestamp,
    durationMin: durationMin,
    lat: centerLat,
    lng: centerLng,
    pingCount: stopPings.length,
    location: matched,
    hoursEntries: [],
    stopType: matched ? (matched.location_type === 'customer' ? 'job_site' : matched.location_type === 'vendor' ? 'billable_errand' : 'non_billable') : null,
    allocations: []
  });
}

function drMatchLocation(lat, lng, locations, defaultRadius) {
  var matched = null;
  var minDist = Infinity;
  locations.forEach(function(loc) {
    if (!loc.lat || !loc.lng) return;
    var dist = drHaversineMeters(lat, lng, loc.lat, loc.lng);
    var radius = parseInt(loc.geofence_radius || defaultRadius);
    if (dist <= radius && dist < minDist) {
      minDist = dist;
      matched = loc;
    }
  });
  return matched;
}

function drHaversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2-lat1) * Math.PI/180;
  var dLng = (lng2-lng1) * Math.PI/180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Timeline render ───────────────────────────────────────────
function drRenderTimeline() {
  var el = document.getElementById('dr-timeline-col');
  if (!el) return;
  var dayReview = DRState.dayReviews.find(function(r) { return r.review_date === DRState.selectedDate; });
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  // Update last ping indicator
  var syncBadge = document.getElementById('dr-sync-badge');
  if (syncBadge && DRState.pings.length) {
    var lastPing = DRState.pings[DRState.pings.length - 1];
    var lastPingTime = new Date(lastPing.timestamp);
    var minutesAgo = Math.round((new Date() - lastPingTime) / 60000);
    var isToday = DRState.selectedDate === drTodayStr();
    if (isToday) {
      var pingColor = minutesAgo > 15 ? '#a32d2d' : minutesAgo > 5 ? '#854f0b' : '#3b6d11';
      syncBadge.innerHTML = '<span style="color:' + pingColor + ';font-size:11px">&#9679; GPS ' + (minutesAgo < 1 ? 'just now' : minutesAgo + 'm ago') + '</span>';
    } else {
      syncBadge.textContent = '';
    }
  }
  var html = '';

  // Clock in/out header bar
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;background:var(--bg)">';
  if (clockIn) {
    var workMin = clockOut ? Math.round((new Date(clockOut) - new Date(clockIn)) / 60000) : Math.round((new Date() - new Date(clockIn)) / 60000);
    html += '<button onclick="drEditClockIn()" style="font-size:12px;background:#eaf3de;color:#3b6d11;padding:5px 12px;border-radius:20px;font-weight:600;border:none;cursor:pointer">&#9679; In: ' + drFormatTime(clockIn) + (dayReview && dayReview.clock_in_backdated ? ' ✎' : '') + '</button>';
    if (clockOut) {
      html += '<button onclick="drEditClockOut()" style="font-size:12px;background:#fcebeb;color:#a32d2d;padding:5px 12px;border-radius:20px;font-weight:600;border:none;cursor:pointer">&#9679; Out: ' + drFormatTime(clockOut) + (dayReview && dayReview.clock_out_backdated ? ' ✎' : '') + '</button>';
      html += '<div style="font-size:11px;color:var(--text-muted)">' + drFormatDuration(workMin) + ' work window</div>';
    } else {
      html += '<button onclick="drEditClockOut()" style="font-size:12px;background:#a32d2d;color:#fff;padding:5px 12px;border-radius:20px;font-weight:600;border:none;cursor:pointer">Clock out</button>';
      html += '<div style="font-size:11px;color:var(--text-muted)">On clock — ' + drFormatDuration(workMin) + '</div>';
    }
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted)">Not clocked in</div>';
    html += '<button onclick="drEditClockIn()" style="margin-left:auto;font-size:12px;padding:5px 14px;background:#27ae60;color:#fff;border:none;border-radius:20px;cursor:pointer;font-weight:600">Clock in</button>';
  }
  html += '</div>';

  // Merge selected bar — visible when 2+ stops are checked
  var mergeCount = DRState.mergeSelected ? DRState.mergeSelected.length : 0;
  html += '<div style="padding:6px 14px;border-bottom:1px solid var(--border);background:#f1efff;align-items:center;gap:8px;display:' + (mergeCount >= 2 ? 'flex' : 'none') + '">';
  html += '<span style="font-size:12px;color:#534ab7;font-weight:600">' + mergeCount + ' stop' + (mergeCount !== 1 ? 's' : '') + ' selected</span>';
  html += '<button onclick="drMergeSelected()" style="padding:4px 14px;background:#534ab7;color:#fff;border:none;border-radius:var(--radius);font-size:12px;font-weight:600;cursor:pointer">Merge selected</button>';
  html += '<button onclick="DRState.mergeSelected=[];drRenderTimeline();" style="padding:4px 10px;background:none;border:1px solid #a89fe8;border-radius:var(--radius);font-size:12px;color:#534ab7;cursor:pointer">Clear</button>';
  html += '</div>';

  // If no clock in — show nothing else
  if (!clockIn) {
    html += '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Clock in to start tracking your work day.</div>';
    el.innerHTML = html;
    drRenderBottomStrip(dayReview);
    return;
  }

  // Filter stops to work window only — suppress secondary merged segments (not dismissed)
  var clockInTime = new Date(clockIn);
  var clockOutTime = clockOut ? new Date(clockOut) : new Date();
  var mergedSecondaryKeys = {};
  if (dayReview && dayReview.merged_stops) {
    var ms = [];
    try { ms = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
    if (!Array.isArray(ms)) ms = [];
    ms.forEach(function(m){ 
      (m.mergedSegments||[]).forEach(function(seg){ if (seg.arrivedAt) mergedSecondaryKeys[seg.arrivedAt] = true; });
      // Apply correct duration to primary stop
      var primaryStop = DRState.stops.find(function(s){ return s.arrivedAt === m.primaryArrivedAt; });
      if (primaryStop) {
        if (m.totalDurationMin) {
          primaryStop.durationMin = m.totalDurationMin;
        } else {
          var segTotal = (m.mergedSegments||[]).reduce(function(sum,seg){ return sum + (seg.durationMin||0); }, 0);
          primaryStop.durationMin = m.originalDurationMin + segTotal;
        }
        // v4.43 fix — extend leftAt to last merged segment so stop card time range is accurate
        // Reconciliation screen already did this; FTL was missing it causing display mismatch
        var lastSeg = (m.mergedSegments||[]).reduce(function(latest, seg) {
          return (!latest || new Date(seg.leftAt) > new Date(latest.leftAt)) ? seg : latest;
        }, null);
        if (lastSeg && new Date(lastSeg.leftAt) > new Date(primaryStop.leftAt)) {
          primaryStop.leftAt = lastSeg.leftAt;
        }
      }
    });
  }
  var workStops = DRState.stops.filter(function(s) {
    var arrived = new Date(s.arrivedAt);
    var left = new Date(s.leftAt);
    return left >= clockInTime && arrived <= clockOutTime && !mergedSecondaryKeys[s.arrivedAt];
  });

  if (!workStops.length && !DRState.pings.length) {
    html += '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No GPS data for ' + DRState.selectedDate + '</div>';
    el.innerHTML = html;
    drRenderBottomStrip(dayReview);
    return;
  }

  // Merge banners — detect from full stops array using workStop indices
  var mergeGroups = drDetectMergeGroups(DRState.stops, workStops);
  mergeGroups.forEach(function(group) {
    html += '<div data-merge-banner="' + group.locId + '">' + drRenderMergeBanner(group, DRState.stops) + '</div>';
  });

  // Clock in event
  html += '<div class="dr-punch"><div class="dr-punch-dot start" style="background:#27ae60"></div>';
  html += '<div style="font-size:12px;color:#3b6d11;font-weight:600">Clocked in</div>';
  html += '<div style="margin-left:auto;font-size:12px;font-weight:600">' + drFormatTime(clockIn) + (dayReview && dayReview.clock_in_backdated ? ' <span style="font-size:10px;color:var(--text-muted)">(adjusted)</span>' : '') + '</div></div>';

  workStops.forEach(function(stop, idx) {
    var isSelected = DRState.selectedStop === DRState.stops.indexOf(stop);
    var origIdx = DRState.stops.indexOf(stop);
    var hasAllocations = stop.allocations && stop.allocations.length > 0;
    var locName = stop.location ? stop.location.name : 'Unknown stop';
    var locType = stop.location ? (stop.location.location_type || 'untagged') : 'untagged';
    var isPendingLocation = stop.location && stop.location.status === 'pending';
    // Build customer subtitle for allocated stops
    var allocCustomers = '';
    if (hasAllocations) {
      var custNames = [];
      stop.allocations.forEach(function(a){ if (a.customerName && custNames.indexOf(a.customerName) < 0) custNames.push(a.customerName); });
      if (custNames.length) allocCustomers = custNames.join(', ');
    }
    var hasEntries = stop.hoursEntries.length > 0 || stop.allocations.length > 0;
    var totalAllocMin = stop.allocations.reduce(function(s,a){return s+(parseFloat(a.hours||0)*60);},0);
    var elapsedMin = drElapsedMin(stop);
    var underBilled = stop.location && locType === 'customer' && totalAllocMin > 0 && totalAllocMin < elapsedMin - 5;
    var overBilled = totalAllocMin > elapsedMin + 5;

    // Drive/gap segment before this stop
    // Use max(leftAt) of all prior stops — merged stops can have a later leftAt than stops
    // that appear after them in arrivedAt order (e.g. a merged Elementary Campus spanning
    // 10:41–4:07 wraps around a McDonald's lunch at 1:12–1:40). Using only the immediately
    // preceding card's leftAt would show 3h drive instead of ~33m.
    var prevStop = idx > 0 ? workStops[idx-1] : null;
    var prevTime = clockInTime;
    if (idx > 0) {
      for (var pi = 0; pi < idx; pi++) {
        var cand = new Date(workStops[pi].leftAt);
        if (cand > prevTime) prevTime = cand;
      }
    }
    var driveMin = Math.round((new Date(stop.arrivedAt) - prevTime) / 60000);
    if (driveMin > 0) {
      var driveCap = parseInt(AppState.settings.gps_drive_cap_minutes || '240');
      var isDataError = driveMin > driveCap && workStops.length <= 2;
      // Only call it a GPS gap if there are genuinely no pings in this window
      var windowStart = prevTime;
      var windowEnd = new Date(stop.arrivedAt);
      var pingsInWindow = (DRState.pings || []).filter(function(p){ var t = new Date(p.timestamp); return t >= windowStart && t <= windowEnd; });
      var isGpsGap = pingsInWindow.length === 0 && driveMin > parseInt(AppState.settings.gps_gap_threshold || '10');
      html += '<div class="dr-vline"></div>';
      if (isDataError) {
        html += '<div class="dr-drive"><span style="font-size:10px;color:#a32d2d">&#9888;</span><div class="dr-drive-line" style="border-color:#f09595"></div>';
        html += '<span class="dr-drive-label" style="color:#a32d2d">Data error &mdash; ' + drFormatDuration(driveMin) + '</span></div>';
      } else if (isGpsGap) {
        html += '<div class="dr-drive"><span style="font-size:10px;color:#854f0b">&#8943;</span><div class="dr-drive-line" style="border-color:#ef9f27"></div>';
        html += '<span class="dr-drive-label" style="color:#854f0b">GPS gap &mdash; ' + drFormatDuration(driveMin) + '</span></div>';
      } else {
        html += '<div class="dr-drive"><span style="font-size:10px;color:var(--text-muted)">&#9654;</span><div class="dr-drive-line"></div>';
        html += '<span class="dr-drive-label">' + drFormatDuration(driveMin) + ' drive</span></div>';
      }
      html += '<div class="dr-vline"></div>';
    }

    // Stop tile
    var isConfirmedMulti = stop.confirmedAccounts && stop.confirmedAccounts.length > 0;
    var isMultiAccount = stop.locationMatches && stop.locationMatches.length > 1 && !isConfirmedMulti;
    var isAllocated = hasEntries && !underBilled;
    var isNonBillable = stop.location && (locType === 'personal' || locType === 'office');
    // Check if this stop has a merge record
    var dayReviewForBadge = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
    var mergeListForBadge = [];
    if (dayReviewForBadge && dayReviewForBadge.merged_stops) {
      try { mergeListForBadge = typeof dayReviewForBadge.merged_stops === 'string' ? JSON.parse(dayReviewForBadge.merged_stops) : dayReviewForBadge.merged_stops; } catch(e){}
      if (!Array.isArray(mergeListForBadge)) mergeListForBadge = [];
    }
    var isMerged = mergeListForBadge.some(function(m){ return m.primaryArrivedAt === stop.arrivedAt; });
    var badgeCls = isConfirmedMulti ? 'ok' : !stop.location && !isMultiAccount ? 'warn' : isPendingLocation ? 'warn' : isMultiAccount ? 'warn' : underBilled ? 'err' : overBilled ? 'warn' : hasEntries ? 'ok' : 'gray';
    var badgeText = isConfirmedMulti ? 'Confirmed' : isMultiAccount ? 'Select account' : !stop.location ? 'Untagged' : isPendingLocation ? 'Pending review' : underBilled ? 'Under-billed' : overBilled ? 'Min applied' : hasEntries ? 'Allocated' : 'No entries';
    var locIcon = locType === 'customer' ? 'C' : locType === 'vendor' ? 'V' : locType === 'personal' ? 'P' : locType === 'office' ? 'O' : isConfirmedMulti ? 'M' : isMultiAccount ? '?' : '?';
    var icClass = locType === 'customer' ? 'job' : locType === 'vendor' ? 'vendor' : locType === 'personal' ? 'nonbill' : locType === 'office' ? 'nonbill' : isConfirmedMulti ? 'job' : 'untagged';
    // Grey out fully allocated stops, neutral for non-billable
    var cardOpacity = isAllocated ? '0.55' : '1';
    var cardBg = isAllocated ? 'background:var(--surface);opacity:' + cardOpacity + ';' : isNonBillable ? 'background:var(--surface);' : '';
    var cls = 'dr-stop' + (isSelected ? ' selected' : '') + (!stop.location && !isMultiAccount && !isConfirmedMulti ? ' untagged' : '');
    var isChecked = DRState.mergeSelected && DRState.mergeSelected.indexOf(stop.arrivedAt) >= 0;

    html += '<div class="' + cls + '" onclick="drSelectStop(' + origIdx + ')" style="' + cardBg + '">'; 
    html += '<div class="dr-stop-head">';
    html += '<input type="checkbox" class="dr-merge-check" data-arrived="' + stop.arrivedAt + '" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation();drToggleMergeSelect(\'' + stop.arrivedAt + '\',this.checked)" style="width:16px;height:16px;margin-right:6px;cursor:pointer;flex-shrink:0">';
    html += '<div class="dr-stop-ic ' + icClass + '">' + locIcon + '</div>';
    var displayName = isConfirmedMulti
      ? stop.confirmedAccounts.map(function(a){ return a.name; }).join(' + ')
      : isMultiAccount ? 'Multiple accounts at this location' : locName;
    html += '<div class="dr-stop-info"><div class="dr-stop-name">' + escHtml(displayName) + '</div>' +
      (allocCustomers ? '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' + escHtml(allocCustomers) + '</div>' : '');
    html += '<div class="dr-stop-time">' + drFormatTime(stop.arrivedAt) + ' &ndash; ' + drFormatTime(stop.leftAt) + ' &middot; ' + drFormatDuration(drElapsedMin(stop)) + '</div></div>';
    html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">';
    if (isMerged) html += '<div style="font-size:10px;font-weight:600;color:#534ab7;background:#f1efff;border:1px solid #a89fe8;border-radius:99px;padding:1px 7px;white-space:nowrap">&#8853; Merged</div>';
    html += '<div class="dr-stop-badge ' + badgeCls + '">' + badgeText + '</div>';
    html += '</div>';
    html += '</div>';

    if (isSelected) {
      html += '<div class="dr-stop-body">';
      if (!stop.location && !isMultiAccount) {
        html += DRState.identifyIdx === origIdx ? drRenderIdentifyForm(origIdx) : '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
          '<button onclick="event.stopPropagation();drStartIdentify(' + origIdx + ')" style="font-size:12px;padding:5px 12px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Identify this stop</button>' +
          '<button onclick="event.stopPropagation();drMarkNotBillable(' + origIdx + ')" style="font-size:12px;padding:5px 12px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Mark not billable</button>' +
          '</div>';
      } else if (!stop.location && isMultiAccount) {
        // Multi-account unresolved — v4.45 checkbox account selector
        if (isMerged) {
          var thisMergeRec = mergeListForBadge.find(function(m){ return m.primaryArrivedAt === stop.arrivedAt; });
          html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:var(--radius);padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
          html += '<span style="font-size:11px;color:#534ab7;font-weight:600">&#8853; Merged — ' + ((thisMergeRec && thisMergeRec.mergedSegments ? thisMergeRec.mergedSegments.length : 0) + 1) + ' segments combined</span>';
          html += '<button onclick="event.stopPropagation();tbUnmerge(\'' + stop.arrivedAt + '\')" style="margin-left:auto;font-size:11px;padding:3px 10px;background:#534ab7;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Undo merge</button>';
          html += '</div>';
        }
        html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">';
        html += '<div style="font-size:11px;font-weight:600;color:#534ab7;margin-bottom:10px">Which accounts did you work at this location?</div>';
        stop.locationMatches.forEach(function(loc, li) {
          var custObj = AppState.customers && AppState.customers.find(function(c){ return c.id === loc.customer_id; });
          var custName = loc.name || (custObj ? (custObj.display_name || custObj.name || '') : '');
          var cbId = 'dr-acct-cb-' + origIdx + '-' + li;
          html += '<label style="display:flex;align-items:center;gap:10px;padding:7px 8px;margin-bottom:4px;border:1px solid #c4bef0;border-radius:6px;cursor:pointer;background:var(--surface)">';
          html += '<input type="checkbox" id="' + cbId + '" checked style="width:16px;height:16px;cursor:pointer;flex-shrink:0" data-locid="' + loc.id + '" onclick="event.stopPropagation()">';
          html += '<span style="font-size:12px;font-weight:600;color:#534ab7">' + escHtml(custName) + '</span>';
          html += '</label>';
        });
        html += '<div style="display:flex;gap:6px;margin-top:10px">';
        html += '<button onclick="event.stopPropagation();drConfirmStopAccounts(' + origIdx + ')" style="font-size:12px;padding:6px 14px;background:#534ab7;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Confirm</button>';
        html += '<button onclick="event.stopPropagation();drStartIdentify(' + origIdx + ')" style="font-size:12px;padding:6px 10px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">None of these</button>';
        html += '<button onclick="event.stopPropagation();drMarkNotBillable(' + origIdx + ')" style="font-size:12px;padding:6px 10px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Mark not billable</button>';
        html += '</div>';
        html += '</div>';
      } else if (isConfirmedMulti) {
        // Multi-account confirmed — show confirmed accounts with Change option
        if (isMerged) {
          var thisMergeRec2 = mergeListForBadge.find(function(m){ return m.primaryArrivedAt === stop.arrivedAt; });
          html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:var(--radius);padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
          html += '<span style="font-size:11px;color:#534ab7;font-weight:600">&#8853; Merged — ' + ((thisMergeRec2 && thisMergeRec2.mergedSegments ? thisMergeRec2.mergedSegments.length : 0) + 1) + ' segments combined</span>';
          html += '<button onclick="event.stopPropagation();tbUnmerge(\'' + stop.arrivedAt + '\')" style="margin-left:auto;font-size:11px;padding:3px 10px;background:#534ab7;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Undo merge</button>';
          html += '</div>';
        }
        html += '<div style="background:#eaf3de;border:1px solid #7eb85a;border-radius:var(--radius);padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
        html += '<span style="font-size:11px;color:#3b6d11;font-weight:600">&#10003; ' + stop.confirmedAccounts.map(function(a){ return escHtml(a.name); }).join(' &amp; ') + '</span>';
        html += '<button onclick="event.stopPropagation();drClearStopAccounts(' + origIdx + ')" style="margin-left:auto;font-size:11px;padding:3px 8px;background:none;border:1px solid #7eb85a;border-radius:var(--radius);color:#3b6d11;cursor:pointer">Change</button>';
        html += '</div>';
      } else {
        var addr = [stop.location.address_street, stop.location.city, stop.location.state].filter(Boolean).join(', ');
        if (addr) html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">' + escHtml(addr) + '</div>';
        // Pending location warning
        if (isPendingLocation) {
          html += '<div style="background:#faeeda;border:1px solid #ef9f27;border-radius:var(--radius);padding:6px 10px;margin-bottom:8px;font-size:11px;color:#854f0b">&#9888; Location pending review — approve in Location Manager before submitting day.</div>';
        }
        // Merged time banner
        var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
        if (dayReview && dayReview.merged_stops) {
          var mergedList = [];
          try { mergedList = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
          if (!Array.isArray(mergedList)) mergedList = [];
          var mergeRec = mergedList.find(function(m){ return m.primaryArrivedAt === stop.arrivedAt; });
          if (mergeRec) {
            html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:var(--radius);padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
            html += '<span style="font-size:11px;color:#534ab7;font-weight:600">&#8853; Merged — ' + (mergeRec.mergedSegments.length + 1) + ' segments combined</span>';
            html += '<button onclick="event.stopPropagation();tbUnmerge(\'' + stop.arrivedAt + '\')" style="margin-left:auto;font-size:11px;padding:3px 10px;background:#534ab7;color:#fff;border:none;border-radius:var(--radius);cursor:pointer">Undo merge</button>';
            html += '</div>';
          }
        }
        if (stop.locationMatches && stop.locationMatches.length > 1 && stop.location) {
          // Account selected — show confirmation with change option
          var selWO = stop.selectedWOId ? (AppState.workOrders||[]).find(function(w){ return w.id === stop.selectedWOId; }) : null;
          html += '<div style="background:#f1efff;border:1px solid #a89fe8;border-radius:var(--radius);padding:7px 9px;margin-bottom:8px">';
          html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (selWO ? '4px' : '0') + '">';
          html += '<span style="font-size:11px;color:#534ab7;font-weight:600">&#10003; ' + escHtml(stop.location.name) + '</span>';
          html += '<button onclick="event.stopPropagation();drClearStopLocation(' + origIdx + ')" style="margin-left:auto;font-size:11px;padding:3px 8px;background:none;border:1px solid #a89fe8;border-radius:var(--radius);color:#534ab7;cursor:pointer">Change</button>';
          html += '</div>';
          if (selWO) {
            html += '<div style="font-size:11px;color:var(--text-secondary)">WO: ' + escHtml(selWO.wo_number) + ' — ' + escHtml(selWO.title||'') + '</div>';
          }
          html += '</div>';
        }
        if (stop.allocations.length) {
          var totalAlloc = stop.allocations.reduce(function(s,a){return s+parseFloat(a.hours||0);},0);
          var gpsH = (drElapsedMin(stop)/60);
          var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);
          var hasTM = stop.allocations.some(function(a){ return a.formMode !== 'quoted'; });
          var hasQuoted = stop.allocations.some(function(a){ return a.formMode === 'quoted'; });
          if (hasTM && hasQuoted) {
            html += '<div style="font-size:11px;padding:5px 8px;background:#faeeda;color:#854f0b;border-radius:var(--radius);margin-bottom:6px;border:1px solid #ef9f27">&#9888; This location has both T&M and quoted work orders — make sure T&M time is billed correctly.</div>';
          }
          html += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">Billing breakdown:</div>';
          html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:6px">';
          html += '<tr><th style="text-align:left;padding:3px 0;color:var(--text-muted);border-bottom:1px solid var(--border)">Customer</th><th style="text-align:left;padding:3px 4px;color:var(--text-muted);border-bottom:1px solid var(--border)">WO</th><th style="padding:3px 4px;color:var(--text-muted);border-bottom:1px solid var(--border);text-align:right">Hours</th></tr>';
          stop.allocations.forEach(function(a) {
            var effHours = parseFloat(a.hours||0);
            var belowMin = effHours > 0 && effHours < minBilling;
            var isQuoted = a.formMode === 'quoted';
            var modeBadge = isQuoted ? '<span style="font-size:9px;padding:1px 5px;background:#eaf3de;color:#3b6d11;border-radius:99px;margin-left:4px;font-weight:600">Quoted</span>' : '<span style="font-size:9px;padding:1px 5px;background:#e6f1fb;color:#185fa5;border-radius:99px;margin-left:4px;font-weight:600">T&M</span>';
            html += '<tr><td style="padding:3px 0;font-weight:600">' + escHtml(a.customerName||'—') + '</td>';
            html += '<td style="padding:3px 4px;font-size:10px;color:var(--text-muted)">' + escHtml(a.woNumber||'') + modeBadge + '</td>';
            html += '<td style="padding:3px 4px;text-align:right;font-weight:600">' + effHours.toFixed(2) + 'h' + (belowMin ? ' <span style="color:#854f0b;font-size:9px">(min ' + minBilling + 'h)</span>' : '') + '</td></tr>';
          });
          html += '</table>';
          var diff = totalAlloc - gpsH;
          if (Math.abs(diff) > 0.08) {
            html += '<div style="font-size:11px;margin-bottom:6px">' + (diff < 0 ? '<span style="color:#a32d2d">&#9888; ' + Math.abs(diff).toFixed(2) + 'h under GPS time</span>' : '<span style="color:#854f0b">&#9888; ' + diff.toFixed(2) + 'h over GPS time</span>') + '</div>';
          }
        }
        html += '<button onclick="event.stopPropagation();drStartAllocate(' + origIdx + ')" style="font-size:12px;padding:5px 12px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer">';
        html += stop.allocations.length ? 'Edit allocation' : 'Allocate time';
        html += '</button>';
        // Billable/Paid stop-level flags
        var stopFlagKey = stop.arrivedAt;
        var stopFlags = DRState.stopFlags || {};
        var flagData = stopFlags[stopFlagKey] || {};
        var sfBillable = flagData.billable !== undefined ? flagData.billable : (locType === 'customer');
        var sfPaid = flagData.paid !== undefined ? flagData.paid : true;
        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<div onclick="event.stopPropagation();drToggleStopFlag(' + origIdx + ',\'billable\')" style="flex:1;padding:5px;border-radius:var(--radius);font-size:11px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (sfBillable?'#e6f1fb;color:#185fa5':'var(--surface);color:var(--text-muted)') + '">' + (sfBillable?'&#10003; Billable':'Non-billable') + '</div>';
        html += '<div onclick="event.stopPropagation();drToggleStopFlag(' + origIdx + ',\'paid\')" style="flex:1;padding:5px;border-radius:var(--radius);font-size:11px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (sfPaid?'#eaf3de;color:#3b6d11':'var(--surface);color:var(--text-muted)') + '">' + (sfPaid?'&#10003; Paid':'Unpaid') + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  });

  // Clock out event
  html += '<div class="dr-vline"></div>';
  if (clockOut) {
    html += '<div class="dr-punch"><div class="dr-punch-dot end" style="background:#a32d2d"></div>';
    html += '<div style="font-size:12px;color:#a32d2d;font-weight:600">Clocked out</div>';
    html += '<div style="margin-left:auto;font-size:12px;font-weight:600">' + drFormatTime(clockOut) + (dayReview && dayReview.clock_out_backdated ? ' <span style="font-size:10px;color:var(--text-muted)">(adjusted)</span>' : '') + '</div></div>';
  } else {
    html += '<div class="dr-punch"><div class="dr-punch-dot end" style="background:var(--text-muted)"></div>';
    html += '<div style="font-size:12px;color:var(--text-muted)">Still on clock</div>';
    html += '<div style="margin-left:auto"><button onclick="drEditClockOut()" style="font-size:11px;padding:3px 12px;background:#a32d2d;color:#fff;border:none;border-radius:12px;cursor:pointer">Clock out</button></div></div>';
  }

  html += '</div>';
  el.innerHTML = html;
  drRenderBottomStrip(dayReview);
  // In reconcile mode, refresh billing column after timeline renders
  if (DRState.mode === 'reconcile') drLoadBillingCol();
}

// ── Bottom strip ──────────────────────────────────────────────
function drEditClockIn() {
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate; });
  var existing = dayReview && dayReview.clock_in ? new Date(dayReview.clock_in).toTimeString().substring(0,5) : '';
  var techSchedule = AppState._techSchedules ? (AppState._techSchedules[DRState.tech] || []) : [];
  var dow = new Date(DRState.selectedDate).getDay();
  var sched = techSchedule.find(function(s){ return s.day_of_week === dow; });
  var schedStr = sched ? (sched.expected_start||'').substring(0,5) : '';
  var now = new Date();
  var nowStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var defaultVal = existing || schedStr || nowStr;
  var time = prompt('Clock-in time' + (schedStr ? ' (scheduled: ' + schedStr + ')' : '') + ':', defaultVal);
  if (!time) return;
  var dt = new Date(DRState.selectedDate + 'T' + time + ':00');
  drUpsertDayReview({
    clock_in: dt.toISOString(),
    clock_in_backdated: time !== nowStr,
    clock_in_source: AppState.userRole === 'admin' && DRState.tech !== AppState.userId ? 'admin' : 'manual'
  });
}

function drEditClockOut() {
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate; });
  var existing = dayReview && dayReview.clock_out ? new Date(dayReview.clock_out).toTimeString().substring(0,5) : '';
  var now = new Date();
  var nowStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var defaultVal = existing || nowStr;
  var time = prompt('Clock-out time:', defaultVal);
  if (!time) return;
  var dt = new Date(DRState.selectedDate + 'T' + time + ':00');
  drUpsertDayReview({
    clock_out: dt.toISOString(),
    clock_out_backdated: time !== nowStr,
    clock_out_source: AppState.userRole === 'admin' && DRState.tech !== AppState.userId ? 'admin' : 'manual'
  });
}

function drUpsertDayReview(updates) {
  updates.modified_by = AppState.userEmail;
  updates.modified_at = new Date().toISOString();
  var existing = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate; });
  if (existing) {
    sb.patch('day_review', existing.id, updates).then(function(r){
      if (r.ok) {
        Object.assign(existing, updates);
        drRenderTimeline();
        if (typeof drRenderWeekBar === 'function') drRenderWeekBar();
        showToast('Punch saved');
      } else showToast('Error saving punch');
    });
  } else {
    var newRecord = Object.assign({ tech_id: DRState.tech, review_date: DRState.selectedDate, status:'pending', sync_status:'pending', created_by: AppState.userEmail }, updates);
    sb.post('day_review', newRecord).then(function(r){
      if (r.ok && r.data && r.data.length) {
        DRState.dayReviews.push(r.data[0]);
        drRenderTimeline();
        if (typeof drRenderWeekBar === 'function') drRenderWeekBar();
        showToast('Punch saved');
      } else showToast('Error saving punch');
    });
  }
}

function drRenderBottomStrip(dayReview) {
  var el = document.getElementById('dr-bottom');
  if (!el) return;
  var dayStatus = dayReview ? dayReview.status : 'none';
  var totalGPSMin = DRState.stops.reduce(function(s,st){return s+drElapsedMin(st);},0);
  var totalBilledH = DRState.hoursEntries.reduce(function(s,e){return s+parseFloat(e.hours||0);},0);
  var openItems = DRState.stops.filter(function(s){return !s.location;}).length;
  var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);

  var html = '';

  // Stats
  html += '<div style="display:flex;gap:16px;flex:1">';
  html += '<div style="text-align:center"><div style="font-size:16px;font-weight:700">' + drFormatDuration(totalGPSMin) + '</div><div style="font-size:10px;color:var(--text-muted)">Elapsed</div></div>';
  html += '<div style="text-align:center;border-left:1px solid var(--border);padding-left:16px"><div style="font-size:16px;font-weight:700">' + totalBilledH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
  html += '<div style="text-align:center;border-left:1px solid var(--border);padding-left:16px"><div style="font-size:16px;font-weight:700' + (openItems>0?';color:#854f0b':'') + '">' + openItems + '</div><div style="font-size:10px;color:var(--text-muted)">Untagged</div></div>';
  html += '<div style="text-align:center;border-left:1px solid var(--border);padding-left:16px"><div style="font-size:16px;font-weight:700">' + DRState.stops.length + '</div><div style="font-size:10px;color:var(--text-muted)">Stops</div></div>';
  html += '</div>';

  // Day status
  var statusColor = dayStatus==='accepted'?'#3b6d11':dayStatus==='kicked_back'?'#a32d2d':dayStatus==='submitted'||dayStatus==='ready'?'#854f0b':'var(--text-muted)';
  html += '<div style="font-size:11px;color:' + statusColor + ';border-left:1px solid var(--border);padding-left:12px">Status: ' + (dayStatus||'no record') + '</div>';

  // Action buttons — admin only
  if (AppState.userRole === 'admin') {
    var canAccept = (dayStatus === 'ready' || dayStatus === 'submitted' || dayStatus === 'none') && openItems === 0;
    var selectedTech = AppState.technicians.find(function(t){return t.id===DRState.tech;});
    var techName = selectedTech ? selectedTech.name : 'tech';
    var isOwnDay = DRState.tech === AppState.userId || (selectedTech && selectedTech.name && AppState.userEmail && selectedTech.name.toLowerCase().indexOf(AppState.userEmail.split('@')[0].toLowerCase()) >= 0);

    if (dayStatus === 'accepted') {
      html += '<button onclick="drReopenDay()" style="padding:7px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer;font-size:12px">Re-open</button>';
    } else {
      html += '<button onclick="drAcceptDay()" ' + (!canAccept?'disabled':'') + ' style="padding:7px 14px;background:' + (canAccept?'#27ae60':'var(--surface)') + ';color:' + (canAccept?'#fff':'var(--text-muted)') + ';border:1px solid ' + (canAccept?'#27ae60':'var(--border)') + ';border-radius:var(--radius);cursor:' + (canAccept?'pointer':'not-allowed') + ';font-size:12px;font-weight:600">Accept day</button>';
      if (!isOwnDay) {
        html += '<button onclick="drKickBack()" style="padding:7px 14px;border:1px solid #e24b4a;border-radius:var(--radius);background:var(--surface);color:#a32d2d;cursor:pointer;font-size:12px">Kick back to ' + escHtml(techName.split(' ')[0]) + '</button>';
      }
    }
    if (!canAccept && openItems > 0) {
      html += '<div style="font-size:11px;color:#854f0b">&#9888; ' + openItems + ' untagged stop' + (openItems>1?'s':'') + '</div>';
    }
  }

  el.innerHTML = html;
}

// ── Stop selection ────────────────────────────────────────────
// ── Identify Stop ─────────────────────────────────────────────
function drClearStopLocation(idx) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  stop.location = null;
  drRenderTimeline();
}

// drConfirmStopAccounts — v4.45
// Reads checkboxes from the multi-account picker, saves selected account IDs
// as an array to day_review.stop_locations, sets stop.confirmedAccounts
function drConfirmStopAccounts(idx) {
  var stop = DRState.stops[idx];
  if (!stop || !stop.locationMatches) return;
  // Collect checked location IDs from rendered checkboxes
  var checkboxes = document.querySelectorAll('[id^="dr-acct-cb-' + idx + '-"]');
  var selectedIds = [];
  checkboxes.forEach(function(cb) {
    if (cb.checked) selectedIds.push(cb.getAttribute('data-locid'));
  });
  if (!selectedIds.length) {
    showToast('Please select at least one account');
    return;
  }
  var matched = selectedIds.map(function(id) {
    return stop.locationMatches.find(function(l){ return l.id === id; });
  }).filter(Boolean);
  stop.confirmedAccounts = matched;
  stop.location = matched[0]; // primary for compat
  stop.isBillable = matched[0] && matched[0].billable_default !== false;
  // Save array to Supabase
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    var stopLocs = dayReview.stop_locations ? JSON.parse(typeof dayReview.stop_locations === 'string' ? dayReview.stop_locations : JSON.stringify(dayReview.stop_locations)) : {};
    if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) stopLocs = {};
    stopLocs[stop.arrivedAt] = selectedIds.length === 1 ? selectedIds[0] : selectedIds;
    sb.patch('day_review', dayReview.id, {
      stop_locations: stopLocs,
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    }).then(function(r) {
      if (r.ok) {
        dayReview.stop_locations = stopLocs;
        showToast('Account' + (selectedIds.length > 1 ? 's' : '') + ' confirmed');
      } else showToast('Error saving accounts');
    });
  } else {
    showToast('Account' + (selectedIds.length > 1 ? 's' : '') + ' confirmed');
  }
  drRenderTimeline();
}

// drClearStopAccounts — v4.45
// Clears confirmed multi-account selection, returns stop to unresolved state
function drClearStopAccounts(idx) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  stop.confirmedAccounts = null;
  stop.location = null;
  stop.selectedWOId = null;
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    var stopLocs = dayReview.stop_locations ? JSON.parse(typeof dayReview.stop_locations === 'string' ? dayReview.stop_locations : JSON.stringify(dayReview.stop_locations)) : {};
    if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) stopLocs = {};
    delete stopLocs[stop.arrivedAt];
    sb.patch('day_review', dayReview.id, {
      stop_locations: stopLocs,
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    }).then(function(r) {
      if (r.ok) dayReview.stop_locations = stopLocs;
    });
  }
  drRenderTimeline();
}

function drSaveStopLocation(idx) {
  var stop = DRState.stops[idx];
  if (!stop || !stop.location) return;
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (!dayReview) return;
  var stopLocs = dayReview.stop_locations ? JSON.parse(typeof dayReview.stop_locations === 'string' ? dayReview.stop_locations : JSON.stringify(dayReview.stop_locations)) : {};
  if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) stopLocs = {};
  stopLocs[stop.arrivedAt] = stop.location.id;
  sb.patch('day_review', dayReview.id, {
    stop_locations: stopLocs,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      dayReview.stop_locations = stopLocs;
      showToast('Location saved — ' + stop.location.name);
      drRenderTimeline();
    } else showToast('Error saving location');
  });
}

function drSelectStopLocation(idx, locId, woId) {
  var stop = DRState.stops[idx];
  if (!stop || !stop.locationMatches) return;
  var chosen = stop.locationMatches.find(function(l){ return l.id === locId; });
  if (!chosen) return;
  stop.location = chosen;
  stop.selectedWOId = woId || null;
  stop.isBillable = chosen.billable_default !== false;
  // Save to Supabase immediately — don't require a separate Save button
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    var stopLocs = dayReview.stop_locations ? JSON.parse(typeof dayReview.stop_locations === 'string' ? dayReview.stop_locations : JSON.stringify(dayReview.stop_locations)) : {};
    if (!stopLocs || typeof stopLocs !== 'object' || Array.isArray(stopLocs)) stopLocs = {};
    stopLocs[stop.arrivedAt] = locId;
    sb.patch('day_review', dayReview.id, {
      stop_locations: stopLocs,
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    }).then(function(r) {
      if (r.ok) {
        dayReview.stop_locations = stopLocs;
        showToast(chosen.name + (woId ? ' \u2014 WO selected' : ' selected'));
      } else showToast('Error saving location');
    });
  } else {
    showToast(chosen.name + ' selected');
  }
  drRenderTimeline();
}

function drStartNewWOForAccount(customerId) {
  // Navigate to new WO form with customer pre-selected
  var cust = AppState.customers && AppState.customers.find(function(c){ return c.id === customerId; });
  AppState.editingWOId = null;
  AppState.currentWO = null;
  AppState.newWOPrefilledCustomer = cust || null;
  pushScreen('screen-wo-form', 'New Work Order');
  setTimeout(function() {
    // Pre-fill customer field if the form is rendered
    var custInput = document.getElementById('wo-customer-search');
    if (custInput && cust) {
      custInput.value = cust.display_name || cust.name || '';
      AppState.selectedCustomerId = customerId;
    }
  }, 150);
}


function drStartIdentify(idx) {
  DRState.identifyIdx = idx;
  DRState.identifyStep = 'type';
  drRenderTimeline();
}

function drIdentifyTypeSelect(type) {
  DRState.identifyType = type;
  DRState.identifyStep = 'entity';
  drRenderTimeline();
}

function drIdentifySearch(val) {
  var el = document.getElementById('dr-identify-results');
  if (!el) return;
  var q = val.toLowerCase().trim();
  var type = DRState.identifyType;
  var results = [];
  if (type === 'customer') {
    results = AppState.customers.filter(function(c) {
      return c.qbo_customer_id !== 'SYSTEM' && c.active !== false && (!q || (c.name||'').toLowerCase().indexOf(q) >= 0 || (c.display_name||'').toLowerCase().indexOf(q) >= 0);
    }).slice(0, 8);
  } else if (type === 'vendor') {
    results = AppState.vendors.filter(function(v) {
      return !q || (v.name||'').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
  }
  if (!results.length && q) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No matches — will save as new location</div>';
    return;
  }
  var html = '';
  results.forEach(function(r) {
    var name = r.display_name || r.name || '';
    html += '<div onclick="event.stopPropagation();drIdentifySelectEntity(\'' + escHtml(r.id) + '\',\'' + escHtml(name.replace(/'/g,'\\\'')) + '\')" style="padding:6px 8px;cursor:pointer;border-radius:var(--radius);font-size:12px;border:0.5px solid var(--border);margin-bottom:3px;background:var(--surface)">' + escHtml(name) + '</div>';
  });
  el.innerHTML = html;
}

function drIdentifySelectEntity(id, name) {
  DRState.identifyEntityId = id;
  DRState.identifyEntityName = name;
  var nameEl = document.getElementById('dr-identify-name');
  if (nameEl) nameEl.value = name;
  var resultsEl = document.getElementById('dr-identify-results');
  if (resultsEl) resultsEl.innerHTML = '<div style="font-size:12px;color:#3b6d11;padding:4px 0">&#10003; ' + escHtml(name) + ' selected</div>';
}

function drSaveIdentify() {
  var idx = DRState.identifyIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  var type = DRState.identifyType;
  var nameEl = document.getElementById('dr-identify-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { showToast('Please enter a location name'); return; }

  var payload = {
    name: name,
    location_type: type,
    lat: stop.lat,
    lng: stop.lng,
    geocode_status: 'approximate',
    status: 'pending',
    identified_from_stop: true,
    billable_default: type !== 'personal' && type !== 'office',
    active: true,
    is_primary: true,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  };
  if (type === 'customer' && DRState.identifyEntityId) payload.customer_id = DRState.identifyEntityId;
  if (type === 'vendor' && DRState.identifyEntityId) payload.vendor_id = DRState.identifyEntityId;

  sb.post('locations', payload).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      var newLoc = r.data[0];
      // Add to in-memory locations so stop re-matches immediately
      if (!AppState._allLocations) AppState._allLocations = [];
      AppState._allLocations.push(newLoc);
      DRState.locations = DRState.locations || [];
      DRState.locations.push(newLoc);
      // Re-associate this stop with the new location
      stop.location = newLoc;
      DRState.identifyIdx = null;
      DRState.identifyStep = null;
      DRState.identifyType = null;
      DRState.identifyEntityId = null;
      DRState.identifyEntityName = null;
      showToast('Location saved — pending review');
      drRenderTimeline();
    } else {
      showToast('Error saving location');
    }
  });
}

function drToggleStopFlag(idx, flag) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  var key = stop.arrivedAt;
  if (!DRState.stopFlags[key]) DRState.stopFlags[key] = {};
  var current = DRState.stopFlags[key][flag];
  var defaultVal = flag === 'billable' ? (stop.location && stop.location.location_type === 'customer') : true;
  DRState.stopFlags[key][flag] = current !== undefined ? !current : !defaultVal;
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    sb.patch('day_review', dayReview.id, {
      stop_flags: DRState.stopFlags,
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    });
  }
  drRenderTimeline();
}

function drLoadStopFlags(dayReview) {
  if (dayReview && dayReview.stop_flags) {
    try {
      DRState.stopFlags = typeof dayReview.stop_flags === 'string' ? JSON.parse(dayReview.stop_flags) : dayReview.stop_flags;
    } catch(e) { DRState.stopFlags = {}; }
  } else {
    DRState.stopFlags = {};
  }
}

function drMarkNotBillable(idx) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (!dayReview) return;
  // Mark stop as non-billable in stop_flags
  var stopFlags = dayReview.stop_flags ? JSON.parse(typeof dayReview.stop_flags === 'string' ? dayReview.stop_flags : JSON.stringify(dayReview.stop_flags)) : {};
  if (typeof stopFlags !== 'object' || Array.isArray(stopFlags)) stopFlags = {};
  var key = stop.arrivedAt;
  stopFlags[key] = { billable: false, paid: false };
  stop.isBillable = false;
  stop.isPaid = false;
  sb.patch('day_review', dayReview.id, {
    stop_flags: stopFlags,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      dayReview.stop_flags = stopFlags;
      DRState.stopFlags = stopFlags;
      // Prompt to save location for future auto-recognition
      var saveEl = document.getElementById('dr-notbillable-save-' + idx);
      if (saveEl) saveEl.style.display = 'block';
      showToast('Stop marked not billable');
      drRenderTimeline();
    }
  });
}

function mdrMarkNotBillable(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var dayReview = MDRState.currentDayReview;
  if (!dayReview) return;
  var stopFlags = dayReview.stop_flags ? JSON.parse(typeof dayReview.stop_flags === 'string' ? dayReview.stop_flags : JSON.stringify(dayReview.stop_flags)) : {};
  if (typeof stopFlags !== 'object' || Array.isArray(stopFlags)) stopFlags = {};
  var key = stop.arrivedAt;
  stopFlags[key] = { billable: false, paid: false };
  stop.isBillable = false;
  stop.isPaid = false;
  sb.patch('day_review', dayReview.id, {
    stop_flags: stopFlags,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      dayReview.stop_flags = stopFlags;
      showToast('Stop marked not billable');
      mdrRenderDay(null);
    }
  });
}

function drCancelIdentify() {
  DRState.identifyIdx = null;
  DRState.identifyStep = null;
  DRState.identifyType = null;
  DRState.identifyEntityId = null;
  DRState.identifyEntityName = null;
  drRenderTimeline();
}

function drRenderIdentifyForm(idx) {
  var step = DRState.identifyStep;
  var type = DRState.identifyType;
  var html = '<div style="padding:10px 0">';

  if (step === 'type') {
    html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">What type of location is this?</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    var types = [{k:'customer',l:'Customer'},{k:'vendor',l:'Vendor'},{k:'personal',l:'Personal'},{k:'office',l:'Office'},{k:'other',l:'Other'}];
    types.forEach(function(t) {
      var bg = t.k==='customer'?'#e6f1fb':t.k==='vendor'?'#eaf3de':t.k==='personal'?'#faeeda':t.k==='office'?'#f1efff':'var(--surface)';
      var col = t.k==='customer'?'#185fa5':t.k==='vendor'?'#3b6d11':t.k==='personal'?'#854f0b':t.k==='office'?'#534ab7':'var(--text-secondary)';
      html += '<button onclick="event.stopPropagation();drIdentifyTypeSelect(\'' + t.k + '\')" style="font-size:12px;padding:5px 14px;background:' + bg + ';color:' + col + ';border:1px solid ' + col + ';border-radius:99px;cursor:pointer;font-weight:600">' + t.l + '</button>';
    });
    html += '</div>';
  } else if (step === 'entity') {
    var label = type === 'customer' ? 'Which customer?' : type === 'vendor' ? 'Which vendor?' : type === 'personal' ? 'Name this location' : 'Name this location';
    html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">' + label + '</div>';
    if (type === 'customer' || type === 'vendor') {
      html += '<input type="text" id="dr-identify-search" placeholder="Search ' + type + 's..." oninput="drIdentifySearch(this.value)" onclick="event.stopPropagation()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box;margin-bottom:6px">';
      html += '<div id="dr-identify-results" style="margin-bottom:6px"></div>';
    }
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Location name</div>';
    html += '<input type="text" id="dr-identify-name" placeholder="e.g. Grace Presbyterian Church" onclick="event.stopPropagation()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box;margin-bottom:8px">';
    if (type === 'personal') {
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Personal stops default to non-billable time.</div>';
    }
    html += '<div style="display:flex;gap:6px">';
    html += '<button onclick="event.stopPropagation();drCancelIdentify()" style="font-size:12px;padding:5px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Cancel</button>';
    html += '<button onclick="event.stopPropagation();drSaveIdentify()" style="font-size:12px;padding:5px 14px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">Save location</button>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function drToggleMergeSelect(arrivedAt, checked) {
  // v4.42 fix — was looking for 'dr-merge-selected-btn' which doesn't exist in DOM
  // merge bar is baked into timeline HTML, must re-render to show/hide it
  if (!DRState.mergeSelected) DRState.mergeSelected = [];
  if (checked) {
    if (DRState.mergeSelected.indexOf(arrivedAt) < 0) DRState.mergeSelected.push(arrivedAt);
  } else {
    DRState.mergeSelected = DRState.mergeSelected.filter(function(a){ return a !== arrivedAt; });
  }
  drRenderTimeline();
}

function drMergeSelected() {
  if (!DRState.mergeSelected || DRState.mergeSelected.length < 2) { showToast('Select at least 2 stops to merge'); return; }
  var selectedStops = DRState.stops.filter(function(s){ return DRState.mergeSelected.indexOf(s.arrivedAt) >= 0; });
  if (selectedStops.length < 2) { showToast('Could not find selected stops'); return; }
  // Sort by arrivedAt
  selectedStops.sort(function(a,b){ return new Date(a.arrivedAt) - new Date(b.arrivedAt); });
  var primary = selectedStops[0];
  var totalMin = selectedStops.reduce(function(sum,s){ return sum + s.durationMin; }, 0);
  if (!confirm('Merge ' + selectedStops.length + ' stops into one? Combined duration: ' + drFormatDuration(totalMin))) return;

  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (!dayReview) { showToast('Day record not found'); return; }

  var mergedList = [];
  try { mergedList = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
  if (!Array.isArray(mergedList)) mergedList = [];

  var mergedSegments = selectedStops.slice(1).map(function(s){
    return { arrivedAt: s.arrivedAt, leftAt: s.leftAt, durationMin: s.durationMin };
  });

  var mergeRec = {
    primaryArrivedAt: primary.arrivedAt,
    mergedSegments: mergedSegments,
    originalDurationMin: primary.durationMin,
    totalDurationMin: totalMin,
    mergedAt: new Date().toISOString()
  };

  // Remove any existing merge records for these stops
  mergedList = mergedList.filter(function(m){
    return DRState.mergeSelected.indexOf(m.primaryArrivedAt) < 0;
  });
  mergedList.push(mergeRec);

  sb.patch('day_review', dayReview.id, {
    merged_stops: mergedList,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      dayReview.merged_stops = mergedList;
      DRState.mergeSelected = [];
      showToast('Stops merged');
      drLoadDay(DRState.selectedDate);
    } else showToast('Error saving merge');
  });
}

function drSelectStop(idx) {
  DRState.selectedStop = DRState.selectedStop === idx ? null : idx;
  drCloseTagOverlay();
  drRenderTimeline();
  if (DRState.mapReady && DRState.selectedStop !== null) {
    var stop = DRState.stops[DRState.selectedStop];
    if (stop && stop.lat && stop.lng) {
      DRState.map.panTo({lat: stop.lat, lng: stop.lng});
      DRState.map.setZoom(15);
    }
  }
}

// ── Map ───────────────────────────────────────────────────────
function drInitMap() {
  if (typeof google === 'undefined' || !google.maps) {
    locLoadMapsAPI(function(){ drInitMap(); });
    return;
  }
  var mapEl = document.getElementById('dr-map');
  if (!mapEl) return;

  // Center on first stop, or first ping, or default
  var center = DRState.stops.length
    ? {lat: DRState.stops[0].lat, lng: DRState.stops[0].lng}
    : DRState.pings.length
    ? {lat: DRState.pings[0].lat, lng: DRState.pings[0].lng}
    : {lat: 38.77, lng: -75.14};

  if (!DRState.map) {
    DRState.map = new google.maps.Map(mapEl, {
      zoom: 11,
      center: center,
      mapTypeControl: true,
      mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU },
      streetViewControl: false,
      fullscreenControl: false
    });
    DRState.infoWindow = new google.maps.InfoWindow();
    DRState.mapReady = true;
  }

  drRenderMapTrail();
}

function drRenderMapTrail() {
  if (!DRState.mapReady) return;

  // Clear existing
  if (DRState.trail) DRState.trail.setMap(null);
  DRState.stopMarkers.forEach(function(m){ m.setMap(null); });
  DRState.stopMarkers = [];

  if (!DRState.pings.length) return;

  // Breadcrumb polyline
  var path = DRState.pings.map(function(p){ return {lat: p.lat, lng: p.lng}; });
  DRState.trail = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: '#378ADD',
    strokeOpacity: 0.5,
    strokeWeight: 2,
    map: DRState.map
  });

  // Stop markers
  var bounds = new google.maps.LatLngBounds();
  DRState.stops.forEach(function(stop, idx) {
    bounds.extend({lat: stop.lat, lng: stop.lng});
    var isUnknown = !stop.location;
    var color = isUnknown ? '#BA7517' : stop.location.location_type === 'vendor' ? '#639922' : '#378ADD';
    var marker = new google.maps.Marker({
      position: {lat: stop.lat, lng: stop.lng},
      map: DRState.map,
      title: stop.location ? stop.location.name : 'Unknown stop',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: DRState.selectedStop === idx ? 11 : 8,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      }
    });
    marker.addListener('click', function(){
      drSelectStop(idx);
      DRState.infoWindow.setContent(
        '<div style="font-size:12px;font-weight:600">' + escHtml(stop.location ? stop.location.name : 'Unknown stop') + '</div>' +
        '<div style="font-size:11px;color:#666">' + drFormatTime(stop.arrivedAt) + ' &ndash; ' + drFormatTime(stop.leftAt) + ' &middot; ' + drFormatDuration(drElapsedMin(stop)) + '</div>'
      );
      DRState.infoWindow.open(DRState.map, marker);
    });
    DRState.stopMarkers.push(marker);
  });

  DRState.pings.forEach(function(p){ bounds.extend({lat:p.lat,lng:p.lng}); });
  if (DRState.stops.length > 0) DRState.map.fitBounds(bounds);
}

// ── Tag overlay ───────────────────────────────────────────────
function drStartTagStop(idx) {
  DRState.tagStopIdx = idx;
  DRState.tagStep = 1;
  drRenderTagOverlay();
}

function drStartAllocate(idx) {
  DRState.tagStopIdx = idx;
  drOpenAllocPanel(idx);
}

function drOpenAllocPanel(idx) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  var panel = document.getElementById('dr-alloc-panel');
  var title = document.getElementById('dr-alloc-panel-title');
  var gpsSum = document.getElementById('dr-alloc-gps-summary');
  if (!panel) return;

  // Set header
  if (title) title.textContent = (stop.location ? stop.location.name : 'Unknown stop') + ' — Allocate time';
  if (gpsSum) gpsSum.textContent = 'Elapsed: ' + drFormatDuration(drElapsedMin(stop)) + ' (' + (drElapsedMin(stop)/60).toFixed(2) + 'h)';

  // Clear and populate rows
  var tbody = document.getElementById('dr-alloc-tbody');
  if (tbody) tbody.innerHTML = '';

  panel.classList.add('open');

  // Add existing allocations or one blank row
  if (stop.allocations && stop.allocations.length) {
    stop.allocations.forEach(function(a) { drAllocAddRow(a); });
  } else {
    drAllocAddRow(null);
  }
  drAllocUpdateRemaining(idx);
}

function drCloseAllocPanel() {
  var panel = document.getElementById('dr-alloc-panel');
  if (panel) panel.classList.remove('open');
  DRState.tagStopIdx = null;
}

// ── Time & Billing Modal ──────────────────────────────────────
var TBState = {
  stopIdx: null,
  gpsMin: 0,
  mergedStop: null,
  step: 'segs', // 'segs' | 'cust' | 'wo' | 'rows'
  pendingCustId: null,
  pendingCustName: null,
  map: null,
  mapReady: false
};

function drOpenBillingModal(idx) {
  var stop = DRState.stops[idx];
  if (!stop) return;
  TBState.stopIdx = idx;
  TBState.gpsMin = drElapsedMin(stop);
  TBState.mergedStop = null;
  TBState.step = 'segs';
  TBState.pendingCustId = null;
  TBState.pendingCustName = null;
  var modal = document.getElementById('tb-modal');
  if (!modal) return;
  modal.classList.add('open');
  var title = document.getElementById('tb-modal-title');
  if (title) title.textContent = (stop.location ? stop.location.name : 'Unknown stop') + ' — Time & Billing';
  tbUpdateBalance();
  tbRenderSegs();
  tbRenderRows();
  tbInitMap(stop);
}

function tbCloseModal() {
  var modal = document.getElementById('tb-modal');
  if (modal) modal.classList.remove('open');
  TBState.stopIdx = null;
  drRenderTimeline();
}

function tbUpdateBalance() {
  var gpsEl = document.getElementById('tb-bal-gps');
  var allocEl = document.getElementById('tb-bal-alloc');
  var neededEl = document.getElementById('tb-bal-needed');
  var gpsH = TBState.gpsMin / 60;
  if (gpsEl) gpsEl.textContent = gpsH.toFixed(1) + ' hrs';
  var totalAlloc = tbGetTotalAllocated();
  if (allocEl) allocEl.textContent = totalAlloc.toFixed(1) + ' hrs';
  var diff = gpsH - totalAlloc;
  if (neededEl) {
    if (diff > 0.05) {
      neededEl.textContent = diff.toFixed(1) + ' hrs';
      neededEl.className = 'tb-bal-val under';
    } else if (diff < -0.05) {
      neededEl.textContent = '+' + Math.abs(diff).toFixed(1) + ' hrs above GPS';
      neededEl.className = 'tb-bal-val met';
    } else {
      neededEl.textContent = 'Fully allocated';
      neededEl.className = 'tb-bal-val met';
    }
  }
}

function tbGetTotalAllocated() {
  var rows = document.querySelectorAll('.tb-hours-input');
  var total = 0;
  rows.forEach(function(inp){ total += parseFloat(inp.value||0); });
  return total;
}

function tbRenderSegs() {
  var el = document.getElementById('tb-segs');
  if (!el) return;
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  // Get already merged secondary segment timestamps
  var mergedKeys = [];
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview && dayReview.merged_stops) {
    var mergedList = [];
    try { mergedList = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
    if (!Array.isArray(mergedList)) mergedList = [];
    mergedList.forEach(function(m) {
      if (m.mergedSegments) m.mergedSegments.forEach(function(s){ mergedKeys.push(s.arrivedAt); });
    });
  }
  // Find sibling stops at same location — exclude already merged secondaries
  var siblings = [];
  if (stop.location) {
    DRState.stops.forEach(function(s, i) {
      if (s.location && s.location.id === stop.location.id && mergedKeys.indexOf(s.arrivedAt) < 0) {
        siblings.push({stop: s, idx: i});
      }
    });
  }
  if (siblings.length <= 1) { el.style.display = 'none'; return; }
  TBState.siblingIndices = siblings.map(function(s){ return DRState.stops.indexOf(s.stop); });
  el.style.display = 'block';
  var html = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">';
  html += '<span style="font-size:11px;font-weight:600;color:var(--text-muted)">GPS SEGMENTS — select to merge:</span></div>';
  html += '<div id="tb-seg-checks" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">';
  siblings.forEach(function(s, i) {
    var sid = 'tb-seg-cb-' + i;
    html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-size:12px;background:var(--surface)">';
    html += '<input type="checkbox" id="' + sid + '" checked style="cursor:pointer">';
    html += drFormatTime(s.stop.arrivedAt) + ' · ' + drFormatDuration(drElapsedMin(s.stop));
    html += '</label>';
  });
  html += '</div>';
  var totalMin = siblings.reduce(function(sum, s){ return sum + drElapsedMin(s.stop); }, 0);
  html += '<div style="display:flex;gap:6px">';
  html += '<button onclick="tbMergeSelected()" style="font-size:11px;padding:5px 12px;background:#534ab7;color:#fff;border:none;border-radius:99px;cursor:pointer">Merge selected</button>';
  html += '<button onclick="tbMergeAll()" style="font-size:11px;padding:5px 12px;background:#854f0b;color:#fff;border:none;border-radius:99px;cursor:pointer">Merge all (' + drFormatDuration(totalMin) + ')</button>';
  html += '</div>';
  el.innerHTML = html;
}

function tbMergeSelected() {
  var checkboxes = document.querySelectorAll('#tb-seg-checks input[type=checkbox]');
  var selectedIndices = [];
  var siblingIndices = TBState.siblingIndices || [];
  checkboxes.forEach(function(cb, i) {
    if (cb.checked && siblingIndices[i] !== undefined) selectedIndices.push(siblingIndices[i]);
  });
  if (selectedIndices.length < 2) { showToast('Select at least 2 segments to merge'); return; }
  tbMergeStops(selectedIndices);
}

function tbMergeStops(indices) {
  var stops = DRState.stops;
  var primary = stops[indices[0]];
  var lastStop = stops[indices[indices.length-1]];
  // v4.42 fix — was using wall clock (lastStop.leftAt - primary.arrivedAt) which includes
  // drive time between stops. Must sum individual stop durations instead.
  // NOTE: tbMergeStops and drMergeStops are two separate code paths doing the same job.
  // Should be consolidated into one shared function in a future refactor.
  var totalMin = indices.reduce(function(sum, idx){ return sum + (stops[idx] ? stops[idx].durationMin : 0); }, 0);
  TBState.gpsMin = totalMin;
  primary.durationMin = totalMin;
  primary.leftAt = lastStop.leftAt;
  var mergeRecord = {
    primaryArrivedAt: primary.arrivedAt,
    mergedSegments: indices.slice(1).map(function(idx){ return { arrivedAt: stops[idx].arrivedAt, leftAt: stops[idx].leftAt, durationMin: stops[idx].durationMin }; }),
    originalDurationMin: indices.slice(1).length > 0 ? stops[indices[0]].durationMin : primary.durationMin,
    totalDurationMin: totalMin,  // v4.42 fix — was missing, causing reload to recalculate incorrectly
    mergedAt: new Date().toISOString()
  };
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (dayReview) {
    var mergedStops = dayReview.merged_stops ? JSON.parse(typeof dayReview.merged_stops === 'string' ? dayReview.merged_stops : JSON.stringify(dayReview.merged_stops)) : [];
    if (!Array.isArray(mergedStops)) mergedStops = [];
    mergedStops.push(mergeRecord);
    sb.patch('day_review', dayReview.id, {
      merged_stops: mergedStops,
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    });
    dayReview.merged_stops = mergedStops;
  }
  var segsEl = document.getElementById('tb-segs');
  if (segsEl) segsEl.style.display = 'none';
  tbUpdateBalance();
  var rowsEl = document.getElementById('tb-rows');
  if (rowsEl) {
    var unmergeDiv = document.createElement('div');
    unmergeDiv.style.cssText = 'font-size:11px;color:var(--text-muted);cursor:pointer;padding:4px 0;margin-bottom:8px';
    unmergeDiv.innerHTML = '<i class="ti ti-arrows-split" aria-hidden="true"></i> Undo merge (' + indices.length + ' segments)';
    unmergeDiv.onclick = function(){ tbUnmerge(primary.arrivedAt); };
    rowsEl.insertBefore(unmergeDiv, rowsEl.firstChild);
  }
  showToast('Segments merged — ' + drFormatDuration(totalMin) + ' total');
  // After merge — show WO selection
  tbStartAddWO();
}

function tbMergeAll() {
  var siblingIndices = TBState.siblingIndices || [];
  if (siblingIndices.length < 2) return;
  tbMergeStops(siblingIndices);
}

function tbUnmerge(primaryArrivedAt) {
  var dayReview = DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate && r.tech_id === DRState.tech; });
  if (!dayReview) return;
  var mergedStops = dayReview.merged_stops ? JSON.parse(typeof dayReview.merged_stops === 'string' ? dayReview.merged_stops : JSON.stringify(dayReview.merged_stops)) : [];
  if (!Array.isArray(mergedStops)) mergedStops = [];
  var record = mergedStops.find(function(m){ return m.primaryArrivedAt === primaryArrivedAt; });
  if (!record) { showToast('No merge record found'); return; }
  // Remove merge record
  mergedStops = mergedStops.filter(function(m){ return m.primaryArrivedAt !== primaryArrivedAt; });
  // Restore primary stop's original duration
  var primaryStop = DRState.stops.find(function(s){ return s.arrivedAt === primaryArrivedAt; });
  if (primaryStop) primaryStop.durationMin = record.originalDurationMin;
  // Restore location matching on secondary segments so they re-match correctly
  var allLocations = AppState.locations || [];
  var geofenceDefault = parseInt(AppState.settings.geofence_default_radius || '100');
  (record.mergedSegments||[]).forEach(function(seg) {
    var stop = DRState.stops.find(function(s){ return s.arrivedAt === seg.arrivedAt; });
    if (stop && allLocations.length) {
      var bestMatch = null;
      var segMatches = [];
      var bestDist = Infinity;
      allLocations.forEach(function(loc) {
        if (!loc.lat || !loc.lng) return;
        var radius = loc.geofence_radius || geofenceDefault;
        var dist = drHaversineMeters(stop.lat, stop.lng, loc.lat, loc.lng);
        if (dist <= radius) {
          segMatches.push({ loc: loc, dist: dist });
          if (dist < bestDist) { bestDist = dist; bestMatch = loc; }
        }
      });
      segMatches.sort(function(a,b){ return a.dist - b.dist; });
      if (segMatches.length === 1) { stop.location = bestMatch; stop.locationMatches = null; }
      else if (segMatches.length > 1) { stop.location = null; stop.locationMatches = segMatches.map(function(m){ return m.loc; }); }
      else { stop.location = null; stop.locationMatches = null; }
    }
  });
  sb.patch('day_review', dayReview.id, {
    merged_stops: mergedStops,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      dayReview.merged_stops = mergedStops;
      showToast('Merge undone — segments restored');
      tbCloseModal();
      drRenderTimeline();
    }
  });
}

function tbRenderRows() {
  var el = document.getElementById('tb-rows');
  if (!el) return;
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  var html = '';
  // Render existing allocations
  if (stop.allocations && stop.allocations.length) {
    stop.allocations.forEach(function(a, i) {
      html += tbBuildWOBlock(a, i);
    });
  }
  // Add WO button
  html += '<div id="tb-add-wo-btn" onclick="tbStartAddWO()" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px dashed var(--border);border-radius:8px;cursor:pointer;color:var(--text-accent);font-size:13px;margin-top:4px">';
  html += '<i class="ti ti-plus" aria-hidden="true"></i> Add work order</div>';
  el.innerHTML = html;
}

function tbBuildWOBlock(alloc, blockIdx) {
  var wo = AppState.workOrders.find(function(w){ return w.id === alloc.woId; });
  var isQuoted = alloc.formMode === 'quoted';
  var badgeCls = isQuoted ? 'qt' : 'tm';
  var badgeTxt = isQuoted ? 'Quoted' : 'T&M';
  var html = '<div class="tb-wo-block" id="tb-block-' + blockIdx + '">';
  html += '<div class="tb-wo-head">';
  html += '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + escHtml(alloc.customerName||'') + '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(alloc.woNumber||'') + (wo&&wo.title?' — '+escHtml(wo.title):'') + '</div></div>';
  html += '<span class="tb-badge ' + badgeCls + '">' + badgeTxt + '</span>';
  html += '<input type="number" class="tb-hours-input" value="' + parseFloat(alloc.hours||0).toFixed(2) + '" min="0" step="0.25" oninput="tbUpdateBalance()" onchange="tbSaveHours(' + blockIdx + ',this.value)" style="width:65px;font-size:13px;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin:0 8px">';
  html += '<span style="font-size:11px;color:var(--text-muted)">hrs</span>';
  html += '<button onclick="tbRemoveBlock(' + blockIdx + ')" style="background:none;border:none;color:var(--danger,#e24b4a);cursor:pointer;font-size:16px;margin-left:8px">&times;</button>';
  html += '</div>';
  html += '<div class="tb-wo-body">';
  // Parts & Services collapsed
  var psKey = 'tb-ps-' + blockIdx;
  html += '<div onclick="tbTogglePS(\'' + psKey + '\',\'' + (alloc.woId||'') + '\')" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);margin-bottom:4px">';
  html += '<i class="ti ti-chevron-right" id="' + psKey + '-icon" aria-hidden="true"></i>';
  html += '<span>Parts &amp; Services</span></div>';
  html += '<div id="' + psKey + '" style="display:none"></div>';
  html += '</div></div>';
  return html;
}

function tbTogglePS(psKey, woId) {
  var el = document.getElementById(psKey);
  var icon = document.getElementById(psKey + '-icon');
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (icon) { icon.className = 'ti ti-chevron-down'; }
    tbLoadPS(psKey, woId);
  } else {
    el.style.display = 'none';
    if (icon) { icon.className = 'ti ti-chevron-right'; }
  }
}

function tbLoadPS(psKey, woId) {
  var el = document.getElementById(psKey);
  if (!el || !woId) return;
  el.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">Loading...</div>';
  sb.get('wo_parts', '?work_order_id=eq.' + woId + '&active=eq.true&select=*&order=created_at.asc').then(function(r) {
    var parts = (r.ok && r.data) ? r.data : [];
    sb.get('wo_services', '?work_order_id=eq.' + woId + '&active=eq.true&select=*&order=created_at.asc').then(function(r2) {
      var services = (r2.ok && r2.data) ? r2.data : [];
      var html = '';
      if (!parts.length && !services.length) {
        html += '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">No parts or services yet.</div>';
      }
      parts.forEach(function(p) {
        html += '<div class="tb-ps-item">';
        html += '<span style="flex:1">' + escHtml(p.description||p.part_number||'Part') + '</span>';
        html += '<span style="color:var(--text-muted)">' + (p.quantity||1) + ' × $' + parseFloat(p.unit_price||0).toFixed(2) + '</span>';
        html += '<button onclick="tbDeletePart(\'' + p.id + '\',\'' + psKey + '\',\'' + woId + '\')" style="background:none;border:none;color:var(--danger,#e24b4a);cursor:pointer;font-size:14px;margin-left:6px">&times;</button>';
        html += '</div>';
      });
      services.forEach(function(s) {
        html += '<div class="tb-ps-item">';
        html += '<span style="flex:1">' + escHtml(s.description||s.service_code||'Service') + '</span>';
        html += '<span style="color:var(--text-muted)">$' + parseFloat(s.unit_price||0).toFixed(2) + '</span>';
        html += '<button onclick="tbDeleteService(\'' + s.id + '\',\'' + psKey + '\',\'' + woId + '\')" style="background:none;border:none;color:var(--danger,#e24b4a);cursor:pointer;font-size:14px;margin-left:6px">&times;</button>';
        html += '</div>';
      });
      html += '<div onclick="tbAddPart(\'' + woId + '\',\'' + psKey + '\')" style="font-size:12px;color:var(--text-accent);cursor:pointer;padding:5px 0;border-top:1px solid var(--border);margin-top:4px">+ Add part or service</div>';
      el.innerHTML = html;
    });
  });
}

function tbDeletePart(partId, psKey, woId) {
  sb.patch('wo_parts', partId, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    if (r.ok) { tbLoadPS(psKey, woId); showToast('Part removed'); }
  });
}

function tbDeleteService(svcId, psKey, woId) {
  sb.patch('wo_services', svcId, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    if (r.ok) { tbLoadPS(psKey, woId); showToast('Service removed'); }
  });
}

function tbAddPart(woId, psKey) {
  var desc = prompt('Part description:');
  if (!desc) return;
  var qty = parseFloat(prompt('Quantity:', '1') || '1');
  var price = parseFloat(prompt('Unit price:', '0') || '0');
  sb.post('wo_parts', {
    work_order_id: woId,
    description: desc,
    quantity: qty,
    unit_price: price,
    active: true,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok) { tbLoadPS(psKey, woId); showToast('Part added'); }
    else showToast('Error adding part');
  });
}

function tbSaveHours(blockIdx, val) {
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop || !stop.allocations || !stop.allocations[blockIdx]) return;
  var alloc = stop.allocations[blockIdx];
  alloc.hours = parseFloat(val||0);
  // Find existing hours_entry and update
  var entry = DRState.hoursEntries.find(function(e){ return e.work_order_id === alloc.woId && e.tech_id === DRState.tech && e.entry_date === DRState.selectedDate; });
  if (entry) {
    sb.patch('hours_entries', entry.id, { hours: alloc.hours, modified_by: AppState.userEmail, modified_at: new Date().toISOString() });
  }
  tbUpdateBalance();
}

function tbRemoveBlock(blockIdx) {
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop || !stop.allocations) return;
  var alloc = stop.allocations[blockIdx];
  if (alloc && alloc.woId) {
    var entryIdx = DRState.hoursEntries.findIndex(function(e){ return e.work_order_id === alloc.woId && e.tech_id === DRState.tech && e.entry_date === DRState.selectedDate; });
    if (entryIdx >= 0) {
      sb.patch('hours_entries', DRState.hoursEntries[entryIdx].id, { active: false, modified_by: AppState.userEmail });
      DRState.hoursEntries.splice(entryIdx, 1);
    }
  }
  stop.allocations.splice(blockIdx, 1);
  tbRenderRows();
  tbUpdateBalance();
  showToast('Entry removed');
}

function tbStartAddWO() {
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  TBState.step = 'cust';
  TBState.pendingCustId = null;
  // Vendor stops — skip customer, go straight to WO search across all customers
  if (stop.location && stop.location.location_type === 'vendor') {
    TBState.pendingCustId = null;
    TBState.pendingCustName = null;
    tbRenderVendorWOList('');
    return;
  }
  var rowsEl = document.getElementById('tb-rows');
  if (!rowsEl) return;
  // Build nearby customer IDs
  var nearbyIds = [];
  DRState.locations.forEach(function(l) {
    if (!l.lat || !l.lng || !l.customer_id) return;
    var radius = l.geofence_radius || 200;
    if (drHaversineMeters(stop.lat, stop.lng, l.lat, l.lng) <= radius) {
      if (nearbyIds.indexOf(l.customer_id) < 0) nearbyIds.push(l.customer_id);
    }
  });
  TBState.nearbyIds = nearbyIds;
  tbRenderCustList('');
}

function tbRenderCustList(query) {
  var rowsEl = document.getElementById('tb-rows');
  if (!rowsEl) return;
  var nearbyIds = TBState.nearbyIds || [];
  var q = query.toLowerCase().trim();
  var allActive = AppState.customers.filter(function(c){ return c.active !== false; });
  var nearbyCusts = allActive.filter(function(c){
    var name = getCustName(c).toLowerCase();
    return nearbyIds.indexOf(c.id) >= 0 && (!q || name.indexOf(q) >= 0);
  });
  var otherCusts = allActive.filter(function(c){
    var name = getCustName(c).toLowerCase();
    return nearbyIds.indexOf(c.id) < 0 && (!q || name.indexOf(q) >= 0);
  });
  var html = '<div id="tb-step">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
  html += '<button onclick="tbCancelAddWO()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">&larr;</button>';
  html += '<div class="tb-step-label">Which customer?</div></div>';
  html += '<input type="text" placeholder="Search customers..." oninput="tbRenderCustList(this.value)" value="' + escHtml(query) + '" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box;margin-bottom:10px">';
  if (nearbyCusts.length) {
    html += '<div style="font-size:10px;font-weight:500;color:var(--text-muted);margin-bottom:6px">AT THIS LOCATION</div>';
    nearbyCusts.forEach(function(c) {
      html += '<div class="tb-cust-item" onclick="tbSelectCust(\'' + c.id + '\',\'' + escHtml(getCustName(c).replace(/'/g,'\\\'')) + '\')">';
      html += '<div class="tb-cust-badge">C</div>';
      html += '<div style="font-size:13px">' + escHtml(getCustName(c)) + '</div>';
      html += '</div>';
    });
    if (otherCusts.length) html += '<div style="font-size:10px;font-weight:500;color:var(--text-muted);margin-top:8px;margin-bottom:6px">ALL CUSTOMERS</div>';
  }
  otherCusts.forEach(function(c) {
    html += '<div class="tb-cust-item" onclick="tbSelectCust(\'' + c.id + '\',\'' + escHtml(getCustName(c).replace(/'/g,'\\\'')) + '\')">';
    html += '<div class="tb-cust-badge" style="background:var(--surface);color:var(--text-muted)">C</div>';
    html += '<div style="font-size:13px">' + escHtml(getCustName(c)) + '</div>';
    html += '</div>';
  });
  if (!nearbyCusts.length && !otherCusts.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:10px 0">No customers match "' + escHtml(query) + '"</div>';
  }
  html += '</div>';
  rowsEl.innerHTML = html;
  // Re-focus search input
  var inp = rowsEl.querySelector('input[type=text]');
  if (inp && query) { inp.focus(); inp.setSelectionRange(query.length, query.length); }
}

function tbSelectCust(custId, custName) {
  TBState.pendingCustId = custId;
  TBState.pendingCustName = custName;
  TBState.step = 'wo';
  tbRenderWOList('');
}

function tbRenderVendorWOList(query) {
  var rowsEl = document.getElementById('tb-rows');
  if (!rowsEl) return;
  var q = query.toLowerCase().trim();
  // Get today's customer stops to surface their WOs first
  var todayCustIds = [];
  DRState.stops.forEach(function(s) {
    if (s.location && s.location.location_type === 'customer' && s.location.customer_id) {
      if (todayCustIds.indexOf(s.location.customer_id) < 0) todayCustIds.push(s.location.customer_id);
    }
  });
  var allWOs = AppState.workOrders.filter(function(w) {
    if (w.active === false || !isLiveStatus(w.status)) return false;
    if (!q) return true;
    return (w.wo_number||'').toLowerCase().indexOf(q) >= 0 || (w.title||'').toLowerCase().indexOf(q) >= 0;
  }).sort(function(a,b){ return b.wo_number.localeCompare(a.wo_number); });
  var todayWOs = allWOs.filter(function(w){ return todayCustIds.indexOf(w.customer_id) >= 0; });
  var otherWOs = allWOs.filter(function(w){ return todayCustIds.indexOf(w.customer_id) < 0; });
  var html = '<div id="tb-step">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
  html += '<button onclick="tbCancelAddWO()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">&larr;</button>';
  html += '<div class="tb-step-label">Which work order is this parts run for?</div></div>';
  html += '<input type="text" placeholder="Search WO number, customer or description..." oninput="tbRenderVendorWOList(this.value)" value="' + escHtml(query) + '" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box;margin-bottom:10px">';
  if (todayWOs.length) {
    html += '<div style="font-size:10px;font-weight:500;color:var(--text-muted);margin-bottom:6px">TODAY\'S JOBS</div>';
    todayWOs.forEach(function(w) {
      var cust = AppState.customers.find(function(c){ return c.id === w.customer_id; });
      var isQuoted = w.form_mode === 'quoted';
      html += '<div class="tb-wo-item" onclick="tbSelectVendorWO(\'' + w.id + '\')">';
      html += '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + escHtml(w.wo_number) + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(cust ? getCustName(cust) : '') + (w.title?' — '+escHtml(w.title):'') + '</div></div>';
      html += '<span class="tb-badge ' + (isQuoted?'qt':'tm') + '">' + (isQuoted?'Quoted':'T&M') + '</span>';
      html += '</div>';
    });
    if (otherWOs.length) html += '<div style="font-size:10px;font-weight:500;color:var(--text-muted);margin-top:8px;margin-bottom:6px">ALL OPEN WOs</div>';
  }
  otherWOs.forEach(function(w) {
    var cust = AppState.customers.find(function(c){ return c.id === w.customer_id; });
    var isQuoted = w.form_mode === 'quoted';
    html += '<div class="tb-wo-item" onclick="tbSelectVendorWO(\'' + w.id + '\')">';
    html += '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + escHtml(w.wo_number) + '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(cust ? getCustName(cust) : '') + (w.title?' — '+escHtml(w.title):'') + '</div></div>';
    html += '<span class="tb-badge ' + (isQuoted?'qt':'tm') + '">' + (isQuoted?'Quoted':'T&M') + '</span>';
    html += '</div>';
  });
  if (!todayWOs.length && !otherWOs.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:10px 0">No open work orders found.</div>';
  }
  html += '</div>';
  rowsEl.innerHTML = html;
  var inp = rowsEl.querySelector('input[type=text]');
  if (inp && query) { inp.focus(); inp.setSelectionRange(query.length, query.length); }
}

function tbSelectVendorWO(woId) {
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  if (!wo) return;
  var cust = AppState.customers.find(function(c){ return c.id === wo.customer_id; });
  TBState.pendingCustId = wo.customer_id;
  TBState.pendingCustName = cust ? getCustName(cust) : '';
  tbSelectWO(woId);
}

function tbRenderWOList(query) {
  var custId = TBState.pendingCustId;
  var custName = TBState.pendingCustName;
  var q = query.toLowerCase().trim();
  var wos = AppState.workOrders.filter(function(w){
    if (w.active === false || w.customer_id !== custId || !isLiveStatus(w.status)) return false;
    if (!q) return true;
    return (w.wo_number||'').toLowerCase().indexOf(q) >= 0 || (w.title||'').toLowerCase().indexOf(q) >= 0;
  }).sort(function(a,b){ return b.wo_number.localeCompare(a.wo_number); });
  var rowsEl = document.getElementById('tb-rows');
  if (!rowsEl) return;
  var html = '<div id="tb-step">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
  html += '<button onclick="tbStartAddWO()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">&larr;</button>';
  html += '<div class="tb-step-label">Work order — ' + escHtml(custName) + '</div></div>';
  html += '<input type="text" placeholder="Search WO number or description..." oninput="tbRenderWOList(this.value)" value="' + escHtml(query) + '" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box;margin-bottom:10px">';
  if (!wos.length) {
    html += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">' + (q ? 'No WOs match "' + escHtml(query) + '"' : 'No open work orders for this customer.') + '</div>';
  }
  wos.forEach(function(w) {
    var isQuoted = w.form_mode === 'quoted';
    html += '<div class="tb-wo-item" onclick="tbSelectWO(\'' + w.id + '\')">';
    html += '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + escHtml(w.wo_number) + '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(w.title||'') + '</div></div>';
    html += '<span class="tb-badge ' + (isQuoted?'qt':'tm') + '">' + (isQuoted?'Quoted':'T&M') + '</span>';
    html += '</div>';
  });
  html += '<div class="tb-wo-item" onclick="tbCreateNewWO()" style="border-style:dashed;color:var(--text-accent)">';
  html += '<i class="ti ti-plus" aria-hidden="true"></i> <span style="font-size:13px">New work order</span></div>';
  html += '</div>';
  rowsEl.innerHTML = html;
  var inp = rowsEl.querySelector('input[type=text]');
  if (inp && query) { inp.focus(); inp.setSelectionRange(query.length, query.length); }
}

function tbSelectWO(woId) {
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  if (!wo) return;
  var idx = TBState.stopIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  var ht = AppState.hoursTypes && AppState.hoursTypes[0];
  var actualHours = parseFloat((drElapsedMin(stop) / 60).toFixed(2));
  var alloc = {
    custId: TBState.pendingCustId,
    customerName: TBState.pendingCustName,
    woId: woId,
    woNumber: wo.wo_number,
    formMode: wo.form_mode || 'time_materials',
    hours: actualHours,
    htId: ht ? ht.id : null,
    rateName: ht ? ht.name : '',
    isPaid: true,
    isBillable: true
  };
  if (!stop.allocations) stop.allocations = [];
  stop.allocations.push(alloc);
  // Save to hours_entries
  var loc = stop.location;
  var autoTechName = (AppState.technicians.find(function(t){return t.id===DRState.tech;})||{}).name||'';
  sb.post('hours_entries', {
    work_order_id: woId,
    tech_id: DRState.tech,
    entry_date: DRState.selectedDate,
    hours_type_id: ht ? ht.id : null,
    hours: actualHours,
    billable: true,
    location_id: loc ? loc.id : null,
    descriptor: wo.wo_number + ' - ' + autoTechName + ' - ' + wo.title,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok && r.data && r.data.length) DRState.hoursEntries.push(r.data[0]);
  });
  TBState.step = 'rows';
  tbRenderRows();
  tbUpdateBalance();
}

function tbCreateNewWO() {
  var title = prompt('New work order title:');
  if (!title) return;
  var nextNum = parseInt(AppState.settings.wo_number_next||'26300');
  var prefix = AppState.settings.wo_number_prefix||'P';
  var woNum = prefix + nextNum;
  AppState.settings.wo_number_next = String(nextNum+1);
  sb.patchWhere('settings','key=eq.wo_number_next',{value:String(nextNum+1)});
  sb.post('work_orders',{
    wo_number: woNum, title: title, customer_id: TBState.pendingCustId,
    form_mode: 'time_materials',
    status: (AppState.statuses.find(function(s){return s.num===7;})||{num:7}).num,
    origin: 'daily_review', created_by: AppState.userEmail, modified_by: AppState.userEmail
  }).then(function(r){
    if (r.ok && r.data && r.data.length) {
      AppState.workOrders.push(r.data[0]);
      tbSelectWO(r.data[0].id);
      showToast('WO ' + woNum + ' created');
    }
  });
}

function tbCancelAddWO() {
  TBState.step = 'rows';
  tbRenderRows();
}

function tbInitMap(stop) {
  var mapEl = document.getElementById('tb-map-inner');
  if (!mapEl) return;
  if (typeof google === 'undefined' || !google.maps) {
    mapEl.innerHTML = '<div style="padding:20px;font-size:12px;color:var(--text-muted);text-align:center">Map loading...</div>';
    locLoadMapsAPI(function(){ tbInitMap(stop); });
    return;
  }
  if (!TBState.map) {
    TBState.map = new google.maps.Map(mapEl, {
      zoom: 15,
      center: { lat: stop.lat, lng: stop.lng },
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true
    });
  } else {
    TBState.map.panTo({ lat: stop.lat, lng: stop.lng });
    TBState.map.setZoom(15);
  }
  new google.maps.Marker({ position: { lat: stop.lat, lng: stop.lng }, map: TBState.map, title: stop.location ? stop.location.name : 'Stop' });
}

function tbExpandMap() {
  var mapCol = document.getElementById('tb-map-col');
  var mainCol = document.getElementById('tb-modal-main');
  if (!mapCol || !mainCol) return;
  if (mapCol.style.width === '50%') {
    mapCol.style.width = '280px';
    mainCol.style.flex = '1';
  } else {
    mapCol.style.width = '50%';
    mainCol.style.flex = '1';
  }
  if (TBState.map) google.maps.event.trigger(TBState.map, 'resize');
}

// Wire billing modal to stop card Allocate button
function drStartAllocate(idx) {
  DRState.tagStopIdx = idx;
  drOpenBillingModal(idx);
}

function drCloseTagOverlay() {
  var existing = document.getElementById('dr-tag-overlay');
  if (existing) existing.remove();
}

function drRenderTagOverlay() {
  drCloseTagOverlay();
  var mapCol = document.getElementById('dr-map-col');
  if (!mapCol) return;

  var stop = DRState.stops[DRState.tagStopIdx];
  if (!stop) return;

  var div = document.createElement('div');
  div.id = 'dr-tag-overlay';
  div.className = 'dr-overlay';

  if (DRState.tagStep === 1) {
    drBuildIdentifyPanel(div, stop);
  } else if (DRState.tagStep === 2) {
    drBuildAllocatePanel(div, stop);
  }

  mapCol.appendChild(div);

  // Post-append initialization
  if (DRState.tagStep === 1) {
    drFetchNearbyPlaces(stop.lat, stop.lng);
  } else if (DRState.tagStep === 2) {
    drAddAllocRow();
    drUpdateAllocSummary(stop);
  }
}

function drBuildIdentifyPanel(div, stop) {
  var html = '<div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">';
  html += '<div style="font-size:13px;font-weight:700">Identify stop</div>';
  html += '<button onclick="drCloseTagOverlay()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted)">&times;</button>';
  html += '</div>';
  html += '<div style="padding:10px 14px;flex-shrink:0">';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">' + drFormatTime(stop.arrivedAt) + ' &ndash; ' + drFormatTime(stop.leftAt) + ' &middot; ' + drFormatDuration(drElapsedMin(stop)) + '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">' + stop.lat.toFixed(5) + ', ' + stop.lng.toFixed(5) + '</div>';
  html += '<input type="text" id="dr-tag-name" placeholder="Location name..." style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:8px">';
  html += '<select id="dr-tag-type" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:8px">';
  html += '<option value="customer">Customer</option>';
  html += '<option value="vendor">Vendor</option>';
  html += '<option value="personal">Personal</option>';
  html += '<option value="fuel">Fuel stop</option>';
  html += '<option value="lunch">Lunch</option>';
  html += '<option value="other">Other (non-billable)</option>';
  html += '</select>';
  html += '<button onclick="drSaveTagLocation()" style="width:100%;padding:8px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:13px;font-weight:600">Save location</button>';
  html += '</div>';
  html += '<div style="border-top:1px solid var(--border);padding:10px 14px;flex-shrink:0"><div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px">NEARBY PLACES</div></div>';
  html += '<div id="dr-places-list" style="flex:1;overflow-y:auto;padding:0 14px 14px"><div style="font-size:12px;color:var(--text-muted)">Loading suggestions...</div></div>';
  div.innerHTML = html;
}

function drBuildAllocatePanel(div, stop) {
  // Now handled by drOpenAllocPanel — this is kept as stub for overlay step 2
  div.innerHTML = '';
}

function drShowLocationChange() {
  var el = document.getElementById('dr-loc-change');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function drFilterLocChange(val) {
  var q = val.toLowerCase();
  var results = document.getElementById('dr-loc-results');
  if (!results) return;
  var stop = DRState.stops[DRState.tagStopIdx];
  if (!stop) return;
  var matches = DRState.locations.filter(function(l) {
    return l.name && l.name.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 10);
  results.innerHTML = matches.map(function(l) {
    var dist = l.lat && l.lng ? Math.round(drHaversineMeters(stop.lat, stop.lng, l.lat, l.lng)) + 'm' : '';
    return '<div onclick="drTagOverlaySelectLocation(\'' + l.id + '\')" style="padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)">'
      + escHtml(l.name) + ' <span style="color:var(--text-muted)">' + dist + '</span></div>';
  }).join('');
}

function drTagOverlaySelectLocation(locId) {
  var loc = DRState.locations.find(function(l){ return l.id === locId; });
  if (!loc) return;
  var idx = DRState.tagStopIdx;
  var stop = DRState.stops[idx];
  if (!stop) return;
  stop.location = loc;
  drCloseTagOverlay();
  drRenderTimeline();
  drRenderMapTrail();
  setTimeout(function(){ drOpenBillingModal(idx); }, 100);
}

function drAllocAddRow(existing) {
  var tbody = document.getElementById('dr-alloc-tbody');
  if (!tbody) return;
  var idx = DRState.tagStopIdx;
  var stop = idx !== null ? DRState.stops[idx] : null;

  // Build customer options — nearby location customers first
  var nearbyCustomerIds = [];
  if (stop) {
    DRState.locations.filter(function(l){
      return l.lat && l.lng && drHaversineMeters(stop.lat, stop.lng, l.lat, l.lng) <= 300 && l.customer_id;
    }).forEach(function(l){ if (nearbyCustomerIds.indexOf(l.customer_id) < 0) nearbyCustomerIds.push(l.customer_id); });
  }

  var nearbyCusts = AppState.customers.filter(function(c){ return nearbyCustomerIds.indexOf(c.id) >= 0; });
  var otherCusts = AppState.customers.filter(function(c){ return c.active !== false && nearbyCustomerIds.indexOf(c.id) < 0; });

  var custOpts = '<option value="">-- Customer --</option>';
  if (nearbyCusts.length) {
    custOpts += '<optgroup label="Nearby">';
    nearbyCusts.forEach(function(c){ custOpts += '<option value="' + c.id + '"' + (existing&&existing.custId===c.id?' selected':'') + '>' + escHtml(getCustName(c)) + '</option>'; });
    custOpts += '</optgroup><optgroup label="All customers">';
  }
  otherCusts.forEach(function(c){ custOpts += '<option value="' + c.id + '"' + (existing&&existing.custId===c.id?' selected':'') + '>' + escHtml(getCustName(c)) + '</option>'; });
  if (nearbyCusts.length) custOpts += '</optgroup>';

  var htOpts = AppState.hoursTypes.map(function(t){
    return '<option value="' + t.id + '"' + (existing&&existing.htId===t.id?' selected':'') + '>' + escHtml(t.name) + '</option>';
  }).join('');

  var rowId = 'dr-arow-' + Date.now();
  var tr = document.createElement('tr');
  tr.id = rowId;

  tr.innerHTML =
    '<td><select class="da-cust" onchange="drAllocCustChanged(this,\'' + rowId + '\')">' + custOpts + '</select></td>'
    + '<td><select class="da-wo"><option value="">-- WO --</option></select></td>'
    + '<td><input type="number" class="da-hours" value="' + (existing&&existing.hours||'') + '" min="0" step="0.25" placeholder="0.00" oninput="drAllocUpdateRemaining(' + idx + ')" style="width:60px"></td>'
    + '<td><select class="da-ht">' + htOpts + '</select></td>'
    + '<td style="text-align:center"><input type="checkbox" class="da-paid"' + (!existing||existing.isPaid!==false?' checked':'') + '></td>'
    + '<td style="text-align:center"><input type="checkbox" class="da-bill"' + (!existing||existing.isBillable!==false?' checked':'') + '></td>'
    + '<td><button onclick="this.closest(\'tr\').remove();drAllocUpdateRemaining(' + (idx||0) + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px">&times;</button></td>';

  // Pre-load WOs if existing allocation has a customer
  if (existing && existing.custId) {
    var custSel = tr.querySelector('.da-cust');
    if (custSel) {
      custSel.value = existing.custId;
      drAllocLoadWOs(tr, existing.custId, existing.woId);
    }
  }
  tbody.appendChild(tr);
}

function drAllocCustChanged(sel, rowId) {
  var tr = document.getElementById(rowId);
  if (!tr) return;
  var custId = sel.value;
  var idx = DRState.tagStopIdx;
  drAllocLoadWOs(tr, custId, null);
  drAllocUpdateRemaining(idx);
}

function drAllocLoadWOs(tr, custId, selectedWoId) {
  var woSel = tr.querySelector('.da-wo');
  if (!woSel) return;
  var wos = AppState.workOrders.filter(function(w){
    return w.active !== false && w.customer_id === custId && isLiveStatus(w.status);
  }).sort(function(a,b){ return b.wo_number.localeCompare(a.wo_number); });
  var html = '<option value="">-- WO --</option>';
  wos.forEach(function(w){
    var st = getStatus(w.status);
    html += '<option value="' + w.id + '"' + (w.id===selectedWoId?' selected':'') + '>'
      + escHtml(w.wo_number) + ' [' + st.name + '] ' + escHtml(w.title||'') + '</option>';
  });
  html += '<option value="__new__">+ New Work Order...</option>';
  woSel.innerHTML = html;
  woSel.onchange = function() {
    if (woSel.value === '__new__') drAllocNewWOInline(tr, custId);
    else drAllocUpdateRemaining(DRState.tagStopIdx);
  };
}

function drAllocNewWOInline(tr, custId) {
  var title = prompt('New work order title:');
  if (!title) { tr.querySelector('.da-wo').value = ''; return; }
  var nextNum = parseInt(AppState.settings.wo_number_next||'26300');
  var prefix = AppState.settings.wo_number_prefix||'P';
  var woNum = prefix + nextNum;
  AppState.settings.wo_number_next = String(nextNum+1);
  sb.patchWhere('settings','key=eq.wo_number_next',{value:String(nextNum+1)});
  sb.post('work_orders',{
    wo_number: woNum, title: title, customer_id: custId,
    form_mode: 'time_materials',
    status: (AppState.statuses.find(function(s){return s.num===7;})||{num:7}).num,
    origin: 'daily_review', created_by: AppState.userEmail, modified_by: AppState.userEmail
  }).then(function(r){
    if (r.ok && r.data && r.data.length) {
      var wo = r.data[0];
      AppState.workOrders.push(wo);
      var opt = document.createElement('option');
      opt.value = wo.id;
      opt.textContent = wo.wo_number + ' [In Progress] ' + wo.title;
      opt.selected = true;
      var woSel = tr.querySelector('.da-wo');
      // Insert before the "New WO" option
      var newOpt = woSel.querySelector('option[value="__new__"]');
      woSel.insertBefore(opt, newOpt);
      woSel.value = wo.id;
      showToast('WO ' + wo.wo_number + ' created');
      drAllocUpdateRemaining(DRState.tagStopIdx);
    } else showToast('Error creating WO');
  });
}

function drAllocUpdateRemaining(idx) {
  var el = document.getElementById('dr-alloc-remaining');
  if (!el) return;
  var stop = idx !== null && idx !== undefined ? DRState.stops[idx] : null;
  if (!stop) return;
  var rows = document.querySelectorAll('#dr-alloc-tbody tr');
  var total = 0;
  rows.forEach(function(row){
    var h = row.querySelector('.da-hours');
    if (h) total += parseFloat(h.value||0);
  });
  var gpsH = drElapsedMin(stop) / 60;
  var remaining = gpsH - total;
  if (Math.abs(remaining) < 0.01) {
    el.innerHTML = '<span style="color:#3b6d11">&#10003; Fully allocated (' + total.toFixed(2) + 'h)</span>';
  } else if (remaining > 0) {
    el.innerHTML = '<span style="color:#854f0b">' + remaining.toFixed(2) + 'h remaining of ' + gpsH.toFixed(2) + 'h GPS</span>';
  } else {
    el.innerHTML = '<span style="color:#a32d2d">' + Math.abs(remaining).toFixed(2) + 'h over GPS — min billing may apply</span>';
  }
}

function drAllocSave() {
  var saveBtn = document.querySelector('#dr-alloc-panel-foot button:last-child');
  if (!btnSaving(saveBtn)) return;
  var idx = DRState.tagStopIdx;
  var stop = idx !== null ? DRState.stops[idx] : null;
  if (!stop) return;
  var rows = document.querySelectorAll('#dr-alloc-tbody tr');
  var entries = [];
  var valid = true;

  rows.forEach(function(row) {
    var custId = (row.querySelector('.da-cust')||{}).value||'';
    var woId = (row.querySelector('.da-wo')||{}).value||'';
    var hours = parseFloat((row.querySelector('.da-hours')||{}).value||0);
    var htId = (row.querySelector('.da-ht')||{}).value||'';
    var isPaid = !!(row.querySelector('.da-paid')||{}).checked;
    var isBillable = !!(row.querySelector('.da-bill')||{}).checked;
    if (!custId) { valid = false; showToast('Select a customer for each row'); return; }
    if (!woId || woId === '__new__') { valid = false; showToast('Select a work order for each row'); return; }
    if (!hours || hours <= 0) { valid = false; showToast('Enter hours for each row'); return; }
    var wo = AppState.workOrders.find(function(w){return w.id===woId;});
    var ht = AppState.hoursTypes.find(function(t){return t.id===htId;});
    var cust = AppState.customers.find(function(c){return c.id===custId;});
    var rate = parseFloat(AppState.settings[(ht&&ht.internal_rate_key)]||0);
    entries.push({
      work_order_id: woId, tech_id: DRState.tech,
      entry_date: DRState.selectedDate,
      hours_type_id: htId||null, hours: hours,
      billable: isBillable, internal_rate: rate,
      line_total: hours * rate,
      location_id: stop.location ? stop.location.id : null,
      day_review_id: null,
      descriptor: (wo?wo.wo_number:'') + ' - ' + ((AppState.technicians.find(function(t){return t.id===DRState.tech;})||{}).name||'') + ' - ' + (wo?wo.title:''),
      created_by: AppState.userEmail, modified_by: AppState.userEmail,
      // Store in memory
      _custId: custId, _custName: cust?getCustName(cust):'',
      _woNumber: wo?wo.wo_number:'', _htName: ht?ht.name:'',
      _isPaid: isPaid, _isBillable: isBillable
    });
  });

  if (!valid) return;

  // Delete existing entries near this stop before re-saving (prevent duplicates)
  // Uses coordinate proximity not location_id since multiple locations share addresses
  var nearbyLocIds = DRState.locations.filter(function(l){
    return l.lat && l.lng && drHaversineMeters(stop.lat, stop.lng, l.lat, l.lng) <= parseInt(AppState.settings.geofence_radius_default||'100') * 3;
  }).map(function(l){ return l.id; });

  var deletePromise = nearbyLocIds.length
    ? sb.get('hours_entries', '?tech_id=eq.' + DRState.tech + '&entry_date=eq.' + DRState.selectedDate + '&location_id=in.(' + nearbyLocIds.join(',') + ')&select=id')
      .then(function(r) {
        if (r.ok && r.data && r.data.length) {
          return Promise.all(r.data.map(function(e){ return sb.delete('hours_entries', e.id); }));
        }
      })
    : Promise.resolve();

  deletePromise.then(function() {
    // Save all rows to hours_entries
    var promises = entries.map(function(e) {
      var payload = {
        work_order_id: e.work_order_id, tech_id: e.tech_id,
        entry_date: e.entry_date, hours_type_id: e.hours_type_id,
        hours: e.hours, billable: e.billable,
        internal_rate: e.internal_rate, line_total: e.line_total,
        location_id: e.location_id, descriptor: e.descriptor,
        created_by: e.created_by, modified_by: e.modified_by
      };
      return sb.post('hours_entries', payload);
    });

    Promise.all(promises).then(function(results) {
      var allOk = results.every(function(r){ return r.ok; });
      if (allOk) {
        stop.allocations = entries.map(function(e){
          return { custId: e._custId, customerName: e._custName, woId: e.work_order_id,
            woNumber: e._woNumber, hours: e.hours, htId: e.hours_type_id,
            rateName: e._htName, isPaid: e._isPaid, isBillable: e._isBillable };
        });
        btnDone(saveBtn);
        drCloseAllocPanel();
        // Keep the stop selected/expanded so allocations are visible
        DRState.selectedStop = idx;
        // Reload hours entries from Supabase then re-render
        var nextDate = DRState.selectedDate;
        sb.get('hours_entries', '?tech_id=eq.' + DRState.tech + '&entry_date=eq.' + nextDate + '&select=*,work_orders(wo_number,customers(display_name,name))&order=created_at.asc')
          .then(function(r) {
            DRState.hoursEntries = (r.ok && r.data) ? r.data : [];
            drRenderTimeline();
            showToast('Saved to timecard');
          });
        // Check remaining
        var gpsH = drElapsedMin(stop) / 60;
        var total = entries.reduce(function(s,e){return s+e.hours;},0);
        var remaining = gpsH - total;
        if (remaining > 0.08) {
          setTimeout(function(){
            if (confirm('You have ' + remaining.toFixed(2) + 'h unallocated elapsed time. Add another allocation?')) {
              drOpenAllocPanel(idx);
            }
          }, 300);
        }
      } else {
        btnDone(saveBtn);
        showToast('Error saving some entries — check timecard');
      }
    });
  });
}

// Keep old summary functions as stubs
function drUpdateAllocSummaryByIdx(idx) {}
function drUpdateAllocSummary(stop) {}
function drSaveAllocations(idx) { drAllocSave(); }


function drFetchNearbyPlaces(lat, lng) {
  var el = document.getElementById('dr-places-list');
  if (!el) return;
  if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Places API not loaded</div>';
    return;
  }

  // Use new Places API (required for accounts created after March 2025)
  var center = new google.maps.LatLng(lat, lng);
  var request = {
    fields: ['displayName', 'formattedAddress', 'location', 'types'],
    locationRestriction: {
      center: center,
      radius: 150
    },
    maxResultCount: 8
  };

  google.maps.places.Place.searchNearby(request).then(function(response) {
    var places = response.places || [];
    if (!places.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No nearby places found — type a name manually above</div>';
      return;
    }
    var html = '';
    places.forEach(function(place) {
      var name = place.displayName || '';
      var address = place.formattedAddress || '';
      // Shorten address to just street + city
      var addrShort = address.split(',').slice(0,2).join(',');
      var safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      html += '<div class="dr-place-suggestion" onclick="drSelectPlace(\'' + safeName + '\')">';
      html += '<div style="font-size:12px;font-weight:600">' + escHtml(name) + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(addrShort) + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  }).catch(function(err) {
    console.error('Places API error:', err);
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Could not load suggestions — type a name manually above</div>';
  });
}

function drPromptAddAnother(stop) {
  if (!stop || !stop.lat || !stop.lng) return;
  var addr = stop.location ? (stop.location.address_street || '') : '';
  if (confirm('Are there other customers or locations at this same address?\n\nClick OK to add another location here.')) {
    desktopNav('locations');
    setTimeout(function(){
      locAddNewAtCoords(stop.lat, stop.lng, addr);
    }, 400);
  }
}

function drSelectPlace(name) {
  var inp = document.getElementById('dr-tag-name');
  if (inp) inp.value = name;
}

function drSaveTagLocation() {
  var nameEl = document.getElementById('dr-tag-name');
  var typeEl = document.getElementById('dr-tag-type');
  var name = nameEl ? nameEl.value.trim() : '';
  var type = typeEl ? typeEl.value : 'other';
  if (!name) { showToast('Enter a location name'); return; }
  var stop = DRState.stops[DRState.tagStopIdx];
  if (!stop) return;

  // Determine if billable type
  var billableTypes = ['customer','vendor'];
  var locationType = ['customer','vendor','personal'].indexOf(type) >= 0 ? type : 'personal';
  var isBillable = billableTypes.indexOf(type) >= 0;

  var payload = {
    name: name,
    location_type: locationType,
    lat: stop.lat,
    lng: stop.lng,
    geofence_radius: parseInt(AppState.settings.geofence_radius_default || 100),
    geocode_status: 'tech_verified',
    geocoded_at: new Date().toISOString(),
    geocoded_by: AppState.userEmail,
    billable_default: isBillable,
    requires_wo: locationType === 'customer',
    is_personal: locationType === 'personal',
    is_primary: true,
    active: true,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  };

  sb.post('locations', payload).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      var newLoc = r.data[0];
      DRState.locations.push(newLoc);
      if (LocState.locations) LocState.locations.push(newLoc);
      stop.location = newLoc;
      stop.stopType = isBillable ? (locationType === 'customer' ? 'job_site' : 'billable_errand') : 'non_billable';
      showToast('Location saved');
      if (isBillable) {
        DRState.tagStep = 2;
        drRenderTagOverlay();
      } else {
        drCloseTagOverlay();
        drRenderTimeline();
        drRenderMapTrail();
        // Prompt to add another location at same address
        drPromptAddAnother(stop);
      }
    } else {
      showToast('Error saving location');
    }
  });
}

// ── Day actions ───────────────────────────────────────────────
function drAcceptDay() {
  if (!confirm('Accept this day? Billable time entries will be locked.')) return;
  drUpsertDayReview({status:'accepted', sync_status:'accepted', accepted_at: new Date().toISOString(), accepted_by: AppState.userEmail});
}

function drKickBack() {
  var tech = AppState.technicians.find(function(t){return t.id===DRState.tech;});
  var techName = tech ? tech.name.split(' ')[0] : 'tech';
  var reason = prompt('Reason for kicking back to ' + techName + ':');
  if (!reason) return;
  drUpsertDayReview({status:'kicked_back', kickback_at: new Date().toISOString(), kickback_by: AppState.userEmail, kickback_reason: reason});
}

function drReopenDay() {
  if (!confirm('Re-open this accepted day?')) return;
  drUpsertDayReview({status:'submitted', sync_status:'ready', accepted_at: null, accepted_by: null});
}

// =============================================================
// MOBILE FIELD TRAVEL LOG — extracted from app-core.js v4.41
// =============================================================

// =============================================================
// MOBILE DAILY REVIEW
// =============================================================

var MDRState = {
  tech: null,
  selectedDate: null,
  weekStart: null,
  view: 'day',        // 'day' or 'week'
  pings: [],
  stops: [],
  locations: [],
  hoursEntries: [],
  dayReviews: [],
  selectedStop: null,
  tagStopIdx: null,
  tagStep: 0
};

function initMobileDailyReview() {
  MDRState.tech = AppState.userTechId || drGetDefaultTech() || (AppState.technicians[0] && AppState.technicians[0].id);
  if (!MDRState.selectedDate) MDRState.selectedDate = drTodayStr();
  MDRState.weekStart = MDRState.weekStart || drGetMonday(new Date());
  MDRState.view = MDRState.view || 'day';
  MDRState.locations = LocState.locations.length ? LocState.locations : [];
  mdrRender();
}

function mdrRender() {
  var el = document.getElementById('mdr-shell');
  if (!el) return;
  var html = '';
  // Topbar — single line
  html += '<div style="background:#1a5fa8;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0">';
  html += '<div style="color:#fff;font-size:14px;font-weight:600;white-space:nowrap">Field Travel Log</div>';
  if (AppState.userRole === 'admin') {
    html += '<select onchange="mdrOnTechChange(this.value)" style="font-size:12px;padding:3px 6px;border:none;border-radius:4px;background:#ffffff22;color:#fff;flex:1;max-width:160px">';
    AppState.technicians.forEach(function(t){
      html += '<option value="' + t.id + '"' + (t.id===MDRState.tech?' selected':'') + ' style="color:#000">' + escHtml(t.name) + '</option>';
    });
    html += '</select>';
  } else {
    var tech = AppState.technicians.find(function(t){return t.id===MDRState.tech;});
    html += '<div style="color:#ffffff99;font-size:12px">' + escHtml(tech ? tech.name : '') + '</div>';
  }
  html += '</div>';
  // Day/Week toggle + nav
  html += '<div style="background:#154d8c;padding:6px 12px;display:flex;align-items:center;gap:8px;flex-shrink:0">';
  if (MDRState.view === 'day') {
    html += '<button onclick="mdrNavDay(-1)" style="color:#fff;background:none;border:none;font-size:20px;cursor:pointer;padding:2px 8px">&#8249;</button>';
    html += '<div style="flex:1;text-align:center"><div style="color:#fff;font-size:13px;font-weight:500" id="mdr-date-display">' + mdrFormatDate(MDRState.selectedDate) + '</div>';
    html += '<div style="color:#ffffff88;font-size:10px" id="mdr-date-sub">' + (MDRState.selectedDate===drTodayStr()?'Today':'') + '</div></div>';
    html += '<button onclick="mdrNavDay(1)" style="color:#fff;background:none;border:none;font-size:20px;cursor:pointer;padding:2px 8px">&#8250;</button>';
  } else {
    var weekEnd = drAddDays(MDRState.weekStart, 6);
    html += '<button onclick="mdrNavWeek(-1)" style="color:#fff;background:none;border:none;font-size:20px;cursor:pointer;padding:2px 8px">&#8249;</button>';
    html += '<div style="flex:1;text-align:center"><div style="color:#fff;font-size:13px;font-weight:500">' + drDateStr(MDRState.weekStart) + ' &ndash; ' + drDateStr(weekEnd) + '</div></div>';
    html += '<button onclick="mdrNavWeek(1)" style="color:#fff;background:none;border:none;font-size:20px;cursor:pointer;padding:2px 8px">&#8250;</button>';
  }
  html += '</div>';
  // Content
  html += '<div id="mdr-content" style="flex:1;overflow-y:auto"></div>';
  // Bottom bar
  html += '<div id="mdr-bottom" style="background:var(--surface);border-top:1px solid var(--border);padding:10px 14px;flex-shrink:0">';
  html += '<div style="display:flex;gap:8px">';
  html += '<div onclick="mdrSetView(\'day\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (MDRState.view==='day'?'var(--bg-accent);color:var(--text-accent)':'var(--surface);color:var(--text-secondary)') + '">Day view</div>';
  html += '<div onclick="mdrSetView(\'week\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (MDRState.view==='week'?'var(--bg-accent);color:var(--text-accent)':'var(--surface);color:var(--text-secondary)') + '">Week summary</div>';
  html += '</div></div>';
  el.innerHTML = html;
  if (MDRState.view === 'day') {
    mdrLoadDay(MDRState.selectedDate);
  } else {
    mdrLoadWeek();
  }
}

function mdrFormatDate(dateStr) {
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]), 12);
  return d.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'});
}

function mdrOnTechChange(id) {
  MDRState.tech = id;
  mdrRender();
}

function mdrSetView(v) {
  MDRState.view = v;
  mdrRender();
}

function mdrNavDay(dir) {
  var parts = MDRState.selectedDate.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2])+dir, 12);
  MDRState.selectedDate = drDateStr(d);
  MDRState.weekStart = drGetMonday(d);
  var dateEl = document.getElementById('mdr-date-display');
  var subEl = document.getElementById('mdr-date-sub');
  if (dateEl) dateEl.textContent = mdrFormatDate(MDRState.selectedDate);
  if (subEl) subEl.textContent = MDRState.selectedDate === drTodayStr() ? 'Today' : '';
  mdrLoadDay(MDRState.selectedDate);
}

function mdrNavWeek(dir) {
  MDRState.weekStart = drAddDays(MDRState.weekStart, dir*7);
  mdrLoadWeek();
}

// ── Day view ──────────────────────────────────────────────────
function mdrLoadDay(dateStr) {
  var content = document.getElementById('mdr-content');
  if (content) content.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Loading...</div>';
  var tid = drGetTechTidForTech(MDRState.tech);
  if (!tid) {
    if (content) content.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">No OwnTracks ID set for this technician.</div>';
    return;
  }
  var fromUTC = drLocalMidnightUTC(dateStr);
  var toUTC = drNextLocalMidnightUTC(dateStr);
  Promise.all([
    sb.get('location_event', '?tid=eq.'+tid+'&timestamp=gte.'+fromUTC+'&timestamp=lt.'+toUTC+'&select=id,tid,timestamp,lat,lng,accuracy,speed,battery&order=timestamp.asc&limit=10000'),
    sb.get('hours_entries', '?tech_id=eq.'+MDRState.tech+'&entry_date=eq.'+dateStr+'&select=*,work_orders(wo_number,customers(display_name,name))&order=created_at.asc'),
    sb.get('day_review', '?tech_id=eq.'+MDRState.tech+'&review_date=eq.'+dateStr+'&select=*')
  ]).then(function(results) {
    MDRState.pings = (results[0].ok && results[0].data) ? results[0].data : [];
    MDRState.hoursEntries = (results[1].ok && results[1].data) ? results[1].data : [];
    var dr = (results[2].ok && results[2].data && results[2].data.length) ? results[2].data[0] : null;
    MDRState.currentDayReview = dr; // store for re-renders
    if (!MDRState.locations.length) {
      sb.get('locations', '?active=eq.true&select=*').then(function(r) {
        MDRState.locations = (r.ok && r.data) ? r.data : [];
        mdrRenderDay(dr);
      });
    } else {
      mdrRenderDay(dr);
    }
  });
}

function drGetTechTidForTech(techId) {
  var tech = AppState.technicians.find(function(t){ return t.id === techId; });
  return tech ? (tech.tid || null) : null;
}

function mdrRebuildAllocationsFromEntries() {
  var ASSOC_RADIUS = parseInt(AppState.settings.geofence_radius_default || '100') * 3;
  MDRState.stops.forEach(function(stop){ stop.allocations = []; });
  MDRState.hoursEntries.forEach(function(entry) {
    if (!entry.location_id) return;
    var entryLoc = MDRState.locations.find(function(l){ return l.id === entry.location_id; });
    if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
    var bestStop = null;
    var bestDist = Infinity;
    MDRState.stops.forEach(function(s) {
      var dist = drHaversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
      if (dist < bestDist) { bestDist = dist; bestStop = s; }
    });
    if (bestStop && bestDist <= ASSOC_RADIUS) {
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
        isBillable: entry.billable !== false
      });
    }
  });
}

function mdrRenderDay(dayReview) {
  if (dayReview === null || dayReview === undefined) dayReview = MDRState.currentDayReview || null;
  var content = document.getElementById('mdr-content');
  if (!content) return;
  MDRState.stops = drDetectStops(MDRState.pings, MDRState.locations);
  mdrRebuildAllocationsFromEntries();
  var dayStatus = dayReview ? dayReview.status : 'none';
  var kickbackReason = dayReview ? dayReview.kickback_reason : null;

  if (!MDRState.pings.length) {
    content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">No GPS data for this day</div>';
    mdrRenderDayBottom(dayReview);
    return;
  }

  var totalGPSMin = MDRState.stops.reduce(function(s,st){return s+drElapsedMin(st);},0);
  var totalPaidH = MDRState.stops.filter(function(s){return s.isPaid!==false && s.location;}).reduce(function(s,st){return s+(drElapsedMin(st)/60);},0);
  var totalBilledH = MDRState.stops.filter(function(s){return s.isBillable&&s.location;}).reduce(function(s,st){return s+(drElapsedMin(st)/60);},0);
  var untagged = MDRState.stops.filter(function(s){return !s.location;}).length;

  var html = '';

  // Kickback notice
  if (dayStatus === 'kicked_back' && kickbackReason) {
    html += '<div style="background:#fcebeb;border-bottom:1px solid #f09595;padding:10px 14px">';
    html += '<div style="font-size:11px;font-weight:700;color:#a32d2d;margin-bottom:3px">&#9888; Kicked back</div>';
    html += '<div style="font-size:12px;color:#a32d2d">' + escHtml(kickbackReason) + '</div>';
    html += '<div style="margin-top:8px"><textarea id="mdr-response-text" placeholder="Your response (optional)..." style="width:100%;font-size:12px;padding:5px 8px;border:1px solid #f09595;border-radius:4px;background:#fff;resize:none;height:60px"></textarea></div>';
    html += '</div>';
  }

  // Summary strip
  html += '<div style="background:var(--surface);border-bottom:1px solid var(--border);display:flex;padding:8px 0;flex-shrink:0">';
  html += '<div style="flex:1;text-align:center"><div style="font-size:16px;font-weight:600">' + drFormatDuration(totalGPSMin) + '</div><div style="font-size:10px;color:var(--text-muted)">Elapsed</div></div>';
  html += '<div style="flex:1;text-align:center;border-left:1px solid var(--border)"><div style="font-size:16px;font-weight:600">' + totalPaidH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Paid</div></div>';
  html += '<div style="flex:1;text-align:center;border-left:1px solid var(--border)"><div style="font-size:16px;font-weight:600">' + totalBilledH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
  html += '<div style="flex:1;text-align:center;border-left:1px solid var(--border)"><div style="font-size:16px;font-weight:600' + (untagged>0?';color:#854f0b':'') + '">' + untagged + '</div><div style="font-size:10px;color:var(--text-muted)">Untagged</div></div>';
  html += '</div>';

  // Timeline
  html += '<div style="padding:10px 12px">';
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  var clockInTime = clockIn ? new Date(clockIn) : null;
  var clockOutTime = clockOut ? new Date(clockOut) : new Date();

  // If not clocked in, show prompt only
  if (!clockIn) {
    html += '<div style="text-align:center;padding:30px 0;color:var(--text-muted);font-size:13px">Clock in to start tracking your work day.</div>';
    html += '</div>';
    content.innerHTML = html;
    mdrRenderDayBottom(dayReview);
    return;
  }

  // Filter stops to work window — suppress secondary merged segments
  var mdrMergedSecondaryKeys = {};
  if (dayReview && dayReview.merged_stops) {
    var mdrMs = [];
    try { mdrMs = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e){}
    if (!Array.isArray(mdrMs)) mdrMs = [];
    mdrMs.forEach(function(m){ (m.mergedSegments||[]).forEach(function(seg){ if (seg.arrivedAt) mdrMergedSecondaryKeys[seg.arrivedAt] = true; }); });
  }
  var workStops = MDRState.stops.filter(function(s) {
    return new Date(s.leftAt) >= clockInTime && new Date(s.arrivedAt) <= clockOutTime && !mdrMergedSecondaryKeys[s.arrivedAt];
  });

  // Clock in event
  html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0"><div style="width:10px;height:10px;border-radius:50%;background:#27ae60;flex-shrink:0"></div><div style="font-size:12px;color:#3b6d11;font-weight:600">Clocked in</div><div style="margin-left:auto;font-size:12px;font-weight:500">' + drFormatTime(clockIn) + '</div></div>';

  workStops.forEach(function(stop, idx) {
    var isSelected = MDRState.selectedStop === MDRState.stops.indexOf(stop);
    var origIdx = MDRState.stops.indexOf(stop);
    var hasAllocations = stop.allocations && stop.allocations.length > 0;
    var locName = stop.location ? stop.location.name : 'Unknown stop';
    var locType = stop.location ? (stop.location.location_type||'untagged') : 'untagged';
    var isUntagged = !stop.location;
    var mdrAllocCustomers = '';
    if (hasAllocations) {
      var mdrCustNames = [];
      stop.allocations.forEach(function(a){ if (a.customerName && mdrCustNames.indexOf(a.customerName) < 0) mdrCustNames.push(a.customerName); });
      if (mdrCustNames.length) mdrAllocCustomers = mdrCustNames.join(', ');
    }

    // Drive segment
    if (idx > 0) {
      var prev = workStops[idx-1];
      var prevTime = new Date(prev.leftAt);
      var driveMin = Math.round((new Date(stop.arrivedAt)-prevTime)/60000);
      var driveCap = parseInt(AppState.settings.gps_drive_cap_minutes || '240');
      var gapThreshold = parseInt(AppState.settings.gps_gap_threshold || '10');
      var isDataError = driveMin > driveCap;
      var mdrWindowStart = prevTime;
      var mdrWindowEnd = new Date(stop.arrivedAt);
      var mdrPingsInWindow = (MDRState.pings || []).filter(function(p){ var t = new Date(p.timestamp); return t >= mdrWindowStart && t <= mdrWindowEnd; });
      var isGpsGap = !isDataError && mdrPingsInWindow.length === 0 && driveMin > gapThreshold;
      html += '<div style="width:2px;background:var(--border);margin-left:4px;height:10px"></div>';
      if (isDataError) {
        html += '<div style="display:flex;align-items:center;gap:5px;padding:2px 0;margin-left:3px"><span style="font-size:10px;color:#a32d2d">&#9888;</span><div style="flex:1;border-top:1px dashed #f09595"></div><span style="font-size:10px;color:#a32d2d;white-space:nowrap">Data error</span></div>';
      } else if (isGpsGap) {
        html += '<div style="display:flex;align-items:center;gap:5px;padding:2px 0;margin-left:3px"><span style="font-size:10px;color:#854f0b">&#8943;</span><div style="flex:1;border-top:1px dashed #ef9f27"></div><span style="font-size:10px;color:#854f0b;white-space:nowrap">GPS gap ' + driveMin + 'm</span></div>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:5px;padding:2px 0;margin-left:3px"><span style="font-size:10px;color:var(--text-muted)">&#9654;</span><div style="flex:1;border-top:1px dashed var(--border)"></div><span style="font-size:10px;color:var(--text-muted);white-space:nowrap">' + driveMin + ' min</span></div>';
      }
      html += '<div style="width:2px;background:var(--border);margin-left:4px;height:10px"></div>';
    }

    var borderColor = isUntagged ? '#ef9f27' : isSelected ? '#1a5fa8' : 'var(--border)';
    var icColor = locType==='customer'?'#e6f1fb;color:#185fa5':locType==='vendor'?'#eaf3de;color:#3b6d11':'#faeeda;color:#854f0b';
    var icLabel = locType==='customer'?'C':locType==='vendor'?'V':isUntagged?'?':'P';
    var badgeColor = isUntagged?'#faeeda;color:#854f0b':stop.allocations&&stop.allocations.length?'#eaf3de;color:#3b6d11':'var(--surface);color:var(--text-muted);border:1px solid var(--border)';
    var badgeText = isUntagged?'Untagged':stop.allocations&&stop.allocations.length?'Allocated':'No entries';

    html += '<div style="border:1px solid ' + borderColor + ';border-radius:10px;margin-bottom:4px;overflow:hidden;cursor:pointer" onclick="mdrSelectStop(' + origIdx + ')">';
    html += '<div style="padding:9px 11px;display:flex;align-items:center;gap:8px;background:var(--surface)">';
    html += '<div style="width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;background:' + icColor + '">' + icLabel + '</div>';
    html += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(locName) + '</div>' +
      (mdrAllocCustomers ? '<div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(mdrAllocCustomers) + '</div>' : '');
    html += '<div style="font-size:11px;color:var(--text-secondary)">' + drFormatTime(stop.arrivedAt) + ' &ndash; ' + drFormatTime(stop.leftAt) + ' &middot; ' + drFormatDuration(drElapsedMin(stop)) + '</div></div>';
    html += '<span style="padding:2px 7px;border-radius:99px;font-size:10px;font-weight:500;background:' + badgeColor + ';flex-shrink:0">' + badgeText + '</span>';
    html += '</div>';

    // Expanded body
    if (isSelected) {
      html += '<div style="padding:10px 12px;background:var(--bg);border-top:1px solid var(--border)">';
      if (isUntagged) {
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">' + stop.lat.toFixed(5) + '&deg; N, ' + Math.abs(stop.lng).toFixed(5) + '&deg; W</div>';
        html += '<a href="https://maps.google.com/?q=' + stop.lat + ',' + stop.lng + '" target="_blank" style="font-size:11px;color:var(--text-accent);display:block;margin-bottom:8px">Open in Google Maps</a>';
        html += '<div style="display:flex;gap:6px;margin-top:4px">';
        html += '<button onclick="event.stopPropagation();mdrStartTag(' + origIdx + ')" style="flex:1;padding:8px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer">Identify this stop</button>';
        html += '<button onclick="event.stopPropagation();mdrMarkNotBillable(' + origIdx + ')" style="padding:8px 14px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">Mark not billable</button>';
        html += '</div>';
      } else {
        var addr = [stop.location.address_street, stop.location.city, stop.location.state].filter(Boolean).join(', ');
        if (addr) html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">' + escHtml(addr) + '</div>';
        // Pay/Bill toggles
        var isPaid = stop.isPaid !== false;
        var isBillable = stop.isBillable !== false && locType === 'customer';
        html += '<div style="display:flex;gap:8px;margin-bottom:10px">';
        html += '<div onclick="event.stopPropagation();mdrTogglePaid(' + idx + ')" style="flex:1;padding:12px 8px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;border:1.5px solid var(--border);cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:center;background:' + (isPaid?'#eaf3de;color:#3b6d11':'var(--surface);color:var(--text-muted)') + '">' + (isPaid?'&#10003; Paid':'Unpaid') + '</div>';
        if (locType==='customer') {
          html += '<div onclick="event.stopPropagation();mdrToggleBillable(' + idx + ')" style="flex:1;padding:12px 8px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;border:1.5px solid var(--border);cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:center;background:' + (isBillable?'#e6f1fb;color:#185fa5':'var(--surface);color:var(--text-muted)') + '">' + (isBillable?'&#10003; Billable':'Non-billable') + '</div>';
        }
        html += '</div>';
        html += '<button onclick="event.stopPropagation();mdrStartAllocate(' + origIdx + ')" style="width:100%;padding:8px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer">' + (stop.allocations&&stop.allocations.length?'Edit allocation':'Allocate time') + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
  });

  html += '<div style="width:2px;background:var(--border);margin-left:4px;height:10px"></div>';
  if (clockOut) {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0"><div style="width:10px;height:10px;border-radius:50%;background:#a32d2d;flex-shrink:0"></div><div style="font-size:12px;color:#a32d2d;font-weight:600">Clocked out</div><div style="margin-left:auto;font-size:12px;font-weight:500">' + drFormatTime(clockOut) + '</div></div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0"><div style="width:10px;height:10px;border-radius:50%;background:#888;flex-shrink:0"></div><div style="font-size:12px;color:var(--text-muted)">Still on clock</div></div>';
  }
  html += '</div>';

  content.innerHTML = html;
  mdrRenderDayBottom(dayReview);
}

function mdrRenderDayBottom(dayReview) {
  var el = document.getElementById('mdr-bottom');
  if (!el) return;
  var dayStatus = dayReview ? dayReview.status : 'none';
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  var untagged = MDRState.stops.filter(function(s){return !s.location;}).length;
  var canSubmit = untagged === 0 && dayStatus !== 'accepted' && dayStatus !== 'submitted';
  var html = '';

  // Clock in/out row
  html += '<div style="display:flex;gap:6px;margin-bottom:8px">';
  if (clockIn) {
    html += '<div style="flex:1;text-align:center;font-size:11px;padding:5px;background:#eaf3de;border-radius:6px;color:#3b6d11">In: ' + drFormatTime(clockIn) + '</div>';
    if (!clockOut) {
      html += '<button onclick="mdrGoToEndOfDay()" style="flex:1;padding:5px;background:#a32d2d;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">End of Day →</button>';
    } else {
      html += '<div style="flex:1;text-align:center;font-size:11px;padding:5px;background:#fcebeb;border-radius:6px;color:#a32d2d">Out: ' + drFormatTime(clockOut) + '</div>';
    }
    html += '<button onclick="mdrEditPunch()" style="padding:5px 8px;background:none;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;color:var(--text-muted)">Edit</button>';
  } else {
    html += '<button onclick="mdrClockIn()" style="flex:1;padding:8px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Clock in</button>';
  }
  html += '</div>';

  if (dayStatus === 'accepted') {
    html += '<div style="text-align:center;font-size:12px;color:#3b6d11;margin-bottom:8px">&#10003; Day accepted</div>';
  } else if (dayStatus === 'submitted') {
    html += '<div style="text-align:center;font-size:12px;color:#854f0b;margin-bottom:8px">Submitted — awaiting review</div>';
  } else if (dayStatus === 'kicked_back') {
    html += '<button onclick="mdrResubmitDay()" style="width:100%;padding:10px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px">Re-submit day</button>';
  } else {
    html += '<button onclick="mdrSubmitDay()" ' + (!canSubmit?'disabled':'') + ' style="width:100%;padding:10px;background:' + (canSubmit?'#27ae60':'var(--surface)') + ';color:' + (canSubmit?'#fff':'var(--text-muted)') + ';border:' + (canSubmit?'none':'1px solid var(--border)') + ';border-radius:8px;font-size:13px;font-weight:600;cursor:' + (canSubmit?'pointer':'not-allowed') + ';margin-bottom:8px">';
    if (!canSubmit && untagged > 0) html += 'Resolve ' + untagged + ' untagged stop' + (untagged>1?'s':'') + ' to submit';
    else html += 'Submit day for review';
    html += '</button>';
  }
  html += '<div style="display:flex;gap:8px">';
  html += '<div onclick="mdrSetView(\'day\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (MDRState.view==='day'?'var(--bg-accent);color:var(--text-accent)':'var(--surface);color:var(--text-secondary)') + '">Day view</div>';
  html += '<div onclick="mdrSetView(\'week\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:' + (MDRState.view==='week'?'var(--bg-accent);color:var(--text-accent)':'var(--surface);color:var(--text-secondary)') + '">Week summary</div>';
  html += '</div>';
  el.innerHTML = html;
}

function mdrSelectStop(idx) {
  MDRState.selectedStop = MDRState.selectedStop === idx ? null : idx;
  var dayReview = null;
  mdrRenderDay(dayReview);
}

function mdrTogglePaid(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var key = stop.arrivedAt;
  var dayReview = MDRState.currentDayReview;
  var flags = {};
  if (dayReview && dayReview.stop_flags) {
    try { flags = typeof dayReview.stop_flags === 'string' ? JSON.parse(dayReview.stop_flags) : dayReview.stop_flags; } catch(e){}
  }
  if (!flags[key]) flags[key] = {};
  flags[key].paid = flags[key].paid === false ? true : false;
  stop.isPaid = flags[key].paid !== false;
  if (dayReview) {
    sb.patch('day_review', dayReview.id, { stop_flags: flags, modified_by: AppState.userEmail, modified_at: new Date().toISOString() });
    dayReview.stop_flags = flags;
  }
  mdrRenderDay(null);
}

function mdrToggleBillable(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var key = stop.arrivedAt;
  var dayReview = MDRState.currentDayReview;
  var flags = {};
  if (dayReview && dayReview.stop_flags) {
    try { flags = typeof dayReview.stop_flags === 'string' ? JSON.parse(dayReview.stop_flags) : dayReview.stop_flags; } catch(e){}
  }
  if (!flags[key]) flags[key] = {};
  flags[key].billable = flags[key].billable === false ? true : false;
  stop.isBillable = flags[key].billable !== false;
  if (dayReview) {
    sb.patch('day_review', dayReview.id, { stop_flags: flags, modified_by: AppState.userEmail, modified_at: new Date().toISOString() });
    dayReview.stop_flags = flags;
  }
  mdrRenderDay(null);
}

// ── Mobile stop tagging ───────────────────────────────────────
function mdrStartTag(idx) {
  MDRState.tagStopIdx = idx;
  MDRState.tagStep = 1;
  MDRState.identifyStep = 'type';
  MDRState.identifyType = null;
  MDRState.identifyEntityId = null;
  MDRState.identifyEntityName = null;
  mdrRenderTagSheet();
}

function mdrStartAllocate(idx) {
  MDRState.tagStopIdx = idx;
  MDRState.tagStep = 2;
  mdrRenderTagSheet();
}

function mdrCloseTagSheet() {
  var el = document.getElementById('mdr-tag-sheet');
  if (el) el.remove();
}

function mdrRenderTagSheet() {
  mdrCloseTagSheet();
  var shell = document.getElementById('mdr-shell');
  if (!shell) return;
  var stop = MDRState.stops[MDRState.tagStopIdx];
  if (!stop) return;
  var div = document.createElement('div');
  div.id = 'mdr-tag-sheet';
  div.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:var(--surface);border-radius:16px 16px 0 0;box-shadow:0 -4px 20px rgba(0,0,0,0.2);z-index:100;max-height:80%;overflow-y:auto;display:flex;flex-direction:column';
  shell.style.position = 'relative';

  if (MDRState.tagStep === 1) {
    mdrBuildTagSheet(div, stop);
  } else {
    mdrBuildAllocateSheet(div, stop);
  }
  shell.appendChild(div);
  if (MDRState.tagStep === 1) mdrFetchPlacesMobile(stop.lat, stop.lng);
}

function mdrBuildTagSheet(div, stop) {
  var step = MDRState.identifyStep || 'type';
  var type = MDRState.identifyType || '';
  var html = '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  html += '<div style="font-size:14px;font-weight:600">Identify stop</div>';
  html += '<button onclick="mdrCloseTagSheet()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">&times;</button>';
  html += '</div>';
  html += '<div style="padding:12px 16px">';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">' + drFormatTime(stop.arrivedAt) + ' &ndash; ' + drFormatTime(stop.leftAt) + ' &middot; ' + drFormatDuration(drElapsedMin(stop)) + '</div>';

  if (step === 'type') {
    html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">What type of location is this?</div>';
    var types = [{k:'customer',l:'Customer',bg:'#e6f1fb',col:'#185fa5'},{k:'vendor',l:'Vendor',bg:'#eaf3de',col:'#3b6d11'},{k:'personal',l:'Personal',bg:'#faeeda',col:'#854f0b'},{k:'office',l:'Office',bg:'#f1efff',col:'#534ab7'},{k:'other',l:'Other',bg:'var(--surface)',col:'var(--text-secondary)'}];
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
    types.forEach(function(t) {
      html += '<button onclick="mdrIdentifyTypeSelect(\'' + t.k + '\')" style="font-size:13px;padding:8px 16px;background:' + t.bg + ';color:' + t.col + ';border:1px solid ' + t.col + ';border-radius:99px;cursor:pointer;font-weight:600">' + t.l + '</button>';
    });
    html += '</div>';
  } else {
    var label = type === 'customer' ? 'Which customer?' : type === 'vendor' ? 'Which vendor?' : 'Name this location';
    html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">' + label + '</div>';
    if (type === 'customer' || type === 'vendor') {
      html += '<input type="text" id="mdr-identify-search" placeholder="Search ' + type + 's..." oninput="mdrIdentifySearch(this.value)" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);box-sizing:border-box;margin-bottom:8px">';
      html += '<div id="mdr-identify-results" style="margin-bottom:8px"></div>';
    }
    if (type === 'personal') {
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Personal stops default to non-billable time.</div>';
    }
    if (type === 'office') {
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Office stops default to non-billable. You\'ll be prompted if billable time occurred here.</div>';
    }
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Location name</div>';
    html += '<input type="text" id="mdr-tag-name" placeholder="e.g. Home Depot Rt 13" style="width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);box-sizing:border-box;margin-bottom:12px">';
    html += '<div style="display:flex;gap:8px">';
    html += '<button onclick="mdrIdentifyBack()" style="flex:1;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px">Back</button>';
    html += '<button onclick="mdrSaveTagLocation()" style="flex:2;padding:10px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Save location</button>';
    html += '</div>';
  }
  html += '</div>';
  div.innerHTML = html;
}

function mdrIdentifyTypeSelect(type) {
  MDRState.identifyStep = 'entity';
  MDRState.identifyType = type;
  MDRState.identifyEntityId = null;
  MDRState.identifyEntityName = null;
  mdrRenderTagSheet();
}

function mdrIdentifyBack() {
  MDRState.identifyStep = 'type';
  MDRState.identifyType = null;
  mdrRenderTagSheet();
}

function mdrIdentifySearch(val) {
  var el = document.getElementById('mdr-identify-results');
  if (!el) return;
  var q = val.toLowerCase().trim();
  var type = MDRState.identifyType;
  var results = [];
  if (type === 'customer') {
    results = AppState.customers.filter(function(c) {
      return c.active !== false && (!q || (c.name||'').toLowerCase().indexOf(q) >= 0 || (c.display_name||'').toLowerCase().indexOf(q) >= 0);
    }).slice(0, 8);
  } else if (type === 'vendor') {
    results = AppState.vendors.filter(function(v) {
      return !q || (v.name||'').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
  }
  if (!results.length) {
    el.innerHTML = q ? '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No matches — will save as new location</div>' : '';
    return;
  }
  var html = '';
  results.forEach(function(r) {
    var name = r.display_name || r.name || '';
    html += '<div onclick="event.stopPropagation();mdrIdentifySelectEntity(\'' + escHtml(r.id) + '\',\'' + escHtml(name.replace(/'/g,'\\\'')) + '\')" style="padding:8px 10px;cursor:pointer;border-radius:8px;font-size:13px;border:0.5px solid var(--border);margin-bottom:4px;background:var(--surface)">' + escHtml(name) + '</div>';
  });
  el.innerHTML = html;
}

function mdrIdentifySelectEntity(id, name) {
  MDRState.identifyEntityId = id;
  MDRState.identifyEntityName = name;
  var nameEl = document.getElementById('mdr-tag-name');
  if (nameEl) nameEl.value = name;
  var resultsEl = document.getElementById('mdr-identify-results');
  if (resultsEl) resultsEl.innerHTML = '<div style="font-size:12px;color:#3b6d11;padding:4px 0">&#10003; ' + escHtml(name) + ' selected</div>';
}

function mdrBuildAllocateSheet(div, stop) {
  var gpsH = drElapsedMin(stop) / 60;
  var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);
  var belowMin = gpsH > 0 && gpsH < minBilling;
  var html = '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  html += '<div style="font-size:14px;font-weight:600">Allocate time</div>';
  html += '<button onclick="mdrCloseTagSheet()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted)">&times;</button>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border)">';
  html += '<div style="font-size:13px;font-weight:600">' + escHtml(stop.location ? stop.location.name : '') + '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted)">Elapsed: ' + drFormatDuration(drElapsedMin(stop)) + (belowMin ? ' <span style="color:#854f0b">&#9888; under ' + minBilling + 'h minimum — review before export</span>' : '') + '</div>';
  html += '</div>';
  html += '<div style="padding:12px 16px;flex:1;overflow-y:auto">';
  html += '<div id="mdr-alloc-rows"></div>';
  html += '<button onclick="mdrAddAllocRow()" style="width:100%;padding:8px;border:1px dashed var(--border);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;margin-top:4px">+ Assign time to WO</button>';
  html += '<div id="mdr-alloc-summary" style="margin-top:8px;font-size:12px;color:var(--text-muted)"></div>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-top:1px solid var(--border)">';
  html += '<button onclick="mdrSaveAllocations(' + MDRState.tagStopIdx + ')" style="width:100%;padding:10px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Save</button>';
  html += '</div>';
  div.innerHTML = html;
  mdrAddAllocRow();
}

function mdrAddAllocRow() {
  var container = document.getElementById('mdr-alloc-rows');
  if (!container) return;
  var stop = MDRState.stops[MDRState.tagStopIdx];
  var allLive = AppState.workOrders.filter(function(w){
    if (w.active===false) return false;
    if (isProcessedStatus && isProcessedStatus(w.status)) return false;
    return true;
  });
  var filtered = (stop && stop.location && stop.location.customer_id)
    ? allLive.filter(function(w){ return w.customer_id === stop.location.customer_id; })
    : allLive;
  // Fall back to all live WOs if customer filter returns nothing
  var woList = filtered.length ? filtered : allLive;
  var woOptions = woList.slice(0,100).map(function(w){
    var isQuoted = w.form_mode === 'quoted';
    var label = escHtml(w.wo_number) + ' — ' + escHtml(w.title||'(no title)') + (isQuoted ? ' [QUOTED]' : '');
    return '<option value="' + w.id + '"' + (isQuoted ? ' style="color:#b45309;font-weight:600"' : '') + '>' + label + '</option>';
  }).join('');
  var htOptions = AppState.hoursTypes.map(function(t){
    return '<option value="' + t.id + '">' + escHtml(t.name) + '</option>';
  }).join('');
  var div = document.createElement('div');
  div.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:6px';
  div.innerHTML = '<select style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);margin-bottom:5px"><option value="">-- Select WO --</option>' + woOptions + '</select>'
    + '<div style="display:flex;gap:6px"><input type="number" placeholder="Hours" min="0" step="0.25" style="flex:1;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)" oninput="mdrUpdateAllocSummary(' + MDRState.tagStopIdx + ')">'
    + '<select style="flex:2;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">' + htOptions + '</select>'
    + '<button onclick="this.closest(\'div\').parentElement.remove();mdrUpdateAllocSummary(' + MDRState.tagStopIdx + ')" style="padding:6px 10px;border:1px solid var(--danger);border-radius:6px;color:var(--danger);background:none;cursor:pointer">&times;</button></div>';
  container.appendChild(div);
}

function mdrUpdateAllocSummary(idx) {
  var el = document.getElementById('mdr-alloc-summary');
  if (!el) return;
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var rows = document.querySelectorAll('#mdr-alloc-rows > div');
  var total = 0;
  rows.forEach(function(row){
    var inp = row.querySelector('input[type="number"]');
    if (inp) total += parseFloat(inp.value||0);
  });
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


// ── Morning Brief ─────────────────────────────────────────────

// Morning Brief, End of Day, and dispatch functions moved to app-morning-brief.js

function mdrSaveAllocations(idx) {
  var stop = MDRState.stops[idx];
  if (!stop) return;
  var rows = document.querySelectorAll('#mdr-alloc-rows > div');
  var allocations = [];
  var valid = true;
  rows.forEach(function(row) {
    var woSel = row.querySelector('select');
    var hoursInp = row.querySelector('input[type="number"]');
    var htSel = row.querySelectorAll('select')[1];
    var woId = woSel ? woSel.value : '';
    var hours = parseFloat(hoursInp ? hoursInp.value : 0);
    var htId = htSel ? htSel.value : '';
    if (!woId) { valid = false; showToast('Select a work order for each row'); return; }
    if (!hours || hours <= 0) { valid = false; showToast('Enter hours for each allocation'); return; }
    var wo = AppState.workOrders.find(function(w){return w.id===woId;});
    var ht = AppState.hoursTypes.find(function(t){return t.id===htId;});
    allocations.push({ woId: woId, woNumber: wo?wo.wo_number:'', customerName: wo?getCustName(wo.customers):'', hours: hours, htId: htId, rateName: ht?ht.name:'' });
  });
  if (!valid) return;
  if (!allocations.length) { showToast('Add at least one WO allocation'); return; }

  // Write hours_entries to Supabase
  var tech = AppState.userTechId || MDRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);
  var entryDate = MDRState.selectedDate || DRState.selectedDate || new Date().toISOString().slice(0,10);
  var locationId = stop.location ? stop.location.id : null;
  var descriptor = stop.location ? stop.location.name : 'GPS stop';

  var saves = allocations.map(function(alloc) {
    var ht = AppState.hoursTypes.find(function(t){return t.id===alloc.htId;});
    var internalRate = ht ? (ht.internal_rate_key ? parseFloat(ht.internal_rate_key) : 0) : 0;
    return sb.post('hours_entries', {
      work_order_id: alloc.woId,
      tech_id: tech,
      entry_date: entryDate,
      hours_type_id: alloc.htId || null,
      hours: alloc.hours,
      billable: true,
      location_id: locationId,
      descriptor: descriptor,
      internal_rate: internalRate || null,
      line_total: null,
      created_by: AppState.userEmail || 'field',
      modified_by: AppState.userEmail || 'field'
    });
  });

  Promise.all(saves).then(function(results) {
    var failed = results.filter(function(r){ return !r.ok; });
    if (failed.length) {
      showToast('Error saving ' + failed.length + ' allocation(s)');
      return;
    }
    stop.allocations = allocations;
    mdrCloseTagSheet();
    mdrRenderDay(null);
    showToast('Allocations saved to work order');
  }).catch(function(err) {
    showToast('Save failed — check connection');
  });
}

function mdrFetchPlacesMobile(lat, lng) {
  var el = document.getElementById('mdr-places-list');
  if (!el) return;
  if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Places API not available</div>';
    return;
  }
  var center = new google.maps.LatLng(lat, lng);
  google.maps.places.Place.searchNearby({
    fields: ['displayName','formattedAddress'],
    locationRestriction: { center: center, radius: 150 },
    maxResultCount: 6
  }).then(function(response) {
    var places = response.places || [];
    if (!places.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No nearby places found</div>'; return; }
    var html = '';
    places.forEach(function(place) {
      var name = place.displayName || '';
      var addr = (place.formattedAddress||'').split(',').slice(0,2).join(',');
      var safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      html += '<div onclick="mdrSelectPlace(\'' + safeName + '\')" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:5px;background:var(--bg)">';
      html += '<div style="font-size:13px;font-weight:500">' + escHtml(name) + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(addr) + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  }).catch(function(err) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Could not load suggestions — type a name above</div>';
  });
}

function mdrSelectPlace(name) {
  var inp = document.getElementById('mdr-tag-name');
  if (inp) inp.value = name;
}

function mdrSaveTagLocation() {
  var nameEl = document.getElementById('mdr-tag-name');
  var name = nameEl ? nameEl.value.trim() : '';
  var type = MDRState.identifyType || 'other';
  if (!name) { showToast('Enter a location name'); return; }
  var stop = MDRState.stops[MDRState.tagStopIdx];
  if (!stop) return;
  var billableTypes = ['customer','vendor'];
  var locationType = ['customer','vendor','personal','office','other'].indexOf(type) >= 0 ? type : 'other';
  var isBillable = billableTypes.indexOf(type) >= 0;
  var isPaid = type !== 'lunch' && type !== 'personal' && type !== 'office';
  var payload = {
    name: name,
    location_type: locationType,
    lat: stop.lat,
    lng: stop.lng,
    geofence_radius: parseInt(AppState.settings.geofence_radius_default || 100),
    geocode_status: 'approximate',
    billable_default: isBillable,
    requires_wo: locationType === 'customer',
    is_personal: locationType === 'personal',
    is_primary: true,
    active: true,
    status: 'pending',
    identified_from_stop: true,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  };
  if (locationType === 'customer' && MDRState.identifyEntityId) payload.customer_id = MDRState.identifyEntityId;
  if (locationType === 'vendor' && MDRState.identifyEntityId) payload.vendor_id = MDRState.identifyEntityId;
  sb.post('locations', payload).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      var newLoc = r.data[0];
      MDRState.locations.push(newLoc);
      if (LocState.locations) LocState.locations.push(newLoc);
      stop.location = newLoc;
      stop.isPaid = isPaid;
      stop.isBillable = isBillable;
      stop.allocations = stop.allocations || [];
      showToast('Location saved — pending review');
      mdrCloseTagSheet();
      if (isBillable) {
        MDRState.tagStep = 2;
        MDRState.selectedStop = MDRState.tagStopIdx;
        mdrRenderDay(null);
        setTimeout(function(){ mdrStartAllocate(MDRState.tagStopIdx); }, 100);
      } else {
        mdrRenderDay(null);
      }
    } else {
      showToast('Error saving location');
    }
  });
}

// ── Day submission ────────────────────────────────────────────
function mdrClockIn() {
  // Check if today is a scheduled workday
  var today = new Date();
  var dow = today.getDay();
  var techSchedule = AppState._techSchedules ? (AppState._techSchedules[MDRState.tech] || []) : [];
  var sched = techSchedule.find(function(s){ return s.day_of_week === dow; });
  var expectedStart = sched ? sched.expected_start : null;

  // Build time picker dialog
  var now = new Date();
  var nowStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var schedStr = expectedStart ? expectedStart.substring(0,5) : nowStr;

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Clock In</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Clock-in time:</div>' +
    '<input type="time" id="mdr-clockin-time" value="' + nowStr + '" style="width:100%;font-size:18px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:8px">' +
    (expectedStart ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">Scheduled start: ' + schedStr + ' &nbsp;<a href="#" onclick="document.getElementById(\'mdr-clockin-time\').value=\'' + schedStr + '\';return false" style="color:var(--header-bg)">Use scheduled time</a></div>' : '<div style="margin-bottom:16px"></div>') +
    '<div style="display:flex;gap:8px">' +
    '<button onclick="this.closest(\'div[style*=inset]\').remove()" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:8px;background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button onclick="mdrConfirmClockIn()" style="flex:1;padding:12px;background:#27ae60;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Clock In</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
}

function mdrEditPunch() {
  var dayReview = MDRState.currentDayReview || null;
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  var ciStr = clockIn ? new Date(clockIn).toTimeString().substring(0,5) : '';
  var coStr = clockOut ? new Date(clockOut).toTimeString().substring(0,5) : '';

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Edit Punch</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px">Clock in:</div>' +
    '<input type="time" id="mdr-edit-ci" value="' + ciStr + '" style="width:100%;font-size:16px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:12px">' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px">Clock out:</div>' +
    '<input type="time" id="mdr-edit-co" value="' + coStr + '" style="width:100%;font-size:16px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button onclick="this.closest(\'div[style*=inset]\').remove()" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:8px;background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button onclick="mdrSaveEditPunch()" style="flex:1;padding:12px;background:var(--header-bg);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Save</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
}

function mdrSaveEditPunch() {
  var ciEl = document.getElementById('mdr-edit-ci');
  var coEl = document.getElementById('mdr-edit-co');
  var overlay = ciEl ? ciEl.closest('div[style*="inset"]') : null;
  if (overlay) overlay.remove();
  var updates = {};
  if (ciEl && ciEl.value) {
    var ciDt = new Date(MDRState.selectedDate + 'T' + ciEl.value + ':00');
    updates.clock_in = ciDt.toISOString();
    updates.clock_in_backdated = true;
    updates.clock_in_source = 'manual';
  }
  if (coEl && coEl.value) {
    var coDt = new Date(MDRState.selectedDate + 'T' + coEl.value + ':00');
    updates.clock_out = coDt.toISOString();
    updates.clock_out_backdated = true;
    updates.clock_out_source = 'manual';
  }
  if (Object.keys(updates).length) mdrUpsertDayReview(updates);
}

function mdrConfirmClockIn() {
  var timeEl = document.getElementById('mdr-clockin-time');
  if (!timeEl) return;
  var timeVal = timeEl.value;
  var overlay = timeEl.closest('div[style*="inset"]');
  if (overlay) overlay.remove();
  var dt = new Date(MDRState.selectedDate + 'T' + timeVal + ':00');
  var isBackdated = dt < new Date(new Date() - 60000);
  // Optimistically update currentDayReview so Morning Brief sees clock_in immediately
  if (!MDRState.currentDayReview) MDRState.currentDayReview = {};
  MDRState.currentDayReview.clock_in = dt.toISOString();
  mdrUpsertDayReview({clock_in: dt.toISOString(), clock_in_backdated: isBackdated, clock_in_source: 'manual', status: 'pending', sync_status: 'pending'});
  // Navigate to Morning Brief after clock in
  setTimeout(function() {
    initMorningBrief();
    pushScreen('screen-morning-brief', 'Morning Brief');
  }, 400);
}

function mdrClockOut() {
  var now = new Date();
  var nowStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:flex-end';
  overlay.innerHTML =
    '<div style="width:100%;background:var(--surface);border-radius:16px 16px 0 0;padding:20px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Clock Out</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Clock-out time:</div>' +
    '<input type="time" id="mdr-clockout-time" value="' + nowStr + '" style="width:100%;font-size:18px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:16px">' +
    '<div style="display:flex;gap:8px">' +
    '<button onclick="this.closest(\'div[style*=inset]\').remove()" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:8px;background:none;font-size:14px;cursor:pointer">Cancel</button>' +
    '<button onclick="mdrConfirmClockOut()" style="flex:1;padding:12px;background:#a32d2d;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Clock Out</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
}

function mdrConfirmClockOut() {
  var timeEl = document.getElementById('mdr-clockout-time');
  if (!timeEl) return;
  var timeVal = timeEl.value;
  var overlay = timeEl.closest('div[style*="inset"]');
  if (overlay) overlay.remove();
  var dt = new Date(MDRState.selectedDate + 'T' + timeVal + ':00');
  var isBackdated = dt < new Date(new Date() - 60000);
  mdrUpsertDayReview({clock_out: dt.toISOString(), clock_out_backdated: isBackdated, clock_out_source: 'manual'});
}

function mdrSubmitDay() {
  if (!confirm('Submit ' + mdrFormatDate(MDRState.selectedDate) + ' for review?')) return;
  mdrUpsertDayReview({status:'submitted', sync_status:'submitted', submitted_at: new Date().toISOString(), submitted_by: AppState.userEmail});
}

function mdrResubmitDay() {
  var responseEl = document.getElementById('mdr-response-text');
  var response = responseEl ? responseEl.value.trim() : '';
  if (!confirm('Re-submit this day for review?')) return;
  var updates = {status:'submitted', sync_status:'submitted', submitted_at: new Date().toISOString(), submitted_by: AppState.userEmail};
  if (response) {
    updates.kickback_response = response;
    updates.kickback_response_at = new Date().toISOString();
    updates.kickback_response_by = AppState.userEmail;
  }
  mdrUpsertDayReview(updates);
}

function mdrUpsertDayReview(updates) {
  if (!MDRState.selectedDate) MDRState.selectedDate = drTodayStr();
  if (!MDRState.tech) MDRState.tech = AppState.userTechId || drGetDefaultTech() || (AppState.technicians[0] && AppState.technicians[0].id);
  updates.modified_by = AppState.userEmail;
  updates.modified_at = new Date().toISOString();
  sb.get('day_review', '?tech_id=eq.'+MDRState.tech+'&review_date=eq.'+MDRState.selectedDate+'&select=*').then(function(r) {
    var existing = r.ok && r.data && r.data.length ? r.data[0] : null;
    if (existing) {
      sb.patch('day_review', existing.id, updates).then(function(r2){
        if (r2.ok) { mdrLoadDay(MDRState.selectedDate); }
        else showToast('Error saving — check Supabase columns exist');
      });
    } else {
      var newRecord = Object.assign({ tech_id: MDRState.tech, review_date: MDRState.selectedDate, status:'pending', sync_status:'pending', created_by: AppState.userEmail }, updates);
      sb.post('day_review', newRecord).then(function(r2){
        if (r2.ok) { mdrLoadDay(MDRState.selectedDate); }
        else showToast('Error saving day record');
      });
    }
  });
}

// ── Week summary ──────────────────────────────────────────────
function mdrLoadWeek() {
  var content = document.getElementById('mdr-content');
  if (content) content.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Loading...</div>';
  var weekEnd = drAddDays(MDRState.weekStart, 6);
  var startStr = drDateStr(MDRState.weekStart);
  var endStr = drDateStr(weekEnd);
  Promise.all([
    sb.get('day_review', '?tech_id=eq.'+MDRState.tech+'&review_date=gte.'+startStr+'&review_date=lte.'+endStr+'&select=*'),
    sb.get('hours_entries', '?tech_id=eq.'+MDRState.tech+'&entry_date=gte.'+startStr+'&entry_date=lte.'+endStr+'&active=eq.true&select=*')
  ]).then(function(results) {
    MDRState.dayReviews = (results[0].ok && results[0].data) ? results[0].data : [];
    MDRState.hoursEntries = (results[1].ok && results[1].data) ? results[1].data : [];
    mdrRenderWeek();
  });
}

function mdrRenderWeek() {
  var content = document.getElementById('mdr-content');
  if (!content) return;
  var days = [];
  for (var i = 0; i < 7; i++) days.push(drAddDays(MDRState.weekStart, i));
  var dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

  // Calculate week totals from hours entries
  var totalPaid = MDRState.hoursEntries.reduce(function(s,e){return s+parseFloat(e.hours||0);},0);
  var minBilling = parseFloat(AppState.settings.billing_minimum_hours || 2);
  var otThreshold = 40;
  var regularH = Math.min(totalPaid, otThreshold);
  var otH = Math.max(0, totalPaid - otThreshold);
  var totalBilled = MDRState.hoursEntries.filter(function(e){return e.billable;}).reduce(function(s,e){return s+parseFloat(e.hours||0);},0);

  var html = '';

  // Week totals card
  html += '<div style="margin:12px;background:var(--surface);border:0.5px solid var(--border);border-radius:10px;padding:12px 14px">';
  html += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px">WEEK SUMMARY</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">';
  html += '<div style="text-align:center"><div style="font-size:18px;font-weight:500">' + totalPaid.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Paid hours</div></div>';
  html += '<div style="text-align:center"><div style="font-size:18px;font-weight:500' + (otH>0?';color:#854f0b':'') + '">' + otH.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Overtime</div></div>';
  html += '<div style="text-align:center"><div style="font-size:18px;font-weight:500">' + totalBilled.toFixed(1) + 'h</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
  html += '</div>';
  var remainingToOT = otThreshold - totalPaid;
  if (remainingToOT > 0 && remainingToOT < 5) {
    html += '<div style="background:#faeeda;border-radius:6px;padding:5px 8px;font-size:11px;color:#854f0b">&#9888; ' + remainingToOT.toFixed(1) + 'h until overtime</div>';
  }
  html += '</div>';

  // Day cards
  html += '<div style="padding:0 12px 80px">';
  days.forEach(function(d, i) {
    var ds = drDateStr(d);
    var review = MDRState.dayReviews.find(function(r){return r.review_date===ds;});
    var status = review ? review.status : 'none';
    var dayEntries = MDRState.hoursEntries.filter(function(e){return e.entry_date===ds;});
    var dayPaid = dayEntries.reduce(function(s,e){return s+parseFloat(e.hours||0);},0);
    var dayBilled = dayEntries.filter(function(e){return e.billable;}).reduce(function(s,e){return s+parseFloat(e.hours||0);},0);
    var isToday = ds === drTodayStr();
    var isFuture = ds > drTodayStr();

    // Determine color
    var color = 'gray';
    var statusText = 'No activity';
    if (status === 'accepted') { color = 'green'; statusText = '&#10003; Accepted'; }
    else if (status === 'kicked_back') { color = 'red'; statusText = '&#9888; Kicked back — ' + escHtml(review.kickback_reason||'see notes'); }
    else if (status === 'submitted') { color = 'amber'; statusText = 'Submitted — awaiting review'; }
    else if (isToday) { color = 'amber'; statusText = 'In progress'; }
    else if (!isFuture && dayPaid > 0) { color = 'amber'; statusText = 'Not yet submitted'; }

    var borderColor = color==='green'?'#97c459':color==='amber'?'#ef9f27':color==='red'?'#f09595':'var(--border)';
    var headBg = color==='green'?'#eaf3de':color==='amber'?'#faeeda':color==='red'?'#fcebeb':'var(--surface)';
    var dotColor = color==='green'?'#639922':color==='amber'?'#ef9f27':color==='red'?'#e24b4a':'#b4b2a9';
    var textColor = color==='green'?'#3b6d11':color==='amber'?'#854f0b':color==='red'?'#a32d2d':'var(--text-muted)';

    html += '<div style="border:0.5px solid ' + borderColor + ';border-radius:10px;margin-bottom:8px;overflow:hidden;cursor:pointer" onclick="mdrSelectDay(\'' + ds + '\')">';
    html += '<div style="padding:9px 12px;display:flex;align-items:center;gap:8px;background:' + headBg + '">';
    html += '<div style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';flex-shrink:0"></div>';
    html += '<div style="flex:1;font-size:13px;font-weight:500">' + dayNames[i] + (isToday?' <span style="font-size:10px;color:var(--text-muted)">· Today</span>':'') + '</div>';
    html += '<div style="font-size:13px;font-weight:500">' + (dayPaid>0?dayPaid.toFixed(1)+'h':'—') + '</div>';
    html += '</div>';
    if (color !== 'gray') {
      html += '<div style="font-size:11px;padding:4px 12px 7px 30px;color:' + textColor + '">' + statusText + '</div>';
      html += '<div style="display:flex;border-top:0.5px solid ' + borderColor + '">';
      html += '<div style="flex:1;text-align:center;padding:5px 0"><div style="font-size:13px;font-weight:500">' + (dayPaid>0?dayPaid.toFixed(1)+'h':'—') + '</div><div style="font-size:10px;color:var(--text-muted)">Paid</div></div>';
      html += '<div style="flex:1;text-align:center;padding:5px 0;border-left:0.5px solid ' + borderColor + '"><div style="font-size:13px;font-weight:500">' + (dayBilled>0?dayBilled.toFixed(1)+'h':'—') + '</div><div style="font-size:10px;color:var(--text-muted)">Billed</div></div>';
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  content.innerHTML = html;
  mdrRenderWeekBottom();
}

function mdrRenderWeekBottom() {
  var el = document.getElementById('mdr-bottom');
  if (!el) return;
  var allAccepted = MDRState.dayReviews.length > 0 && MDRState.dayReviews.every(function(r){return r.status==='accepted';});
  var anyKickedBack = MDRState.dayReviews.some(function(r){return r.status==='kicked_back';});
  var weekSubmitted = MDRState.dayReviews.length > 0 && MDRState.dayReviews.every(function(r){return r.status==='accepted'||r.status==='submitted';});
  var html = '';
  if (allAccepted) {
    html += '<button onclick="mdrSubmitWeek()" style="width:100%;padding:10px;background:#27ae60;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px">Submit week for payroll</button>';
  } else if (anyKickedBack) {
    html += '<div style="font-size:12px;color:#a32d2d;text-align:center;margin-bottom:8px;padding:6px;background:#fcebeb;border-radius:6px">&#9888; Resolve kicked-back days before submitting week</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:8px">All days must be accepted before submitting week</div>';
  }
  html += '<div style="display:flex;gap:8px">';
  html += '<div onclick="mdrSetView(\'day\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:var(--surface);color:var(--text-secondary)">Day view</div>';
  html += '<div onclick="mdrSetView(\'week\')" style="flex:1;padding:7px;border-radius:8px;font-size:12px;text-align:center;border:1px solid var(--border);cursor:pointer;background:var(--bg-accent);color:var(--text-accent)">Week summary</div>';
  html += '</div>';
  el.innerHTML = html;
}

function mdrSelectDay(dateStr) {
  MDRState.selectedDate = dateStr;
  MDRState.view = 'day';
  mdrRender();
}

function mdrSubmitWeek() {
  var weekEnd = drDateStr(drAddDays(MDRState.weekStart, 6));
  if (!confirm('Submit week of ' + drDateStr(MDRState.weekStart) + ' – ' + weekEnd + ' for payroll?\n\nYou won\'t be able to make changes after submitting.')) return;
  showToast('Week submitted for payroll — payroll PDF generation coming soon');
}
