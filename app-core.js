// SHORT TERM DWO — app-core.js (clean - no nested template literals)

const APP_VERSION = '4.56';

const SUPABASE_URL = 'https://yrupnxlxgubfsjmptgxm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_is9jKWo4fgjmWc4yvLuiFA_sfghUrrH';

// Statuses loaded from Supabase wo_statuses table at startup
// Fallback used only if load fails — mirrors full wo_statuses table
var STATUSES_FALLBACK = [
  { num:0,  name:'Approval Request',      color:'#f5e8a0', category:'draft',     mobile:true,  sort_order:0  },
  { num:1,  name:'Quote Request',         color:'#d8d6d0', category:'draft',     mobile:true,  sort_order:1  },
  { num:2,  name:'Quoted',                color:'#f5e8a0', category:'draft',     mobile:true,  sort_order:2  },
  { num:3,  name:'Parts to be Ordered',   color:'#f5d5a0', category:'draft',     mobile:true,  sort_order:3  },
  { num:4,  name:'In Research',           color:'#f5b8b8', category:'draft',     mobile:true,  sort_order:4  },
  { num:5,  name:'Parts Ordered',         color:'#f5b8b8', category:'draft',     mobile:true,  sort_order:5  },
  { num:6,  name:'Work Ready',            color:'#b8e0c8', category:'draft',     mobile:true,  sort_order:6  },
  { num:7,  name:'In Progress',           color:'#b8e0c8', category:'active',    mobile:true,  sort_order:7  },
  { num:8,  name:'Entry Work Needed',     color:'#f5b8b8', category:'active',    mobile:true,  sort_order:8  },
  { num:9,  name:'Recheck Job',           color:'#f5b8b8', category:'active',    mobile:true,  sort_order:9  },
  { num:10, name:'Completed',             color:'#d4b8f0', category:'completed', mobile:true,  sort_order:10 },
  { num:11, name:'Batch Invoice Process', color:'#b8c8e8', category:'processed', mobile:false, sort_order:11 },
  { num:12, name:'Invoiced',              color:'#e8e8e8', category:'processed', mobile:false, sort_order:12 },
  { num:15, name:'Invoiced Outside DWO',  color:'#d0d0d0', category:'processed', mobile:false, sort_order:15 },
  { num:99, name:'Cancelled',             color:'#d8d6d0', category:'cancelled', mobile:false, sort_order:99 },
];


function getStatus(n) {
  var list = (AppState && AppState.statuses && AppState.statuses.length) ? AppState.statuses : STATUSES_FALLBACK;
  return list.find(function(s){ return s.num===n; }) || { num:n, name:String(n), color:'#eee', category:'active', mobile:true };
}

// Category helpers - replace all magic number comparisons
function statusCat(n) { return getStatus(n).category || 'active'; }
function isLiveStatus(n) { var c=statusCat(n); return c==='draft'||c==='active'||c==='completed'; }
function isProcessedStatus(n) { var c=statusCat(n); return c==='processed'||c==='cancelled'; }
function isCompletedStatus(n) { var c=statusCat(n); return c==='completed'||c==='processed'; }
function isReadyToExport(n) { return statusCat(n)==='completed'; }

// Transition rules - returns allowed target categories from current category
function allowedTransitions(fromCat, isAdmin) {
  var rules = {
    draft:     ['draft','active','completed','cancelled'],
    active:    ['active','draft','completed','cancelled'],
    completed: isAdmin ? ['active','draft','processed'] : [],
    processed: isAdmin ? ['completed'] : [],
    cancelled: isAdmin ? ['draft'] : []
  };
  return rules[fromCat] || [];
}

// HTML builder helper - avoids nested template literals
function h(tag, attrs, content) {
  var attrStr = '';
  if (attrs) {
    Object.keys(attrs).forEach(function(k) {
      if (attrs[k] !== null && attrs[k] !== undefined) {
        attrStr += ' ' + k + '="' + String(attrs[k]).replace(/"/g,'&quot;') + '"';
      }
    });
  }
  if (content === undefined) return '<' + tag + attrStr + '>';
  return '<' + tag + attrStr + '>' + (content||'') + '</' + tag + '>';
}

var sb = {
  _refreshing: false,
  _refreshQueue: [],
  refreshToken: function() {
    if (this._refreshing) return new Promise(function(resolve){ sb._refreshQueue.push(resolve); });
    this._refreshing = true;
    var refreshTok = AppState.session && AppState.session.refresh_token;
    if (!refreshTok) {
      this._refreshing = false;
      return Promise.resolve(false);
    }
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({refresh_token: refreshTok})
    }).then(function(r){ return r.json(); }).then(function(data){
      sb._refreshing = false;
      if (data && data.access_token) {
        AppState.session = data;
        localStorage.setItem('dwo_session', JSON.stringify(data));
        sb._refreshQueue.forEach(function(resolve){ resolve(true); });
        sb._refreshQueue = [];
        return true;
      }
      sb._refreshQueue.forEach(function(resolve){ resolve(false); });
      sb._refreshQueue = [];
      return false;
    }).catch(function(){
      sb._refreshing = false;
      sb._refreshQueue = [];
      return false;
    });
  },
  req: function(method, path, body) {
    var headers = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
    if (AppState.session && AppState.session.access_token) headers['Authorization'] = 'Bearer ' + AppState.session.access_token;
    return fetch(SUPABASE_URL + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function(res) {
        // Handle 401 — try token refresh and retry once
        if (res.status === 401) {
          return sb.refreshToken().then(function(ok) {
            if (ok) {
              var retryHeaders = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
              if (AppState.session && AppState.session.access_token) retryHeaders['Authorization'] = 'Bearer ' + AppState.session.access_token;
              return fetch(SUPABASE_URL + path, { method: method, headers: retryHeaders, body: body ? JSON.stringify(body) : undefined })
                .then(function(retryRes) {
                  return retryRes.text().then(function(text) {
                    try { return { ok: retryRes.ok, status: retryRes.status, data: text ? JSON.parse(text) : null }; }
                    catch(e) { return { ok: retryRes.ok, status: retryRes.status, data: text }; }
                  });
                });
            } else {
              // Refresh failed — session expired
              showToast('Session expired — please sign in again');
              setTimeout(function(){ sb.signOut().then(function(){ showScreen('screen-login'); showHeader(false); }); }, 1500);
              return { ok: false, status: 401, data: null };
            }
          });
        }
        return res.text().then(function(text) {
          try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
          catch(e) { return { ok: res.ok, status: res.status, data: text }; }
        });
      });
  },
  get: function(table, params) { return this.req('GET', '/rest/v1/'+table+(params||'')); },
  post: function(table, body) { return this.req('POST', '/rest/v1/'+table, body); },
  patch: function(table, id, body) { return this.req('PATCH', '/rest/v1/'+table+'?id=eq.'+id, body); },
  patchWhere: function(table, where, body) { return this.req('PATCH', '/rest/v1/'+table+'?'+where, body); },
  delete: function(table, id) { return this.req('DELETE', '/rest/v1/'+table+'?id=eq.'+id); },
  deleteWhere: function(table, where) { return this.req('DELETE', '/rest/v1/'+table+'?'+where); },
  signIn: function(email, password) {
    return fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); });
  },
  signOut: function() {
    return fetch(SUPABASE_URL+'/auth/v1/logout', {
      method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + ((AppState.session && AppState.session.access_token) || '') }
    });
  }
};

var AppState = {
  session: null, userRole: null, userEmail: null, userTechId: null, deviceMode: null, theme: 'light',
  screenStack: [], currentWO: null, editingWOId: null, batchStatusMode: false,
  workOrders: [], customers: [], technicians: [], hoursTypes: [], qboItems: [], vendors: [], settings: {},
  hoursEntries: [], lineItems: [], quotedLines: [],
  desktopSortCol: 'created_at', desktopSortDir: 'asc', desktopSelected: {},
  filterTitle: '', filterCustomer: '', filterStatus: 'live',
  statuses: [],
  woFlags: [],
  barcodeTargetField: null,
  projectedCache: {},
  editingEntryId: null,
  _truckStockWO: null,
};

// Use plain object instead of Set for desktopSelected (better compatibility)
function selAdd(id) { AppState.desktopSelected[id] = true; }
function selDel(id) { delete AppState.desktopSelected[id]; }
function selHas(id) { return !!AppState.desktopSelected[id]; }
function selClear() { AppState.desktopSelected = {}; }
function selIds() { return Object.keys(AppState.desktopSelected); }
function selSize() { return Object.keys(AppState.desktopSelected).length; }

// Apply company branding immediately from localStorage — before auth, before window load
document.addEventListener('DOMContentLoaded', function() {
  var n = localStorage.getItem('dwo_company_name');
  var l = localStorage.getItem('dwo_company_logo_url');
  if (n || l) applyCompanyBranding(n, l);
  // Also try anonymous fetch of branding settings for first-visit / cleared cache
  if (!l) {
    fetch('https://yrupnxlxgubfsjmptgxm.supabase.co/rest/v1/settings?key=in.(company_name,company_logo_url)&select=key,value', {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlydXBueGx4Z3ViZnNqbXB0Z3htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDk3NjMyNDIsImV4cCI6MjAyNTMzOTI0Mn0.aSBLVtxpSGPblQrFYpzMrMBRJUgCiJe0KUiHDckEBRc',
        'Content-Type': 'application/json'
      }
    }).then(function(r){ return r.json(); }).then(function(data) {
      if (!Array.isArray(data)) return;
      var nameRow = data.find(function(s){ return s.key === 'company_name'; });
      var logoRow = data.find(function(s){ return s.key === 'company_logo_url'; });
      var name = nameRow ? nameRow.value : null;
      var logo = logoRow ? logoRow.value : null;
      if (name) localStorage.setItem('dwo_company_name', name);
      if (logo) localStorage.setItem('dwo_company_logo_url', logo);
      applyCompanyBranding(name, logo);
    }).catch(function(){});
  }
});

window.addEventListener('load', function() {
  setTheme(localStorage.getItem('dwo_theme') || 'light');
  window.addEventListener('online', function() { document.getElementById('conn-bar').classList.remove('offline'); });
  window.addEventListener('offline', function() { document.getElementById('conn-bar').classList.add('offline'); });
  if (!navigator.onLine) document.getElementById('conn-bar').classList.add('offline');
  loadCompanyBranding();

  // Proactive token refresh on app load
  if (AppState.session && AppState.session.refresh_token) {
    sb.refreshToken();
  }

  // Re-check device mode on resize
  window.addEventListener('resize', function() {
    var isMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.screen.width < 900;
    var newMode = isMobile ? 'mobile' : 'desktop';
    if (newMode !== AppState.deviceMode) {
      AppState.deviceMode = newMode;
      localStorage.setItem('dwo_device_mode', newMode);
    }
  });

  var storedVersion = localStorage.getItem('dwo_app_version');
  if (storedVersion && storedVersion !== APP_VERSION) {
    sb.signOut().then(function() {
      var savedTech = localStorage.getItem('dwo_default_tech');
      localStorage.clear();
      localStorage.setItem('dwo_app_version', APP_VERSION);
      if (savedTech) localStorage.setItem('dwo_default_tech', savedTech);
      showScreen('screen-login'); showHeader(false);
      var errEl = document.getElementById('login-error');
      if (errEl) errEl.textContent = 'App updated — please sign in again.';
    });
    return;
  }

  function resolveDeviceMode() {
    // Check URL parameter first — highest priority
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mobile') === '1') { AppState.deviceMode = 'mobile'; localStorage.setItem('dwo_device_mode', 'mobile'); return; }
    if (urlParams.get('mobile') === '1') { AppState.deviceMode = 'mobile'; localStorage.setItem('dwo_device_mode', 'mobile'); return; }
    // Detect mobile by user agent OR screen width
    var isMobileUA = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    var isMobileWidth = window.screen.width < 900; // use screen.width not innerWidth (more reliable)
    var isMobile = isMobileUA || isMobileWidth;
    var stored = localStorage.getItem('dwo_device_mode');
    // Mobile devices always get mobile mode
    if (isMobile) { AppState.deviceMode = 'mobile'; localStorage.setItem('dwo_device_mode', 'mobile'); return; }
    // Desktop: use stored preference or default desktop
    AppState.deviceMode = stored || 'desktop';
    localStorage.setItem('dwo_device_mode', AppState.deviceMode);
  }


  var saved = localStorage.getItem('dwo_session');
  if (saved) {
    try {
      AppState.session = JSON.parse(saved);
      AppState.userEmail = AppState.session.user && AppState.session.user.email;
      loadUserRole().then(function() {
        resolveDeviceMode();
        loadAllData().then(showMainScreen);
      });
    } catch(e) { showScreen('screen-login'); showHeader(false); }
  } else { showScreen('screen-login'); showHeader(false); }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { var l = document.getElementById('screen-login'); if (l && !l.classList.contains('hidden')) doLogin(); }
    if (e.key === 'Escape') { closeStatusSheet(); closeBarcode(); closeCustomerAutocomplete(); }
  });
});

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;
  var btn = document.getElementById('btn-login');
  var errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in...';
  sb.signIn(email, password).then(function(res) {
    btn.disabled = false; btn.textContent = 'Sign In';
    if (!res.ok || res.data.error) { errEl.textContent = res.data.error_description || res.data.message || 'Sign in failed.'; return; }
    AppState.session = res.data;
    AppState.userEmail = res.data.user && res.data.user.email;
    localStorage.setItem('dwo_session', JSON.stringify(res.data));
    localStorage.setItem('dwo_app_version', APP_VERSION);
    loadUserRole().then(function() {
      var isMobileUA2 = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      var isMobileW2 = window.screen.width < 900;
      var dm2 = (isMobileUA2||isMobileW2) ? 'mobile' : (localStorage.getItem('dwo_device_mode')||'desktop');
      AppState.deviceMode = dm2;
      localStorage.setItem('dwo_device_mode', dm2);
      loadAllData().then(showMainScreen);
      loadAllData().then(showMainScreen);
    });
  });
}

function loadUserRole() {
  return sb.get('user_roles', '?email=eq.' + encodeURIComponent(AppState.userEmail) + '&select=role')
    .then(function(r) { AppState.userRole = (r.ok && r.data && r.data.length) ? r.data[0].role : 'field'; });
}

function doLogout() {
  sb.signOut().then(function() {
    AppState.session = null; AppState.userRole = null;
    localStorage.removeItem('dwo_session'); AppState.screenStack = [];
    showScreen('screen-login'); showHeader(false);
  });
}

function setDeviceMode(mode) { AppState.deviceMode = mode; localStorage.setItem('dwo_device_mode', mode); loadAllData().then(showMainScreen); }
function toggleDeviceMode() {
  var n = AppState.deviceMode === 'mobile' ? 'desktop' : 'mobile';
  AppState.deviceMode = n; localStorage.setItem('dwo_device_mode', n); showMainScreen();
}

// LOCAL CACHE — lookup tables stored in localStorage for offline use
var CACHE_KEYS = {
  statuses: 'dwo_cache_statuses',
  wo_flags: 'dwo_cache_wo_flags',
  technicians: 'dwo_cache_technicians',
  hours_types: 'dwo_cache_hours_types',
  qbo_items: 'dwo_cache_qbo_items',
  settings: 'dwo_cache_settings',
  version: 'dwo_cache_version'
};

function saveCache(key, data) {
  try { localStorage.setItem(CACHE_KEYS[key], JSON.stringify(data)); } catch(e) {}
}

function loadCache(key) {
  try { var v = localStorage.getItem(CACHE_KEYS[key]); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}

function getCacheVersion() {
  return localStorage.getItem(CACHE_KEYS.version) || '';
}

function setCacheVersion(v) {
  localStorage.setItem(CACHE_KEYS.version, v);
}

// OFFLINE WRITE QUEUE
function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem('dwo_offline_queue')||'[]'); } catch(e) { return []; }
}

function addToOfflineQueue(table, data, woId) {
  var queue = getOfflineQueue();
  queue.push({table:table, data:data, wo_id:woId, timestamp:new Date().toISOString(), id:Date.now()});
  localStorage.setItem('dwo_offline_queue', JSON.stringify(queue));
  showToast('Saved offline — will sync when reconnected');
}

function removeFromOfflineQueue(itemId) {
  var queue = getOfflineQueue().filter(function(q){ return q.id!==itemId; });
  localStorage.setItem('dwo_offline_queue', JSON.stringify(queue));
}

function syncOfflineQueue() {
  var queue = getOfflineQueue();
  if (!queue.length) return;
  var pending = queue.slice();
  var synced = 0;
  var conflicts = [];
  pending.forEach(function(item) {
    // Check WO status before syncing
    sb.get('work_orders', '?id=eq.'+item.wo_id+'&select=status,wo_number').then(function(r) {
      if (!r.ok || !r.data || !r.data.length) { removeFromOfflineQueue(item.id); return; }
      var wo = r.data[0];
      if (isProcessedStatus(wo.status)) {
        // WO was exported while offline — hold and notify
        conflicts.push({item:item, woNum:wo.wo_number});
        if (conflicts.length === pending.length || synced + conflicts.length === pending.length) {
          if (conflicts.length) showToast('⚠ '+conflicts.length+' offline entr'+(conflicts.length===1?'y':'ies')+' held — WO exported. Check with admin.');
        }
      } else {
        // Safe to sync
        sb.post(item.table, item.data).then(function(pr) {
          if (pr.ok) {
            removeFromOfflineQueue(item.id);
            synced++;
            if (synced === pending.length - conflicts.length) {
              showToast(synced+' offline entr'+(synced===1?'y':'ies')+' synced');
              if (AppState.currentWO && AppState.currentWO.id === item.wo_id) openWODetail(item.wo_id);
            }
          }
        });
      }
    });
  });
}

// Sync on reconnect
window.addEventListener('online', function() {
  document.getElementById('conn-bar').classList.remove('offline');
  setTimeout(syncOfflineQueue, 1000);
});

function loadAllData() {
  // Try cache version check, fall back to fresh fetch if anything fails
  var cacheCheckPromise = sb.get('settings', '?key=eq.cache_version&select=value').then(function(vr) {
    return (vr.ok && vr.data && vr.data.length) ? vr.data[0].value : '';
  }).catch(function() { return ''; });

  return cacheCheckPromise.then(function(serverVersion) {
    var localVersion = getCacheVersion();
    var cacheValid = serverVersion && localVersion === serverVersion;

    var lookupPromises;
    if (cacheValid) {
      var cached = {
        statuses: loadCache('statuses'),
        wo_flags: loadCache('wo_flags'),
        technicians: loadCache('technicians'),
        hours_types: loadCache('hours_types'),
        qbo_items: loadCache('qbo_items')
      };
      // Validate cached statuses have id field — required for settings edits
      var statusesValid = cached.statuses && cached.statuses.length && cached.statuses[0].id;
      if (statusesValid) {
        if (cached.statuses) AppState.statuses = cached.statuses;
        if (cached.wo_flags) AppState.woFlags = cached.wo_flags;
        if (cached.technicians) AppState.technicians = cached.technicians;
        if (cached.hours_types) AppState.hoursTypes = cached.hours_types;
        if (cached.qbo_items) AppState.qboItems = cached.qbo_items;
        // Always fetch settings fresh — never cache, so new keys always load
        lookupPromises = loadSettings();
      } else {
        // Cache invalid — fetch everything fresh
        lookupPromises = Promise.all([
          loadStatuses(), loadWoFlags(), loadTechnicians(), loadHoursTypes(), loadQBOItems(), loadSettings()
        ]).then(function() {
          saveCache('statuses', AppState.statuses);
          saveCache('wo_flags', AppState.woFlags);
          saveCache('technicians', AppState.technicians);
          saveCache('hours_types', AppState.hoursTypes);
          saveCache('qbo_items', AppState.qboItems);
          if (serverVersion) setCacheVersion(serverVersion);
        });
      }
    } else {
      lookupPromises = Promise.all([
        loadStatuses(), loadWoFlags(), loadTechnicians(), loadHoursTypes(), loadQBOItems(), loadSettings()
      ]).then(function() {
        saveCache('statuses', AppState.statuses);
        saveCache('wo_flags', AppState.woFlags);
        saveCache('technicians', AppState.technicians);
        saveCache('hours_types', AppState.hoursTypes);
        saveCache('qbo_items', AppState.qboItems);
        if (serverVersion) setCacheVersion(serverVersion);
      });
    }

    return lookupPromises.then(function() {
      return Promise.all([loadWorkOrders(), loadCustomers(), loadVendors(), loadTechSchedules()]);
    }).then(function() {
      if (AppState.settings.company_name) localStorage.setItem('dwo_company_name', AppState.settings.company_name);
      if (AppState.settings.company_logo_url !== undefined) localStorage.setItem('dwo_company_logo_url', AppState.settings.company_logo_url||'');
      applyCompanyBranding(AppState.settings.company_name, AppState.settings.company_logo_url);
      subscribeToWorkOrders();
      subscribeToHoursEntries();
    });
  }).catch(function(err) {
    console.error('loadAllData error:', err);
    showToast('⚠ Error loading data — using cached data');
    var cached = {
      statuses: loadCache('statuses'),
      wo_flags: loadCache('wo_flags'),
      technicians: loadCache('technicians'),
      hours_types: loadCache('hours_types'),
      qbo_items: loadCache('qbo_items')
    };
    if (cached.statuses) AppState.statuses = cached.statuses;
    if (cached.wo_flags) AppState.woFlags = cached.wo_flags;
    if (cached.technicians) AppState.technicians = cached.technicians;
    if (cached.hours_types) AppState.hoursTypes = cached.hours_types;
    if (cached.qbo_items) AppState.qboItems = cached.qbo_items;
    // Try to load settings even in error state
    return loadSettings().catch(function(){ return; }).then(function(){
      applyCompanyBranding(AppState.settings.company_name, AppState.settings.company_logo_url);
    });
  });
}

// SUPABASE REALTIME - auto-refresh work orders across all connected devices
var _realtimeWS = null;
var _realtimeHoursWS = null;

function subscribeToWorkOrders() {
  if (_realtimeWS) return; // already subscribed
  if (!AppState.session || !AppState.session.access_token) return;
  try {
    var wsUrl = SUPABASE_URL.replace('https://','wss://') + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';
    _realtimeWS = new WebSocket(wsUrl);
    var ref = 1;
    _realtimeWS.onopen = function() {
      var joinMsg = {
        topic: 'realtime:public:work_orders',
        event: 'phx_join',
        payload: {config:{postgres_changes:[{event:'*',schema:'public',table:'work_orders'}]}},
        ref: String(ref++)
      };
      _realtimeWS.send(JSON.stringify(joinMsg));
      // heartbeat every 25s to keep connection alive
      setInterval(function(){
        if (_realtimeWS && _realtimeWS.readyState===1) {
          _realtimeWS.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(ref++)}));
        }
      }, 25000);
    };
    _realtimeWS.onmessage = function(msg) {
      try {
        var data = JSON.parse(msg.data);
        if (data.event === 'postgres_changes' || (data.payload && data.payload.data)) {
          AppState.projectedCache = {};
          loadWorkOrders().then(function(){
            if (AppState.deviceMode==='desktop' && AppState.desktopPanel==='wo') {
              renderDesktopGrid();
              if (typeof refreshAgingBar==='function') refreshAgingBar();
            }
            else if (AppState.deviceMode==='mobile') filterWOList();
          });
        }
      } catch(e) {}
    };
    _realtimeWS.onerror = function() { _realtimeWS = null; };
    _realtimeWS.onclose = function() { _realtimeWS = null; };
  } catch(e) {
    console.log('Realtime WO subscription unavailable');
  }
}

function subscribeToHoursEntries() {
  if (_realtimeHoursWS) return;
  if (!AppState.session || !AppState.session.access_token) return;
  try {
    var wsUrl = SUPABASE_URL.replace('https://','wss://') + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';
    _realtimeHoursWS = new WebSocket(wsUrl);
    var ref = 1;
    _realtimeHoursWS.onopen = function() {
      var joinMsg = {
        topic: 'realtime:public:hours_entries',
        event: 'phx_join',
        payload: {config:{postgres_changes:[{event:'*',schema:'public',table:'hours_entries'}]}},
        ref: String(ref++)
      };
      _realtimeHoursWS.send(JSON.stringify(joinMsg));
      setInterval(function(){
        if (_realtimeHoursWS && _realtimeHoursWS.readyState===1) {
          _realtimeHoursWS.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(ref++)}));
        }
      }, 25000);
    };
    _realtimeHoursWS.onmessage = function(msg) {
      try {
        var data = JSON.parse(msg.data);
        if (data.event === 'postgres_changes' || (data.payload && data.payload.data)) {
          // Refresh timecard if it's open
          if (AppState.deviceMode==='desktop' && AppState.desktopPanel==='timecard') {
            if (typeof renderTimecard==='function') renderTimecard();
          }
        }
      } catch(e) {}
    };
    _realtimeHoursWS.onerror = function() { _realtimeHoursWS = null; };
    _realtimeHoursWS.onclose = function() { _realtimeHoursWS = null; };
  } catch(e) {
    console.log('Realtime hours subscription unavailable');
  }
}
function loadWoFlags() {
  return sb.get('wo_flags','?select=*&active=eq.true&order=sort_order.asc').then(function(r){
    if(r.ok && r.data && r.data.length) AppState.woFlags = r.data;
    else AppState.woFlags = [
      {system_key:'needs_paperwork', name:'Needs Entry Work', color:'#e67e22', blocks_export:true},
      {system_key:'needs_parts',     name:'Needs Parts',      color:'#2980b9', blocks_export:false},
      {system_key:'needs_review',    name:'Needs Review',     color:'#8e44ad', blocks_export:true},
      {system_key:'needs_po',        name:'Needs PO',         color:'#c0392b', blocks_export:true},
    ];
  });
}

function loadCompanyBranding() {
  // Read from localStorage first for instant display before auth
  var cachedName = localStorage.getItem('dwo_company_name');
  var cachedLogo = localStorage.getItem('dwo_company_logo_url');
  applyCompanyBranding(cachedName, cachedLogo);
  // Also try Supabase to get latest values
  return sb.get('settings','?key=in.(company_name,company_logo_url)&select=key,value').then(function(r){
    if (!r.ok || !r.data) return;
    var nameRow = r.data.find(function(s){ return s.key==='company_name'; });
    var logoRow = r.data.find(function(s){ return s.key==='company_logo_url'; });
    var name = nameRow ? nameRow.value : null;
    var logo = logoRow ? logoRow.value : null;
    if (name) localStorage.setItem('dwo_company_name', name);
    if (logo !== null) localStorage.setItem('dwo_company_logo_url', logo);
    applyCompanyBranding(name||cachedName, logo!==null?logo:cachedLogo);
  }).catch(function(){});
}

function applyCompanyBranding(name, logo) {
  var titleEl = document.getElementById('login-company-name');
  var logoEl = document.getElementById('login-company-logo');
  var markEl = document.getElementById('login-logo-mark');
  var headerTitleEl = document.getElementById('header-title-text');
  var headerLogoEl = document.getElementById('header-logo-img');
  if (name) {
    if (titleEl) titleEl.textContent = name;
    if (headerTitleEl) headerTitleEl.textContent = name;
  }
  if (logo) {
    if (logoEl) { logoEl.src = logo; logoEl.style.display = 'block'; if(markEl) markEl.style.display='none'; }
    if (headerLogoEl) { headerLogoEl.src = logo; headerLogoEl.style.display = 'block'; }
  } else {
    if (logoEl) logoEl.style.display = 'none';
    if (markEl) markEl.style.display = '';
    if (headerLogoEl) headerLogoEl.style.display = 'none';
  }
}


function loadStatuses() {
  return sb.get('wo_statuses','?select=id,num,name,color,category,system_key,mobile,sort_order,active&active=eq.true&order=sort_order.asc').then(function(r){
    if(r.ok && r.data && r.data.length) { AppState.statuses = r.data; saveCache('statuses', r.data); }
    else AppState.statuses = STATUSES_FALLBACK;
  });
}

function getStatus(n) {
  var list = (AppState && AppState.statuses && AppState.statuses.length) ? AppState.statuses : STATUSES_FALLBACK;
  return list.find(function(s){ return s.num==n; }) || { num:n, name:String(n), color:'#eee', category:'active', mobile:true };
}

function getStatusByKey(key) {
  var list = (AppState && AppState.statuses && AppState.statuses.length) ? AppState.statuses : STATUSES_FALLBACK;
  return list.find(function(s){ return s.system_key===key; }) || null;
}

function getCustName(custObj) {
  var pref = AppState.settings.customer_display_preference || 'display_name';
  if (!custObj) return '---';
  if (pref === 'name') return custObj.name || custObj.display_name || '---';
  return custObj.display_name || custObj.name || '---';
}

function loadWorkOrders() { return sb.get('work_orders','?select=*,customers(display_name,name)&order=created_at.asc').then(function(r){ if(r.ok) AppState.workOrders=r.data||[]; }); }
function refreshWOData() { showToast('Refreshing...'); AppState.projectedCache={}; loadWorkOrders().then(function(){ renderDesktopGrid(); if(typeof refreshAgingBar==='function') refreshAgingBar(); showToast('Refreshed'); }); }
function loadCustomers()  { return sb.get('customers','?select=*&order=name.asc').then(function(r){ if(r.ok) AppState.customers=r.data||[]; }); }
function loadTechnicians(){ return sb.get('technicians','?active=eq.true&select=*&order=name.asc').then(function(r){ if(r.ok) AppState.technicians=r.data||[]; }); }
function loadHoursTypes() {
  return sb.get('hours_types','?active=eq.true&select=*').then(function(r){
    if(r.ok) {
      AppState.hoursTypes = (r.data||[]).sort(function(a,b){
        function rank(n){ return n.toLowerCase().indexOf('overtime')>=0?3:n.toLowerCase().indexOf('helper')>=0?2:1; }
        return rank(a.name)-rank(b.name);
      });
    }
  });
}
function loadQBOItems()   { return sb.get('qbo_items','?active=eq.true&select=*&order=name.asc').then(function(r){ if(r.ok) AppState.qboItems=r.data||[]; }); }
function loadVendors()    { return sb.get('vendors','?active=eq.true&select=*&order=name.asc').then(function(r){ if(r.ok) AppState.vendors=r.data||[]; }); }
function loadSettings() {
  return sb.get('settings','?select=key,value').then(function(r){
    if(r.ok&&r.data){
      AppState.settings={};
      r.data.forEach(function(s){AppState.settings[s.key]=s.value;});
      saveCache('settings', r.data); // save raw array for cache restore
    }
  });
}

function getDefaultTechId() {
  var stored = localStorage.getItem('dwo_default_tech');
  if (stored) return stored;
  if (AppState.userRole === 'admin') {
    var kevin = AppState.technicians.find(function(t){ return t.name.toLowerCase().indexOf('kevin')>=0; });
    return (kevin && kevin.id) || (AppState.technicians[0] && AppState.technicians[0].id) || '';
  }
  return (AppState.technicians[0] && AppState.technicians[0].id) || '';
}
function setDefaultTech(id) { localStorage.setItem('dwo_default_tech', id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.add('hidden'); });
  var el = document.getElementById(id);
  if (el) { el.classList.remove('hidden'); el.scrollTop = 0; }
}

function showHeader(show, title, showBack) {
  title = title || 'ProMech'; showBack = showBack || false;
  var hd = document.getElementById('app-header'); hd.style.display = show ? 'flex' : 'none';
  var _ht = document.getElementById('header-title-text'); if(_ht) _ht.textContent = title;
  document.getElementById('btn-back').style.display = showBack ? '' : 'none';
  var mb = document.getElementById('btn-mode-toggle');
  var hb = document.getElementById('btn-hamburger');
  if (AppState.userRole === 'admin' && AppState.deviceMode === 'desktop') { mb.style.display = ''; mb.textContent = AppState.deviceMode === 'mobile' ? 'desktop' : 'mobile'; }
  else mb.style.display = 'none';
  if (hb) hb.style.display = (show && AppState.deviceMode === 'mobile' && !showBack) ? '' : 'none';
  // On mobile with back button, hide the title text to give back button room
  var titleText = document.getElementById('header-title-text');
  if (titleText) titleText.style.display = (AppState.deviceMode === 'mobile' && showBack) ? 'none' : '';
}

function showMainScreen() {
  AppState.screenStack = [];
  resolveUserTechId(); // Set AppState.userTechId once from authenticated email
  var mv = document.getElementById('mobile-version'); if(mv) mv.textContent = 'v' + APP_VERSION;
  if (AppState.deviceMode === 'desktop') { showScreen('screen-desktop'); showHeader(true,'ProMech',false); initDesktop(); }
  else { showScreen('screen-wo-list'); showHeader(true,'ProMech',false); renderWOList(); if(typeof initMobileFilters==='function') initMobileFilters(); }
}

function updateReturnBanner() {
  ['return-banner-hours','return-banner-parts','return-banner-quoted'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.style.display = AppState._returnToExportReview ? 'block' : 'none';
  });
}

function pushScreen(id, title) {
  var cur = document.querySelector('.screen:not(.hidden)');
  AppState.screenStack.push(cur && cur.id);
  showScreen(id); showHeader(true, title, true);
  updateReturnBanner();
}

function goBack() {
  // If we came from export review, return there
  if (AppState._returnToExportReview) {
    var curScreen = document.querySelector('.screen:not(.hidden)');
    if (curScreen && ['screen-wo-detail','screen-hours-list','screen-parts-list'].indexOf(curScreen.id) >= 0) {
      returnToExportReview();
      return;
    }
  }
  // Check if leaving a timecard WO that needs review
  var cur = document.querySelector('.screen:not(.hidden)');
  if (cur && cur.id === 'screen-wo-detail') {
    var wo = AppState.currentWO;
    if (wo && wo.origin === 'timecard' && AppState.lineItems && AppState.lineItems.filter(function(e){return e.active!==false;}).length > 0) {
      if (confirm('This WO was created from timecard and has parts/services entries. Mark as reviewed before leaving?')) {
        clearWOOriginFlag();
        return;
      }
    }
  }
  _goBackImpl();
}

function _goBackImpl() {
  var prev = AppState.screenStack.pop();
  if (!prev) { showMainScreen(); return; }
  showScreen(prev);
  // Top-level screens reached via hamburger/sidebar nav - no further back, header shows app title only
  var topLevel = ['screen-wo-list','screen-desktop','screen-mobile-truckstock','screen-mobile-timecard','screen-mobile-dailyreview','screen-settings-mobile'];
  if (prev === 'screen-wo-list') { showHeader(true,'ProMech',false); filterWOList(); }
  else if (prev === 'screen-desktop') { showHeader(true,'ProMech',false); }
  else if (prev === 'screen-wo-detail') { showHeader(true, (AppState.currentWO && AppState.currentWO.wo_number) || 'WO', true); renderWODetail(AppState.currentWO); }
  else if (prev === 'screen-mobile-truckstock') { showHeader(true,'Truck Stock',true); renderMobileTSList(); }
  else if (prev === 'screen-mobile-timecard') { showHeader(true,'Timecard',true); renderMobileTimecard(); }
  else if (prev === 'screen-mobile-dailyreview') { showHeader(true,'Field Travel Log',true); }
  else if (prev === 'screen-settings-mobile') { showHeader(true,'Settings',true); }
  else { showHeader(true,'ProMech', AppState.screenStack.length>0); }
}

function setTheme(t) { AppState.theme=t; document.documentElement.setAttribute('data-theme',t); document.getElementById('btn-theme').textContent=t==='dark'?'Dark':'Light'; localStorage.setItem('dwo_theme',t); }
function toggleTheme() { setTheme(AppState.theme==='light'?'dark':'light'); }

// WO LIST
function renderWOList() { filterWOList(); initWOSortSelector(); }
function renderWOList() { filterWOList(); initWOSortSelector(); }
function filterMobileWOList() { filterWOList(); }

function initWOSortSelector() {
  var el = document.getElementById('mobile-sort-filter');
  if (!el) return;
  var pref = (AppState.settings && AppState.settings.wo_sort_order) || 'newest';
  el.value = pref;
}

function saveWOSortPref(val) {
  if (!AppState.settings) AppState.settings = {};
  AppState.settings.wo_sort_order = val;
  filterWOList();
  var sb = getSupabase ? getSupabase() : null;
  if (!sb) return;
  sb.get('settings', '?key=eq.wo_sort_order').then(function(r) {
    if (r.ok && r.data && r.data.length) {
      sb.patch('settings', '?key=eq.wo_sort_order', { value: val, modified_at: new Date().toISOString() });
    } else {
      sb.post('settings', { key: 'wo_sort_order', value: val });
    }
  });
}
function openHamburger() {
  var menu = document.getElementById('hamburger-menu');
  var overlay = document.getElementById('hamburger-overlay');
  if (menu) menu.classList.add('open');
  if (overlay) overlay.classList.add('open');
}

function closeHamburger() {
  var menu = document.getElementById('hamburger-menu');
  var overlay = document.getElementById('hamburger-overlay');
  if (menu) menu.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function hamburgerNav(dest) {
  closeHamburger();
  if (dest==='morningbrief') { initMorningBrief(); pushScreen('screen-morning-brief','Morning Brief'); }
  else if (dest==='wo') { showScreen('screen-wo-list'); showHeader(true,'ProMech',false); if(typeof initMobileFilters==='function') initMobileFilters(); filterWOList(); }
  else if (dest==='dailyreview') { initMobileDailyReview(); pushScreen('screen-mobile-dailyreview','Field Travel Log'); }
  else if (dest==='endofday') { initEndOfDay(); pushScreen('screen-end-of-day','End of Day'); }
  else if (dest==='timecard') { initMobileTimecard(); pushScreen('screen-mobile-timecard','Timecard'); }
  else if (dest==='truckstock') { initMobileTruckStock(); pushScreen('screen-mobile-truckstock','Truck Stock'); }
  else if (dest==='invoices') { pushScreen('screen-mobile-invoices','Invoices'); }
  else if (dest==='locations') { pushScreen('screen-mobile-locations','Locations'); }
  else if (dest==='settings') { renderSettings('settings-body-mobile'); pushScreen('screen-settings-mobile','Settings'); }
}

function toggleMobileFilters() { /* filters now always visible */ }
function filterWOList() {
  var q = ((document.getElementById('mobile-wo-search')&&document.getElementById('mobile-wo-search').value)||'').toLowerCase();
  var statusEl = document.getElementById('mobile-status-filter');
  var modeEl = document.getElementById('mobile-mode-filter');
  var statusSel = (statusEl && statusEl.value) || 'live';
  var modeSel = (modeEl && modeEl.value) || '';
  var wos = AppState.workOrders.filter(function(w){ return w.active !== false; });
  // Mobile always excludes processed/cancelled by default
  if (statusSel === 'live') wos = wos.filter(function(w){ return isLiveStatus(w.status); });
  else if (statusSel === 'processed') wos = wos.filter(function(w){ return isProcessedStatus(w.status); });
  // Never show cancelled on mobile unless explicitly selected
  if (statusSel !== 'all' && statusSel !== 'processed') wos = wos.filter(function(w){ return statusCat(w.status) !== 'cancelled'; });
  if (modeSel) wos = wos.filter(function(w){ return w.form_mode === modeSel; });
  if (q) wos = wos.filter(function(w){
    return (w.title||'').toLowerCase().indexOf(q)>=0
      || (getCustName(w.customers)||'').toLowerCase().indexOf(q)>=0
      || (w.wo_number||'').toLowerCase().indexOf(q)>=0;
  });
  var woSortPref = (AppState.settings && AppState.settings.wo_sort_order) || 'newest';
  if (woSortPref === 'newest') {
    wos.sort(function(a,b){ return new Date(b.modified_at||b.created_at)-new Date(a.modified_at||a.created_at); });
  } else if (woSortPref === 'oldest') {
    wos.sort(function(a,b){ return new Date(a.modified_at||a.created_at)-new Date(b.modified_at||b.created_at); });
  } else if (woSortPref === 'wo_number') {
    wos.sort(function(a,b){ return (b.wo_number||'').localeCompare(a.wo_number||''); });
  }
  var c = document.getElementById('wo-list-items'); if (!c) return;
  if (!wos.length) { c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No work orders found</div>'; return; }
  var _fd = AppState.woFlags.length ? AppState.woFlags : [{system_key:'needs_paperwork',name:'Paperwork',color:'#e67e22'},{system_key:'needs_parts',name:'Parts',color:'#2980b9'},{system_key:'needs_review',name:'Review',color:'#8e44ad'},{system_key:'needs_po',name:'PO',color:'#c0392b'}];
  c.innerHTML = wos.map(function(wo){
    var st = getStatus(wo.status);
    var cust = getCustName(wo.customers)||'(no customer)';
    var isLocked = isProcessedStatus(wo.status);
    var flagBadges = _fd.map(function(f){
      return wo['flag_'+f.system_key]?'<span style="font-size:10px;background:'+f.color+'22;color:'+f.color+';border:1px solid '+f.color+';border-radius:3px;padding:1px 4px;margin-right:2px">⚑ '+f.name+'</span>':'';
    }).join('');
    var isQuoted = wo.form_mode === 'quoted';
    var borderColor = isQuoted ? '#b45309' : st.color;
    return '<div style="background:var(--surface);border-left:4px solid '+borderColor+';border-radius:0 var(--radius) var(--radius) 0;padding:12px 14px;margin-bottom:8px;cursor:pointer;'+(isLocked?'opacity:0.6':'')+'" onclick="openWODetail(\''+wo.id+'\')">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
      + '<span style="font-weight:700;font-size:15px;color:var(--text-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(wo.wo_number)+(wo.title?' — '+escHtml(wo.title):'')+'</span>'
      + '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;margin-left:8px">'
      + (isQuoted?'<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:#fef3c7;color:#b45309;border:1px solid #b45309">QUOTED</span>':'')
      + '<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;background:'+st.color+';color:#fff">'+escHtml(st.name)+'</span>'
      + '</div>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--text-secondary)">'+escHtml(cust)+'</div>'
      + (flagBadges?'<div style="margin-top:5px">'+flagBadges+'</div>':'')
      + (isLocked?'<div style="font-size:10px;color:var(--text-muted);margin-top:3px">Locked</div>':'')
      + '</div>';
  }).join('');
}

// WO DETAIL
function openWODetail(id) {
  var wo = AppState.workOrders.find(function(w){ return w.id===id; });
  if (!wo) return;
  AppState.currentWO = wo;
  AppState._isTruckStockEntry = false;
  var banner = document.getElementById('parts-wo-banner');
  if (banner) banner.style.display = 'none';
  Promise.all([
    sb.get('hours_entries','?work_order_id=eq.'+id+'&select=*,technicians(name),hours_types(name,internal_rate_key)&order=entry_date.asc'),
    sb.get('line_items','?work_order_id=eq.'+id+'&select=*,vendors(name),qbo_items(name)&order=transaction_date.asc'),
    sb.get('quoted_invoices','?work_order_id=eq.'+id+'&select=*&order=created_at.asc'),
  ]).then(function(results) {
    AppState.hoursEntries = results[0].ok ? results[0].data||[] : [];
    AppState.lineItems    = results[1].ok ? results[1].data||[] : [];
    AppState.quotedLines  = results[2].ok ? results[2].data||[] : [];
    renderWODetail(wo);
    var headerTitle = wo.wo_number + (wo.title ? ' — ' + wo.title : '');
    pushScreen('screen-wo-detail', headerTitle);
  });
}

function renderWODetail(wo) {
  var st = getStatus(wo.status);
  var custObj = AppState.customers.find(function(c){ return c.id===wo.customer_id; });
  var cust = getCustName(wo.customers) || getCustName(custObj) || '---';
  var isAdmin = AppState.userRole === 'admin';
  var activeH = AppState.hoursEntries.filter(function(e){ return e.active!==false; });
  var activeL = AppState.lineItems.filter(function(e){ return e.active!==false; });
  var activeQ = AppState.quotedLines.filter(function(e){ return e.active!==false; });
  var hoursTotal = activeH.reduce(function(s,e){ return s+parseFloat(e.hours||0); },0);
  var hoursVal = activeH.reduce(function(s,e){
    var ht = e.hours_types;
    var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
    return s+parseFloat(e.hours||0)*rate;
  },0);
  var partsTotal = activeL.filter(function(e){ return e.transaction_type!=='vendor_credit'; }).reduce(function(s,e){ return s+parseFloat(e.sell_total||0); },0);
  var creditsTotal = activeL.filter(function(e){ return e.transaction_type==='vendor_credit'; }).reduce(function(s,e){ return s+parseFloat(e.sell_total||0); },0);
  var quotedTotal = activeQ.reduce(function(s,e){ return s+parseFloat(e.amount||0); },0);
  var projected = wo.form_mode==='quoted' ? quotedTotal : (hoursVal+partsTotal-creditsTotal);
  AppState.projectedCache[wo.id] = projected;

  var out = '';
  if (isCompletedStatus(wo.status) && isAdmin) out += '<div class="completion-banner">Ready to export - use Desktop Review to export to Zed Axis</div>';
  var isLocked = isProcessedStatus(wo.status);
  if (isLocked) {
    out += '<div style="background:#99999918;border:1px solid #999;border-radius:var(--radius);padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">'
      + '<span style="font-size:13px;font-weight:600;color:var(--text-muted)">🔒 This WO has been exported and is locked for editing</span>'
      + (isAdmin ? '<button style="font-size:12px;padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--text-muted);background:none;color:var(--text-muted);cursor:pointer" onclick="unlockWO()">Unlock WO</button>' : '')
      + '</div>';
  }
  if (wo.origin==='timecard') {
    var hasPartsEntries = activeL && activeL.length > 0;
    var bannerMsg = hasPartsEntries ? '&#9888; Parts &amp; services entries exist — ready to mark as reviewed' : '&#9888; Created from timecard — review for missing parts &amp; services';
    var bannerCol = hasPartsEntries ? '#27ae60' : '#e67e22';
    out += '<div style="background:'+bannerCol+'18;border:1px solid '+bannerCol+';border-radius:var(--radius);padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between"><span style="font-size:13px;font-weight:600;color:'+bannerCol+'">'+bannerMsg+'</span>'+(isAdmin?'<button style="font-size:12px;padding:4px 10px;border-radius:var(--radius-sm);border:1px solid '+bannerCol+';background:none;color:'+bannerCol+';cursor:pointer" onclick="clearWOOriginFlag()">Mark Reviewed</button>':'')+'</div>';
  }
  // WO Flags
  var flagDefs = AppState.woFlags.length ? AppState.woFlags.map(function(f){
    return {key:'flag_'+f.system_key, note:'flag_'+f.system_key+'_note', label:f.name, color:f.color};
  }) : [
    {key:'flag_needs_paperwork', note:'flag_needs_paperwork_note', label:'Needs Paperwork', color:'#e67e22'},
    {key:'flag_needs_parts',     note:'flag_needs_parts_note',     label:'Needs Parts',     color:'#2980b9'},
    {key:'flag_needs_review',    note:'flag_needs_review_note',    label:'Needs Review',    color:'#8e44ad'},
    {key:'flag_needs_po',        note:'flag_needs_po_note',        label:'Needs PO',        color:'#c0392b'},
  ];
  var activeFlags = flagDefs.filter(function(f){ return wo[f.key]; });
  var inactiveFlags = flagDefs.filter(function(f){ return !wo[f.key]; });
  // Active flag banners — stay at top
  var activeFlagHtml = '';
  activeFlags.forEach(function(f){
    var note = wo[f.note] || '';
    var isPOFlag = f.key === 'flag_needs_po';
    activeFlagHtml += '<div style="background:'+f.color+'18;border:1px solid '+f.color+';border-radius:var(--radius);padding:8px 12px;margin-bottom:6px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between">'
      + '<div><span style="font-size:12px;font-weight:700;color:'+f.color+'">\u2691 '+f.label+'</span>'
      + (note?'<span style="font-size:12px;color:var(--text-secondary);margin-left:8px">'+escHtml(note)+'</span>':'')
      + '</div>'
      + '<button data-fk="'+f.key+'" data-fn="'+f.note+'" style="font-size:11px;padding:3px 8px;border:1px solid '+f.color+';border-radius:3px;background:none;color:'+f.color+';cursor:pointer" onclick="clearWOFlag(this.getAttribute(\'data-fk\'),this.getAttribute(\'data-fn\'))">Clear</button>'
      + '</div>'
      + (isPOFlag ? '<div style="display:flex;gap:6px;margin-top:8px;align-items:center">'
        + '<input type="text" id="inline-po-input" placeholder="Enter PO number" onkeydown="if(event.key===\'Enter\')saveInlinePO()" style="flex:1;font-size:13px;padding:5px 8px;border:1px solid '+f.color+';border-radius:var(--radius-sm)">'
        + '<button style="font-size:12px;padding:5px 12px;border:none;border-radius:var(--radius-sm);background:'+f.color+';color:#fff;cursor:pointer" onclick="saveInlinePO()">Save PO</button>'
        + '</div>' : '')
      + '</div>';
  });
  if (activeFlagHtml) out += '<div style="margin-bottom:10px">'+activeFlagHtml+'</div>';
  out += '<div class="wo-header-info">';
  if (AppState.deviceMode === 'mobile') {
    // Mobile: WO number + title + customer + status
    out += '<div style="padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:6px">';
    out += '<div style="font-size:14px;font-weight:700;color:var(--header-bg)">'+escHtml(wo.wo_number)+(wo.title?' — '+escHtml(wo.title):'')+'</div>';
    out += '<div style="font-size:13px;color:var(--text-muted);margin-top:2px">'+escHtml(cust)+'</div>';
    out += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px">';
    out += '<span class="badge" style="background:'+st.color+';font-size:11px;padding:3px 8px">'+String(wo.status).padStart(2,'0')+' '+st.name+'</span>';
    out += '<span style="font-size:12px;color:var(--text-muted)">'+(wo.form_mode==='quoted'?'Quoted':'T&M')+'</span>';
    if (wo.po_number) out += '<span style="font-size:12px;color:var(--text-muted)">PO: '+escHtml(wo.po_number)+'</span>';
    out += '</div></div>';
  } else {
    // Desktop: full header fields
    out += '<div class="field-group" style="border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:2px"><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:15px;font-weight:700;color:var(--header-bg)">'+escHtml(wo.wo_number)+'</span><span style="font-size:15px;font-weight:600">'+escHtml(wo.title||'')+'</span></div><div style="font-size:13px;color:var(--text-muted);margin-top:2px">'+escHtml(cust)+'</div></div>';
    out += '<div class="field-group"><div class="field-label">Mode</div><div class="field-value">'+(wo.form_mode==='quoted'?'Quoted':'T&M')+'</div></div>';
    out += '<div class="field-group"><div class="field-label">Status</div><div class="field-value"><span class="badge" style="background:'+st.color+';font-size:11px;padding:2px 7px">'+String(wo.status).padStart(2,'0')+' '+st.name+'</span></div></div>';
    out += '<div class="field-group"><div class="field-label">PO #</div><div class="field-value">'+(wo.po_number||'---')+'</div></div>';
    if (wo.created_at) out += '<div class="field-group"><div class="field-label">Created</div><div class="field-value">'+fmtDate(wo.created_at)+'</div></div>';
    if (wo.completed_at) out += '<div class="field-group"><div class="field-label">Completed</div><div class="field-value">'+fmtDate(wo.completed_at)+'</div></div>';
    if (wo.work_description) out += '<div class="field-group full-width"><div class="field-label">Notes</div><div class="field-value">'+escHtml(wo.work_description)+'</div></div>';
  }
  out += '</div>';
  if (AppState.deviceMode === 'desktop') {
    // DESKTOP: inline spreadsheet layout
    out += renderWODetailDesktop(wo, activeH, activeL, activeQ, hoursVal, partsTotal, creditsTotal, quotedTotal, projected, isAdmin, isLocked, inactiveFlags);
  } else {
    // MOBILE: compact collapsible tiles
    // Hours tile
    out += '<div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden">';
    out += '<div style="display:flex;align-items:center;padding:12px 14px;background:var(--surface);cursor:pointer" onclick="toggleMobileTile(\'mobile-hours-body\')">';
    out += '<span style="font-size:14px;font-weight:700;flex:1">⏱ Hours</span>';
    out += '<span style="font-size:13px;color:var(--text-muted);margin-right:10px">'+activeH.length+' · '+hoursTotal.toFixed(1)+'h · $'+hoursVal.toFixed(2)+'</span>';
    if (!isLocked) out += '<button onclick="event.stopPropagation();openHoursEntry()" style="font-size:13px;padding:8px 16px;min-height:44px;border:none;border-radius:var(--radius-sm);background:var(--header-bg);color:#fff;font-weight:600">+ Add</button>';
    out += '<span style="margin-left:8px;color:var(--text-muted)">›</span>';
    out += '</div>';
    out += '<div id="mobile-hours-body" style="display:none;border-top:1px solid var(--border)">';
    if (activeH.length) {
      activeH.forEach(function(e){
        var techName = (e.technicians&&e.technicians.name)||'';
        var typeName = (e.hours_types&&e.hours_types.name)||'';
        var ht = e.hours_types; var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
        var val = parseFloat(e.hours||0)*rate;
        out += '<div style="padding:8px 14px;border-bottom:0.5px solid var(--border);font-size:13px">';
        out += '<div style="display:flex;justify-content:space-between"><span><strong>'+fmtDate(e.entry_date)+'</strong> · '+escHtml(techName)+' · '+escHtml(typeName)+'</span><span style="font-weight:600">$'+val.toFixed(2)+'</span></div>';
        out += '<div style="color:var(--text-muted);font-size:12px">'+parseFloat(e.hours||0).toFixed(1)+' hrs'+( e.descriptor?' · '+escHtml(e.descriptor):'')+'</div>';
        out += '</div>';
      });
    } else {
      out += '<div style="padding:12px 14px;font-size:13px;color:var(--text-muted);text-align:center">No hours yet — tap + Add</div>';
    }
    out += '<div style="padding:10px 14px"><button onclick="openHoursList()" style="font-size:12px;color:var(--header-bg);background:none;border:none;cursor:pointer">View all →</button></div>';
    out += '</div></div>';

    // Parts tile
    out += '<div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden">';
    out += '<div style="display:flex;align-items:center;padding:12px 14px;background:var(--surface);cursor:pointer" onclick="toggleMobileTile(\'mobile-parts-body\')">';
    out += '<span style="font-size:14px;font-weight:700;flex:1">🔧 Parts &amp; Services</span>';
    out += '<span style="font-size:13px;color:var(--text-muted);margin-right:10px">'+activeL.length+' · $'+partsTotal.toFixed(2)+'</span>';
    if (!isLocked) out += '<button onclick="event.stopPropagation();openPartsEntry()" style="font-size:13px;padding:8px 16px;min-height:44px;border:none;border-radius:var(--radius-sm);background:var(--header-bg);color:#fff;font-weight:600">+ Add</button>';
    out += '<span style="margin-left:8px;color:var(--text-muted)">›</span>';
    out += '</div>';
    out += '<div id="mobile-parts-body" style="display:none;border-top:1px solid var(--border)">';
    if (activeL.length) {
      activeL.forEach(function(e){
        out += '<div style="padding:8px 14px;border-bottom:0.5px solid var(--border);font-size:13px">';
        out += '<div style="display:flex;justify-content:space-between"><span>'+escHtml(e.description||e.descriptor||'')+'</span><span style="font-weight:600">$'+parseFloat(e.sell_total||0).toFixed(2)+'</span></div>';
        out += '<div style="color:var(--text-muted);font-size:12px">'+fmtDate(e.transaction_date)+' · qty '+parseFloat(e.qty||1).toFixed(0)+'</div>';
        out += '</div>';
      });
    } else {
      out += '<div style="padding:12px 14px;font-size:13px;color:var(--text-muted);text-align:center">No parts yet — tap + Add</div>';
    }
    out += '<div style="padding:10px 14px"><button onclick="openPartsList()" style="font-size:12px;color:var(--header-bg);background:none;border:none;cursor:pointer">View all →</button></div>';
    out += '</div></div>';

    // Totals
    out += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;margin-bottom:8px">';
    out += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Hours</span><span>$'+hoursVal.toFixed(2)+'</span></div>';
    out += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Parts</span><span>$'+partsTotal.toFixed(2)+'</span></div>';
    if (creditsTotal>0) out += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Credits</span><span>-$'+creditsTotal.toFixed(2)+'</span></div>';
    out += '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span>Total</span><span>$'+projected.toFixed(2)+'</span></div>';
    out += '</div>';

    // Flags at bottom
    out += '<div style="margin-bottom:8px">';
    var flagDefs2 = AppState.woFlags.length ? AppState.woFlags.map(function(f){ return {key:'flag_'+f.system_key,note:'flag_'+f.system_key+'_note',label:f.name,color:f.color}; }) : [{key:'flag_needs_paperwork',note:'flag_needs_paperwork_note',label:'Needs Entry Work',color:'#e67e22'},{key:'flag_needs_parts',note:'flag_needs_parts_note',label:'Needs Parts',color:'#2980b9'},{key:'flag_needs_review',note:'flag_needs_review_note',label:'Needs Review',color:'#8e44ad'},{key:'flag_needs_po',note:'flag_needs_po_note',label:'Needs PO',color:'#c0392b'}];
    var inactiveFlags2 = flagDefs2.filter(function(f){ return !wo[f.key]; });
    if (inactiveFlags2.length && !isLocked) {
      out += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">';
      inactiveFlags2.forEach(function(f){
        out += '<button style="font-size:11px;padding:4px 10px;border:1px solid '+f.color+';border-radius:var(--radius-sm);background:none;color:'+f.color+';cursor:pointer" onclick="setWOFlag(\''+f.key+'\',\''+f.note+'\',\''+f.label+'\')">+ '+escHtml(f.label)+'</button>';
      });
      out += '</div>';
    }
    out += '</div>';

    // Action buttons
    out += '<button class="save-btn" style="min-height:48px;font-size:15px;margin-top:8px" onclick="AppState.batchStatusMode=false;openStatusSheet()">Save / Change Status</button>';
    if (isAdmin) out += '<button class="save-btn secondary" style="min-height:44px;font-size:14px" onclick="openEditWO()">Edit WO Details</button>';
  }
  document.getElementById('wo-detail-body').innerHTML = out;
  if (AppState.deviceMode === 'desktop') {
    initWODetailSpreadsheet(wo);
  }
}

// STATUS SHEET
function openStatusSheet() {
  var isAdmin = AppState.userRole==='admin';
  var wo = AppState.currentWO;
  if (!wo && !AppState.batchStatusMode) { showToast('No work order selected'); return; }
  var currentCat = wo ? statusCat(wo.status) : 'draft';
  var allowed = allowedTransitions(currentCat, isAdmin);
  var list = (AppState.statuses && AppState.statuses.length) ? AppState.statuses : STATUSES_FALLBACK;
  var avail = list.filter(function(s){
    if (s.active===false) return false;
    if (wo && s.num === wo.status) return false; // hide current status
    return isAdmin ? true : (allowed.indexOf(s.category)>=0);
  });
  var warning = '';
  if (AppState.batchStatusMode) {
    var count = selSize();
    warning = '<div style="background:var(--danger);color:#fff;padding:10px 14px;font-size:13px;font-weight:700;text-align:center">BATCH MODE - changes '+count+' work orders</div>';
  }
  var html = avail.map(function(s) {
    return '<div class="status-option" onclick="setWOStatus('+s.num+')">'
      + '<div class="status-dot" style="background:'+s.color+'"></div>'
      + '<span class="status-num">'+String(s.num).padStart(2,'0')+'</span>'
      + '<span class="status-name">'+s.name+'</span>'
      + (wo&&wo.status===s.num?'<span class="status-current">CURRENT</span>':'')
      + '</div>';
  }).join('');
  var sheetEl = document.getElementById('status-sheet');
  if (!sheetEl) { showToast('Status sheet element missing'); return; }
  if (!avail.length) { showToast('No available statuses ('+currentCat+')'); return; }
  sheetEl.querySelector('#status-options-list') || (sheetEl.innerHTML += '<div id="status-options-list"></div>');
  document.getElementById('status-options-list').innerHTML = warning + html;
  sheetEl.classList.add('open');
}
function closeStatusSheet(e) { if(!e||e.target===document.getElementById('status-sheet')) { document.getElementById('status-sheet').classList.remove('open'); AppState.batchStatusMode=false; } }

function setWOStatus(num) {
  var wasBatch = AppState.batchStatusMode;
  var ssEl = document.getElementById('status-sheet');
  if (ssEl) ssEl.classList.remove('open');
  if (wasBatch) {
    AppState.batchStatusMode = false;
    var ids = selIds(); if(!ids.length) return;
    var promises = ids.map(function(id) {
      return sb.patch('work_orders',id,{status:num,modified_by:AppState.userEmail}).then(function() {
        var wo = AppState.workOrders.find(function(w){ return w.id===id; }); if(wo) wo.status=num;
      });
    });
    Promise.all(promises).then(function() { clearSelection(); renderDesktopGrid(); showToast('Status updated for '+ids.length+' WOs'); });
    return;
  }
  var wo = AppState.currentWO; if(!wo) return;
  var isAdmin = AppState.userRole==='admin';
  var fromCat = statusCat(wo.status);
  var toCat = statusCat(num);
  var allowed = allowedTransitions(fromCat, isAdmin);
  if (allowed.indexOf(toCat) < 0) {
    showToast('Transition not allowed: '+fromCat+' → '+toCat);
    return;
  }
  var updates = { status: num, modified_by: AppState.userEmail };
  if (isCompletedStatus(num) && !wo.completed_at) updates.completed_at = new Date().toISOString();

  // Validate entries before moving to completed category
  if (toCat === 'completed') {
    var activeH = AppState.hoursEntries.filter(function(e){ return e.active!==false && e.work_order_id===wo.id; });
    var activeL = AppState.lineItems.filter(function(e){ return e.active!==false && e.work_order_id===wo.id; });
    // If both arrays empty, query Supabase to confirm (handles new WO case)
    if (!activeH.length && !activeL.length) {
      sb.get('hours_entries', '?work_order_id=eq.'+wo.id+'&active=eq.true&select=id&limit=1').then(function(hr) {
        sb.get('line_items', '?work_order_id=eq.'+wo.id+'&active=eq.true&select=id&limit=1').then(function(lr) {
          var hasH = hr.ok && hr.data && hr.data.length > 0;
          var hasL = lr.ok && lr.data && lr.data.length > 0;
          if (!hasH && !hasL) {
            showToast('Cannot complete — no hours or parts/services entries found');
            return;
          }
          if (!hasH) { if (!confirm('No hours entries on this WO. Mark as completed anyway?')) return; }
          if (!hasL) { if (!confirm('No parts/services entries on this WO. Mark as completed anyway?')) return; }
          _doSetWOStatus(wo, num, updates, toCat, fromCat);
        });
      });
      return; // wait for async check
    }
    var hasHours = activeH.length > 0;
    var hasParts = activeL.length > 0;
    if (!hasHours && !hasParts) { showToast('Cannot complete — no hours or parts/services entries found'); return; }
    if (!hasHours) { if (!confirm('No hours entries on this WO. Mark as completed anyway?')) return; }
    if (!hasParts) { if (!confirm('No parts/services entries on this WO. Mark as completed anyway?')) return; }
  }
  _doSetWOStatus(wo, num, updates, toCat, fromCat);
}

function _doSetWOStatus(wo, num, updates, toCat, fromCat) {
  if (toCat==='active' && fromCat==='completed') updates.completed_at = null;
  sb.patch('work_orders', wo.id, updates).then(function(r) {
    if (r.ok) {
      wo.status = num;
      if(updates.completed_at !== undefined) wo.completed_at = updates.completed_at;
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if(idx>=0) {
        AppState.workOrders[idx].status=num;
        if(updates.completed_at !== undefined) AppState.workOrders[idx].completed_at=updates.completed_at;
      }
      delete AppState.projectedCache[wo.id];
      renderWODetail(wo);
      renderDesktopGrid();
      showToast('Status updated');
      // Navigate back
      if (AppState.deviceMode === 'mobile') {
        AppState.screenStack = [];
        showScreen('screen-wo-list');
        showHeader(true, AppState.settings.company_name||'ProMech', false);
        filterWOList();
      }
    } else showToast('Error saving status');
  });
}

// NEW / EDIT WO
function openNewWO() {
  AppState.editingWOId = null; AppState.currentWO = null;
  var nextNum = parseInt(AppState.settings.wo_number_next||'26300');
  var prefix = AppState.settings.wo_number_prefix||'P';
  var woNum = prefix+nextNum;
  // Note: counter is NOT incremented here — it increments only on successful save
  document.getElementById('f-title').value = '';
  document.getElementById('f-form-mode').value = 'time_materials';
  document.getElementById('f-po-number').value = '';
  document.getElementById('f-work-description').value = '';
  document.getElementById('f-wo-number').value = woNum;
  document.getElementById('f-customer-input').value = '';
  document.getElementById('f-customer-id').value = '';
  // Populate status dropdown with draft/active statuses
  var statusSel = document.getElementById('f-status');
  if (statusSel) {
    var startStatuses = AppState.statuses.filter(function(s){ return s.category==='draft'||s.category==='active'; });
    statusSel.innerHTML = startStatuses.map(function(s){
      var sel = s.name==='Work Ready' ? ' selected' : '';
      return '<option value="'+s.num+'"'+sel+'>'+String(s.num).padStart(2,'0')+' '+escHtml(s.name)+'</option>';
    }).join('');
  }
  // Update button labels based on context
  var closeBtn = document.getElementById('wo-save-close-btn');
  var stayBtn = document.getElementById('wo-save-stay-btn');
  if (closeBtn && AppState.deviceMode === 'mobile') closeBtn.textContent = 'Save & Open WO';
  else if (closeBtn) closeBtn.innerHTML = 'Save &amp; Close';
  if (stayBtn) stayBtn.style.display = AppState.deviceMode === 'mobile' ? 'none' : '';
  pushScreen('screen-wo-form', 'New WO - '+woNum);
}

function setWOFlag(flagKey, noteKey, label) {
  var wo = AppState.currentWO; if(!wo) return;
  var note = prompt('What is needed? (optional note for ' + label + ')') ;
  if (note === null) return; // cancelled
  var updates = {modified_by: AppState.userEmail};
  updates[flagKey] = true;
  if (note.trim()) updates[noteKey] = note.trim();
  sb.patch('work_orders', wo.id, updates).then(function(r) {
    if (r.ok) {
      wo[flagKey] = true;
      if (note.trim()) wo[noteKey] = note.trim();
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if(idx>=0) { AppState.workOrders[idx][flagKey]=true; if(note.trim()) AppState.workOrders[idx][noteKey]=note.trim(); }
      renderWODetail(wo); renderDesktopGrid(); showToast(label+' flag set');
    } else showToast('Error setting flag');
  });
}

function clearWOFlag(flagKey, noteKey) {
  var wo = AppState.currentWO; if(!wo) return;
  var updates = {modified_by: AppState.userEmail};
  updates[flagKey] = false;
  updates[noteKey] = null;
  sb.patch('work_orders', wo.id, updates).then(function(r) {
    if (r.ok) {
      wo[flagKey] = false; wo[noteKey] = null;
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if(idx>=0) { AppState.workOrders[idx][flagKey]=false; AppState.workOrders[idx][noteKey]=null; }
      renderWODetail(wo); renderDesktopGrid();
      if(typeof refreshAgingBar==='function') refreshAgingBar();
      showToast('Flag cleared');
    } else showToast('Error clearing flag');
  });
}

function renderWODetailDesktop(wo, activeH, activeL, activeQ, hoursVal, partsTotal, creditsTotal, quotedTotal, projected, isAdmin, isLocked, inactiveFlags) {
  inactiveFlags = inactiveFlags || [];
  var out = '';
  var defaultMargin = parseFloat(AppState.settings.default_margin||0.5);

  // HOURS SECTION
  out += '<div class="dt-section" id="dt-hours-section">';
  out += '<div class="dt-section-hdr">';
  out += '<span class="dt-section-title">Hours</span>';
  out += '<span class="dt-section-meta">'+activeH.length+' entr'+(activeH.length===1?'y':'ies')+' &middot; '+activeH.reduce(function(s,e){return s+parseFloat(e.hours||0);},0).toFixed(1)+' hrs &middot; $'+hoursVal.toFixed(2)+'</span>';
  if (!isLocked) out += '<button class="dt-add-btn" onclick="dtAddHoursRow()">+ Add</button>';
  out += '</div>';
  out += '<div class="dt-col-hdr dt-hours-grid"><span>Date</span><span>Tech</span><span>Type</span><span>Hours</span><span>Billable</span><span>Notes</span><span style="text-align:right">Amount</span><span></span></div>';
  out += '<div id="dt-hours-rows">';
  activeH.forEach(function(e) {
    out += dtHoursReadRow(e);
  });
  out += '</div>';
  out += '</div>';

  // PARTS SECTION
  out += '<div class="dt-section" id="dt-parts-section">';
  out += '<div class="dt-section-hdr">';
  out += '<span class="dt-section-title">Parts &amp; services</span>';
  out += '<span class="dt-section-meta">'+activeL.length+' entr'+(activeL.length===1?'y':'ies')+' &middot; $'+partsTotal.toFixed(2)+' sell</span>';
  if (!isLocked) out += '<button class="dt-add-btn" onclick="dtAddPartsRow()">+ Add</button>';
  out += '</div>';
  out += '<div class="dt-col-hdr dt-parts-grid"><span>Date</span><span>QBO Item</span><span>Description</span><span>Qty</span><span style="text-align:right">Cost</span><span style="text-align:right">Margin</span><span style="text-align:right">Sell</span><span></span></div>';
  out += '<div id="dt-parts-rows">';
  activeL.forEach(function(e) {
    out += dtPartsReadRow(e);
  });
  out += '</div>';
  out += '</div>';

  // TOTALS + ACTIONS
  out += '<div class="dt-totals-bar">';
  out += '<span class="dt-total-item">Hours <strong>$'+hoursVal.toFixed(2)+'</strong></span>';
  out += '<span class="dt-total-item">Parts <strong>$'+partsTotal.toFixed(2)+'</strong></span>';
  if (creditsTotal>0) out += '<span class="dt-total-item">Credits <strong>-$'+creditsTotal.toFixed(2)+'</strong></span>';
  out += '<span class="dt-total-item dt-total-main">Total <strong>$'+projected.toFixed(2)+'</strong></span>';
  out += '</div>';
  // FLAG RIBBON — visual separator between spreadsheet and action buttons
  out += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px;margin:8px 0;display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:40px">';
  if (inactiveFlags && inactiveFlags.length && !isLocked) {
    out += '<span style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px">Set flag:</span>';
    inactiveFlags.forEach(function(f){
      out += '<button data-fk="'+f.key+'" data-fn="'+f.note+'" data-fl="'+f.label+'" style="font-size:11px;padding:4px 12px;border:1px dashed '+f.color+';border-radius:12px;background:none;color:'+f.color+';cursor:pointer;white-space:nowrap" onclick="setWOFlag(this.getAttribute(\'data-fk\'),this.getAttribute(\'data-fn\'),this.getAttribute(\'data-fl\'))">+ '+f.label+'</button>';
    });
  } else if (!inactiveFlags || !inactiveFlags.length) {
    out += '<span style="font-size:12px;color:var(--success)">✓ No flags set</span>';
  }
  out += '</div>';

  out += '<div class="dt-action-bar">';
  out += '<button class="save-btn" onclick="AppState.batchStatusMode=false;openStatusSheet()">Save / Change Status</button>';
  if (isAdmin) out += '<button class="save-btn secondary" onclick="openEditWO()">Edit WO Details</button>';
  out += '</div>';
  return out;
}

function dtHoursReadRow(e) {
  var techName = (e.technicians&&e.technicians.name) || '';
  var typeName = (e.hours_types&&e.hours_types.name) || '';
  var ht = e.hours_types;
  var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
  var val = parseFloat(e.hours||0)*rate;
  var locked = AppState.currentWO && isProcessedStatus(AppState.currentWO.status);
  return '<div class="dt-read-row dt-hours-grid" data-eid="'+e.id+'" data-type="hours"'+(locked?'':' ondblclick="dtEditHoursRow(this)"')+'>'
    + '<span class="dt-cell">'+fmtDate(e.entry_date)+'</span>'
    + '<span class="dt-cell">'+escHtml(techName)+'</span>'
    + '<span class="dt-cell dt-muted">'+escHtml(typeName)+'</span>'
    + '<span class="dt-cell">'+parseFloat(e.hours||0).toFixed(1)+' hrs</span>'
    + '<span class="dt-cell dt-muted">'+(e.billable?'Yes':'No')+'</span>'
    + '<span class="dt-cell dt-muted dt-ellipsis">'+escHtml(e.descriptor||'')+'</span>'
    + '<span class="dt-cell dt-right">$'+val.toFixed(2)+'</span>'
    + (locked?'<span></span>':'<button class="dt-del-btn" onclick="event.stopPropagation();dtSoftDelete(\'hours_entries\',\''+e.id+'\')">×</button>')
    + '</div>';
}

function buildDescriptor(wo, invoiceNum, description) {
  var parts = [];
  if (wo && wo.wo_number) parts.push(wo.wo_number);
  if (invoiceNum) parts.push(invoiceNum);
  if (description) parts.push(description);
  return parts.join(' - ');
}

function dtPartsReadRow(e) {
  var qboName = (e.qbo_items && e.qbo_items.name) || '';
  var locked = AppState.currentWO && isProcessedStatus(AppState.currentWO.status);
  return '<div class="dt-read-row dt-parts-grid" data-eid="'+e.id+'" data-type="parts"'+(locked?'':' ondblclick="dtEditPartsRow(this)"')+'>'
    + '<span class="dt-cell">'+fmtDate(e.transaction_date)+'</span>'
    + '<span class="dt-cell dt-muted">'+escHtml(qboName)+'</span>'
    + '<span class="dt-cell dt-ellipsis">'+escHtml(e.description||'')+'</span>'
    + '<span class="dt-cell">'+parseFloat(e.qty||1).toFixed(0)+'</span>'
    + '<span class="dt-cell dt-right">$'+parseFloat(e.cost||0).toFixed(2)+'</span>'
    + '<span class="dt-cell dt-right dt-muted">'+Math.round(parseFloat(e.margin||0)*100)+'%</span>'
    + '<span class="dt-cell dt-right">$'+parseFloat(e.sell_total||0).toFixed(2)+'</span>'
    + (locked?'<span></span>':'<button class="dt-del-btn" onclick="event.stopPropagation();dtSoftDelete(\'line_items\',\''+e.id+'\')">×</button>')
    + '</div>';
}

function dtHoursEditRow(e, isNew) {
  var id = e ? e.id : '';
  var defTech = getDefaultTechId();
  var typeOptions = AppState.hoursTypes.map(function(t, idx){
    var sel = e ? (e.hours_type_id===t.id) : (idx===0);
    return '<option value="'+t.id+'"'+(sel?' selected':'')+'>'+escHtml(t.name)+'</option>';
  }).join('');
  var defDate = e ? (e.entry_date||'').split('T')[0] : todayStr();
  var defHours = e ? parseFloat(e.hours||0) : '';
  var defBill = e ? !!e.billable : true;
  var defTechId = e ? e.tech_id : defTech;
  var defTechName = (AppState.technicians.find(function(t){return t.id===defTechId;})||{}).name||'';

  return '<div class="dt-edit-row dt-hours-grid" data-eid="'+id+'" data-type="hours">'
    + '<input class="dt-input" type="date" name="entry_date" value="'+defDate+'" tabindex="1">'
    + '<div style="position:relative">'
    + '<input class="dt-input" type="text" name="tech_name" value="'+escHtml(defTechName)+'" placeholder="Type tech name..." tabindex="2" autocomplete="off" oninput="dtTechSearch(this)" onfocus="dtTechSearch(this)" onkeydown="dtTechKey(event,this)" onblur="setTimeout(function(){var d=document.getElementById(\'dt-tech-global-dropdown\');if(d)d.style.display=\'none\'},200)" style="width:100%;box-sizing:border-box">'
    + '<input type="hidden" name="tech_id" value="'+escHtml(defTechId)+'">'
    + '</div>'
    + '<select class="dt-input" name="hours_type_id" tabindex="3">'+typeOptions+'</select>'
    + '<input class="dt-input" type="number" name="hours" value="'+(defHours||'')+'" min="0.25" step="0.25" placeholder="hrs" tabindex="4">'
    + '<select class="dt-input" name="billable" tabindex="5"><option value="true"'+(defBill?' selected':'')+'>Yes</option><option value="false"'+(defBill?'':' selected')+'>No</option></select>'
    + '<span class="dt-cell dt-muted" style="font-size:10px;font-style:italic;overflow:hidden">(auto-built)</span>'
    + '<span></span>'
    + '<button class="dt-del-btn" tabindex="-1" onclick="dtCancelEditRow(this)">×</button>'
    + '</div>';
}


function dtPartsEditRow(e, isNew) {
  var id = e ? e.id : '';
  var defDate = e ? (e.transaction_date||'').split('T')[0] : todayStr();
  var defDesc = e ? (e.description||'') : '';
  var defQty = e ? parseFloat(e.qty||1) : 1;
  var defCost = e ? parseFloat(e.cost||0) : '';
  var defMargin = e ? parseFloat(e.margin||AppState.settings.default_margin||0.5) : parseFloat(AppState.settings.default_margin||0.5);
  var defSell = e ? parseFloat(e.sell_total||0) : '';
  var defQBOId = e ? (e.qbo_item_id||'') : '';
  var defQBOName = e ? ((e.qbo_items&&e.qbo_items.name)||'') : '';

  var qboOptions = AppState.qboItems.map(function(q){
    return '<option value="'+q.id+'"'+(q.id===defQBOId?' selected':'')+'>'+escHtml(q.name)+'</option>';
  }).join('');

  return '<div class="dt-edit-row dt-parts-grid" data-eid="'+id+'" data-type="parts">'
    + '<input class="dt-input" type="date" name="transaction_date" value="'+defDate+'" tabindex="1">'
    + '<select class="dt-input" name="qbo_item_id" tabindex="2"><option value="">— QBO Item —</option>'+qboOptions+'</select>'
    + '<input class="dt-input" type="text" name="description" value="'+escHtml(defDesc)+'" placeholder="Description" tabindex="3">'
    + '<input class="dt-input" type="number" name="qty" value="'+defQty+'" min="1" step="1" tabindex="4" style="width:50px" oninput="dtRecalcSell(this)">'
    + '<input class="dt-input dt-right" type="number" name="cost" value="'+(defCost||'')+'" min="0" step="0.01" placeholder="0.00" tabindex="5" oninput="dtRecalcSell(this)">'
    + '<input class="dt-input dt-right" type="number" name="margin" value="'+defMargin.toFixed(2)+'" min="0" max="1" step="0.01" tabindex="6" oninput="dtRecalcSell(this)">'
    + '<input class="dt-input dt-right" type="number" name="sell_total" value="'+(defSell||'')+'" min="0" step="0.01" placeholder="0.00" tabindex="7">'
    + '<button class="dt-del-btn" tabindex="-1" onclick="dtCancelEditRow(this)">×</button>'
    + '</div>';
}

function initWODetailSpreadsheet(wo) {
  // Wire up tab-to-save on last field of edit rows
  document.querySelectorAll('.dt-edit-row').forEach(function(row) {
    dtWireTabSave(row, wo);
  });
}

function dtWireTabSave(row, wo) {
  wo = wo || AppState.currentWO;
  var type = row.getAttribute('data-type');
  // For parts rows, wire to margin (last editable field)
  var lastInput;
  if (type === 'parts') {
    lastInput = row.querySelector('[name="margin"]');
  }
  if (!lastInput) {
    var inputs = row.querySelectorAll('.dt-input:not([readonly]):not([type="hidden"])');
    lastInput = inputs[inputs.length-1];
  }
  if (!lastInput) return;
  var saving = false;
  lastInput.addEventListener('keydown', function(ev) {
    if (ev.key === 'Tab' && !ev.shiftKey) {
      ev.preventDefault();
      if (saving) return; saving = true;
      dtSaveRow(row, wo, false, true);
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (saving) return; saving = true;
      dtSaveRow(row, wo, false, false);
    }
  });
  row.querySelectorAll('.dt-input').forEach(function(inp) {
    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') dtCancelEditRow(inp);
    });
  });
}

function dtShowAddAnotherPrompt(type, wo) {
  var containerId = type === 'hours' ? 'dt-hours-rows' : 'dt-parts-rows';
  var container = document.getElementById(containerId); if (!container) return;
  var prompt = document.createElement('div');
  prompt.id = 'dt-add-another-prompt';
  prompt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#27ae6018;border:1px solid var(--success);border-radius:var(--radius);margin:4px 0';
  prompt.innerHTML = '<span style="font-size:13px;color:var(--success);font-weight:600">Add another entry?</span>'
    + '<button id="dt-prompt-yes" style="font-size:13px;padding:4px 16px;border:2px solid var(--success);border-radius:var(--radius-sm);background:var(--success);color:#fff;cursor:pointer;font-weight:600">Yes</button>'
    + '<button id="dt-prompt-no" style="font-size:13px;padding:4px 16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">No</button>';
  container.appendChild(prompt);
  var yesBtn = prompt.querySelector('#dt-prompt-yes');
  var noBtn = prompt.querySelector('#dt-prompt-no');
  yesBtn.focus();
  var addAnother = function() {
    prompt.remove();
    if (type === 'hours') dtAddHoursRow();
    else dtAddPartsRow();
  };
  var done = function() { prompt.remove(); };
  yesBtn.addEventListener('click', addAnother);
  noBtn.addEventListener('click', done);
  yesBtn.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter' || ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); addAnother(); }
    if (ev.key === 'n' || ev.key === 'N' || ev.key === 'Escape') { ev.preventDefault(); done(); }
    if (ev.key === 'ArrowRight' || ev.key === 'Tab') { ev.preventDefault(); noBtn.focus(); }
  });
  noBtn.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter' || ev.key === 'n' || ev.key === 'N' || ev.key === 'Escape') { ev.preventDefault(); done(); }
    if (ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); addAnother(); }
    if (ev.key === 'ArrowLeft' || ev.key === 'Tab') { ev.preventDefault(); yesBtn.focus(); }
  });
  document.addEventListener('keydown', function onKey(ev) {
    if (!document.getElementById('dt-add-another-prompt')) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); document.removeEventListener('keydown', onKey); addAnother(); }
    if (ev.key === 'n' || ev.key === 'N' || ev.key === 'Escape') { ev.preventDefault(); document.removeEventListener('keydown', onKey); done(); }
    if (ev.key === 'Enter') { ev.preventDefault(); document.removeEventListener('keydown', onKey); addAnother(); }
  }, {once: false});
}

function dtRecalcSell(inp) {
  var row = inp.closest('.dt-edit-row');
  if (!row) return;
  var costEl = row.querySelector('[name="cost"]');
  var marginEl = row.querySelector('[name="margin"]');
  var qtyEl = row.querySelector('[name="qty"]');
  var sellEl = row.querySelector('[name="sell_total"]');
  if (!costEl||!marginEl||!sellEl) return;
  var cost = parseFloat(costEl.value)||0;
  var margin = parseFloat(marginEl.value)||0;
  var qty = parseFloat(qtyEl&&qtyEl.value||1)||1;
  if (margin >= 1) margin = 0.5;
  sellEl.value = ((cost/(1-margin)) * qty).toFixed(2);
}

function dtTechSearch(inp) {
  var q = inp.value.toLowerCase();
  var dropdown = document.getElementById('dt-tech-global-dropdown');
  if (!dropdown) return;
  var matches = q
    ? AppState.technicians.filter(function(t){ return t.name.toLowerCase().indexOf(q) >= 0; })
    : AppState.technicians;
  if (!matches.length) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(function(t){
    return '<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)" onmousedown="event.preventDefault()" onclick="dtTechSelect(this,\''+t.id+'\',\''+escHtml(t.name)+'\')">'+escHtml(t.name)+'</div>';
  }).join('');
  // Position below the input using viewport coordinates (position:fixed)
  var rect = inp.getBoundingClientRect();
  dropdown.style.top = rect.bottom + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(200, rect.width) + 'px';
  dropdown.style.display = 'block';
  // Store reference to current input
  dropdown._inp = inp;
}

function dtTechSelect(el, id, name) {
  var dropdown = document.getElementById('dt-tech-global-dropdown');
  var inp = dropdown && dropdown._inp;
  if (!inp) return;
  var wrapper = inp.parentElement;
  var hid = wrapper ? wrapper.querySelector('[name="tech_id"]') : null;
  if (inp) inp.value = name;
  if (hid) hid.value = id;
  if (dropdown) dropdown.style.display = 'none';
  // Move focus to hours type
  var row = inp.closest('.dt-edit-row');
  if (row) { var typeEl = row.querySelector('[name="hours_type_id"]'); if (typeEl) typeEl.focus(); }
}

function dtTechKey(ev, inp) {
  var dropdown = document.getElementById('dt-tech-global-dropdown');
  if (!dropdown || dropdown.style.display === 'none') return;
  var items = dropdown.querySelectorAll('div');
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if(items[0]) items[0].focus(); }
  if (ev.key === 'Escape') { dropdown.style.display = 'none'; }
  if (ev.key === 'Enter' && items.length === 1) { ev.preventDefault(); items[0].click(); }
  if (ev.key === 'Tab' && items.length === 1) { ev.preventDefault(); items[0].click(); }
}

function dtAddHoursRow() {
  var container = document.getElementById('dt-hours-rows'); if(!container) return;
  var html = dtHoursEditRow(null, true);
  container.insertAdjacentHTML('beforeend', html);
  var newRow = container.lastElementChild;
  dtWireTabSave(newRow, AppState.currentWO);
  newRow.querySelector('.dt-input').focus();
}

function dtAddPartsRow() {
  var container = document.getElementById('dt-parts-rows'); if(!container) return;
  var html = dtPartsEditRow(null, true);
  container.insertAdjacentHTML('beforeend', html);
  var newRow = container.lastElementChild;
  dtWireTabSave(newRow, AppState.currentWO);
  newRow.querySelector('.dt-input').focus();
}

function dtEditHoursRow(rowEl) {
  var eid = rowEl.getAttribute('data-eid');
  var e = AppState.hoursEntries.find(function(x){ return x.id===eid; });
  if (!e) return;
  var html = dtHoursEditRow(e, false);
  rowEl.outerHTML = html;
  var newRow = document.querySelector('.dt-edit-row[data-eid="'+eid+'"]');
  if (newRow) { dtWireTabSave(newRow, AppState.currentWO); newRow.querySelector('.dt-input').focus(); }
}

function dtEditPartsRow(rowEl) {
  var eid = rowEl.getAttribute('data-eid');
  var e = AppState.lineItems.find(function(x){ return x.id===eid; });
  if (!e) return;
  var html = dtPartsEditRow(e, false);
  rowEl.outerHTML = html;
  var newRow = document.querySelector('.dt-edit-row[data-eid="'+eid+'"]');
  if (newRow) { dtWireTabSave(newRow, AppState.currentWO); newRow.querySelector('.dt-input').focus(); }
}

function dtCancelEditRow(el) {
  var row = el.closest ? el.closest('.dt-edit-row') : null;
  if (!row) return;
  var eid = row.getAttribute('data-eid');
  var type = row.getAttribute('data-type');
  if (eid) {
    // Restore read row
    if (type==='hours') {
      var e = AppState.hoursEntries.find(function(x){ return x.id===eid; });
      if (e) { row.outerHTML = dtHoursReadRow(e); return; }
    } else {
      var e = AppState.lineItems.find(function(x){ return x.id===eid; });
      if (e) { row.outerHTML = dtPartsReadRow(e); return; }
    }
  }
  row.remove();
}

function dtSaveRow(row, wo, addNext, showPrompt) {
  wo = wo || AppState.currentWO;
  if (!wo) { showToast('No work order selected'); return; }
  var type = row.getAttribute('data-type');
  var eid = row.getAttribute('data-eid');
  var isNew = !eid;
  if (type==='hours') dtSaveHoursRow(row, wo, eid, isNew, addNext, showPrompt);
  else dtSavePartsRow(row, wo, eid, isNew, addNext, showPrompt);
}

function dtSaveHoursRow(row, wo, eid, isNew, addNext, showPrompt) {
  var get = function(n){ var el=row.querySelector('[name="'+n+'"]'); return el?el.value:''; };
  var date = get('entry_date');
  var techId = get('tech_id');
  var typeId = get('hours_type_id');
  var hours = parseFloat(get('hours'))||0;
  var billable = get('billable')==='true';
  if (!date||!techId||!typeId||!hours) { showToast('Fill in required fields'); return; }
  var ht = AppState.hoursTypes.find(function(t){ return t.id===typeId; });
  var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
  var lineTotal = hours*rate;
  var tech = AppState.technicians.find(function(t){ return t.id===techId; });
  var descriptor = buildDescriptor(wo, null, (tech&&tech.name||'') + (wo&&wo.title?' - '+wo.title:''));
  var data = { work_order_id: wo.id, entry_date: date, tech_id: techId, hours_type_id: typeId,
    hours: hours, billable: billable, internal_rate: rate, line_total: lineTotal,
    descriptor: descriptor, modified_by: AppState.userEmail };
  if (isNew) data.created_by = AppState.userEmail;

  dtFlashSaving(row);
  var prom = isNew ? sb.post('hours_entries', data) : sb.patch('hours_entries', eid, data);
  prom.then(function(r) {
    if (r.ok) {
      var entry = isNew ? (r.data&&r.data[0]) : Object.assign({}, AppState.hoursEntries.find(function(e){return e.id===eid;})||{}, data);
      if (entry) {
        entry.technicians = AppState.technicians.find(function(t){return t.id===techId;});
        entry.hours_types = ht;
        if (isNew) AppState.hoursEntries.push(entry);
        else { var idx=AppState.hoursEntries.findIndex(function(e){return e.id===eid;}); if(idx>=0) AppState.hoursEntries[idx]=entry; }
      }
      dtFlashSaved(row);
      // Replace edit row with read row after brief flash
      setTimeout(function() {
        var e2 = AppState.hoursEntries.find(function(e){return e.id===(isNew?(r.data&&r.data[0]&&r.data[0].id):eid);});
        if (e2) row.outerHTML = dtHoursReadRow(e2);
        dtRefreshSectionMeta('hours');
        delete AppState.projectedCache[wo.id];
          if (addNext) dtAddHoursRow();
          else if (showPrompt) dtShowAddAnotherPrompt('hours', wo);
      }, 600);
    } else { showToast('Error saving'); }
  });
}

function dtSavePartsRow(row, wo, eid, isNew, addNext, showPrompt) {
  var get = function(n){ var el=row.querySelector('[name="'+n+'"]'); return el?el.value:''; };
  var date = get('transaction_date');
  var description = get('description');
  var qboItemId = get('qbo_item_id') || null;
  var qty = parseFloat(get('qty'))||1;
  var cost = parseFloat(get('cost'));
  if (isNaN(cost)) cost = 0;
  var margin = parseFloat(get('margin'))||parseFloat(AppState.settings.default_margin||0.5);
  var sellEach = margin < 1 ? cost/(1-margin) : cost;
  var sellTotal = sellEach * qty;
  // Allow manual override of sell_total if user typed it
  var manualSell = parseFloat(get('sell_total'));
  if (!isNaN(manualSell) && manualSell > 0) { sellTotal = manualSell; sellEach = qty > 0 ? sellTotal/qty : sellEach; }
  if (!date||!description) { showToast('Fill in date and description'); return; }
  // Auto-build descriptor: WO# - invoice# - description (vendor_bill only gets invoice#)
  var existingEntry = eid ? AppState.lineItems.find(function(e){ return e.id===eid; }) : null;
  var invNum = existingEntry ? existingEntry.invoice_number : null;
  var descriptor = buildDescriptor(wo, invNum, description);
  var data = { work_order_id: wo.id, customer_id: wo.customer_id, transaction_date: date,
    transaction_type: 'service', description: description, qty: qty, cost: cost,
    margin: margin, sell_each: sellEach, sell_total: sellTotal, descriptor: descriptor,
    qbo_item_id: qboItemId, billable: true, modified_by: AppState.userEmail };
  if (isNew) data.created_by = AppState.userEmail;

  dtFlashSaving(row);
  var prom = isNew ? sb.post('line_items', data) : sb.patch('line_items', eid, data);
  prom.then(function(r) {
    if (r.ok) {
      var qboItem = AppState.qboItems.find(function(q){ return q.id===data.qbo_item_id; });
      var entry = isNew ? (r.data&&r.data[0]) : Object.assign({}, AppState.lineItems.find(function(e){return e.id===eid;})||{}, data);
      if (entry) {
        entry.qbo_items = qboItem ? {name: qboItem.name} : null;
        if (isNew) AppState.lineItems.push(entry);
        else { var idx=AppState.lineItems.findIndex(function(e){return e.id===eid;}); if(idx>=0) AppState.lineItems[idx]=entry; }
      }
      dtFlashSaved(row);
      setTimeout(function() {
        var e2 = AppState.lineItems.find(function(e){return e.id===(isNew?(r.data&&r.data[0]&&r.data[0].id):eid);});
        if (e2) row.outerHTML = dtPartsReadRow(e2);
        dtRefreshSectionMeta('parts');
        delete AppState.projectedCache[wo.id];
          if (addNext) dtAddPartsRow();
          else if (showPrompt) dtShowAddAnotherPrompt('parts', wo);
      }, 600);
    } else { showToast('Error saving'); }
  });
}
function dtFlashSaving(row) {
  row.style.background = 'var(--bg,#f0f0f0)';
}

function dtFlashSaved(row) {
  row.style.background = '#27ae6022';
}

function dtSoftDelete(table, id) {
  if (!confirm('Delete this entry?')) return;
  sb.patch(table, id, {active: false, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      if (table==='hours_entries') AppState.hoursEntries = AppState.hoursEntries.filter(function(e){return e.id!==id;});
      else AppState.lineItems = AppState.lineItems.filter(function(e){return e.id!==id;});
      var row = document.querySelector('[data-eid="'+id+'"]');
      if (row) row.remove();
      dtRefreshSectionMeta(table==='hours_entries'?'hours':'parts');
      delete AppState.projectedCache[AppState.currentWO.id];
      showToast('Deleted');
    } else showToast('Error deleting');
  });
}

function dtRefreshSectionMeta(type) {
  var wo = AppState.currentWO;
  var activeH = AppState.hoursEntries.filter(function(e){ return e.active!==false; });
  var activeL = AppState.lineItems.filter(function(e){ return e.active!==false; });
  var hoursVal = activeH.reduce(function(s,e){
    var ht=e.hours_types; var rate=parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
    return s+parseFloat(e.hours||0)*rate;
  },0);
  var partsTotal = activeL.filter(function(e){return e.transaction_type!=='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
  var creditsTotal = activeL.filter(function(e){return e.transaction_type==='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
  var hoursTotal = activeH.reduce(function(s,e){return s+parseFloat(e.hours||0);},0);
  if (type==='hours') {
    var hdr = document.querySelector('#dt-hours-section .dt-section-meta');
    if (hdr) hdr.innerHTML = activeH.length+' entr'+(activeH.length===1?'y':'ies')+' &middot; '+hoursTotal.toFixed(1)+' hrs &middot; $'+hoursVal.toFixed(2);
  } else {
    var phdr = document.querySelector('#dt-parts-section .dt-section-meta');
    if (phdr) phdr.innerHTML = activeL.length+' entr'+(activeL.length===1?'y':'ies')+' &middot; $'+partsTotal.toFixed(2)+' sell';
  }
  // Update totals bar
  var projected = wo&&wo.form_mode==='quoted'?0:(hoursVal+partsTotal-creditsTotal);
  var bar = document.querySelector('.dt-totals-bar');
  if (bar) {
    bar.innerHTML = '<span class="dt-total-item">Hours <strong>$'+hoursVal.toFixed(2)+'</strong></span>'
      +'<span class="dt-total-item">Parts <strong>$'+partsTotal.toFixed(2)+'</strong></span>'
      +(creditsTotal>0?'<span class="dt-total-item">Credits <strong>-$'+creditsTotal.toFixed(2)+'</strong></span>':'')
      +'<span class="dt-total-item dt-total-main">Total <strong>$'+projected.toFixed(2)+'</strong></span>';
  }
}

function validatePONumber(po) {
  // If PO contains "need" (case insensitive) it's not a real PO — return null and flag
  if (po && po.toLowerCase().indexOf('need') >= 0) return {po: null, needsFlag: true};
  return {po: po || null, needsFlag: false};
}

function saveInlinePO() {
  var wo = AppState.currentWO; if (!wo) return;
  var inp = document.getElementById('inline-po-input');
  var po = inp ? inp.value.trim() : '';
  if (!po) { showToast('Enter a PO number'); return; }
  var poResult = validatePONumber(po); if (poResult.needsFlag) { showToast('"need" is not a valid PO number'); return; }
  sb.patch('work_orders', wo.id, {po_number: po, flag_needs_po: false, flag_needs_po_note: null, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      wo.po_number = po; wo.flag_needs_po = false; wo.flag_needs_po_note = null;
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if (idx>=0) { AppState.workOrders[idx].po_number=po; AppState.workOrders[idx].flag_needs_po=false; AppState.workOrders[idx].flag_needs_po_note=null; }
      renderWODetail(wo); renderDesktopGrid();
      if(typeof refreshAgingBar==='function') refreshAgingBar();
      showToast('PO saved — flag cleared');
    } else showToast('Error saving PO');
  });
}

function unlockWO() {
  var wo = AppState.currentWO; if (!wo) return;
  if (!confirm('Unlock '+wo.wo_number+'? It will be moved back to Completed status and can be re-exported. The original export record will remain.')) return;
  var completedSt = AppState.statuses.find(function(s){ return s.category==='completed'; });
  var completedNum = completedSt ? completedSt.num : 10;
  sb.patch('work_orders', wo.id, {status: completedNum, exported_at: null, exported_by: null, modified_by: AppState.userEmail}).then(function(r){
    if (r.ok) {
      wo.status = completedNum; wo.exported_at = null; wo.exported_by = null;
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if (idx>=0) { AppState.workOrders[idx].status=completedNum; AppState.workOrders[idx].exported_at=null; }
      renderWODetail(wo); renderDesktopGrid(); showToast(wo.wo_number+' unlocked — ready to re-export');
    } else showToast('Error unlocking WO');
  });
}

function goBackToGrid() {
  // Navigate back to the WO grid — pop screens until we hit the grid
  if (AppState.deviceMode === 'desktop') {
    showScreen('screen-desktop');
    showHeader(true, AppState.settings.company_name || 'ProMech', false);
    switchDesktopPanel('wo');
  } else {
    // Mobile — pop back to WO list
    showScreen('screen-wo-list');
    showHeader(true, AppState.settings.company_name || 'ProMech', false);
    filterWOList();
  }
  AppState.screenStack = [];
}

function toggleHoursTile(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleMobileTile(id) {
  var el = document.getElementById(id); if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function openHoursEntry() {
  openHoursList();
  // Form is always visible at top — just focus the hours field
  setTimeout(function(){
    var hoursEl = document.getElementById('h-hours');
    if (hoursEl) hoursEl.focus();
  }, 150);
}

function openPartsEntry() {
  openPartsList();
  // Form is always visible at top — just focus the description field
  setTimeout(function(){
    var descEl = document.getElementById('p-description');
    if (descEl) descEl.focus();
  }, 150);
}

function clearWOOriginFlag() {
  var wo = AppState.currentWO; if(!wo) return;
  sb.patch('work_orders', wo.id, {origin: null, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      wo.origin = null;
      var idx = AppState.workOrders.findIndex(function(w){ return w.id===wo.id; });
      if (idx>=0) AppState.workOrders[idx].origin = null;
      renderWODetail(wo);
      if(typeof renderDesktopGrid==='function') renderDesktopGrid();
      showToast('Marked as reviewed');
    } else showToast('Error updating');
  });
}

function openEditWO() {
  var wo = AppState.currentWO; AppState.editingWOId = wo.id;
  var cust = AppState.customers.find(function(c){ return c.id===wo.customer_id; });
  document.getElementById('f-customer-input').value = cust?cust.name:'';
  document.getElementById('f-customer-id').value = wo.customer_id||'';
  document.getElementById('f-title').value = wo.title;
  document.getElementById('f-form-mode').value = wo.form_mode;
  document.getElementById('f-po-number').value = wo.po_number||'';
  document.getElementById('f-work-description').value = wo.work_description||'';
  document.getElementById('f-wo-number').value = wo.wo_number;
  pushScreen('screen-wo-form', 'Edit '+wo.wo_number);
}

function saveWO(saveMode) {
  saveMode = saveMode || 'close';
  var custId = document.getElementById('f-customer-id').value;
  var title = document.getElementById('f-title').value.trim();
  var formMode = document.getElementById('f-form-mode').value;
  var po = document.getElementById('f-po-number').value.trim();
  var poResult = validatePONumber(po);
  po = poResult.po;
  var autoFlagPO = poResult.needsFlag;
  var desc = document.getElementById('f-work-description').value.trim();
  if (!custId||!title) { showToast('Customer and title are required'); return; }
  var cust = AppState.customers.find(function(c){ return c.id===custId; });
  var flag = cust && cust.qbo_customer_id==='SYSTEM';
  if (AppState.editingWOId) {
    var updates = {customer_id:custId,customer_flag:flag,title:title,form_mode:formMode,po_number:po||null,work_description:desc||null,modified_by:AppState.userEmail};
    // Auto-clear flag_needs_po if PO number is now provided
    if (po && AppState.currentWO && AppState.currentWO.flag_needs_po) {
      updates.flag_needs_po = false;
      updates.flag_needs_po_note = null;
    }
    // Auto-set flag_needs_po if PO contained "need" or customer requires PO but none given
    if (autoFlagPO) { updates.flag_needs_po = true; updates.flag_needs_po_note = 'PO required — "need" detected in PO field'; }
    else if (!po) {
      var custForPO2 = AppState.customers.find(function(c){ return c.id===custId; });
      if (custForPO2 && custForPO2.po_required===true) { updates.flag_needs_po = true; }
    }
    sb.patch('work_orders',AppState.editingWOId, updates)
    .then(function(r){
      if(r.ok){
        var idx2=AppState.workOrders.findIndex(function(w){return w.id===AppState.editingWOId;});
        if(idx2>=0) AppState.workOrders[idx2]=Object.assign({},AppState.workOrders[idx2],updates,{customers:cust});
        AppState.currentWO=AppState.workOrders[idx2>=0?idx2:0];
        if(typeof renderDesktopGrid==='function') renderDesktopGrid();
        showToast('Saved');
        goBack(); // exit form
        if(saveMode==='close') goBack(); // exit WO detail to grid
        else { renderWODetail(AppState.currentWO); }
      } else showToast('Error saving');
    });
  } else {
    var woNum = document.getElementById('f-wo-number').value;
    var custForNewWO = AppState.customers.find(function(c){ return c.id===custId; });
    var _workReadySt = AppState.statuses.find(function(s){ return s.name === 'Work Ready'; });
    var defaultStatusNum = _workReadySt ? _workReadySt.num : 6;
    var statusEl = document.getElementById('f-status');
    var selectedStatusNum = statusEl ? parseInt(statusEl.value)||defaultStatusNum : defaultStatusNum;
    var newWOFlagPO = autoFlagPO || (!po && custForNewWO && custForNewWO.po_required===true);
    sb.post('work_orders',{wo_number:woNum,title:title,customer_id:custId,customer_flag:flag,form_mode:formMode,po_number:po||null,work_description:desc||null,status:selectedStatusNum,flag_needs_po:newWOFlagPO||false,flag_needs_po_note:autoFlagPO?'PO required — "need" detected':null,created_by:AppState.userEmail,modified_by:AppState.userEmail})
    .then(function(r){
      if(r.ok&&r.data&&r.data.length){
        // Increment WO counter only after confirmed successful save
        var savedNum = parseInt(AppState.settings.wo_number_next||'26300');
        sb.patchWhere('settings','key=eq.wo_number_next',{value:String(savedNum+1)});
        AppState.settings.wo_number_next = String(savedNum+1);
        // Attach customer object so grid shows name immediately
        var newWO = Object.assign({},r.data[0],{customers:cust});
        AppState.workOrders.push(newWO);
        if(typeof renderDesktopGrid==='function') renderDesktopGrid();
        if(typeof refreshAgingBar==='function') refreshAgingBar();
        showToast('Work order '+woNum+' created');
        // On mobile, go directly to WO detail for immediate entry
        if (AppState.deviceMode === 'mobile') {
          goBack(); // exit form
          openWODetail(newWO.id);
        } else {
          goBack(); // go back to grid
        }
      } else showToast('Error creating work order '+woNum+' — please try again');
    });
  }
}

// CUSTOMER AUTOCOMPLETE
function onCustomerInput(input) {
  var q = input.value.toLowerCase();
  var list = document.getElementById('f-customer-list');
  var matches = AppState.customers.filter(function(c){ 
    return c.qbo_customer_id!=='SYSTEM' && c.active !== false && (!q || c.name.toLowerCase().indexOf(q)>=0); 
  }).slice(0, q ? 12 : 8);
  if (!matches.length) { list.style.display='none'; if (!q) document.getElementById('f-customer-id').value=''; return; }
  list.innerHTML = matches.map(function(c) {
    var safeName = c.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return '<div class="autocomplete-item" tabindex="0" data-cid="'+c.id+'" data-cname="'+safeName+'" onclick="selectCustomer(this.getAttribute(\'data-cid\'),this.getAttribute(\'data-cname\'))" onkeydown="customerItemKey(event,this)">'
      + '<div class="autocomplete-name">'+escHtml(getCustName(c))+'</div>'
      + '<div class="autocomplete-sub">'+escHtml(c.display_name||'')+'</div></div>';
  }).join('');
  list.style.display = 'block';
}

function customerItemKey(ev, el) {
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); }
  if (ev.key === 'ArrowDown') { ev.preventDefault(); var next = el.nextElementSibling; if(next) next.focus(); }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); var prev = el.previousElementSibling; if(prev) prev.focus(); else document.getElementById('f-customer-input').focus(); }
  if (ev.key === 'Escape') { document.getElementById('f-customer-list').style.display='none'; document.getElementById('f-customer-input').focus(); }
  if (ev.key === 'Tab') { ev.preventDefault(); el.click(); }
}

function customerInputKey(ev, input) {
  var list = document.getElementById('f-customer-list');
  if (!list || list.style.display === 'none') return;
  var items = list.querySelectorAll('.autocomplete-item');
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if(items[0]) items[0].focus(); }
  if (ev.key === 'Escape') { list.style.display='none'; }
  if (ev.key === 'Enter' && items.length === 1) { ev.preventDefault(); items[0].click(); }
  if (ev.key === 'Tab' && items.length >= 1) { ev.preventDefault(); items[0].click(); }
}
function selectCustomer(id,name) {
  document.getElementById('f-customer-input').value = name;
  document.getElementById('f-customer-id').value = id;
  document.getElementById('f-customer-list').style.display = 'none';
}
function closeCustomerAutocomplete() { var l=document.getElementById('f-customer-list'); if(l) l.style.display='none'; }

// VENDOR AUTOCOMPLETE
function onVendorInput(prefix) {
  var inputEl = document.getElementById(prefix+'-vendor-input');
  var listEl  = document.getElementById(prefix+'-vendor-list');
  var hiddenEl= document.getElementById(prefix+'-vendor');
  if (!inputEl||!listEl) return;
  var q = inputEl.value.toLowerCase();
  hiddenEl.value = '';
  if (!q) { listEl.style.display='none'; return; }
  var matches = AppState.vendors.filter(function(v){ return v.name.toLowerCase().indexOf(q)>=0; }).slice(0,10);
  if (!matches.length) { listEl.style.display='none'; return; }
  listEl.innerHTML = matches.map(function(v) {
    return '<div class="vendor-autocomplete-item" onclick="selectVendor(\''+prefix+'\',\''+v.id+'\',\''+v.name.replace(/'/g,"\\'").replace(/"/g,'&quot;')+'\')">'
      + escHtml(v.name) + '</div>';
  }).join('');
  listEl.style.display = 'block';
}
function selectVendor(prefix,id,name) {
  var inputEl = document.getElementById(prefix+'-vendor-input');
  var hiddenEl= document.getElementById(prefix+'-vendor');
  var listEl  = document.getElementById(prefix+'-vendor-list');
  if (inputEl) inputEl.value = name;
  if (hiddenEl) hiddenEl.value = id;
  if (listEl) listEl.style.display = 'none';
  localStorage.setItem('dwo_last_vendor_id', id);
  localStorage.setItem('dwo_last_vendor_name', name);
}
function prefillLastVendor(prefix) {
  var lastId = localStorage.getItem('dwo_last_vendor_id');
  var lastName = localStorage.getItem('dwo_last_vendor_name');
  if (!lastId||!lastName) return;
  var vendor = AppState.vendors.find(function(v){ return v.id===lastId; });
  if (!vendor) return;
  var inputEl = document.getElementById(prefix+'-vendor-input');
  var hiddenEl= document.getElementById(prefix+'-vendor');
  if (inputEl) inputEl.value = lastName;
  if (hiddenEl) hiddenEl.value = lastId;
}

// DESKTOP
function initDesktop() {
  var su = document.getElementById('sidebar-user'); if(su) su.textContent = AppState.userEmail||'';
  var dv = document.getElementById('desktop-version'); if(dv) dv.textContent = 'v' + APP_VERSION;
  var savedCol = localStorage.getItem('dwo_sort_col');
  var savedDir = localStorage.getItem('dwo_sort_dir');
  if (savedCol) AppState.desktopSortCol = savedCol;
  if (savedDir) AppState.desktopSortDir = savedDir;
  initDesktopStatusFilter();
  desktopNav('wo');
}

function initDesktopStatusFilter() {
  var sf = document.getElementById('dt-status-filter');
  if (!sf||sf.options.length>3) return;
  var sep = document.createElement('option'); sep.disabled=true; sep.textContent='----------'; sf.appendChild(sep);
  var _sList = (AppState.statuses && AppState.statuses.length) ? AppState.statuses : STATUSES_FALLBACK;
  _sList.forEach(function(s) {
    var o = document.createElement('option'); o.value=s.num; o.textContent=String(s.num).padStart(2,'0')+' - '+s.name; sf.appendChild(o);
  });
  var savedFilter = localStorage.getItem('dwo_status_filter')||'live';
  sf.value = savedFilter;
}

function switchDesktopPanel(panel) { desktopNav(panel); }

function desktopNav(panel) {
  ['wo','timecard','truckstock','customers','vendors','locations','dailyreview','reconcile','invoices','exports','settings','morningbrief','endofday'].forEach(function(p) {
    var el = document.getElementById('desktop-panel-'+p);
    // Don't hide dailyreview when navigating to reconcile — they share the same panel
    // But do hide dailyreview when navigating away from reconcile to something else
    if (el && !(panel === 'reconcile' && p === 'dailyreview')) el.style.display='none';
    var sb2 = document.getElementById('sidebar-'+p); if(sb2) sb2.classList.remove('active');
  });
  // When leaving reconcile mode, also hide the dailyreview panel
  if (panel !== 'reconcile' && panel !== 'dailyreview') {
    var drPanelEl = document.getElementById('desktop-panel-dailyreview');
    if (drPanelEl) drPanelEl.style.display = 'none';
  }
  var pelDisplay = panel==='settings'?'block':'flex';
  var pel = document.getElementById('desktop-panel-'+panel); if(pel) pel.style.display=pelDisplay;
  var sel = document.getElementById('sidebar-'+panel); if(sel) sel.classList.add('active');
  AppState.desktopPanel = panel;
  if (panel==='wo') { renderDesktopGrid(); loadExportHistory(); if(typeof refreshAgingBar==='function') refreshAgingBar(); }
  if (panel==='timecard' && typeof initTimecard==='function') initTimecard();
  if (panel==='truckstock') renderTruckStock();
  if (panel==='customers') renderCustomerPanel();
  if (panel==='vendors') renderVendorsPanel();
  if (panel==='locations') renderLocationsPanel();
  if (panel==='dailyreview') { renderDailyReviewPanel(); }
  if (panel==='reconcile') { 
    // Reconcile shares the dailyreview panel — show dailyreview panel, keep reconcile panel hidden
    var drPanel = document.getElementById('desktop-panel-dailyreview');
    var rcPanel = document.getElementById('desktop-panel-reconcile');
    if (drPanel) drPanel.style.display = 'flex';
    if (rcPanel) rcPanel.style.display = 'none';
    // The loop above hid desktop-panel-reconcile correctly but also hid dailyreview — fix that
    initReconcilePanel(); 
  }
  if (panel==='invoices') initInvoicesPanel();
  if (panel==='settings') renderSettings('settings-body-desktop');
  if (panel==='exports') renderExportsPanel();
  if (panel==='morningbrief') initMorningBriefDesktop();
  if (panel==='endofday') initEndOfDayDesktop();
  if (panel==='tasks' && typeof initTasksPanel === 'function') initTasksPanel();
}

function filterDesktopGrid() {
  var sf = document.getElementById('dt-status-filter');
  if (sf) localStorage.setItem('dwo_status_filter', sf.value);
  renderDesktopGrid();
}

function sortDesktopGrid(col) {
  if (AppState.desktopSortCol===col) AppState.desktopSortDir = AppState.desktopSortDir==='asc'?'desc':'asc';
  else { AppState.desktopSortCol=col; AppState.desktopSortDir='asc'; }
  localStorage.setItem('dwo_sort_col', AppState.desktopSortCol);
  localStorage.setItem('dwo_sort_dir', AppState.desktopSortDir);
  document.querySelectorAll('[id^="sort-"]').forEach(function(el){ el.textContent='sort'; });
  var arrow = document.getElementById('sort-'+col);
  if (arrow) arrow.textContent = AppState.desktopSortDir==='asc'?'asc':'desc';
  renderDesktopGrid();
}

function refreshWorkOrders() {
  showToast('Refreshing...');
  loadWorkOrders().then(function() {
    if (AppState.deviceMode === 'desktop') renderDesktopGrid();
    else filterWOList();
    showToast('Work orders updated');
  });
}

function renderDesktopGrid() {
  var titleQ = ((document.getElementById('dt-title-search')&&document.getElementById('dt-title-search').value)||'').toLowerCase();
  var custQ  = ((document.getElementById('dt-cust-search') &&document.getElementById('dt-cust-search').value) ||'').toLowerCase();
  var statusF= (document.getElementById('dt-status-filter')&&document.getElementById('dt-status-filter').value)||'live';
  var modeF  = (document.getElementById('dt-mode-filter')  &&document.getElementById('dt-mode-filter').value)  ||'';
  var flagF  = (document.getElementById('dt-flag-filter')  &&document.getElementById('dt-flag-filter').value)  ||'';
  var wos = AppState.workOrders.filter(function(w){ return w.active!==false; });
  if (statusF==='live') wos=wos.filter(function(w){ return isLiveStatus(w.status); });
  else if (statusF==='processed') wos=wos.filter(function(w){ return isProcessedStatus(w.status); });
  else if (statusF!==''&&statusF!=='all') wos=wos.filter(function(w){ return w.status==statusF; });
  if (flagF==='any') wos=wos.filter(function(w){ return w.flag_needs_paperwork||w.flag_needs_parts||w.flag_needs_review||w.flag_needs_po; });
  else if (flagF) wos=wos.filter(function(w){ return !!w['flag_'+flagF]; });
  if (titleQ) wos=wos.filter(function(w){ return w.title&&w.title.toLowerCase().indexOf(titleQ)>=0; });
  if (custQ)  wos=wos.filter(function(w){ return ((w.customers&&w.customers.name)||'').toLowerCase().indexOf(custQ)>=0||((w.customers&&w.customers.display_name)||'').toLowerCase().indexOf(custQ)>=0; });
  if (modeF)  wos=wos.filter(function(w){ return w.form_mode===modeF; });
  var col = AppState.desktopSortCol, dir = AppState.desktopSortDir==='asc'?1:-1;
  wos.sort(function(a,b){
    var av,bv;
    if(col==='wo_number'){av=parseInt((a.wo_number||'').replace(/\D/g,'')||0);bv=parseInt((b.wo_number||'').replace(/\D/g,'')||0);}
    else if(col==='customer'){av=(a.customers&&a.customers.name)||'';bv=(b.customers&&b.customers.name)||'';}
    else if(col==='status'){av=a.status;bv=b.status;}
    else if(col==='projected'){av=AppState.projectedCache[a.id]||0;bv=AppState.projectedCache[b.id]||0;}
    else{av=a[col]||'';bv=b[col]||'';}
    if(av<bv)return -1*dir; if(av>bv)return 1*dir; return 0;
  });
  var tbody = document.getElementById('desktop-grid-body'); if(!tbody) return;
  if (!wos.length) { tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">No work orders match filter</td></tr>'; return; }
  tbody.innerHTML = wos.map(function(wo) {
    var st = getStatus(wo.status);
    var cust = getCustName(wo.customers)||'---';
    var selected = selHas(wo.id);
    var proj = AppState.projectedCache[wo.id];
    var projStr = proj!=null ? '$'+proj.toFixed(2) : '---';
    var custObj2 = AppState.customers.find(function(c){ return c.id===wo.customer_id; });
    var showPOBadge = custObj2 && custObj2.po_required===true && !wo.po_number;
    var _fd = AppState.woFlags.length ? AppState.woFlags : [{system_key:'needs_paperwork',name:'Paper',color:'#e67e22'},{system_key:'needs_parts',name:'Parts',color:'#2980b9'},{system_key:'needs_review',name:'Review',color:'#8e44ad'},{system_key:'needs_po',name:'PO',color:'#c0392b'}];
    var flagBadgeHtml = _fd.map(function(f){ return wo['flag_'+f.system_key]?'<span title="'+escHtml(wo['flag_'+f.system_key+'_note']||'')+'" style="margin-left:3px;font-size:10px;background:'+f.color+'22;color:'+f.color+';border:1px solid '+f.color+';border-radius:3px;padding:1px 4px">⚑ '+f.name+'</span>':''; }).join('');
    var isLocked = isProcessedStatus(wo.status);
    return '<tr style="background:'+(isLocked?'var(--bg)':st.color+'18')+';opacity:'+(isLocked?'0.55':'1')+'"'+(selected?' class="selected"':'')+' onclick="desktopRowClick(event,\''+wo.id+'\')">'
      + '<td class="cb-col" onclick="event.stopPropagation()"><input type="checkbox"'+(selected?' checked':'')+' onchange="toggleRowSelect(\''+wo.id+'\',this.checked)"></td>'
      + '<td><strong>'+wo.wo_number+'</strong>'+(wo.origin==='timecard'?'<span title="Created from timecard" style="margin-left:5px;font-size:10px;background:#e67e2222;color:#e67e22;border:1px solid #e67e22;border-radius:3px;padding:1px 4px;font-weight:700">⚠ TC</span>':'')+' '+(showPOBadge?'<span style="font-size:10px;background:#c0392b22;color:var(--danger);border:1px solid var(--danger);border-radius:3px;padding:1px 4px;font-weight:700">PO?</span>':'')+flagBadgeHtml+'</td>'
      + '<td>'+escHtml(cust)+'</td>'
      + '<td>'+escHtml(wo.title)+'</td>'
      + '<td><span class="badge" style="background:'+st.color+'">'+String(wo.status).padStart(2,'0')+' '+st.name+'</span></td>'
      + '<td>'+(wo.form_mode==='quoted'?'Q':'T&M')+'</td>'
      + '<td>'+fmtDate(wo.created_at)+'</td>'
      + '<td>'+(wo.completed_at?fmtDate(wo.completed_at):'---')+'</td>'
      + '<td>'+fmtDateWithTime(wo.modified_at)+'</td>'
      + '<td class="text-right">'+projStr+'</td>'
      + '</tr>';
  }).join('');
}
function desktopRowClick(e,id){ if(e.target.type==='checkbox') return; openWODetail(id); }
function toggleRowSelect(id,checked){ if(checked) selAdd(id); else selDel(id); updateBatchBar(); }
function toggleSelectAll() {
  var a = document.getElementById('dt-select-all').checked;
  if(a) {
    // Select only WOs currently visible in the filtered grid, not the entire dataset
    var visibleRows = document.querySelectorAll('#desktop-grid-body tr[onclick]');
    var titleQ = ((document.getElementById('dt-title-search')&&document.getElementById('dt-title-search').value)||'').toLowerCase();
    var custQ  = ((document.getElementById('dt-cust-search') &&document.getElementById('dt-cust-search').value) ||'').toLowerCase();
    var statusF= (document.getElementById('dt-status-filter')&&document.getElementById('dt-status-filter').value)||'live';
    var modeF  = (document.getElementById('dt-mode-filter')  &&document.getElementById('dt-mode-filter').value)  ||'';
    var wos = AppState.workOrders.filter(function(w){ return w.active!==false; });
    if (statusF==='live') wos=wos.filter(function(w){ return isLiveStatus(w.status); });
    else if (statusF==='processed') wos=wos.filter(function(w){ return isProcessedStatus(w.status); });
    else if (statusF!==''&&statusF!=='all') wos=wos.filter(function(w){ return w.status==statusF; });
    if (titleQ) wos=wos.filter(function(w){ return w.title&&w.title.toLowerCase().indexOf(titleQ)>=0; });
    if (custQ)  wos=wos.filter(function(w){ return ((w.customers&&w.customers.name)||'').toLowerCase().indexOf(custQ)>=0||((w.customers&&w.customers.display_name)||'').toLowerCase().indexOf(custQ)>=0; });
    if (modeF)  wos=wos.filter(function(w){ return w.form_mode===modeF; });
    wos.forEach(function(w){selAdd(w.id);});
  } else selClear();
  updateBatchBar(); renderDesktopGrid();
}
function clearSelection() { selClear(); var sa=document.getElementById('dt-select-all'); if(sa)sa.checked=false; updateBatchBar(); renderDesktopGrid(); }
function updateBatchBar() {
  var bar=document.getElementById('dt-batch-bar'); var count=selSize();
  if(bar) bar.style.display=count>0?'flex':'none';
  var el=document.getElementById('dt-batch-count'); if(el) el.textContent=count+' selected';
}
function batchChangeStatus() { AppState.batchStatusMode=true; openStatusSheet(); }

function batchExport() {
  var ids = selIds();
  if (!ids.length) { showToast('Select work orders to export'); return; }
  var wos = AppState.workOrders.filter(function(w){ return ids.indexOf(w.id)>=0; });
  showExportReview(wos);
}

function exportAllFiltered() {
  var titleQ = ((document.getElementById('dt-title-search')&&document.getElementById('dt-title-search').value)||'').toLowerCase();
  var custQ  = ((document.getElementById('dt-cust-search') &&document.getElementById('dt-cust-search').value) ||'').toLowerCase();
  var statusF= (document.getElementById('dt-status-filter')&&document.getElementById('dt-status-filter').value)||'live';
  var wos = AppState.workOrders.filter(function(w){ return w.active!==false; });
  if(statusF==='live') wos=wos.filter(function(w){return isLiveStatus(w.status);});
  else if(statusF==='processed') wos=wos.filter(function(w){return isProcessedStatus(w.status);});
  else if(statusF!==''&&statusF!=='all') wos=wos.filter(function(w){return w.status==statusF;});
  if(titleQ) wos=wos.filter(function(w){return w.title&&w.title.toLowerCase().indexOf(titleQ)>=0;});
  if(custQ)  wos=wos.filter(function(w){return ((w.customers&&w.customers.name)||'').toLowerCase().indexOf(custQ)>=0;});
  showExportReview(wos);
}

// EXPORT REVIEW - no nested template literals
function showExportReview(wos) {
  if (!wos.length) { showToast('No work orders to export'); return; }
  showToast('Checking WOs...');
  AppState._exportReviewWOs = wos;
  var rows = [];
  var checks = wos.map(function(wo) {
    return Promise.all([
      sb.get('hours_entries','?work_order_id=eq.'+wo.id+'&active=eq.true&select=*,technicians(name),hours_types(name,internal_rate_key)'),
      sb.get('line_items','?work_order_id=eq.'+wo.id+'&active=eq.true&select=*,vendors(name),qbo_items(name)'),
      sb.get('quoted_invoices','?work_order_id=eq.'+wo.id+'&active=eq.true&select=*'),
    ]).then(function(results) {
      var hours = results[0].data||[];
      var parts = results[1].data||[];
      var quoted = results[2].data||[];
      var hasHours = hours.length>0;
      var hasParts = parts.length>0;
      var hasQuoted = quoted.length>0;
      var isQuotedMode = wo.form_mode==='quoted';
      var isTruckStock = wo.title && wo.title.indexOf('Truck Stock')===0;
      var status, label, icon;
      var custForPO = AppState.customers.find(function(cc){ return cc.id===wo.customer_id; });
      var poUnknown = custForPO && (custForPO.po_required===null || custForPO.po_required===undefined);
      var poMissing = custForPO && custForPO.po_required===true && !wo.po_number;
      if (isTruckStock) {
        status='ready'; label='Truck stock'; icon='ti-truck';
      } else if (wo.customer_flag) {
        status='blocked'; label='Unresolved customer'; icon='ti-user-off';
      } else if (poMissing) {
        status='blocked'; label='PO required - missing'; icon='ti-file-off';
      } else if (wo.origin==='timecard') {
        status='caution'; label='TC origin — review parts'; icon='ti-alert-triangle';
      } else if (wo.flag_needs_paperwork||wo.flag_needs_parts||wo.flag_needs_review||wo.flag_needs_po) {
        var flagLabels=[];
        var _ef = AppState.woFlags.length ? AppState.woFlags : [{system_key:'needs_paperwork',name:'Paperwork'},{system_key:'needs_parts',name:'Parts'},{system_key:'needs_review',name:'Review'},{system_key:'needs_po',name:'PO'}];
        _ef.forEach(function(f){ if(wo['flag_'+f.system_key]) flagLabels.push(f.name); });
        status='caution'; label='Flags: '+flagLabels.join(', '); icon='ti-flag';
      } else if (poUnknown) {
        status='caution'; label='PO req not set'; icon='ti-help';
      } else if (isQuotedMode) {
        if (hasQuoted) { status='ready'; label='Quoted'; icon='ti-file-invoice'; }
        else { status='blocked'; label='No quoted amount'; icon='ti-file-off'; }
      } else if (!hasHours && !hasParts) {
        status='blocked'; label='No entries'; icon='ti-file-off';
      } else if (!hasHours) {
        status='caution'; label='No hours'; icon='ti-clock-off';
      } else if (!hasParts) {
        status='caution'; label='No parts'; icon='ti-package-off';
      } else {
        status='ready'; label='Ready'; icon='ti-circle-check';
      }
      var hoursVal = hours.reduce(function(s,e){var ht=e.hours_types;var rate=parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);return s+parseFloat(e.hours||0)*rate;},0);
      var partsVal = parts.filter(function(e){return e.transaction_type!=='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
      var creditsVal = parts.filter(function(e){return e.transaction_type==='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
      var quotedVal = quoted.reduce(function(s,e){return s+parseFloat(e.amount||0);},0);
      var total = isQuotedMode ? quotedVal : (hoursVal+partsVal-creditsVal);
      rows.push({wo:wo,status:status,label:label,icon:icon,total:total,hours:hours,parts:parts,quoted:quoted,hoursVal:hoursVal,partsVal:partsVal,creditsVal:creditsVal});
    });
  });
  Promise.all(checks).then(function() {
    rows.sort(function(a,b){
      var order={blocked:0,caution:1,ready:2};
      return order[a.status]-order[b.status];
    });
    AppState._exportReviewRows = rows;
    renderExportReviewGrid();
    pushScreen('screen-export-review','Export Review');
  });
}

function renderExportReviewGrid() {
  var rows = AppState._exportReviewRows || [];
  var ready = rows.filter(function(r){return r.status==='ready';});
  var caution = rows.filter(function(r){return r.status==='caution';});
  var blocked = rows.filter(function(r){return r.status==='blocked';});
  var custName = function(wo){ return getCustName(AppState.customers.find(function(c){return c.id===wo.customer_id;}))||''; };

  var html = '<div style="padding:16px;max-width:900px;margin:0 auto;padding-bottom:100px">';
  html += '<h2 style="font-size:18px;font-weight:600;margin-bottom:4px">Export Review</h2>';
  html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">'+rows.length+' work orders selected</p>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--border)">WO</th>';
  html += '<th style="text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--border)">Description</th>';
  html += '<th style="text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--border)">Status</th>';
  html += '<th style="padding:0 10px 8px;border-bottom:1px solid var(--border)"></th>';
  html += '<th style="text-align:right;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--border)">Amount</th>';
  html += '<th style="text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--border)">Preview</th>';
  html += '</tr></thead><tbody>';

  rows.forEach(function(r, idx) {
    var wo = r.wo;
    var pillBg = r.status==='ready' ? '#27ae6022' : r.status==='caution' ? '#e67e2222' : '#c0392b22';
    var pillColor = r.status==='ready' ? 'var(--success)' : r.status==='caution' ? '#e67e22' : 'var(--danger)';
    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:9px 10px;font-weight:600;white-space:nowrap">'+wo.wo_number+'</td>';
    html += '<td style="padding:9px 10px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(wo.title)+'</td>';
    html += '<td style="padding:9px 10px"><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;background:'+pillBg+';color:'+pillColor+'">'+r.label+'</span></td>';
    html += '<td id="er-action-'+wo.id+'" style="padding:9px 10px">';
    if (r.status !== 'ready') {
      var hasHours = r.hours.length>0, hasParts = r.parts.length>0;
      var custForRow = AppState.customers.find(function(cc){ return cc.id===wo.customer_id; });
      var poUnknownRow = custForRow && (custForRow.po_required===null || custForRow.po_required===undefined);
      var poMissingRow = custForRow && custForRow.po_required===true && !wo.po_number;
      // PO req not set on customer
      if (poUnknownRow) {
        html += '<span style="font-size:11px;color:var(--text-muted);margin-right:4px">PO req?</span>';
        html += '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--danger);border-radius:4px;background:#c0392b22;color:var(--danger);margin-right:4px" onclick="erSetPOReq(\''+wo.id+'\',\''+custForRow.id+'\',true)">PO Required</button>';
        html += '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--success);border-radius:4px;background:#27ae6022;color:var(--success);margin-right:4px" onclick="erSetPOReq(\''+wo.id+'\',\''+custForRow.id+'\',false)">No PO</button>';
      }
      // PO required but missing on WO
      else if (poMissingRow) {
        html += '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--header-bg);border-radius:4px;background:var(--bg);color:var(--header-bg);margin-right:4px" onclick="erEnterPO(\''+wo.id+'\','+idx+')">Enter PO Now</button>';
        html += '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--text-muted);border-radius:4px;background:var(--bg);color:var(--text-muted)" onclick="erSkipBatch(\''+wo.id+'\','+idx+')">Skip this batch</button>';
      }
      // Standard missing data actions
      else {
        if (!hasHours) html += '<button class="action-btn edit" style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;margin-right:4px" onclick="exportReviewFix(\''+wo.id+'\',\'hours\')">Add hours</button>';
        if (!hasParts && wo.form_mode!=='quoted') html += '<button class="action-btn edit" style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;margin-right:4px" onclick="exportReviewFix(\''+wo.id+'\',\'parts\')">Add parts</button>';
        if (wo.form_mode==='quoted' && r.quoted.length===0) html += '<button class="action-btn edit" style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;margin-right:4px" onclick="exportReviewFix(\''+wo.id+'\',\'quoted\')">Add quote</button>';
        html += '<button style="font-size:11px;padding:3px 8px;border:1px solid #e67e22;border-radius:4px;background:#e67e2222;color:#e67e22" onclick="exportReviewOverride(\''+wo.id+'\')">Export anyway</button>';
      }
    }
    html += '</td>';
    html += '<td style="padding:9px 10px;text-align:right;font-weight:600">$'+r.total.toFixed(2)+'</td>';
    html += '<td style="padding:9px 10px;text-align:center"><button style="width:28px;height:28px;border-radius:4px;border:1px solid var(--border);background:var(--surface);cursor:pointer" onclick="toggleInvoicePreview('+idx+')">&#x1F441;</button></td>';
    html += '</tr>';
    html += '<tr id="preview-row-'+idx+'" style="display:none"><td colspan="6" style="padding:0;border-bottom:1px solid var(--border)">'+buildInvoicePreview(r,custName)+'</td></tr>';
  });

  html += '</tbody></table>';

  html += '<div style="display:flex;gap:10px;margin-top:20px;align-items:center">';
  if (ready.length) {
    var ids = ready.map(function(r){return r.wo.id;});
    var idsAttr = ids.map(function(x){return "\'"+x+"\'";}).join(',');
    html += '<button class="save-btn" style="width:auto;padding:13px 22px" onclick="confirmExport(['+idsAttr+'])">Export '+ready.length+' ready to Zed Axis</button>';
  }
  html += '<button class="save-btn secondary" style="width:auto;padding:13px 22px;margin-top:0" onclick="goBack()">Cancel</button>';
  if (caution.length||blocked.length) html += '<span style="font-size:12px;color:var(--text-muted);margin-left:auto">'+caution.length+' need attention, '+blocked.length+' blocked</span>';
  html += '</div></div>';

  document.getElementById('screen-export-review').innerHTML = html;
}

function buildInvoicePreview(r, custName) {
  var wo = r.wo;
  var out = '<div style="background:var(--bg);padding:14px 18px;margin:8px;border-radius:8px;border:1px solid var(--border)">';
  out += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">';
  out += '<div><div style="font-size:13px;font-weight:700">Providence Mechanical</div><div style="font-size:11px;color:var(--text-muted)">Invoice preview - '+wo.wo_number+'</div></div>';
  out += '<div style="font-size:11px;color:var(--text-muted);text-align:right">'+escHtml(custName(wo))+'<br>'+escHtml(wo.title)+'</div>';
  out += '</div>';
  if (wo.form_mode==='quoted') {
    if (r.quoted.length) {
      r.quoted.forEach(function(q){
        out += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--text-secondary)"><span>'+escHtml(q.description)+'</span><span>$'+parseFloat(q.amount||0).toFixed(2)+'</span></div>';
      });
    } else {
      out += '<div style="font-size:12px;color:var(--danger)">No quoted amount entered</div>';
    }
  } else {
    if (r.hours.length) {
      r.hours.forEach(function(e){
        var tech=(e.technicians&&e.technicians.name)||'';
        var ht=e.hours_types;
        var rate=parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
        out += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--text-secondary)"><span>Labor - '+escHtml(tech)+' ('+e.hours+' hrs)</span><span>$'+(parseFloat(e.hours||0)*rate).toFixed(2)+'</span></div>';
      });
    } else {
      out += '<div style="font-size:12px;color:#e67e22"><i>Labor - not yet entered</i></div>';
    }
    if (r.parts.length) {
      r.parts.filter(function(e){return e.transaction_type!=='vendor_credit';}).forEach(function(e){
        out += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--text-secondary)"><span>'+escHtml(e.description)+(e.invoice_number?' (inv. '+escHtml(e.invoice_number)+')':'')+'</span><span>$'+parseFloat(e.sell_total||0).toFixed(2)+'</span></div>';
      });
    } else {
      out += '<div style="font-size:12px;color:#e67e22"><i>Parts - not yet entered</i></div>';
    }
  }
  out += '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><span>Total</span><span>$'+r.total.toFixed(2)+'</span></div>';
  out += '</div>';
  return out;
}

function toggleInvoicePreview(idx) {
  var row = document.getElementById('preview-row-'+idx);
  if (row) row.style.display = row.style.display==='none' ? 'table-row' : 'none';
}

function exportReviewFix(woId, type) {
  var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
  if (!wo) return;
  AppState.currentWO = wo;
  AppState._returnToExportReview = true;
  Promise.all([
    sb.get('hours_entries','?work_order_id=eq.'+woId+'&select=*,technicians(name),hours_types(name,internal_rate_key)'),
    sb.get('line_items','?work_order_id=eq.'+woId+'&select=*,vendors(name),qbo_items(name)'),
    sb.get('quoted_invoices','?work_order_id=eq.'+woId+'&select=*'),
  ]).then(function(results) {
    AppState.hoursEntries = results[0].data||[];
    AppState.lineItems = results[1].data||[];
    AppState.quotedLines = results[2].data||[];
    // Navigate to WO detail — back button will return to export review
    AppState._returnToExportReview = true;
    var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
    if (wo) {
      AppState.currentWO = wo;
      openWODetail(woId);
    } else {
      // Fallback to subform if WO not found
      if (type==='hours') openHoursList();
      else if (type==='parts') openPartsList();
      else if (type==='quoted') openQuotedList();
    }
  });
}

function returnToExportReview() {
  AppState._returnToExportReview = false;
  var wos = AppState._exportReviewWOs || [];
  showExportReview(wos);
}

function erSetPOReq(woId, custId, required) {
  // Set PO requirement on customer, then re-evaluate that row
  sb.patch('customers', custId, {po_required: required, modified_by: AppState.userEmail}).then(function(r) {
    if (!r.ok) { showToast('Error updating customer'); return; }
    var cust = AppState.customers.find(function(c){ return c.id===custId; });
    if (cust) cust.po_required = required;
    showToast(required ? 'PO Required set for customer' : 'No PO set for customer');
    // Re-evaluate this row's status
    var rows = AppState._exportReviewRows || [];
    var row = rows.find(function(rr){ return rr.wo.id===woId; });
    if (row) {
      var wo = row.wo;
      if (!required) {
        // No PO needed - re-evaluate based on hours/parts
        var hasHours = row.hours.length>0, hasParts = row.parts.length>0;
        if (!hasHours && !hasParts) { row.status='blocked'; row.label='No entries'; }
        else if (!hasHours) { row.status='caution'; row.label='No hours'; }
        else if (!hasParts && wo.form_mode!=='quoted') { row.status='caution'; row.label='No parts'; }
        else { row.status='ready'; row.label='Ready'; }
      } else {
        // PO required but not entered yet
        row.status='blocked'; row.label='PO required - missing';
      }
      rows.sort(function(a,b){ var o={blocked:0,caution:1,ready:2}; return o[a.status]-o[b.status]; });
      AppState._exportReviewRows = rows;
    }
    renderExportReviewGrid();
  });
}

function erEnterPO(woId, idx) {
  // Show inline PO entry field for this row
  var cell = document.querySelector('tr:nth-child('+(idx*2+1)+') td:nth-child(4)');
  // Use a simpler approach - replace action cell content with inline form
  var rows = AppState._exportReviewRows || [];
  var row = rows.find(function(r){ return r.wo.id===woId; });
  if (!row) return;
  var actionCell = document.getElementById('er-action-'+woId);
  if (!actionCell) return;
  actionCell.innerHTML = '<input type="text" id="er-po-input-'+woId+'" placeholder="PO number" onkeydown="if(event.key===\'Enter\')erSavePO(\''+woId+'\')" style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;width:110px;margin-right:4px">'
    + '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--success);border-radius:4px;background:#27ae6022;color:var(--success);margin-right:4px" onclick="erSavePO(\''+woId+'\')">Save PO</button>'
    + '<button style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;color:var(--text-muted)" onclick="renderExportReviewGrid()">Cancel</button>';
  var inp = document.getElementById('er-po-input-'+woId);
  if (inp) inp.focus();
}

function erSavePO(woId) {
  var inp = document.getElementById('er-po-input-'+woId);
  var po = inp ? inp.value.trim() : '';
  if (!po) { showToast('Enter a PO number'); return; }
  var erPoResult = validatePONumber(po); if (erPoResult.needsFlag) { showToast('"need" is not a valid PO number'); return; }
  sb.patch('work_orders', woId, {po_number: po, flag_needs_po: false, flag_needs_po_note: null, modified_by: AppState.userEmail}).then(function(r) {
    if (!r.ok) { showToast('Error saving PO'); return; }
    var rows = AppState._exportReviewRows || [];
    var row = rows.find(function(rr){ return rr.wo.id===woId; });
    if (row) {
      row.wo.po_number = po;
      var wo = row.wo;
      var hasHours = row.hours.length>0, hasParts = row.parts.length>0;
      if (!hasHours && !hasParts) { row.status='blocked'; row.label='No entries'; }
      else if (!hasHours) { row.status='caution'; row.label='No hours'; }
      else if (!hasParts && wo.form_mode!=='quoted') { row.status='caution'; row.label='No parts'; }
      else { row.status='ready'; row.label='Ready'; }
      var wo2 = AppState.workOrders.find(function(w){ return w.id===woId; });
      if (wo2) wo2.po_number = po;
      rows.sort(function(a,b){ var o={blocked:0,caution:1,ready:2}; return o[a.status]-o[b.status]; });
      AppState._exportReviewRows = rows;
    }
    showToast('PO saved');
    renderExportReviewGrid();
  });
}

function erSkipBatch(woId, idx) {
  // Remove this WO from the current export review without changing its status
  AppState._exportReviewRows = (AppState._exportReviewRows||[]).filter(function(r){ return r.wo.id!==woId; });
  AppState._exportReviewWOs = (AppState._exportReviewWOs||[]).filter(function(w){ return w.id!==woId; });
  showToast('Removed from this batch');
  renderExportReviewGrid();
}

function exportReviewOverride(woId) {
  var rows = AppState._exportReviewRows||[];
  var r = rows.find(function(r){return r.wo.id===woId;});
  if (r) { r.status='ready'; r.label='Override'; renderExportReviewGrid(); }
}

function confirmExport(woIds) {
  var wos = AppState.workOrders.filter(function(w){ return woIds.indexOf(w.id)>=0; });
  showToast('Building export...'); goBack();
  runExport(wos);
}

// ── Time & Billing Reconciliation ─────────────────────────────

var ReconcileState = {
  selectedDate: null,
  techId: null,
  stops: [],
  hoursEntries: {},
  mergedGroups: {},
  pendingMoves: {}
};

function initReconcilePanel() {
  // Reconcile reuses the Field Travel Log panel — set mode then hand off
  DRState.mode = 'reconcile';
  if (!DRState.tech) DRState.tech = drGetDefaultTech();
  if (!DRState.selectedDate) DRState.selectedDate = drTodayStr();

  // If the Field Travel Log shell is already built, just switch mode and re-render
  var shell = document.getElementById('dr-shell');
  if (shell) {
    drApplyMode();
    drRenderTimeline();
    return;
  }

  // Otherwise build the shell fresh into the dailyreview panel (shared)
  var el = document.getElementById('dailyreview-panel-inner');
  if (!el) return;
  DRState.locations = LocState.locations.length ? LocState.locations : [];
  DRState.map = null;
  DRState.mapReady = false;
  DRState.tagStep = 0;
  el.innerHTML = drBuildShell();
  drPopulateTechSelect();
  drApplyMode();
  drLoadWeek();
}

function drReconcileNavDay(dir) {
  var parts = DRState.selectedDate.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  d.setDate(d.getDate() + dir);
  DRState.selectedDate = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  var dateInput = document.getElementById('dr-reconcile-date');
  if (dateInput) dateInput.value = DRState.selectedDate;
  drLoadDay(DRState.selectedDate);
}

function drReconcileSetDate(val) {
  if (!val) return;
  DRState.selectedDate = val;
  drLoadDay(val);
}

function drApplyMode() {
  var titleEl = document.getElementById('dr-screen-title');
  var mapCol = document.getElementById('dr-map-col');
  var billingCol = document.getElementById('dr-billing-col');
  var weekBar = document.getElementById('dr-week-bar');
  var datePicker = document.getElementById('dr-reconcile-datepicker');
  var dateInput = document.getElementById('dr-reconcile-date');
  if (DRState.mode === 'reconcile') {
    if (titleEl) titleEl.textContent = 'Time & Billing Reconciliation';
    if (mapCol) mapCol.style.display = 'none';
    if (billingCol) billingCol.style.display = 'flex';
    if (weekBar) weekBar.style.display = 'none';
    if (datePicker) datePicker.style.display = 'flex';
    if (dateInput) dateInput.value = DRState.selectedDate || drTodayStr();
  } else {
    if (titleEl) titleEl.textContent = 'Field Travel Log';
    if (mapCol) mapCol.style.display = '';
    if (billingCol) billingCol.style.display = 'none';
    if (weekBar) weekBar.style.display = '';
    if (datePicker) datePicker.style.display = 'none';
  }
}

function renderReconcilePanel() {
  var el = document.getElementById('reconcile-panel-inner');
  if (!el) return;

  var date = ReconcileState.selectedDate;
  var techId = DRState.tech || (AppState.technicians && AppState.technicians[0] && AppState.technicians[0].id);

  // Header with tech selector and date nav
  var html = '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;background:var(--surface);flex-shrink:0">';
  html += '<div style="font-size:16px;font-weight:700">Time & Billing Reconciliation</div>';
  html += '<select onchange="reconcileSetTech(this.value)" style="font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">';
  AppState.technicians.forEach(function(t) {
    html += '<option value="'+t.id+'"'+(t.id===techId?' selected':'')+'>'+escHtml(t.name)+'</option>';
  });
  html += '</select>';
  html += '<div style="margin-left:auto;display:flex;align-items:center;gap:8px">';
  html += '<button onclick="reconcileNavDay(-1)" style="padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8249;</button>';
  html += '<input type="date" value="'+date+'" onchange="reconcileSetDate(this.value)" style="font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">';
  html += '<button onclick="reconcileNavDay(1)" style="padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">&#8250;</button>';
  html += '</div></div>';

  el.innerHTML = html + '<div id="reconcile-body" style="padding:16px;flex:1"><div style="text-align:center;color:var(--text-muted);padding:40px">Loading...</div></div>';

  // Set DRState date and tech to match, then use drLoadDay to load GPS + hours data
  DRState.selectedDate = date;

  // Load hours entries for right column separately (needs customer join not in drLoadDay)
  var fromUTC = drLocalMidnightUTC(date);
  var toUTC = drNextLocalMidnightUTC(date);

  Promise.all([
    sb.get('location_event', '?tid=eq.'+(AppState.technicians.find(function(t){return t.id===techId;})||{}).tid+'&timestamp=gte.'+fromUTC+'&timestamp=lt.'+toUTC+'&select=id,tid,timestamp,lat,lng,accuracy,speed&order=timestamp.asc&limit=10000'),
    sb.get('hours_entries', '?tech_id=eq.'+techId+'&entry_date=eq.'+date+'&select=*,work_orders(wo_number,title,status,customer_id,customers(name,display_name))&order=created_at.asc')
  ]).then(function(results) {
    DRState.pings = (results[0].ok && results[0].data) ? results[0].data : [];
    ReconcileState.hoursEntries = (results[1].ok && results[1].data) ? results[1].data : [];

    function runDetection() {
      var savedEntries = DRState.hoursEntries;
      DRState.hoursEntries = [];
      DRState.stops = drDetectStops(DRState.pings, DRState.locations);
      DRState.hoursEntries = savedEntries;
      renderReconcileBody();
    }

    if (!DRState.locations || !DRState.locations.length) {
      sb.get('locations', '?active=eq.true&select=*').then(function(r) {
        DRState.locations = (r.ok && r.data) ? r.data : [];
        runDetection();
      });
    } else {
      runDetection();
    }
  }).catch(function(err) {
    var body = document.getElementById('reconcile-body');
    if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Error loading data.</div>';
    console.error('Reconcile load error:', err);
  });
}

function rcHoursTypeOptions(selectedId) {
  var opts = '<option value="">— Type —</option>';
  (AppState.hoursTypes||[]).filter(function(t){ return t.active !== false; }).forEach(function(t) {
    opts += '<option value="'+t.id+'"'+(t.id===selectedId?' selected':'')+'>'+escHtml(t.name)+'</option>';
  });
  return opts;
}

function rcCustomerOptions(selectedId) {
  var opts = '<option value="">— All customers —</option>';
  var custs = (AppState.customers||[]).filter(function(c){ return c.active !== false; });
  custs.sort(function(a,b){ return (a.display_name||a.name||'').localeCompare(b.display_name||b.name||''); });
  custs.forEach(function(c) {
    var label = c.display_name || c.name || '';
    opts += '<option value="'+c.id+'"'+(c.id===selectedId?' selected':'')+'>'+escHtml(label)+'</option>';
  });
  return opts;
}

function rcLiveWOOptions(selectedId, custId) {
  var opts = '<option value="">— Select WO —</option>';
  var wos = (AppState.workOrders||[]).filter(function(w){
    if ([7,10,15].indexOf(parseInt(w.status)) < 0) return false;
    if (w.active === false) return false;
    if (custId && w.customer_id !== custId) return false;
    return true;
  });
  wos.forEach(function(w) {
    opts += '<option value="'+w.id+'"'+(w.id===selectedId?' selected':'')+'>'+escHtml(w.wo_number+' — '+w.title)+'</option>';
  });
  return opts;
}

function rcFilterWOs(modalPrefix, custId) {
  var woEl = document.getElementById(modalPrefix+'-wo');
  if (!woEl) return;
  woEl.innerHTML = rcLiveWOOptions('', custId||'');
}



function rcDefaultHoursTypeId() {
  var ht = (AppState.hoursTypes||[]).find(function(t){ return t.name === 'Hours' && t.active !== false; });
  return ht ? ht.id : ((AppState.hoursTypes||[])[0]||{}).id || '';
}

function rcGetTechInfo() {
  var techId = DRState.tech || (AppState.technicians&&AppState.technicians[0]&&AppState.technicians[0].id);
  var techName = (AppState.technicians.find(function(t){return t.id===techId;})||{}).name||'';
  return { id: techId, name: techName };
}

function rcDescriptor(wo, techName) {
  return (wo?wo.wo_number:'') + ' - ' + techName + ' - ' + (wo?wo.title:'');
}

function rcIsPersonalStop(stop) {
  if (!stop.location) return false;
  var lt = stop.location.location_type;
  return lt === 'personal' || lt === 'office';
}

function renderReconcileBody() {
  var el = document.getElementById('reconcile-body');
  if (!el) return;

  // rcElapsedMin — v4.46 — merge-aware elapsed for reconciliation screen
  // Mirrors drElapsedMin in field-travel-log.js — must stay in sync
  function rcElapsedMin(stop) {
    if (!stop || !stop.arrivedAt) return 0;
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
    if (!stop.leftAt) return 0;
    return Math.round((new Date(stop.leftAt) - new Date(stop.arrivedAt)) / 60000);
  }

  var stops = DRState.stops || [];
  var entries = ReconcileState.hoursEntries || [];
  var travelThreshMin = parseInt(AppState.settings.billing_travel_threshold_min || '30');
  var minBillingH = parseFloat(AppState.settings.billing_minimum_hours || 2);

  var totalGPSMin = stops.reduce(function(s,st){ return s + rcElapsedMin(st); }, 0);
  var totalBilledH = entries.reduce(function(s,e){ return s + parseFloat(e.hours||0); }, 0);
  var totalGPSH = totalGPSMin / 60;
  var variance = totalBilledH - totalGPSH;
  var varStyle = variance >= 0 ? 'color:var(--text-success)' : 'color:var(--text-danger)';

  // Build WO lifetime totals for minimum billing check
  // We only have today's entries — flag WOs where today's total < minimum as amber advisory
  var woTotals = {};
  entries.forEach(function(e) {
    var wid = e.work_order_id;
    if (!wid) return;
    if (!woTotals[wid]) woTotals[wid] = 0;
    woTotals[wid] += parseFloat(e.hours||0);
  });

  var html = '';

  // Summary bar
  html += '<div style="display:flex;gap:24px;padding:10px 0 14px;margin-bottom:14px;border-bottom:.5px solid var(--border)">';
  html += '<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Elapsed</div><div style="font-size:20px;font-weight:500">'+drFormatDuration(totalGPSMin)+'</div></div>';
  html += '<div style="border-left:.5px solid var(--border);padding-left:24px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Billed</div><div style="font-size:20px;font-weight:500">'+totalBilledH.toFixed(2)+'h</div></div>';
  html += '<div style="border-left:.5px solid var(--border);padding-left:24px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Variance</div><div style="font-size:20px;font-weight:500;'+varStyle+'">'+(variance>=0?'+':'')+variance.toFixed(2)+'h</div></div>';
  html += '</div>';

  // Table
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed">';
  html += '<colgroup><col style="width:26%"><col style="width:12%"><col style="width:12%"><col style="width:36%"><col style="width:14%"></colgroup>';
  html += '<thead><tr>';
  html += '<th style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:.5px solid var(--border);text-align:left">Location</th>';
  html += '<th style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:.5px solid var(--border);text-align:right">Elapsed</th>';
  html += '<th style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:.5px solid var(--border);text-align:right">Billed</th>';
  html += '<th style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:.5px solid var(--border);text-align:left">Work order(s)</th>';
  html += '<th style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:.5px solid var(--border);text-align:center">Status</th>';
  html += '</tr></thead><tbody>';

  stops.forEach(function(stop, idx) {
    var locName = stop.location ? stop.location.name : (stop.locationMatches && stop.locationMatches.length ? 'Multiple accounts' : 'Unknown stop');
    var gpsH = rcElapsedMin(stop) / 60;
    var isPersonal = rcIsPersonalStop(stop);

    // Drive segment before this stop
    var prevDriveMin = 0;
    if (idx > 0) {
      prevDriveMin = Math.round((new Date(stop.arrivedAt) - new Date(stops[idx-1].leftAt)) / 60000);
    }

    // Match billed entries to this stop
    var matchedEntries = entries.filter(function(e) {
      if (!e.work_orders) return false;
      if (stop.location && e.location_id === stop.location.id) return true;
      if (stop.locationMatches) return stop.locationMatches.some(function(l){ return l.id === e.location_id; });
      return false;
    });
    var billedH = matchedEntries.reduce(function(s,e){ return s + parseFloat(e.hours||0); }, 0);

    // Row status
    var rowBg = '';
    var badge = '';
    if (isPersonal) {
      rowBg = '';
      badge = '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:var(--surface-1);color:var(--text-secondary);border:.5px solid var(--border)">Personal</span>';
    } else if (billedH === 0) {
      rowBg = 'background:var(--bg-danger)';
      badge = '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:var(--bg-danger);color:var(--text-danger);border:.5px solid var(--border-danger)">Unbilled</span>';
    } else if (billedH >= gpsH) {
      rowBg = 'background:var(--bg-success)';
      badge = '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:var(--bg-success);color:var(--text-success);border:.5px solid var(--border-success)">Reconciled</span>';
    } else {
      rowBg = 'background:var(--bg-warning)';
      badge = '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:var(--bg-warning);color:var(--text-warning);border:.5px solid var(--border-warning)">Under-billed</span>';
    }

    // Location col
    var locId = stop.location ? stop.location.id : null;
    html += '<tr>';
    html += '<td style="padding:8px 10px;border-bottom:.5px solid var(--border);vertical-align:top;'+rowBg+'">';
    html += '<div style="font-weight:500;color:var(--text-primary)">'+escHtml(locName)+'</div>';
    html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">'+drFormatTime(stop.arrivedAt)+' – '+drFormatTime(stop.leftAt)+'</div>';
    // Travel in — show drive segment from previous stop with Add button
    if (idx > 0 && prevDriveMin > 0 && !isPersonal) {
      var isEndDay = idx === stops.length - 1;
      var isBillableTravel = prevDriveMin >= travelThreshMin;
      var suggestedTravelH = Math.max(0, (prevDriveMin - travelThreshMin) / 60);
      html += '<div style="margin-top:4px;font-size:10px;color:var(--text-muted)">'+prevDriveMin+'m drive in';
      if (isBillableTravel) {
        html += ' <span style="color:var(--text-warning)">&#9888;</span>';
      }
      html += '</div>';
      html += '<button onclick="reconcileAddTravel('+idx+','+prevDriveMin+')" style="font-size:10px;padding:2px 8px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);color:var(--text-secondary);cursor:pointer;margin-top:3px">+ Add travel</button>';
    }
    html += '</td>';

    // GPS col
    html += '<td style="padding:8px 10px;border-bottom:.5px solid var(--border);text-align:right;vertical-align:top;'+rowBg+'">';
    html += '<div style="font-weight:500">'+gpsH.toFixed(2)+'h</div>';
    html += '</td>';

    // Billed col
    html += '<td style="padding:8px 10px;border-bottom:.5px solid var(--border);text-align:right;vertical-align:top;'+rowBg+'">';
    if (billedH > 0) {
      html += '<div style="font-weight:500">'+billedH.toFixed(2)+'h</div>';
    } else {
      html += '<div style="color:var(--text-muted)">—</div>';
    }
    html += '</td>';

    // WO(s) col
    html += '<td style="padding:8px 10px;border-bottom:.5px solid var(--border);vertical-align:top;'+rowBg+'">';
    if (!isPersonal) {
      if (matchedEntries.length) {
        matchedEntries.forEach(function(e) {
          var wo = e.work_orders;
          var woLabel = wo ? wo.wo_number + ' — ' + wo.title : 'Unknown WO';
          var woLocked = wo && [11,12,99].indexOf(parseInt(wo.status)) >= 0;
          var woTotal = woTotals[e.work_order_id] || 0;
          var belowMin = woTotal < minBillingH;
          html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">';
          html += '<span style="font-size:12px;color:var(--text-secondary);flex-shrink:0">'+parseFloat(e.hours).toFixed(2)+'h</span>';
          html += '<span style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(woLabel)+'">'+escHtml(woLabel)+'</span>';
          if (!woLocked) {
            html += '<button onclick="reconcileEditEntry(\'' + e.id + '\')" style="font-size:10px;padding:2px 6px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-2);cursor:pointer;flex-shrink:0">Edit</button>';
            html += '<button onclick="reconcileMoveEntry(\'' + e.id + '\')" style="font-size:10px;padding:2px 6px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-2);cursor:pointer;flex-shrink:0;margin-left:2px">Move</button>';
          }
          html += '</div>';
          if (belowMin) {
            html += '<div style="font-size:10px;color:var(--text-warning);margin-bottom:3px">&#9888; '+woTotal.toFixed(2)+'h billed — under '+minBillingH+'h minimum</div>';
          }
        });
      }
      // Bill this time button — always show for customer/vendor stops
      var locIdForCreate = stop.location ? stop.location.id : (stop.locationMatches && stop.locationMatches[0] ? stop.locationMatches[0].id : null);
      html += '<button onclick="reconcileCreateEntry('+idx+')" style="font-size:10px;padding:2px 9px;border:.5px solid var(--border-accent);border-radius:var(--radius);background:var(--bg-accent);color:var(--text-accent);cursor:pointer;margin-top:2px">+ Bill this time</button>';
    }
    html += '</td>';

    // Status col
    html += '<td style="padding:8px 10px;border-bottom:.5px solid var(--border);text-align:center;vertical-align:top;'+rowBg+'">'+badge+'</td>';
    html += '</tr>';

    // Drive row between stops
    if (idx < stops.length - 1) {
      var nextStop = stops[idx+1];
      var driveMin = Math.round((new Date(nextStop.arrivedAt) - new Date(stop.leftAt)) / 60000);
      html += '<tr>';
      html += '<td colspan="5" style="padding:3px 10px;border-bottom:.5px solid var(--border)">';
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted)">';
      html += '<i class="ti ti-arrow-right" aria-hidden="true" style="font-size:12px"></i>';
      html += driveMin+'m drive';
      html += '</div></td></tr>';
    }
  });

  html += '</tbody></table>';

  if (!stops.length) {
    html = '<div style="text-align:center;color:var(--text-muted);padding:40px">No GPS stops detected for this date.</div>';
  }

  el.innerHTML = html;
}

function reconcileAddTravel(stopIdx, driveMin) {
  var stop = DRState.stops[stopIdx];
  if (!stop) return;
  var travelThreshMin = parseInt(AppState.settings.billing_travel_threshold_min || '30');
  var suggestedH = parseFloat(Math.max(0.25, (driveMin - travelThreshMin) / 60).toFixed(2));
  if (driveMin <= travelThreshMin) suggestedH = parseFloat((driveMin / 60).toFixed(2));
  var locId = stop.location ? stop.location.id : (stop.locationMatches && stop.locationMatches[0] ? stop.locationMatches[0].id : null);

  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="rc-travel-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:420px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Add travel time</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">'+driveMin+'m drive — suggested billable: '+suggestedH+'h</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
  html += '<input id="rct-hours" type="number" step="0.25" min="0.25" value="'+suggestedH+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
  html += '<select id="rct-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(rcDefaultHoursTypeId())+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Work order</label>';
  html += '<select id="rct-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('','')+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'rc-travel-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="reconcileSaveTravelEntry(\'' + locId + '\')" style="padding:7px 16px;background:var(--fill-accent);color:var(--on-accent);border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function reconcileSaveTravelEntry(locId) {
  var woId = (document.getElementById('rct-wo')||{}).value;
  var hours = parseFloat((document.getElementById('rct-hours')||{}).value||0);
  var htId = (document.getElementById('rct-type')||{}).value;
  if (!woId) { showToast('Select a work order'); return; }
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  var tech = rcGetTechInfo();
  sb.post('hours_entries', {
    work_order_id: woId,
    tech_id: tech.id,
    entry_date: ReconcileState.selectedDate,
    hours_type_id: htId || null,
    hours: hours,
    billable: true,
    location_id: locId || null,
    descriptor: rcDescriptor(wo, tech.name),
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok) {
      showToast('Travel time saved');
      var modal = document.getElementById('rc-travel-modal');
      if (modal) modal.remove();
      renderReconcilePanel();
    } else { showToast('Save failed'); }
  });
}

function reconcileCreateEntry(stopIdx) {
  var stop = DRState.stops[stopIdx];
  if (!stop) return;
  var locId = stop.location ? stop.location.id : (stop.locationMatches && stop.locationMatches[0] ? stop.locationMatches[0].id : null);
  var gpsH = parseFloat((rcElapsedMin(stop) / 60).toFixed(2));

  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="rc-entry-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:420px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Bill time — '+escHtml(stop.location?stop.location.name:(stop.locationMatches?'Multiple accounts':'Unknown stop'))+'</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Elapsed: '+drFormatTime(stop.arrivedAt)+' – '+drFormatTime(stop.leftAt)+' ('+gpsH+'h)</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
  html += '<input id="rc-hours" type="number" step="0.25" min="0.25" value="'+gpsH+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
  html += '<select id="rc-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(rcDefaultHoursTypeId())+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Work order</label>';
  html += '<select id="rc-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('','')+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'rc-entry-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="reconcileSaveNewEntry(\'' + locId + '\')" style="padding:7px 16px;background:var(--fill-accent);color:var(--on-accent);border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function reconcileSaveNewEntry(locId) {
  var woId = (document.getElementById('rc-wo')||{}).value;
  var hours = parseFloat((document.getElementById('rc-hours')||{}).value||0);
  var htId = (document.getElementById('rc-type')||{}).value;
  if (!woId) { showToast('Select a work order'); return; }
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  var tech = rcGetTechInfo();
  sb.post('hours_entries', {
    work_order_id: woId,
    tech_id: tech.id,
    entry_date: ReconcileState.selectedDate,
    hours_type_id: htId || null,
    hours: hours,
    billable: true,
    location_id: locId || null,
    descriptor: rcDescriptor(wo, tech.name),
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok) {
      showToast('Hours saved');
      var modal = document.getElementById('rc-entry-modal');
      if (modal) modal.remove();
      renderReconcilePanel();
    } else { showToast('Save failed'); }
  });
}

function reconcileEditEntry(entryId) {
  var e = ReconcileState.hoursEntries.find(function(x){ return x.id === entryId; });
  if (!e) return;
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="rc-edit-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:420px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Edit hours entry</div>';
  var wo = e.work_orders;
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">'+(wo?escHtml(wo.wo_number+' — '+wo.title):'')+'</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
  html += '<input id="rce-hours" type="number" step="0.25" min="0.25" value="'+parseFloat(e.hours||0).toFixed(2)+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
  html += '<select id="rce-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(e.hours_type_id)+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'rc-edit-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="reconcileSaveEdit(\'' + entryId + '\')" style="padding:7px 16px;background:var(--fill-accent);color:var(--on-accent);border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function reconcileSaveEdit(entryId) {
  var hours = parseFloat((document.getElementById('rce-hours')||{}).value||0);
  var htId = (document.getElementById('rce-type')||{}).value;
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  sb.patch('hours_entries', entryId, {
    hours: hours,
    hours_type_id: htId || null,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      showToast('Updated');
      var modal = document.getElementById('rc-edit-modal');
      if (modal) modal.remove();
      renderReconcilePanel();
    }
  });
}

function reconcileMoveEntry(entryId) {
  var e = ReconcileState.hoursEntries.find(function(x){ return x.id === entryId; });
  if (!e) return;
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="rc-move-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:420px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Move to different WO</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Currently: '+(e.work_orders?escHtml(e.work_orders.wo_number+' — '+e.work_orders.title):'Unknown WO')+'</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Move to work order</label>';
  html += '<select id="rcm-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('','')+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'rc-move-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="reconcileConfirmMove(\'' + entryId + '\')" style="padding:7px 16px;background:var(--fill-accent);color:var(--on-accent);border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Move</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function reconcileConfirmMove(entryId) {
  var newWoId = (document.getElementById('rcm-wo')||{}).value;
  if (!newWoId) { showToast('Select a work order'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === newWoId; });
  var tech = rcGetTechInfo();
  sb.patch('hours_entries', entryId, {
    work_order_id: newWoId,
    descriptor: rcDescriptor(wo, tech.name),
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      showToast('Moved to '+(wo?wo.wo_number:'WO'));
      var modal = document.getElementById('rc-move-modal');
      if (modal) modal.remove();
      renderReconcilePanel();
    }
  });
}


// ── Billing column (reconcile mode) ──────────────────────────

function drLoadBillingCol() {
  var summaryEl = document.getElementById('dr-billing-summary');
  var bodyEl = document.getElementById('dr-billing-body');
  if (!summaryEl || !bodyEl) return;
  bodyEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;font-size:13px">Loading...</div>';

  var date = DRState.selectedDate;
  var techId = DRState.tech;

  Promise.all([
    sb.get('hours_entries', '?tech_id=eq.'+techId+'&entry_date=eq.'+date+'&select=*,work_orders(wo_number,title,status,customer_id,customers(name,display_name))&order=created_at.asc'),
    sb.get('line_items', '?transaction_date=eq.'+date+'&active=neq.false&select=id,work_order_id,vendor_id,description,qty,sell_total,transaction_type&order=created_at.asc')
  ]).then(function(results) {
    var entries = results[0].ok ? (results[0].data||[]) : [];
    var lineItems = results[1].ok ? (results[1].data||[]) : [];

    // Load locations if needed
    if (!DRState.locations || !DRState.locations.length) {
      sb.get('locations', '?active=eq.true&select=*').then(function(r) {
        DRState.locations = (r.ok && r.data) ? r.data : [];
        drRenderBillingCol(entries, lineItems);
      });
    } else {
      drRenderBillingCol(entries, lineItems);
    }
  }).catch(function(err) {
    if (bodyEl) bodyEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Error loading billing data.</div>';
    console.error('Billing col error:', err);
  });
}

function drRenderBillingCol(entries, lineItems) {
  var summaryEl = document.getElementById('dr-billing-summary');
  var bodyEl = document.getElementById('dr-billing-body');
  if (!summaryEl || !bodyEl) return;

  var stops = DRState.stops || [];
  var minBillingH = parseFloat(AppState.settings.billing_minimum_hours || 2);
  var travelThreshMin = parseInt(AppState.settings.billing_travel_threshold_min || '30');
  var dayReview = DRState.dayReviews ? DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate; }) : null;
  var stopFlags = {};
  if (dayReview && dayReview.stop_flags) {
    try { stopFlags = typeof dayReview.stop_flags === 'string' ? JSON.parse(dayReview.stop_flags) : dayReview.stop_flags; } catch(e) {}
  }

  // Apply merged_stops — collapse secondary segments into primary, same as Field Travel Log
  var mergedSecondaryKeys = {};
  if (dayReview && dayReview.merged_stops) {
    var ms = [];
    try { ms = typeof dayReview.merged_stops === 'string' ? JSON.parse(dayReview.merged_stops) : dayReview.merged_stops; } catch(e) {}
    if (!Array.isArray(ms)) ms = [];
    ms.forEach(function(m) {
      (m.mergedSegments||[]).forEach(function(seg) { if (seg.arrivedAt) mergedSecondaryKeys[seg.arrivedAt] = true; });
      // Update primary stop duration to wall clock merged time
      var primary = stops.find(function(s){ return s.arrivedAt === m.primaryArrivedAt; });
      if (primary) {
        if (m.totalDurationMin) {
          // Use stored sum of stop durations — correct
          primary.durationMin = m.totalDurationMin;
        } else {
          // Legacy fallback: sum segments
          var segTotal = (m.mergedSegments||[]).reduce(function(sum,seg){ return sum + (seg.durationMin||0); }, 0);
          primary.durationMin = m.originalDurationMin + segTotal;
        }
        // Extend leftAt to last segment for display purposes only
        var lastSeg = (m.mergedSegments||[]).reduce(function(latest, seg) {
          return (!latest || new Date(seg.leftAt) > new Date(latest.leftAt)) ? seg : latest;
        }, null);
        if (lastSeg && new Date(lastSeg.leftAt) > new Date(primary.leftAt)) {
          primary.leftAt = lastSeg.leftAt;
        }
      }
    });
  }
  stops = stops.filter(function(s){ return !mergedSecondaryKeys[s.arrivedAt]; });

  // Filter to clock-in/clock-out window
  var clockIn = dayReview ? dayReview.clock_in : null;
  var clockOut = dayReview ? dayReview.clock_out : null;
  if (clockIn) {
    var ciTime = new Date(clockIn);
    var coTime = clockOut ? new Date(clockOut) : new Date();
    // Find customer/vendor stops after clock-out for warning
    var afterClockOutCustomerStops = clockOut ? stops.filter(function(s) {
      var loc = s.location;
      var lt = loc ? (loc.location_type||'') : '';
      return new Date(s.arrivedAt) > coTime && (lt === 'customer' || lt === 'vendor');
    }) : [];
    stops = stops.filter(function(s){ return new Date(s.leftAt) >= ciTime && new Date(s.arrivedAt) <= coTime; });
  } else {
    var afterClockOutCustomerStops = [];
  }

  var totalBilledH = entries.reduce(function(s,e){ return s + parseFloat(e.hours||0); }, 0);

  // WO totals for today
  var woTotals = {};
  entries.forEach(function(e) {
    if (!e.work_order_id) return;
    woTotals[e.work_order_id] = (woTotals[e.work_order_id]||0) + parseFloat(e.hours||0);
  });

  // On clock time = clock-in to clock-out
  var onClockMin = 0;
  if (clockIn) {
    var coForCalc = clockOut ? new Date(clockOut) : new Date();
    onClockMin = Math.round((coForCalc - new Date(clockIn)) / 60000);
  }
  var onClockH = onClockMin / 60;
  var gapH = onClockH - totalBilledH;
  var gapColor = gapH <= 0 ? 'var(--text-success)' : 'var(--text-danger)';

  // Summary bar
  var sHtml = '';
  sHtml += '<div><div style="font-size:11px;color:var(--text-muted)">On clock</div><div style="font-size:17px;font-weight:600">'+drFormatDuration(onClockMin)+'</div></div>';
  sHtml += '<div style="border-left:.5px solid var(--border);padding-left:20px"><div style="font-size:11px;color:var(--text-muted)">Billed</div><div style="font-size:17px;font-weight:600">'+totalBilledH.toFixed(2)+'h</div></div>';
  sHtml += '<div style="border-left:.5px solid var(--border);padding-left:20px"><div style="font-size:11px;color:var(--text-muted)">Gap</div><div style="font-size:17px;font-weight:600;color:'+gapColor+'">'+(gapH > 0 ? '+' : '')+gapH.toFixed(2)+'h</div></div>';
  if (afterClockOutCustomerStops && afterClockOutCustomerStops.length) {
    sHtml += '<div style="border-left:.5px solid var(--border);padding-left:20px;color:#854f0b;font-size:12px;display:flex;align-items:center">&#9888; '+afterClockOutCustomerStops.length+' customer stop'+(afterClockOutCustomerStops.length!==1?'s':'')+' after clock-out</div>';
  }
  summaryEl.innerHTML = sHtml;

  var html = '';

  if (!stops.length) {
    bodyEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;font-size:13px">No GPS stops for this date.</div>';
    return;
  }

  // Table
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">';
  html += '<colgroup><col style="width:24%"><col style="width:10%"><col style="width:10%"><col style="width:42%"><col style="width:14%"></colgroup>';
  html += '<thead><tr style="border-bottom:.5px solid var(--border)">';
  ['Location','Elapsed','Billed','Work order(s) & Parts','Status'].forEach(function(h,i) {
    var align = (i===1||i===2) ? 'right' : 'left';
    html += '<th style="font-size:10px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:5px 8px;text-align:'+align+'">'+h+'</th>';
  });
  html += '</tr></thead><tbody>';

  var renderedEntryIds = {};

  stops.forEach(function(stop, idx) {
    var locName = stop.location ? stop.location.name : (stop.locationMatches && stop.locationMatches.length ? 'Multiple accounts' : 'Unknown stop');
    var locType = stop.location ? (stop.location.location_type||'') : '';
    var isPersonal = locType === 'personal' || locType === 'office' || (stop.location && stop.location.is_personal);
    var isVendor = locType === 'vendor';
    var gpsH = rcElapsedMin(stop) / 60;
    var flagKey = stop.arrivedAt;
    var isNotBillable = stopFlags[flagKey] && stopFlags[flagKey].billable === false;

    // Drive segment before this stop
    var prevDriveMin = idx > 0 ? Math.round((new Date(stop.arrivedAt) - new Date(stops[idx-1].leftAt)) / 60000) : 0;
    var isFirstDrive = idx === 1 && prevDriveMin >= travelThreshMin;
    var isLastDrive = idx === stops.length - 1 && prevDriveMin >= travelThreshMin;

    // Matched hours entries — exclude entries already shown on a previous stop row
    var matchedEntries = entries.filter(function(e) {
      if (renderedEntryIds[e.id]) return false;
      if (!e.work_orders) return false;
      if (stop.location && e.location_id === stop.location.id) return true;
      if (stop.locationMatches) return stop.locationMatches.some(function(l){ return l.id === e.location_id; });
      return false;
    });
    var billedH = matchedEntries.reduce(function(s,e){ return s + parseFloat(e.hours||0); }, 0);

    // Matched line items for this stop
    var matchedItems = [];
    if (stop.location && stop.location.customer_id) {
      matchedItems = lineItems.filter(function(li) {
        return matchedEntries.some(function(e){ return e.work_order_id === li.work_order_id; });
      });
    }

    // Vendor stop — check for parts
    var vendorMissingParts = false;
    if (isVendor && stop.location && stop.location.vendor_id) {
      var vendorParts = lineItems.filter(function(li){ return li.vendor_id === stop.location.vendor_id; });
      vendorMissingParts = vendorParts.length === 0;
    }

    // Row color
    var rowBg = '';
    var badge = '';
    if (isNotBillable || isPersonal) {
      rowBg = '';
      badge = '<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:var(--surface-1);color:var(--text-secondary);border:.5px solid var(--border)">Not billable</span>';
    } else if (billedH === 0) {
      rowBg = 'background:#fff0f0';
      badge = '<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:#fde8e8;color:#a32d2d;border:.5px solid #f5c2c2">Unbilled</span>';
    } else if (billedH >= gpsH) {
      rowBg = 'background:#f0fff4';
      badge = '<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:#e0f5e8;color:#2d6b3b;border:.5px solid #b2dfc0">Reconciled</span>';
    } else {
      rowBg = 'background:#fffbf0';
      badge = '<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:#fef3d0;color:#854f0b;border:.5px solid #f0d890">Under-billed</span>';
    }

    // Drive row
    if (idx > 0 && prevDriveMin > 0) {
      html += '<tr><td colspan="5" style="padding:2px 8px;border-bottom:.5px solid var(--border)">';
      html += '<span style="font-size:10px;color:var(--text-muted)">&#9654; '+prevDriveMin+'m drive';
      if (isFirstDrive || isLastDrive) html += ' <span style="color:#854f0b">&#9888; possible billable travel</span>';
      html += '</span>';
      if ((isFirstDrive || isLastDrive) && !isPersonal) {
        html += ' <button onclick="drBillingAddTravel('+idx+','+prevDriveMin+')" style="font-size:10px;padding:1px 7px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);color:var(--text-secondary);cursor:pointer;margin-left:4px">+ Add travel</button>';
      }
      html += '</td></tr>';
    }

    // Stop row
    html += '<tr style="'+rowBg+'">';

    // Location col
    html += '<td style="padding:7px 8px;border-bottom:.5px solid var(--border);vertical-align:top">';
    html += '<div style="font-weight:500;font-size:12px">'+escHtml(locName)+'</div>';
    html += '<div style="font-size:10px;color:var(--text-secondary)">'+drFormatTime(stop.arrivedAt)+' – '+drFormatTime(stop.leftAt)+'</div>';
    if (vendorMissingParts) {
      html += '<div style="font-size:10px;color:#854f0b;margin-top:2px">&#9888; No parts recorded</div>';
    }
    if (!isPersonal && !isNotBillable) {
      html += '<button onclick="drBillingToggleNotBillable('+idx+')" style="font-size:10px;padding:1px 7px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);color:var(--text-secondary);cursor:pointer;margin-top:3px">Mark not billable</button>';
    } else if (isNotBillable) {
      html += '<button onclick="drBillingToggleNotBillable('+idx+')" style="font-size:10px;padding:1px 7px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);color:var(--text-secondary);cursor:pointer;margin-top:3px">Mark billable</button>';
    }
    html += '</td>';

    // GPS col
    html += '<td style="padding:7px 8px;border-bottom:.5px solid var(--border);text-align:right;vertical-align:top;'+rowBg+'">';
    html += '<div style="font-weight:500">'+gpsH.toFixed(2)+'h</div>';
    html += '</td>';

    // Billed col
    html += '<td style="padding:7px 8px;border-bottom:.5px solid var(--border);text-align:right;vertical-align:top;'+rowBg+'">';
    if (billedH > 0) html += '<div style="font-weight:500">'+billedH.toFixed(2)+'h</div>';
    else html += '<div style="color:var(--text-muted)">—</div>';
    html += '</td>';

    // WO + Parts col
    html += '<td style="padding:7px 8px;border-bottom:.5px solid var(--border);vertical-align:top;'+rowBg+'">';
    if (!isPersonal && !isNotBillable) {
      if (matchedEntries.length) {
        matchedEntries.forEach(function(e) {
          renderedEntryIds[e.id] = true; // mark as rendered
          var wo = e.work_orders;
          var woLabel = wo ? wo.wo_number + ' — ' + wo.title : 'Unknown WO';
          var woLocked = wo && [11,12,99].indexOf(parseInt(wo.status)) >= 0;
          var woTotal = woTotals[e.work_order_id]||0;
          var belowMin = woTotal < minBillingH;
          html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">';
          html += '<span style="font-size:11px;color:var(--text-secondary);flex-shrink:0">'+parseFloat(e.hours).toFixed(2)+'h</span>';
          html += '<a onclick="event.stopPropagation();drOpenWOFromBilling(\''+e.work_order_id+'\')" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-accent);cursor:pointer;display:inline-flex;align-items:center;gap:3px" title="'+escHtml(woLabel)+'">'+escHtml(woLabel)+' <i class=\"ti ti-external-link\" style=\"font-size:10px;flex-shrink:0\" aria-hidden=\"true\"></i></a>';
          if (!woLocked) {
            html += '<button onclick="drBillingEdit(\''+e.id+'\')" style="font-size:10px;padding:1px 6px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer;flex-shrink:0">Edit</button>';
            html += '<button onclick="drBillingMove(\''+e.id+'\')" style="font-size:10px;padding:1px 6px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer;flex-shrink:0;margin-left:2px">Move</button>';
          }
          html += '</div>';
          if (belowMin) html += '<div style="font-size:10px;color:#854f0b;margin-bottom:2px">&#9888; '+woTotal.toFixed(2)+'h billed today — under '+minBillingH+'h minimum</div>';
          // Parts — collapsible
          var woParts = matchedItems.filter(function(li){ return li.work_order_id === e.work_order_id; });
          var partsTotal = woParts.reduce(function(s,li){ return s + parseFloat(li.sell_total||0); }, 0);
          var partsId = 'parts-'+e.id.replace(/-/g,'');
          if (woParts.length) {
            html += '<button onclick="event.stopPropagation();var el=document.getElementById(\''+partsId+'\');var ic=document.getElementById(\''+partsId+'-ic\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';ic.style.transform=el.style.display===\'none\'?\'\':\'rotate(180deg)\'" style="font-size:10px;padding:1px 0;border:none;background:none;color:var(--text-accent);cursor:pointer;display:inline-flex;align-items:center;gap:3px;margin-bottom:2px">';
            html += '<i id="'+partsId+'-ic" class="ti ti-chevron-down" style="font-size:11px" aria-hidden="true"></i>';
            html += escHtml(woParts.length)+' part'+(woParts.length!==1?'s':'')+' & service'+(woParts.length!==1?'s':'')+' — $'+partsTotal.toFixed(2)+'</button>';
            html += '<div id="'+partsId+'" style="display:none;margin:2px 0 4px;padding:4px 6px;background:var(--surface-1);border-radius:4px;border:.5px solid var(--border)">';
            woParts.forEach(function(li) {
              html += '<div style="font-size:10px;color:var(--text-secondary);display:flex;gap:6px">';
              html += '<span style="flex:1">'+escHtml(li.description||'Part')+'</span>';
              if (li.qty) html += '<span>x'+li.qty+'</span>';
              if (li.sell_total) html += '<span style="font-weight:500;color:var(--text-primary)">$'+parseFloat(li.sell_total).toFixed(2)+'</span>';
              html += '</div>';
            });
            html += '</div>';
          } else {
            html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">No parts & services recorded</div>';
          }
        });
      }
      // Bill this time button — always show for billable stops
      html += '<button onclick="drBillingCreate('+idx+')" style="font-size:10px;padding:2px 8px;border:.5px solid var(--border-accent,var(--border));border-radius:var(--radius);background:var(--bg-accent,var(--header-bg));color:var(--on-accent,#fff);cursor:pointer;margin-top:3px">+ Bill this time</button>';
    }
    html += '</td>';

    // Status col
    html += '<td style="padding:7px 8px;border-bottom:.5px solid var(--border);text-align:center;vertical-align:top;'+rowBg+'">'+badge+'</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  bodyEl.innerHTML = html;
}

function drOpenWOFromBilling(woId) {
  if (!woId) return;
  // Switch to WO screen and open the work order
  desktopNav('wo');
  // Give the WO panel time to render then open the WO
  setTimeout(function() {
    var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
    if (wo) openWODetail(woId);
  }, 100);
}

function drBillingToggleNotBillable(stopIdx) {
  var stop = DRState.stops[stopIdx];
  if (!stop) return;
  var dayReview = DRState.dayReviews ? DRState.dayReviews.find(function(r){ return r.review_date === DRState.selectedDate; }) : null;
  if (!dayReview) return;
  var stopFlags = {};
  try { stopFlags = typeof dayReview.stop_flags === 'string' ? JSON.parse(dayReview.stop_flags) : (dayReview.stop_flags||{}); } catch(e){}
  var key = stop.arrivedAt;
  var current = stopFlags[key] && stopFlags[key].billable === false;
  if (current) {
    delete stopFlags[key];
  } else {
    stopFlags[key] = { billable: false, paid: false };
  }
  sb.patch('day_review', dayReview.id, { stop_flags: stopFlags, modified_by: AppState.userEmail, modified_at: new Date().toISOString() }).then(function(r) {
    if (r.ok) {
      dayReview.stop_flags = stopFlags;
      drLoadBillingCol();
    }
  });
}

function drBillingCreate(stopIdx) {
  var stop = DRState.stops[stopIdx];
  if (!stop) return;
  var locId = stop.location ? stop.location.id : (stop.locationMatches && stop.locationMatches[0] ? stop.locationMatches[0].id : null);
  var gpsH = parseFloat((rcElapsedMin(stop) / 60).toFixed(2));
  var locLabel = stop.location ? stop.location.name : (stop.locationMatches ? 'Multiple accounts' : 'Unknown stop');
  // Pre-select customer from stop location if available
  var preCustId = stop.location ? (stop.location.customer_id||'') : '';

  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="drb-create-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:440px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Bill time — '+escHtml(locLabel)+'</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Elapsed: '+drFormatTime(stop.arrivedAt)+' – '+drFormatTime(stop.leftAt)+' ('+gpsH+'h)</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
  html += '<input id="drb-hours" type="number" step="0.25" min="0.25" value="'+gpsH+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
  html += '<select id="drb-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(rcDefaultHoursTypeId())+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Customer <span style="color:var(--text-muted)">(optional — filters WOs)</span></label>';
  html += '<select id="drb-cust" onchange="rcFilterWOs(\'drb\',this.value)" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcCustomerOptions(preCustId)+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Work order</label>';
  html += '<select id="drb-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('', preCustId)+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'drb-create-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="drBillingCreateSave(\''+locId+'\')" style="padding:7px 16px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function drBillingCreateSave(locId) {
  var woId = (document.getElementById('drb-wo')||{}).value;
  var hours = parseFloat((document.getElementById('drb-hours')||{}).value||0);
  var htId = (document.getElementById('drb-type')||{}).value;
  if (!woId) { showToast('Select a work order'); return; }
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  var tech = rcGetTechInfo();
  sb.post('hours_entries', {
    work_order_id: woId, tech_id: tech.id, entry_date: DRState.selectedDate,
    hours_type_id: htId||null, hours: hours, billable: true, location_id: locId||null,
    descriptor: rcDescriptor(wo, tech.name), created_by: AppState.userEmail, modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok) {
      showToast('Hours saved');
      var modal = document.getElementById('drb-create-modal');
      if (modal) modal.remove();
      drLoadBillingCol();
    } else { showToast('Save failed'); }
  });
}

function drBillingEdit(entryId) {
  if (!Array.isArray(ReconcileState.hoursEntries)) ReconcileState.hoursEntries = [];
  sb.get('hours_entries', '?id=eq.'+entryId+'&select=*,work_orders(wo_number,title,status,customer_id)').then(function(r) {
    if (!r.ok || !r.data || !r.data.length) { showToast('Entry not found'); return; }
    var e = r.data[0];
    var existingIdx = ReconcileState.hoursEntries.findIndex(function(x){ return x.id === entryId; });
    if (existingIdx >= 0) ReconcileState.hoursEntries[existingIdx] = e;
    else ReconcileState.hoursEntries.push(e);
    var wo = e.work_orders;
    var preCustId = wo ? (wo.customer_id||'') : '';

    var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="drb-edit-modal">';
    html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:440px;max-width:90vw">';
    html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Edit hours entry</div>';
    html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">'+(wo?escHtml(wo.wo_number+' — '+wo.title):'')+'</div>';
    html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
    html += '<input id="drbe-hours" type="number" step="0.25" min="0.25" value="'+parseFloat(e.hours||0).toFixed(2)+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
    html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
    html += '<select id="drbe-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(e.hours_type_id)+'</select></div>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
    html += '<button onclick="document.getElementById(\'drb-edit-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
    html += '<button onclick="drBillingEditSave(\''+entryId+'\')" style="padding:7px 16px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
    html += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  });
}

function drBillingEditSave(entryId) {
  var hours = parseFloat((document.getElementById('drbe-hours')||{}).value||0);
  var htId = (document.getElementById('drbe-type')||{}).value;
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  sb.patch('hours_entries', entryId, { hours: hours, hours_type_id: htId||null, modified_by: AppState.userEmail, modified_at: new Date().toISOString() }).then(function(r) {
    if (r.ok) {
      showToast('Updated');
      var modal = document.getElementById('drb-edit-modal');
      if (modal) modal.remove();
      drLoadBillingCol();
    }
  });
}

function drBillingMove(entryId) {
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="drb-move-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:440px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:12px">Move to different WO</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Customer <span style="color:var(--text-muted)">(optional — filters WOs)</span></label>';
  html += '<select id="drbm-cust" onchange="rcFilterWOs(\'drbm\',this.value)" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcCustomerOptions('')+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Move to work order</label>';
  html += '<select id="drbm-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('', '')+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'drb-move-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="drBillingMoveSave(\''+entryId+'\')" style="padding:7px 16px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Move</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function drBillingMoveSave(entryId) {
  var newWoId = (document.getElementById('drbm-wo')||{}).value;
  if (!newWoId) { showToast('Select a work order'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === newWoId; });
  var tech = rcGetTechInfo();
  sb.patch('hours_entries', entryId, {
    work_order_id: newWoId, descriptor: rcDescriptor(wo, tech.name),
    modified_by: AppState.userEmail, modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      showToast('Moved to '+(wo?wo.wo_number:'WO'));
      var modal = document.getElementById('drb-move-modal');
      if (modal) modal.remove();
      drLoadBillingCol();
    }
  });
}

function drBillingAddTravel(stopIdx, driveMin) {
  var stop = DRState.stops[stopIdx];
  if (!stop) return;
  var travelThreshMin = parseInt(AppState.settings.billing_travel_threshold_min || '30');
  var suggestedH = parseFloat(Math.max(0.25, (driveMin - travelThreshMin) / 60).toFixed(2));
  if (driveMin <= travelThreshMin) suggestedH = parseFloat((driveMin / 60).toFixed(2));
  var locId = stop.location ? stop.location.id : null;
  var preCustId = stop.location ? (stop.location.customer_id||'') : '';

  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center" id="drb-travel-modal">';
  html += '<div style="background:var(--bg);border-radius:12px;padding:20px;width:440px;max-width:90vw">';
  html += '<div style="font-size:15px;font-weight:500;margin-bottom:4px">Add travel time</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">'+driveMin+'m drive — suggested billable: '+suggestedH+'h</div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours</label>';
  html += '<input id="drbt-hours" type="number" step="0.25" min="0.25" value="'+suggestedH+'" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)"></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Hours type</label>';
  html += '<select id="drbt-type" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcHoursTypeOptions(rcDefaultHoursTypeId())+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Customer <span style="color:var(--text-muted)">(optional — filters WOs)</span></label>';
  html += '<select id="drbt-cust" onchange="rcFilterWOs(\'drbt\',this.value)" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcCustomerOptions(preCustId)+'</select></div>';
  html += '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--text-secondary)">Work order</label>';
  html += '<select id="drbt-wo" style="display:block;width:100%;padding:6px 8px;border:.5px solid var(--border);border-radius:var(--radius);margin-top:3px;font-size:13px;background:var(--bg)">'+rcLiveWOOptions('', preCustId)+'</select></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button onclick="document.getElementById(\'drb-travel-modal\').remove()" style="padding:7px 16px;border:.5px solid var(--border);border-radius:var(--radius);background:var(--surface-1);cursor:pointer">Cancel</button>';
  html += '<button onclick="drBillingAddTravelSave(\''+locId+'\')" style="padding:7px 16px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:500">Save</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function drBillingAddTravelSave(locId) {
  var woId = (document.getElementById('drbt-wo')||{}).value;
  var hours = parseFloat((document.getElementById('drbt-hours')||{}).value||0);
  var htId = (document.getElementById('drbt-type')||{}).value;
  if (!woId) { showToast('Select a work order'); return; }
  if (!hours || hours <= 0) { showToast('Enter hours'); return; }
  var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
  var tech = rcGetTechInfo();
  sb.post('hours_entries', {
    work_order_id: woId, tech_id: tech.id, entry_date: DRState.selectedDate,
    hours_type_id: htId||null, hours: hours, billable: true, location_id: locId||null,
    descriptor: rcDescriptor(wo, tech.name), created_by: AppState.userEmail, modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok) {
      showToast('Travel time saved');
      var modal = document.getElementById('drb-travel-modal');
      if (modal) modal.remove();
      drLoadBillingCol();
    } else { showToast('Save failed'); }
  });
}

function renderExportsPanel() {
  var body = document.getElementById('export-history-panel-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Loading...</div>';
  sb.get('export_history','?select=*&order=exported_at.desc&limit=20').then(function(r) {
    if (!r.ok || !r.data || !r.data.length) { body.innerHTML='<div style="padding:30px;text-align:center;color:var(--text-muted)">No exports yet</div>'; return; }
    var latest = r.data[0];
    var sidebarEl = document.getElementById('sidebar-last-export');
    if (sidebarEl) sidebarEl.textContent = 'Last export: '+fmtDate(latest.exported_at);
    body.innerHTML = r.data.map(function(h) {
      var isActive = h.active !== false;
      var woIds = h.wo_ids || [];
      var html = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px;'+(isActive?'':'opacity:0.6;background:var(--bg)')+'">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<div><span style="font-size:13px;font-weight:600">'+fmtDateWithTime(h.exported_at)+'</span> <span style="font-size:12px;color:var(--text-muted)">'+h.wo_count+' WOs</span></div>';
      html += '<div style="display:flex;gap:6px">';
      if (isActive) {
        html += '<button style="font-size:11px;padding:3px 10px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="undoExportBatch(\''+h.id+'\','+JSON.stringify(woIds).replace(/"/g,"'")+')">Undo Batch</button>';
      } else {
        html += '<button style="font-size:11px;padding:3px 10px;border:1px solid var(--success);border-radius:3px;color:var(--success);background:none;cursor:pointer" onclick="restoreExportBatch(\''+h.id+'\','+JSON.stringify(woIds).replace(/"/g,"'")+')">Restore</button>';
        html += '<span style="font-size:11px;color:var(--text-muted);margin-left:4px">Undone</span>';
      }
      html += '</div></div>';
      woIds.forEach(function(woId) {
        var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
        var woNum = wo ? wo.wo_number : woId.substring(0,8)+'...';
        var woTitle = wo ? (wo.title||'') : '';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--border);font-size:12px">';
        html += '<span style="color:var(--header-bg);font-weight:600;white-space:nowrap">'+escHtml(woNum)+'</span>';
        html += '<span style="color:var(--text-muted);flex:1;margin:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(woTitle)+'</span>';
        if (isActive) html += '<button style="font-size:11px;padding:2px 8px;border:1px solid #e67e22;border-radius:3px;color:#e67e22;background:none;cursor:pointer;white-space:nowrap" onclick="unlockSingleWO(\''+woId+'\',\''+h.id+'\')">Unlock</button>';
        html += '</div>';
      });
      html += '</div>';
      return html;
    }).join('');
  });
}

function unlockSingleWO(woId, histId) {
  if (!confirm('Unlock this WO only? It will move back to Completed for re-export.')) return;
  var completedSt = AppState.statuses.find(function(s){ return s.category==='completed'; });
  var completedNum = completedSt ? completedSt.num : 10;
  sb.patch('work_orders', woId, {status: completedNum, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
      if (wo) wo.status = completedNum;
      renderDesktopGrid();
      renderExportsPanel();
      // Also refresh export review if open
      if (AppState._exportReviewWOs) {
        var wos = AppState._exportReviewWOs;
        showExportReview(wos);
      }
      showToast('WO unlocked for re-export');
    } else showToast('Error unlocking WO');
  });
}

function loadExportHistory() {
  sb.get('export_history','?select=exported_at&active=eq.true&order=exported_at.desc&limit=1').then(function(r) {
    var sidebarEl = document.getElementById('sidebar-last-export');
    if (sidebarEl && r.ok && r.data && r.data.length) {
      sidebarEl.textContent = 'Last export: '+fmtDate(r.data[0].exported_at);
    }
  });
}


function undoExportBatch(histId, woIds) {
  if (!confirm('Undo this export? All '+woIds.length+' WOs will move back to Completed.')) return;
  var completedSt = AppState.statuses.find(function(s){ return s.category==='completed'; });
  var completedNum = completedSt ? completedSt.num : 10;
  var done = 0;
  if (!woIds.length) { showToast('Nothing to undo'); return; }
  woIds.forEach(function(woId) {
    sb.patch('work_orders', woId, {status: completedNum, exported_at: null, exported_by: null, modified_by: AppState.userEmail}).then(function(){
      done++;
      if (done === woIds.length) {
        sb.patch('export_history', histId, {active: false, undone_at: new Date().toISOString(), undone_by: AppState.userEmail}).then(function(){
          woIds.forEach(function(id){ var w=AppState.workOrders.find(function(x){return x.id===id;}); if(w){w.status=completedNum;w.exported_at=null;} });
          renderDesktopGrid(); loadExportHistory();
          showToast('Export undone — '+woIds.length+' WOs moved back to Completed');
        });
      }
    });
  });
}

function restoreExportBatch(histId, woIds) {
  if (!confirm('Restore this export? WOs will be locked again.')) return;
  var procSt = AppState.statuses.find(function(s){ return s.category==='processed'; });
  var procNum = procSt ? procSt.num : 11;
  var done = 0;
  if (!woIds.length) { showToast('Nothing to restore'); return; }
  woIds.forEach(function(woId) {
    sb.patch('work_orders', woId, {status: procNum, modified_by: AppState.userEmail}).then(function(){
      done++;
      if (done === woIds.length) {
        sb.patch('export_history', histId, {active: true, undone_at: null, undone_by: null}).then(function(){
          woIds.forEach(function(id){ var w=AppState.workOrders.find(function(x){return x.id===id;}); if(w) w.status=procNum; });
          renderDesktopGrid(); loadExportHistory();
          showToast('Export restored — '+woIds.length+' WOs locked again');
        });
      }
    });
  });
}


// TRUCK STOCK
function initMobileTruckStock() {
  renderMobileTSList();
}

function renderMobileTSList() {
  var el = document.getElementById('screen-mobile-truckstock');
  if (!el) return;
  var tsWOs = AppState.workOrders.filter(function(w){ return w.title && w.title.indexOf('Truck Stock') === 0 && !w.customer_id; });
  var html = '<div style="padding:12px">';
  html += '<button onclick="createTruckStockWO()" style="width:100%;padding:12px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:500;cursor:pointer;margin-bottom:12px">+ New Truck Stock Entry</button>';
  if (!tsWOs.length) {
    html += '<div style="text-align:center;color:var(--text-muted);padding:40px 20px;font-size:13px">No truck stock entries yet.</div>';
  } else {
    tsWOs.forEach(function(wo) {
      html += '<div onclick="mobileOpenTSWO(\''+wo.id+'\')" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;cursor:pointer">';
      html += '<div style="font-size:13px;font-weight:600">'+escHtml(wo.wo_number)+'</div>';
      html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">'+escHtml(wo.title)+'</div>';
      html += '</div>';
    });
  }
  html += '</div>';
  el.innerHTML = html;
}

function mobileOpenTSWO(id) {
  var wo = AppState.workOrders.find(function(w){ return w.id === id; });
  if (!wo) return;
  AppState.currentWO = wo;
  AppState._isTruckStockEntry = true;
  sb.get('line_items', '?work_order_id=eq.'+id+'&active=eq.true&select=*,vendors(name),qbo_items(name)&order=transaction_date.desc').then(function(lR) {
    AppState.lineItems = lR.ok ? lR.data||[] : [];
    AppState.hoursEntries = [];
    AppState.quotedLines = [];
    openPartsList();
  });
}

function renderTruckStock() {
  var tsWOs = AppState.workOrders.filter(function(w){ return w.title&&w.title.indexOf('Truck Stock')===0&&!w.customer_id; });
  var el = document.getElementById('truck-stock-list'); if(!el) return;
  if(!tsWOs.length){el.innerHTML='<div class="empty-state"><div class="empty-state-icon">T</div><h3>No truck stock entries</h3></div>';return;}
  el.innerHTML = tsWOs.map(function(wo){
    return '<div class="entry-card entry-type-border-orange" style="margin:0 0 8px;cursor:pointer" onclick="openTSWO(\''+wo.id+'\')"><div class="entry-card-header"><div><strong>'+wo.wo_number+'</strong> <span style="font-size:13px;color:var(--text-muted)">'+escHtml(wo.title)+'</span></div><span class="badge" style="background:#f5d5a0">PO: '+wo.wo_number+'</span></div></div>';
  }).join('');
}

function openTSWO(id) {
  var wo = AppState.workOrders.find(function(w){ return w.id===id; }); if(!wo) return;
  AppState.currentWO = wo;
  AppState._isTruckStockEntry = true;
  sb.get('line_items','?work_order_id=eq.'+id+'&active=eq.true&select=*,vendors(name),qbo_items(name)&order=transaction_date.desc').then(function(lR){
    AppState.lineItems = lR.ok?lR.data||[]:[];
    AppState.hoursEntries=[]; AppState.quotedLines=[];
    // Show WO number prominently as PO reference
    var banner = document.getElementById('parts-wo-banner');
    if (banner) { banner.textContent = 'PO # ' + wo.wo_number + ' — ' + wo.title; banner.style.display = 'block'; }
    openPartsList();
  });
}

function _getUserFirstName() {
  var email = AppState.userEmail || '';
  if (email.indexOf('kevin') >= 0) return 'Kevin';
  if (email.indexOf('jadyn') >= 0) return 'Jadyn';
  return email.split('@')[0] || 'User';
}

function createTruckStockWO() {
  var today = new Date();
  var name = _getUserFirstName();
  var title = 'Truck Stock - '+name+' '+today.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  var existing = AppState.workOrders.find(function(w){ return w.title===title&&!w.customer_id; });
  if (existing) { openTSWO(existing.id); return; }
  var nextNum = parseInt(AppState.settings.wo_number_next||'26300');
  var prefix = AppState.settings.wo_number_prefix||'P';
  var woNum = prefix+nextNum;
  sb.patchWhere('settings','key=eq.wo_number_next',{value:String(nextNum+1)});
  AppState.settings.wo_number_next = String(nextNum+1);
  sb.post('work_orders',{wo_number:woNum,title:title,customer_id:null,customer_flag:false,form_mode:'time_materials',status:10,po_number:woNum,work_description:'Truck Stock',created_by:AppState.userEmail,modified_by:AppState.userEmail})
  .then(function(r){
    if(r.ok&&r.data&&r.data.length){
      loadWorkOrders().then(function(){
        AppState.currentWO = AppState.workOrders.find(function(w){return w.wo_number===woNum;})||r.data[0];
        AppState.hoursEntries=[]; AppState.lineItems=[]; AppState.quotedLines=[];
        AppState._isTruckStockEntry = true;
        showToast('Created '+woNum+' - use as PO with vendor');
        openPartsList();
      });
    } else showToast('Error creating truck stock WO');
  });
}

// CUSTOMER PANEL
function filterCustomerRows() {
  var q = ((document.getElementById('cust-panel-search')&&document.getElementById('cust-panel-search').value)||'').toLowerCase();
  var dispPref = AppState.settings.customer_display_preference || 'display_name';
  var customers = AppState.customers.filter(function(c){ return c.qbo_customer_id!=='SYSTEM'&&c.active!==false; })
    .filter(function(c){ return !q||c.name.toLowerCase().indexOf(q)>=0||(c.display_name||'').toLowerCase().indexOf(q)>=0; })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });
  var tbody = document.getElementById('cust-table-body'); if(!tbody) return;
  var countEl = document.getElementById('cust-count');
  var total = AppState.customers.filter(function(c){return c.qbo_customer_id!=='SYSTEM';}).length;
  if(countEl) countEl.textContent = customers.length+' of '+total;
  if(!customers.length){ tbody.innerHTML='<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--text-muted)">No customers found</td></tr>'; return; }
  tbody.innerHTML = customers.map(function(c){
    var por = c.po_required===true ? 'yes' : c.po_required===false ? 'no' : 'unknown';
    var porLabel = por==='yes'?'PO Req':por==='no'?'No PO':'? PO';
    var porBg = por==='yes'?'#c0392b22':por==='no'?'#27ae6022':'#e67e2222';
    var porColor = por==='yes'?'var(--danger)':por==='no'?'var(--success)':'#e67e22';
    var displayVal = dispPref==='name' ? escHtml(c.name) : escHtml(c.display_name||c.name);
    return '<tr style="border-bottom:1px solid var(--border)" id="cust-row-'+c.id+'">'
      +'<td style="padding:6px 10px;font-size:13px;color:var(--text-secondary)">'+escHtml(c.name)+'</td>'
      +'<td style="padding:6px 10px;font-weight:600">'+displayVal+'</td>'
      +'<td style="padding:6px 10px;font-size:13px;color:var(--text-secondary)">'+escHtml(c.email||'---')+'</td>'
      +'<td style="padding:6px 10px;font-size:13px;color:var(--text-secondary)">'+escHtml(c.phone||'---')+'</td>'
      +'<td style="padding:6px 10px"><button style="background:'+porBg+';color:'+porColor+';border:1px solid '+porColor+';border-radius:4px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer" onclick="cyclePORequired(this.getAttribute(\'data-cid\'),this.getAttribute(\'data-por\'))" data-cid="'+c.id+'" data-por="'+por+'">'+porLabel+'</button></td>'
      +'<td style="padding:6px 8px"><button style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer" data-cid2="'+c.id+'" onclick="editCustomerRow(this.getAttribute(\'data-cid2\'))">✎ Edit</button></td>'
      +'</tr>';
  }).join('');
}

// ── Vendors Panel ─────────────────────────────────────────────
var VendState = { search: '', sort: 'alpha', showInactive: false };

function renderVendorsPanel() {
  var el = document.getElementById('vendors-panel-inner');
  if (!el) return;
  VendState.search = '';
  VendState.sort = 'alpha';
  VendState.showInactive = false;
  var html = '<div style="display:flex;flex-direction:column;height:100%">';
  // Top bar
  html += '<div style="padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-shrink:0">';
  html += '<div style="font-size:15px;font-weight:700">Vendors</div>';
  html += '<input type="text" id="vend-search" placeholder="Search vendors..." oninput="vendApplyFilter(this.value)" style="flex:1;font-size:13px;padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">';
  html += '<select onchange="VendState.sort=this.value;vendRenderList()" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">';
  html += '<option value="alpha">A–Z</option><option value="recent">Recent</option></select>';
  html += '<label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" onchange="VendState.showInactive=this.checked;vendRenderList()"> Show inactive</label>';
  html += '<button onclick="vendStartAdd()" style="font-size:12px;padding:5px 12px;background:var(--header-bg);color:#fff;border:none;border-radius:var(--radius);cursor:pointer">+ Add vendor</button>';
  html += '</div>';
  // List
  html += '<div id="vend-list" style="flex:1;overflow-y:auto;padding:10px 16px"></div>';
  html += '</div>';
  el.innerHTML = html;
  vendRenderList();
}

function vendApplyFilter(q) {
  VendState.search = q;
  vendRenderList();
}

function vendRenderList() {
  var el = document.getElementById('vend-list');
  if (!el) return;
  var q = VendState.search.toLowerCase().trim();
  var vendors = AppState.vendors.filter(function(v) {
    if (!VendState.showInactive && v.active === false) return false;
    return !q || (v.name||'').toLowerCase().indexOf(q) >= 0;
  });
  if (VendState.sort === 'alpha') {
    vendors.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  } else {
    vendors.sort(function(a,b){ return new Date(b.created_at||0) - new Date(a.created_at||0); });
  }
  if (!vendors.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">' + (q ? 'No vendors match "'+escHtml(q)+'"' : 'No vendors yet') + '</div>';
    return;
  }
  var html = '';
  vendors.forEach(function(v) {
    var inactive = v.active === false;
    html += '<div onclick="vendSelectVendor(\'' + escHtml(v.id) + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;background:var(--surface);opacity:' + (inactive?'.5':'1') + '">';
    html += '<div style="width:32px;height:32px;border-radius:6px;background:#eaf3de;color:#3b6d11;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">V</div>';
    html += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">' + escHtml(v.name||'') + (inactive?' <span style="font-size:10px;color:var(--text-muted)">(inactive)</span>':'') + '</div>';
    if (v.address_street) html += '<div style="font-size:11px;color:var(--text-muted)">' + escHtml([v.address_street,v.city,v.state].filter(Boolean).join(', ')) + '</div>';
    html += '</div></div>';
  });
  el.innerHTML = html;
}

function vendSelectVendor(id) {
  var v = AppState.vendors.find(function(x){ return x.id === id; });
  if (!v) return;
  var name = prompt('Vendor name:', v.name||'');
  if (name === null) return;
  var makeInactive = v.active !== false ? confirm('Make this vendor inactive?') : confirm('Reactivate this vendor?');
  var updates = { name: name, active: makeInactive ? (v.active === false ? true : false) : v.active, modified_by: AppState.userEmail, modified_at: new Date().toISOString() };
  sb.patch('vendors', id, updates).then(function(r) {
    if (r.ok) {
      Object.assign(v, updates);
      vendRenderList();
      showToast('Vendor updated');
    } else showToast('Error updating vendor');
  });
}

function vendStartAdd() {
  var name = prompt('New vendor name:');
  if (!name || !name.trim()) return;
  // Duplicate check
  var q = name.toLowerCase().trim();
  var similar = AppState.vendors.filter(function(v){
    return v.active !== false && (v.name||'').toLowerCase().indexOf(q) >= 0 || q.indexOf((v.name||'').toLowerCase()) >= 0;
  });
  if (similar.length) {
    var names = similar.map(function(v){ return v.name; }).join(', ');
    if (!confirm('Similar vendor already exists: ' + names + '\n\nCreate anyway?')) return;
  }
  sb.post('vendors', { name: name.trim(), active: true, created_by: AppState.userEmail, modified_by: AppState.userEmail }).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      AppState.vendors.push(r.data[0]);
      vendRenderList();
      showToast('Vendor added');
    } else showToast('Error adding vendor');
  });
}

function renderCustomerPanel() {
  var panel = document.getElementById('desktop-panel-customers'); if(!panel) return;
  var total = AppState.customers.filter(function(c){ return c.qbo_customer_id!=='SYSTEM'; }).length;
  panel.innerHTML = '<div style="padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-shrink:0">'
    +'<input type="search" id="cust-panel-search" placeholder="Search customers..." oninput="filterCustomerRows()" style="max-width:300px">'
    +'<span id="cust-count" style="font-size:13px;color:var(--text-muted)">'+total+' total</span>'
    +'<button class="btn-dark" style="margin-left:auto" onclick="toggleCustDisplayPref()">'+((AppState.settings.customer_display_preference||'display_name')==='display_name'?'Showing: Display Name':'Showing: Account Name')+'</button>'
    +'<button class="btn-dark" onclick="openAddCustomerSheet()">+ Add Customer</button></div>'
    +'<div style="flex:1;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    +'<thead><tr>'
    +'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0">Full QBO Name</th>'
    +'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0">Display Name</th>'
    +'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0">Email</th>'
    +'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0">Phone</th>'
    +'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0">PO Req</th>'
    +'<th style="padding:6px 10px;background:var(--bg);border-bottom:2px solid var(--border);position:sticky;top:0"></th>'
    +'</tr></thead><tbody id="cust-table-body"></tbody></table></div>';
  filterCustomerRows();
}


function toggleCustDisplayPref() {
  var current = AppState.settings.customer_display_preference || 'display_name';
  var next = current === 'display_name' ? 'name' : 'display_name';
  AppState.settings.customer_display_preference = next;
  sb.patchWhere('settings','key=eq.customer_display_preference',{value:next}).then(function(){});
  renderCustomerPanel();
}

function editCustomerRow(custId) {
  var c = AppState.customers.find(function(x){ return x.id===custId; }); if(!c) return;
  var row = document.getElementById('cust-row-'+custId); if(!row) return;
  row.innerHTML = '<td colspan="5" style="padding:8px 10px">'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
    + '<input type="text" id="ce-name-'+custId+'" value="'+escHtml(c.name||'')+'" placeholder="Account name" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:160px">'
    + '<input type="text" id="ce-display-'+custId+'" value="'+escHtml(c.display_name||'')+'" placeholder="Display name" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:160px">'
    + '<input type="email" id="ce-email-'+custId+'" value="'+escHtml(c.email||'')+'" placeholder="Email" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:160px">'
    + '<input type="text" id="ce-phone-'+custId+'" value="'+escHtml(c.phone||'')+'" placeholder="Phone" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:120px">'
    + '<button class="btn-dark" style="font-size:12px;padding:4px 10px" onclick="saveCustomerEdit(\''+custId+'\')">Save</button>'
    + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer" onclick="renderCustomerPanel()">Cancel</button>'
    + '</div>'
    + '</td>'
    + '<td></td>';
}

function saveCustomerEdit(custId) {
  var name = (document.getElementById('ce-name-'+custId)||{}).value||'';
  var display = (document.getElementById('ce-display-'+custId)||{}).value||'';
  var email = (document.getElementById('ce-email-'+custId)||{}).value||'';
  var phone = (document.getElementById('ce-phone-'+custId)||{}).value||'';
  if (!name.trim()) { showToast('Name required'); return; }
  sb.patch('customers', custId, {name:name.trim(), display_name:display.trim()||null, email:email.trim()||null, phone:phone.trim()||null, modified_by:AppState.userEmail}).then(function(r){
    if (r.ok) {
      var c = AppState.customers.find(function(x){ return x.id===custId; });
      if (c) { c.name=name.trim(); c.display_name=display.trim()||null; c.email=email.trim()||null; c.phone=phone.trim()||null; }
      filterCustomerRows(); showToast('Customer updated');
    } else showToast('Error saving customer');
  });
}

function cyclePORequired(custId, current) {
  var next = current==='unknown' ? true : current==='yes' ? false : null;
  sb.patch('customers', custId, {po_required: next, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      var c = AppState.customers.find(function(c){ return c.id===custId; });
      if (c) c.po_required = next;
      filterCustomerRows();
      showToast(next===true?'PO Required set':next===false?'No PO set':'Reset to unknown');
    } else showToast('Error updating');
  });
}

function openAddCustomerSheet() { ['ac-name','ac-display','ac-email','ac-phone'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';}); document.getElementById('add-customer-sheet').classList.add('open'); }
function closeAddCustomerSheet(e) { if(!e||e.target===document.getElementById('add-customer-sheet')) document.getElementById('add-customer-sheet').classList.remove('open'); }
function saveNewCustomer() {
  var name=document.getElementById('ac-name').value.trim();
  var display=document.getElementById('ac-display').value.trim();
  var email=document.getElementById('ac-email').value.trim();
  var phone=document.getElementById('ac-phone').value.trim();
  if(!name){showToast('Full QBO name is required');return;}
  var displayName=display||(name.indexOf(':')>=0?name.split(':').pop().trim():name);
  if(AppState.customers.find(function(c){return c.name===name;})){showToast('Customer already exists');return;}
  sb.post('customers',{name:name,display_name:displayName,email:email||null,phone:phone||null,created_by:AppState.userEmail,modified_by:AppState.userEmail})
  .then(function(r){
    if(r.ok&&r.data&&r.data.length){AppState.customers=AppState.customers.concat(r.data);AppState.customers.sort(function(a,b){return a.name.localeCompare(b.name);});closeAddCustomerSheet();renderCustomerPanel();showToast('Customer added');}
    else showToast('Error saving customer');
  });
}

// SETTINGS
function deactivateStatus(id) {
  if (!confirm('Deactivate this status? It will be hidden from the status picker but historical WOs keep it.')) return;
  sb.patch('wo_statuses', id, {active: false}).then(function(r) {
    if (r.ok) {
      loadStatuses().then(function(){ renderSettings('settings-body-desktop'); showToast('Status deactivated'); });
    } else showToast('Error deactivating');
  });
}

function saveNewStatus() {
  var num = parseInt(document.getElementById('new-status-num').value);
  var name = (document.getElementById('new-status-name').value||'').trim();
  var cat = document.getElementById('new-status-cat').value;
  var color = document.getElementById('new-status-color').value;
  if (!num || !name) { showToast('Number and name required'); return; }
  // Auto-generate system_key — prefix with status_ if starts with digit
  var skey = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if (/^[0-9]/.test(skey)) skey = 'status_' + num;
  if (!skey) skey = 'status_' + num;
  sb.post('wo_statuses', {num:num, name:name, category:cat, color:color, system_key:skey, mobile:true, sort_order:num, active:true}).then(function(r){
    if (r.ok) {
      loadStatuses().then(function(){ renderSettings('settings-body-desktop'); showToast('Status added'); });
    } else {
      var errMsg = (r.data && (r.data.message||r.data.details||r.data.hint)) || 'Unknown error';
      showToast('Error: ' + errMsg);
    }
  });
}

function saveNewHoursType() {
  var name = (document.getElementById('new-ht-name')||{}).value||'';
  var zed = (document.getElementById('new-ht-zed')||{}).value||'';
  if (!name.trim()) { showToast('Name is required'); return; }
  var rateKey = 'rate_' + name.trim().toLowerCase().replace(/[^a-z0-9]/g,'_');
  sb.post('hours_types', {
    name: name.trim(),
    zed_axis_name: zed.trim() || null,
    internal_rate_key: rateKey,
    active: true,
    created_by: AppState.userEmail,
    modified_by: AppState.userEmail
  }).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      AppState.hoursTypes.push(r.data[0]);
      renderSettings('settings-body-desktop');
      showToast('Hours type added');
    } else showToast('Error adding hours type');
  });
}

function deactivateHoursType(id, name) {
  if (!confirm('Deactivate "' + name + '"? It will be hidden from entry forms but historical entries are preserved.')) return;
  sb.patch('hours_types', id, {active: false, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      AppState.hoursTypes = AppState.hoursTypes.filter(function(t){ return t.id !== id; });
      renderSettings('settings-body-desktop');
      showToast(name + ' deactivated');
    } else showToast('Error deactivating');
  });
}

function saveHoursTypeField(id, field, value) {
  var updates = {}; updates[field] = value;
  sb.patch('hours_types', id, updates).then(function(r) {
    if (r.ok) {
      var t = AppState.hoursTypes.find(function(t){ return t.id===id; });
      if (t) t[field] = value;
      showToast('Saved');
    } else showToast('Error saving');
  });
}

function saveHoursRate(rateKey, value) {
  if (!rateKey) return;
  sb.patchWhere('settings', 'key=eq.'+rateKey, {value: String(value)}).then(function(r) {
    if (r.ok) { AppState.settings[rateKey] = String(value); showToast('Rate saved'); }
    else showToast('Error saving rate');
  });
}

function deactivateWOFlag(id, name) {
  if (!confirm('Deactivate "'+name+'"? It will be hidden from WO detail and grid. Existing flagged WOs keep their flag data.')) return;
  sb.patch('wo_flags', id, {active: false}).then(function(r){
    if (r.ok) {
      AppState.woFlags = AppState.woFlags.filter(function(f){ return f.id!==id; });
      renderSettings('settings-body-desktop'); showToast(name+' deactivated');
    } else showToast('Error deactivating flag');
  });
}

function saveWOFlagField(id, field, value) {
  var updates = {};
  updates[field] = field==='blocks_export' ? !!value : value;
  sb.patch('wo_flags', id, updates).then(function(r) {
    if (r.ok) {
      var f = AppState.woFlags.find(function(f){ return f.id===id; });
      if (f) f[field] = updates[field];
      showToast('Flag updated');
    } else showToast('Error saving flag');
  });
}

function uploadCompanyLogo(input) {
  var file = input.files[0]; if (!file) return;
  showToast('Uploading...');
  var ext = file.name.split('.').pop();
  var path = 'logo.' + ext;
  var url = SUPABASE_URL + '/storage/v1/object/company-assets/' + path;
  fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + (AppState.session && AppState.session.access_token),
      'Content-Type': file.type,
      'x-upsert': 'true'
    },
    body: file
  }).then(function(r) {
    if (r.ok) {
      var publicUrl = SUPABASE_URL + '/storage/v1/object/public/company-assets/' + path;
      saveCompanySetting('company_logo_url', publicUrl);
      showToast('Logo uploaded');
    } else {
      r.text().then(function(t){ showToast('Upload failed: ' + t); });
    }
  }).catch(function(e){ showToast('Upload error'); });
  input.value = '';
}

function saveCompanySetting(key, value) {
  sb.patchWhere('settings', 'key=eq.'+key, {value: value}).then(function(r) {
    if (r.ok) {
      AppState.settings[key] = value;
      localStorage.setItem('dwo_'+key, value);
      showToast('Saved');
      applyCompanyBranding(
        localStorage.getItem('dwo_company_name'),
        localStorage.getItem('dwo_company_logo_url')
      );
      renderSettings('settings-body-desktop');
    } else showToast('Error saving');
  });
}

function saveStatusField(id, field, value) {
  var updates = {};
  updates[field] = field === 'mobile' ? !!value : value;
  sb.patch('wo_statuses', id, updates).then(function(r) {
    if (r.ok) {
      var s = AppState.statuses.find(function(s){ return s.id===id; });
      if (s) s[field] = updates[field];
      showToast('Status updated');
      // Reload statuses to keep getStatus in sync
      loadStatuses().then(function(){ renderSettings('settings-body-desktop'); });
    } else showToast('Error saving status');
  });
}

function deactivateTech(id, name) {
  if (!confirm('Deactivate '+name+'? They will be removed from all dropdowns but historical entries are preserved.')) return;
  sb.patch('technicians', id, {active: false}).then(function(r) {
    if (r.ok) {
      AppState.technicians = AppState.technicians.filter(function(t){ return t.id!==id; });
      renderSettings('settings-body-desktop'); showToast(name+' deactivated');
    } else showToast('Error deactivating');
  });
}

function addNewTech() {
  var name = (document.getElementById('new-tech-name').value||'').trim();
  var color = document.getElementById('new-tech-color').value;
  if (!name) { showToast('Name required'); return; }
  sb.post('technicians', {name: name, color: color, active: true}).then(function(r) {
    if (r.ok && r.data && r.data.length) {
      AppState.technicians.push(r.data[0]);
      AppState.technicians.sort(function(a,b){ return a.name.localeCompare(b.name); });
      renderSettings('settings-body-desktop'); showToast(name+' added');
    } else showToast('Error adding technician');
  });
}

function saveTechField(techId, field, value) {
  var updates = {};
  updates[field] = value || null;
  sb.patch('technicians', techId, updates).then(function(r) {
    if (r.ok) {
      var t = AppState.technicians.find(function(x){ return x.id===techId; });
      if (t) t[field] = value || null;
      showToast(field + ' saved');
    } else showToast('Error saving');
  });
}

function saveTechColor(techId, color) {
  sb.patch('technicians', techId, {color: color}).then(function(r) {
    if (r.ok) {
      var t = AppState.technicians.find(function(t){ return t.id===techId; });
      if (t) t.color = color;
      showToast('Color saved');
    } else showToast('Error saving color');
  });
}

// ==================== INVOICES PANEL ====================

function renderURIImportResult(invoices, imported) {
  var area = document.getElementById('uri-review-area'); if (!area) return;
  var html = '<div style="background:#27ae6018;border:1px solid var(--success);border-radius:var(--radius);padding:14px;margin-top:12px">';
  html += '<div style="font-size:14px;font-weight:600;color:var(--success);margin-bottom:10px">✓ Imported '+imported+' invoice'+(imported===1?'':'s')+'</div>';
  invoices.forEach(function(inv) {
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid #27ae6033">'
      + '<span style="font-size:13px">'+escHtml(inv.inv)+' → <strong>'+escHtml(inv._wo.wo_number)+'</strong> $'+inv.invoiceTotal.toFixed(2)+'</span>'
      + '<button style="font-size:11px;padding:3px 10px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" data-inv="'+escHtml(inv.inv)+'" data-woid="'+inv._wo.id+'" onclick="undoSingleImport(this)">Undo</button>'
      + '</div>';
  });
  html += '<div style="display:flex;gap:8px;margin-top:10px">'
    + '<button class="btn-dark" onclick="initInvoicesPanel()">Done</button>'
    + '<button style="font-size:13px;padding:7px 14px;border:1px solid var(--danger);border-radius:var(--radius);color:var(--danger);background:none;cursor:pointer" onclick="undoEntireBatch('+JSON.stringify(invoices.map(function(x){return {inv:x.inv,wo_id:x._wo.id};})).replace(/"/g,"'")+')">Undo Entire Batch</button>'
    + '</div>';
  html += '</div>';
  area.innerHTML = html;
}

function undoSingleImport(btn) {
  var invNum = btn.getAttribute('data-inv');
  var woId = btn.getAttribute('data-woid');
  if (!confirm('Undo import of invoice '+invNum+'? The line items will be soft-deleted and can be re-imported.')) return;
  sb.patchWhere('line_items', 'invoice_number=eq.'+invNum+'&work_order_id=eq.'+woId, {active: false, modified_by: AppState.userEmail}).then(function(r){
    if (r.ok) {
      btn.closest('div[style*="flex"]').style.opacity = '0.4';
      btn.textContent = 'Undone';
      btn.disabled = true;
      showToast('Invoice '+invNum+' undone');
    } else showToast('Error undoing');
  });
}

function undoEntireBatch(invList) {
  if (!confirm('Undo entire batch? All '+invList.length+' invoices will be soft-deleted and can be re-imported.')) return;
  var done = 0;
  invList.forEach(function(item) {
    sb.patchWhere('line_items', 'invoice_number=eq.'+item.inv+'&work_order_id=eq.'+item.wo_id, {active: false, modified_by: AppState.userEmail}).then(function(r){
      done++;
      if (done === invList.length) { showToast('Batch undone — '+invList.length+' invoices removed'); initInvoicesPanel(); }
    });
  });
}

function toggleHistoryExpand(id) {
  var el = document.getElementById(id); if (!el) return;
  var arrow = el.previousElementSibling && el.previousElementSibling.querySelector('span:last-child');
  if (el.style.display === 'none') {
    el.style.display = '';
    if (arrow) arrow.textContent = '▾';
  } else {
    el.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
  }
}

function undoSingleHistoryItem(invNum, woId, histId) {
  if (!confirm('Undo invoice '+invNum+'?')) return;
  sb.patchWhere('line_items', 'invoice_number=eq.'+invNum+'&work_order_id=eq.'+woId, {active: false, modified_by: AppState.userEmail}).then(function(r){
    if (r.ok) { showToast('Invoice '+invNum+' undone'); loadAndRenderImportHistory(); }
    else showToast('Error undoing');
  });
}

function loadAndRenderImportHistory() {
  var area = document.getElementById('uri-history-area'); if (!area) return;
  area.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Loading history...</div>';
  sb.get('vendor_import_history', '?order=imported_at.desc&limit=20').then(function(r){
    if (!r.ok || !r.data || !r.data.length) { area.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No import history yet.</div>'; return; }
    var html = '';
    r.data.forEach(function(h) {
      var invList = [];
      try { invList = JSON.parse(h.invoices||'[]'); } catch(e){}
      var isActive = h.active !== false;
      var histId = h.id;
      html += '<div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;'+(isActive?'':'opacity:0.5;background:var(--bg)')+'">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer" onclick="toggleHistoryExpand(\'hist-'+histId+'\')">'
        + '<div>'
        + '<span style="font-size:13px;font-weight:600">'+escHtml(h.vendor_name||'URI')+' — '+h.invoice_count+' invoice'+(h.invoice_count===1?'':'s')+' — $'+(parseFloat(h.total_cost||0)).toFixed(2)+'</span>'
        + '<span style="font-size:11px;color:var(--text-muted);margin-left:8px">'+fmtDate(h.imported_at)+'</span>'
        + '</div>'
        + '<div style="display:flex;gap:6px;align-items:center">'
        + (isActive
          ? '<button style="font-size:11px;padding:3px 10px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="event.stopPropagation();undoBatchFromHistory(\''+histId+'\','+JSON.stringify(invList).replace(/"/g,"'")+')">Undo</button>'
          : '<button style="font-size:11px;padding:3px 10px;border:1px solid var(--success);border-radius:3px;color:var(--success);background:none;cursor:pointer" onclick="event.stopPropagation();restoreBatchFromHistory(\''+histId+'\','+JSON.stringify(invList).replace(/"/g,"'")+')">Restore</button>')
        + '<span style="font-size:12px;color:var(--text-muted)">▸</span>'
        + '</div></div>'
        + '<div id="hist-'+histId+'" style="display:none;border-top:1px solid var(--border);padding:8px 12px">'
        + invList.map(function(item){
            return '<div style="padding:5px 0;border-bottom:0.5px solid var(--border);font-size:12px">'
              + '<div style="display:flex;align-items:center;justify-content:space-between">'
              + '<span><strong>'+escHtml(item.inv)+'</strong> → <span style="color:var(--header-bg)">'+escHtml(item.wo_number||'')+'</span></span>'
              + (isActive ? '<button style="font-size:10px;padding:2px 7px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="undoSingleHistoryItem(\''+item.inv+'\',\''+item.wo_id+'\',\''+histId+'\')">Undo</button>' : '')
              + '</div>'
              + (item.description ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+escHtml(item.description)+'</div>' : '')
              + '</div>';
          }).join('')
        + '</div>'
        + '</div>';
    });
    area.innerHTML = html;
  });
}

function undoBatchFromHistory(histId, invList) {
  if (!confirm('Undo this import batch? Line items will be soft-deleted.')) return;
  var done = 0;
  if (!invList.length) { showToast('Nothing to undo'); return; }
  invList.forEach(function(item) {
    sb.patchWhere('line_items', 'invoice_number=eq.'+item.inv+'&work_order_id=eq.'+item.wo_id, {active: false, modified_by: AppState.userEmail}).then(function(){
      done++;
      if (done===invList.length) {
        sb.patch('vendor_import_history', histId, {active: false}).then(function(){ loadAndRenderImportHistory(); showToast('Batch undone'); });
      }
    });
  });
}

function restoreBatchFromHistory(histId, invList) {
  if (!confirm('Restore this import batch? Line items will be re-activated.')) return;
  var done = 0;
  if (!invList.length) { showToast('Nothing to restore'); return; }
  invList.forEach(function(item) {
    sb.patchWhere('line_items', 'invoice_number=eq.'+item.inv+'&work_order_id=eq.'+item.wo_id, {active: true, modified_by: AppState.userEmail}).then(function(){
      done++;
      if (done===invList.length) {
        sb.patch('vendor_import_history', histId, {active: true}).then(function(){ loadAndRenderImportHistory(); showToast('Batch restored'); });
      }
    });
  });
}

function initInvoicesPanel() {
  var el = document.getElementById('invoices-panel-body');
  if (!el) return;
  var woCount = AppState.workOrders ? AppState.workOrders.length : 0;
  el.innerHTML = '<div style="padding:20px 0">'
    + '<h3 style="font-size:15px;font-weight:600;margin-bottom:4px">Vendor Invoice Import</h3>'
    + '<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Import a United Refrigeration CSV invoice file. Each line item will be matched to a work order by PO number.</p>'
    + '<label style="display:inline-flex;align-items:center;gap:8px;background:var(--header-bg);color:#fff;padding:10px 18px;border-radius:var(--radius);cursor:pointer;font-size:13px;font-weight:600">'
    + '📄 Upload URI CSV'
    + '<input type="file" accept=".csv" style="display:none" onchange="importURICSV(this)">'
    + '</label>'
    + '<span style="margin-left:12px;font-size:12px;color:var(--text-muted)">'+woCount+' work orders loaded</span>'
    + '</div>'
    + '<div id="uri-review-area"></div>'
    + '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">'
    + '<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-secondary)">Import History</div>'
    + '<div id="uri-history-area"></div>'
    + '</div>';
  loadAndRenderImportHistory();
}

function importURICSV(input) {
  var file = input.files[0]; if (!file) return;
  showToast('Reading CSV...');
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    var parsed = parseURICSV(text);
    if (!parsed.length) { showToast('No line items found in CSV'); return; }
    checkURIDuplicatesAndRender(parsed);
  };
  reader.readAsText(file);
  input.value = '';
}

function parseURICSV(text) {
  // Parse CSV respecting quoted fields
  function parseCSVLine(line) {
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
      else { cur += c; }
    }
    result.push(cur);
    return result;
  }
  var lines = text.split('\n').map(function(l){ return l.replace(/\r$/,''); }).filter(function(l){ return l.trim(); });
  if (!lines.length) return [];
  var headers = parseCSVLine(lines[0]);
  var rows = lines.slice(1).map(function(l){ 
    var vals = parseCSVLine(l);
    var obj = {};
    headers.forEach(function(h,i){ obj[h] = (vals[i]||'').trim(); });
    return obj;
  });

  // Group by invoice, extract line items
  var invoices = {};
  var lastLineKey = null;

  rows.forEach(function(row) {
    var inv = row['INVOICE_NUMBER'];
    var line = row['LINE_COL'];
    var descCol = row['DESC_COL'];
    var desc2 = row['DESC2_COL'];
    var qtyShip = row['QTY_SHIP_COL'];
    var unitPrice = row['ITEM_UNIT_PRICE_COL'];
    var netAmt = row['NET_AMOUNT_COL'];
    var invTotalDesc = row['INVOICE_TOTAL_DESC_COL'];
    var po = row['PO_NUMBER'].toUpperCase().trim();
    var invDate = row['INVOICE_DATE'];
    var totalDue = row['TOTAL_DUE'];

    if (!inv) return;
    if (!invoices[inv]) invoices[inv] = { inv: inv, po: po, date: invDate, total: totalDue, lines: [], freight: null };

    // Freight line
    if (invTotalDesc === 'Freight In' && netAmt && parseFloat(netAmt) > 0) {
      invoices[inv].freight = parseFloat(netAmt);
    }

    // Part number row: has numeric LINE_COL and non-empty DESC_COL
    if (line && /^\d+$/.test(line) && descCol) {
      var lineItem = { line: line, part: descCol, qty: parseFloat(qtyShip)||1, unitPrice: parseFloat(unitPrice)||0, netAmount: parseFloat(netAmt)||0, description: '' };
      invoices[inv].lines.push(lineItem);
      lastLineKey = { inv: inv, idx: invoices[inv].lines.length - 1 };
    }
    // Description row: no LINE_COL, no DESC_COL, but DESC2_COL has text
    else if (lastLineKey && lastLineKey.inv === inv && desc2 && !line && !descCol) {
      var d = desc2.trim();
      // Skip serial numbers, superseded notes, boilerplate
      if (!d.startsWith('Serial') && !d.startsWith('Superseded') && !d.startsWith('    ') && !d.startsWith('****')) {
        var existing = invoices[inv].lines[lastLineKey.idx].description;
        if (!existing) invoices[inv].lines[lastLineKey.idx].description = d;
      }
      lastLineKey = null;
    } else {
      lastLineKey = null;
    }
  });

  // Flatten to array of line items, add freight as separate item
  var result = [];
  Object.keys(invoices).forEach(function(invNum) {
    var inv = invoices[invNum];
    inv.lines.forEach(function(l) {
      result.push({ inv: invNum, po: inv.po, date: inv.date, invoiceTotal: inv.total,
        part: l.part, description: l.description, qty: l.qty,
        unitPrice: l.unitPrice, netAmount: l.netAmount });
    });
    if (inv.freight) {
      result.push({ inv: invNum, po: inv.po, date: inv.date, invoiceTotal: inv.total,
        part: 'FREIGHT', description: 'Freight', qty: 1,
        unitPrice: inv.freight, netAmount: inv.freight });
    }
  });
  return result;
}

function checkURIDuplicatesAndRender(items) {
  // Check existing line_items for duplicate invoice+amount combos
  var invNums = [...new Set(items.map(function(i){ return i.inv; }))];
  var qStr = '?invoice_number=in.('+invNums.join(',')+')'+'&active=eq.true&select=invoice_number,cost';
  sb.get('line_items', qStr).then(function(r) {
    var existing = r.ok ? (r.data||[]) : [];
    // Build duplicate set: "invoiceNum|amount"
    var dupSet = {};
    existing.forEach(function(e){ dupSet[e.invoice_number||''] = true; });

    var margin = parseFloat(AppState.settings.default_margin||0.5);
    var uriVendor = AppState.vendors.find(function(v){ return v.name && v.name.toLowerCase().indexOf('united refrigeration')>=0; });

    // Group by invoice number, one line item per invoice
    var invGroups = {};
    items.forEach(function(item) {
      if (!invGroups[item.inv]) invGroups[item.inv] = { inv: item.inv, po: item.po, date: item.date, invoiceTotal: parseFloat(item.invoiceTotal||0), lines: [] };
      invGroups[item.inv].lines.push(item);
    });

    var matched = [], unmatched = [], dupes = [];
    Object.keys(invGroups).forEach(function(invNum) {
      var grp = invGroups[invNum];
      // Build display detail from all lines
      var detail = grp.lines.filter(function(l){ return l.part && l.part !== 'FREIGHT'; }).map(function(l){ return l.part + (l.description ? ' - ' + l.description : ''); }).join('; ');
      var rep = { inv: invNum, po: grp.po, date: grp.date, invoiceTotal: grp.invoiceTotal, detail: detail, _margin: margin, _vendorId: uriVendor ? uriVendor.id : null };
      if (dupSet[invNum]) { dupes.push(rep); return; }
      var po = grp.po.toUpperCase();
      var wo = AppState.workOrders.find(function(w){ return w.wo_number && w.wo_number.toUpperCase()===po; });
      if (wo) { rep._wo = wo; matched.push(rep); }
      else { unmatched.push(rep); }
    });

    AppState._uriMatched = matched;
    AppState._uriUnmatched = unmatched;
    AppState._uriDupes = dupes;
    renderURIReview();
  });
}

function renderURIReview() {
  var matched = AppState._uriMatched || [];
  var unmatched = AppState._uriUnmatched || [];
  var dupes = AppState._uriDupes || [];
  var area = document.getElementById('uri-review-area'); if (!area) return;
  var uriVendor = AppState.vendors.find(function(v){ return v.name && v.name.toLowerCase().indexOf('united refrigeration')>=0; });

  var html = '<div style="border-top:2px solid var(--border);padding-top:12px">';
  html += '<div style="display:flex;gap:16px;margin-bottom:12px;align-items:center">';
  html += '<span style="font-size:13px"><strong style="color:var(--success)">'+matched.length+'</strong> matched</span>';
  html += '<span style="font-size:13px"><strong style="color:var(--danger)">'+unmatched.length+'</strong> unmatched</span>';
  html += '<span style="font-size:13px"><strong style="color:var(--text-muted)">'+dupes.length+'</strong> already imported</span>';
  html += '</div>';

  // Combined table for all items
  var allItems = matched.map(function(i,idx){ return {item:i,idx:idx,type:'matched'}; })
    .concat(unmatched.map(function(i,idx){ return {item:i,idx:idx,type:'unmatched'}; }));

  if (allItems.length) {
    html += '<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<thead><tr style="background:var(--bg);border-bottom:2px solid var(--border)">'
      + '<th style="padding:5px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase;white-space:nowrap">WO #</th>'
      + '<th style="padding:5px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase">WO Title</th>'
      + '<th style="padding:5px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase;white-space:nowrap">Invoice #</th>'
      + '<th style="padding:5px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase">Items</th>'
      + '<th style="padding:5px 8px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase">Description</th>'
      + '<th style="padding:5px 8px;text-align:right;color:var(--text-muted);font-size:10px;text-transform:uppercase;white-space:nowrap">Cost</th>'
      + '<th style="padding:5px 8px;text-align:right;color:var(--text-muted);font-size:10px;text-transform:uppercase;white-space:nowrap">Sell</th>'
      + '</tr></thead><tbody>';

    allItems.forEach(function(row) {
      var item = row.item;
      var isUnmatched = row.type === 'unmatched';
      var sell = item.invoiceTotal / (1 - item._margin);
      var bgColor = isUnmatched ? '#c0392b08' : '#27ae6008';
      var borderColor = isUnmatched ? '#c0392b44' : '#27ae6044';
      var woNum = isUnmatched ? '—' : (item._wo ? item._wo.wo_number : '—');
      var woTitle = isUnmatched ? '' : (item._wo ? (item._wo.title||'') : '');
      var idx = row.idx;

      html += '<tr style="border-bottom:1px solid var(--border);background:'+bgColor+'">';
      // WO # cell — editable for unmatched
      if (isUnmatched) {
        html += '<td style="padding:4px 6px;border-right:1px solid '+borderColor+'">'
          + '<input type="text" id="um-search-'+idx+'" placeholder="Search WO..." oninput="onURIWOSearch(this.value,'+idx+')" style="width:100px;font-size:11px;padding:2px 4px;border:1px solid var(--danger);border-radius:3px">'
          + '<input type="hidden" id="um-wo-'+idx+'">'
          + '<div id="um-wo-list-'+idx+'" style="position:absolute;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:3px;min-width:200px"></div>'
          + '</td>'
          + '<td style="padding:4px 6px;border-right:1px solid '+borderColor+';font-size:11px;color:var(--danger)" id="um-title-'+idx+'">PO '+escHtml(item.po)+' not found</td>';
      } else {
        html += '<td style="padding:4px 6px;border-right:1px solid '+borderColor+';font-weight:600;color:var(--header-bg)">'+escHtml(woNum)+'</td>'
          + '<td style="padding:4px 6px;border-right:1px solid '+borderColor+';color:var(--text-secondary);font-size:11px">'+escHtml(woTitle)+'</td>';
      }
      html += '<td style="padding:4px 6px;border-right:1px solid '+borderColor+';white-space:nowrap">'+escHtml(item.inv)+'</td>'
        + '<td style="padding:4px 6px;border-right:1px solid '+borderColor+';font-size:10px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(item.detail||'')+'">'+escHtml(item.detail||'—')+'</td>'
        + '<td style="padding:4px 6px;border-right:1px solid '+borderColor+'"><input type="text" id="uri-desc-'+row.type+'-'+idx+'" value="'+escHtml(item.detail||'')+'" placeholder="Description for QBO..." style="width:150px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px" oninput="updateURIDesc(this.getAttribute(\'data-ut\'),this.getAttribute(\'data-ui\'),this.value)" data-ut="'+row.type+'" data-ui="'+idx+'"></td>'
        + '<td style="padding:4px 6px;text-align:right;white-space:nowrap;border-right:1px solid '+borderColor+'">$'+item.invoiceTotal.toFixed(2)+'</td>'
        + '<td style="padding:4px 6px;text-align:right;white-space:nowrap">$'+sell.toFixed(2)+'</td>'
        + '</tr>';
    });

    html += '</tbody></table></div>';
  }

  // Dupes
  if (dupes.length) {
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Already imported (skipped): '
      + dupes.map(function(d){ return escHtml(d.inv); }).join(', ')
      + '</div>';
  }

  // Confirm button
  var assignedCount = unmatched.filter(function(i){ return i._assignedWO && !i._skip; }).length;
  var total = matched.length + assignedCount;
  if (total > 0) {
    html += '<button class="btn-dark uri-confirm-btn" style="font-size:14px;padding:12px 24px" onclick="confirmURIImport()">Import '+total+' invoice'+(total===1?'':'s')+'</button>';
  }

  html += '</div>';
  area.innerHTML = html;
}

function onURIWOSearch(val, idx) {
  var listEl = document.getElementById('um-wo-list-'+idx);
  if (!listEl) return;
  var q = (val||'').trim();
  if (!q) { listEl.innerHTML = ''; return; }

  // Search in-memory first
  var memMatches = AppState.workOrders.filter(function(w) {
    return w.wo_number.toUpperCase().indexOf(q.toUpperCase()) === 0 ||
           (w.title||'').toUpperCase().indexOf(q.toUpperCase()) >= 0;
  }).slice(0, 8);

  function renderList(wos) {
    if (!wos.length) {
      listEl.innerHTML = '<div style="padding:6px 8px;font-size:11px;color:var(--text-muted)">No match found</div>';
      return;
    }
    var html = '';
    wos.forEach(function(wo) {
      html += '<div onclick="onURIWOSelect('+idx+',\''+wo.id+'\',\''+escHtml(wo.wo_number)+'\',\''+escHtml((wo.title||'').replace(/'/g,"\\\'"))+'\')" '
        + 'style="padding:5px 8px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" '
        + 'onmouseover="this.style.background=\'var(--surface-1)\'" onmouseout="this.style.background=\'\'">'
        + '<strong>' + escHtml(wo.wo_number) + '</strong> — ' + escHtml(wo.title||'') + '</div>';
    });
    listEl.innerHTML = html;
  }

  if (memMatches.length) {
    renderList(memMatches);
  } else {
    // Fall back to direct Supabase query
    sb.get('work_orders', '?wo_number=ilike.'+encodeURIComponent(q+'%')+'&select=id,wo_number,title,status&limit=8').then(function(r) {
      if (r.ok && r.data && r.data.length) {
        renderList(r.data);
      } else {
        listEl.innerHTML = '<div style="padding:6px 8px;font-size:11px;color:var(--text-muted)">No WO found for "'+escHtml(q)+'"</div>';
      }
    });
  }
}

function onURIWOSelect(idx, woId, woNumber, woTitle) {
  var searchEl = document.getElementById('um-search-'+idx);
  var hiddenEl = document.getElementById('um-wo-'+idx);
  var titleEl = document.getElementById('um-title-'+idx);
  var listEl = document.getElementById('um-wo-list-'+idx);

  if (searchEl) { searchEl.value = woNumber; searchEl.style.borderColor = 'var(--border)'; }
  if (hiddenEl) hiddenEl.value = woId;
  if (listEl) listEl.innerHTML = '';
  if (titleEl) { titleEl.textContent = woTitle; titleEl.style.color = 'var(--text-secondary)'; }

  // Assign to the unmatched item
  var unmatched = AppState._uriUnmatched || [];
  if (unmatched[idx]) {
    // Find WO in memory or create minimal object
    var wo = AppState.workOrders.find(function(w){ return w.id === woId; });
    if (!wo) wo = { id: woId, wo_number: woNumber, title: woTitle };
    unmatched[idx]._assignedWO = wo;
  }

  // Re-render import button count
  var assigned = unmatched.filter(function(i){ return i._assignedWO && !i._skip; }).length;
  var matched = (AppState._uriMatched||[]).length;
  var total = matched + assigned;
  var btn = document.querySelector('.uri-confirm-btn');
  if (btn) btn.textContent = 'Import '+total+' invoice'+(total===1?'':'s');
}

function updateURIDesc(type, idx, value) {
  var i = parseInt(idx);
  if (type === 'matched') { if (AppState._uriMatched[i]) AppState._uriMatched[i]._desc = value; }
  else { if (AppState._uriUnmatched[i]) AppState._uriUnmatched[i]._desc = value; }
}

function renderURIReviewConfirmBtn() {
  var matched = (AppState._uriMatched||[]).length;
  var assignedUnmatched = (AppState._uriUnmatched||[]).filter(function(i){ return i._assignedWO && !i._skip; }).length;
  var total = matched + assignedUnmatched;
  var area = document.getElementById('uri-review-area'); if (!area) return;
  var btn = area.querySelector('.uri-confirm-btn');
  if (btn) btn.textContent = 'Import '+total+' items';
}

function confirmURIImport() {
  var matched = (AppState._uriMatched||[]);
  var assigned = (AppState._uriUnmatched||[]).filter(function(i){ return i._assignedWO && !i._skip; }).map(function(i){
    return Object.assign({}, i, { _wo: i._assignedWO });
  });
  var allItems = matched.concat(assigned);
  if (!allItems.length) { showToast('Nothing to import'); return; }

  showToast('Importing '+allItems.length+' items...');
  var imported = 0;
  var uriVendor = AppState.vendors.find(function(v){ return v.name && v.name.toLowerCase().indexOf('united refrigeration')>=0; });
  var partsQBOItem = AppState.qboItems.find(function(q){ return q.name && q.name.toLowerCase()==='parts'; });

  // Group allItems by invoice number — one line_item per invoice
  var invoiceGroups = {};
  allItems.forEach(function(item) {
    if (!invoiceGroups[item.inv]) {
      invoiceGroups[item.inv] = { inv: item.inv, po: item.po, date: item.date,
        invoiceTotal: parseFloat(item.invoiceTotal||0), _wo: item._wo,
        _margin: item._margin, _vendorId: item._vendorId,
        parts: [] };
    }
    // Descriptor: part number + description
    var partStr = (item.part||'') + (item.description ? ' — ' + item.description : '');
    if (partStr.trim()) invoiceGroups[item.inv].parts.push(partStr);
  });
  var invoices = Object.keys(invoiceGroups).map(function(k){ return invoiceGroups[k]; });

  function doInvoice(i) {
    if (i >= invoices.length) {
      showToast('Imported ' + imported + ' invoice' + (imported===1?'':'s'));
      // Save import history
      var historyRecord = {
        imported_by: AppState.userEmail,
        vendor_name: uriVendor ? uriVendor.name : 'United Refrigeration',
        invoice_count: imported,
        invoices: JSON.stringify(invoices.map(function(x){ return {inv:x.inv, wo_id:x._wo.id, wo_number:x._wo.wo_number, description:(x._desc||(x.parts||[]).join('; ')||'')}; }))
      };
        invoices: JSON.stringify(invoices.map(function(x){ return {inv:x.inv, wo_id:x._wo.id, wo_number:x._wo.wo_number, description:(x._desc||x.parts.join('; ')||'')}; }))
      sb.post('vendor_import_history', historyRecord).then(function(){});
      AppState._uriMatched = []; AppState._uriUnmatched = []; AppState._uriDupes = [];
      // Show undo screen
      renderURIImportResult(invoices, imported);
      // Check for needs_paperwork flags
      var affectedWOs = invoices.map(function(x){ return x._wo.id; }).filter(function(v,i,a){ return a.indexOf(v)===i; });
      var woWithFlag = affectedWOs.filter(function(id){
        var wo = AppState.workOrders.find(function(w){ return w.id===id; });
        return wo && wo.flag_needs_paperwork;
      });
      if (woWithFlag.length) { renderURIPostImport(woWithFlag); }
      return;
    }
    var inv = invoices[i];
    var wo = inv._wo;
    var margin = inv._margin || parseFloat(AppState.settings.default_margin||0.5);
    var cost = inv.invoiceTotal;
    var sell = cost / (1 - margin);
    // description = line item parts detail; descriptor = invoice reference
    var partsDetail = inv.parts.join('; ');
    var editedDesc = inv._desc !== undefined ? inv._desc : partsDetail;
    var description = editedDesc || partsDetail || 'URI Invoice ' + inv.inv;
    var descriptor = buildDescriptor(wo, inv.inv, description);

    var dateParts = (inv.date||'').split('/');
    var entryDate = dateParts.length===3
      ? '20'+dateParts[2]+'-'+dateParts[0].padStart(2,'0')+'-'+dateParts[1].padStart(2,'0')
      : todayStr();

    sb.post('line_items', {
      work_order_id: wo.id,
      customer_id: wo.customer_id,
      transaction_type: 'vendor_bill',
      transaction_date: entryDate,
      vendor_id: uriVendor ? uriVendor.id : null,
      invoice_number: inv.inv,
      qbo_item_id: partsQBOItem ? partsQBOItem.id : null,
      description: description,
      qty: 1,
      cost: cost,
      margin: margin,
      sell_each: sell,
      sell_total: sell,
      billable: true,
      descriptor: descriptor,
      created_by: AppState.userEmail,
      modified_by: AppState.userEmail
    }).then(function(r) {
      if (r.ok) imported++;
      else console.log('Invoice post failed:', inv.inv, r);
      doInvoice(i+1);
    });
  }
  doInvoice(0);
}

function renderURIPostImport(woIds) {
  var area = document.getElementById('uri-review-area'); if (!area) return;
  var html = '<div style="background:#e67e2218;border:1px solid #e67e22;border-radius:var(--radius);padding:16px;margin-top:16px">';
  html += '<div style="font-size:14px;font-weight:700;color:#e67e22;margin-bottom:10px">⚑ Paperwork flags on affected WOs — clear now?</div>';
  woIds.forEach(function(woId) {
    var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
    if (!wo || !wo.flag_needs_paperwork) return;
    var cust = getCustName(wo.customers)||'';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e67e2233">'
      + '<span style="font-size:13px"><strong>'+wo.wo_number+'</strong> '+escHtml(cust)+' — '+escHtml(wo.title||'')+'</span>'
      + '<div style="display:flex;gap:6px">'
      + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--success);border-radius:3px;background:#27ae6022;color:var(--success);cursor:pointer" onclick="clearURIPaperworkFlag(\''+woId+'\',this)">Yes — clear flag</button>'
      + '<button style="font-size:12px;padding:4px 10px;border:1px solid var(--text-muted);border-radius:3px;color:var(--text-muted);cursor:pointer" onclick="this.closest(\'div[style]\').remove()">Leave flag</button>'
      + '</div>'
      + '</div>';
  });
  html += '<button class="btn-dark" style="margin-top:12px;font-size:13px;padding:8px 16px" onclick="initInvoicesPanel()">Done</button>';
  html += '</div>';
  area.innerHTML = html;
}

function clearURIPaperworkFlag(woId, btn) {
  sb.patch('work_orders', woId, {flag_needs_paperwork: false, flag_needs_paperwork_note: null, modified_by: AppState.userEmail}).then(function(r) {
    if (r.ok) {
      var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
      if (wo) { wo.flag_needs_paperwork=false; wo.flag_needs_paperwork_note=null; }
      var row = btn ? btn.closest('div[style*="flex"]') : null;
      if (row) { row.innerHTML = '<span style="font-size:12px;color:var(--success)">✓ Flag cleared</span>'; }
      showToast('Paperwork flag cleared');
    } else showToast('Error clearing flag');
  });
}

// ==================== END INVOICES PANEL ====================

function renderSettings(containerId) {
  var el = document.getElementById(containerId); if(!el) return;
  var activeTab = localStorage.getItem('dwo_settings_tab') || 'general';
  var defaultTechId = localStorage.getItem('dwo_default_tech') || '';
  var tabs = [{id:'general',label:'General'},{id:'workorders',label:'Work Orders'},{id:'billing',label:'Billing'},{id:'locations',label:'Locations'},{id:'gps',label:'GPS'},{id:'data',label:'Data'},{id:'system',label:'System'}];
  var html = '<div class="settings-tab-bar">';
  tabs.forEach(function(t){ html += '<div class="settings-tab'+(t.id===activeTab?' active':'')+'" onclick="switchSettingsTab(\''+t.id+'\')">'+t.label+'</div>'; });
  html += '</div>';

  // GENERAL
  html += '<div class="settings-tab-content'+(activeTab==='general'?' active':'')+'" id="stab-general">';
  var bRows=[['rate_hours','Rate - Hours ($/hr)'],['rate_hour_helper','Rate - Hour-Helper ($/hr)'],['rate_hour_overtime','Rate - Hour-Overtime ($/hr)'],['default_margin','Default Margin']];
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Business Rules</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  bRows.forEach(function(r){ html += '<div class="settings-row"><div class="settings-row-label">'+r[1]+'</div><input class="settings-row-input" type="number" step="0.01" value="'+(AppState.settings[r[0]]||'')+'" onchange="saveSetting(\''+r[0]+'\',this.value)"></div>'; });
  html += '<div class="settings-row"><div class="settings-row-label">Next WO Number</div><input class="settings-row-input" type="number" value="'+(AppState.settings.wo_number_next||'')+'" onchange="saveSetting(\'wo_number_next\',this.value)"></div>';
  html += '<div class="settings-row"><div class="settings-row-label">Team Member Default</div><input class="settings-row-input" type="text" value="'+(AppState.settings.team_member_default||'')+'" onchange="saveSetting(\'team_member_default\',this.value)"></div>';
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Default Technician (this device)</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">Pre-selected when adding hours on this device.</div>';
  html += '<select onchange="setDefaultTech(this.value)" style="width:100%"><option value="">-- No default --</option>';
  AppState.technicians.forEach(function(t){ html += '<option value="'+t.id+'"'+(t.id===defaultTechId?' selected':'')+'>'+escHtml(t.name)+'</option>'; });
  html += '</select></div></div>';
  if(AppState.userRole==='admin'){
    html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Company</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
    html += '<div class="form-row"><label class="form-label">Company Name</label><input type="text" id="s-company-name" value="'+escHtml(AppState.settings.company_name||'')+'" placeholder="Your company name" style="max-width:300px" onblur="saveCompanySetting(\'company_name\',this.value)"></div>';
    html += '<div class="form-row"><label class="form-label">Logo</label>';
    if(AppState.settings.company_logo_url){ html += '<div style="display:flex;align-items:center;gap:12px"><img src="'+escHtml(AppState.settings.company_logo_url)+'" style="height:48px;border-radius:6px;border:1px solid var(--border)"><button style="font-size:12px;padding:4px 10px;border:1px solid var(--danger);border-radius:var(--radius-sm);color:var(--danger);background:none;cursor:pointer" onclick="saveCompanySetting(\'company_logo_url\',\'\')">Remove</button></div><br>'; }
    html += '<label style="display:inline-flex;align-items:center;gap:6px;background:var(--header-bg);color:#fff;padding:7px 14px;border-radius:var(--radius);cursor:pointer;font-size:13px;margin-top:6px">Upload Logo<input type="file" accept="image/*" style="display:none" onchange="uploadCompanyLogo(this)"></label></div>';
    html += '<div class="form-row"><label class="form-label">Customer Display</label>'
      +'<select onchange="saveCompanySetting(\'customer_display_preference\',this.value)" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px">'
      +'<option value="display_name"'+((AppState.settings.customer_display_preference||'display_name')==='display_name'?' selected':'')+'>Display Name (QBO short name)</option>'
      +'<option value="name"'+((AppState.settings.customer_display_preference)==='name'?' selected':'')+'>Account Name (QBO full name)</option>'
      +'</select></div></div></div>';
  }
  // Timezone block
  var tzOptions = [
    ['America/New_York','Eastern Time (ET)'],
    ['America/Chicago','Central Time (CT)'],
    ['America/Denver','Mountain Time (MT)'],
    ['America/Los_Angeles','Pacific Time (PT)'],
    ['America/Anchorage','Alaska Time (AKT)'],
    ['Pacific/Honolulu','Hawaii Time (HT)']
  ];
  var currentTZ = AppState.settings.timezone || 'America/New_York';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Timezone</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">System timezone</div>';
  html += '<select onchange="saveSetting(\'timezone\',this.value)" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  tzOptions.forEach(function(tz){ html += '<option value="'+tz[0]+'"'+(currentTZ===tz[0]?' selected':'')+'>'+tz[1]+'</option>'; });
  html += '</select></div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Used for GPS timestamp display and daily review boundaries.</div>';
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Technicians</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  AppState.technicians.forEach(function(t){
    var col=t.color||'#cccccc';
    html += '<div class="lookup-item" style="align-items:center"><span class="lookup-item-name">'+escHtml(t.name)+'</span>'
      +'<span style="display:flex;align-items:center;gap:8px;margin-left:auto"><span style="font-size:11px;color:var(--text-muted)">Color:</span>'
      +'<input type="color" value="'+col+'" style="width:32px;height:26px;padding:1px;border:1px solid var(--border);border-radius:4px;cursor:pointer" onchange="saveTechColor(\''+t.id+'\',this.value)">'
      +'<span style="font-size:11px;color:var(--text-muted)">TID:</span>'
      +'<input type="text" value="'+(t.tid||'')+'" placeholder="e.g. KM" maxlength="4" style="width:44px;font-size:12px;padding:2px 5px;border:1px solid var(--border);border-radius:3px;background:var(--bg);text-align:center" onblur="saveTechField(\''+t.id+'\',\'tid\',this.value)">'
      +'<span class="lookup-item-badge">active</span>'
      +'<button style="font-size:11px;padding:2px 8px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="deactivateTech(\''+t.id+'\',\''+escHtml(t.name)+'\')">x Deactivate</button>'
      +'</span></div>';
  });
  html += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:6px">Add New Technician</div>'
    +'<div style="display:flex;gap:8px;align-items:center"><input type="text" id="new-tech-name" placeholder="Full name" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;flex:1">'
    +'<input type="color" id="new-tech-color" value="#3498db" style="width:36px;height:32px;padding:1px;border:1px solid var(--border);border-radius:3px;cursor:pointer">'
    +'<button class="btn-dark" style="font-size:13px;padding:6px 14px" onclick="addNewTech()">+ Add</button></div></div>';
  html += '</div></div>';

  // Tech Schedule block
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Work Schedule</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Set expected work days and start times per technician. Used for clock-in/out prompts.</div>';
  AppState.technicians.forEach(function(t) {
    var techSchedule = AppState._techSchedules ? (AppState._techSchedules[t.id] || []) : [];
    html += '<div style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius);padding:10px">';
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + escHtml(t.name) + '</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr>';
    html += '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Day</th>';
    html += '<th style="padding:4px 6px;text-align:center;color:var(--text-muted);font-size:10px">Work day</th>';
    html += '<th style="padding:4px 6px;text-align:left;color:var(--text-muted);font-size:10px">Start time</th>';
    html += '</tr></thead><tbody>';
    days.forEach(function(day, dow) {
      var sched = techSchedule.find(function(s){return s.day_of_week===dow;});
      var isWorkday = sched ? sched.is_workday : (dow >= 1 && dow <= 5); // default Mon-Fri
      var startTime = sched ? (sched.expected_start||'07:00') : '07:00';
      html += '<tr style="border-top:1px solid var(--border)">';
      html += '<td style="padding:5px 6px;font-weight:500">' + day + '</td>';
      html += '<td style="padding:5px 6px;text-align:center"><input type="checkbox"' + (isWorkday?' checked':'') + ' onchange="saveTechSchedule(\'' + t.id + '\',' + dow + ',\'is_workday\',this.checked)"></td>';
      html += '<td style="padding:5px 6px"><input type="time" value="' + startTime + '" style="font-size:12px;padding:2px 5px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"' + (!isWorkday?' disabled':'') + ' onchange="saveTechSchedule(\'' + t.id + '\',' + dow + ',\'expected_start\',this.value)"></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  });
  html += '</div></div>';
  html += '</div></div>';

  // WORK ORDERS
  html += '<div class="settings-tab-content'+(activeTab==='workorders'?' active':'')+'" id="stab-workorders">';
  html += '<div class="settings-block"><div class="settings-block-header" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Work Order Flags</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body">';
  if(AppState.woFlags.length){
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr style="border-bottom:2px solid var(--border)"><th style="padding:4px 8px;text-align:left;color:var(--text-muted);font-size:11px">Key</th><th style="padding:4px 8px;text-align:left;color:var(--text-muted);font-size:11px">Name</th><th style="padding:4px 8px;text-align:left;color:var(--text-muted);font-size:11px">Color</th><th style="padding:4px 8px;text-align:left;color:var(--text-muted);font-size:11px">Blocks Export</th></tr></thead><tbody>';
    AppState.woFlags.forEach(function(f){
      html += '<tr style="border-bottom:1px solid var(--border)">'
        +'<td style="padding:5px 8px;font-size:11px;font-family:monospace;color:var(--text-muted)">'+escHtml(f.system_key)+'</td>'
        +'<td style="padding:4px 8px"><input type="text" value="'+escHtml(f.name)+'" style="font-size:13px;border:1px solid transparent;border-radius:3px;padding:2px 5px;background:transparent;width:100%" onfocus="this.style.border=\'1px solid var(--header-bg)\';this.style.background=\'var(--bg)\'" onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';saveWOFlagField(\''+f.id+'\',\'name\',this.value)"></td>'
        +'<td style="padding:4px 8px"><input type="color" value="'+f.color+'" style="width:36px;height:26px;padding:1px;border:1px solid var(--border);border-radius:4px;cursor:pointer" onchange="saveWOFlagField(\''+f.id+'\',\'color\',this.value)"></td>'
        +'<td style="padding:4px 8px;text-align:center"><input type="checkbox"'+(f.blocks_export?' checked':'')+' onchange="saveWOFlagField(\''+f.id+'\',\'blocks_export\',this.checked)"></td>'
        +'<td style="padding:4px 8px"><button style="font-size:11px;padding:2px 8px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="deactivateWOFlag(\''+f.id+'\',\''+escHtml(f.name)+'\')">x Deactivate</button></td>'
        +'</tr>';
    });
    html += '</tbody></table>';
  } else { html += '<div style="font-size:12px;color:var(--text-muted)">No flags loaded.</div>'; }
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Work Order Statuses</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  var _sList3=(AppState.statuses&&AppState.statuses.length)?AppState.statuses:STATUSES_FALLBACK;
  html += '<table style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr style="border-bottom:2px solid var(--border)"><th style="padding:4px 8px;width:36px;color:var(--text-muted);font-size:11px">#</th><th style="padding:4px 8px;color:var(--text-muted);font-size:11px">Name</th><th style="padding:4px 8px;width:120px;color:var(--text-muted);font-size:11px">Category</th><th style="padding:4px 8px;width:52px;color:var(--text-muted);font-size:11px">Color</th><th style="padding:4px 8px;width:56px;color:var(--text-muted);font-size:11px">Mobile</th><th style="width:32px"></th></tr></thead><tbody>';
  _sList3.forEach(function(s){
    var sk=s.system_key?'<span style="font-size:9px;color:var(--text-muted);margin-left:4px;font-family:monospace">'+s.system_key+'</span>':'';
    html += '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:5px 8px;font-weight:600;color:var(--text-muted)">'+String(s.num).padStart(2,'0')+'</td>'
      +'<td style="padding:4px 8px"><input type="text" value="'+escHtml(s.name)+'" style="width:100%;font-size:13px;border:1px solid transparent;border-radius:3px;padding:3px 6px;background:transparent" onfocus="this.style.border=\'1px solid var(--header-bg)\';this.style.background=\'var(--bg)\'" onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';saveStatusField(\''+s.id+'\',\'name\',this.value)">'+sk+'</td>'
      +'<td style="padding:4px 8px"><select style="font-size:12px;border:1px solid var(--border);border-radius:3px;padding:2px 4px;background:var(--bg)" onchange="saveStatusField(\''+s.id+'\',\'category\',this.value)">'+['draft','active','completed','processed','cancelled'].map(function(c){return '<option value="'+c+'"'+(s.category===c?' selected':'')+'>'+c+'</option>';}).join('')+'</select></td>'
      +'<td style="padding:4px 8px"><input type="color" value="'+s.color+'" style="width:36px;height:28px;padding:1px;border:1px solid var(--border);border-radius:3px;cursor:pointer" onchange="saveStatusField(\''+s.id+'\',\'color\',this.value)"></td>'
      +'<td style="padding:4px 8px;text-align:center"><input type="checkbox"'+(s.mobile?' checked':'')+' onchange="saveStatusField(\''+s.id+'\',\'mobile\',this.checked)"></td>'
      +'<td style="padding:2px 4px"><button style="font-size:11px;padding:2px 6px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer" onclick="deactivateStatus(\''+s.id+'\')">x</button></td>'
      +'</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:6px">Add New Status</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input type="number" id="new-status-num" placeholder="#" style="width:50px;font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px"><input type="text" id="new-status-name" placeholder="Status name" style="width:140px;font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px"><select id="new-status-cat" style="font-size:12px;border:1px solid var(--border);border-radius:3px;padding:4px 6px"><option value="draft">draft</option><option value="active">active</option><option value="completed">completed</option><option value="processed">processed</option><option value="cancelled">cancelled</option></select><input type="color" id="new-status-color" value="#eeeeee" style="width:36px;height:30px;padding:1px;border:1px solid var(--border);border-radius:3px;cursor:pointer"><button class="btn-dark" style="font-size:12px;padding:5px 12px" onclick="saveNewStatus()">+ Add</button></div></div>';
  html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">x deactivates (hides from picker, preserves history).</div>';
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Review &amp; Acceptance</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">System go-live date</div><input class="settings-row-input" type="date" value="'+(AppState.settings.system_start_date||'')+'" onchange="saveSetting(\'system_start_date\',this.value)"></div>';
  html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">No days before this date will appear in the daily review queue.</div>';
  html += '</div></div>';
  html += '</div>'; // end stab-workorders

  // BILLING
  html += '<div class="settings-tab-content'+(activeTab==='billing'?' active':'')+'" id="stab-billing">';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Hours Types</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<table style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr style="border-bottom:2px solid var(--border)"><th style="padding:4px 8px;color:var(--text-muted);font-size:11px">Name</th><th style="padding:4px 8px;color:var(--text-muted);font-size:11px">Zed Axis Name</th><th style="padding:4px 8px;color:var(--text-muted);font-size:11px">Rate Key</th><th style="padding:4px 8px;color:var(--text-muted);font-size:11px;width:80px">Rate $/hr</th><th style="padding:4px 8px;width:40px"></th></tr></thead><tbody>';
  AppState.hoursTypes.forEach(function(t){
    var rate=AppState.settings[t.internal_rate_key]||'';
    html += '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:4px 8px"><input type="text" value="'+escHtml(t.name)+'" style="width:100%;font-size:13px;border:1px solid transparent;border-radius:3px;padding:3px 6px;background:transparent" onfocus="this.style.border=\'1px solid var(--header-bg)\';this.style.background=\'var(--bg)\'" onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';saveHoursTypeField(\''+t.id+'\',\'name\',this.value)"></td>'
      +'<td style="padding:4px 8px"><input type="text" value="'+escHtml(t.zed_axis_name||'')+'" style="width:100%;font-size:13px;border:1px solid transparent;border-radius:3px;padding:3px 6px;background:transparent" onfocus="this.style.border=\'1px solid var(--header-bg)\';this.style.background=\'var(--bg)\'" onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';saveHoursTypeField(\''+t.id+'\',\'zed_axis_name\',this.value)"></td>'
      +'<td style="padding:4px 8px;font-size:11px;font-family:monospace;color:var(--text-muted)">'+escHtml(t.internal_rate_key||'')+'</td>'
      +'<td style="padding:4px 8px"><input type="number" value="'+escHtml(String(rate))+'" min="0" step="0.01" style="width:70px;font-size:13px;border:1px solid transparent;border-radius:3px;padding:3px 6px;background:transparent" onfocus="this.style.border=\'1px solid var(--header-bg)\';this.style.background=\'var(--bg)\'" onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';saveHoursRate(\''+t.internal_rate_key+'\',this.value)"></td>'
      +'<td style="padding:4px 8px"><button onclick="deactivateHoursType(\''+t.id+'\',\''+escHtml(t.name)+'\')" style="font-size:11px;padding:2px 6px;border:1px solid var(--danger);border-radius:3px;color:var(--danger);background:none;cursor:pointer">x</button></td>'
      +'</tr>';
  });
  html += '</tbody></table><div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Rate key links to settings. Changes take effect on new entries.</div>';
  html += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:6px">Add New Hours Type</div>';
  html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
  html += '<input type="text" id="new-ht-name" placeholder="Name" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:120px">';
  html += '<input type="text" id="new-ht-zed" placeholder="Zed Axis name" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;width:130px">';
  html += '<button class="btn-dark" style="font-size:12px;padding:5px 12px" onclick="saveNewHoursType()">+ Add</button>';
  html += '</div></div>';
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Billing Rules</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">Minimum billable hours per WO</div><input class="settings-row-input" type="number" step="0.5" min="0" value="'+(AppState.settings.billing_minimum_hours||'2')+'" onchange="saveSetting(\'billing_minimum_hours\',this.value)"></div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Advisory only — shown as a warning in Time & Billing Reconciliation before export. Not enforced at save time.</div>';
  html += '<div class="settings-row"><div class="settings-row-label">Start/end of day travel threshold (min)</div><input class="settings-row-input" type="number" step="5" min="0" value="'+(AppState.settings.billing_travel_threshold_min||'30')+'" onchange="saveSetting(\'billing_travel_threshold_min\',this.value)"></div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">First and last drive segments longer than this are flagged in Time & Billing Reconciliation as potential billable travel. Default: 30 minutes.</div>';
  html += '<div class="settings-row"><div class="settings-row-label">Tech home location</div>';
  html += '<select class="settings-row-input" onchange="saveSetting(\'tech_home_location_id\',this.value)">';
  html += '<option value="">— None set —</option>';
  (AppState.locations||[]).filter(function(l){return l.active!==false;}).forEach(function(l){
    html += '<option value="'+escHtml(l.id)+'"'+(AppState.settings.tech_home_location_id===l.id?' selected':'')+'>'+escHtml(l.name)+'</option>';
  });
  html += '</select></div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Used to calculate start/end of day travel distance. Set your home location in Location Manager first.</div>';
  html += '</div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">QBO Items</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  AppState.qboItems.forEach(function(q){ html += '<div class="lookup-item"><span class="lookup-item-name">'+escHtml(q.name)+'</span><span class="lookup-item-badge">'+escHtml(q.zed_axis_name)+'</span></div>'; });
  html += '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px"><div style="font-size:13px;font-weight:600;margin-bottom:8px">Add New QBO Item</div>';
  html += '<div class="form-row-2" style="margin-bottom:8px"><div><label class="form-label" style="font-size:11px">Name *</label><input type="text" id="new-qbo-name" placeholder="e.g. Refrigerant"></div><div><label class="form-label" style="font-size:11px">Zed Axis Name *</label><input type="text" id="new-qbo-zed" placeholder="e.g. r410a"></div></div>';
  html += '<button class="btn-dark" style="font-size:13px;padding:8px 14px" onclick="saveNewQBOItem()">+ Add Item</button></div></div></div>';
  html += '<div class="settings-block"><div class="settings-block-header" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Vendors</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body"><div style="font-size:14px;color:var(--text-secondary)">'+AppState.vendors.length+' vendors loaded</div></div></div>';
  html += '</div>';

  // LOCATIONS
  html += '<div class="settings-tab-content'+(activeTab==='locations'?' active':'')+'" id="stab-locations">';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Geofence Defaults</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">Default geofence radius (meters)</div><input class="settings-row-input" type="number" step="1" min="10" value="'+(AppState.settings.geofence_radius_default||'100')+'" onchange="saveSetting(\'geofence_radius_default\',this.value)"></div>';
  html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Applies to all locations not customized individually. Override per location in the Location Manager.</div></div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Location Entity Types</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">System types (customer, vendor, personal) are built in and cannot be removed.</div>';
  html += '<div style="font-size:12px;color:var(--text-muted)">Additional entity types - coming in a future build.</div></div></div>';
  html += '</div>';

  // DATA
  // GPS & TRACKING
  html += '<div class=\"settings-tab-content'+(activeTab==='gps'?' active':'')+'\" id=\"stab-gps\">';
  html += '<div class=\"settings-block\"><div class=\"settings-block-header open\" onclick=\"toggleSettingsBlock(this)\"><span class=\"settings-block-title\">Stop Detection</span><span class=\"settings-block-chevron\">v</span></div><div class=\"settings-block-body open\">';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:10px\">Known locations are detected by geofence presence — any ping within the radius counts. Unknown locations require pings clustered within 100m for the minimum duration below.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Default geofence radius (meters)</div><input class=\"settings-row-input\" type=\"number\" step=\"1\" min=\"10\" value=\"'+(AppState.settings.geofence_radius_default||'100')+'\" onchange=\"saveSetting(\'geofence_radius_default\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Default radius for known location geofences. Override per location in Location Manager. Default: 100m.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Known location min dwell (min)</div><input class=\"settings-row-input\" type=\"number\" min=\"1\" max=\"30\" step=\"1\" value=\"'+(AppState.settings.gps_known_stop_min_duration||'5')+'\"|onchange=\"saveSetting(\'gps_known_stop_min_duration\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Minimum minutes inside a known geofence to register as a stop. Filters drive-past false positives. Default: 5.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Known location gap tolerance (min)</div><input class=\"settings-row-input\" type=\"number\" min=\"0\" max=\"120\" step=\"5\" value=\"'+(AppState.settings.gps_known_gap_tolerance||'30')+'\" onchange=\"saveSetting(\'gps_known_gap_tolerance\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">If GPS signal lost within a known geofence and returns within this many minutes, treat as one continuous stop. Default: 30.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Personal location gap tolerance (min)</div><input class=\"settings-row-input\" type=\"number\" min=\"30\" max=\"240\" step=\"15\" value=\"'+(AppState.settings.gps_personal_gap_tolerance||'120')+'\" onchange=\"saveSetting(\'gps_personal_gap_tolerance\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Gap tolerance for personal/home locations where WiFi reduces GPS ping frequency. Default: 120 min.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Known location min pings</div><input class=\"settings-row-input\" type=\"number\" min=\"1\" max=\"10\" step=\"1\" value=\"'+(AppState.settings.gps_known_min_pings||'3')+'\" onchange=\"saveSetting(\'gps_known_min_pings\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Minimum GPS pings inside geofence before gap tolerance applies. Prevents drive-past false stops. Default: 3.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Unknown location min duration (min)</div><input class=\"settings-row-input\" type=\"number\" min=\"1\" max=\"60\" step=\"1\" value=\"'+(AppState.settings.gps_unknown_stop_min_duration||'10')+'\" onchange=\"saveSetting(\'gps_unknown_stop_min_duration\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Minimum minutes at an unknown location (within 100m) to surface as a stop. Filters traffic lights and brief pauses. Default: 10.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Merge gap threshold (min)</div><input class=\"settings-row-input\" type=\"number\" min=\"15\" max=\"480\" step=\"15\" value=\"'+(AppState.settings.gps_merge_gap_threshold||'120')+'\" onchange=\"saveSetting(\'gps_merge_gap_threshold\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Maximum gap between visits to the same location to suggest merging. Default: 120 min.</div>';
  html += '</div></div>';
  html += '<div class=\"settings-block\"><div class=\"settings-block-header open\" onclick=\"toggleSettingsBlock(this)\"><span class=\"settings-block-title\">Data Quality</span><span class=\"settings-block-chevron\">v</span></div><div class=\"settings-block-body open\">';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Accuracy filter (meters)</div><input class=\"settings-row-input\" type=\"number\" min=\"10\" max=\"500\" step=\"10\" value=\"'+(AppState.settings.gps_accuracy_threshold||'100')+'\" onchange=\"saveSetting(\'gps_accuracy_threshold\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Pings with accuracy worse than this are discarded. GPS is typically 3–15m, cell towers 200–2000m. Recommended: 100.</div>';
  html += '<div class=\"settings-row\"><div class=\"settings-row-label\">Drive cap (minutes)</div><input class=\"settings-row-input\" type=\"number\" min=\"60\" max=\"480\" step=\"30\" value=\"'+(AppState.settings.gps_drive_cap_minutes||'240')+'\" onchange=\"saveSetting(\'gps_drive_cap_minutes\',this.value)\"></div>';
  html += '<div style=\"font-size:11px;color:var(--text-muted);margin-bottom:8px\">Drive segments longer than this are flagged as data errors. Recommended: 240 (4 hours).</div>';
  html += '</div></div>';
  html += '</div>';

    // DATA
  html += '<div class="settings-tab-content'+(activeTab==='data'?' active':'')+'" id="stab-data">';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Data Import</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<label class="import-btn">Upload QBO Customer List (.xls/.xlsx)<input type="file" accept=".xls,.xlsx" style="display:none" onchange="importCustomerXLS(this)"></label>';
  html += '<label class="import-btn">Upload QBO Vendor List (.xls/.xlsx)<input type="file" accept=".xls,.xlsx" style="display:none" onchange="importVendorXLS(this)"></label>';
  html += '<label class="import-btn">Import DWO Excel Export (.xlsx)<input type="file" accept=".xlsx,.xls" style="display:none" onchange="importDWOExcel(this)"></label>';
  html += '</div></div></div>';

  // SYSTEM
  html += '<div class="settings-tab-content'+(activeTab==='system'?' active':'')+'" id="stab-system">';
  // Barcode Formats block
  var barcodeFormats = (AppState.settings.barcode_formats || 'CODE_128').split(',').map(function(f){return f.trim();});
  var allFormats = [
    {key:'CODE_128', label:'Code 128'},
    {key:'CODE_39', label:'Code 39'},
    {key:'EAN_13', label:'EAN-13 / UPC-A'},
    {key:'EAN_8', label:'EAN-8'},
    {key:'QR_CODE', label:'QR Code'},
    {key:'ITF', label:'ITF / Interleaved 2 of 5'},
    {key:'DATA_MATRIX', label:'Data Matrix'}
  ];
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">Barcode Scanner Formats</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Enable only the formats you use. Fewer formats = faster and more reliable scanning. Code 128 is standard for most vendor invoices.</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  allFormats.forEach(function(f){
    var checked = barcodeFormats.indexOf(f.key) >= 0;
    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:7px 0"><label style="display:flex;align-items:center;gap:10px;cursor:pointer">';
    html += '<input type="checkbox" ' + (checked?'checked':'') + ' onchange="saveBarcodeFormat(\'' + f.key + '\',this.checked)" style="width:16px;height:16px;cursor:pointer">';
    html += '<span>' + f.label + '</span>';
    html += '</label></td>';
    html += '</tr>';
  });
  html += '</table></div></div>';
  html += '<div class="settings-block"><div class="settings-block-header open" onclick="toggleSettingsBlock(this)"><span class="settings-block-title">System Info</span><span class="settings-block-chevron">v</span></div><div class="settings-block-body open">';
  html += '<div class="settings-row"><div class="settings-row-label">App version</div><div style="font-size:13px;color:var(--text-muted)">'+APP_VERSION+'</div></div>';
  html += '<div class="settings-row"><div class="settings-row-label">Signed in as</div><div style="font-size:13px;color:var(--text-muted)">'+(AppState.userEmail||'-')+'</div></div>';
  html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Future: integrations, Twilio, RLS policies, locking controls.</div>';
  html += '</div></div></div>';

  el.innerHTML = html;
}

function switchSettingsTab(tabId) {
  localStorage.setItem('dwo_settings_tab', tabId);
  document.querySelectorAll('.settings-tab').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('onclick')==='switchSettingsTab(\''+tabId+'\')');
  });
  document.querySelectorAll('.settings-tab-content').forEach(function(c){
    c.classList.toggle('active', c.id==='stab-'+tabId);
  });
}

function saveNewQBOItem() {
  var name=document.getElementById('new-qbo-name').value.trim();
  var zed=document.getElementById('new-qbo-zed').value.trim();
  if(!name||!zed){showToast('Name and Zed Axis name are required');return;}
  if(AppState.qboItems.find(function(q){return q.name===name;})){showToast('Item already exists');return;}
  sb.post('qbo_items',{name:name,zed_axis_name:zed,active:true,created_by:AppState.userEmail,modified_by:AppState.userEmail})
  .then(function(r){
    if(r.ok&&r.data&&r.data.length){AppState.qboItems=AppState.qboItems.concat(r.data);AppState.qboItems.sort(function(a,b){return a.name.localeCompare(b.name);});document.getElementById('new-qbo-name').value='';document.getElementById('new-qbo-zed').value='';renderSettings('settings-body-desktop');showToast('QBO item added');}
    else showToast('Error saving');
  });
}

function toggleSettingsBlock(header){ header.classList.toggle('open'); header.nextElementSibling.classList.toggle('open'); }
function saveTechSchedule(techId, dow, field, value) {
  if (!AppState._techSchedules) AppState._techSchedules = {};
  if (!AppState._techSchedules[techId]) AppState._techSchedules[techId] = [];
  var existing = AppState._techSchedules[techId].find(function(s){return s.day_of_week===dow;});
  if (existing) {
    existing[field] = value;
    sb.patchWhere('tech_schedule', 'tech_id=eq.'+techId+'&day_of_week=eq.'+dow, {[field]: value, modified_at: new Date().toISOString()})
      .then(function(r){ if(r.ok) showToast('Schedule saved'); else showToast('Error saving schedule'); });
  } else {
    var newRow = {tech_id: techId, day_of_week: dow, is_workday: true, expected_start: '07:00'};
    newRow[field] = value;
    sb.post('tech_schedule', newRow).then(function(r){
      if (r.ok && r.data && r.data.length) {
        AppState._techSchedules[techId].push(r.data[0]);
        showToast('Schedule saved');
      } else showToast('Error saving schedule');
    });
  }
  // Enable/disable time input
  if (field === 'is_workday') {
    renderSettings('settings-body-desktop');
  }
}

function loadTechSchedules() {
  return sb.get('tech_schedule', '?select=*&order=day_of_week.asc').then(function(r){
    if (r.ok && r.data) {
      AppState._techSchedules = {};
      r.data.forEach(function(s){
        if (!AppState._techSchedules[s.tech_id]) AppState._techSchedules[s.tech_id] = [];
        AppState._techSchedules[s.tech_id].push(s);
      });
    }
  });
}

function saveBarcodeFormat(format, enabled) {
  var current = (AppState.settings.barcode_formats || 'CODE_128').split(',').map(function(f){return f.trim();}).filter(Boolean);
  if (enabled && current.indexOf(format) < 0) current.push(format);
  if (!enabled) current = current.filter(function(f){return f !== format;});
  if (!current.length) current = ['CODE_128'];
  saveSetting('barcode_formats', current.join(','));
}

function saveSetting(key,value){ sb.patchWhere('settings','key=eq.'+key,{value:String(value)}).then(function(){AppState.settings[key]=String(value);showToast(key.replace(/_/g,' ')+' saved');}); }

// XLS IMPORTS
function _ensureXLSX(cb){ if(typeof XLSX!=='undefined'){cb();return;} var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=cb;s.onerror=function(){showToast('Could not load Excel library');};document.head.appendChild(s); }
function _readXLSFile(file,sheetName){ return new Promise(function(resolve,reject){ var reader=new FileReader(); reader.onload=function(e){ try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var wsName=sheetName&&wb.Sheets[sheetName]?sheetName:wb.SheetNames[0];var ws=wb.Sheets[wsName];resolve(XLSX.utils.sheet_to_json(ws,{defval:''}));}catch(err){reject(err);} };reader.onerror=reject;reader.readAsArrayBuffer(file); }); }

function importCustomerXLS(input) {
  var file=input.files[0]; if(!file)return; input.value='';
  _ensureXLSX(function(){
    showToast('Reading customer file...');
    _readXLSFile(file,'Sheet1').then(function(rows){
      var imported=0,skipped=0,geocoded=0;
      var doRow=function(i){
        if(i>=rows.length){
          AppState.customers.sort(function(a,b){return a.name.localeCompare(b.name);});
          showToast('Imported '+imported+' customers, '+skipped+' skipped, '+geocoded+' geocoded');
          renderCustomerPanel();
          return;
        }
        var row=rows[i];
        var name=String(row['Customer']||row['Name']||'').trim();
        if(!name||name==='1ADD CUSTOMER'){skipped++;doRow(i+1);return;}
        var display=name.indexOf(':')>=0?name.split(':').pop().trim():name;
        var email=String(row['Main Email']||row['Email']||'').trim();
        var phone=String(row['Main Phone']||row['Phone']||'').trim();
        var street=String(row['Ship to 2']||'').trim();
        var cityStateZip=String(row['Ship to 3']||'').trim();
        var city='',state='',zip='';
        if(cityStateZip){
          var cszParts=cityStateZip.split(',');
          if(cszParts.length>=2){
            city=cszParts[0].trim();
            var stZip=(cszParts[1]||'').trim().split(' ');
            state=stZip[0]||'';
            zip=stZip[1]||'';
          } else {
            city=cityStateZip;
          }
        }
        var fullAddress=street&&city?(street+', '+city+(state?', '+state:'')+(zip?' '+zip:'')):'';
        var existing=AppState.customers.find(function(c){return c.name===name;});
        if(existing){
          var existingId=existing.id;
          var existingLat=existing.lat;
          var updateData={address_street:street||null,city:city||null,state:state||null,zip:zip||null,modified_by:AppState.userEmail};
          sb.patch('customers',existingId,updateData).then(function(r){
            imported++;
            var c=AppState.customers.find(function(x){return x.id===existingId;});
            if(c) Object.assign(c,updateData);
            if(fullAddress&&!existingLat){
              geocodeCustomer(existingId,fullAddress).then(function(ok){if(ok)geocoded++;doRow(i+1);});
            } else {
              doRow(i+1);
            }
          }).catch(function(){skipped++;doRow(i+1);});
          return;
        }
        var custData={name:name,display_name:display,email:email||null,phone:phone||null,address_street:street||null,city:city||null,state:state||null,zip:zip||null,created_by:AppState.userEmail,modified_by:AppState.userEmail};
        sb.post('customers',custData).then(function(r){
          if(r.ok&&r.data&&r.data.length){imported++;var newCust=r.data[0];AppState.customers=AppState.customers.concat(r.data);if(fullAddress&&newCust&&newCust.id){geocodeCustomer(newCust.id,fullAddress).then(function(ok){if(ok)geocoded++;doRow(i+1);});}else{doRow(i+1);}}
          else{skipped++;doRow(i+1);}
        });
      };
      doRow(0);
    }).catch(function(){showToast('Could not read file');});
  });
}

function geocodeLocationById(locationId, address) {
  if (!locationId || !address) return;
  fetch(SUPABASE_URL+'/functions/v1/geocode-address', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer '+(AppState.session&&AppState.session.access_token||SUPABASE_KEY)
    },
    body: JSON.stringify({address: address, location_id: locationId})
  }).then(function(res){ return res.json(); }).then(function(data){
    if (data && data.lat && data.lng) {
      var loc = LocState.locations.find(function(l){ return l.id === locationId; });
      if (loc) {
        loc.lat = data.lat;
        loc.lng = data.lng;
        loc.geocode_status = 'geocoded';
        loc.geocoded_at = new Date().toISOString();
      }
      if (LocState.mapReady) locRenderMarkers();
      if (LocState.selected && LocState.selected.id === locationId) locRenderDetail(LocState.selected);
      showToast('Address geocoded — pin updated');
    } else {
      showToast('Could not geocode address — enter coordinates manually');
    }
  }).catch(function(){ showToast('Geocoding failed'); });
}

function geocodeCustomer(customerId, address) {
  if(!customerId||!address) return Promise.resolve(false);
  return fetch(SUPABASE_URL+'/functions/v1/geocode-address', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer '+(AppState.session&&AppState.session.access_token||SUPABASE_KEY)
    },
    body: JSON.stringify({address: address, customer_id: customerId})
  }).then(function(res){ return res.json(); }).then(function(data){
    if(data&&data.lat&&data.lng){
      // Update local cache
      var c=AppState.customers.find(function(x){return x.id===customerId;});
      if(c){c.lat=data.lat;c.lng=data.lng;c.geocoded_at=new Date().toISOString();}
      return true;
    }
    return false;
  }).catch(function(){ return false; });
}

function importVendorXLS(input) {
  var file=input.files[0]; if(!file)return; input.value='';
  _ensureXLSX(function(){
    showToast('Reading vendor file...');
    _readXLSFile(file).then(function(rows){
      var imported=0,skipped=0;
      var doRow=function(i){
        if(i>=rows.length){AppState.vendors.sort(function(a,b){return a.name.localeCompare(b.name);});showToast('Imported '+imported+' vendors, '+skipped+' skipped');return;}
        var row=rows[i]; var name=String(row['Vendor']||'').trim(); if(!name){skipped++;doRow(i+1);return;}
        if(AppState.vendors.find(function(v){return v.name===name;})){skipped++;doRow(i+1);return;}
        var email=String(row['Email']||'').trim(); var domain=email.indexOf('@')>=0?email.split('@')[1]:''; var cn=String(row['Company name']||'').trim();
        sb.post('vendors',{name:name,company_name:cn||null,email:email||null,email_domain:domain||null,created_by:AppState.userEmail,modified_by:AppState.userEmail}).then(function(r){if(r.ok&&r.data&&r.data.length){imported++;AppState.vendors=AppState.vendors.concat(r.data);}doRow(i+1);});
      };
      doRow(0);
    }).catch(function(){showToast('Could not read file');});
  });
}

function importDWOExcel(input){ var file=input.files[0]; if(!file)return; input.value=''; _ensureXLSX(function(){_processDWOExcel(file);}); }

// BARCODE - ZXing
var _zxingReader = null;
function openBarcode(targetField){ AppState.barcodeTargetField=targetField; document.getElementById('barcode-overlay').classList.add('open'); _startZXing(); }
function _startZXing(){
  var videoEl = document.getElementById('barcode-video');
  if (!videoEl) return;

  // Try native BarcodeDetector first (Chrome Android, Safari iOS 17+)
  if ('BarcodeDetector' in window) {
    var enabledFormats = (AppState.settings.barcode_formats || 'CODE_128').split(',').map(function(f){ return f.trim(); });
    var formatMap = {
      'CODE_128': 'code_128', 'CODE_39': 'code_39', 'EAN_13': 'ean_13',
      'EAN_8': 'ean_8', 'QR_CODE': 'qr_code', 'ITF': 'itf', 'DATA_MATRIX': 'data_matrix'
    };
    var formats = enabledFormats.map(function(f){ return formatMap[f]; }).filter(Boolean);
    if (!formats.length) formats = ['code_128'];
    var detector;
    try { detector = new BarcodeDetector({ formats: formats }); }
    catch(e) { detector = new BarcodeDetector(); }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function(stream) {
      videoEl.srcObject = stream;
      videoEl.setAttribute('playsinline', true);
      videoEl.play();
      AppState._barcodeStream = stream;
      AppState._barcodeDetecting = true;
      AppState._lastBarcodeValue = null;
      AppState._lastBarcodeCount = 0;
      function scanFrame() {
        if (!AppState._barcodeDetecting) return;
        if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
          detector.detect(videoEl).then(function(barcodes) {
            if (barcodes && barcodes.length) {
              // Filter to barcodes in center 60% of frame
              var vw = videoEl.videoWidth || 640;
              var vh = videoEl.videoHeight || 480;
              var cx1 = vw * 0.2, cx2 = vw * 0.8, cy1 = vh * 0.2, cy2 = vh * 0.8;
              var centered = barcodes.filter(function(b) {
                if (!b.boundingBox) return true;
                var bx = b.boundingBox.x + b.boundingBox.width/2;
                var by = b.boundingBox.y + b.boundingBox.height/2;
                return bx >= cx1 && bx <= cx2 && by >= cy1 && by <= cy2;
              });
              var best = centered.length ? centered[0] : barcodes[0];
              var val = best.rawValue;
              // Require two consecutive reads of same value
              if (val === AppState._lastBarcodeValue) {
                AppState._lastBarcodeCount++;
                if (AppState._lastBarcodeCount >= 2) { onBarcodeDetected(val); return; }
              } else {
                AppState._lastBarcodeValue = val;
                AppState._lastBarcodeCount = 1;
              }
            }
            if (AppState._barcodeDetecting) requestAnimationFrame(scanFrame);
          }).catch(function() {
            if (AppState._barcodeDetecting) requestAnimationFrame(scanFrame);
          });
        } else {
          if (AppState._barcodeDetecting) requestAnimationFrame(scanFrame);
        }
      }
      videoEl.addEventListener('loadeddata', function(){ scanFrame(); });
    }).catch(function() { showToast('Camera access denied'); closeBarcode(); });
    return;
  }

  // Fallback — ZXing for browsers without BarcodeDetector
  var loadZXing = typeof ZXing==='undefined' ? new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://unpkg.com/@zxing/library@0.18.6/umd/index.min.js';
    s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
  }) : Promise.resolve();
  loadZXing.then(function(){
    try {
      var enabledFormats = (AppState.settings.barcode_formats || 'CODE_128').split(',').map(function(f){ return f.trim(); });
      var zfmt = { 'CODE_128': ZXing.BarcodeFormat.CODE_128, 'CODE_39': ZXing.BarcodeFormat.CODE_39,
        'EAN_13': ZXing.BarcodeFormat.EAN_13, 'EAN_8': ZXing.BarcodeFormat.EAN_8,
        'QR_CODE': ZXing.BarcodeFormat.QR_CODE, 'ITF': ZXing.BarcodeFormat.ITF,
        'DATA_MATRIX': ZXing.BarcodeFormat.DATA_MATRIX };
      var formats = enabledFormats.map(function(f){ return zfmt[f]; }).filter(Boolean);
      if (!formats.length) formats = [ZXing.BarcodeFormat.CODE_128];
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      _zxingReader = new ZXing.BrowserMultiFormatReader(hints);
      var constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' }] } };
      AppState._lastBarcodeValue = null;
      AppState._lastBarcodeCount = 0;
      _zxingReader.decodeFromConstraints(constraints, videoEl, function(result, err){
        if (result) {
          var val = result.getText();
          if (val === AppState._lastBarcodeValue) {
            AppState._lastBarcodeCount++;
            if (AppState._lastBarcodeCount >= 2) onBarcodeDetected(val);
          } else {
            AppState._lastBarcodeValue = val;
            AppState._lastBarcodeCount = 1;
          }
        }
      }).catch(function(){
        _zxingReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoEl, function(result, err){
          if (result) onBarcodeDetected(result.getText());
        });
      });
    } catch(e){ showToast('Scanner error'); closeBarcode(); }
  }).catch(function(){ showToast('Could not load scanner'); closeBarcode(); });
}

function closeBarcode(){
  AppState._barcodeDetecting = false;
  if (AppState._barcodeStream) {
    AppState._barcodeStream.getTracks().forEach(function(t){ t.stop(); });
    AppState._barcodeStream = null;
  }
  var videoEl = document.getElementById('barcode-video');
  if (videoEl) { videoEl.srcObject = null; }
  if (_zxingReader) { try{ _zxingReader.reset(); }catch(e){} _zxingReader=null; }
  var overlay = document.getElementById('barcode-overlay');
  if (overlay) overlay.classList.remove('open');
}

function onBarcodeDetected(value){ var el=document.getElementById(AppState.barcodeTargetField); if(el){el.value=value;el.dispatchEvent(new Event('input'));} closeBarcode(); showToast('Scanned: '+value); }

// UTILITIES
function fmtDate(d){ if(!d)return'---'; var s=String(d).split('T')[0]; var parts=s.split('-'); if(parts.length===3){ var dt=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2])); return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtDateWithTime(d){ if(!d)return'---'; return new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function escHtml(str){ if(!str)return''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg){ var el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(el._timer); el._timer=setTimeout(function(){el.classList.remove('show');},2800); }

// Save guard — prevents double-saves by disabling button during save
function btnSaving(btn) {
  if (!btn) return;
  if (btn._saving) return false; // already saving
  btn._saving = true;
  btn._origText = btn.textContent;
  btn.textContent = 'Saving...';
  btn.disabled = true;
  btn.style.opacity = '0.7';
  return true;
}
function btnDone(btn) {
  if (!btn) return;
  btn._saving = false;
  btn.textContent = btn._origText || 'Save';
  btn.disabled = false;
  btn.style.opacity = '';
}
function runExport(wos){ showToast('Export engine loading...'); }

// =============================================================
// LOCATIONS PANEL
// =============================================================
var LocState = {
  locations: [],
  filtered: [],
  selected: null,
  filter: 'all',
  search: '',
  sort: 'recent',
  map: null,
  markers: [],
  infoWindow: null,
  mapReady: false,
  geofenceCircle: null
};

function renderLocationsPanel() {
  var el = document.getElementById('locations-panel-inner');
  if (!el) return;
  LocState.mapReady = false;
  LocState.selected = null;
  LocState.filter = 'all';
  LocState.search = '';
  LocState.sort = 'recent';
  var inner = '';
  inner += '<div id="loc-shell">';
  inner += '<div id="loc-topbar">';
  inner += '<div style="font-size:15px;font-weight:700">Locations</div>';
  inner += '<div style="display:flex;gap:6px">';
  inner += '<button class="btn-outline" onclick="locAddNew()" style="font-size:12px;padding:5px 12px">+ Add Location</button>';
  inner += '</div></div>';
  inner += '<div id="loc-filter-bar">';
  inner += '<div class="loc-pill active" id="loc-pill-all" onclick="locSetFilter(\'all\')">All</div>';
  inner += '<div class="loc-pill" id="loc-pill-customer" onclick="locSetFilter(\'customer\')">Customer</div>';
  inner += '<div class="loc-pill" id="loc-pill-vendor" onclick="locSetFilter(\'vendor\')">Vendor</div>';
  inner += '<div class="loc-pill" id="loc-pill-personal" onclick="locSetFilter(\'personal\')">Personal</div>';
  inner += '<div class="loc-pill" id="loc-pill-untagged" onclick="locSetFilter(\'untagged\')" style="border-color:#ba7517;color:#854f0b">Untagged</div>';
  inner += '<div class="loc-search"><input type="text" placeholder="Search locations..." oninput="locSearch(this.value)" id="loc-search-input"></div>';
  inner += '<select id="loc-sort-select" onchange="locSetSort(this.value)" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text-secondary);cursor:pointer">';
  inner += '<option value="recent" selected>Recent</option>';
  inner += '<option value="alpha">A–Z</option>';
  inner += '</select>';
  inner += '</div>';
  inner += '<div id="loc-count-bar">Loading...</div>';
  inner += '<div id="loc-body">';
  inner += '<div id="loc-list-col"><div id="loc-list"><div style="padding:20px;color:var(--text-muted);font-size:13px">Loading locations...</div></div></div>';
  inner += '<div id="loc-map-col"><div id="loc-map"></div>';
  inner += '<div id="loc-detail"><div style="padding:14px;color:var(--text-muted);font-size:13px">Select a location to see details</div></div>';
  inner += '</div></div></div>';
  el.innerHTML = inner;
  loadLocations();
}

function loadLocations() {
  sb.get('locations', '?active=eq.true&select=*&order=created_at.desc')
    .then(function(r) {
      if (r.ok) {
        LocState.locations = r.data || [];
        locApplyFilter();
        locInitMap();
      } else {
        var el = document.getElementById('loc-list');
        if (el) el.innerHTML = '<div style="padding:20px;color:var(--danger);font-size:13px">Error loading locations</div>';
      }
    });
}

function locApplyFilter() {
  var f = LocState.filter;
  var s = LocState.search.toLowerCase();
  var matched = LocState.locations.filter(function(loc) {
    var typeMatch = f === 'all' || loc.location_type === f || (f === 'untagged' && !loc.location_type);
    var searchMatch = !s
      || (loc.name || '').toLowerCase().indexOf(s) > -1
      || (loc.address_street || '').toLowerCase().indexOf(s) > -1
      || (loc.city || '').toLowerCase().indexOf(s) > -1;
    return typeMatch && searchMatch;
  });
  // Sort approved locations by selected sort order; pending always float to top
  var pending = matched.filter(function(l){ return l.status === 'pending'; });
  var approved = matched.filter(function(l){ return l.status !== 'pending'; });
  if (LocState.sort === 'alpha') {
    approved.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  } else {
    approved.sort(function(a,b){ return new Date(b.created_at||0) - new Date(a.created_at||0); });
  }
  LocState.filtered = pending.concat(approved);
  locRenderList();
  locUpdateCount();
  if (LocState.mapReady) locRenderMarkers();
}

function locSetSort(val) {
  LocState.sort = val;
  locApplyFilter();
}

function locRenderList() {
  var el = document.getElementById('loc-list');
  if (!el) return;
  if (!LocState.filtered.length) {
    el.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">No locations found</div>';
    return;
  }
  var html = '';
  var shownPendingHeader = false;
  var shownApprovedHeader = false;
  LocState.filtered.forEach(function(loc) {
    var isPending = loc.status === 'pending';
    var type = loc.location_type || 'untagged';
    var icon = type === 'customer' ? 'C' : type === 'vendor' ? 'V' : type === 'personal' ? 'P' : '?';
    var entityName = loc.customers ? (loc.customers.display_name || loc.customers.name || '') : '';
    var addr = [loc.address_street, loc.city, loc.state].filter(Boolean).join(', ');
    var geocodeStatus = loc.geocode_status || 'pending';
    var isSelected = LocState.selected && LocState.selected.id === loc.id;
    var lid = escHtml(loc.id);

    if (isPending && !shownPendingHeader) {
      html += '<div style="padding:6px 12px;font-size:11px;font-weight:600;color:#854f0b;background:#faeeda;border-bottom:1px solid #ef9f27">Needs review</div>';
      shownPendingHeader = true;
    }
    if (!isPending && shownPendingHeader && !shownApprovedHeader) {
      html += '<div style="padding:6px 12px;font-size:11px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border)">Approved</div>';
      shownApprovedHeader = true;
    }

    var rowStyle = isPending ? 'background:#fffbf5;border-left:3px solid #ef9f27' : '';
    html += '<div class="loc-row' + (isSelected ? ' selected' : '') + '" data-lid="' + lid + '" onclick="locSelectById(this.dataset.lid)" style="' + rowStyle + '">';
    html += '<div class="loc-ic ' + type + '" style="font-size:10px;font-weight:700">' + icon + '</div>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div class="loc-name">' + escHtml(loc.name || entityName || 'Unnamed') + '</div>';
    if (addr) html += '<div class="loc-addr">' + escHtml(addr) + '</div>';
    html += '<div class="loc-badges">';
    html += '<span class="loc-badge ' + type + '">' + type.charAt(0).toUpperCase() + type.slice(1) + '</span>';
    if (isPending) {
      html += '<span class="loc-badge pending">Pending review</span>';
    } else {
      html += '<span class="loc-badge ' + geocodeStatus + '">' + geocodeStatus.replace('_', ' ') + '</span>';
    }
    if (loc.is_primary) html += '<span class="loc-badge geocoded">Primary</span>';
    html += '</div></div>';
    if (isPending) {
      html += '<button onclick="event.stopPropagation();locApproveLocation(\'' + lid + '\')" style="font-size:11px;padding:4px 10px;background:#3b6d11;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;flex-shrink:0">Approve</button>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

function locUpdateCount() {
  var el = document.getElementById('loc-count-bar');
  if (!el) return;
  var total = LocState.locations.length;
  var pending = LocState.locations.filter(function(l) { return l.geocode_status === 'pending'; }).length;
  var failed = LocState.locations.filter(function(l) { return l.geocode_status === 'failed'; }).length;
  var untagged = LocState.locations.filter(function(l) { return !l.location_type; }).length;
  var parts = [total + ' locations'];
  if (pending) parts.push(pending + ' pending geocode');
  if (failed) parts.push(failed + ' failed');
  if (untagged) parts.push(untagged + ' untagged');
  el.textContent = parts.join(' · ');
}

function locApproveLocation(id) {
  sb.patch('locations', id, {
    status: 'approved',
    reviewed_by: AppState.userEmail,
    reviewed_at: new Date().toISOString(),
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  }).then(function(r) {
    if (r.ok) {
      var loc = LocState.locations.find(function(l){ return l.id === id; });
      if (loc) {
        loc.status = 'approved';
        loc.reviewed_by = AppState.userEmail;
        loc.reviewed_at = new Date().toISOString();
      }
      locApplyFilter();
      showToast('Location approved');
    } else {
      showToast('Error approving location');
    }
  });
}

function locSetFilter(f) {
  LocState.filter = f;
  ['all', 'customer', 'vendor', 'personal', 'untagged'].forEach(function(p) {
    var el = document.getElementById('loc-pill-' + p);
    if (el) el.classList.toggle('active', p === f);
  });
  locApplyFilter();
}

function locSearch(val) {
  LocState.search = val;
  locApplyFilter();
}

function locSelectById(id) {
  var loc = LocState.locations.find(function(l) { return l.id === id; });
  if (!loc) return;
  LocState.selected = loc;
  locRenderList();
  locRenderDetail(loc);
  if (LocState.mapReady && loc.lat && loc.lng) {
    LocState.map.panTo({ lat: loc.lat, lng: loc.lng });
    LocState.map.setZoom(16);
    locDrawGeofence(loc);
  }
}

function locRenderDetail(loc) {
  var el = document.getElementById('loc-detail');
  if (!el) return;
  var addr = [loc.address_street, loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
  var geofence = loc.geofence_radius || AppState.settings.geofence_radius_default || '100';
  var isDefault = !loc.geofence_radius;
  var lid = escHtml(loc.id);
  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += '<div style="font-size:13px;font-weight:700">' + escHtml(loc.name || 'Unnamed');
  if (loc.is_primary) html += ' <span style="font-size:10px;font-weight:400;color:var(--text-muted)">· Primary</span>';
  html += '</div>';
  html += '<div style="display:flex;gap:6px">';
  html += '<button class="btn-outline" style="font-size:11px;padding:4px 10px" onclick="locEdit(\'' + lid + '\')">Edit</button>';
  html += '<button class="btn-outline" style="font-size:11px;padding:4px 10px" onclick="locVerifyPin(\'' + lid + '\')">Verify pin</button>';
  html += '<button class="btn-outline" style="font-size:11px;padding:4px 10px;color:var(--danger);border-color:var(--danger)" onclick="locDeleteLocation(\'' + lid + '\')">Delete</button>';
  html += '</div></div>';
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
  html += locDRow('Address', escHtml(addr || '-'));
  html += locDRow('Type', (loc.location_type || 'Untagged') + (loc.is_primary ? ' · Primary' : ''));
  html += locDRow('Geocode', loc.geocode_status || 'pending');
  html += locDRow('Coordinates', loc.lat ? loc.lat.toFixed(5) + ' N, ' + Math.abs(loc.lng).toFixed(5) + ' W' : '-');
  html += '<tr><td style="padding:3px 0;color:var(--text-secondary);width:110px">Geofence</td>';
  html += '<td style="padding:3px 0">';
  html += '<input type="number" value="' + geofence + '" min="10" step="1" ';
  html += 'style="width:65px;font-size:12px;padding:2px 5px;border:1px solid var(--border);border-radius:3px;background:var(--bg)" ';
  html += 'onchange="locSaveGeofence(\'' + lid + '\',this.value)"> m ';
  if (isDefault) {
    html += '<span style="font-size:10px;color:var(--text-muted)">(system default)</span>';
  } else {
    html += '<a href="#" style="font-size:10px" onclick="locResetGeofence(\'' + lid + '\');return false">reset to default</a>';
  }
  html += '</td></tr>';
  html += '</table>';
  // GPS dead zone toggle
  html += '<div style="margin-top:10px;padding:8px 0;border-top:1px solid var(--border)">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
  html += '<input type="checkbox" id="loc-dead-zone-cb"' + (loc.gps_dead_zone ? ' checked' : '') + ' onchange="locSaveDeadZone(\'' + lid + '\',this.checked)" style="cursor:pointer">';
  html += '<label for="loc-dead-zone-cb" style="font-size:12px;font-weight:600;cursor:pointer">Known GPS dead zone</label>';
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Signal gaps at this location are absorbed silently regardless of duration. Use for concrete basements, vaults, or other known no-signal areas.</div>';
  if (loc.gps_dead_zone) {
    html += '<input type="text" value="' + escHtml(loc.gps_dead_zone_note || '') + '" placeholder="Note (e.g. Concrete basement, no signal expected)" onchange="locSaveDeadZoneNote(\'' + lid + '\',this.value)" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-sizing:border-box">';
  }
  html += '</div>';
  el.innerHTML = html;
}

function locDRow(label, val) {
  return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:3px 0;color:var(--text-secondary);width:110px">' + label + '</td><td style="padding:3px 0;font-weight:600">' + val + '</td></tr>';
}

function locSaveGeofence(id, val) {
  var radius = parseInt(val);
  if (isNaN(radius) || radius < 10) return;
  sb.patch('locations', id, { geofence_radius: radius, modified_by: AppState.userEmail, modified_at: new Date().toISOString() })
    .then(function(r) {
      if (r.ok) {
        var loc = LocState.locations.find(function(l) { return l.id === id; });
        if (loc) { loc.geofence_radius = radius; locDrawGeofence(loc); }
        showToast('Geofence saved');
      }
    });
}

function locResetGeofence(id) {
  sb.patch('locations', id, { geofence_radius: null, modified_by: AppState.userEmail, modified_at: new Date().toISOString() })
    .then(function(r) {
      if (r.ok) {
        var loc = LocState.locations.find(function(l) { return l.id === id; });
        if (loc) { loc.geofence_radius = null; locRenderDetail(loc); locDrawGeofence(loc); showToast('Reset to default'); }
      }
    });
}

function locSaveDeadZone(id, val) {
  sb.patch('locations', id, { gps_dead_zone: val, modified_by: AppState.userEmail, modified_at: new Date().toISOString() })
    .then(function(r) {
      if (r.ok) {
        var loc = LocState.locations.find(function(l){ return l.id === id; });
        if (loc) { loc.gps_dead_zone = val; locRenderDetail(loc); }
        showToast(val ? 'Marked as GPS dead zone' : 'Dead zone flag removed');
      }
    });
}

function locSaveDeadZoneNote(id, val) {
  sb.patch('locations', id, { gps_dead_zone_note: val, modified_by: AppState.userEmail, modified_at: new Date().toISOString() })
    .then(function(r) {
      if (r.ok) {
        var loc = LocState.locations.find(function(l){ return l.id === id; });
        if (loc) loc.gps_dead_zone_note = val;
        showToast('Note saved');
      }
    });
}

function locInitMap() {
  if (typeof google === 'undefined' || !google.maps) {
    locLoadMapsAPI(function() { locInitMap(); });
    return;
  }
  var mapEl = document.getElementById('loc-map');
  if (!mapEl) return;
  LocState.map = new google.maps.Map(mapEl, {
    zoom: 10,
    center: { lat: 38.77, lng: -75.14 },
    mapTypeControl: true,
    mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU },
    streetViewControl: false,
    fullscreenControl: false
  });
  LocState.infoWindow = new google.maps.InfoWindow();
  LocState.mapReady = true;
  locRenderMarkers();
}

function locLoadMapsAPI(cb) {
  if (typeof google !== 'undefined' && google.maps) { cb(); return; }
  if (document.getElementById('gmaps-script')) {
    var wait = setInterval(function() {
      if (typeof google !== 'undefined' && google.maps) { clearInterval(wait); cb(); }
    }, 150);
    return;
  }
  var mapsKey = AppState.settings.google_maps_js_key || '';
  if (!mapsKey) { showToast('Google Maps key not configured in settings'); return; }
  window._gmapsReady = cb;
  var s = document.createElement('script');
  s.id = 'gmaps-script';
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + mapsKey + '&libraries=places&v=beta&callback=_gmapsReady';
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

function locRenderMarkers() {
  if (!LocState.mapReady) return;
  LocState.markers.forEach(function(m) { m.setMap(null); });
  LocState.markers = [];
  if (LocState.geofenceCircle) { LocState.geofenceCircle.setMap(null); LocState.geofenceCircle = null; }
  var bounds = new google.maps.LatLngBounds();
  var hasPoints = false;
  LocState.filtered.forEach(function(loc) {
    if (!loc.lat || !loc.lng) return;
    hasPoints = true;
    var color = loc.location_type === 'customer' ? '#378ADD'
      : loc.location_type === 'vendor' ? '#639922'
      : loc.location_type === 'personal' ? '#BA7517'
      : '#888780';
    var isSelected = LocState.selected && LocState.selected.id === loc.id;
    var marker = new google.maps.Marker({
      position: { lat: loc.lat, lng: loc.lng },
      map: LocState.map,
      title: loc.name || '',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isSelected ? 10 : 7,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      }
    });
    marker.locId = loc.id;
    marker.addListener('click', function() {
      locSelectById(loc.id);
      LocState.infoWindow.setContent(
        '<div style="font-size:12px;font-weight:600;padding:2px 0">' + escHtml(loc.name || '') + '</div>'
        + '<div style="font-size:11px;color:#666">' + escHtml(loc.address_street || '') + '</div>'
      );
      LocState.infoWindow.open(LocState.map, marker);
    });
    LocState.markers.push(marker);
    bounds.extend({ lat: loc.lat, lng: loc.lng });
  });
  if (hasPoints && LocState.filtered.length > 1) LocState.map.fitBounds(bounds);
}

function locDrawGeofence(loc) {
  if (!LocState.mapReady || !loc || !loc.lat || !loc.lng) return;
  if (LocState.geofenceCircle) LocState.geofenceCircle.setMap(null);
  var radius = parseInt(loc.geofence_radius || AppState.settings.geofence_radius_default || 100);
  LocState.geofenceCircle = new google.maps.Circle({
    map: LocState.map,
    center: { lat: loc.lat, lng: loc.lng },
    radius: radius,
    fillColor: '#378ADD',
    fillOpacity: 0.1,
    strokeColor: '#378ADD',
    strokeOpacity: 0.35,
    strokeWeight: 1.5
  });
}

function locVerifyPin(id) {
  var loc = LocState.locations.find(function(l) { return l.id === id; });
  if (!loc || !LocState.mapReady) { showToast('Map not ready'); return; }
  if (!loc.lat || !loc.lng) { showToast('No coordinates to verify'); return; }
  LocState.map.setZoom(18);
  LocState.map.panTo({ lat: loc.lat, lng: loc.lng });
  locDrawGeofence(loc);
  var marker = LocState.markers.find(function(m) { return m.locId === id; });
  if (!marker) return;
  marker.setDraggable(true);
  showToast('Drag the pin to correct position, then release to save');
  google.maps.event.addListenerOnce(marker, 'dragend', function(e) {
    var newLat = e.latLng.lat();
    var newLng = e.latLng.lng();
    sb.patch('locations', id, {
      lat: newLat,
      lng: newLng,
      geocode_status: 'office_verified',
      modified_by: AppState.userEmail,
      modified_at: new Date().toISOString()
    }).then(function(r) {
      if (r.ok) {
        loc.lat = newLat;
        loc.lng = newLng;
        loc.geocode_status = 'office_verified';
        marker.setDraggable(false);
        locRenderDetail(loc);
        locRenderList();
        locDrawGeofence(loc);
        showToast('Pin verified and saved');
      } else {
        showToast('Error saving pin');
      }
    });
  });
}

function locEdit(id) {
  var loc = LocState.locations.find(function(l) { return l.id === id; });
  if (!loc) return;
  locRenderEditPanel(loc, false);
}

function locAddNew() {
  locRenderEditPanel(null, false);
}

function locAddNewAtCoords(lat, lng, address) {
  // Pre-filled add — used from Field Travel Log "add another here" prompt
  locRenderEditPanel(null, false, {lat: lat, lng: lng, address_street: address});
}

function locRenderEditPanel(loc, isNew, prefill) {
  var el = document.getElementById('loc-detail');
  if (!el) return;
  var isEdit = !!loc;
  prefill = prefill || {};
  var types = ['customer','vendor','personal','fuel','lunch','other'];
  var typeOptions = types.map(function(t){
    var sel = isEdit ? (loc.location_type === t) : (t === 'customer');
    return '<option value="' + t + '"' + (sel?' selected':'') + '>' + t.charAt(0).toUpperCase()+t.slice(1) + '</option>';
  }).join('');
  var geofence = isEdit ? (loc.geofence_radius || AppState.settings.geofence_radius_default || '100') : (AppState.settings.geofence_radius_default || '100');
  var isDefaultGeo = isEdit ? !loc.geofence_radius : true;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
  html += '<div style="font-size:13px;font-weight:700">' + (isEdit ? 'Edit location' : 'Add location') + '</div>';
  html += '<div style="display:flex;gap:5px">';
  html += '<button class="btn-outline" style="font-size:11px;padding:4px 10px" onclick="locCancelEdit()">Cancel</button>';
  if (isEdit) html += '<button class="btn-outline" style="font-size:11px;padding:4px 10px;color:var(--danger);border-color:var(--danger)" onclick="locDeleteLocation(\'' + escHtml(loc.id) + '\')">Delete</button>';
  html += '<button class="btn-dark" style="font-size:11px;padding:4px 10px" onclick="locSaveEdit(\'' + (isEdit?escHtml(loc.id):'') + '\')">Save</button>';
  html += '</div></div>';

  // Name
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:3px">Location name *</label>';
  html += '<input type="text" id="loc-edit-name" value="' + escHtml(isEdit?loc.name||'':prefill.name||'') + '" placeholder="e.g. Dover Mall, United Refrigeration" style="width:100%;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"></div>';

  // Type + Label
  html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
  html += '<div style="flex:1"><label style="font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:3px">Type</label>';
  html += '<select id="loc-edit-type" onchange="locEditTypeChange()" style="width:100%;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">' + typeOptions + '</select></div>';
  html += '<div style="flex:1"><label style="font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:3px">Label</label>';
  html += '<input type="text" id="loc-edit-label" value="' + escHtml(isEdit?loc.name||'Primary':'Primary') + '" placeholder="Primary, Warehouse..." style="width:100%;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"></div>';
  html += '</div>';

  // Customer search (shown when type = customer)
  var custName = '';
  if (isEdit && loc.customer_id) {
    var cust = AppState.customers.find(function(c){return c.id===loc.customer_id;});
    if (cust) custName = getCustName(cust);
  }
  var custDisplay = (isEdit && loc.location_type === 'customer') || (!isEdit) ? '' : 'display:none';
  html += '<div id="loc-edit-cust-row" style="margin-bottom:8px;' + custDisplay + '">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:3px">Customer</label>';
  html += '<input type="text" id="loc-edit-cust-input" value="' + escHtml(custName) + '" placeholder="Search customers..." oninput="locEditCustSearch(this.value)" style="width:100%;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '<input type="hidden" id="loc-edit-cust-id" value="' + escHtml(isEdit?loc.customer_id||'':'') + '">';
  html += '<div id="loc-edit-cust-list" style="border:1px solid var(--border);border-top:none;border-radius:0 0 3px 3px;background:var(--surface);max-height:120px;overflow-y:auto;display:none"></div>';
  html += '</div>';

  // Address
  html += '<div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;margin-top:4px">Address</div>';
  html += '<div style="margin-bottom:6px"><input type="text" id="loc-edit-street" value="' + escHtml(isEdit?loc.address_street||'':prefill.address_street||'') + '" placeholder="Street address" style="width:100%;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"></div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:8px">';
  html += '<input type="text" id="loc-edit-city" value="' + escHtml(isEdit?loc.city||'':'') + '" placeholder="City" style="flex:2;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '<input type="text" id="loc-edit-state" value="' + escHtml(isEdit?loc.state||'':'DE') + '" placeholder="ST" style="width:40px;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '<input type="text" id="loc-edit-zip" value="' + escHtml(isEdit?loc.zip||'':'') + '" placeholder="Zip" style="width:70px;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '</div>';

  // Geofence
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--text-secondary);width:80px;flex-shrink:0">Geofence</label>';
  html += '<input type="number" id="loc-edit-geofence" value="' + geofence + '" min="10" step="1" style="width:65px;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"> m ';
  if (isDefaultGeo) {
    html += '<span style="font-size:10px;color:var(--text-muted)">(default)</span>';
  } else {
    html += '<a href="#" style="font-size:10px" onclick="locEditResetGeofence();return false">reset</a>';
  }
  html += '</div>';

  // Settings checkboxes
  html += '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;padding:8px;background:var(--bg);border-radius:3px;border:1px solid var(--border)">';
  html += '<label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer"><input type="checkbox" id="loc-edit-billable"' + ((isEdit?loc.billable_default:true)?' checked':'') + '> Billable by default</label>';
  html += '<label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer"><input type="checkbox" id="loc-edit-requires-wo"' + ((isEdit?loc.requires_wo:false)?' checked':'') + '> Requires work order</label>';
  html += '<label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer"><input type="checkbox" id="loc-edit-private"' + ((isEdit?loc.is_personal:false)?' checked':'') + '> Private (admin only)</label>';
  html += '</div>';

  // Coordinates — v4.46 manual entry + geocode trigger
  html += '<div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;margin-top:4px">Coordinates</div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">';
  html += '<input type="number" id="loc-edit-lat" step="0.00001" placeholder="Latitude (e.g. 38.69624)" value="' + (isEdit && loc.lat ? loc.lat : '') + '" style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '<input type="number" id="loc-edit-lng" step="0.00001" placeholder="Longitude (e.g. -75.36803)" value="' + (isEdit && loc.lng ? loc.lng : '') + '" style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg)">';
  html += '</div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:10px">';
  html += '<button onclick="locUseMyLocation()" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface);cursor:pointer">&#x1F4CD; Use my location</button>';
  html += '<div style="font-size:10px;color:var(--text-muted);align-self:center">or paste coordinates from Google Maps (right-click a spot → copy coords)</div>';
  html += '</div>';

  // Nearby locations
  if (isEdit && loc.lat && loc.lng) {
    var nearby = LocState.locations.filter(function(l) {
      if (l.id === loc.id || !l.lat || !l.lng) return false;
      var dist = locHaversineMeters(loc.lat, loc.lng, l.lat, l.lng);
      return dist <= 200;
    });
    if (nearby.length) {
      html += '<div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:5px;border-top:1px solid var(--border);padding-top:8px">Nearby locations (' + nearby.length + ')</div>';
      nearby.forEach(function(n) {
        var dist = Math.round(locHaversineMeters(loc.lat, loc.lng, n.lat, n.lng));
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:11px">';
        html += '<span>' + escHtml(n.name||'') + ' <span style="color:var(--text-muted)">' + dist + 'm away</span></span>';
        html += '<button onclick="locSelectById(\'' + n.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface);cursor:pointer">View</button>';
        html += '</div>';
      });
      html += '<button onclick="locAddNewAtCoords(' + loc.lat + ',' + loc.lng + ',\'' + escHtml(loc.address_street||'').replace(/'/g,"\\'") + '\')" style="font-size:11px;padding:4px 10px;border:1px dashed var(--border);border-radius:3px;background:var(--surface);cursor:pointer;width:100%;margin-top:6px">+ Add another location here</button>';
    }
  }

  el.innerHTML = html;
}

function locHaversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2-lat1)*Math.PI/180;
  var dLng = (lng2-lng1)*Math.PI/180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function locEditTypeChange() {
  var type = document.getElementById('loc-edit-type');
  var custRow = document.getElementById('loc-edit-cust-row');
  if (!type || !custRow) return;
  custRow.style.display = type.value === 'customer' ? '' : 'none';
}

function locEditCustSearch(val) {
  var list = document.getElementById('loc-edit-cust-list');
  var hidEl = document.getElementById('loc-edit-cust-id');
  if (hidEl) hidEl.value = '';
  if (!val || val.length < 1) { if(list) list.style.display='none'; return; }
  var q = val.toLowerCase();
  var matches = AppState.customers.filter(function(c) {
    return c.active!==false && (c.name.toLowerCase().indexOf(q)>=0 || (c.display_name||'').toLowerCase().indexOf(q)>=0);
  }).slice(0,8);
  if (!matches.length) { list.style.display='none'; return; }
  list.innerHTML = matches.map(function(c) {
    return '<div style="padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" onmousedown="locEditSelectCust(\'' + c.id + '\',\'' + escHtml(getCustName(c)).replace(/'/g,"\\'") + '\')">' + escHtml(getCustName(c)) + '</div>';
  }).join('');
  list.style.display = '';
}

function locEditSelectCust(id, name) {
  var inp = document.getElementById('loc-edit-cust-input');
  var hid = document.getElementById('loc-edit-cust-id');
  var list = document.getElementById('loc-edit-cust-list');
  if (inp) inp.value = name;
  if (hid) hid.value = id;
  if (list) list.style.display = 'none';
}

function locEditResetGeofence() {
  var el = document.getElementById('loc-edit-geofence');
  if (el) el.value = AppState.settings.geofence_radius_default || '100';
}

function locCancelEdit() {
  var loc = LocState.selected;
  if (loc) {
    locRenderDetail(loc);
  } else {
    var el = document.getElementById('loc-detail');
    if (el) el.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:13px">Select a location to see details</div>';
  }
}

// locUseMyLocation — v4.46 — fills lat/lng fields from browser GPS
function locUseMyLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not available in this browser'); return; }
  showToast('Getting your location...');
  navigator.geolocation.getCurrentPosition(function(pos) {
    var latEl = document.getElementById('loc-edit-lat');
    var lngEl = document.getElementById('loc-edit-lng');
    if (latEl) latEl.value = pos.coords.latitude.toFixed(5);
    if (lngEl) lngEl.value = pos.coords.longitude.toFixed(5);
    showToast('Location captured — save to apply');
  }, function(err) {
    showToast('Could not get location: ' + err.message);
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function locSaveEdit(id) {
  var name = (document.getElementById('loc-edit-name')||{}).value||'';
  var type = (document.getElementById('loc-edit-type')||{}).value||'other';
  var street = (document.getElementById('loc-edit-street')||{}).value||'';
  var city = (document.getElementById('loc-edit-city')||{}).value||'';
  var state = (document.getElementById('loc-edit-state')||{}).value||'';
  var zip = (document.getElementById('loc-edit-zip')||{}).value||'';
  var geofence = parseInt((document.getElementById('loc-edit-geofence')||{}).value||'0');
  var custId = (document.getElementById('loc-edit-cust-id')||{}).value||null;
  var billable = !!(document.getElementById('loc-edit-billable')||{}).checked;
  var requiresWo = !!(document.getElementById('loc-edit-requires-wo')||{}).checked;
  var isPrivate = !!(document.getElementById('loc-edit-private')||{}).checked;
  // v4.46 — manual coordinate entry
  var manualLat = parseFloat((document.getElementById('loc-edit-lat')||{}).value||'');
  var manualLng = parseFloat((document.getElementById('loc-edit-lng')||{}).value||'');
  var hasManualCoords = !isNaN(manualLat) && !isNaN(manualLng) && manualLat !== 0 && manualLng !== 0;

  if (!name.trim()) { showToast('Location name is required'); return; }

  var payload = {
    name: name.trim(),
    location_type: ['customer','vendor','personal'].indexOf(type) >= 0 ? type : 'personal',
    address_street: street || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
    geofence_radius: geofence >= 10 ? geofence : null,
    billable_default: billable,
    requires_wo: requiresWo,
    is_personal: isPrivate,
    customer_id: custId || null,
    modified_by: AppState.userEmail,
    modified_at: new Date().toISOString()
  };

  // v4.46 — apply manual coordinates if entered
  if (hasManualCoords) {
    payload.lat = manualLat;
    payload.lng = manualLng;
    payload.geocode_status = 'office_verified';
  }

  if (id) {
    // Update existing
    var existingLoc = LocState.locations.find(function(l){ return l.id === id; });
    var addressChanged = existingLoc && (
      existingLoc.address_street !== (street||null) ||
      existingLoc.city !== (city||null) ||
      existingLoc.state !== (state||null)
    );
    var isOfficeVerified = existingLoc && existingLoc.geocode_status === 'office_verified';
    sb.patch('locations', id, payload).then(function(r) {
      if (r.ok) {
        var loc = LocState.locations.find(function(l){ return l.id === id; });
        if (loc) Object.assign(loc, payload);
        LocState.selected = loc;
        locRenderList();
        locRenderDetail(loc);
        if (LocState.mapReady) locRenderMarkers();
        if (hasManualCoords) {
          showToast('Location saved — coordinates set');
        } else if (addressChanged && !isOfficeVerified && street && city) {
          var fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
          showToast('Location saved — re-geocoding address...');
          geocodeLocationById(id, fullAddr);
        } else if (addressChanged && isOfficeVerified) {
          showToast('Location saved — pin not moved (office verified). Use Verify Pin to update manually.');
        } else {
          showToast('Location saved');
        }
      } else showToast('Error saving location');
    });
  } else {
    // Insert new
    payload.active = true;
    payload.is_primary = true;
    payload.geocode_status = 'pending';
    payload.created_by = AppState.userEmail;
    sb.post('locations', payload).then(function(r) {
      if (r.ok && r.data && r.data.length) {
        var newLoc = r.data[0];
        LocState.locations.push(newLoc);
        LocState.locations.sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
        LocState.selected = newLoc;
        locApplyFilter();
        locRenderDetail(newLoc);
        if (LocState.mapReady) locRenderMarkers();
        showToast('Location added');
        // Geocode if address provided
        if (street && city) {
          var fullAddr = [street, city, state, zip].filter(Boolean).join(', ');
          geocodeCustomer(newLoc.id, fullAddr);
        }
      } else showToast('Error adding location');
    });
  }
}

function locDeleteLocation(id) {
  if (!confirm('Deactivate this location? It will be hidden but historical data is preserved.')) return;
  sb.patch('locations', id, {active: false, modified_by: AppState.userEmail, modified_at: new Date().toISOString()})
    .then(function(r) {
      if (r.ok) {
        LocState.locations = LocState.locations.filter(function(l){ return l.id !== id; });
        LocState.selected = null;
        locApplyFilter();
        var el = document.getElementById('loc-detail');
        if (el) el.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:13px">Location deactivated</div>';
        if (LocState.mapReady) locRenderMarkers();
        showToast('Location deactivated');
      } else showToast('Error deactivating location');
    });
}


/* MOVED TO field-travel-log.js — v4.41 — Aug 18 2026
   Desktop Field Travel Log: DRState, all dr* functions
   Includes: timezone helpers, week/day nav, stop detection wiring,
   timeline render, merge tool, identify stop, tag overlay,
   Time & Billing modal, map, day actions (accept/kickback/reopen)
   Search field-travel-log.js for any dr* function.
*/


// =============================================================
// TIMECARD — restored from v4.1
// =============================================================

function initMobileTimecard(){
  if(!AppState.timecardWeekStart){
    var today=new Date(); var dow=today.getDay();
    var mon=new Date(today); mon.setDate(today.getDate()-(dow===0?6:dow-1)); mon.setHours(0,0,0,0);
    AppState.timecardWeekStart=mon;
  }
  var rd=document.getElementById('timecard-reviewed-mobile');
  if(rd) rd.textContent=AppState.settings.timecard_reviewed_through||'---';
  renderMobileTimecard();
}

function renderMobileTimecard(){
  var content = document.getElementById('timecard-content-mobile'); if(!content) return;
  var techSel = document.getElementById('timecard-tech-mobile');
  if (techSel && techSel.options.length === 0) {
    AppState.technicians.forEach(function(t){
      var opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      techSel.appendChild(opt);
    });
    var myTech = AppState.technicians.find(function(t){ return t.name && AppState.userEmail && t.name.toLowerCase().indexOf(AppState.userEmail.split('@')[0].toLowerCase()) >= 0; });
    if (myTech) techSel.value = myTech.id;
  }
  var techId = techSel ? techSel.value : '';
  var today = todayStr();
  var sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate()-13);
  var fromDate = sevenDaysAgo.getFullYear()+'-'+String(sevenDaysAgo.getMonth()+1).padStart(2,'0')+'-'+String(sevenDaysAgo.getDate()).padStart(2,'0');
  content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</div>';
  var query = '?entry_date=gte.'+fromDate+'&active=eq.true&order=entry_date.desc&select=*,technicians(name),hours_types(name),work_orders(wo_number,title,customers(name,display_name))';
  if (techId) query += '&tech_id=eq.'+techId;
  sb.get('hours_entries', query).then(function(r){
    var entries = r.ok ? r.data||[] : [];
    if (!entries.length) {
      content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><div style="font-size:32px;margin-bottom:8px">&#9200;</div><div>No entries in the last 2 weeks</div><div style="margin-top:12px"><button class="btn-dark" onclick="openTimecardEntryModal(null)">+ Add First Entry</button></div></div>';
      return;
    }
    var byDate = {};
    entries.forEach(function(e){ var d = e.entry_date; if (!byDate[d]) byDate[d] = []; byDate[d].push(e); });
    var html = '';
    Object.keys(byDate).sort().reverse().forEach(function(date){
      var dayEntries = byDate[date];
      var dayTotal = dayEntries.reduce(function(s,e){ return s+parseFloat(e.hours||0); },0);
      var isToday = date === today;
      var d = new Date(date+'T12:00:00');
      var dayLabel = isToday ? 'Today' : d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      html += '<div style="margin-bottom:12px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:2px solid var(--border);margin-bottom:6px">';
      html += '<span style="font-size:13px;font-weight:700;color:'+(isToday?'var(--header-bg)':'var(--text-primary)')+'">'+dayLabel+'</span>';
      html += '<span style="font-size:13px;font-weight:600">'+dayTotal.toFixed(1)+' hrs</span></div>';
      dayEntries.forEach(function(e){
        var wo = e.work_orders;
        var cust = wo ? getCustName(wo.customers) : '';
        var typeName = (e.hours_types && e.hours_types.name)||'';
        html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between" onclick="tcMobileEditEntry(\''+e.id+'\')">';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-size:13px;font-weight:600">'+(wo?escHtml(wo.wo_number):'&#8212;')+' <span style="font-size:12px;color:var(--text-muted)">'+escHtml(cust)+'</span></div>';
        html += '<div style="font-size:12px;color:var(--text-muted)">'+(wo?escHtml(wo.title||''):'')+(typeName?' &middot; '+escHtml(typeName):'')+'</div>';
        html += '</div>';
        html += '<div style="text-align:right;flex-shrink:0;margin-left:8px">';
        html += '<div style="font-size:15px;font-weight:700">'+parseFloat(e.hours||0).toFixed(1)+'</div>';
        html += '<div style="font-size:10px;color:var(--text-muted)">hrs</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });
    content.innerHTML = html;
  });
}

function tcMobileEditEntry(eid) {
  var e = AppState.hoursEntries.find(function(x){ return x.id===eid; });
  if (!e) { showToast('Entry not found'); return; }
  if (e.work_order_id) openWODetail(e.work_order_id);
}

function markTimecardReviewed(){
  var pickEl = document.getElementById('timecard-reviewed-pick') || document.getElementById('timecard-reviewed-pick-mobile');
  var today = todayStr();
  var date = (pickEl && pickEl.value) ? pickEl.value : today;
  sb.patchWhere('settings','key=eq.timecard_reviewed_through',{value:date}).then(function(){
    AppState.settings.timecard_reviewed_through=date;
    ['timecard-reviewed-date','timecard-reviewed-mobile'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent=date;});
    showToast('Marked reviewed through '+date);
  });
}

function initTimecard(){
  if(!AppState.timecardWeekStart){
    var today=new Date(); var dow=today.getDay();
    var mon=new Date(today); mon.setDate(today.getDate()-(dow===0?6:dow-1)); mon.setHours(0,0,0,0);
    AppState.timecardWeekStart=mon;
  }
  var el=document.getElementById('timecard-tech');
  if(el&&el.options.length<=1){
    AppState.technicians.forEach(function(t){
      var o=document.createElement('option');
      o.value=t.id;
      o.textContent=(t.color?'\u25CF ':'')+t.name;
      if(t.color) o.style.color=t.color;
      el.appendChild(o);
    });
    var defTech=typeof getDefaultTechId==='function'?getDefaultTechId():'';
    if(defTech&&el) el.value=defTech;
  }
  var rd=document.getElementById('timecard-reviewed-date'); if(rd) rd.textContent=AppState.settings.timecard_reviewed_through||'---';
  var rp=document.getElementById('timecard-reviewed-pick'); if(rp && !rp.value) rp.value=todayStr();
  populateTCYearDropdown();
  renderTimecard();
}

function timecardNav(dir){
  var d=new Date(AppState.timecardWeekStart); d.setDate(d.getDate()+dir*7);
  AppState.timecardWeekStart=d;
  if(document.getElementById('timecard-content')) renderTimecard();
  if(document.getElementById('timecard-content-mobile')) renderMobileTimecard();
}

function renderTimecard(){
  var ws=AppState.timecardWeekStart;
  var we=new Date(ws); we.setDate(ws.getDate()+6);
  var days=[]; for(var dd=0;dd<7;dd++){var d=new Date(ws);d.setDate(ws.getDate()+dd);days.push(d);}
  var dayLabels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var rangeEl=document.getElementById('timecard-range');
  if(rangeEl) rangeEl.textContent=ws.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' - '+we.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  var techEl=document.getElementById('timecard-tech');
  var selTechId=techEl?techEl.value:'';
  var selTech=AppState.technicians.find(function(t){return t.id===selTechId;});
  var techColor=selTech&&selTech.color?selTech.color:null;
  var ctrlBar=document.querySelector('#desktop-panel-timecard .timecard-controls');
  if(ctrlBar) ctrlBar.style.background=techColor?techColor+'22':'';
  var watermark=AppState.settings.timecard_reviewed_through||'2020-01-01';
  var fromDate=ws.getFullYear()+'-'+String(ws.getMonth()+1).padStart(2,'0')+'-'+String(ws.getDate()).padStart(2,'0');
  var toDate=we.getFullYear()+'-'+String(we.getMonth()+1).padStart(2,'0')+'-'+String(we.getDate()).padStart(2,'0');
  var content=document.getElementById('timecard-content'); if(!content) return;
  var techId=(document.getElementById('timecard-tech')&&document.getElementById('timecard-tech').value)||'';
  var query='?entry_date=gte.'+fromDate+'&entry_date=lte.'+toDate+'&active=eq.true&select=*,technicians(name,id),hours_types(name)';
  if(techId) query+='&tech_id=eq.'+techId;
  sb.get('hours_entries',query).then(function(r){
    var entries=r.ok?r.data||[]:[];
    var woMap={};
    entries.forEach(function(e){
      if(!woMap[e.work_order_id]) woMap[e.work_order_id]={wo:AppState.workOrders.find(function(w){return w.id===e.work_order_id;}),days:{}};
      var key=e.entry_date;
      woMap[e.work_order_id].days[key]=(woMap[e.work_order_id].days[key]||0)+parseFloat(e.hours||0);
    });
    var dayTotals={};
    days.forEach(function(d){dayTotals[d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')]=0;});
    Object.keys(woMap).forEach(function(wid){
      var row=woMap[wid];
      Object.keys(row.days).forEach(function(dk){if(dk in dayTotals) dayTotals[dk]+=row.days[dk];});
    });
    var grandTotal=Object.keys(dayTotals).reduce(function(s,k){return s+dayTotals[k];},0);
    var html='<table class="timecard-table"><thead><tr><th class="wo-col">Work Order';
    var anyReviewed=days.some(function(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')<=watermark;});
    if(anyReviewed) html+='<br><span style="font-size:9px;color:#e67e22;font-weight:400">&#10003; reviewed through '+watermark+'</span>';
    html+='</th>';
    days.forEach(function(d,i){
      var dStr=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      var isRev=dStr<=watermark;
      html+='<th style="'+(isRev?'background:#e67e2210;':'')+'">' +dayLabels[i]+'<br><span style="font-weight:400;font-size:10px">'+d.getDate()+'</span>';
      if(isRev) html+='<br><span style="font-size:9px;color:#e67e22">&#10003; reviewed</span>';
      html+='<br><button class="tc-add-btn" onclick="openTimecardEntryModal(\''+dStr+'\')">'+'+ Add'+'</button>';
      html+='</th>';
    });
    html+='<th>Total</th></tr></thead><tbody>';
    if(!Object.keys(woMap).length){
      html+='<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">No hours this week</td></tr>';
    } else {
      Object.keys(woMap).forEach(function(wid){
        var row=woMap[wid];
        var woTotal=Object.keys(row.days).reduce(function(s,k){return s+row.days[k];},0);
        var wo=row.wo;
        var isProcessed = wo && isProcessedStatus(wo.status);
        html+='<tr style="'+(isProcessed?'opacity:0.45;background:#f5f5f5':'')+'"><td class="wo-col">';
        if(wo){
          html+='<a href="#" onclick="event.preventDefault();openWODetail(\''+wo.id+'\')" style="display:inline-block;background:'+(isProcessed?'#aaa':'var(--header-bg)')+';color:#fff;border-radius:3px;padding:1px 7px;font-size:12px;font-weight:600;text-decoration:none;margin-right:4px">'+wo.wo_number+'</a>'+escHtml(getCustName(wo.customers)||'')+'<br>';
          html+='<span style="font-size:11px;color:var(--text-muted)">'+escHtml(wo.title||'')+(isProcessed?' <span style="font-size:10px;color:#aaa">(processed)</span>':'')+'</span>';
        } else html+='---';
        html+='</td>';
        days.forEach(function(d){
          var key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          var hh=row.days[key];
          var isRev=key<=watermark;
          var dayEnts=entries.filter(function(e){return e.work_order_id===wid&&e.entry_date===key;});
          var eid=dayEnts.length===1?dayEnts[0].id:'';
          var revStyle=isRev?'background:#e67e2210;':'';
          var clickAttr=(hh&&eid)?' onclick="tcInlineEdit(event,\''+eid+'\','+hh+')" title="Click to edit"':'';
          var cursorStyle=(hh&&eid)?';cursor:pointer':'';
          html+='<td class="hours-cell'+(hh?'':' empty')+'" style="'+revStyle+cursorStyle+'"'+clickAttr+'>'+(hh?'<span class="tc-hrs-val">'+hh.toFixed(1)+'</span>':'---')+'</td>';
        });
        html+='<td class="hours-cell"><strong>'+woTotal.toFixed(1)+'</strong></td></tr>';
      });
    }
    html+='<tr class="total-row"><td>TOTAL</td>';
    days.forEach(function(d){
      var key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      var isRev=key<=watermark;
      html+='<td class="hours-cell" style="'+(isRev?'background:#e67e2210;color:var(--text-muted);':'')+'">'+(dayTotals[key]>0?dayTotals[key].toFixed(1):'---')+'</td>';
    });
    html+='<td class="hours-cell">'+grandTotal.toFixed(1)+'</td></tr></tbody></table>';
    html+='<div style="padding:10px 0"><button class="btn-dark" style="font-size:13px;padding:6px 14px" onclick="openTimecardEntryModal(null)">+ Add Entry</button></div>';
    content.innerHTML=html;
  });
}

function openTimecardEntryModal(dateStr) {
  var modal = document.getElementById('tc-entry-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  var techEl = document.getElementById('timecard-tech');
  var techId = techEl ? techEl.value : '';
  renderTCModalStep1(dateStr, techId);
}

function closeTimecardEntryModal() {
  var modal = document.getElementById('tc-entry-modal');
  if (modal) modal.style.display = 'none';
}

function renderTCModalStep1(dateStr, techId) {
  var techOptions = AppState.technicians.map(function(t) {
    return '<option value="'+t.id+'"'+(t.id===techId?' selected':'')+'>'+escHtml(t.name)+'</option>';
  }).join('');
  var html = '<div class="form-row"><label class="form-label">Date *</label>'
    + '<input type="date" id="tc-date" value="'+(dateStr||'')+'" autocomplete="off"></div>'
    + '<div class="form-row"><label class="form-label">Technician *</label>'
    + '<select id="tc-tech">'+techOptions+'</select></div>'
    + '<div class="form-row"><label class="form-label">Customer *</label>'
    + '<input type="text" id="tc-customer-input" placeholder="Type to search..." oninput="onTCCustomerInput(this.value)" autocomplete="off">'
    + '<input type="hidden" id="tc-customer-id">'
    + '<div id="tc-customer-list" style="border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);max-height:180px;overflow-y:auto;display:none"></div>'
    + '</div>'
    + '<div id="tc-wo-section" style="display:none">'
    + '<div class="form-row"><label class="form-label">Work Order *</label>'
    + '<div id="tc-wo-list"></div></div>'
    + '</div>'
    + '<div id="tc-hours-section" style="display:none">'
    + '<div class="form-row"><label class="form-label">Hours Type *</label>'
    + '<select id="tc-type"></select></div>'
    + '<div class="form-row"><label class="form-label">Hours *</label>'
    + '<input type="number" id="tc-hours" min="0.25" step="0.25" placeholder="0.0">'
    + '</div>'
    + '<div class="form-row"><label class="form-label">Billable</label>'
    + '<select id="tc-billable"><option value="true">Yes</option><option value="false">No</option></select></div>'
    + '<button class="save-btn" onclick="saveTCEntry()">Save Entry</button>'
    + '</div>';
  document.getElementById('tc-modal-body').innerHTML = html;
  var typeEl = document.getElementById('tc-type');
  if (typeEl) {
    typeEl.innerHTML = AppState.hoursTypes.map(function(t) {
      return '<option value="'+t.id+'">'+escHtml(t.name)+'</option>';
    }).join('');
  }
}

function onTCCustomerInput(val) {
  var list = document.getElementById('tc-customer-list');
  var hidEl = document.getElementById('tc-customer-id');
  if (hidEl) hidEl.value = '';
  document.getElementById('tc-wo-section').style.display = 'none';
  document.getElementById('tc-hours-section').style.display = 'none';
  if (!val || val.length < 1) { if(list) list.style.display='none'; return; }
  var q = val.toLowerCase();
  var matches = AppState.customers.filter(function(c) {
    return c.qbo_customer_id!=='SYSTEM' && c.active!==false &&
      (c.name.toLowerCase().indexOf(q)>=0 || (c.display_name||'').toLowerCase().indexOf(q)>=0);
  }).slice(0,8);
  if (!matches.length) { list.style.display='none'; return; }
  list.innerHTML = matches.map(function(c) {
    var safeName = c.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return '<div class="autocomplete-item" onclick="selectTCCustomer(\''+c.id+'\',\''+safeName+'\')"><div class="autocomplete-name">'+escHtml(getCustName(c))+'</div></div>';
  }).join('');
  list.style.display = '';
}

function selectTCCustomer(id, name) {
  document.getElementById('tc-customer-input').value = name;
  document.getElementById('tc-customer-id').value = id;
  document.getElementById('tc-customer-list').style.display = 'none';
  var wos = AppState.workOrders.filter(function(w) {
    return w.active!==false && w.customer_id===id && isLiveStatus(w.status);
  }).sort(function(a,b){ return b.wo_number.localeCompare(a.wo_number); });
  var woSection = document.getElementById('tc-wo-section');
  var woList = document.getElementById('tc-wo-list');
  var woHtml = '<div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">';
  wos.forEach(function(w) {
    var st = getStatus(w.status);
    woHtml += '<div class="tc-wo-option" onclick="selectTCWO(\''+w.id+'\')" data-woid="'+w.id+'">'
      + '<strong>'+w.wo_number+'</strong> '
      + '<span class="badge" style="background:'+st.color+';font-size:10px;padding:1px 5px">'+String(w.status).padStart(2,'0')+' '+st.name+'</span> '
      + escHtml(w.title||'')
      + '</div>';
  });
  woHtml += '<div class="tc-wo-option tc-new-wo" onclick="selectTCNewWO(\''+id+'\')">+ New Work Order</div>';
  woHtml += '</div>';
  woList.innerHTML = woHtml;
  woSection.style.display = '';
  document.getElementById('tc-hours-section').style.display = 'none';
}

function selectTCWO(woId) {
  document.querySelectorAll('.tc-wo-option').forEach(function(el){ el.classList.remove('selected'); });
  var el = document.querySelector('.tc-wo-option[data-woid="'+woId+'"]');
  if (el) el.classList.add('selected');
  AppState._tcSelectedWOId = woId;
  AppState._tcNewWO = false;
  document.getElementById('tc-hours-section').style.display = '';
}

function selectTCNewWO(custId) {
  document.querySelectorAll('.tc-wo-option').forEach(function(el){ el.classList.remove('selected'); });
  var el = document.querySelector('.tc-new-wo');
  if (el) el.classList.add('selected');
  AppState._tcSelectedWOId = null;
  AppState._tcNewWO = true;
  AppState._tcNewWOCustId = custId;
  var hoursSection = document.getElementById('tc-hours-section');
  hoursSection.style.display = '';
  if (!document.getElementById('tc-wo-title-row')) {
    var titleRow = document.createElement('div');
    titleRow.className = 'form-row';
    titleRow.id = 'tc-wo-title-row';
    titleRow.innerHTML = '<label class="form-label">WO Title *</label><input type="text" id="tc-wo-title" placeholder="Brief description of work">';
    hoursSection.insertBefore(titleRow, hoursSection.firstChild);
  }
}

function saveTCEntry() {
  var saveBtn = document.querySelector('#tc-modal-body .save-btn');
  if (!btnSaving(saveBtn)) return;
  var date = document.getElementById('tc-date').value;
  var techId = document.getElementById('tc-tech').value;
  var typeId = document.getElementById('tc-type').value;
  var hours = parseFloat(document.getElementById('tc-hours').value);
  var billable = document.getElementById('tc-billable').value === 'true';
  if (!date) { btnDone(saveBtn); showToast('Date is required'); return; }
  if (!techId) { btnDone(saveBtn); showToast('Technician is required'); return; }
  if (!typeId) { btnDone(saveBtn); showToast('Hours type is required'); return; }
  if (!hours || hours <= 0) { btnDone(saveBtn); showToast('Enter valid hours'); return; }
  var tech = AppState.technicians.find(function(t){ return t.id===techId; });
  var hoursType = AppState.hoursTypes.find(function(t){ return t.id===typeId; });
  var rate = parseFloat(AppState.settings[(hoursType&&hoursType.internal_rate_key)]||0);
  // Duplicate check — warn if identical entry exists
  var woId = AppState._tcSelectedWOId;
  if (woId) {
    var dupe = AppState.hoursEntries.find(function(e){
      return e.work_order_id === woId && e.entry_date === date &&
             parseFloat(e.hours) === hours && e.tech_id === techId;
    });
    if (dupe && !confirm('An identical entry already exists for this WO on ' + date + ' (' + hours + 'h). Save anyway?')) {
      btnDone(saveBtn); return;
    }
  }
  function postEntry(woId, wo) {
    var descriptor = wo.wo_number + ' - ' + (tech&&tech.name) + ' - ' + wo.title;
    sb.post('hours_entries', {
      work_order_id: woId, entry_date: date, tech_id: techId,
      hours_type_id: typeId, hours: hours, billable: billable,
      internal_rate: rate, line_total: hours*rate, descriptor: descriptor,
      created_by: AppState.userEmail, modified_by: AppState.userEmail
    }).then(function(r) {
      if (r.ok && r.data && r.data.length) {
        var newEntry = Object.assign({}, r.data[0], {technicians: tech, hours_types: hoursType});
        AppState.hoursEntries.push(newEntry);
        delete AppState.projectedCache[woId];
        closeTimecardEntryModal();
        setTimeout(function(){ renderTimecard(); }, 500);
        showToast('Entry saved');
      } else { btnDone(saveBtn); showToast('Error saving entry'); }
    });
  }
  if (AppState._tcNewWO) {
    var title = document.getElementById('tc-wo-title') ? document.getElementById('tc-wo-title').value.trim() : '';
    if (!title) { showToast('WO title is required'); return; }
    var custId = AppState._tcNewWOCustId;
    var nextNum = parseInt(AppState.settings.wo_number_next||'26300');
    var prefix = AppState.settings.wo_number_prefix||'P';
    var woNum = prefix + nextNum;
    sb.post('work_orders', {
      wo_number: woNum, title: title, customer_id: custId,
      form_mode: 'time_materials',
      status: (AppState.statuses.find(function(s){return s.name==='07 In Progress'||s.num===7;})||{num:7}).num,
      origin: 'timecard', created_by: AppState.userEmail, modified_by: AppState.userEmail
    }).then(function(r) {
      if (r.ok && r.data && r.data.length) {
        var newWO = r.data[0];
        AppState.workOrders.push(newWO);
        sb.patchWhere('settings','key=eq.wo_number_next',{value:String(nextNum+1)}).then(function(){
          AppState.settings.wo_number_next = String(nextNum+1);
        });
        postEntry(newWO.id, newWO);
      } else showToast('Error creating work order');
    });
  } else {
    var woId = AppState._tcSelectedWOId;
    if (!woId) { showToast('Select a work order'); return; }
    var wo = AppState.workOrders.find(function(w){ return w.id===woId; });
    if (!wo) { showToast('Work order not found'); return; }
    postEntry(woId, wo);
  }
}

function tcInlineEdit(ev, eid, currentHours) {
  ev.stopPropagation();
  var td = ev.currentTarget;
  var orig = td.innerHTML;
  td.innerHTML = '<input type="number" class="tc-inline-input" value="'+currentHours+'" min="0.25" step="0.25" style="width:56px;font-size:13px;padding:2px 4px;border:1px solid var(--header-bg);border-radius:3px;text-align:center">';
  var inp = td.querySelector('input');
  inp.focus(); inp.select();
  function save() {
    var val = parseFloat(inp.value);
    if (!val || val <= 0) { td.innerHTML = orig; return; }
    if (val === currentHours) { td.innerHTML = orig; return; }
    var e = AppState.hoursEntries.find(function(x){ return x.id===eid; });
    var ht = e && e.hours_types;
    var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
    sb.patch('hours_entries', eid, {hours: val, line_total: val*rate, modified_by: AppState.userEmail}).then(function(r){
      if (r.ok) {
        if (e) e.hours = val;
        td.innerHTML = '<span class="tc-hrs-val">'+val.toFixed(1)+'</span>';
        td.style.background = '#27ae6044';
        setTimeout(function(){ td.style.background=''; renderTimecard(); }, 800);
        showToast('Hours updated');
      } else { td.innerHTML = orig; showToast('Error saving'); }
    });
  }
  inp.addEventListener('keydown', function(ev2){
    if (ev2.key==='Enter') save();
    if (ev2.key==='Escape') { td.innerHTML = orig; }
  });
  inp.addEventListener('blur', function(){ setTimeout(save, 150); });
}

function timecardJumpToDate(dateStr) {
  if (!dateStr) return;
  var d = new Date(dateStr+'T12:00:00');
  if (isNaN(d)) return;
  var dow = d.getDay();
  var mon = new Date(d);
  mon.setDate(d.getDate() - (dow===0 ? 6 : dow-1));
  mon.setHours(0,0,0,0);
  AppState.timecardWeekStart = mon;
  renderTimecard();
}

function timecardJumpFromSelects() {
  var mEl = document.getElementById('tc-jump-month');
  var yEl = document.getElementById('tc-jump-year');
  if (!mEl || !yEl || !yEl.value) return;
  var mon = new Date(parseInt(yEl.value), parseInt(mEl.value), 1);
  var dow = mon.getDay();
  var monday = new Date(mon);
  monday.setDate(1 - (dow===0?6:dow-1));
  monday.setHours(0,0,0,0);
  AppState.timecardWeekStart = monday;
  renderTimecard();
}

function clearTimecardReviewed() {
  sb.patchWhere('settings','key=eq.timecard_reviewed_through',{value:''}).then(function(){
    AppState.settings.timecard_reviewed_through = '';
    var rd = document.getElementById('timecard-reviewed-date'); if(rd) rd.textContent = '---';
    showToast('Reviewed through date cleared');
    renderTimecard();
  });
}

function markTimecardReviewedToday() {
  var today = todayStr();
  sb.patchWhere('settings','key=eq.timecard_reviewed_through',{value:today}).then(function(){
    AppState.settings.timecard_reviewed_through = today;
    var rd = document.getElementById('timecard-reviewed-date'); if(rd) rd.textContent = today;
    showToast('Marked reviewed through today');
    renderTimecard();
  });
}

function populateTCYearDropdown() {
  var el = document.getElementById('tc-jump-year'); if (!el) return;
  var now = new Date();
  var curYear = now.getFullYear();
  var html = '';
  for (var y = curYear - 2; y <= curYear + 1; y++) {
    html += '<option value="'+y+'"'+(y===curYear?' selected':'')+'>'+y+'</option>';
  }
  el.innerHTML = html;
  var mEl = document.getElementById('tc-jump-month');
  if (mEl) mEl.value = now.getMonth();
}


/* MOVED TO field-travel-log.js — v4.41 — Aug 18 2026
   Mobile Field Travel Log: MDRState, all mdr* functions
   Includes: mobile day/week view, stop tagging, allocations,
   clock in/out, day submission, week summary
   Search field-travel-log.js for any mdr* function.
*/

