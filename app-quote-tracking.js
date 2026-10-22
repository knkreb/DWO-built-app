// app-quote-tracking.js — Quote tracking: sent / awaiting / accepted / rejected, expiration and stale warnings (v5.15, slice 5a)
// Spec: docs/specs/quote-tracking-and-quoted-carryover.md. DB: supabase/migrations/v5.15_quote_tracking.sql
// Quoted work orders only. Admin sets and changes everything; everyone signed in sees the badge.
// "Expired" and "stale" are never stored: the database view quote_tracking_status works them out from the dates,
// so they are right without a nightly job. Alerts (quote_stale / quote_expired) come from the database on save and
// when the admin opens the Daily Dashboard (quote_check_all). No backfill: quotes are tracked one at a time, by hand.
// Uses wonIsAdmin and wonMoney from app-wo-nte.js (loaded before this file).

var QT = { woId: null, row: null, st: null, token: 0, busy: false, form: null };
var QT_COL = '#2563eb';
var QT_IN = 'width:100%;box-sizing:border-box;font-size:13px;padding:6px 8px';

function qtDays(key, dflt) {
  var v = parseInt((AppState.settings || {})[key], 10);
  return isNaN(v) ? dflt : v;
}
function qtAddDays(iso, n) {
  var p = String(iso).split('-'), d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function qtBtn(label, col, fn) {
  return '<button style="font-size:11px;padding:3px 8px;border:1px solid ' + col + ';border-radius:3px;background:none;color:' + col + ';cursor:pointer;white-space:nowrap" onclick="' + fn + '">' + label + '</button>';
}
function qtErr(r, fallback) { return (r && r.data && r.data.message) ? r.data.message : fallback; }

// Colour and wording for the effective state (from the view).
function qtLook(st) {
  var s = st ? st.effective_state : 'not_sent';
  if (s === 'expired') return { col: '#c0392b', name: 'Expired' };
  if (s === 'stale') return { col: '#e67e22', name: 'Going stale' };
  if (s === 'awaiting') return { col: QT_COL, name: 'Awaiting acceptance' };
  if (s === 'accepted') return { col: '#16803c', name: 'Accepted' };
  if (s === 'rejected') return { col: '#6b7280', name: 'Rejected' };
  return { col: '#6b7280', name: 'Not sent' };
}
function qtDaysText(st) {
  if (!st || st.days_left === null || st.days_left === undefined) return '';
  var d = parseInt(st.days_left, 10);
  if (d < 0) return 'expired ' + (-d) + (d === -1 ? ' day' : ' days') + ' ago';
  if (d === 0) return 'expires today';
  return d + (d === 1 ? ' day' : ' days') + ' left';
}

// ── Work order screen ────────────────────────────────────────────────────
// Called from renderWODetail: returns the shell for quoted work orders; content loads right after the screen is drawn.
function qtShell(wo) {
  if (!wo || wo.form_mode !== 'quoted') return '';
  setTimeout(function() { qtRefresh(wo.id); }, 0);
  return '<div id="qt-block"></div>';
}

function qtRefresh(woId) {
  var tok = ++QT.token;
  Promise.all([
    sb.get('quote_tracking', '?work_order_id=eq.' + woId),               // includes a stopped (inactive) row, so Track can reuse it
    sb.get('quote_tracking_status', '?work_order_id=eq.' + woId)
  ]).then(function(res) {
    if (tok !== QT.token) return;
    var box = document.getElementById('qt-block'); if (!box) return;
    var wo = AppState.currentWO; if (!wo || wo.id !== woId) return;
    if (!res[0].ok || !res[1].ok) { box.innerHTML = ''; return; } // migration missing or offline: stay quiet
    QT.woId = woId;
    QT.row = (res[0].data && res[0].data[0]) || null;
    QT.st = (res[1].data && res[1].data[0]) || null;
    qtDraw(box, wo, QT.row, QT.st);
  });
}

function qtDraw(box, wo, row, st) {
  var admin = wonIsAdmin();
  if (!st) { // not tracked (or tracking stopped)
    if (!admin) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius);padding:6px 10px;margin-bottom:10px">'
      + '<span style="flex:1">Quote not tracked</span>' + qtBtn('Track this quote', QT_COL, 'qtTrack()') + '</div>';
    return;
  }
  var lk = qtLook(st), s = st.quote_state, b = [];
  if (admin) {
    if (s === 'not_sent') b.push(qtBtn('Mark sent', lk.col, 'qtOpenForm(\'sent\')'));
    if (s === 'awaiting') { b.push(qtBtn('Accepted', '#16803c', 'qtOpenForm(\'accepted\')')); b.push(qtBtn('Rejected', '#6b7280', 'qtOpenForm(\'rejected\')')); b.push(qtBtn('Edit dates', 'var(--text-muted)', 'qtOpenForm(\'edit\')')); }
    if (s === 'accepted' || s === 'rejected') { b.push(qtBtn('Re-send', QT_COL, 'qtOpenForm(\'sent\')')); b.push(qtBtn('Change', 'var(--text-muted)', 'qtOpenForm(\'edit\')')); }
    if (s === 'not_sent') b.push(qtBtn('Stop tracking', 'var(--text-muted)', 'qtStop()'));
  }
  var facts = [];
  if (st.sent_on) facts.push('Sent ' + fmtDate(st.sent_on));
  if (s === 'awaiting' && st.expires_on) facts.push('Expires ' + fmtDate(st.expires_on) + ' (' + qtDaysText(st) + ')');
  if ((s === 'accepted' || s === 'rejected') && st.decided_on) facts.push(lk.name + ' ' + fmtDate(st.decided_on));
  var warn = '';
  if (admin && st.effective_state === 'expired') warn = '<div style="font-size:12px;font-weight:700;color:' + lk.col + ';margin-top:5px">This quote has expired. Mark it accepted or rejected, or re-send it with new dates.</div>';
  else if (admin && st.effective_state === 'stale') warn = '<div style="font-size:12px;font-weight:700;color:' + lk.col + ';margin-top:5px">Follow up with the customer before this quote expires.</div>';
  box.innerHTML = '<div style="border:1px solid ' + lk.col + ';background:' + lk.col + '14;border-radius:var(--radius);padding:8px 12px;margin-bottom:10px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:11px;font-weight:700;color:#fff;background:' + lk.col + ';border-radius:3px;padding:2px 7px">Quote · ' + lk.name + '</span>'
    + '<span style="font-size:12px;color:var(--text-secondary);flex:1">' + escHtml(facts.join(' · ')) + '</span>' + b.join(' ') + '</div>'
    + (st.note ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:5px">' + escHtml(st.note) + '</div>' : '')
    + warn + '</div>';
}

// ── Track / stop tracking (admin) ────────────────────────────────────────
function qtTrack() {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin() || QT.busy) return;
  QT.busy = true; // ignore a second tap while saving
  var me = AppState.userEmail;
  var req = QT.row
    ? sb.patch('quote_tracking', QT.row.id, { active: true, quote_state: 'not_sent', sent_on: null, expires_on: null, decided_on: null, remind_days: null, note: null, label: wo.wo_number, modified_by: me })
    : sb.post('quote_tracking', { work_order_id: wo.id, label: wo.wo_number, quote_state: 'not_sent', created_by: me, modified_by: me });
  req.then(function(r) {
    QT.busy = false;
    if (!r.ok) { showToast(qtErr(r, 'Error saving. Nothing was changed.')); return; }
    showToast('Quote is now tracked'); qtRefresh(wo.id);
  });
}
function qtStop() {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin() || QT.busy || !QT.row) return;
  if (!confirm('Stop tracking this quote? The history stays in the audit log.')) return;
  QT.busy = true;
  sb.patch('quote_tracking', QT.row.id, { active: false, modified_by: AppState.userEmail }).then(function(r) {
    QT.busy = false;
    if (!r.ok) { showToast(qtErr(r, 'Error saving. Nothing was changed.')); return; }
    showToast('Quote tracking stopped'); qtRefresh(wo.id);
  });
}

// ── Form: sent / accepted / rejected / edit ──────────────────────────────
function qtEnsureSheet() {
  var el = document.getElementById('qt-form-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.id = 'qt-form-sheet';
  el.style.alignItems = 'flex-start';
  el.style.zIndex = '10000';
  // No click-outside close: a stray click should not dismiss a half-filled form.
  el.innerHTML = '<div class="bottom-sheet" style="max-width:560px;margin:0 auto;border-radius:0 0 14px 14px;max-height:94vh;overflow-y:auto"><div class="sheet-header"><h3 id="qtf-title">Quote</h3><button class="sheet-close" onclick="qtFormClose()">✕</button></div><div id="qtf-body" style="padding:14px 16px"></div></div>';
  document.body.appendChild(el);
  return el;
}
function qtFormClose() { var el = document.getElementById('qt-form-sheet'); if (el) el.classList.remove('open'); QT.form = null; }
function qtFormErr(msg) { var el = document.getElementById('qtf-err'); if (el) el.textContent = msg || ''; }
function qtField(label, html) { return '<div style="margin-top:10px"><div style="font-size:12px;font-weight:600;margin-bottom:3px">' + label + '</div>' + html + '</div>'; }
function qtVal(id) { return ((document.getElementById(id) || {}).value || '').trim(); }

// mode: 'sent' (also re-send), 'accepted', 'rejected', 'edit'
function qtOpenForm(mode) {
  var wo = AppState.currentWO; if (!wo || !wonIsAdmin() || !QT.row) return;
  var st = QT.st || {}, today = todayStr(), h = '', title;
  QT.form = { mode: mode };
  qtEnsureSheet().classList.add('open');
  var dflt = qtDays('quote_expiry_days', 30), remindDflt = qtDays('quote_remind_days', 7);
  if (mode === 'sent') {
    title = (st.quote_state === 'not_sent' ? 'Mark sent' : 'Re-send quote') + ' · ' + wo.wo_number;
    h += '<div style="font-size:12px;color:var(--text-muted)">The quote then waits for the customer. The expiration is the sent date plus ' + dflt + ' days; change either date as needed.</div>'
      + qtField('Sent on', '<input type="date" id="qtf-sent" value="' + today + '" onchange="qtSentChange()" style="' + QT_IN + '">')
      + qtField('Expires on', '<input type="date" id="qtf-exp" value="' + qtAddDays(today, dflt) + '" style="' + QT_IN + '">')
      + qtField('Warn me this many days before it expires <span style="font-weight:400;color:var(--text-muted)">(blank = ' + remindDflt + ', the Settings default)</span>',
          '<input type="number" min="0" max="365" step="1" id="qtf-remind" value="' + (st.remind_days !== null && st.remind_days !== undefined ? st.remind_days : '') + '" style="' + QT_IN + '">');
  } else if (mode === 'accepted' || mode === 'rejected') {
    title = (mode === 'accepted' ? 'Quote accepted' : 'Quote rejected') + ' · ' + wo.wo_number;
    h += qtField('Decided on', '<input type="date" id="qtf-dec" value="' + today + '" style="' + QT_IN + '">')
      + qtField('Note (optional)', '<input type="text" id="qtf-note" value="' + escHtml(st.note || '') + '" placeholder="e.g. approved by phone, PO to follow" style="' + QT_IN + '">');
  } else {
    title = 'Edit quote · ' + wo.wo_number;
    h += qtField('Sent on', '<input type="date" id="qtf-sent" value="' + escHtml(st.sent_on || '') + '" style="' + QT_IN + '">')
      + qtField('Expires on', '<input type="date" id="qtf-exp" value="' + escHtml(st.expires_on || '') + '" style="' + QT_IN + '">')
      + ((st.quote_state === 'accepted' || st.quote_state === 'rejected') ? qtField('Decided on', '<input type="date" id="qtf-dec" value="' + escHtml(st.decided_on || '') + '" style="' + QT_IN + '">') : '')
      + qtField('Warn me this many days before it expires <span style="font-weight:400;color:var(--text-muted)">(blank = ' + remindDflt + ', the Settings default)</span>',
          '<input type="number" min="0" max="365" step="1" id="qtf-remind" value="' + (st.remind_days !== null && st.remind_days !== undefined ? st.remind_days : '') + '" style="' + QT_IN + '">')
      + qtField('Note (optional)', '<input type="text" id="qtf-note" value="' + escHtml(st.note || '') + '" style="' + QT_IN + '">');
  }
  h += '<div id="qtf-err" style="color:var(--danger);font-size:12px;font-weight:600;min-height:16px;margin-top:12px"></div>'
    + '<button class="save-btn" id="qtf-save" style="margin-top:4px" onclick="qtFormSave()">Save</button>';
  document.getElementById('qtf-title').textContent = title;
  document.getElementById('qtf-body').innerHTML = h;
}
// Changing the sent date moves the expiration with it (sent + default days) in the Mark sent form.
function qtSentChange() {
  var s = document.getElementById('qtf-sent'), e = document.getElementById('qtf-exp');
  if (s && e && s.value && QT.form && QT.form.mode === 'sent') e.value = qtAddDays(s.value, qtDays('quote_expiry_days', 30));
}

function qtFormSave() {
  var f = QT.form, wo = AppState.currentWO; if (!f || !wo || !QT.row || QT.busy || !wonIsAdmin()) return;
  qtFormErr('');
  var me = AppState.userEmail, body = { modified_by: me, label: wo.wo_number };
  var remindEl = document.getElementById('qtf-remind');
  if (remindEl) body.remind_days = remindEl.value === '' ? null : Math.max(0, parseInt(remindEl.value, 10) || 0);
  if (f.mode === 'sent') {
    var sent = qtVal('qtf-sent'), exp = qtVal('qtf-exp');
    if (!sent || !exp) { qtFormErr('Enter the sent and expiration dates'); return; }
    if (exp < sent) { qtFormErr('The expiration cannot be before the sent date'); return; }
    body.quote_state = 'awaiting'; body.sent_on = sent; body.expires_on = exp; body.decided_on = null;
  } else if (f.mode === 'accepted' || f.mode === 'rejected') {
    var dec = qtVal('qtf-dec');
    if (!dec) { qtFormErr('Enter the date it was decided'); return; }
    body.quote_state = f.mode; body.decided_on = dec; body.note = qtVal('qtf-note') || null;
  } else {
    var s2 = qtVal('qtf-sent') || null, e2 = qtVal('qtf-exp') || null;
    if (s2 && e2 && e2 < s2) { qtFormErr('The expiration cannot be before the sent date'); return; }
    body.sent_on = s2; body.expires_on = e2; body.note = qtVal('qtf-note') || null;
    if (document.getElementById('qtf-dec')) body.decided_on = qtVal('qtf-dec') || null;
    if (QT.st && QT.st.quote_state === 'awaiting' && !e2) { qtFormErr('An awaiting quote needs an expiration date'); return; }
  }
  QT.busy = true; var btn = document.getElementById('qtf-save'); if (btn) btn.disabled = true; // ignore a second tap while saving
  sb.patch('quote_tracking', QT.row.id, body).then(function(r) {
    QT.busy = false; if (btn) btn.disabled = false;
    if (!r.ok) { qtFormErr(qtErr(r, 'Error saving. Nothing was changed.')); return; }
    qtFormClose();
    showToast(f.mode === 'sent' ? 'Quote marked sent' : f.mode === 'accepted' ? 'Quote accepted' : f.mode === 'rejected' ? 'Quote rejected' : 'Quote updated');
    qtRefresh(wo.id);
  });
}

// ── Daily Dashboard card (admin) ─────────────────────────────────────────
// Awaiting quotes by days left (expired and stale first). Opening the card also asks the database to raise any
// stale / expired alerts that are due (dates passing is not a data change, so nothing else would).
function qtDashRender(shellId) {
  var shell = document.getElementById(shellId); if (!shell) return;
  var badge = document.getElementById('mb-badge-quotes');
  sb.req('POST', '/rest/v1/rpc/quote_check_all', {}).then(function() { // result not needed; failure just means no new alerts
    return sb.get('quote_tracking_status', '?quote_state=eq.awaiting&order=days_left.asc');
  }).then(function(r) {
    if (!r.ok) { shell.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Quote status is not available.</div>'; if (badge) badge.textContent = ''; return; }
    var rows = r.data || [];
    var exp = rows.filter(function(x) { return x.effective_state === 'expired'; }).length;
    var stale = rows.filter(function(x) { return x.effective_state === 'stale'; }).length;
    if (badge) badge.textContent = rows.length ? (exp ? exp + ' expired' : '') + (exp && stale ? ' · ' : '') + (stale ? stale + ' stale' : '') + (!exp && !stale ? rows.length + ' awaiting' : '') : 'none';
    if (!rows.length) { shell.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:10px;border:1px dashed var(--border);border-radius:var(--radius);text-align:center">No tracked quotes are awaiting acceptance.</div>'; return; }
    var h = '<table class="dt-table" style="width:100%"><thead><tr><th>WO</th><th>Customer</th><th>Title</th><th style="text-align:right">Quoted</th><th>Status</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x) {
      var c = (AppState.customers || []).find(function(y) { return y.id === x.customer_id; });
      var lk = qtLook(x);
      h += '<tr><td style="font-weight:600">' + escHtml(x.wo_number) + '</td><td>' + escHtml(c ? getCustName(c) : '') + '</td><td>' + escHtml(x.title || '') + '</td>'
        + '<td style="text-align:right">' + (x.quoted_amount ? wonMoney(x.quoted_amount) : '') + '</td>'
        + '<td style="font-weight:700;color:' + lk.col + '">' + lk.name + ' · ' + escHtml(qtDaysText(x)) + '</td>'
        + '<td><button onclick="openWODetail(\'' + x.work_order_id + '\')" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Open</button></td></tr>';
    });
    shell.innerHTML = h + '</tbody></table>';
  });
}
