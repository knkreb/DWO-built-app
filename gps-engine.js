// gps-engine.js — GPS stop detection for ProMech
// v1.8 — Hard cap on high-uncertainty pings (RF interference / signal loss).
//         Strips positions with accuracy worse than gps_rf_interference_cap (default 500m)
//         before centroid window. Fixes ghost pings from Android cell-tower fallback
//         corrupting stop detection at sites with metal roofs or RF interference.
//         Also fixes isGoodPing field name (acc → accuracy).
// v1.7 — Bug fixes: (1) departure-pending pings no longer corrupt window centroid;
//         (2) arrival window backdates to first ping physically inside geofence.
// v1.6 — centroid-based detection: rolling window average replaces per-ping accuracy filter.
//         Solves indoor GPS degradation (metal roofs, building interference).
//         Departure uses centroid consistency, not per-ping accuracy gates.
//         Unknown stop pool still uses accuracy filter to prevent noise from breaking clusters.
// v1.5 — overlapping geofence hold
// v1.4 — increased DEPARTURE_CONSEC_REQUIRED default from 3 to 6
// v1.3 — consecutive good-accuracy departure rule
// v1.2 — two-condition departure rule (accuracy + movement)
// v1.1 — accuracy-relative geofence matching + speed sanity filter
// v1.0 — simplified speed-based detection

(function() {

  var WALKING_SPEED_MPH = 5;
  var METERS_PER_MILE = 1609.34;
  var SECONDS_PER_HOUR = 3600;

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
      Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
      Math.sin(dLng/2)*Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function speedMph(ping1, ping2) {
    var dist = haversineMeters(ping1.lat, ping1.lng, ping2.lat, ping2.lng);
    var timeSec = (new Date(ping2.timestamp) - new Date(ping1.timestamp)) / 1000;
    if (timeSec <= 0) return 0;
    return (dist / METERS_PER_MILE) / (timeSec / SECONDS_PER_HOUR);
  }

  function isMoving(ping1, ping2) {
    if (!ping1 || !ping2) return false;
    return speedMph(ping1, ping2) > WALKING_SPEED_MPH;
  }

  function computeCentroid(pings) {
    if (!pings.length) return { lat: 0, lng: 0 };
    var lat = 0, lng = 0;
    pings.forEach(function(p) { lat += p.lat; lng += p.lng; });
    return { lat: lat / pings.length, lng: lng / pings.length };
  }

  // Geofence match on a lat/lng point (no accuracy skip — used with centroids)
  function getMatchingLoc(lat, lng, locations, geofenceDefault) {
    var bestMatch = null, bestDist = Infinity;
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || geofenceDefault);
      var dist = haversineMeters(lat, lng, loc.lat, loc.lng);
      if (dist <= radius && dist < bestDist) { bestDist = dist; bestMatch = loc; }
    });
    return bestMatch;
  }

  function getAllMatchesAt(lat, lng, locations, geofenceDefault) {
    var matches = [];
    locations.forEach(function(loc) {
      if (!loc.lat || !loc.lng) return;
      var radius = parseInt(loc.geofence_radius || geofenceDefault);
      var dist = haversineMeters(lat, lng, loc.lat, loc.lng);
      if (dist <= radius) matches.push({ loc: loc, dist: dist });
    });
    matches.sort(function(a, b) { return a.dist - b.dist; });
    return matches;
  }

  function makeStop(firstPing, lastPing, allMatches, centLat, centLng) {
    var bestMatch = allMatches.length ? allMatches[0].loc : null;
    var durationMin = Math.round((new Date(lastPing.timestamp) - new Date(firstPing.timestamp)) / 60000);
    return {
      arrivedAt: firstPing.timestamp,
      leftAt: lastPing.timestamp,
      lat: centLat,
      lng: centLng,
      durationMin: durationMin,
      pingCount: 1,
      location: allMatches.length > 1 ? null : bestMatch,
      locationMatches: allMatches.length > 1 ? allMatches.map(function(m) { return m.loc; }) : null,
      allocations: [],
      hoursEntries: [],
      isPaid: allMatches.length === 1 && bestMatch ? true : false,
      isBillable: allMatches.length === 1 && bestMatch ? (bestMatch.billable_default !== false) : false
    };
  }

  // ── Main detection ─────────────────────────────────────────

  window.drDetectStops = function(pings, locations) {
    if (!pings || !pings.length) return [];

    var settings = (typeof AppState !== 'undefined' && AppState.settings) || {};
    var ACC_THRESHOLD       = parseInt(settings.gps_accuracy_threshold       || '100');
    var RF_INTERFERENCE_CAP = parseInt(settings.gps_rf_interference_cap      || '500');
    var GEOFENCE_DEFAULT    = parseInt(settings.geofence_radius_default       || '100');
    var KNOWN_MIN_MINUTES   = parseInt(settings.gps_known_stop_min_duration   || '5');
    var UNKNOWN_MIN_MINUTES = parseInt(settings.gps_unknown_stop_min_duration || '10');
    var UNKNOWN_CLUSTER_RADIUS = 100;
    var PERSONAL_GAP_TOLERANCE = parseInt(settings.gps_personal_gap_tolerance || '120');
    var KNOWN_GAP_TOLERANCE    = parseInt(settings.gps_known_gap_tolerance    || '30');
    // v1.6 — centroid window size and departure confirmation threshold
    var WINDOW_SIZE           = parseInt(settings.gps_centroid_window   || '5');
    var DEPARTURE_WINDOW_COUNT = parseInt(settings.gps_departure_windows || '4');

    // Sanity filter: strip RF-interference/signal-loss positions before centroid window.
    // First removes pings worse than RF_INTERFERENCE_CAP — these are Android cell-tower
    // fallback or cached positions returned when satellite lock is lost (typically 400-2500m).
    // Then removes physically impossible speeds (>120 mph between consecutive pings).
    var allPings = pings.filter(function(p, idx) {
      if (p.accuracy && p.accuracy > RF_INTERFERENCE_CAP) return false;
      if (idx === 0) return true;
      var prev = pings[idx - 1];
      var dist = haversineMeters(p.lat, p.lng, prev.lat, prev.lng);
      var timeSec = (new Date(p.timestamp) - new Date(prev.timestamp)) / 1000;
      if (timeSec <= 0) return true;
      return (dist / METERS_PER_MILE) / (timeSec / SECONDS_PER_HOUR) <= 120;
    });
    if (!allPings.length) return [];

    var stops = [];
    var currentLocId = null;
    var windowFirstPing = null;
    var windowLastPing = null;
    var windowPingCount = 0;
    var windowLatSum = 0;
    var windowLngSum = 0;
    var gapStartPing = null;
    var unknownPings = [];          // accuracy-filtered pool for unknown stop detection
    var consecutiveOutsideCount = 0;
    var recentPings = [];           // sliding window for centroid computation

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
        var cLat = windowPingCount > 0 ? windowLatSum / windowPingCount : windowFirstPing.lat;
        var cLng = windowPingCount > 0 ? windowLngSum / windowPingCount : windowFirstPing.lng;
        var allMatches = getAllMatchesAt(cLat, cLng, locations, GEOFENCE_DEFAULT);
        var stop = makeStop(windowFirstPing, windowLastPing, allMatches, cLat, cLng);
        stop.pingCount = windowPingCount;
        stops.push(stop);
      }
      currentLocId = null;
      windowFirstPing = null;
      windowLastPing = null;
      windowPingCount = 0;
      windowLatSum = 0;
      windowLngSum = 0;
      gapStartPing = null;
      consecutiveOutsideCount = 0;
    }

    function addToWindow(ping) {
      windowLastPing = ping;
      windowPingCount++;
      windowLatSum += ping.lat;
      windowLngSum += ping.lng;
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
        var dur = Math.round((new Date(last.timestamp) - new Date(first.timestamp)) / 60000);
        if (dur < UNKNOWN_MIN_MINUTES) return;
        var cLat = 0, cLng = 0;
        cPings.forEach(function(p) { cLat += p.lat; cLng += p.lng; });
        stops.push({
          arrivedAt: first.timestamp,
          leftAt: last.timestamp,
          lat: cLat / cPings.length,
          lng: cLng / cPings.length,
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

    // ── Main loop ──────────────────────────────────────────────

    for (var i = 0; i < allPings.length; i++) {
      var ping = allPings[i];
      var prevPing = i > 0 ? allPings[i - 1] : null;
      var moving = isMoving(prevPing, ping);
      var isGoodPing = !(ping.accuracy && ping.accuracy > ACC_THRESHOLD);

      // Update rolling centroid window (all pings, no accuracy filter)
      recentPings.push(ping);
      if (recentPings.length > WINDOW_SIZE) recentPings.shift();
      var centroid = computeCentroid(recentPings);

      var matchedLoc = getMatchingLoc(centroid.lat, centroid.lng, locations, GEOFENCE_DEFAULT);
      var matchedId = matchedLoc ? matchedLoc.id : null;

      // v1.6 departure detection: N consecutive windows where centroid is outside geofence.
      // Replaces the v1.3 per-ping accuracy gate. Poor-accuracy indoor pings no longer
      // reset the departure counter — the centroid stays near the location until truly gone.
      if (!matchedId && currentLocId !== null) {
        consecutiveOutsideCount++;
        if (consecutiveOutsideCount < DEPARTURE_WINDOW_COUNT) {
          continue;
        }
        // Centroid consistently outside — confirmed departure. Flush immediately.
        flushKnownWindow();
        if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
        // Fall through to outside-geofence handler (currentLocId now null)
      }

      if (matchedId) consecutiveOutsideCount = 0;

      if (matchedId) {
        // Centroid is inside a known geofence
        if (moving) {
          if (currentLocId === matchedId && windowPingCount >= 2) {
            // Moving within an established window (on-property movement or brief gap)
            if (gapStartPing) {
              var gapMin = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin <= getGapTolerance(currentLocId)) {
                addToWindow(ping);
                gapStartPing = null;
              } else {
                flushKnownWindow();
                if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
              }
            } else {
              addToWindow(ping);
            }
          } else if (currentLocId !== matchedId) {
            // v1.5 — overlapping geofence: centroid may be closer to neighbour but still inside current
            var pingStillInCurrent = (function() {
              if (!currentLocId) return false;
              var curLoc = locations.filter(function(l) { return l.id === currentLocId; })[0];
              if (!curLoc || !curLoc.lat || !curLoc.lng) return false;
              return haversineMeters(centroid.lat, centroid.lng, curLoc.lat, curLoc.lng) <=
                parseInt(curLoc.geofence_radius || GEOFENCE_DEFAULT);
            })();
            if (!pingStillInCurrent) {
              flushKnownWindow();
              if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
            }
          }
          // Moving through geofence with no window — drive-past, ignore
        } else {
          // Stationary inside geofence
          if (matchedId === currentLocId) {
            addToWindow(ping);
            gapStartPing = null;
            consecutiveOutsideCount = 0;
          } else {
            // v1.5 — overlapping geofence check
            var pingStillInCurrent2 = (function() {
              if (!currentLocId) return false;
              var curLoc = locations.filter(function(l) { return l.id === currentLocId; })[0];
              if (!curLoc || !curLoc.lat || !curLoc.lng) return false;
              return haversineMeters(centroid.lat, centroid.lng, curLoc.lat, curLoc.lng) <=
                parseInt(curLoc.geofence_radius || GEOFENCE_DEFAULT);
            })();
            if (pingStillInCurrent2) {
              addToWindow(ping);
              gapStartPing = null;
              consecutiveOutsideCount = 0;
            } else {
              // Genuinely at a new known location
              flushKnownWindow();
              if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
              currentLocId = matchedId;
              windowFirstPing = ping;
              windowLastPing = ping;
              windowPingCount = 1;
              windowLatSum = ping.lat;
              windowLngSum = ping.lng;
              gapStartPing = null;
            }
          }
          // Start new known window if not in one (currentLocId was null, stationary inside geofence)
          if (!currentLocId) {
            if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
            currentLocId = matchedId;
            // Backdate arrival: earliest ping in recent window already inside this geofence
            var arrivalLoc = locations.find(function(l){ return l.id === matchedId; });
            var arrivedFirst = ping;
            if (arrivalLoc && arrivalLoc.lat && arrivalLoc.lng) {
              var arrRadius = parseInt(arrivalLoc.geofence_radius || GEOFENCE_DEFAULT);
              for (var ri = 0; ri < recentPings.length; ri++) {
                var rp = recentPings[ri];
                if (haversineMeters(rp.lat, rp.lng, arrivalLoc.lat, arrivalLoc.lng) <= arrRadius) {
                  arrivedFirst = rp;
                  break;
                }
              }
            }
            windowFirstPing = arrivedFirst;
            windowLastPing = ping;
            windowPingCount = 1;
            windowLatSum = ping.lat;
            windowLngSum = ping.lng;
            gapStartPing = null;
          }
        }
      } else {
        // Centroid is outside all known geofences
        if (currentLocId !== null) {
          // Still have an open known window — gap tolerance logic
          if (moving) {
            if (!gapStartPing) {
              gapStartPing = ping;
            } else {
              var gapMin2 = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin2 > getGapTolerance(currentLocId)) {
                flushKnownWindow();
                if (isGoodPing && !moving) unknownPings.push(ping);
              }
            }
          } else {
            if (gapStartPing) {
              var gapMin3 = Math.round(
                (new Date(ping.timestamp) - new Date(gapStartPing.timestamp)) / 60000
              );
              if (gapMin3 > getGapTolerance(currentLocId)) {
                flushKnownWindow();
                if (isGoodPing) unknownPings.push(ping);
              }
            } else {
              gapStartPing = ping;
            }
          }
        } else {
          // No known window — accumulate good-accuracy pings for unknown stop detection
          if (!moving) {
            if (isGoodPing) unknownPings.push(ping);
          } else {
            if (unknownPings.length) { flushUnknownPings(unknownPings); unknownPings = []; }
          }
        }
      }
    }

    // Flush any open window or remaining unknown pings
    if (currentLocId !== null) flushKnownWindow();
    if (unknownPings.length) flushUnknownPings(unknownPings);

    stops.sort(function(a, b) { return new Date(a.arrivedAt) - new Date(b.arrivedAt); });

    // Associate hours entries with nearest stop
    var GEOFENCE_DEFAULT_ASSOC = parseInt(settings.geofence_radius_default || '100');
    if (typeof DRState !== 'undefined' && DRState.hoursEntries) {
      DRState.hoursEntries.forEach(function(entry) {
        if (!entry.location_id) return;
        var entryLoc = (DRState.locations || []).find(function(l) { return l.id === entry.location_id; });
        if (!entryLoc || !entryLoc.lat || !entryLoc.lng) return;
        var assocRadius = parseInt(entryLoc.geofence_radius || GEOFENCE_DEFAULT_ASSOC) * 3;
        var bestStop = null, bestDist = Infinity;
        stops.forEach(function(s) {
          var dist = haversineMeters(s.lat, s.lng, entryLoc.lat, entryLoc.lng);
          if (dist < bestDist) { bestDist = dist; bestStop = s; }
        });
        if (bestStop && bestDist <= assocRadius) bestStop.hoursEntries.push(entry);
      });
    }

    return stops;
  };

  window.drHaversineMeters = haversineMeters;
  console.log('[gps-engine] loaded v1.8');

})();
