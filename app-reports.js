// app-reports.js — Report generation and delivery

var ReportState = {
  currentType: null,
  selectedRoleId: null,
  selectedContacts: [],
  contacts: []
};

function openReportSheet() {
  var wo = AppState.currentWO;
  if (!wo || !wo.customer_id) { showToast('No customer on this work order'); return; }
  ReportState.currentType = null;
  ReportState.selectedRoleId = null;
  ReportState.selectedContacts = [];
  ReportState.contacts = [];
  document.getElementById('report-sheet').style.display = 'flex';
  _renderReportStep1();
}

function closeReportSheet(e) {
  if (e && e.target !== document.getElementById('report-sheet')) return;
  document.getElementById('report-sheet').style.display = 'none';
}

function _renderReportStep1() {
  var isAdmin = AppState.userRole === 'admin';
  var body = document.getElementById('report-sheet-body'); if (!body) return;
  var html = '<div style="font-size:15px;font-weight:700;margin-bottom:16px">Select Report Type</div>';
  html += '<div style="display:flex;flex-direction:column;gap:10px">';
  html += '<button onclick="selectReportType(\'update\')" style="text-align:left;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">'
    + '<div style="font-weight:600;font-size:14px">Work Update</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">Summary of work performed to date — no pricing</div>'
    + '</button>';
  if (isAdmin) {
    html += '<button onclick="selectReportType(\'pricing\')" style="text-align:left;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);cursor:pointer">'
      + '<div style="font-weight:600;font-size:14px">Pricing Summary</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">Full labor and materials breakdown with totals</div>'
      + '</button>';
  }
  html += '</div>';
  body.innerHTML = html;
}

function selectReportType(type) {
  ReportState.currentType = type;
  _renderReportStep2();
}

function _renderReportStep2() {
  var body = document.getElementById('report-sheet-body'); if (!body) return;
  var wo = AppState.currentWO;

  var html = '<div style="font-size:15px;font-weight:700;margin-bottom:4px">Send To</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Filter contacts by role or add an email manually</div>';

  // Role filter pills
  if (AppState.contactRoleTypes && AppState.contactRoleTypes.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
    var allSel = !ReportState.selectedRoleId;
    html += '<button style="font-size:12px;padding:4px 12px;border-radius:12px;border:1px solid '+(allSel?'var(--header-bg)':'var(--border)')+';background:'+(allSel?'var(--header-bg)':'var(--bg)')+';color:'+(allSel?'#fff':'var(--text-muted)')+';cursor:pointer" onclick="filterReportByRole(null)">All</button>';
    AppState.contactRoleTypes.forEach(function(rt) {
      var sel = ReportState.selectedRoleId === rt.id;
      html += '<button style="font-size:12px;padding:4px 12px;border-radius:12px;border:1px solid '+(sel?'var(--header-bg)':'var(--border)')+';background:'+(sel?'var(--header-bg)':'var(--bg)')+';color:'+(sel?'#fff':'var(--text-muted)')+';cursor:pointer" data-rid="'+rt.id+'" onclick="filterReportByRole(this.getAttribute(\'data-rid\'))">'+escHtml(rt.name)+'</button>';
    });
    html += '</div>';
  }

  // Contact list placeholder
  html += '<div id="report-contact-list" style="margin-bottom:12px;min-height:40px">'
    + '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:10px">Loading contacts...</div>'
    + '</div>';

  // Manual email
  html += '<div style="border-top:1px solid var(--border);padding-top:10px;margin-bottom:14px">';
  html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px">Or add email directly</div>';
  html += '<input type="email" id="report-manual-email" placeholder="email@example.com" style="width:100%;box-sizing:border-box;font-size:13px;padding:7px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text-primary)">';
  html += '</div>';

  html += '<div style="display:flex;gap:8px">';
  html += '<button style="flex:1;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:13px;cursor:pointer;color:var(--text-primary)" onclick="_renderReportStep1()">← Back</button>';
  html += '<button class="btn-dark" style="flex:2;padding:10px;font-size:14px" onclick="generateAndSendReport()">Generate Report</button>';
  html += '</div>';

  body.innerHTML = html;
  _loadReportContacts(wo.customer_id);
}

function _loadReportContacts(customerId) {
  sb.get('customer_contacts', '?customer_id=eq.'+customerId+'&active=eq.true&select=*,customer_contact_roles(role_type_id)&order=name.asc').then(function(r) {
    ReportState.contacts = r.ok ? (r.data||[]) : [];
    _renderReportContactList();
  });
}

function filterReportByRole(roleId) {
  ReportState.selectedRoleId = roleId || null;
  // Update pill styles without full re-render
  var pills = document.querySelectorAll('#report-sheet-body [data-rid]');
  var allPill = document.querySelector('#report-sheet-body [onclick="filterReportByRole(null)"]');
  if (allPill) {
    var allSel = !roleId;
    allPill.style.background = allSel ? 'var(--header-bg)' : 'var(--bg)';
    allPill.style.borderColor = allSel ? 'var(--header-bg)' : 'var(--border)';
    allPill.style.color = allSel ? '#fff' : 'var(--text-muted)';
  }
  pills.forEach(function(p) {
    var sel = p.getAttribute('data-rid') === roleId;
    p.style.background = sel ? 'var(--header-bg)' : 'var(--bg)';
    p.style.borderColor = sel ? 'var(--header-bg)' : 'var(--border)';
    p.style.color = sel ? '#fff' : 'var(--text-muted)';
  });
  _renderReportContactList();
}

function _renderReportContactList() {
  var list = document.getElementById('report-contact-list'); if (!list) return;
  var contacts = ReportState.contacts;
  if (ReportState.selectedRoleId) {
    contacts = contacts.filter(function(c) {
      return (c.customer_contact_roles||[]).some(function(r){ return r.role_type_id === ReportState.selectedRoleId; });
    });
  }
  if (!contacts.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:10px">No contacts'+(ReportState.selectedRoleId?' with this role':' for this customer')+'</div>';
    return;
  }
  var html = '';
  contacts.forEach(function(c) {
    var checked = ReportState.selectedContacts.indexOf(c.id) >= 0;
    var roleNames = (c.customer_contact_roles||[]).map(function(r) {
      var rt = AppState.contactRoleTypes.find(function(x){return x.id===r.role_type_id;});
      return rt ? rt.name : '';
    }).filter(Boolean).join(', ');
    html += '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer">';
    html += '<input type="checkbox" '+(checked?'checked':'')+' data-cid="'+c.id+'" onchange="toggleReportContact(this.getAttribute(\'data-cid\'),this.checked)" style="width:16px;height:16px;flex-shrink:0">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:13px;font-weight:600">'+escHtml(c.name)+'</div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">'+escHtml(c.email)+(roleNames?' · '+roleNames:'')+'</div>';
    html += '</div></label>';
  });
  list.innerHTML = html;
}

function toggleReportContact(contactId, checked) {
  var idx = ReportState.selectedContacts.indexOf(contactId);
  if (checked && idx < 0) ReportState.selectedContacts.push(contactId);
  if (!checked && idx >= 0) ReportState.selectedContacts.splice(idx, 1);
}

function generateAndSendReport() {
  var wo = AppState.currentWO;
  var manualEmail = ((document.getElementById('report-manual-email')||{}).value||'').trim();
  if (!ReportState.selectedContacts.length && !manualEmail) {
    showToast('Select at least one recipient or enter an email');
    return;
  }
  var recipients = ReportState.contacts.filter(function(c){ return ReportState.selectedContacts.indexOf(c.id)>=0; });

  var proceed = function() {
    Promise.all([
      sb.get('hours_entries', '?work_order_id=eq.'+wo.id+'&active=eq.true&billable=eq.true&select=*,technicians(name),hours_types(name,internal_rate_key)&order=entry_date.asc'),
      sb.get('line_items',   '?work_order_id=eq.'+wo.id+'&active=eq.true&transaction_type=neq.vendor_credit&select=*,vendors(name),qbo_items(name)&order=transaction_date.asc')
    ]).then(function(res) {
      var hours = res[0].ok ? (res[0].data||[]) : [];
      var parts = res[1].ok ? (res[1].data||[]) : [];
      var toAddrs = recipients.map(function(r){return r.email;});
      if (manualEmail) toAddrs.push(manualEmail);
      var html = _buildReportHTML(wo, hours, parts, ReportState.currentType, toAddrs);
      _openReportWindow(html, wo, toAddrs);
    });
  };

  // Prompt to save manually-typed email
  if (manualEmail && wo.customer_id) {
    if (confirm('Save "'+manualEmail+'" to this customer\'s contacts?')) {
      var cName = prompt('Contact name (leave blank to use email):') || '';
      sb.post('customer_contacts', {
        customer_id: wo.customer_id,
        name: cName.trim() || manualEmail.split('@')[0],
        email: manualEmail,
        active: true,
        created_by: AppState.userEmail,
        modified_by: AppState.userEmail
      }).then(function(r){ if(r.ok) showToast('Contact saved'); proceed(); });
      return;
    }
  }
  proceed();
}

function _buildReportHTML(wo, hours, parts, type, toAddrs) {
  var s = AppState.settings;
  var logoUrl = s.company_logo_url || '';
  var companyName = escHtml(s.company_name || '');
  var address = escHtml(s.company_address || '');
  var cityStateZip = escHtml(s.company_city_state_zip || '');
  var phone = escHtml(s.company_phone || '');
  var compEmail = escHtml(s.company_email || '');
  var custObj = AppState.customers.find(function(c){return c.id===wo.customer_id;});
  var custName = escHtml((wo.customers&&wo.customers.name)||(custObj&&(custObj.display_name||custObj.name))||'');
  var today = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  var titleText = type==='pricing' ? 'Pricing Summary' : 'Work Update';

  var fD = function(d) {
    if (!d) return '';
    var str = String(d).split('T')[0]; var p = str.split('-');
    if (p.length===3) return (parseInt(p[1])).toString().padStart(2,'0')+'/'+(parseInt(p[2])).toString().padStart(2,'0')+'/'+p[0];
    return d;
  };

  var css = [
    'body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:28px 32px;color:#222;font-size:13px;line-height:1.5}',
    '.hdr{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:16px;border-bottom:2px solid #333;margin-bottom:20px}',
    '.co-info{text-align:right;font-size:12px;line-height:1.7}',
    '.co-name{font-size:15px;font-weight:700;margin-bottom:2px}',
    '.rpt-title{font-size:22px;font-weight:700;letter-spacing:0.4px;margin-bottom:14px}',
    '.meta{margin-bottom:18px;font-size:13px}',
    '.meta-row{margin-bottom:3px}',
    '.meta-label{font-size:10px;font-weight:700;text-transform:uppercase;color:#777;display:inline-block;width:90px}',
    '.sec{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:22px 0 8px;padding-bottom:5px;border-bottom:2px solid #333;color:#333}',
    'table{width:100%;border-collapse:collapse;margin-bottom:4px;font-size:12px}',
    'th{background:#f4f4f4;padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;color:#555;font-weight:700}',
    'td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}',
    '.tr{text-align:right}',
    '.sub td{font-weight:600;border-top:2px solid #ccc;background:#fafafa}',
    '.tot td{font-weight:700;font-size:15px;border-top:3px solid #333;background:#efefef}',
    '.note{padding:6px 0;border-bottom:1px solid #eee;font-size:12px}',
    '.footer{margin-top:32px;padding-top:10px;border-top:1px solid #ddd;font-size:11px;color:#999;text-align:center}',
    '.no-print{display:block}',
    '@media print{@page{margin:0.6in}body{padding:0}.no-print{display:none!important}}'
  ].join('');

  var out = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+companyName+' — '+titleText+'</title><style>'+css+'</style></head><body>';

  // Header
  out += '<div class="hdr">';
  if (logoUrl) {
    out += '<img src="'+logoUrl+'" style="max-height:60px;max-width:180px;object-fit:contain">';
  } else {
    out += '<div style="font-size:18px;font-weight:700">'+companyName+'</div>';
  }
  out += '<div class="co-info">';
  if (logoUrl && companyName) out += '<div class="co-name">'+companyName+'</div>';
  if (address) out += '<div>'+address+'</div>';
  if (cityStateZip) out += '<div>'+cityStateZip+'</div>';
  if (phone) out += '<div>'+phone+'</div>';
  if (compEmail) out += '<div>'+compEmail+'</div>';
  out += '</div></div>';

  // Title + meta
  out += '<div class="rpt-title">'+titleText+'</div>';
  out += '<div class="meta">';
  out += '<div class="meta-row"><span class="meta-label">Work Order</span> '+escHtml(wo.wo_number)+(wo.title?' — '+escHtml(wo.title):'')+'</div>';
  out += '<div class="meta-row"><span class="meta-label">Customer</span> '+custName+'</div>';
  if (wo.po_number) out += '<div class="meta-row"><span class="meta-label">PO Number</span> '+escHtml(wo.po_number)+'</div>';
  out += '<div class="meta-row"><span class="meta-label">Report Date</span> '+today+'</div>';
  if (toAddrs && toAddrs.length) {
    out += '<div class="meta-row"><span class="meta-label">To</span> '+toAddrs.map(function(a){return escHtml(a);}).join(', ')+'</div>';
  }
  out += '</div>';

  if (type === 'pricing') {
    // Labor
    out += '<div class="sec">Labor</div>';
    out += '<table><thead><tr><th>Date</th><th>Technician</th><th>Type</th><th class="tr">Hours</th><th class="tr">Rate</th><th class="tr">Total</th></tr></thead><tbody>';
    var laborTotal = 0;
    hours.forEach(function(e) {
      var ht = e.hours_types;
      var rate = parseFloat(e.internal_rate) || parseFloat(AppState.settings[ht&&ht.internal_rate_key]||0);
      var hrs = parseFloat(e.hours||0);
      var lt = parseFloat(e.line_total) || (hrs*rate);
      laborTotal += lt;
      out += '<tr><td>'+fD(e.entry_date)+'</td><td>'+escHtml((e.technicians&&e.technicians.name)||'')+'</td>'
        +'<td>'+escHtml((ht&&ht.name)||'')+'</td>'
        +'<td class="tr">'+hrs.toFixed(2)+'</td>'
        +'<td class="tr">$'+rate.toFixed(2)+'</td>'
        +'<td class="tr">$'+lt.toFixed(2)+'</td></tr>';
    });
    if (!hours.length) out += '<tr><td colspan="6" style="color:#999;text-align:center;padding:12px">No labor entries</td></tr>';
    out += '<tr class="sub"><td colspan="5">Labor Subtotal</td><td class="tr">$'+laborTotal.toFixed(2)+'</td></tr>';
    out += '</tbody></table>';

    // Materials
    out += '<div class="sec">Materials &amp; Services</div>';
    out += '<table><thead><tr><th>Date</th><th>Description</th><th>Vendor</th><th class="tr">Qty</th><th class="tr">Each</th><th class="tr">Total</th></tr></thead><tbody>';
    var matTotal = 0;
    parts.forEach(function(e) {
      var se = parseFloat(e.sell_each||0);
      var st = parseFloat(e.sell_total||0);
      matTotal += st;
      out += '<tr><td>'+fD(e.transaction_date)+'</td><td>'+escHtml(e.description||'')+'</td>'
        +'<td>'+escHtml((e.vendors&&e.vendors.name)||'—')+'</td>'
        +'<td class="tr">'+parseFloat(e.qty||1).toFixed(0)+'</td>'
        +'<td class="tr">'+(se>0?'$'+se.toFixed(2):'—')+'</td>'
        +'<td class="tr">'+(st>0?'$'+st.toFixed(2):'—')+'</td></tr>';
    });
    if (!parts.length) out += '<tr><td colspan="6" style="color:#999;text-align:center;padding:12px">No material entries</td></tr>';
    out += '<tr class="sub"><td colspan="5">Materials Subtotal</td><td class="tr">$'+matTotal.toFixed(2)+'</td></tr>';
    out += '</tbody></table>';

    // Grand total
    var grand = laborTotal + matTotal;
    out += '<table><tbody><tr class="tot"><td colspan="5">Total</td><td class="tr">$'+grand.toFixed(2)+'</td></tr></tbody></table>';

  } else {
    // Work Update — labor, no pricing
    out += '<div class="sec">Work Performed</div>';
    out += '<table><thead><tr><th>Date</th><th>Technician</th><th>Type</th><th class="tr">Hours</th></tr></thead><tbody>';
    hours.forEach(function(e) {
      var ht = e.hours_types;
      out += '<tr><td>'+fD(e.entry_date)+'</td><td>'+escHtml((e.technicians&&e.technicians.name)||'')+'</td>'
        +'<td>'+escHtml((ht&&ht.name)||'')+'</td>'
        +'<td class="tr">'+parseFloat(e.hours||0).toFixed(2)+'</td></tr>';
    });
    if (!hours.length) out += '<tr><td colspan="4" style="color:#999;text-align:center;padding:12px">No labor entries</td></tr>';
    out += '</tbody></table>';

    // Service notes
    var notes = parts.filter(function(e){return e.transaction_type==='service'&&e.description;});
    if (notes.length) {
      out += '<div class="sec">Service Notes</div>';
      notes.forEach(function(e){ out += '<div class="note">'+escHtml(e.description)+'</div>'; });
    }

    // Materials used (no pricing)
    var matItems = parts.filter(function(e){return e.transaction_type!=='service';});
    if (matItems.length) {
      out += '<div class="sec">Materials Used</div>';
      out += '<table><thead><tr><th>Description</th><th>Vendor</th><th class="tr">Qty</th></tr></thead><tbody>';
      matItems.forEach(function(e) {
        out += '<tr><td>'+escHtml(e.description||'')+'</td><td>'+escHtml((e.vendors&&e.vendors.name)||'—')+'</td><td class="tr">'+parseFloat(e.qty||1).toFixed(0)+'</td></tr>';
      });
      out += '</tbody></table>';
    }
  }

  out += '<div class="footer">'+companyName+' &nbsp;·&nbsp; Generated '+today+'</div>';
  out += '</body></html>';
  return out;
}

function _openReportWindow(html, wo, toAddrs) {
  document.getElementById('report-sheet').style.display = 'none';
  var win = window.open('', '_blank');
  if (!win) { showToast('Allow popups to open reports'); return; }

  var subject = encodeURIComponent('Work Order ' + (wo.wo_number||'') + (wo.title ? ' — ' + wo.title : ''));
  var custObj = AppState.customers.find(function(c){return c.id===wo.customer_id;});
  var custName = (wo.customers&&wo.customers.name)||(custObj&&(custObj.display_name||custObj.name))||'';
  var bodyText = 'Please find the attached report for Work Order '+(wo.wo_number||'')+(custName?' ('+custName+')':'')+'.\r\n\r\nThank you,\r\n'+(AppState.settings.company_name||'');
  var mailtoHref = 'mailto:' + (toAddrs||[]).join(',') + '?subject=' + subject + '&body=' + encodeURIComponent(bodyText);

  // Inject an action bar (hidden from print) before </body>
  var bar = '<div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#1e2a1e;color:#fff;display:flex;align-items:center;gap:10px;padding:10px 16px;z-index:999;font-family:Arial,sans-serif;font-size:13px">'
    + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
    + (toAddrs&&toAddrs.length ? 'To: '+toAddrs.join(', ') : 'No recipients selected')
    + '</span>'
    + (toAddrs&&toAddrs.length ? '<a href="'+mailtoHref+'" style="background:#fff;color:#1e2a1e;padding:6px 14px;border-radius:4px;font-weight:700;text-decoration:none;white-space:nowrap">Open in Email</a>' : '')
    + '<button onclick="window.print()" style="background:transparent;border:1px solid #fff;color:#fff;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap">Print / Save PDF</button>'
    + '</div>'
    + '<div class="no-print" style="height:52px"></div>';

  var injected = html.replace('</body>', bar + '</body>');
  win.document.write(injected);
  win.document.close();
}
