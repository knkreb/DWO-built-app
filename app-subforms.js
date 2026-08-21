// SHORT TERM DWO — app-subforms.js (clean - no nested template literals)

// HOURS ENTRY
function openHoursList() {
  populateTechDropdown('h-tech');
  populateHoursTypeDropdown('h-type');
  var defaultTech = getDefaultTechId();
  if (defaultTech) { var el=document.getElementById('h-tech'); if(el) el.value=defaultTech; }
  document.getElementById('h-date').value = todayStr();
  document.getElementById('h-hours').value = '';
  document.getElementById('h-billable').value = 'true';
  cancelHoursForm();
  renderHoursList();
  pushScreen('screen-hours-list','Hours Entry');
}

function renderHoursList() {
  var active  = AppState.hoursEntries.filter(function(e){ return e.active!==false; });
  var deleted = AppState.hoursEntries.filter(function(e){ return e.active===false; });
  var totHours = active.reduce(function(s,e){ return s+parseFloat(e.hours||0); },0);
  var totVal   = active.reduce(function(s,e){
    var ht = e.hours_types;
    var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
    return s+parseFloat(e.hours||0)*rate;
  },0);
  document.getElementById('hours-count').textContent = active.length;
  document.getElementById('hours-total').textContent = totHours.toFixed(1);
  document.getElementById('hours-value').textContent = '$'+totVal.toFixed(0);
  var body = document.getElementById('hours-list-body');
  if (!AppState.hoursEntries.length) { body.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted)">No hours entries yet</div>'; return; }
  var all = active.concat(deleted);
  body.innerHTML = all.map(function(e) {
    var isDel = e.active===false;
    var ht = e.hours_types;
    var rate = parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
    var val  = parseFloat(e.hours||0)*rate;
    var techName = (e.technicians&&e.technicians.name)||'---';
    var typeName = (ht&&ht.name)||'---';
    var eid = e.id;
    var out = '<div style="border-bottom:1px solid var(--border)'+(isDel?';opacity:0.5':'')+'">';
    out += '<div style="display:flex;align-items:center;padding:12px 14px;min-height:44px;cursor:pointer" onclick="toggleHoursTile(\'ht-'+eid+'\')">';
    out += '<div style="flex:1;min-width:0"><span style="font-size:13px;font-weight:600">'+fmtDate(e.entry_date)+'</span><span style="font-size:13px;color:var(--text-muted);margin-left:10px">'+escHtml(techName)+'</span></div>';
    out += '<span style="font-size:13px;font-weight:600;margin-right:10px">'+parseFloat(e.hours||0).toFixed(1)+' hrs</span>';
    out += '<span style="color:var(--text-muted);font-size:16px">›</span>';
    out += '</div>';
    out += '<div id="ht-'+eid+'" style="display:none;padding:0 14px 12px;background:var(--bg)">';
    out += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
    out += '<div><div style="font-size:11px;color:var(--text-muted)">Type</div><div style="font-size:13px">'+escHtml(typeName)+'</div></div>';
    out += '<div><div style="font-size:11px;color:var(--text-muted)">Billable</div><div style="font-size:13px">'+(e.billable?'Yes':'No')+'</div></div>';
    out += '<div><div style="font-size:11px;color:var(--text-muted)">Amount</div><div style="font-size:13px;font-weight:600">$'+val.toFixed(2)+'</div></div>';
    if (e.descriptor) out += '<div><div style="font-size:11px;color:var(--text-muted)">Notes</div><div style="font-size:13px">'+escHtml(e.descriptor)+'</div></div>';
    out += '</div>';
    if (isDel) {
      out += '<button style="font-size:12px;padding:8px 16px;border:1px solid var(--header-bg);border-radius:var(--radius-sm);background:none;color:var(--header-bg);width:100%" onclick="restoreEntry(\'hours_entries\',\''+eid+'\')">Restore</button>';
    } else {
      out += '<button style="font-size:13px;padding:10px 16px;border:none;border-radius:var(--radius-sm);background:var(--header-bg);color:#fff;width:100%;min-height:44px" onclick="editHoursEntry(\''+eid+'\')">Edit Entry</button>';
    }
    out += '</div></div>';
    return out;
  }).join('');
}


function showHoursForm() {
  document.getElementById('hours-add-form').style.display='block';
  AppState.editingEntryId=null;
  document.getElementById('h-date').value=todayStr();
  document.getElementById('h-hours').value='';
  var hDel=document.getElementById('h-delete-btn'); if(hDel) hDel.style.display='none';
}
function cancelHoursForm(){ AppState.editingEntryId=null; var hDel=document.getElementById('h-delete-btn'); if(hDel) hDel.style.display='none'; document.getElementById('h-hours').value=''; }
  

function editHoursEntry(id) {
  var e=AppState.hoursEntries.find(function(e){return e.id===id;}); if(!e)return;
  AppState.editingEntryId=id;
  populateTechDropdown('h-tech'); populateHoursTypeDropdown('h-type');
  document.getElementById('h-date').value=e.entry_date||todayStr();
  document.getElementById('h-tech').value=e.tech_id||'';
  document.getElementById('h-type').value=e.hours_type_id||'';
  document.getElementById('h-hours').value=e.hours||'';
  document.getElementById('h-billable').value=e.billable?'true':'false';
  document.getElementById('h-form-title').textContent='Edit Hours Entry';
  document.getElementById('h-save-btn').textContent='Update Entry';
  var hDel=document.getElementById('h-delete-btn'); if(hDel) hDel.style.display='';
  document.getElementById('hours-add-form').style.display='';
  
  document.getElementById('hours-add-form').scrollIntoView({behavior:'smooth'});
}

function saveHoursEntry(mode) {
  var addAnother = mode==='stay';
  var saveBtn = document.getElementById('h-save-btn');
  if (!btnSaving(saveBtn)) return;
  var date=document.getElementById('h-date').value;
  var techId=document.getElementById('h-tech').value;
  var typeId=document.getElementById('h-type').value;
  var hours=parseFloat(document.getElementById('h-hours').value);
  var billable=document.getElementById('h-billable').value==='true';
  if(!date||!techId||!typeId){showToast('Fill all required fields');return;}
  if(!hours||hours<=0){
    var errEl=document.getElementById('h-hours-error');
    if(errEl){errEl.classList.add('show');setTimeout(function(){errEl.classList.remove('show');},3000);}
    showToast('Enter a valid number of hours');return;
  }
  var tech=AppState.technicians.find(function(t){return t.id===techId;});
  var hoursType=AppState.hoursTypes.find(function(t){return t.id===typeId;});
  var rate=parseFloat(AppState.settings[(hoursType&&hoursType.internal_rate_key)]||0);
  var descriptor=(AppState.currentWO.wo_number)+' - '+(tech&&tech.name)+' - '+(AppState.currentWO.title);
  if(AppState.editingEntryId){
    sb.patch('hours_entries',AppState.editingEntryId,{entry_date:date,tech_id:techId,hours_type_id:typeId,hours:hours,billable:billable,internal_rate:rate,line_total:hours*rate,descriptor:descriptor,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok){
        var idx=AppState.hoursEntries.findIndex(function(e){return e.id===AppState.editingEntryId;});
        if(idx>=0) AppState.hoursEntries[idx]=Object.assign({},AppState.hoursEntries[idx],{entry_date:date,tech_id:techId,hours_type_id:typeId,hours:hours,billable:billable,internal_rate:rate,line_total:hours*rate,descriptor:descriptor,technicians:tech,hours_types:hoursType});
        delete AppState.projectedCache[AppState.currentWO.id];
        renderHoursList();cancelHoursForm();showToast('Hours entry updated');
        if(!addAnother) goBack();
      } else { btnDone(saveBtn); showToast('Error updating'); }
    });
  } else {
    sb.post('hours_entries',{work_order_id:AppState.currentWO.id,entry_date:date,tech_id:techId,hours_type_id:typeId,hours:hours,billable:billable,internal_rate:rate,line_total:hours*rate,descriptor:descriptor,created_by:AppState.userEmail,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok&&r.data&&r.data.length){
        AppState.hoursEntries.push(Object.assign({},r.data[0],{technicians:tech,hours_types:hoursType}));
        delete AppState.projectedCache[AppState.currentWO.id];
        renderHoursList();
        if(addAnother){document.getElementById('h-hours').value='';AppState.editingEntryId=null;btnDone(saveBtn);showToast('Saved - add another');document.getElementById('h-hours').focus();}
        else{cancelHoursForm();showToast('Hours entry saved');goBack();}
      } else { btnDone(saveBtn); showToast('Error saving'); }
    });
  }
}

function populateTechDropdown(elId){ var el=document.getElementById(elId);if(!el)return;el.innerHTML=AppState.technicians.map(function(t){return'<option value="'+t.id+'">'+escHtml(t.name)+'</option>';}).join(''); }
function populateHoursTypeDropdown(elId){ var el=document.getElementById(elId);if(!el)return;el.innerHTML=AppState.hoursTypes.map(function(t){return'<option value="'+t.id+'">'+escHtml(t.name)+'</option>';}).join(''); }

// LINE ITEMS
function openPartsList() {
  populateVendorDropdown('p-vendor');
  populateQBOItemDropdown('p-qbo-item');
  document.getElementById('p-date').value=todayStr();
  document.getElementById('p-type').value='vendor_bill';
  ['p-invoice','p-description'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('p-qty').value='1';
  var isTruckStock = !!AppState._isTruckStockEntry;
  document.getElementById('p-margin').value = isTruckStock ? '1' : (AppState.settings.default_margin||'0.50');
  document.getElementById('p-billable').value='true';
  document.getElementById('p-cost').value='';
  var pvInput=document.getElementById('p-vendor-input');if(pvInput)pvInput.value='';
  document.getElementById('p-vendor').value='';
  prefillLastVendor('p');
  onLineItemTypeChange(); calcLineItemTotals();
  // Hide markup fields for truck stock - cost only, no billing markup
  var marginRow = document.getElementById('p-margin-row');
  var sellRow = document.getElementById('p-sell-row');
  if (marginRow) marginRow.style.display = isTruckStock ? 'none' : '';
  if (sellRow) sellRow.style.display = isTruckStock ? 'none' : '';
  // Reset edit state without hiding the form
  AppState.editingEntryId = null;
  var pDel = document.getElementById('p-delete-btn'); if(pDel) pDel.style.display='none';
  var saveBtn = document.getElementById('p-save-btn'); if(saveBtn){saveBtn.textContent='Save & Close';saveBtn._saving=false;saveBtn.disabled=false;saveBtn.style.opacity='';}
  var stayBtn = document.getElementById('p-add-another-btn'); if(stayBtn){stayBtn._saving=false;stayBtn.disabled=false;stayBtn.style.opacity='';}
  renderPartsList();
  pushScreen('screen-parts-list','Parts & Services');
}

function renderPartsList() {
  var active  = AppState.lineItems.filter(function(e){return e.active!==false;});
  var deleted = AppState.lineItems.filter(function(e){return e.active===false;});
  var bills   = active.filter(function(e){return e.transaction_type==='vendor_bill';}).length;
  var credAmt = active.filter(function(e){return e.transaction_type==='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
  var sellTot = active.filter(function(e){return e.transaction_type!=='vendor_credit';}).reduce(function(s,e){return s+parseFloat(e.sell_total||0);},0);
  document.getElementById('parts-bills').textContent=bills;
  document.getElementById('parts-credits').textContent='$'+credAmt.toFixed(2);
  document.getElementById('parts-total').textContent='$'+sellTot.toFixed(2);
  var body=document.getElementById('parts-list-body');
  if(!AppState.lineItems.length){body.innerHTML='<div class="empty-state"><div class="empty-state-icon">P</div><h3>No parts or services</h3><p>Tap + to add</p></div>';return;}
  var borderClass=function(t){return t==='vendor_bill'?'entry-type-border-orange':t==='vendor_credit'?'entry-type-border-red':'entry-type-border-green';};
  var typeLabel=function(t){return t==='vendor_bill'?'Bill':t==='vendor_credit'?'Credit':'Service';};
  var all=active.concat(deleted);
  body.innerHTML=all.map(function(e){
    var isDel=e.active===false;
    var days=Math.floor((Date.now()-new Date(e.transaction_date))/86400000);
    var ageTag=days>60?'<span style="color:var(--danger);font-size:11px;margin-left:6px">'+days+'d old</span>':days>30?'<span style="color:#e67e22;font-size:11px;margin-left:6px">'+days+'d old</span>':'';
    var vName=(e.vendors&&e.vendors.name)||'---';
    var qName=(e.qbo_items&&e.qbo_items.name)||'---';
    var cardClickP = isDel ? '' : ' onclick="editLineItem(this.getAttribute(\'data-eid\'))" data-eid="'+e.id+'" style="cursor:pointer"';
    var out='<div class="entry-card '+borderClass(e.transaction_type)+(isDel?' deleted':'')+'"'+cardClickP+'>';
    if(isDel) out+='<div class="deleted-label">Deleted by '+escHtml(e.deleted_by||'?')+'</div>';
    out+='<div class="entry-card-header"><div class="entry-date">'+fmtDate(e.transaction_date)+' <span style="font-size:11px;font-weight:700">'+typeLabel(e.transaction_type)+'</span>'+ageTag+'</div><div class="entry-amount">$'+parseFloat(e.sell_total||0).toFixed(2)+'</div></div>';
    out+='<div class="entry-card-body">';
    out+='<div><div class="entry-label">Vendor</div><div class="entry-detail">'+escHtml(vName)+'</div></div>';
    out+='<div><div class="entry-label">Invoice #</div><div class="entry-detail">'+escHtml(e.invoice_number||'---')+'</div></div>';
    out+='<div><div class="entry-label">Item</div><div class="entry-detail">'+escHtml(qName)+'</div></div>';
    out+='<div><div class="entry-label">Description</div><div class="entry-detail">'+escHtml(e.description)+'</div></div>';
    out+='<div><div class="entry-label">Qty</div><div class="entry-detail">'+e.qty+'</div></div>';
    out+='<div><div class="entry-label">Cost/Sell</div><div class="entry-detail">$'+parseFloat(e.cost||0).toFixed(2)+' / $'+parseFloat(e.sell_total||0).toFixed(2)+'</div></div>';
    out+='</div><div class="entry-card-footer"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">'+escHtml(e.descriptor||'')+'</span>';
    if(isDel) out+='<button class="action-btn restore" onclick="event.stopPropagation();restoreEntry(\'line_items\',\''+e.id+'\')" >Restore</button>';
    else out+='<span style="font-size:11px;color:var(--text-muted)">tap to edit</span>';
    out+='</div></div>';
    return out;
  }).join('');
}

function onLineItemTypeChange(){
  var t=document.getElementById('p-type').value;
  var isService=t==='service';
  document.getElementById('p-vendor-row').style.display=isService?'none':'';
  document.getElementById('p-invoice-row').style.display=isService?'none':'';
  document.getElementById('p-cost-rows').style.display=isService?'none':'';
}
function calcLineItemTotals(){
  var cost=parseFloat((document.getElementById('p-cost')&&document.getElementById('p-cost').value)||0)||0;
  var margin=parseFloat((document.getElementById('p-margin')&&document.getElementById('p-margin').value)||0.5)||0.5;
  var qty=parseFloat((document.getElementById('p-qty')&&document.getElementById('p-qty').value)||1)||1;
  if(margin>=1) margin=0.5;
  var se=margin>0?cost/(1-margin):cost;
  var seEl=document.getElementById('p-sell-each');if(seEl)seEl.value=se.toFixed(2);
  var stEl=document.getElementById('p-sell-total');if(stEl)stEl.value=(se*qty).toFixed(2);
}

function showPartsForm(){
  document.getElementById('parts-add-form').style.display='block';
  
  document.getElementById('p-form-title').textContent='New Line Item';
  document.getElementById('p-save-btn').textContent='Save Entry';
  var pDel=document.getElementById('p-delete-btn'); if(pDel) pDel.style.display='none';
  AppState.editingEntryId=null;
}
function cancelPartsForm(){
  AppState.editingEntryId=null;
  var pDel=document.getElementById('p-delete-btn'); if(pDel) pDel.style.display='none';
  var pSave=document.getElementById('p-save-btn'); if(pSave){pSave._saving=false;pSave.disabled=false;pSave.style.opacity='';}
  var pStay=document.getElementById('p-add-another-btn'); if(pStay){pStay._saving=false;pStay.disabled=false;pStay.style.opacity='';}
}

function editLineItem(id){
  var e=AppState.lineItems.find(function(e){return e.id===id;}); if(!e)return;
  AppState.editingEntryId=id;
  populateVendorDropdown('p-vendor'); populateQBOItemDropdown('p-qbo-item');
  document.getElementById('p-type').value=e.transaction_type||'vendor_bill';
  document.getElementById('p-date').value=e.transaction_date||todayStr();
  document.getElementById('p-vendor').value=e.vendor_id||'';
  var vendor=AppState.vendors.find(function(v){return v.id===e.vendor_id;});
  var pvInput=document.getElementById('p-vendor-input');if(pvInput)pvInput.value=vendor?vendor.name:'';
  document.getElementById('p-invoice').value=e.invoice_number||'';
  document.getElementById('p-qbo-item').value=e.qbo_item_id||'';
  document.getElementById('p-description').value=e.description||'';
  document.getElementById('p-qty').value=e.qty||1;
  document.getElementById('p-cost').value=e.cost||0;
  document.getElementById('p-margin').value=e.margin||0.5;
  document.getElementById('p-billable').value=e.billable?'true':'false';
  onLineItemTypeChange(); calcLineItemTotals();
  var isTruckStock = !!AppState._isTruckStockEntry;
  var marginRow = document.getElementById('p-margin-row');
  var sellRow = document.getElementById('p-sell-row');
  if (marginRow) marginRow.style.display = isTruckStock ? 'none' : '';
  if (sellRow) sellRow.style.display = isTruckStock ? 'none' : '';
  document.getElementById('p-form-title').textContent='Edit Line Item';
  document.getElementById('p-save-btn').textContent='Update Entry';
  var pDel=document.getElementById('p-delete-btn'); if(pDel) pDel.style.display='';
  document.getElementById('parts-add-form').style.display='';
  
  document.getElementById('parts-add-form').scrollIntoView({behavior:'smooth'});
}

function saveLineItem(mode){
  var addAnother = mode==='stay' || mode==='new';
  var isNew = mode==='new';
  var saveBtn = addAnother
    ? document.getElementById('p-add-another-btn')
    : document.getElementById('p-save-btn');
  if (!btnSaving(saveBtn)) return;
  var isTruckStock = !!AppState._isTruckStockEntry;
  var type=document.getElementById('p-type').value;
  var date=document.getElementById('p-date').value;
  var vendorId=document.getElementById('p-vendor').value||null;
  var inv=document.getElementById('p-invoice').value.trim()||null;
  var qboId=document.getElementById('p-qbo-item').value;
  var desc=document.getElementById('p-description').value.trim();
  var qty=parseFloat(document.getElementById('p-qty').value)||1;
  var cost=parseFloat(document.getElementById('p-cost').value)||0;
  var margin=parseFloat(document.getElementById('p-margin').value)||0.5;
  var billable=document.getElementById('p-billable').value==='true';
  if(!date||!qboId||!desc){showToast('Date, QBO item, and description are required');return;}
  var margin=parseFloat(document.getElementById('p-margin').value)||0.5;
  if(margin>=1) margin=0.5;
  var se=cost/(1-margin); var st=se*qty;
  var vendor=AppState.vendors.find(function(v){return v.id===vendorId;});
  var qboItem=AppState.qboItems.find(function(q){return q.id===qboId;});
  var descriptor=AppState.currentWO.wo_number+(inv?' - '+inv:'')+(desc?' - '+desc:'');
  if(AppState.editingEntryId){
    sb.patch('line_items',AppState.editingEntryId,{transaction_type:type,transaction_date:date,vendor_id:vendorId,invoice_number:inv,qbo_item_id:qboId,description:desc,qty:qty,cost:cost,margin:margin,sell_each:se,sell_total:st,billable:billable,descriptor:descriptor,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok){
        var idx=AppState.lineItems.findIndex(function(e){return e.id===AppState.editingEntryId;});
        if(idx>=0) AppState.lineItems[idx]=Object.assign({},AppState.lineItems[idx],{transaction_type:type,transaction_date:date,vendor_id:vendorId,invoice_number:inv,qbo_item_id:qboId,description:desc,qty:qty,cost:cost,margin:margin,sell_each:se,sell_total:st,billable:billable,descriptor:descriptor,vendors:vendor,qbo_items:qboItem});
        delete AppState.projectedCache[AppState.currentWO.id];
        renderPartsList();cancelPartsForm();showToast('Line item updated'); btnDone(saveBtn);
      } else { btnDone(saveBtn); showToast('Error updating'); }
    });
  } else {
    sb.post('line_items',{work_order_id:AppState.currentWO.id,transaction_type:type,transaction_date:date,vendor_id:vendorId,invoice_number:inv,qbo_item_id:qboId,description:desc,qty:qty,cost:cost,margin:margin,sell_each:se,sell_total:st,billable:billable,descriptor:descriptor,customer_id:AppState.currentWO.customer_id,created_by:AppState.userEmail,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok&&r.data&&r.data.length){
        AppState.lineItems.push(Object.assign({},r.data[0],{vendors:vendor,qbo_items:qboItem}));
        delete AppState.projectedCache[AppState.currentWO.id];
        AppState._suppressPartsRerender = true;
        setTimeout(function(){ AppState._suppressPartsRerender = false; }, 1000);
        renderPartsList();
        if(isTruckStock && typeof renderTruckStock==='function') renderTruckStock();
        if(addAnother){document.getElementById('p-invoice').value='';document.getElementById('p-description').value='';document.getElementById('p-qty').value='1';document.getElementById('p-cost').value='';calcLineItemTotals();AppState.editingEntryId=null;btnDone(saveBtn);showToast(isNew?'Saved — add next item':'Saved - add another');document.getElementById('p-description').focus();}
        else{cancelPartsForm();btnDone(saveBtn);showToast('Line item saved');goBack();}
      } else { btnDone(saveBtn); showToast('Error saving'); }
    });
  }
}

function populateVendorDropdown(elId){ var el=document.getElementById(elId);if(!el)return;el.innerHTML='<option value="">Select vendor...</option>'+AppState.vendors.map(function(v){return'<option value="'+v.id+'">'+escHtml(v.name)+'</option>';}).join(''); }
function populateQBOItemDropdown(elId){ var el=document.getElementById(elId);if(!el)return;el.innerHTML=AppState.qboItems.map(function(q){return'<option value="'+q.id+'">'+escHtml(q.name)+'</option>';}).join(''); }

// QUOTED INVOICE
function openQuotedList(){
  document.getElementById('q-description').value='';
  document.getElementById('q-amount').value='';
  document.getElementById('q-po').value='';
  cancelQuotedForm(); renderQuotedList();
  pushScreen('screen-quoted-list','Quoted Invoice');
}

function renderQuotedList(){
  var active=AppState.quotedLines.filter(function(e){return e.active!==false;});
  var deleted=AppState.quotedLines.filter(function(e){return e.active===false;});
  var total=active.reduce(function(s,e){return s+parseFloat(e.amount||0);},0);
  document.getElementById('quoted-count').textContent=active.length;
  document.getElementById('quoted-total').textContent='$'+total.toFixed(2);
  var body=document.getElementById('quoted-list-body');
  if(!AppState.quotedLines.length){body.innerHTML='<div class="empty-state"><div class="empty-state-icon">Q</div><h3>No quoted lines</h3><p>Tap + to add</p></div>';return;}
  var all=active.concat(deleted);
  body.innerHTML=all.map(function(e){
    var isDel=e.active===false;
    var out='<div class="entry-card entry-type-border-green'+(isDel?' deleted':'')+'">';
    if(isDel) out+='<div class="deleted-label">Deleted by '+escHtml(e.deleted_by||'?')+'</div>';
    out+='<div class="entry-card-header"><div class="entry-date">Quoted Line</div><div class="entry-amount">$'+parseFloat(e.amount||0).toFixed(2)+'</div></div>';
    out+='<div class="entry-card-body single-col"><div><div class="entry-label">Description</div><div class="entry-detail">'+escHtml(e.description)+'</div></div>';
    if(e.po_number) out+='<div><div class="entry-label">PO</div><div class="entry-detail">'+escHtml(e.po_number)+'</div></div>';
    out+='</div><div class="entry-card-footer"><span></span><div style="display:flex;gap:8px">';
    if(isDel) out+='<button class="action-btn restore" onclick="restoreEntry(\'quoted_invoices\',\''+e.id+'\')">Restore</button>';
    else{ out+='<button class="action-btn edit" onclick="editQuotedLine(\''+e.id+'\')">Edit</button>'; out+='<button class="action-btn danger" onclick="softDelete(\'quoted_invoices\',\''+e.id+'\')">Delete</button>'; }
    out+='</div></div></div>';
    return out;
  }).join('');
}

function showQuotedForm(){
  document.getElementById('quoted-add-form').style.display='';
  document.getElementById('fab-quoted').classList.add('hidden');
  document.getElementById('q-form-title').textContent='New Quoted Line';
  document.getElementById('q-save-btn').textContent='Save';
  AppState.editingEntryId=null;
}
function cancelQuotedForm(){ document.getElementById('quoted-add-form').style.display='none'; document.getElementById('fab-quoted').classList.remove('hidden'); AppState.editingEntryId=null; }

function editQuotedLine(id){
  var e=AppState.quotedLines.find(function(e){return e.id===id;}); if(!e)return;
  AppState.editingEntryId=id;
  document.getElementById('q-description').value=e.description||'';
  document.getElementById('q-amount').value=e.amount||'';
  document.getElementById('q-po').value=e.po_number||'';
  document.getElementById('q-form-title').textContent='Edit Quoted Line';
  document.getElementById('q-save-btn').textContent='Update';
  document.getElementById('quoted-add-form').style.display='';
  document.getElementById('fab-quoted').classList.add('hidden');
  document.getElementById('quoted-add-form').scrollIntoView({behavior:'smooth'});
}

function saveQuotedLine(){
  var desc=document.getElementById('q-description').value.trim();
  var amount=parseFloat(document.getElementById('q-amount').value);
  var po=document.getElementById('q-po').value.trim();
  if(!desc||!amount){showToast('Description and amount are required');return;}
  if(AppState.editingEntryId){
    sb.patch('quoted_invoices',AppState.editingEntryId,{description:desc,amount:amount,po_number:po||null,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok){
        var idx=AppState.quotedLines.findIndex(function(e){return e.id===AppState.editingEntryId;});
        if(idx>=0) AppState.quotedLines[idx]=Object.assign({},AppState.quotedLines[idx],{description:desc,amount:amount,po_number:po||null});
        delete AppState.projectedCache[AppState.currentWO.id];
        renderQuotedList();cancelQuotedForm();showToast('Quoted line updated');
      } else showToast('Error updating');
    });
  } else {
    sb.post('quoted_invoices',{work_order_id:AppState.currentWO.id,description:desc,amount:amount,po_number:po||null,created_by:AppState.userEmail,modified_by:AppState.userEmail}).then(function(r){
      if(r.ok&&r.data&&r.data.length){
        AppState.quotedLines.push(r.data[0]);
        delete AppState.projectedCache[AppState.currentWO.id];
        renderQuotedList();cancelQuotedForm();showToast('Quoted line saved');
      } else showToast('Error saving');
    });
  }
}

// SOFT DELETE & RESTORE
function softDeleteEditing(table){
  var id=AppState.editingEntryId; if(!id){showToast('No entry selected');return;}
  if(table==='hours_entries') cancelHoursForm();
  if(table==='line_items') cancelPartsForm();
  softDelete(table,id);
}
function softDelete(table,id){
  if(!confirm('Delete this entry? It can be restored.'))return;
  sb.patch(table,id,{active:false,deleted_at:new Date().toISOString(),deleted_by:AppState.userEmail}).then(function(r){
    if(r.ok){
      var arr=_getArr(table); var e=arr.find(function(e){return e.id===id;}); if(e){e.active=false;e.deleted_by=AppState.userEmail;}
      if(AppState.currentWO) delete AppState.projectedCache[AppState.currentWO.id];
      _rerender(table);showToast('Deleted - tap Restore to undo');
    } else showToast('Error deleting');
  });
}
function restoreEntry(table,id){
  sb.patch(table,id,{active:true,deleted_at:null,deleted_by:null}).then(function(r){
    if(r.ok){
      var arr=_getArr(table); var e=arr.find(function(e){return e.id===id;}); if(e){e.active=true;e.deleted_by=null;e.deleted_at=null;}
      if(AppState.currentWO) delete AppState.projectedCache[AppState.currentWO.id];
      _rerender(table);showToast('Restored');
    } else showToast('Error restoring');
  });
}
function _getArr(table){ if(table==='hours_entries')return AppState.hoursEntries; if(table==='line_items')return AppState.lineItems; if(table==='quoted_invoices')return AppState.quotedLines; return[]; }
function _rerender(table){ 
  if(table==='hours_entries') renderHoursList(); 
  if(table==='line_items' && !AppState._suppressPartsRerender) renderPartsList(); 
  if(table==='quoted_invoices') renderQuotedList(); 
}

// ZED AXIS EXPORT
function runExport(wos) {
  if(!wos.length){showToast('No work orders to export');return;}
  showToast('Building export... please wait');
  var woIds=wos.map(function(w){return w.id;});
  var idList=woIds.join(',');
  var inFilter='?work_order_id=in.('+idList+')';
  Promise.all([
    sb.get('hours_entries',  inFilter+'&active=eq.true&select=*,technicians(name),hours_types(name,zed_axis_name)'),
    sb.get('line_items',     inFilter+'&active=eq.true&select=*,vendors(name),qbo_items(name,zed_axis_name)'),
    sb.get('quoted_invoices',inFilter+'&active=eq.true&select=*'),
  ]).then(function(results){
    var hours  = results[0].ok?results[0].data||[]:[];
    var parts  = results[1].ok?results[1].data||[]:[];
    var quoted = results[2].ok?results[2].data||[]:[];
    var teamMember = AppState.settings.team_member_default||'Kevin Reb';
    var now = new Date();
    var woN=function(wo){var n=wo.wo_number.replace(/^[A-Za-z]+/,'');return n+':'+wo.title;};
    var woNum=function(wo){return wo.wo_number.replace(/^[A-Za-z]+/,'');};
    var stLabel=function(wo){var st=getStatus(wo.status);return String(st.num).padStart(2,'0')+'-'+st.name;};
    var cN2=function(wo){var f=AppState.customers.find(function(c){return c.id===wo.customer_id;});return(wo.customers&&wo.customers.name)||(f&&f.name)||'';};
    var cN=function(wo){var f=AppState.customers.find(function(c){return c.id===wo.customer_id;});return(wo.customers&&wo.customers.name)||(f&&f.name)||'';};
    var fD=function(d){if(!d)return'';var s=String(d).split('T')[0];var p=s.split('-');if(p.length===3){var dt=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));return(dt.getMonth()+1).toString().padStart(2,'0')+'/'+dt.getDate().toString().padStart(2,'0')+'/'+dt.getFullYear();}var dt2=new Date(d);return(dt2.getMonth()+1).toString().padStart(2,'0')+'/'+dt2.getDate().toString().padStart(2,'0')+'/'+dt2.getFullYear();};
    var decToHHMM=function(dec){var h=Math.floor(parseFloat(dec)||0);var m=Math.round(((parseFloat(dec)||0)%1)*60);return h+':'+(m<10?'0':'')+m;};
    var s1=[['ID','Name','Team Member','Status','Customer Billed','Date','Form Mode','PO Number','Work Description','Exported By','Export Date']];
    wos.forEach(function(wo){s1.push([wo.id,woN(wo),teamMember,stLabel(wo),cN(wo),fD(wo.created_at),wo.form_mode==='quoted'?'Quoted':'Time Materials',wo.po_number||'','',AppState.userEmail,fD(now.toISOString())]);});
    var s2=[['ID','Name','Team Member','Status','Customer Billed','Date','Service Tech','Hours Type','Hours','Billable','Work Order Descriptor','Job Class']];
    hours.forEach(function(e){var wo=wos.find(function(w){return w.id===e.work_order_id;});if(!wo)return;var ht=e.hours_types;s2.push([wo.id,woN(wo),teamMember,stLabel(wo),cN(wo),fD(e.entry_date),(e.technicians&&e.technicians.name)||'',(ht&&ht.zed_axis_name)||(ht&&ht.name)||'',decToHHMM(e.hours),e.billable?'Billable':'NotBillable',e.descriptor||'','']);});
    var s3=[['ID','Name','Team Member','Status','Purchased Parts','Transaction Date','Supplier','Invoice','Part EDP','Part Description','Qty','Cost','Margin Level','Sell Each','Sell Total','Customer Charged','WO Number','Test WO','PO Number','Class Type','Descriptor']];
    parts.filter(function(e){return e.transaction_type!=='vendor_credit';}).forEach(function(e){
      var wo=wos.find(function(w){return w.id===e.work_order_id;});
      var isTruck=e.transaction_type==='truck_stock';
      var qi=e.qbo_items;
      var edpName=e.transaction_type==='service'?'Services':((qi&&qi.zed_axis_name)||(qi&&qi.name)||'Parts');
      s3.push([isTruck?'':(wo&&wo.id||''),isTruck?'':(wo?woN(wo):''),teamMember,isTruck?'':(wo?stLabel(wo):''),'Yes',fD(e.transaction_date),(e.vendors&&e.vendors.name)||'',e.invoice_number||'',edpName,e.description,e.qty,e.cost||0,e.margin,e.sell_each||0,e.sell_total||0,isTruck?'':cN(wo),isTruck?'':(wo?woNum(wo):''),'',wo&&wo.po_number||'','',e.descriptor||'']);
    });
    var s4=[['ID','Name','Team Member','Status','Date','Customer Billed','Quoted Amount','PO Number','Work Description','Lead Time','Class_1']];
    quoted.forEach(function(e){var wo=wos.find(function(w){return w.id===e.work_order_id;});if(!wo)return;s4.push([wo.id,woN(wo),teamMember,stLabel(wo),fD(e.created_at),cN(wo),e.amount,e.po_number||wo.po_number||'',e.description,'','']);});
    var s5=[['ID','Name','Team Member','Status']];
    var creditWOs={};
    parts.filter(function(e){return e.transaction_type==='vendor_credit';}).forEach(function(e){creditWOs[e.work_order_id]=true;});
    Object.keys(creditWOs).forEach(function(woId){var wo=wos.find(function(w){return w.id===woId;});if(!wo)return;s5.push([wo.id,woN(wo),teamMember,stLabel(wo)]);});
    var doExport=function(){_buildXLSX(wos,woIds,now,s1,s2,s3,s4,s5);};
    if(typeof XLSX==='undefined'){
      var script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload=doExport;script.onerror=function(){showToast('Could not load Excel library');};
      document.head.appendChild(script);
    } else doExport();
  });
}

function _buildXLSX(wos,woIds,now,s1,s2,s3,s4,s5){
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s1),'QBWO Form');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s2),'QBWO Form-Hours Entry');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s3),'QBWO Form-All Parts Services');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s4),'QBWO Form-Quoted Invoice Form');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s5),'QBWO Form-Vendor Credit Form E');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['QBWO Form-Approval Information']]),'QBWO Form-Approval Information');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['QBWO Form-Site Check-In Check']]),'QBWO Form-Site Check-In Check');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['QBWO Form-Admin Hour Entry']]),'QBWO Form-Admin Hour Entry');
  var filename='ZedAxis_Export_'+now.toISOString().slice(0,10)+'_'+wos.length+'WOs.xlsx';
  XLSX.writeFile(wb,filename);
  sb.post('export_history',{exported_by:AppState.userEmail,wo_count:wos.length,wo_ids:woIds,filename:filename});
  var updates=wos.map(function(wo){
    var _exportSt = getStatusByKey('batch_invoice') || getStatusByKey('invoiced');
    var _sList = (AppState.statuses&&AppState.statuses.length)?AppState.statuses:[];
    if (!_exportSt) _exportSt = _sList.filter(function(s){return s.category==='processed';}).sort(function(a,b){return a.sort_order-b.sort_order;})[0];
    var _procNum = _exportSt ? _exportSt.num : 11;
    return sb.patch('work_orders',wo.id,{status:_procNum,exported_at:now.toISOString(),exported_by:AppState.userEmail,modified_by:AppState.userEmail}).then(function(){
      wo.status=_procNum; wo.exported_at=now.toISOString();
      var idx=AppState.workOrders.findIndex(function(w){return w.id===wo.id;});
      if(idx>=0) AppState.workOrders[idx]=wo;
    });
  });
  Promise.all(updates).then(function(){
    clearSelection(); renderDesktopGrid(); loadExportHistory();
    showToast('Exported '+wos.length+' WO'+(wos.length>1?'s':'')+' - file downloading');
  });
}

// DWO IMPORT
function _processDWOExcel(file){
  showToast('Reading DWO export...');
  Promise.all([loadWorkOrders(),loadCustomers(),loadTechnicians(),loadHoursTypes(),loadQBOItems(),loadVendors()]).then(function(){
    file.arrayBuffer().then(function(buf){
      var wb=XLSX.read(buf,{type:'array',cellDates:false,raw:false});
      var mainSheet  =wb.Sheets['QBWO Form'];
      var hoursSheet =wb.Sheets['QBWO Form-Hours Entry'];
      var partsSheet =wb.Sheets['QBWO Form-All Parts Services'];
      var quotedSheet=wb.Sheets['QBWO Form-Quoted Invoice Form'];
      if(!mainSheet){showToast('Could not find "QBWO Form" sheet');return;}
      var mainRows  =XLSX.utils.sheet_to_json(mainSheet,  {defval:'',raw:false});
      var hoursRows =hoursSheet ?XLSX.utils.sheet_to_json(hoursSheet, {defval:'',raw:false}):[];
      var partsRows =partsSheet ?XLSX.utils.sheet_to_json(partsSheet, {defval:'',raw:false}):[];
      var quotedRows=quotedSheet?XLSX.utils.sheet_to_json(quotedSheet,{defval:'',raw:false}):[];
      var statusMap={'00-Approval Request':0,'01-Quote Request':1,'02-Quoted':2,'03-Parts to be Ordered':3,'04-In Research':4,'05-Parts Ordered':5,'06-Work Ready':6,'07-In Progress':7,'08-Entry Work Needed':8,'09-Recheck Job':9,'10-Completed':10,'11-BATCH INVOICE PROCESS':11,'12-Invoiced':12,'15-Invoiced outside DWO':15,'99-Cancelled':99};
      function parseWOName(raw){var str=String(raw||'').trim();var ci=str.indexOf(':');if(ci<0)return{woNumber:str,title:str};var left=str.slice(0,ci).trim();var title=str.slice(ci+1).trim();var num=left.replace(/^[Pp]+/,'');return{woNumber:'P'+num,title:title};}
      function parseDate(val){if(!val)return todayStr();var s=String(val).trim();if(s.match(/^\d{4}-\d{2}-\d{2}/))return s.slice(0,10);var parts=s.split('/');if(parts.length===3){var m=parts[0],d=parts[1],y=parts[2];return y.padStart(4,'20')+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');}return todayStr();}
      var preview=[];var addCustRow=AppState.customers.find(function(c){return c.qbo_customer_id==='SYSTEM';});
      var flaggedCust=0,flaggedTest=0,flaggedAdmin=0;
      mainRows.forEach(function(row){
        var parsed=parseWOName(row['Name']); var woNumber=parsed.woNumber; var title=parsed.title;
        var custName=String(row['Customer']||'').trim();
        var isAdmin=custName==='Admin Charge'||custName==='';
        var isTest=title.toLowerCase()==='test'||title.toLowerCase().indexOf('test ')===0||title.toLowerCase().slice(-5)===' test';
        var custMatch=isAdmin?null:AppState.customers.find(function(c){return c.name===custName||c.display_name===custName||c.name.slice(-custName.length-1)===(':'+custName);});
        var flagCust=!isAdmin&&!custMatch;
        if(flagCust)flaggedCust++;if(isTest)flaggedTest++;if(isAdmin)flaggedAdmin++;
        preview.push({row:row,woNumber:woNumber,title:title,custName:custName,isAdmin:isAdmin,isTest:isTest,flagCust:flagCust,custMatch:custMatch});
      });
      var msg='DWO Import Preview\n---------------------\n'+mainRows.length+' work orders total\n'+flaggedAdmin+' Admin Charge => Truck Stock\n'+flaggedTest+' test entries => skipped\n'+flaggedCust+' customer not matched => flagged\n\n'+hoursRows.length+' hours rows\n'+partsRows.length+' parts/services rows\n'+quotedRows.length+' quoted rows\n\nProceed with import?';
      if(!confirm(msg)){showToast('Import cancelled');return;}
      showToast('Importing... please wait');
      var imported=0,skipped=0; var woIdMap={};
      var doMainRow=function(i){
        if(i>=preview.length){doHoursRow(0);return;}
        var item=preview[i];
        if(item.isTest){skipped++;doMainRow(i+1);return;}
        if(AppState.workOrders.find(function(w){return w.wo_number===item.woNumber;})){skipped++;doMainRow(i+1);return;}
        var row=item.row;
        var statusNum=statusMap[String(row['Status']||'').trim()];if(statusNum===undefined)statusNum=7;
        var mode=String(row['Form Mode']||'Time Materials').trim().toLowerCase().indexOf('quoted')>=0?'quoted':'time_materials';
        var poRaw=String(row['Purchase Order Number']||'').trim();
        var poResult=typeof validatePONumber==='function'?validatePONumber(poRaw):{po:poRaw||null,needsFlag:false};
        var po=poResult.po;
        var importFlagPO=poResult.needsFlag;
        var scheduledDate=parseDate(row['Scheduled Date']);
        var lastUpdate=parseDate(row['Last Update']);
        var completedRaw=row['Completed Date 36-0'];
        var completedDate=completedRaw&&completedRaw!=='Not Completed'?parseDate(completedRaw):null;
        var custId=item.isAdmin?(addCustRow&&addCustRow.id):(item.custMatch?item.custMatch.id:(addCustRow&&addCustRow.id));
        sb.post('work_orders',{wo_number:item.woNumber,title:item.title||'Imported WO',customer_id:custId||null,customer_flag:item.flagCust,form_mode:mode,status:statusNum,po_number:po||null,work_description:null,completed_at:completedDate?new Date(completedDate).toISOString():null,flag_needs_po:importFlagPO||false,flag_needs_po_note:importFlagPO?'PO required — "need" detected in import':null,created_by:'DWO Import',modified_by:'DWO Import'}).then(function(r){
          if(!r.ok||!r.data||!r.data.length){doMainRow(i+1);return;}
          var newId=r.data[0].id;
          sb.patch('work_orders',newId,{created_at:new Date(scheduledDate).toISOString(),modified_at:new Date(lastUpdate).toISOString()});
          var numKey=item.woNumber.replace(/^P/,'');
          woIdMap[numKey]=newId; woIdMap[item.woNumber]=newId;
          imported++; doMainRow(i+1);
        });
      };
      var hoursImported=0,hoursSkipped=0;
      var doHoursRow=function(i){
        if(i>=hoursRows.length){doPartsRow(0);return;}
        var row=hoursRows[i];
        var parsed=parseWOName(row['Name']); var numKey=parsed.woNumber.replace(/^P/,'');
        var woId=woIdMap[parsed.woNumber]||woIdMap[numKey];
        if(!woId){hoursSkipped++;doHoursRow(i+1);return;}
        var techName=String(row['Service Tech']||'').trim();
        var typeName=String(row['Hours Type']||'Hours').trim();
        var hoursVal=parseFloat(row['Hours'])||0;
        var billable=String(row['Billable']||'Billable').trim()!=='NotBillable';
        var entryDate=parseDate(row['Date']);
        var descriptor=String(row['Work Order Descriptor']||'').trim()||null;
        var tech=AppState.technicians.find(function(t){return t.name===techName;});
        var hType=AppState.hoursTypes.find(function(t){return t.name===typeName||t.zed_axis_name===typeName;});
        if(!tech||!hType){hoursSkipped++;doHoursRow(i+1);return;}
        var rate=parseFloat(AppState.settings[hType.internal_rate_key]||0);
        sb.post('hours_entries',{work_order_id:woId,entry_date:entryDate,tech_id:tech.id,hours_type_id:hType.id,hours:hoursVal,billable:billable,internal_rate:rate,line_total:hoursVal*rate,descriptor:descriptor,created_by:'DWO Import',modified_by:'DWO Import'}).then(function(r){if(r.ok)hoursImported++;else hoursSkipped++;doHoursRow(i+1);});
      };
      var partsImported=0,partsSkipped=0;
      var doPartsRow=function(i){
        if(i>=partsRows.length){doQuotedRow(0);return;}
        var row=partsRows[i];
        var parsed=parseWOName(row['Name']); var numKey=parsed.woNumber.replace(/^P/,'');
        var woId=woIdMap[parsed.woNumber]||woIdMap[numKey]||null;
        var custCharged=String(row['Customer Charged']||'').trim();
        var isAdminCharge=custCharged==='Admin Charge'||custCharged==='';
        var isTruck=isAdminCharge&&!woId;
        if(!woId&&!isTruck){partsSkipped++;doPartsRow(i+1);return;}
        var desc=String(row['Part Description']||'').trim();if(!desc){partsSkipped++;doPartsRow(i+1);return;}
        var edp=String(row['Part EDP']||'Parts').trim().toLowerCase();
        var vendorName=String(row['Supplier']||'').trim();
        var vendor=AppState.vendors.find(function(v){return v.name===vendorName;});
        var transType=isTruck?'truck_stock':edp==='services'?'service':'vendor_bill';
        var itemName=String(row['Part EDP']||'Parts').trim();
        var qboItem=AppState.qboItems.find(function(q){return q.zed_axis_name===itemName||q.name===itemName||((q.zed_axis_name&&q.zed_axis_name.toLowerCase())===edp);});
        var qboItemId=(qboItem&&qboItem.id)||(AppState.qboItems.find(function(q){return q.name==='Parts'||q.name==='Services';})||{}).id;
        if(!qboItemId){partsSkipped++;doPartsRow(i+1);return;}
        var txDate=parseDate(row['Transaction Date']);
        var cost=parseFloat(row['Cost']||0);
        var margin=parseFloat(row['Margin Level']||AppState.settings.default_margin||0.5);
        var qty=parseFloat(row['Qty']||1);
        var sellEach=parseFloat(row['Sell Each']||0)||(margin>0?cost/margin:0);
        var sellTotal=parseFloat(row['Sell Total']||0)||sellEach*qty;
        var inv=String(row['Invoice']||'').trim()||null;
        var descriptor=String(row['Descriptor']||'').trim()||null;
        var custMatch=AppState.customers.find(function(c){return c.name===custCharged||c.display_name===custCharged;});
        sb.post('line_items',{work_order_id:isTruck?null:woId,transaction_type:transType,transaction_date:txDate,vendor_id:(vendor&&vendor.id)||null,invoice_number:inv,qbo_item_id:qboItemId,description:desc,qty:qty,cost:cost,margin:margin,sell_each:sellEach,sell_total:sellTotal,billable:transType!=='truck_stock',descriptor:descriptor,customer_id:(custMatch&&custMatch.id)||null,created_by:'DWO Import',modified_by:'DWO Import'}).then(function(r){if(r.ok)partsImported++;else partsSkipped++;doPartsRow(i+1);});
      };
      var quotedImported=0,quotedSkipped=0;
      var doQuotedRow=function(i){
        if(i>=quotedRows.length){
          loadWorkOrders().then(function(){renderWOList();renderDesktopGrid();});
          alert('Import Complete!\n---------------------\nWork Orders: '+imported+' imported, '+skipped+' skipped\nHours: '+hoursImported+' imported, '+hoursSkipped+' skipped\nParts/Svcs: '+partsImported+' imported, '+partsSkipped+' skipped\nQuoted: '+quotedImported+' imported, '+quotedSkipped+' skipped\n\nWOs with unmatched customers are flagged.');
          return;
        }
        var row=quotedRows[i];
        var parsed=parseWOName(row['Name']); var numKey=parsed.woNumber.replace(/^P/,'');
        var woId=woIdMap[parsed.woNumber]||woIdMap[numKey];if(!woId){quotedSkipped++;doQuotedRow(i+1);return;}
        var desc=String(row['Work Description']||'').trim();
        var amount=parseFloat(row['Quoted Amount']||0);
        var po=String(row['PO Number']||'').trim()||null;
        if(!desc||!amount){quotedSkipped++;doQuotedRow(i+1);return;}
        sb.post('quoted_invoices',{work_order_id:woId,description:desc,amount:amount,po_number:po,created_by:'DWO Import',modified_by:'DWO Import'}).then(function(r){if(r.ok)quotedImported++;else quotedSkipped++;doQuotedRow(i+1);});
      };
      doMainRow(0);
    });
  });
}
