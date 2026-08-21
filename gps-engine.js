// gps-engine.js — GPS stop detection for ProMech
// Version: 1.3 — consecutive good-accuracy departure rule
// v1.2 — two-condition departure rule (accuracy + movement)
// v1.1 — accuracy-relative geofence matching + speed sanity filter
// v1.0 — simplified speed-based detection
// Replaces the drDetectStops function in app-core.js
// See app-core.js for deprecated original implementation

(function() {

  // ── Constants ──────────────────────────────────────────────
  var WALKING_SPEED_MPH = 5;      // above this = moving vehicle
  var METERS_PER_MILE = 1609.34;
  var SECONDS_PER_HOUR = 3600;

  // ── Helpers ────────────────────────────────────────────────

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function speedMph(ping1, ping2) {
    var distMeters = haversineMeters(ping1.lat, ping1.lng, ping2.lat, ping2.lng);
    var timeSec = (new Date(ping2.timestamp) - new Date(ping1.timestamp)) / 1000;
    if (timeSec <= 0) return 0;
    return (distMeters / METERS_PER_MILE) / (timeSec / SECONDS_PER_HOUR);
  }

  function isMoving(ping1, ping2) {
    if (!ping1 || !ping2) return false;
    return speedMph(ping1, ping2) > WALKING_SPEED_MPH;
  }

  function getMatchingLoc(ping, locations, geofenceDefault) {
    var bestMatch = null;
    var bestDist = Infinity;
    var pingAcc = ping.acc ? parseInt(ping.acc) : 0;
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || geofenceDefault);
      // v1.1 — if ping accuracy is worse than geofence radius, this ping cannot
      // reliably determine inside/outside for this location — skip it
      if (pingAcc > radius) return;
      var dist = haversineMeters(ping.lat, ping.lng, loc.lat, loc.lng);
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        bestMatch = loc;
      }
    });
    return bestMatch;
  }

  function getAllMatchesAt(lat, lng, locations, geofenceDefault, pingAcc) {
    var acc = pingAcc || 0;
    var matches = [];
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || geofenceDefault);
      // v1.1 — skip if ping accuracy worse than geofence radius
      if (acc > radius) return;
      var dist = haversineMeters(lat, lng, loc.lat, loc.lng);
      if (dist <= radius) matches.push({ loc: loc, dist: dist });
    });
    matches.sort(function(a, b) { return a.dist - b.dist; });
    return matches;
  }

  function makeStop(firstPing, lastPing, allMatches) {
    var bestMatch = allMatches.length ? allMatches[0].loc : null;
    var durationMin = Math.round(
      (new Date(lastPing.timestamp) - new Date(firstPing.timestamp)) / 60000
    );
    return {
      arrivedAt: firstPing.timestamp,
      leftAt: lastPing.timestamp,
      lat: firstPing.lat,
      lng: firstPing.lng,
      durationMin: durationMin,
      pingCount: 1, // updated by caller
      location: allMatches.length > 1 ? null : bestMatch,
      locationMatches: allMatches.length > 1
        ? allMatches.map(function(m) { return m.loc; })
        : null,
      allocations: [],
      hoursEntries: [],
      isPaid: allMatches.length === 1 && bestMatch ? true : false,
      isBillable: allMatches.length === 1 && bestMatch
        ? (bestMatch.billable_default !== false)
        : false
    };
  }

  // ── Main detection function ────────────────────────────────

  window.drDetectStops = function(pings, locations) {
    if (!pings || !pings.length) return [];

    var settings = (typeof AppState !== 'undefined' && AppState.settings) || {};
    var ACC_THRESHOLD = parseInt(settings.gps_accuracy_threshold || '100');
    var GEOFENCE_DEFAULT = parseInt(settings.geofence_radius_default || '100');
    var KNOWN_MIN_MINUTES = parseInt(settings.gps_known_stop_min_duration || '5');
    var UNKNOWN_MIN_MINUTES = parseInt(settings.gps_unknown_stop_min_duration || '10');
    var UNKNOWN_CLUSTER_RADIUS = 100; // meters — fixed
    // Personal location type gets higher gap tolerance
    var PERSONAL_GAP_TOLERANCE = parseInt(settings.gps_personal_gap_tolerance || '120');
    var KNOWN_GAP_TOLERANCE = parseInt(settings.gps_known_gap_tolerance || '30');
    // v1.3 — consecutive good-accuracy departure rule
    // Physical reality: accuracy is good outside buildings, poor inside (metal roofs etc)
    // Arrival: good accuracy (outside, just drove in)
    // On site: accuracy degrades (inside building, signal blocked)
    // Departure: accuracy improves again (outside, clear sky)
    // Rule: require N consecutive good-accuracy pings all outside geofence to confirm departure
    // One or two outside pings = noise/brief wander = stay on site
    var DEPARTURE_CONSEC_REQUIRED = parseInt(settings.gps_departure_consecutive || '3');
    var DEPARTURE_ACC_THRESHOLD = parseInt(settings.gps_departure_accuracy_threshold || '25');

    // Filter poor accuracy pings globally
    var goodPings = pings.filter(function(p) {
      return !(p.acc && parseInt(p.acc) > ACC_THRESHOLD);
    });
    if (!goodPings.length) return [];

    // v1.1 — speed sanity check: remove pings implying impossible speed (>120 mph)
    // These are cellular/wifi position jumps, not real movement
    var MAX_SPEED_MPH = 120;
    goodPings = goodPings.filter(function(p, idx) {
      if (idx === 0) return true;
      var prev = goodPings[idx - 1];
      var dist = haversineMeters(p.lat, p.lng, prev.lat, prev.lng);
      var timeSec = (new Date(p.timestamp) - new Date(prev.timestamp)) / 1000;
      if (timeSec <= 0) return true;
      var mph = (dist / 1609.34) / (timeSec / 3600);
      return mph <= MAX_SPEED_MPH;
    });

    var stops = [];

    // ── PASS 1: Walk pings in time order ──────────────────────
    // For each ping determine if moving or stationary
    // Known geofence + stationary = stop
    // Unknown + stationary long enough = unknown stop
    // Moving = driving

    var currentLocId = null;
    var windowFirstPing = null;
    var windowLastPing = null;
    var windowPingCount = 0;
    var gapStartPing = null;
    var unknownPings = [];
    var consecutiveOutsideCount = 0; // v1.3 — tracks consecutive good-accuracy outside pings

    function getGapTolerance(locId) {
      var loc = locations.find(function(l) { return l.id === locId; });
      if (!loc) return KNOWN_GAP_TOLERANCE;
      if (loc.location_type === 'personal') return PERSONAL_GAP_TOLERANCE;
      return KNOWN_GAP_TOLERANCE;
    }

    function flushKnownWindow() {
      if (!currentLocId || !windowFirstPing || !windowLastPing) return;
      var durationMin = Math.round(
        (new Date(windowLastPing.timestamp) - new Date(windowFirstPing.timestamp)) / 60000
      );
      if (durationMin >= KNOWN_MIN_MINUTES) {
        var pingAcc = windowFirstPing.acc ? parseInt(windowFirstPing.acc) : 0;
        var allMatches = getAllMatchesAt(
          windowFirstPing.lat, windowFirstPing.lng, locations, GEOFENCE_DEFAULT, pingAcc
        );
        var stop = makeStop(windowFirstPing, windowLastPing, allMatches);
        stop.pingCount = windowPingCount;
        stops.push(stop);
      }
      currentLocId = null;
      windowFirstPing = null;
      windowLastPing = null;
      windowPingCount = 0;
      gapStartPing = null;
      consecutiveOutsideCount = 0;
    }

    function flushUnknownPings(pingArr) {
      if (!pingArr.length) return;
      var clusterFirst = pingArr[0];
      var clusterLat = clusterFirst.lat;
      var clusterLng = clusterFirst.lng;
      var clusterPings = [clusterFirst];

      function emitCluster(cPings) {
        if (cPings.length < 2) return;
        var first = cPings[0];
        var last = cPings[cPings.length - 1];
        var dur = Math.round(
          (new Date(last.timestamp) - new Date(first.timestamp)) / 60000
        );
        if (dur < UNKNOWN_MIN_MINUTES) return;
        stops.push({
          arrivedAt: first.timestamp,
          leftAt: last.timestamp,
          lat: clusterLat,
          lng: clusterLng,
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
        var p = pingArr[j];
        var prev = pingArr[j - 1];
        var moving = isMoving(prev, p);
        var distFromCluster = haversineMeters(p.lat, p.lng, clusterLat, clusterLng);

        if (!moving && distFromCluster <= UNKNOWN_CLUSTER_RADIUS) {
          clusterPings.push(p);
        } else {
          emitCluster(clusterPings);
          clusterPings = [p];
          clusterLat = p.lat;
          clusterLng = p.lng;
        }
      }
      emitCluster(clusterPings);
    }

    for (var i = 0; i < goodPings.length; i++) {
      var ping = goodPings[i];
      var prevPing = i > 0 ? goodPings[i - 1] : null;
      var moving = isMoving(prevPing, ping);
      var matchedLoc = getMatchingLoc(ping, locations, GEOFENCE_DEFAULT);
      var matchedId = matchedLoc ? matchedLoc.id : null;
      var pingAcc = ping.acc ? parseInt(ping.acc) : 0;

      // v1.3 — consecutive good-accuracy departure rule
      // Physical reality: accuracy is good outside, poor inside metal buildings
      // Require DEPARTURE_CONSEC_REQUIRED consecutive good-accuracy pings outside
      // the geofence before closing the stop. Single or poor-accuracy outside
      // pings are noise — hold the window open.
      if (!matchedId && currentLocId !== null) {
        var isGoodAccuracy = pingAcc === 0 || pingAcc <= DEPARTURE_ACC_THRESHOLD;
        if (isGoodAccuracy) {
          consecutiveOutsideCount++;
        } else {
          // Poor accuracy outside — definitely noise, reset counter, stay on site
          consecutiveOutsideCount = 0;
          windowLastPing = ping;
          windowPingCount++;
          continue;
        }
        if (consecutiveOutsideCount < DEPARTURE_CONSEC_REQUIRED) {
          // Not enough consecutive good outside pings yet — hold window open
          windowLastPing = ping;
          windowPingCount++;
          continue;
        }
        // DEPARTURE_CONSEC_REQUIRED consecutive good outside pings — real departure
        // Fall through to the outside-geofence handling below
      }

      // Reset consecutive counter when matched inside geofence
      if (matchedId) consecutiveOutsideCount = 0;

      if (matchedId) {
        // Inside a known geofence
        if (moving) {
          // Moving through geofence — drive-past
          // Only absorb if we already have an established window
          if (currentLocId === matchedId && windowPingCount >= 2) {
            // Already in a stop window — movement may be within property
            // Absorb if within gap tolerance
            if (gapStartPing) {
              var gapMin = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin <= getGapTolerance(currentLocId)) {
                windowLastPing = ping;
                windowPingCount++;
                gapStartPing = null;
              } else {
                flushKnownWindow();
                if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
              }
            } else {
              // Moving but still in geofence — extend window (moving within property)
              windowLastPing = ping;
              windowPingCount++;
            }
          } else if (currentLocId !== matchedId) {
            // Drive-past a different location — flush current, don't start new
            flushKnownWindow();
            if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
          }
          // else: moving through geofence with no established window — ignore (drive-past)
        } else {
          // Stationary inside geofence
          if (matchedId === currentLocId) {
            // Continue existing window
            windowLastPing = ping;
            windowPingCount++;
            gapStartPing = null;
            consecutiveOutsideCount = 0;
          } else {
            // New known location
            flushKnownWindow();
            if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
            currentLocId = matchedId;
            windowFirstPing = ping;
            windowLastPing = ping;
            windowPingCount = 1;
            gapStartPing = null;
          }
        }
      } else {
        // Outside all known geofences
        if (currentLocId !== null) {
          if (moving) {
            // Left and moving — check gap tolerance
            if (!gapStartPing) {
              gapStartPing = ping;
            } else {
              var gapMin = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin > getGapTolerance(currentLocId)) {
                flushKnownWindow();
                unknownPings.push(ping);
              }
            }
          } else {
            // Stationary outside geofence — still in gap tolerance window?
            if (gapStartPing) {
              var gapMin = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin <= getGapTolerance(currentLocId)) {
                // Still within tolerance — keep window open
              } else {
                flushKnownWindow();
                unknownPings.push(ping);
              }
            } else {
              gapStartPing = ping;
            }
          }
        } else {
          // Not in any known window — accumulate for unknown stop detection
          if (!moving) {
            unknownPings.push(ping);
          } else {
            // Moving outside geofence — flush unknown cluster
            if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
          }
        }
      }
    }

    // Flush any remaining open window
    if (currentLocId !== null) flushKnownWindow();
    if (unknownPings.length) flushUnknownPings(unknownPings);

    // Sort chronologically
    stops.sort(function(a, b) { return new Date(a.arrivedAt) - new Date(b.arrivedAt); });

    // Associate hours entries
    var GEOFENCE_DEFAULT_ASSOC = parseInt(settings.geofence_radius_default || '100');
    if (typeof DRState !== 'undefined' && DRState.hoursEntries) {
      DRState.hoursEntries.forEach(function(entry) {
        if (!entry.location_id) return;
        var entryLoc = (DRState.locations || []).find(function(l) {
          return l.id === entry.location_id;
        });
        if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
        var assocRadius = parseInt(entryLoc.geofence_radius || GEOFENCE_DEFAULT_ASSOC) * 3;
        var bestStop = null;
        var bestDist = Infinity;
        stops.forEach(function(s) {
          var dist = haversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
          if (dist < bestDist) { bestDist = dist; bestStop = s; }
        });
        if (bestStop && bestDist <= assocRadius) bestStop.hoursEntries.push(entry);
      });
    }

    return stops;
  };

  // Expose haversine for use elsewhere in app
  window.drHaversineMeters = haversineMeters;

  console.log('[gps-engine] loaded v1.3');

})();
