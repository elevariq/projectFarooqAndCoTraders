/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 15
   THE EXPORT STEP
   Correcting an invoice by hand is not a feature to go hunting for — it is
   offered at the moment it matters. Pressing Print, PDF, Word or WhatsApp on
   an invoice asks, once, whether to check it over first. The answer can be
   made permanent from the same box or from Settings.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, D = global.document;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function say(m) { return global.say ? global.say(m) : null; }

var ACTIONS = { print: 'Print', pdf: 'Download PDF', word: 'Download Word', wa: 'Send on WhatsApp' };

/* ask · direct · edit  — what happens when an export is pressed */
function flow() { return ERP.Settings.get().invoiceExportFlow || 'ask'; }
function setFlow(v) { return ERP.Settings.save({ invoiceExportFlow: v }); }

var CSS = `
#fcExport{position:fixed;inset:0;z-index:140;display:none;background:rgba(12,10,20,.5);
  backdrop-filter:blur(2px);align-items:center;justify-content:center;padding:16px}
#fcExport.on{display:flex}
.fcx-box{width:100%;max-width:460px;background:var(--surface);border:1px solid var(--line);
  border-radius:16px;box-shadow:0 24px 70px rgba(12,10,20,.35);overflow:hidden;
  animation:fcxIn .14s cubic-bezier(.32,.72,0,1)}
@keyframes fcxIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.fcx-h{padding:16px 18px 6px}
.fcx-h b{font-size:16.5px;display:block}
.fcx-h p{margin:5px 0 0;color:var(--muted);font-size:13.5px}
.fcx-opts{padding:10px 14px 6px;display:grid;gap:8px}
.fcx-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 13px;
  border:1.5px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer}
.fcx-opt:hover{border-color:var(--violet);background:var(--violet-50)}
.fcx-opt .fico{width:36px;height:36px;border-radius:10px;background:var(--violet-50);color:var(--violet);
  display:grid;place-items:center;flex:none}
.fcx-opt.pri .fico{background:var(--violet);color:#fff}
.fcx-opt b{display:block;font-size:14.5px}
.fcx-opt span{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}
.fcx-foot{display:flex;align-items:center;gap:10px;padding:10px 16px 14px;flex-wrap:wrap}
.fcx-foot label{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);flex:1}
.fcx-foot .btn{min-height:38px}
.fcx-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--violet);
  background:var(--violet-50);border-radius:99px;padding:2px 9px;margin-left:8px}
@media (max-width:760px){
  #fcExport{align-items:flex-end;padding:0}
  .fcx-box{max-width:none;border-radius:18px 18px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}
  .fcx-opt{padding:14px 13px}
}`;
(function () { var s = D.createElement('style'); s.id = 'fc-export-css'; s.textContent = CSS; D.head.appendChild(s); })();

var pending = null;

function host() {
  var h = D.getElementById('fcExport');
  if (!h) { h = D.createElement('div'); h.id = 'fcExport'; D.body.appendChild(h); }
  return h;
}

function ask(action, model) {
  pending = { action: action, id: model.entityId };
  var edited = !!model.edited;
  var h = host();
  h.innerHTML =
    '<div class="fcx-box" role="dialog" aria-label="Before exporting">' +
      '<div class="fcx-h"><b>' + esc(ACTIONS[action] || 'Export') + ' ' + esc(model.number || '') + '</b>' +
        '<p>' + (edited
          ? 'This invoice already carries your edits. Check them once more, or send it as it stands.'
          : 'Check the invoice over and correct anything by hand first, or send it exactly as recorded.') +
        '</p></div>' +
      '<div class="fcx-opts">' +
        '<button class="fcx-opt pri" data-fcx="edit"><span class="fico">' + I('edit') + '</span>' +
          '<span><b>Edit before exporting</b>' +
          '<span>Wording, quantities, rates, extra charges and a note</span></span></button>' +
        '<button class="fcx-opt" data-fcx="now"><span class="fico">' + I('check') + '</span>' +
          '<span><b>' + esc(ACTIONS[action] || 'Export') + ' now</b>' +
          '<span>' + (edited ? 'Uses the edited invoice' : 'Exactly as recorded') + '</span></span></button>' +
      '</div>' +
      '<div class="fcx-foot">' +
        '<label><input type="checkbox" id="fcxRemember"> Do not ask again</label>' +
        '<button class="btn" data-fcx="cancel">Cancel</button>' +
      '</div>' +
    '</div>';
  h.classList.add('on');
}
function close() { var h = D.getElementById('fcExport'); if (h) { h.classList.remove('on'); h.innerHTML = ''; } }

function proceed(action) {
  if (action === 'word') ERP.Viewer.word();
  else if (action === 'wa') ERP.Viewer.whatsapp();
  else ERP.Viewer.print(action === 'pdf');
}

/* ── the interceptor ───────────────────────────────────────────────────────
   Capture on window runs before the document-level handlers that carry out
   the export, so the question can be asked first and the original action
   carried out afterwards untouched. ── */
global.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var btn = e.target.closest('[data-fcv]');
  if (!btn) return;
  var action = btn.dataset.fcv;
  if (!ACTIONS[action]) return;
  if (e.target.closest('#fceditor')) return;              /* already inside the editor */
  var m = ERP.Viewer.current;
  if (!m || m.kind !== 'INVOICE') return;                 /* only invoices are editable */

  var mode = flow();
  if (mode === 'direct') return;
  e.preventDefault(); e.stopPropagation();
  if (mode === 'edit') { ERP.Viewer.close(); ERP.Editor.open(m.entityId); return; }
  ask(action, m);
}, true);

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  if (e.target.id === 'fcExport') { close(); return; }
  var b = e.target.closest('[data-fcx]');
  if (!b) return;
  e.preventDefault();
  var a = b.dataset.fcx;
  var remember = D.getElementById('fcxRemember');
  var keep = remember && remember.checked;
  var job = pending; pending = null;
  close();
  if (a === 'cancel') return;
  if (a === 'edit') {
    if (keep) setFlow('edit');
    var id = job && job.id;
    ERP.Viewer.close();
    if (id) ERP.Editor.open(id);
    return;
  }
  if (a === 'now') {
    if (keep) setFlow('direct');
    if (job) proceed(job.action);
  }
}, true);

/* ── make the option visible on the sheet itself ── */
var origOpen = ERP.Viewer.open;
ERP.Viewer.open = function (model, opts) {
  origOpen.call(ERP.Viewer, model, opts);
  if (!model || model.kind !== 'INVOICE') return;
  var bar = D.querySelector('#fcviewer .fcv-bar');
  if (!bar) return;
  var btn = bar.querySelector('[data-fcv="edittext"]');
  if (!btn) return;
  /* put it first, ahead of the export buttons, and make it the lead action */
  btn.className = 'fcv-btn pri';
  btn.innerHTML = I('edit') + (model.edited ? 'Edit again' : 'Edit before exporting');
  var first = bar.querySelector('[data-fcv="print"]');
  if (first && btn.nextSibling !== first) bar.insertBefore(btn, first);
  if (model.edited && !bar.querySelector('.fcx-badge')) {
    var t = bar.querySelector('.fcv-t');
    if (t) t.insertAdjacentHTML('beforeend', '<span class="fcx-badge">' + I('check') + 'edited by hand</span>');
  }
};

/* ── and in the invoice list, so it can be reached without opening the sheet ── */
var origInvoices = global.PAGES.invoices;
global.PAGES.invoices = function () {
  return origInvoices().replace(
    /<button class="btn sm" data-fcinv="word" data-id="([^"]+)">Word<\/button>/g,
    '<button class="btn sm" data-fcinv="editdoc" data-id="$1">Edit &amp; export</button>' +
    '<button class="btn sm" data-fcinv="word" data-id="$1">Word</button>');
};
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var b = e.target.closest('[data-fcinv="editdoc"]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  ERP.Editor.open(b.dataset.id);
}, true);

/* ── after a sale is saved, the same choice is offered straight away ── */
var origBuilderSave = null;
function hookBuilder() {
  if (origBuilderSave || !ERP.BuilderUI || !ERP.BuilderUI.MODES) return;
  var sale = ERP.BuilderUI.MODES.sale;
  origBuilderSave = sale.after;
  sale.after = function (rec) {
    var m = origBuilderSave ? origBuilderSave(rec) : ERP.DocModel.invoice(rec.id);
    if (flow() === 'edit') { setTimeout(function () { ERP.Editor.open(rec.id); }, 60); return null; }
    return m;
  };
}
hookBuilder();

/* ── the preference lives in Settings like everything else ── */
var origSettings = global.PAGES.settings;
global.PAGES.settings = function () {
  var f = flow();
  var opt = function (v, label, hint) {
    return '<label class="fcx-opt" style="margin-bottom:8px">' +
      '<input type="radio" name="fcxflow" value="' + v + '" data-fcxflow="' + v + '"' +
        (f === v ? ' checked' : '') + '>' +
      '<span><b>' + label + '</b><span>' + hint + '</span></span></label>';
  };
  return origSettings() +
    '<div class="card"><div class="card-h"><h3>Before printing an invoice</h3>' +
      '<span class="pill neu">Applies to Print, PDF, Word and WhatsApp</span></div>' +
    '<div class="card-b">' +
      opt('ask', 'Ask each time', 'Offer the editor, with the option to send as recorded') +
      opt('edit', 'Always open the editor first', 'Every invoice is checked by hand before it leaves') +
      opt('direct', 'Export straight away', 'The editor stays available from the sheet and the list') +
    '</div></div>';
};
D.addEventListener('change', function (e) {
  var el = e.target;
  if (!el.dataset || el.dataset.fcxflow === undefined || !el.checked) return;
  setFlow(el.dataset.fcxflow).then(function () {
    say('Saved. ' + (el.dataset.fcxflow === 'ask' ? 'You will be asked before each export.'
      : el.dataset.fcxflow === 'edit' ? 'The editor opens before every export.'
      : 'Exports run straight away.'));
  });
});

var origDefaults = ERP.Settings.defaults;
ERP.Settings.defaults = function () {
  return Object.assign(origDefaults.call(ERP.Settings), { invoiceExportFlow: 'ask' });
};
if (ERP.S.business && !ERP.S.business.invoiceExportFlow) ERP.S.business.invoiceExportFlow = 'ask';

ERP.ExportFlow = { ask: ask, close: close, flow: flow, setFlow: setFlow, proceed: proceed };
})(typeof window !== 'undefined' ? window : globalThis);
