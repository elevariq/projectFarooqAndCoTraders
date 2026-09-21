/* UI kit (module 36) — every box wears the theme, wherever it sits.
   jsdom draws no CSS, so this proves the RULE and WHAT IT REACHES: the fallback block is in the office app and
   the Warehouse app, it adds no specificity (so every screen's own field style still wins), it uses only theme
   tokens (dark mode follows), it reaches the boxes that used to show the browser's plain frame (Landed costs
   rows, Payroll month, Collection sheet minimum…) and it leaves checkboxes / radios / files / buttons alone.
   The pixels were checked in a real Chrome: every screen, side panel and both invoice builders, light and
   dark — no control left with a non-theme border. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
import { webcrypto } from 'crypto';

const ERP_HTML = fs.readFileSync('dist/farooq-co-erp.html', 'utf8');
const WH_HTML = fs.readFileSync('dist/farooq-co-warehouse-pwa.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };
const errors = [];

function boot(html) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const idb = new FDBFactory(); const ls = {};
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://erp.farooqandcotraders.online/e',
    beforeParse(w) {
      w.indexedDB = idb; w.IDBKeyRange = FDBKeyRange; w.print = () => {}; w.confirm = () => true; w.prompt = () => 'r'; w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
      w.matchMedia = q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.crypto.subtle = webcrypto.subtle; if (!w.crypto.getRandomValues) w.crypto.getRandomValues = a => webcrypto.getRandomValues(a);
      w.fetch = async () => ({ status: 401, json: async () => ({}) });
      Object.defineProperty(w, 'localStorage', { configurable: true, value: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } } });
    } });
  return dom.window;
}
const cssOf = w => [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
const MARK = 'a box no screen styled is still a themed box';
function block(css) {
  const m = css.indexOf(MARK); if (m < 0) return ''; const a = css.lastIndexOf('/*', m);
  const b = css.indexOf('/* ── date and month fields', a);
  return css.slice(a, b > 0 ? b : a + 4000).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*\n/, '');   /* comments out; the marker line itself is a comment */
}
/* the field selector list inside the first :where( … ) of the block */
function fieldSelector(blk) {
  const a = blk.indexOf(':where(') + 7; let depth = 1, i = a;
  for (; i < blk.length && depth; i++) { if (blk[i] === '(') depth++; else if (blk[i] === ')') depth--; }
  return blk.slice(a, i - 1);
}

async function main() {
  const w = boot(ERP_HTML);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await sleep(400);
  const css = cssOf(w), blk = block(css);

  check('A1 the fallback block is in the office app', blk.length > 500);
  const selectors = blk.split('}').map(r => r.split('{')[0].trim()).filter(x => /input|select|textarea/.test(x) && !x.startsWith('.fld '));   /* the .fld rules are deliberate, class-level overrides */
  check('A2 every field rule is wrapped in :where() — it adds no specificity, so each screen\'s own field style still wins',
    selectors.length >= 5 && selectors.every(x => x.startsWith(':where(')), selectors.filter(x => !x.startsWith(':where(')).join(' ; '));
  check('A3 the field rules give the box a border, corners, background and a focus ring', /border:1px solid var\(--fc-line\)/.test(blk) && /border-radius:8px/.test(blk) && /background-color:var\(--fc-surface\)/.test(blk) && /:focus\{[^}]*var\(--fc-accent\)[^}]*var\(--fc-ring\)/.test(blk));
  check('A4 disabled boxes and placeholders follow the theme too', /:disabled\{[^}]*var\(--fc-surface2\)/.test(blk) && /::placeholder\{color:var\(--fc-faint\)/.test(blk));
  const stripped = blk.replace(/var\([^)]*\)/g, 'V');
  check('A5 no fixed colour in any border of the block (only theme tokens — dark mode follows)', !/border[a-z-]*:[^;}]*(#[0-9a-fA-F]{3,8}|rgba?\()/.test(stripped), (stripped.match(/border[a-z-]*:[^;}]*(#[0-9a-fA-F]{3,8}|rgba?\()[^;}]*/) || [''])[0]);
  check('A6 the on-screen borders the base app wrote as fixed pale colours now come from tokens (hover, banners)',
    /\.fld:hover[^{]*\{border-color:color-mix\(/.test(blk) && /\.banner\.err\{border-color:color-mix\(/.test(blk) && /\.banner\.warn[^{]*\{border-color:color-mix\(/.test(blk) && /\.banner\.info\{border-color:color-mix\(/.test(blk));

  check('A7 a text box inside a filter pill (.fld) is frameless — the pill draws the frame, so there is never a box inside a box — and the pill takes the focus ring',
    /\.fld input\{border:0;background:none/.test(blk) && /\.fld:focus-within\{border-color:var\(--fc-accent\)/.test(blk));

  /* what the rule reaches */
  const sel = fieldSelector(blk);
  const D = w.document;
  const mk = (tag, type) => { const e = D.createElement(tag); if (type) e.setAttribute('type', type); return e; };
  const hit = e => { try { return e.matches(sel); } catch (x) { return null; } };
  check('B1 it reaches text boxes, numbers, dates, months, search and a drop-down',
    ['text', 'number', 'date', 'month', 'search', 'email', 'tel', 'password'].every(t => hit(mk('input', t)) === true) && hit(mk('input')) === true && hit(mk('select')) === true, 'selector could not be evaluated: ' + sel.slice(0, 80));
  check('B2 it leaves checkboxes, radios, files, colours, ranges, buttons and hidden fields alone',
    ['checkbox', 'radio', 'file', 'color', 'range', 'button', 'submit', 'reset', 'image', 'hidden'].every(t => hit(mk('input', t)) === false));
  const multi = mk('select'); multi.setAttribute('multiple', '');
  check('B3 a multi-line list box (select multiple) is left native', hit(multi) === false);

  /* the screens that showed plain frames */
  w.go('landed'); await sleep(500);
  const lcr = [...D.querySelectorAll('#view [data-lcr]')];
  check('B4 Landed costs: every row box (category, description, paid to, status, amount) is reached by the rule', lcr.length >= 5 && lcr.every(e => hit(e) === true), lcr.length + ' boxes');
  const bare = [...D.querySelectorAll('#view input, #view select, #view textarea')].filter(e => !e.closest('label.f') && hit(e) === true);
  check('B5 Landed costs: the search box and the other loose boxes are reached as well', bare.length >= 6, bare.length + '');
  w.go('payroll'); await sleep(400);
  check('B6 Payroll: the month box is reached', [...D.querySelectorAll('#view [data-prmonth]')].every(e => hit(e) === true) && !!D.querySelector('#view [data-prmonth]'));
  w.go('collection'); await sleep(400);
  const cs = D.querySelector('#view [data-csmin]');
  check('B7 Collection sheet: the minimum box is reached', !!cs && hit(cs) === true);
  check('B8 …and that Min balance box really sits inside a filter pill', !!cs && !!cs.closest('label.fld'));
  w.close();

  /* the Warehouse app carries the same rule */
  const ww = boot(WH_HTML); await sleep(1500);
  const wblk = block(cssOf(ww));
  check('C1 the Warehouse app carries the same fallback block', wblk.length > 500 && /border:1px solid var\(--fc-line\)/.test(wblk));
  ww.close();

  check('Z no script errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
