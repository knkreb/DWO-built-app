// app-wo-flags.js — Work order flag helpers (v4.96, invoice generation slice 3)
// Spec: docs/specs/invoice-generation-workflow.md section 3b.
// "Needs Review" is now the catch-all "Hold - Other (explain)": the key (needs_review), its column
// (flag_needs_review) and its note column (flag_needs_review_note) are unchanged so existing data keeps
// working; only the display name (wo_flags.name) changed. Setting it requires a written reason, and the
// reason is shown on the WO banner, the grid row, and the invoice workflow rows.

var WO_HOLD_KEY = 'needs_review';

// Required-reason dialog. onSave(note) runs only with a non-empty reason; Cancel does nothing.
function woHoldAskReason(label, onSave) {
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = '<div style="background:var(--surface);border-radius:var(--radius);padding:18px 20px;width:100%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,0.3)">'
    + '<div style="font-size:15px;font-weight:700;margin-bottom:4px">' + escHtml(label || 'Hold') + '</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">What is holding this work order up? A reason is required.</div>'
    + '<textarea id="wo-hold-reason" rows="3" style="width:100%;font-size:14px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);box-sizing:border-box" placeholder="Reason"></textarea>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'
    + '<button id="wo-hold-cancel" style="font-size:13px;padding:7px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">Cancel</button>'
    + '<button id="wo-hold-save" disabled style="font-size:13px;padding:7px 14px;border:none;border-radius:var(--radius-sm);background:var(--header-bg);color:#fff;font-weight:600;cursor:not-allowed;opacity:0.5">Set hold</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  var ta = ov.querySelector('#wo-hold-reason'), save = ov.querySelector('#wo-hold-save');
  function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
  ta.addEventListener('input', function() {
    var ok = ta.value.trim().length > 0;
    save.disabled = !ok; save.style.opacity = ok ? '1' : '0.5'; save.style.cursor = ok ? 'pointer' : 'not-allowed';
  });
  ov.querySelector('#wo-hold-cancel').onclick = close;
  save.onclick = function() { var note = ta.value.trim(); if (!note) return; close(); onSave(note); };
  setTimeout(function(){ ta.focus(); }, 30);
}

// Visible reason text for a set hold flag, shortened for table rows (full text in the tooltip).
function woHoldReasonShort(wo, max) {
  var n = (wo && wo['flag_' + WO_HOLD_KEY + '_note']) || '';
  max = max || 40;
  return n.length > max ? n.slice(0, max - 1) + '…' : n;
}

// Small chips for every flag set on a work order, with notes visible (used on invoice workflow rows).
function woFlagChipsHtml(wo) {
  var defs = (AppState.woFlags && AppState.woFlags.length) ? AppState.woFlags : [];
  return defs.filter(function(f){ return wo['flag_' + f.system_key]; }).map(function(f) {
    var note = wo['flag_' + f.system_key + '_note'] || '';
    return '<span title="' + escHtml(note) + '" style="display:inline-block;margin:2px 4px 0 0;font-size:10px;background:' + f.color + '22;color:' + f.color + ';border:1px solid ' + f.color + ';border-radius:3px;padding:1px 4px">⚑ '
      + escHtml(f.name) + (note ? ': ' + escHtml(note.length > 60 ? note.slice(0, 59) + '…' : note) : '') + '</span>';
  }).join('');
}
