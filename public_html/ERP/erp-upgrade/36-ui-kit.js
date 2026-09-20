/* ═════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 36
   THE UI KIT — every piece of "browser chrome" wears the app's theme

   Until now several things on screen were drawn by the browser or the
   operating system, not by us: grey scrollbars, the white/blue list a
   dropdown opens, the date calendar, JavaScript's confirm() / prompt()
   boxes, the yellow tooltip on a hovered button, square blue checkboxes, the
   grey "Choose file" button, the autofill wash, and (on a phone) the colour of
   the browser's own address bar. They ignored dark mode and looked like a
   different product. This module replaces each of them, using the colours the
   app already defines, so dark mode and any future re-theme follow for free.

   THE RULE THAT KEEPS THIS SAFE: the real controls stay in the page.
     · A <select> is still the real <select>. Its value, its "change" event,
       .focus(), re-rendering, validation and every test that drives it are
       untouched. Only the popup that opens from it is ours.
     · An <input type="date"> / type="month" is still the real input, so typing
       a date into its segments still works. Only its calendar is ours.
     · Nothing is wrapped, moved or replaced in the DOM, so the app's own CSS
       selectors (label.f select, .fld select, …) keep matching.

   WHAT IT DOES
     1. Scrollbars   thin, rounded, theme-coloured (WebKit pseudo-elements in
                     Chrome / Edge / Safari; scrollbar-color in Firefox).
     2. Dropdowns    a searchable themed list for every <select> — search box
                     when there are more than 8 options (the shop and product
                     pickers hold hundreds), keyboard support, type-ahead,
                     groups; a bottom sheet on a phone.
     3. Dates        a themed calendar / month picker for date & month inputs.
     4. Dialogs      ERP.UI.confirm / prompt / alert return a Promise and draw a
                     themed dialog (a bottom sheet on a phone): focus trap, Esc,
                     Enter, focus returned to where it was, queued if several
                     are asked at once. window.alert is routed to it too.
                     If a host has REPLACED window.confirm / prompt / alert
                     (a test harness, an embedding shell) that replacement is
                     used instead — a browser's own function is the only thing
                     this module supersedes.
     5. Tooltips     a themed tooltip for any [title]; the native one is
                     suppressed only while hovered, and title is put back.
     6. Controls     checkboxes and radios, file button, number spinners,
                     search-clear, selection colour, caret and autofill colour,
                     color-scheme (so leftover native UI follows dark mode).
     7. Phone chrome the browser address-bar colour follows light / dark.

   NOT POSSIBLE, and left native on purpose: the operating system's file
   chooser, the print dialog, and the browser's "Leave site?" prompt — pages
   cannot restyle those.

   Host-agnostic: colours come from --fc-* tokens that are derived (with
   fallbacks) from whatever the host defines, so the same file also serves the
   Warehouse app. Exposed as window.FcUI, and as ERP.UI when ERP exists.
   ═════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var D = global.document; if (!D || !D.documentElement) return;
if (global.FcUI && global.FcUI.version) return;
var ERP = global.ERP;
var UI = { version: 1, sheetMode: undefined, dateHook: undefined };
global.FcUI = UI; if (ERP) ERP.UI = UI;

/* ── small helpers ───────────────────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function mk(tag, cls, html) {
  var n = D.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function isNative(fn) {
  return typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn));
}
function media(q) { try { return !!(global.matchMedia && global.matchMedia(q).matches); } catch (e) { return false; } }
function useSheet() {
  if (UI.sheetMode === true || UI.sheetMode === false) return UI.sheetMode;
  return media('(max-width: 640px)') || media('(pointer: coarse)');
}
function canHover() { return media('(hover: hover) and (pointer: fine)'); }
function normalize(s) {
  if (ERP && ERP.Search && typeof ERP.Search.normalize === 'function') {
    try { return ERP.Search.normalize(s); } catch (e) { /* fall through */ }
  }
  s = String(s == null ? '' : s).toLowerCase();
  try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* old engine */ }
  return s.replace(/\s+/g, ' ').trim();
}
function fire(el, type) {
  el.dispatchEvent(new global.Event(type, { bubbles: true }));
}
function focusEl(el) {
  if (!el || !el.focus) return;
  try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (x) { /* detached */ } }
}

/* ── icons (own copies, so the kit works in any host) ────────────────────── */
function svg(inner, w) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 2.2) +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}
var IC = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  left: svg('<path d="M14.5 6l-6 6 6 6"/>'),
  right: svg('<path d="M9.5 6l6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
  warn: svg('<path d="M12 4.2l9 15.6H3z"/><path d="M12 10v4.2M12 17.4v.1"/>', 2),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.9v.1"/>', 2),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.2M12 17v.1"/>', 2),
  note: svg('<path d="M5 5h14v10l-4 4H5z"/><path d="M15 19v-4h4M8.5 9h7M8.5 12.5h4"/>', 2)
};
function iconUrl(inner, color, w) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + color +
    '" stroke-width="' + (w || 2.3) + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>') + '")';
}
var CHEV = '<path d="M6 9.5l6 6 6-6"/>';
var CAL = '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
var CROSS = '<path d="M6 6l12 12M18 6L6 18"/>';

/* ═════════════════════════════════════════════════════════════════════════
   1 · THE STYLESHEET
   ═════════════════════════════════════════════════════════════════════════ */
var CSS = `
:root{
  color-scheme:light;
  --fc-surface:var(--surface,#fff);
  --fc-surface2:var(--surface-2,#FAFAFB);
  --fc-canvas:var(--canvas,#F4F4F7);
  --fc-ink:var(--ink,#12111A);
  --fc-ink2:var(--ink-2,#3C3B4C);
  --fc-muted:var(--muted,var(--ink-2,#5B5F72));
  --fc-faint:var(--faint,var(--ink-3,#696D80));
  --fc-line:var(--line,#E8E8EE);
  --fc-line2:var(--line-2,var(--line-soft,#F1F1F5));
  --fc-accent:var(--violet,#7C3AED);
  --fc-accent600:var(--violet-600,#6D28D9);
  --fc-accent50:var(--violet-50,#F4EFFF);
  --fc-accent100:var(--violet-100,#E7DCFF);
  --fc-accent-ink:var(--violet-ink,var(--violet-600,#6D28D9));
  --fc-danger:var(--clay,var(--red-ink,#A32E2E));
  --fc-danger50:var(--clay-50,var(--red-soft,#FDECEC));
  --fc-warn:var(--ochre,var(--amber-ink,#8A5A0C));
  --fc-warn50:var(--ochre-50,var(--amber-soft,#FDF3E4));
  --fc-shadow:var(--sh-lg,0 14px 36px rgba(18,17,26,.14),0 2px 8px rgba(18,17,26,.06));
  --fc-font:var(--font,var(--f,ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif));
  --fc-ctl:color-mix(in srgb,var(--fc-ink) 34%,transparent);
  --fc-thumb:color-mix(in srgb,var(--fc-ink) 22%,transparent);
  --fc-thumb-hover:color-mix(in srgb,var(--fc-accent) 68%,transparent);
  --fc-ring:0 0 0 3px color-mix(in srgb,var(--fc-accent) 18%,transparent);
}
html[data-theme="dark"]{color-scheme:dark}

/* ── scrollbars ── */
@supports selector(::-webkit-scrollbar){
  *::-webkit-scrollbar{width:11px;height:11px}
  *::-webkit-scrollbar-track{background:transparent}
  *::-webkit-scrollbar-thumb{background:var(--fc-thumb);border:3px solid transparent;background-clip:padding-box;border-radius:99px;min-height:40px;min-width:40px}
  *::-webkit-scrollbar-thumb:hover{background:var(--fc-thumb-hover);background-clip:padding-box;border:3px solid transparent}
  *::-webkit-scrollbar-thumb:active{background:var(--fc-accent);background-clip:padding-box;border:3px solid transparent}
  *::-webkit-scrollbar-corner{background:transparent}
}
@supports not selector(::-webkit-scrollbar){
  *{scrollbar-width:thin;scrollbar-color:var(--fc-thumb) transparent}
}

/* ── text fields, selection, autofill ── */
html{accent-color:var(--fc-accent)}
input,textarea,select{caret-color:var(--fc-accent)}
::selection{background:color-mix(in srgb,var(--fc-accent) 26%,transparent);color:inherit}
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,
textarea:-webkit-autofill,select:-webkit-autofill{
  -webkit-text-fill-color:var(--fc-ink);caret-color:var(--fc-ink);
  box-shadow:0 0 0 100px var(--fc-surface) inset;transition:background-color 99999s}
input[type=number]{-moz-appearance:textfield;appearance:textfield}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;width:16px;height:16px;cursor:pointer;opacity:.6;
  background:` + iconUrl(CROSS, '#5B5F72', 2.4) + ` center/12px no-repeat}
html[data-theme="dark"] input[type=search]::-webkit-search-cancel-button{background-image:` + iconUrl(CROSS, '#A5A3B8', 2.4) + `}
input[type=search]::-webkit-search-cancel-button:hover{opacity:1}
textarea::-webkit-resizer{background:transparent}

/* ── the closed <select>: the app's own styling stays; only the arrow is ours ── */
html select:not([multiple]):not([size]):not([data-fc-plain]){
  -webkit-appearance:none;-moz-appearance:none;appearance:none;cursor:pointer;text-overflow:ellipsis;
  background-image:` + iconUrl(CHEV, '#5B5F72') + `;background-repeat:no-repeat;
  background-position:right 10px center;background-size:16px;padding-right:32px}
html[data-theme="dark"] select:not([multiple]):not([size]):not([data-fc-plain]){background-image:` + iconUrl(CHEV, '#A5A3B8') + `}
.sel>select{background-image:none !important}
html select:disabled{cursor:not-allowed}
select option,select optgroup{background:var(--fc-surface);color:var(--fc-ink)}
select[aria-expanded="true"]{border-color:var(--fc-accent);box-shadow:var(--fc-ring)}

/* ── date and month fields: the segments stay typeable, the calendar is ours ── */
input[type=date],input[type=month]{font-variant-numeric:tabular-nums lining-nums;min-width:0}
input[type=date]::-webkit-datetime-edit,input[type=month]::-webkit-datetime-edit{padding:0}
input[type=date]::-webkit-datetime-edit-fields-wrapper,input[type=month]::-webkit-datetime-edit-fields-wrapper{padding:0}
input[type=date]::-webkit-datetime-edit-text,input[type=month]::-webkit-datetime-edit-text{color:var(--fc-faint);padding:0 .1em}
input[type=date]::-webkit-datetime-edit-day-field:focus,input[type=date]::-webkit-datetime-edit-month-field:focus,
input[type=date]::-webkit-datetime-edit-year-field:focus,input[type=month]::-webkit-datetime-edit-month-field:focus,
input[type=month]::-webkit-datetime-edit-year-field:focus{background:var(--fc-accent);color:#fff;border-radius:4px;outline:none}
input[type=date]::-webkit-calendar-picker-indicator,input[type=month]::-webkit-calendar-picker-indicator{
  width:22px;height:22px;padding:3px;margin:0 -4px 0 4px;border-radius:7px;cursor:pointer;opacity:.9;filter:none;
  background:` + iconUrl(CAL, '#5B5F72', 2) + ` center/17px no-repeat}
html[data-theme="dark"] input[type=date]::-webkit-calendar-picker-indicator,
html[data-theme="dark"] input[type=month]::-webkit-calendar-picker-indicator{background-image:` + iconUrl(CAL, '#A5A3B8', 2) + `}
input[type=date]::-webkit-calendar-picker-indicator:hover,input[type=month]::-webkit-calendar-picker-indicator:hover{
  background-color:var(--fc-accent50);opacity:1}

/* ── checkboxes and radios ── */
html body input[type=checkbox],html body input[type=radio]{
  -webkit-appearance:none;-moz-appearance:none;appearance:none;position:relative;flex:0 0 auto;
  width:18px !important;height:18px !important;min-height:0 !important;padding:0 !important;margin:0 6px 0 0;
  border:1.5px solid var(--fc-ctl) !important;border-radius:5px !important;background:var(--fc-surface) !important;
  vertical-align:middle;cursor:pointer;box-shadow:none;transition:background .12s,border-color .12s,box-shadow .12s}
html body input[type=radio]{border-radius:50% !important}
html body input[type=checkbox]:hover,html body input[type=radio]:hover{border-color:var(--fc-accent) !important}
html body input[type=checkbox]:checked,html body input[type=radio]:checked,html body input[type=checkbox]:indeterminate{
  background:var(--fc-accent) !important;border-color:var(--fc-accent) !important}
html body input[type=checkbox]:checked::after{content:"";position:absolute;left:3.5px;top:1.5px;width:5px;height:9px;
  border:solid #fff;border-width:0 2.2px 2.2px 0;transform:rotate(45deg)}
html body input[type=checkbox]:indeterminate::after{content:"";position:absolute;left:3px;top:6.5px;width:9px;height:2px;border-radius:2px;background:#fff}
html body input[type=radio]:checked::after{content:"";position:absolute;inset:3.5px;border-radius:50%;background:#fff}
html body input[type=checkbox]:focus-visible,html body input[type=radio]:focus-visible{outline:none;box-shadow:var(--fc-ring)}
html body input[type=checkbox]:disabled,html body input[type=radio]:disabled{opacity:.45;cursor:not-allowed}

/* ── file chooser button (the OS window itself cannot be restyled) ── */
input[type=file]{font:inherit;font-size:13px;color:var(--fc-muted);max-width:100%}
input[type=file]::file-selector-button{margin-right:12px;padding:8px 14px;border:1px solid var(--fc-line);border-radius:9px;
  background:var(--fc-surface);color:var(--fc-ink);font:inherit;font-size:13px;font-weight:700;cursor:pointer;
  transition:background .12s,border-color .12s}
input[type=file]::file-selector-button:hover{background:var(--fc-accent50);border-color:var(--fc-accent);color:var(--fc-accent-ink)}

/* ── popups: the dropdown list and the calendar ── */
.fcp{position:fixed;z-index:2000;display:flex;flex-direction:column;box-sizing:border-box;
  background:var(--fc-surface);color:var(--fc-ink);border:1px solid var(--fc-line);border-radius:14px;
  box-shadow:var(--fc-shadow);overflow:hidden;font-family:var(--fc-font);font-size:14px;line-height:1.4;
  letter-spacing:normal;transform-origin:top center;animation:fcp-in .12s ease-out}
.fcp *{box-sizing:border-box}
.fcp.up{transform-origin:bottom center}
.fcp button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:center}
.fcp-hd{display:none}
.fcp-search{position:relative;padding:8px;border-bottom:1px solid var(--fc-line2);flex:0 0 auto}
.fcp-search svg{position:absolute;left:19px;top:50%;width:15px;height:15px;transform:translateY(-50%);color:var(--fc-faint);pointer-events:none}
.fcp-search input{width:100%;height:36px;margin:0;padding:0 10px 0 34px;border:1px solid var(--fc-line);border-radius:9px;
  background:var(--fc-surface2);color:var(--fc-ink);font:inherit;font-size:13.5px;outline:none}
.fcp-search input:focus{border-color:var(--fc-accent);background:var(--fc-surface);box-shadow:var(--fc-ring)}
.fcp-list{position:relative;list-style:none;margin:0;padding:5px;overflow-y:auto;overscroll-behavior:contain;flex:1 1 auto;min-height:0}
.fcp-opt{display:flex;align-items:center;gap:10px;min-height:38px;padding:7px 10px;border-radius:9px;cursor:pointer;
  font-weight:500;color:var(--fc-ink);user-select:none;-webkit-user-select:none}
.fcp-opt .t{flex:1;min-width:0;overflow-wrap:anywhere}
.fcp-opt svg{width:16px;height:16px;flex:0 0 16px;color:var(--fc-accent);visibility:hidden}
.fcp-opt.ph .t{color:var(--fc-muted)}
.fcp-opt.on{background:var(--fc-accent50)}
.fcp-opt[aria-selected="true"]{font-weight:700;color:var(--fc-accent-ink)}
.fcp-opt[aria-selected="true"] svg{visibility:visible}
.fcp-opt[aria-disabled="true"]{opacity:.42;cursor:not-allowed}
.fcp-grp{padding:9px 10px 4px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--fc-faint)}
.fcp-empty{padding:20px 12px;text-align:center;color:var(--fc-muted);font-size:13px}
.fcp.ur .fcp-opt{font-family:'Noto Nastaliq Urdu',var(--fc-font);line-height:2}
.fcp-scrim{position:fixed;inset:0;z-index:1999;background:rgba(14,11,24,.42);animation:fcp-fade .15s ease-out;touch-action:none}
@keyframes fcp-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fcp-fade{from{opacity:0}to{opacity:1}}
@keyframes fcp-up{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
@keyframes fcd-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@keyframes fcd-shake{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}

/* on a phone a popup is a bottom sheet with thumb-sized rows */
.fcp.sheet{left:0 !important;right:0 !important;top:auto !important;bottom:0 !important;width:auto !important;
  max-height:78vh !important;max-height:78dvh !important;border-radius:20px 20px 0 0;border-width:1px 0 0;
  padding-bottom:env(safe-area-inset-bottom,0px);animation:fcp-up .22s cubic-bezier(.32,.72,0,1)}
.fcp.sheet .fcp-hd{display:flex;align-items:center;gap:8px;padding:14px 10px 8px 18px;flex:0 0 auto}
.fcp.sheet .fcp-hd::before{content:"";position:absolute;left:50%;top:7px;width:38px;height:4px;margin-left:-19px;border-radius:4px;background:var(--fc-line)}
.fcp-hd b{flex:1;min-width:0;font-size:15px;font-weight:800;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcp-x{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:var(--fc-muted)}
.fcp-x:hover{background:var(--fc-surface2)}
.fcp-x svg{width:18px;height:18px}
.fcp.sheet .fcp-opt{min-height:50px;font-size:15.5px;padding:10px 12px}
.fcp.sheet .fcp-search input{height:44px;font-size:16px}

/* ── the calendar ── */
.fcp.cal{width:296px;padding:12px}
.fcc-h{display:flex;align-items:center;gap:4px;margin-bottom:8px}
.fcc-nav{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:grid;place-items:center;color:var(--fc-ink2)}
.fcc-nav:hover,.fcc-ttl:hover{background:var(--fc-accent50);color:var(--fc-accent-ink)}
.fcc-nav svg{width:17px;height:17px}
.fcc-ttl{flex:1;height:34px;border-radius:10px;font-size:14.5px;font-weight:800;letter-spacing:-.01em}
.fcc-dow,.fcc-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.fcc-dow span{padding:3px 0 5px;text-align:center;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--fc-faint)}
.fcc-d{height:36px;border-radius:10px;font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums lining-nums;color:var(--fc-ink);position:relative}
.fcc-d.out{color:var(--fc-faint);font-weight:500}
.fcc-d:hover:not([disabled]){background:var(--fc-accent50)}
.fcc-d.today{box-shadow:inset 0 0 0 1.5px var(--fc-accent)}
.fcc-d.sel,.fcc-d.sel:hover{background:linear-gradient(150deg,#8B5CF6,var(--fc-accent600));color:#fff !important;font-weight:800}
.fcc-d[disabled]{opacity:.3;cursor:not-allowed}
.fcc-d:focus-visible,.fcc-nav:focus-visible,.fcc-ttl:focus-visible,.fcc-f button:focus-visible,.fcp-x:focus-visible{outline:2px solid var(--fc-accent);outline-offset:1px}
.fcc-mo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:4px 0}
.fcc-mo{height:46px;border-radius:11px;font-size:14px;font-weight:700;color:var(--fc-ink)}
.fcc-mo:hover:not([disabled]){background:var(--fc-accent50)}
.fcc-mo.today{box-shadow:inset 0 0 0 1.5px var(--fc-accent)}
.fcc-mo.sel{background:linear-gradient(150deg,#8B5CF6,var(--fc-accent600));color:#fff}
.fcc-mo[disabled]{opacity:.3;cursor:not-allowed}
.fcc-mo:focus-visible{outline:2px solid var(--fc-accent);outline-offset:1px}
.fcc-f{display:flex;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--fc-line2)}
.fcc-f button{padding:7px 12px;border-radius:9px;font-size:13px;font-weight:700;color:var(--fc-accent-ink)}
.fcc-f button:hover{background:var(--fc-accent50)}
.fcp.cal.sheet{width:auto;padding:4px 16px 16px}
.fcp.cal.sheet .fcp-hd{padding-left:2px}
.fcp.cal.sheet .fcc-d{height:44px;font-size:15px}
.fcp.cal.sheet .fcc-nav,.fcp.cal.sheet .fcc-ttl{height:42px}
.fcp.cal.sheet .fcc-mo{height:52px}

/* ── dialogs (replace confirm / prompt / alert) ── */
.fcd-scrim{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(14,11,24,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:fcp-fade .14s ease-out;
  font-family:var(--fc-font)}
.fcd{width:100%;max-width:430px;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;
  background:var(--fc-surface);color:var(--fc-ink);border:1px solid var(--fc-line);border-radius:18px;
  box-shadow:var(--fc-shadow);padding:22px 22px 18px;letter-spacing:normal;animation:fcd-in .18s cubic-bezier(.2,.9,.3,1.15)}
.fcd *{box-sizing:border-box}
.fcd.shake{animation:fcd-shake .3s}
.fcd-top{display:flex;gap:14px;align-items:flex-start}
.fcd-ic{flex:0 0 44px;width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--fc-accent50);color:var(--fc-accent)}
.fcd-ic svg{width:22px;height:22px}
.fcd.tone-danger .fcd-ic{background:var(--fc-danger50);color:var(--fc-danger)}
.fcd.tone-warn .fcd-ic{background:var(--fc-warn50);color:var(--fc-warn)}
.fcd-tx{flex:1;min-width:0;padding-top:1px}
.fcd h2{margin:0 0 5px;font-size:17px;font-weight:800;letter-spacing:-.022em;line-height:1.3;overflow-wrap:anywhere}
.fcd p{margin:0;color:var(--fc-muted);font-size:13.8px;line-height:1.55;white-space:pre-line;overflow-wrap:anywhere}
.fcd-field{margin-top:16px}
.fcd-field label{display:block;margin-bottom:6px;font-size:12.5px;font-weight:700;color:var(--fc-ink2)}
.fcd-field input,.fcd-field textarea{display:block;width:100%;margin:0;padding:11px 12px;border:1px solid var(--fc-line);border-radius:10px;
  background:var(--fc-surface2);color:var(--fc-ink);font:inherit;font-size:14px;outline:none;resize:vertical}
.fcd-field input:focus,.fcd-field textarea:focus{border-color:var(--fc-accent);background:var(--fc-surface);box-shadow:var(--fc-ring)}
.fcd-field.bad input,.fcd-field.bad textarea{border-color:var(--fc-danger)}
.fcd-err{margin-top:6px;font-size:12.5px;font-weight:600;color:var(--fc-danger)}
.fcd-err:empty{display:none}
.fcd-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.fcd-btn{min-height:42px;padding:0 20px;border-radius:11px;border:1px solid var(--fc-line);background:var(--fc-surface);color:var(--fc-ink);
  font:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background .12s,box-shadow .12s,transform .12s}
.fcd-btn:hover{background:var(--fc-surface2)}
.fcd-btn:active{transform:translateY(1px)}
.fcd-btn:focus-visible{outline:2px solid var(--fc-accent);outline-offset:2px}
.fcd-btn.pri{border-color:transparent;color:#fff;background:linear-gradient(150deg,#8B5CF6,var(--fc-accent600));box-shadow:0 6px 18px rgba(124,58,237,.26)}
.fcd-btn.pri:hover{box-shadow:0 10px 24px rgba(124,58,237,.34)}
.fcd-btn.danger{border-color:transparent;color:#fff;background:linear-gradient(150deg,#E5484D,#B4232A);box-shadow:0 6px 18px rgba(200,40,50,.28)}
.fcd-btn.danger:hover{box-shadow:0 10px 24px rgba(200,40,50,.36)}
.fcd-btn.danger:focus-visible{outline-color:#E5484D}
.fcd-scrim.sheet{align-items:flex-end;padding:0}
.fcd-scrim.sheet .fcd{max-width:none;border-radius:22px 22px 0 0;border-width:1px 0 0;
  padding:22px 18px calc(16px + env(safe-area-inset-bottom,0px));animation:fcp-up .22s cubic-bezier(.32,.72,0,1)}
.fcd-scrim.sheet .fcd-foot{gap:10px}
.fcd-scrim.sheet .fcd-field input,.fcd-scrim.sheet .fcd-field textarea{font-size:16px}   /* iOS zooms the page for anything smaller */
.fcd-scrim.sheet .fcd-btn{flex:1;min-height:48px;font-size:15px}

/* ── tooltips ── */
.fct{position:fixed;z-index:2200;max-width:260px;padding:6px 10px;border-radius:8px;background:var(--fc-ink);color:var(--fc-surface);
  font:600 12px/1.4 var(--fc-font);letter-spacing:normal;white-space:pre-line;pointer-events:none;box-shadow:var(--fc-shadow);
  opacity:0;transform:translateY(3px);transition:opacity .12s,transform .12s}
.fct.on{opacity:1;transform:none}

@media print{.fcp,.fcp-scrim,.fcd-scrim,.fct{display:none !important}}
`;

function injectStyle() {
  if (D.getElementById('fcUiKitCss')) return;
  var st = D.createElement('style'); st.id = 'fcUiKitCss'; st.textContent = CSS;
  (D.head || D.documentElement).appendChild(st);
}
injectStyle();

/* ═════════════════════════════════════════════════════════════════════════
   2 · POPUPS — one at a time (a dropdown or a calendar), anchored to a field
   ═════════════════════════════════════════════════════════════════════════ */
var POP = null;
var SEQ = 0;

function closePop(refocus) {
  var p = POP; if (!p) return;
  POP = null;
  D.removeEventListener('keydown', p.onKey, true);
  D.removeEventListener('mousedown', p.onOutside, true);
  global.removeEventListener('resize', p.onMove);
  global.removeEventListener('scroll', p.onMove, true);
  if (p.mo) p.mo.disconnect();
  if (p.root.parentNode) p.root.parentNode.removeChild(p.root);
  if (p.scrim && p.scrim.parentNode) p.scrim.parentNode.removeChild(p.scrim);
  if (p.anchor && p.anchor.removeAttribute) {
    p.anchor.removeAttribute('aria-expanded'); p.anchor.removeAttribute('aria-controls');
    p.anchor.removeAttribute('aria-activedescendant');
  }
  if (refocus && p.anchor && D.documentElement.contains(p.anchor)) focusEl(p.anchor);
}

function place(root, anchor, opts) {
  if (root.classList.contains('sheet')) return;
  opts = opts || {};
  var r = anchor.getBoundingClientRect();
  var vw = D.documentElement.clientWidth || global.innerWidth || 1024;
  var vh = global.innerHeight || D.documentElement.clientHeight || 768;
  if (r.bottom < 0 || r.top > vh) { closePop(false); return; }       /* scrolled out of sight */
  var w = opts.width || Math.max(r.width, opts.minWidth || 0);
  w = Math.min(w, vw - 16);
  root.style.width = w + 'px';
  root.style.maxHeight = '';
  var natural = root.offsetHeight || root.scrollHeight || 0;
  var below = vh - r.bottom - 10, above = r.top - 10;
  var up = natural > below && above > below;
  var maxH = Math.max(120, Math.min(opts.maxHeight || 340, up ? above : below));
  root.style.maxHeight = maxH + 'px';
  var h = Math.min(natural, maxH);
  var top = up ? r.top - 4 - h : r.bottom + 4;
  root.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
  root.style.top = Math.max(8, top) + 'px';
  root.classList.toggle('up', up);
}

function mount(p, anchor, opts) {
  p.anchor = anchor;
  p.onOutside = function (e) {
    if (p.root.contains(e.target) || e.target === anchor) return;
    if (p.scrim && e.target === p.scrim) { e.preventDefault(); closePop(true); return; }
    closePop(false);
  };
  p.onMove = function (e) {
    if (e && e.target && e.target !== D && e.target.nodeType === 1 && p.root.contains(e.target)) return;
    place(p.root, anchor, opts);
  };
  if (p.scrim) {
    D.body.appendChild(p.scrim);
    p.scrim.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  }
  D.body.appendChild(p.root);
  POP = p;
  anchor.setAttribute('aria-expanded', 'true');
  place(p.root, anchor, opts);
  D.addEventListener('keydown', p.onKey, true);
  D.addEventListener('mousedown', p.onOutside, true);
  global.addEventListener('resize', p.onMove);
  global.addEventListener('scroll', p.onMove, true);
  if (global.MutationObserver) {
    p.mo = new global.MutationObserver(function () {
      if (!D.documentElement.contains(anchor)) closePop(false);      /* the screen was re-drawn under it */
    });
    p.mo.observe(D.body, { childList: true, subtree: true });
  }
}

function titleFor(el, fallback) {
  var t = el.getAttribute('aria-label') || el.getAttribute('data-fc-title');
  if (t) return t;
  var lab = (el.labels && el.labels[0]) || (el.closest && el.closest('label'));
  if (lab) {
    var c = lab.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('select,input,textarea,button'), function (n) { n.parentNode.removeChild(n); });
    t = (c.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return fallback;
}

/* ── the dropdown list ────────────────────────────────────────────────────── */
var SEARCH_MIN = 8;

function eligibleSelect(t) {
  return !!t && t.tagName === 'SELECT' && !t.multiple && !(t.size > 1) && !t.disabled && !t.hasAttribute('data-fc-plain');
}

function collect(sel) {
  var out = [];
  function add(o, g) {
    if (o.hidden) return;
    var label = (o.label || o.text || '').replace(/\s+/g, ' ').trim();
    out.push({ idx: o.index, label: label, value: o.value, disabled: !!(o.disabled || (g && g.disabled)),
      group: g ? (g.label || '') : '', norm: normalize(label) });
  }
  Array.prototype.forEach.call(sel.children, function (n) {
    if (n.tagName === 'OPTGROUP') {
      Array.prototype.forEach.call(n.children, function (o) { if (o.tagName === 'OPTION') add(o, n); });
    } else if (n.tagName === 'OPTION') add(n, null);
  });
  return out;
}

function openSelect(sel) {
  if (!eligibleSelect(sel)) return;
  if (POP && POP.anchor === sel) { closePop(true); return; }
  closePop(false);
  var all = collect(sel);
  var sheet = useSheet();
  var searchable = all.length > SEARCH_MIN;
  var uid = 'fcp' + (++SEQ);
  var title = titleFor(sel, 'Choose an option');
  var root = mk('div', 'fcp fcp-sel' + (sheet ? ' sheet' : '') + (/(^|\s)ur(\s|$)/.test(sel.className) ? ' ur' : ''));
  root.setAttribute('data-fcp', 'select');
  root.innerHTML =
    (sheet ? '<div class="fcp-hd"><b>' + esc(title) + '</b><button type="button" class="fcp-x" aria-label="Close">' + IC.x + '</button></div>' : '') +
    (searchable ? '<div class="fcp-search">' + IC.search +
      '<input type="text" class="fcp-q" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search…" ' +
      'aria-label="Search ' + esc(title) + '" role="combobox" aria-expanded="true" aria-controls="' + uid + '-l"></div>' : '') +
    '<ul class="fcp-list" role="listbox" id="' + uid + '-l" aria-label="' + esc(title) + '"></ul>';
  var list = root.querySelector('.fcp-list');
  var qInput = root.querySelector('.fcp-q');
  var view = [], active = -1, q = '', buf = '', bufT = 0, moved = false;
  var focused = qInput || sel;

  function firstEnabled(from, dir) {
    for (var i = from; i >= 0 && i < view.length; i += dir) if (!view[i].disabled) return i;
    return -1;
  }
  function reveal(li, center) {
    if (!li) return;
    var top = li.offsetTop, bottom = top + li.offsetHeight;
    if (center) list.scrollTop = Math.max(0, top - (list.clientHeight - li.offsetHeight) / 2);
    else if (top < list.scrollTop + 4) list.scrollTop = Math.max(0, top - 4);
    else if (bottom > list.scrollTop + list.clientHeight - 4) list.scrollTop = bottom - list.clientHeight + 4;
  }
  function setActive(i, scroll, center) {
    var old = list.querySelector('.fcp-opt.on');
    if (old) old.classList.remove('on');
    active = i;
    var li = i > -1 ? list.querySelector('[data-i="' + i + '"]') : null;
    if (li) { li.classList.add('on'); if (scroll) reveal(li, center); }
    if (li) focused.setAttribute('aria-activedescendant', li.id); else focused.removeAttribute('aria-activedescendant');
  }
  function render() {
    var words = normalize(q).split(' ').filter(Boolean);
    view = all.filter(function (it) {
      return !words.length || words.every(function (w) { return it.norm.indexOf(w) > -1; });
    });
    var frag = D.createDocumentFragment(), last = null;
    view.forEach(function (it, i) {
      if (it.group && it.group !== last) frag.appendChild(mk('li', 'fcp-grp', esc(it.group))).setAttribute('role', 'presentation');
      last = it.group;
      var li = mk('li', 'fcp-opt' + (it.value === '' ? ' ph' : ''), '<span class="t">' + esc(it.label || ' ') + '</span>' + IC.check);
      li.id = uid + '-o' + i; li.setAttribute('role', 'option'); li.setAttribute('data-i', i);
      li.setAttribute('aria-selected', it.idx === sel.selectedIndex ? 'true' : 'false');
      if (it.disabled) li.setAttribute('aria-disabled', 'true');
      frag.appendChild(li);
    });
    if (!view.length) frag.appendChild(mk('li', 'fcp-empty', 'No matches')).setAttribute('role', 'presentation');
    list.innerHTML = ''; list.appendChild(frag);
  }
  function pick(i) {
    var it = view[i]; if (!it || it.disabled) return;
    if (sel.selectedIndex !== it.idx) { sel.selectedIndex = it.idx; fire(sel, 'input'); fire(sel, 'change'); }
    closePop(true);
  }
  function move(delta) {
    var i = active;
    if (i < 0) i = delta > 0 ? firstEnabled(0, 1) : firstEnabled(view.length - 1, -1);
    else {
      var n = i + delta;
      n = Math.max(0, Math.min(view.length - 1, n));
      var j = firstEnabled(n, delta > 0 ? 1 : -1);
      if (j < 0) j = firstEnabled(n, delta > 0 ? -1 : 1);
      i = j < 0 ? i : j;
    }
    moved = true; setActive(i, true);
  }
  function typeahead(ch) {
    buf += ch; clearTimeout(bufT); bufT = setTimeout(function () { buf = ''; }, 800);
    var nb = normalize(buf), hit = -1, i;
    for (i = 0; i < view.length && hit < 0; i++) if (!view[i].disabled && view[i].norm.indexOf(nb) === 0) hit = i;
    for (i = 0; i < view.length && hit < 0; i++) if (!view[i].disabled && view[i].norm.indexOf(nb) > -1) hit = i;
    if (hit > -1) { moved = true; setActive(hit, true); }
  }

  var p = { root: root, kind: 'select', sel: sel };
  p.scrim = sheet ? mk('div', 'fcp-scrim') : null;
  p.onKey = function (e) {
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
    if (k === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    if (k === 'PageDown') { e.preventDefault(); move(8); return; }
    if (k === 'PageUp') { e.preventDefault(); move(-8); return; }
    if (k === 'Home' && !qInput) { e.preventDefault(); setActive(firstEnabled(0, 1), true); moved = true; return; }
    if (k === 'End' && !qInput) { e.preventDefault(); setActive(firstEnabled(view.length - 1, -1), true); moved = true; return; }
    if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); if (active > -1) pick(active); else closePop(true); return; }
    if (k === 'Tab') {
      if (active > -1 && (moved || q)) { var it = view[active]; if (it && !it.disabled && sel.selectedIndex !== it.idx) { sel.selectedIndex = it.idx; fire(sel, 'input'); fire(sel, 'change'); } }
      closePop(true); return;              /* focus is back on the field, so Tab carries on from there */
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k.length === 1) {
      if (qInput) { if (D.activeElement !== qInput) focusEl(qInput); return; }   /* the character lands in the box */
      if (k === ' ' && !buf) { e.preventDefault(); if (active > -1) pick(active); return; }
      e.preventDefault(); typeahead(k.toLowerCase());
    }
  };
  render();
  var sIdx = -1;
  view.forEach(function (it, i) { if (sIdx < 0 && it.idx === sel.selectedIndex && !it.disabled) sIdx = i; });
  mount(p, sel, { minWidth: 180, maxHeight: 340 });
  sel.setAttribute('aria-controls', uid + '-l');
  setActive(sIdx > -1 ? sIdx : firstEnabled(0, 1), true, true);

  list.addEventListener('mousemove', function (e) {
    var li = e.target.closest && e.target.closest('.fcp-opt'); if (!li) return;
    var i = +li.getAttribute('data-i');
    if (i !== active && !view[i].disabled) setActive(i, false);
  });
  list.addEventListener('click', function (e) {
    var li = e.target.closest && e.target.closest('.fcp-opt'); if (li) pick(+li.getAttribute('data-i'));
  });
  root.addEventListener('mousedown', function (e) { if (e.target !== qInput) e.preventDefault(); });
  var x = root.querySelector('.fcp-x');
  if (x) x.addEventListener('click', function () { closePop(true); });
  if (qInput) {
    qInput.addEventListener('input', function () {
      q = qInput.value; render(); moved = true;
      setActive(firstEnabled(0, 1), true);
    });
    if (!sheet) focusEl(qInput);                    /* on a phone leave the keyboard down until asked for */
  }
}

/* ── the calendar ─────────────────────────────────────────────────────────── */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
function pad(n) { return (n < 10 ? '0' : '') + n; }
function isoOf(o, month) { return o.y + '-' + pad(o.m + 1) + (month ? '' : '-' + pad(o.d)); }
function parseISO(s, month) {
  var m = month ? /^(\d{4})-(\d{2})$/.exec(s || '') : /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  var y = +m[1], mo = +m[2] - 1, d = month ? 1 : +m[3], t = new Date(y, mo, d);
  if (t.getFullYear() !== y || t.getMonth() !== mo || t.getDate() !== d) return null;
  return { y: y, m: mo, d: d };
}
function keyOf(o) { return o.y * 10000 + o.m * 100 + o.d; }
function shift(o, dy, dm, dd) { var t = new Date(o.y + dy, o.m + dm, o.d + dd); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; }
function dim(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* Only take over the calendar where the browser lets us (Chrome, Edge, Safari). Elsewhere
   (Firefox) the browser's own date field is left completely alone. UI.dateHook overrides. */
var DATE_HOOK_DETECTED = (function () {
  if (!(global.CSS && global.CSS.supports)) return true;
  try { return global.CSS.supports('selector(::-webkit-calendar-picker-indicator)'); } catch (e) { return false; }
})();
function dateHookOn() { return UI.dateHook === true || UI.dateHook === false ? UI.dateHook : DATE_HOOK_DETECTED; }
function eligibleDate(t) {
  return !!t && t.tagName === 'INPUT' && (t.type === 'date' || t.type === 'month') && !t.disabled && !t.readOnly &&
    !t.hasAttribute('data-fc-plain') && dateHookOn();
}

function openDate(inp) {
  if (!eligibleDate(inp)) return;
  if (POP && POP.anchor === inp) { closePop(true); return; }
  closePop(false);
  var isMonth = inp.type === 'month';
  var sheet = useSheet();
  var cur = parseISO(inp.value, isMonth);
  var min = parseISO(inp.min, isMonth), max = parseISO(inp.max, isMonth);
  var t0 = new Date();
  var today = { y: t0.getFullYear(), m: t0.getMonth(), d: isMonth ? 1 : t0.getDate() };
  var cursor = cur || today;                                   /* the day the keyboard is on */
  var view = { y: cursor.y, m: cursor.m, mode: isMonth ? 'months' : 'days' };
  var root = mk('div', 'fcp cal' + (sheet ? ' sheet' : ''));
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', isMonth ? 'Choose a month' : 'Choose a date');
  root.setAttribute('data-fcp', isMonth ? 'month' : 'date');
  var title = titleFor(inp, isMonth ? 'Choose a month' : 'Choose a date');
  var p = { root: root, kind: 'date', input: inp };
  p.scrim = sheet ? mk('div', 'fcp-scrim') : null;

  function off(o) { var k = keyOf(o); return !!((min && k < keyOf(min)) || (max && k > keyOf(max))); }
  function commit(v) {
    if (inp.value !== v) { inp.value = v; fire(inp, 'input'); fire(inp, 'change'); }
    closePop(true);
  }
  function render() {
    var fa = root.contains(D.activeElement) ? D.activeElement : null;
    var sig = fa ? (fa.getAttribute('data-a') || (fa.getAttribute('data-d') || fa.getAttribute('data-mo') ? 'cell' : '')) : '';
    var h = '', months = view.mode === 'months';
    if (sheet) h += '<div class="fcp-hd"><b>' + esc(title) + '</b><button type="button" class="fcp-x" aria-label="Close">' + IC.x + '</button></div>';
    h += '<div class="fcc-h"><button type="button" class="fcc-nav" data-a="prev" aria-label="' + (months ? 'Previous year' : 'Previous month') + '">' + IC.left + '</button>' +
      '<button type="button" class="fcc-ttl" data-a="title" aria-live="polite"' + (isMonth ? ' disabled' : '') + '>' +
      (months ? view.y : MONTHS[view.m] + ' ' + view.y) + '</button>' +
      '<button type="button" class="fcc-nav" data-a="next" aria-label="' + (months ? 'Next year' : 'Next month') + '">' + IC.right + '</button></div>';
    if (months) {
      h += '<div class="fcc-mo-grid" role="group">';
      for (var mi = 0; mi < 12; mi++) {
        var mo = { y: view.y, m: mi, d: 1 };
        var isSel = cur && cur.y === view.y && cur.m === mi;
        var focusHere = cursor.y === view.y && cursor.m === mi;
        h += '<button type="button" class="fcc-mo' + (isSel ? ' sel' : '') + (today.y === view.y && today.m === mi ? ' today' : '') +
          '" data-mo="' + mi + '" tabindex="' + (focusHere ? 0 : -1) + '"' + (off(mo) ? ' disabled' : '') +
          ' aria-label="' + MONTHS[mi] + ' ' + view.y + '"' + (isSel ? ' aria-pressed="true"' : '') + '>' + MON3[mi] + '</button>';
      }
      h += '</div>';
    } else {
      h += '<div class="fcc-dow" aria-hidden="true">' + DOW.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
      h += '<div class="fcc-grid" role="grid">';
      var first = new Date(view.y, view.m, 1), lead = (first.getDay() + 6) % 7;         /* weeks start on Monday */
      var tab = (cursor.y === view.y && cursor.m === view.m) ? keyOf(cursor) : keyOf({ y: view.y, m: view.m, d: 1 });
      for (var i = 0; i < 42; i++) {
        var t = new Date(view.y, view.m, 1 - lead + i), o = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
        var k = keyOf(o), sel = cur && k === keyOf(cur), out = o.m !== view.m;
        h += '<button type="button" class="fcc-d' + (out ? ' out' : '') + (k === keyOf(today) ? ' today' : '') + (sel ? ' sel' : '') +
          '" data-d="' + isoOf(o) + '" tabindex="' + (k === tab ? 0 : -1) + '"' + (off(o) ? ' disabled' : '') +
          ' aria-label="' + o.d + ' ' + MONTHS[o.m] + ' ' + o.y + '"' + (sel ? ' aria-pressed="true"' : '') +
          (k === keyOf(today) ? ' aria-current="date"' : '') + '>' + o.d + '</button>';
      }
      h += '</div>';
    }
    h += '<div class="fcc-f"><button type="button" data-a="today">' + (isMonth ? 'This month' : 'Today') + '</button>' +
      (!inp.required && inp.value ? '<button type="button" data-a="clear">Clear</button>' : '<span></span>') + '</div>';
    root.innerHTML = h;
    if (sig) {
      var t = sig === 'cell' ? root.querySelector('[tabindex="0"]') : root.querySelector('[data-a="' + sig + '"]');
      if (t) focusEl(t);
    }
  }
  function focusCell() { var c = root.querySelector('[tabindex="0"]'); if (c) focusEl(c); }
  function go(o) {                                    /* move the keyboard cursor, following it with the view */
    cursor = o; view.y = o.y; view.m = o.m; render(); focusCell();
  }

  p.onKey = function (e) {
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
    if (k === 'Tab') return;                                             /* natural order; focusout closes at the ends */
    var onCell = D.activeElement && (D.activeElement.getAttribute('data-d') || D.activeElement.getAttribute('data-mo') != null);
    if (!onCell || !root.contains(D.activeElement)) return;
    var months = view.mode === 'months', step = null;
    if (months) {
      if (k === 'ArrowLeft') step = shift(cursor, 0, -1, 0);
      else if (k === 'ArrowRight') step = shift(cursor, 0, 1, 0);
      else if (k === 'ArrowUp') step = shift(cursor, 0, -3, 0);
      else if (k === 'ArrowDown') step = shift(cursor, 0, 3, 0);
      else if (k === 'PageUp') step = shift(cursor, -1, 0, 0);
      else if (k === 'PageDown') step = shift(cursor, 1, 0, 0);
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); D.activeElement.click(); return; }
      if (step) { e.preventDefault(); step.d = 1; go(step); }
      return;
    }
    if (k === 'ArrowLeft') step = shift(cursor, 0, 0, -1);
    else if (k === 'ArrowRight') step = shift(cursor, 0, 0, 1);
    else if (k === 'ArrowUp') step = shift(cursor, 0, 0, -7);
    else if (k === 'ArrowDown') step = shift(cursor, 0, 0, 7);
    else if (k === 'Home') step = shift(cursor, 0, 0, -((new Date(cursor.y, cursor.m, cursor.d).getDay() + 6) % 7));
    else if (k === 'End') step = shift(cursor, 0, 0, 6 - ((new Date(cursor.y, cursor.m, cursor.d).getDay() + 6) % 7));
    else if (k === 'PageUp' || k === 'PageDown') {
      var dm = (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1);
      var ny = new Date(cursor.y, cursor.m + dm, 1);
      step = { y: ny.getFullYear(), m: ny.getMonth(), d: Math.min(cursor.d, dim(ny.getFullYear(), ny.getMonth())) };
    } else if (k === 'Enter' || k === ' ') { e.preventDefault(); D.activeElement.click(); return; }
    if (step) { e.preventDefault(); go(step); }
  };

  root.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-a');
    if (b.classList.contains('fcp-x')) { closePop(true); return; }
    if (b.getAttribute('data-d')) { commit(b.getAttribute('data-d')); return; }
    if (b.getAttribute('data-mo') != null) {
      var mi = +b.getAttribute('data-mo');
      if (isMonth) { commit(isoOf({ y: view.y, m: mi, d: 1 }, true)); return; }
      view.m = mi; view.mode = 'days';
      cursor = { y: view.y, m: mi, d: Math.min(cursor.d, dim(view.y, mi)) };
      render(); focusCell(); return;
    }
    if (a === 'prev' || a === 'next') {
      var dir = a === 'next' ? 1 : -1;
      if (view.mode === 'months') { view.y += dir; cursor = { y: view.y, m: cursor.m, d: 1 }; }
      else { var t = new Date(view.y, view.m + dir, 1); view.y = t.getFullYear(); view.m = t.getMonth();
        cursor = { y: view.y, m: view.m, d: Math.min(cursor.d, dim(view.y, view.m)) }; }
      render(); return;
    }
    if (a === 'title' && !isMonth) { view.mode = view.mode === 'days' ? 'months' : 'days'; render(); focusCell(); return; }
    if (a === 'today') {
      if (off(today)) { view.y = today.y; view.m = today.m; view.mode = isMonth ? 'months' : 'days'; cursor = today; render(); return; }
      commit(isoOf(today, isMonth)); return;
    }
    if (a === 'clear') { commit(''); }
  });
  root.addEventListener('focusout', function (e) {
    var to = e.relatedTarget;
    if (to && !root.contains(to) && to !== inp) closePop(false);
  });

  render();
  mount(p, inp, { width: sheet ? 0 : 296, maxHeight: 420 });
  focusCell();
}

/* ═════════════════════════════════════════════════════════════════════════
   3 · TAKING OVER THE NATIVE POPUPS
   ═════════════════════════════════════════════════════════════════════════ */
var lastTypeAt = 0;
D.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  var t = e.target;
  if (!eligibleSelect(t)) return;
  e.preventDefault();                       /* stops the browser opening its own list */
  focusEl(t);
  openSelect(t);
}, true);

D.addEventListener('keydown', function (e) {
  if (POP) return;
  var t = e.target;
  if (eligibleSelect(t)) {
    var spaceOpens = e.key === ' ' && !e.ctrlKey && !e.metaKey && (Date.now() - lastTypeAt > 800);
    if (spaceOpens || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) || e.key === 'F4') {
      e.preventDefault(); openSelect(t); return;
    }
    if (e.key.length === 1 && e.key !== ' ') lastTypeAt = Date.now();
  } else if (eligibleDate(t) && ((e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) || e.key === 'F4')) {
    e.preventDefault(); openDate(t);
  }
}, true);
D.addEventListener('keyup', function (e) {
  if (e.key === ' ' && eligibleSelect(e.target)) e.preventDefault();
}, true);

/* the calendar button lives inside the date field; only clicks on it open ours,
   so clicking a day / month / year segment still just lets you type */
D.addEventListener('click', function (e) {
  var t = e.target;
  if (!eligibleDate(t)) return;
  var r = t.getBoundingClientRect(), cs = global.getComputedStyle ? global.getComputedStyle(t) : null;
  var edge = r.right - (cs ? (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderRightWidth) || 0) : 0);
  if (e.clientX < edge - 34) return;
  e.preventDefault();
  openDate(t);
}, true);

/* ═════════════════════════════════════════════════════════════════════════
   4 · DIALOGS — confirm / prompt / alert as Promises
   ═════════════════════════════════════════════════════════════════════════ */
var DQ = [], DOPEN = null;
function stubbed(name) {
  var f = global[name];
  return typeof f === 'function' && !f.__fcUI && !isNative(f);
}
function pump() {
  if (DOPEN || !DQ.length) return;
  var job = DQ.shift();
  showDialog(job.cfg, job.resolve);
}
function dialog(cfg) {
  return new Promise(function (resolve) { DQ.push({ cfg: cfg, resolve: resolve }); pump(); });
}
function focusables(box) {
  return Array.prototype.filter.call(box.querySelectorAll('input,textarea,button,[tabindex]'), function (n) {
    return !n.disabled && n.getAttribute('tabindex') !== '-1';
  });
}

function showDialog(cfg, resolve) {
  closePop(false);
  var prev = D.activeElement;
  var id = 'fcd' + (++SEQ);
  var sheet = useSheet();
  var kind = cfg.kind;
  var tone = cfg.tone || (kind === 'alert' ? 'info' : 'info');
  var icon = tone === 'danger' ? IC.warn : tone === 'warn' ? IC.warn : kind === 'prompt' ? IC.note : kind === 'alert' ? IC.info : IC.help;
  var scrim = mk('div', 'fcd-scrim' + (sheet ? ' sheet' : ''));
  var field = '';
  if (kind === 'prompt') {
    var inputTag = cfg.multiline
      ? '<textarea id="' + id + '-i" rows="3" maxlength="' + (cfg.maxLength || 400) + '" placeholder="' + esc(cfg.placeholder || '') + '">' + esc(cfg.value || '') + '</textarea>'
      : '<input id="' + id + '-i" type="text" autocomplete="off" maxlength="' + (cfg.maxLength || 400) + '" placeholder="' + esc(cfg.placeholder || '') + '" value="' + esc(cfg.value || '') + '">';
    field = '<div class="fcd-field">' + (cfg.label ? '<label for="' + id + '-i">' + esc(cfg.label) + '</label>' : '') + inputTag +
      '<div class="fcd-err" id="' + id + '-e" role="alert"></div></div>';
  }
  scrim.innerHTML =
    '<div class="fcd tone-' + esc(tone) + '" role="' + (kind === 'alert' || tone === 'danger' ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="' + id + '-t"' +
      (cfg.detail ? ' aria-describedby="' + id + '-m"' : '') + '>' +
      '<div class="fcd-top"><div class="fcd-ic">' + icon + '</div><div class="fcd-tx"><h2 id="' + id + '-t">' + esc(cfg.title) + '</h2>' +
      (cfg.detail ? '<p id="' + id + '-m">' + esc(cfg.detail) + '</p>' : '') + '</div></div>' + field +
      '<div class="fcd-foot">' +
        (kind === 'alert' ? '' : '<button type="button" class="fcd-btn" data-fcd="cancel">' + esc(cfg.cancelText || 'Cancel') + '</button>') +
        '<button type="button" class="fcd-btn ' + (tone === 'danger' ? 'danger' : 'pri') + '" data-fcd="ok">' + esc(cfg.okText || (kind === 'alert' ? 'OK' : kind === 'prompt' ? 'Save' : 'Confirm')) + '</button>' +
      '</div></div>';
  var box = scrim.firstChild;
  var input = scrim.querySelector('input,textarea');
  var errBox = scrim.querySelector('.fcd-err');
  var done = false;

  function finish(value) {
    if (done) return; done = true;
    D.removeEventListener('keydown', onKey, true);
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    DOPEN = null;
    if (prev && D.documentElement.contains(prev)) focusEl(prev);
    resolve(value);
    pump();
  }
  function submit() {
    if (kind === 'prompt') {
      var v = (input.value || '').trim();
      if (cfg.required && !v) {
        errBox.textContent = cfg.requiredText || 'Please fill this in.';
        input.parentNode.classList.add('bad'); input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', id + '-e');
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        focusEl(input); return;
      }
      finish(v);
    } else finish(kind === 'alert' ? undefined : true);
  }
  function cancel() { finish(kind === 'prompt' ? null : kind === 'alert' ? undefined : false); }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key === 'Enter') {
      var a = D.activeElement;
      if (a && a.tagName === 'BUTTON') return;                 /* let the focused button do its own thing */
      if (a && a.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); e.stopPropagation(); submit(); return;
    }
    if (e.key === 'Tab') {
      var f = focusables(box); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], at = D.activeElement;
      if (!box.contains(at)) { e.preventDefault(); focusEl(first); }
      else if (e.shiftKey && at === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); focusEl(first); }
    }
  }
  scrim.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fcd]');
    if (b) { if (b.getAttribute('data-fcd') === 'ok') submit(); else cancel(); return; }
    if (e.target === scrim) {
      if (kind === 'prompt' && input && input.value) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); return; }
      cancel();
    }
  });
  scrim.addEventListener('wheel', function (e) { if (e.target === scrim) e.preventDefault(); }, { passive: false });
  scrim.addEventListener('touchmove', function (e) { if (e.target === scrim) e.preventDefault(); }, { passive: false });
  if (input) input.addEventListener('input', function () {
    errBox.textContent = ''; input.parentNode.classList.remove('bad'); input.removeAttribute('aria-invalid');
  });

  DOPEN = { scrim: scrim, box: box };
  D.body.appendChild(scrim);
  D.addEventListener('keydown', onKey, true);
  var initial = input || scrim.querySelector(tone === 'danger' && kind === 'confirm' ? '[data-fcd="cancel"]' : '[data-fcd="ok"]');
  focusEl(initial);
  if (input && input.select && cfg.value) input.select();
}

/* Ask a yes/no question.  ERP.UI.confirm('Discard this invoice?', {detail, okText, cancelText, tone})
   → Promise<boolean>. tone: 'info' (default) | 'warn' | 'danger' (red button, Cancel focused). */
UI.confirm = function (question, opts) {
  opts = opts || {};
  if (stubbed('confirm')) {
    return Promise.resolve(!!global.confirm(opts.detail ? question + '\n\n' + opts.detail : question));
  }
  return dialog({ kind: 'confirm', title: opts.title || question, detail: opts.title ? (opts.detail || question) : opts.detail,
    okText: opts.okText, cancelText: opts.cancelText, tone: opts.tone });
};
/* Ask for a line of text → Promise<string | null> (null = cancelled, '' = left blank).
   opts: label, placeholder, value, required, requiredText, multiline, maxLength, detail, okText, cancelText, tone */
UI.prompt = function (question, opts) {
  opts = opts || {};
  if (stubbed('prompt')) {
    var r = global.prompt(opts.detail ? question + '\n\n' + opts.detail : question, opts.value || '');
    return Promise.resolve(r == null ? null : String(r));
  }
  return dialog({ kind: 'prompt', title: opts.title || question, detail: opts.title ? (opts.detail || question) : opts.detail,
    label: opts.label, placeholder: opts.placeholder, value: opts.value, required: opts.required, requiredText: opts.requiredText,
    multiline: opts.multiline, maxLength: opts.maxLength, okText: opts.okText, cancelText: opts.cancelText, tone: opts.tone });
};
/* Tell the person something they must acknowledge → Promise<void>. */
UI.alert = function (message, opts) {
  opts = opts || {};
  if (stubbed('alert')) { global.alert(message); return Promise.resolve(); }
  return dialog({ kind: 'alert', title: opts.title || message, detail: opts.title ? (opts.detail || message) : opts.detail,
    okText: opts.okText, tone: opts.tone });
};
/* window.alert has no return value, so it can be replaced outright. */
if (isNative(global.alert)) {
  var themedAlert = function (m) { UI.alert(m == null ? '' : String(m)); };
  themedAlert.__fcUI = true;
  try { global.alert = themedAlert; } catch (e) { /* read-only in some shells */ }
}

/* The base app's "clear this device" button calls the native confirm() itself.
   Ask ours first, then let the original handler run with its question answered. */
D.addEventListener('click', function (e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-dbreset]') : null;
  if (!b || b.__fcAsked || !isNative(global.confirm)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  UI.confirm('Clear all data on this device?', {
    detail: 'All stock, shops and history saved on this device will be erased. This cannot be undone.',
    okText: 'Clear data', cancelText: 'Keep my data', tone: 'danger'
  }).then(function (ok) {
    if (!ok) return;
    var real = global.confirm;
    global.confirm = function () { return true; };
    b.__fcAsked = true;
    try { b.click(); } finally { global.confirm = real; b.__fcAsked = false; }
  });
}, true);

/* ═════════════════════════════════════════════════════════════════════════
   5 · TOOLTIPS — a themed tip for any [title]
   ═════════════════════════════════════════════════════════════════════════ */
var TIP = { el: null, target: null, timer: 0, hide: 0 };
function tipHost(node) {
  return node && node.closest ? node.closest('[title]:not([title=""]),[data-fc-title]') : null;
}
function tipRestore() {
  var t = TIP.target;
  if (t && t.getAttribute('data-fc-tip') != null) {
    if (!t.hasAttribute('title')) t.setAttribute('title', t.getAttribute('data-fc-tip'));
    t.removeAttribute('data-fc-tip');
  }
}
function tipHide() {
  clearTimeout(TIP.timer); clearTimeout(TIP.hide);
  if (TIP.el) { TIP.el.classList.remove('on'); var e = TIP.el; TIP.el = null; setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 130); }
  if (TIP.target) { tipRestore(); TIP.target.removeAttribute('aria-describedby'); TIP.target = null; }
}
function tipShow(t, instant) {
  if (TIP.target === t) return;
  tipHide();
  var text = t.getAttribute('title');
  if (!text) return;
  TIP.target = t;
  if (!t.hasAttribute('aria-label') && !(t.textContent || '').trim()) t.setAttribute('aria-label', text);   /* icon-only control keeps its name */
  t.setAttribute('data-fc-tip', text); t.removeAttribute('title');       /* silence the browser's own tooltip while ours is due */
  TIP.timer = setTimeout(function () {
    if (TIP.target !== t || !D.documentElement.contains(t)) { tipHide(); return; }
    var el = mk('div', 'fct', esc(text)); el.setAttribute('role', 'tooltip'); el.id = 'fcTip' + (++SEQ);
    D.body.appendChild(el); TIP.el = el; t.setAttribute('aria-describedby', el.id);
    var r = t.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    var vw = D.documentElement.clientWidth || global.innerWidth, vh = global.innerHeight;
    var top = r.top - h - 8; if (top < 6) top = Math.min(r.bottom + 8, vh - h - 6);
    el.style.left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, vw - w - 6)) + 'px';
    el.style.top = top + 'px';
    el.classList.add('on');
    TIP.hide = setTimeout(tipHide, 7000);
  }, instant ? 0 : 420);
}
D.addEventListener('mouseover', function (e) {
  if (!canHover() || POP || DOPEN) return;
  var t = tipHost(e.target);
  if (t && t.hasAttribute('title')) tipShow(t, false);
}, true);
D.addEventListener('mouseout', function (e) {
  if (!TIP.target) return;
  if (e.relatedTarget && TIP.target.contains(e.relatedTarget)) return;
  tipHide();
}, true);
D.addEventListener('focusin', function (e) {
  var t = tipHost(e.target); if (!t || !t.hasAttribute('title') || POP || DOPEN) return;
  var vis = true; try { vis = e.target.matches(':focus-visible'); } catch (x) { /* older engines */ }
  if (vis) tipShow(t, true);
}, true);
D.addEventListener('focusout', tipHide, true);
D.addEventListener('mousedown', tipHide, true);
D.addEventListener('keydown', function (e) { if (e.key === 'Escape') tipHide(); }, true);
global.addEventListener('scroll', tipHide, true);

/* ═════════════════════════════════════════════════════════════════════════
   6 · PHONE CHROME — the browser's own address bar follows light / dark
   ═════════════════════════════════════════════════════════════════════════ */
var CHROME = { light: '#FFFFFF', dark: '#141220' };
var chromeMeta = [];        /* [{meta, original}] for this document and (same-origin) the launcher around it */
function metaIn(doc) {
  try {
    var m = doc.querySelector('meta[name="theme-color"]');
    if (!m) { m = doc.createElement('meta'); m.setAttribute('name', 'theme-color'); (doc.head || doc.documentElement).appendChild(m); m.__fcMade = true; }
    return m;
  } catch (e) { return null; }
}
function syncChrome() {
  var dark = D.documentElement.getAttribute('data-theme') === 'dark';
  var color = dark ? CHROME.dark : CHROME.light;
  if (!chromeMeta.length) {
    [D].concat((function () { try { return global.parent && global.parent !== global && global.parent.document ? [global.parent.document] : []; } catch (e) { return []; } })())
      .forEach(function (doc) {
        var m = metaIn(doc);
        if (m) chromeMeta.push({ meta: m, original: m.__fcMade ? null : m.getAttribute('content') });
      });
  }
  chromeMeta.forEach(function (c) { c.meta.setAttribute('content', color); });
}
try {
  syncChrome();
  if (global.MutationObserver) new global.MutationObserver(syncChrome).observe(D.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  global.addEventListener('pagehide', function () {
    chromeMeta.forEach(function (c) { if (c.original) c.meta.setAttribute('content', c.original); });
  });
} catch (e) { /* cosmetic only */ }

/* ── public surface (also what the tests drive) ───────────────────────────── */
UI.openSelect = openSelect;
UI.openDate = openDate;
UI.close = function () { closePop(true); };
UI.isOpen = function () { return !!POP; };
UI.dialogOpen = function () { return !!DOPEN; };
UI.searchThreshold = SEARCH_MIN;

})(typeof window !== 'undefined' ? window : globalThis);
