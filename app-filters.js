// SHORT TERM DWO — app-filters.js (clean - no template literals)

// MOBILE FILTER BAR
function _mobileFiltersAreActive() {
  // Returns true if the view is narrower than plain default Live with no search
  var q = AppState.filterSearch || '';
  if (q.trim() !== '') return true;
  if (AppState.filterStatus && AppState.filterStatus !== 'live') return true;
  return false;
}

function renderMobileFilterBar() {
  var bar = document.getElementById('mobile-filter-bar'); if(!bar) return;
  var filtersOpen = !!AppState._mobileFiltersOpen;
  var isLive = AppState.filterStatus === 'live';
  var active = _mobileFiltersAreActive();
  var chips = [
    {label:'All live', val:'live'},
    {label:'Processed', val:'processed'},
    {label:'All', val:'all'},
    {label:'Completed', val:'completed_cat'},
    {label:'Active', val:'active_cat'},
    {label:'Draft', val:'draft_cat'},
  ];
  var chipHtml = chips.map(function(c){
    return '<span class="status-chip'+(AppState.filterStatus==c.val?' active':'')+'" onclick="setStatusFilter(\''+c.val+'\')">'+c.label+'</span>';
  }).join('');

  var html = '<div class="mobile-filter-row">';
  html += '<input type="search" id="wo-search-combined" placeholder="Search title or customer..." oninput="onCombinedSearchInput(this.value)" style="flex:1;min-width:0" value="'+escHtml(AppState.filterSearch||'')+'">';
  html += '<button class="filters-toggle-btn'+(active?' has-active':'')+'" onclick="toggleMobileFilters()">Filters'+(filtersOpen?' &#x25B4;':' &#x25BE;')+'</button>';
  html += '</div>';
  if (active) {
    html += '<div class="filters-active-badge">FILTERS ACTIVE - tap Filters to adjust</div>';
  }
  if (filtersOpen) {
    html += '<div class="mobile-filter-row" style="flex-wrap:wrap;gap:6px">'+chipHtml+'</div>';
  }
  bar.innerHTML = html;
}

function toggleMobileFilters() {
  AppState._mobileFiltersOpen = !AppState._mobileFiltersOpen;
  renderMobileFilterBar();
}

function onCombinedSearchInput(val) {
  AppState.filterSearch = val;
  filterWOList();
  // Update the active badge without losing focus/cursor in the input
  var active = _mobileFiltersAreActive();
  var bar = document.getElementById('mobile-filter-bar');
  var badge = bar ? bar.querySelector('.filters-active-badge') : null;
  if (active && !badge) {
    renderMobileFilterBar();
    var inp = document.getElementById('wo-search-combined');
    if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  } else if (!active && badge) {
    renderMobileFilterBar();
  }
}

function setStatusFilter(val) {
  AppState.filterStatus = val;
  renderMobileFilterBar();
  filterWOList();
  var dtFilter = document.getElementById('dt-status-filter');
  if(dtFilter) { dtFilter.value = val; renderDesktopGrid(); }
}

function toggleLiveFilter() {
  AppState.filterStatus = AppState.filterStatus === 'live' ? 'all' : 'live';
  renderMobileFilterBar();
  filterWOList();
}

function initMobileFilters() { renderMobileFilterBar(); }

// DESKTOP STATUS FILTER
function initDesktopStatusFilter() {
  var sf = document.getElementById('dt-status-filter');
  if(!sf || sf.options.length > 3) return;
  var sep = document.createElement('option'); sep.disabled=true; sep.textContent='----------'; sf.appendChild(sep);
  var _sList2 = (AppState.statuses && AppState.statuses.length) ? AppState.statuses : [];
  _sList2.forEach(function(s) {
    var o = document.createElement('option');
    o.value = s.num;
    o.textContent = String(s.num).padStart(2,'0') + ' - ' + s.name;
    sf.appendChild(o);
  });
  var savedFilter = localStorage.getItem('dwo_status_filter') || 'live';
  sf.value = savedFilter;
}

// AGING SUMMARY BAR
function renderAgingBar() {
  var bar = document.getElementById('aging-summary-bar'); if(!bar) return;
  _ensureProjectedCache().then(function() {
    var now = Date.now();
    var openWOs = AppState.workOrders.filter(function(w){ return w.active!==false && (statusCat(w.status)==='draft'||statusCat(w.status)==='active'); });
    var b30={wos:[],total:0}, b60={wos:[],total:0}, b90={wos:[],total:0}, b90p={wos:[],total:0};
    openWOs.forEach(function(wo) {
      var days = Math.floor((now - new Date(wo.created_at)) / 86400000);
      var proj = AppState.projectedCache[wo.id] || 0;
      if(days<=30){b30.wos.push(wo);b30.total+=proj;}
      else if(days<=60){b60.wos.push(wo);b60.total+=proj;}
      else if(days<=90){b90.wos.push(wo);b90.total+=proj;}
      else{b90p.wos.push(wo);b90p.total+=proj;}
    });
    var readyWOs = AppState.workOrders.filter(function(w){ return w.active!==false && statusCat(w.status)==='completed'; });
    var readyTotal = readyWOs.reduce(function(s,w){ return s+(AppState.projectedCache[w.id]||0); },0);
    function fmt(n){ return '$'+n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
    function bucket(label, color, b, key) {
      return '<div class="age-bucket" onclick="onAgeBucketClick(\''+key+'\')" style="border-top:3px solid '+color+'">'
        + '<div class="age-bucket-label" style="color:'+color+'">'+label+'</div>'
        + '<div class="age-bucket-count">'+b.wos.length+' WO'+(b.wos.length!==1?'s':'')+'</div>'
        + '<div class="age-bucket-amount">'+fmt(b.total)+'</div>'
        + '</div>';
    }
    var flaggedWOs = AppState.workOrders.filter(function(w){ return w.active!==false && isLiveStatus(w.status) && (w.flag_needs_paperwork||w.flag_needs_parts||w.flag_needs_review||w.flag_needs_po); });
    var flaggedTotal = flaggedWOs.reduce(function(s,w){ return s+(AppState.projectedCache[w.id]||0); },0);
    var allLiveWOs = AppState.workOrders.filter(function(w){ 
      var cat = statusCat(w.status);
      return w.active!==false && (cat==='draft' || cat==='active'); 
    });
    var allLiveTotal = allLiveWOs.reduce(function(s,w){ return s+(AppState.projectedCache[w.id]||0); },0);    var html = '<div class="aging-bar-inner">'
      + '<div class="age-bucket" onclick="clearAgeBucketFilter()" style="border-top:3px solid var(--header-bg);background:var(--surface)">'
      + '<div class="age-bucket-label" style="color:var(--header-bg);font-weight:700">Total</div>'
      + '<div class="age-bucket-count">'+allLiveWOs.length+' WO'+(allLiveWOs.length!==1?'s':'')+'</div>'
      + '<div class="age-bucket-amount">'+fmt(allLiveTotal)+'</div>'
      + '</div>'
      + bucket('0-30 days','var(--success)',b30,'b30')
      + bucket('31-60 days','#e67e22',b60,'b60')
      + bucket('61-90 days','var(--danger)',b90,'b90')
      + bucket('90+ days','#7b0000',b90p,'b90p')
      + '<div class="age-bucket" onclick="onAgeBucketClick(\'ready\')" style="border-top:3px solid #27ae60;background:#eafaf1">'
      + '<div class="age-bucket-label" style="color:#27ae60">✓ Ready to bill</div>'
      + '<div class="age-bucket-count">'+readyWOs.length+' WO'+(readyWOs.length!==1?'s':'')+'</div>'
      + '<div class="age-bucket-amount">'+fmt(readyTotal)+'</div>'
      + '</div>'
      + '<div class="age-bucket" onclick="onAgeBucketClick(\'flagged\')" style="border-top:3px solid var(--danger);background:#fdf2f2">'
      + '<div class="age-bucket-label" style="color:var(--danger)">⚑ Flagged</div>'
      + '<div class="age-bucket-count">'+flaggedWOs.length+' WO'+(flaggedWOs.length!==1?'s':'')+'</div>'
      + '<div class="age-bucket-amount">'+fmt(flaggedTotal)+'</div>'
      + '</div>'
      + '<div class="age-bucket-recalc" onclick="forceRecalculate()" title="Recalculate">&#x21BA;</div>'
      + '</div>';
    bar.innerHTML = html;
  });
}

function onAgeBucketClick(key) {
  var now = Date.now();
  var ranges = {b30:[0,30], b60:[31,60], b90:[61,90], b90p:[90,9999]};
  var ids;
  if(key==='ready'){
    ids = AppState.workOrders.filter(function(w){ return w.active!==false && statusCat(w.status)==='completed'; }).map(function(w){ return w.id; });
  } else if(key==='flagged'){
    ids = AppState.workOrders.filter(function(w){ return w.active!==false && isLiveStatus(w.status) && (w.flag_needs_paperwork||w.flag_needs_parts||w.flag_needs_review||w.flag_needs_po); }).map(function(w){ return w.id; });
  } else {
    var range = ranges[key] || [0,9999];
    ids = AppState.workOrders.filter(function(w){
      if(w.active===false || isProcessedStatus(w.status) || statusCat(w.status)==='cancelled') return false;
      var days = Math.floor((now - new Date(w.created_at)) / 86400000);
      return days >= range[0] && days <= range[1];
    }).map(function(w){ return w.id; });
  }
  AppState._ageBucketFilter = ids;
  AppState._ageBucketLabel = key;
  var sf = document.getElementById('dt-status-filter'); if(sf) sf.value='all';
  renderDesktopGridFiltered(ids);
  document.querySelectorAll('.age-bucket').forEach(function(el){ el.classList.remove('active'); });
  if(event && event.currentTarget) event.currentTarget.classList.add('active');
}

function clearAgeBucketFilter() {
  AppState._ageBucketFilter = null; AppState._ageBucketLabel = null;
  var sf = document.getElementById('dt-status-filter'); if(sf) sf.value='live';
  renderDesktopGrid();
  document.querySelectorAll('.age-bucket').forEach(function(el){ el.classList.remove('active'); });
}

function renderDesktopGridFiltered(ids) {
  var wos = AppState.workOrders.filter(function(w){ return ids.indexOf(w.id)>=0; });
  var tbody = document.getElementById('desktop-grid-body'); if(!tbody) return;
  if(!wos.length){ tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">No work orders in this bucket</td></tr>'; return; }
  var now = Date.now();
  tbody.innerHTML = wos.map(function(wo) {
    var st = getStatus(wo.status);
    var cust = getCustName(wo.customers)||'---';
    var selected = selHas(wo.id);
    var proj = AppState.projectedCache[wo.id];
    var projStr = proj!=null ? '$'+proj.toFixed(2) : '---';
    var days = Math.floor((now - new Date(wo.created_at)) / 86400000);
    var ageColor = days>90?'#7b0000':days>60?'var(--danger)':days>30?'#e67e22':'var(--text-muted)';
    return '<tr style="background:'+st.color+'18"'+(selected?' class="selected"':'')+' onclick="desktopRowClick(event,\''+wo.id+'\')">'
      + '<td class="cb-col" onclick="event.stopPropagation()"><input type="checkbox"'+(selected?' checked':'')+' onchange="toggleRowSelect(\''+wo.id+'\',this.checked)"></td>'
      + '<td><strong>'+wo.wo_number+'</strong></td>'
      + '<td>'+escHtml(cust)+'</td>'
      + '<td>'+escHtml(wo.title)+'</td>'
      + '<td><span class="badge" style="background:'+st.color+'">'+String(wo.status).padStart(2,'0')+' '+st.name+'</span></td>'
      + '<td>'+(wo.form_mode==='quoted'?'Q':'T&M')+'</td>'
      + '<td>'+fmtDate(wo.created_at)+'</td>'
      + '<td style="color:'+ageColor+';font-weight:'+(days>30?'600':'400')+'">'+days+'d ago</td>'
      + '<td class="text-right">'+projStr+'</td>'
      + '</tr>';
  }).join('');
}

// PROJECTED $ CACHE
function _ensureProjectedCache() {
  var uncached = AppState.workOrders.filter(function(w){ return w.active!==false && AppState.projectedCache[w.id]==null; });
  if(!uncached.length) return Promise.resolve();
  var ids = uncached.map(function(w){ return w.id; });
  var idList = ids.join(',');
  return Promise.all([
    sb.get('hours_entries',   '?work_order_id=in.('+idList+')&active=eq.true&select=work_order_id,hours,hours_types(internal_rate_key)'),
    sb.get('line_items',      '?work_order_id=in.('+idList+')&active=eq.true&select=work_order_id,sell_total,transaction_type'),
    sb.get('quoted_invoices', '?work_order_id=in.('+idList+')&active=eq.true&select=work_order_id,amount'),
  ]).then(function(results) {
    var hours  = results[0].ok ? results[0].data||[] : [];
    var parts  = results[1].ok ? results[1].data||[] : [];
    var quoted = results[2].ok ? results[2].data||[] : [];
    uncached.forEach(function(wo) {
      var woH = hours.filter(function(e){ return e.work_order_id===wo.id; });
      var woP = parts.filter(function(e){ return e.work_order_id===wo.id; });
      var woQ = quoted.filter(function(e){ return e.work_order_id===wo.id; });
      var hoursVal = woH.reduce(function(s,e){
        var ht = e.hours_types;
        var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
        return s + parseFloat(e.hours||0)*rate;
      },0);
      var partsVal   = woP.filter(function(e){ return e.transaction_type!=='vendor_credit'; }).reduce(function(s,e){ return s+parseFloat(e.sell_total||0); },0);
      var creditsVal = woP.filter(function(e){ return e.transaction_type==='vendor_credit'; }).reduce(function(s,e){ return s+parseFloat(e.sell_total||0); },0);
      var quotedVal  = woQ.reduce(function(s,e){ return s+parseFloat(e.amount||0); },0);
      AppState.projectedCache[wo.id] = wo.form_mode==='quoted' ? quotedVal : (hoursVal+partsVal-creditsVal);
    });
  });
}

function refreshAgingBar() {
  _ensureProjectedCache().then(function() { renderAgingBar(); renderDesktopGrid(); });
}

function forceRecalculate() {
  showToast('Recalculating...');
  AppState.projectedCache = {};
  _ensureProjectedCache().then(function() { renderAgingBar(); renderDesktopGrid(); showToast('Recalculated'); });
}

// INJECT CSS
(function injectFilterCSS() {
  var style = document.createElement('style');
  var css = '';
  css += '.mobile-filter-row{display:flex;gap:8px;padding:6px 12px;background:var(--surface);border-bottom:1px solid var(--border);}';
  css += '.mobile-filter-row:first-child{padding-top:10px;}';
  css += '.mobile-filter-row:last-child{padding-bottom:10px;flex-wrap:wrap;}';
  css += '.live-toggle{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;color:var(--text-secondary);white-space:nowrap;}';
  css += '.live-toggle.active{background:var(--header-bg);color:#fff;border-color:var(--header-bg);}';
  css += '.status-chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg);border:1px solid var(--border);color:var(--text-secondary);white-space:nowrap;}';
  css += '.status-chip.active{background:var(--amber);color:var(--amber-dark);border-color:var(--amber);}';
  css += '#aging-summary-bar{background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;}';
  css += '.aging-bar-inner{display:flex;align-items:stretch;min-width:max-content;}';
  css += '.age-bucket{flex:1;min-width:110px;padding:10px 14px;cursor:pointer;border-right:1px solid var(--border);transition:background .12s;}';
  css += '.age-bucket:hover{background:var(--bg);}';
  css += '.age-bucket.active{background:var(--bg);}';
  css += '.age-bucket-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;}';
  css += '.age-bucket-count{font-size:13px;color:var(--text-secondary);}';
  css += '.age-bucket-amount{font-size:16px;font-weight:700;color:var(--text-primary);margin-top:2px;}';
  css += '.age-bucket-recalc{display:flex;align-items:center;justify-content:center;padding:0 14px;font-size:20px;cursor:pointer;color:var(--text-muted);border-left:1px solid var(--border);}';
  css += '.age-bucket-recalc:hover{color:var(--text-primary);}';
  css += '.autocomplete-wrap{position:relative;}';
  css += '#f-customer-list{position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-md);z-index:200;max-height:240px;overflow-y:auto;display:none;}';
  css += '.autocomplete-item{padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);}';
  css += '.autocomplete-item:last-child{border-bottom:none;}';
  css += '.autocomplete-item:hover{background:var(--bg);}';
  css += '.autocomplete-name{font-size:13px;color:var(--text-primary);}';
  css += '.autocomplete-sub{font-size:11px;color:var(--text-muted);margin-top:2px;}';
  css += '.vendor-autocomplete-wrap{position:relative;}';
  css += '#p-vendor-list,#ts-vendor-list{position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-md);z-index:200;max-height:200px;overflow-y:auto;display:none;}';
  css += '.vendor-autocomplete-item{padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;}';
  css += '.vendor-autocomplete-item:last-child{border-bottom:none;}';
  css += '.vendor-autocomplete-item:hover,.vendor-autocomplete-item:active{background:var(--bg);}';
  css += '.action-btn.edit{color:#2980b9;}';
  css += '.filters-toggle-btn{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 14px;font-size:13px;font-weight:600;color:var(--text-secondary);white-space:nowrap;}';
  css += '.filters-toggle-btn.has-active{background:var(--amber);color:var(--amber-dark);border-color:var(--amber);}';
  css += '.filters-active-badge{background:var(--amber);color:var(--amber-dark);font-size:11px;font-weight:700;text-align:center;padding:5px;text-transform:uppercase;letter-spacing:.4px;}';
  style.textContent = css;
  document.head.appendChild(style);
})();
