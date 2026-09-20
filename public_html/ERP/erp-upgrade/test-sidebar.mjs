/* The sidebar collapse/expand button (the one left of the page title).
   Bug reported 2026-09-20: "the bar opening/closing button isn't working". Cause: at a window
   width <= 1200px the base app's own CSS forces the sidebar to the narrow icon rail, and its
   collapse handler only sets the SAME 68px there — so the button visibly did nothing and the
   labels could never come back. 10-mobile.js now makes the button EXPAND/collapse the rail
   between 901 and 1200px (body.fc-wide), leaves the base behaviour alone above 1200px, and
   hides the (useless) button at <= 900px where the hamburger owns the drawer.
   jsdom does not run layout, so this proves the handler/state/CSS-text; the pixels are checked
   in a real browser after each deploy. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
import { webcrypto } from 'crypto';

const HTML = fs.readFileSync('dist/farooq-co-erp.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };
const errors = [];

function boot(width, ls) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const idb = new FDBFactory();
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://erp.farooqandcotraders.online/e',
    beforeParse(w) {
      w.indexedDB = idb; w.IDBKeyRange = FDBKeyRange; w.print = () => {}; w.confirm = () => true; w.prompt = () => 'r'; w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true, writable: true });
      w.matchMedia = q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.crypto.subtle = webcrypto.subtle; if (!w.crypto.getRandomValues) w.crypto.getRandomValues = a => webcrypto.getRandomValues(a);
      w.fetch = async () => ({ status: 401, json: async () => ({}) });
      Object.defineProperty(w, 'localStorage', { configurable: true, value: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } } });
    } });
  return dom.window;
}
async function ready(w) { for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25); await sleep(400); }
const label = w => w.document.getElementById('mini').getAttribute('aria-label');

async function main() {
  /* ── wide desktop (> 1200px): the base behaviour, untouched ── */
  {
    const w = boot(1400, {}); await ready(w); const b = w.document.body, mini = w.document.getElementById('mini');
    check('S1 wide: starts expanded, labelled "Collapse sidebar"', !b.classList.contains('mini') && label(w) === 'Collapse sidebar');
    mini.click(); await sleep(30);
    check('S1b wide: the button collapses the rail exactly as before (body.mini) and never touches fc-wide',
      b.classList.contains('mini') && !b.classList.contains('fc-wide'));
    check('S1c wide: the label follows ("Expand sidebar")', label(w) === 'Expand sidebar');
    mini.click(); await sleep(30);
    check('S1d wide: and back again', !b.classList.contains('mini') && label(w) === 'Collapse sidebar');
    w.close();
  }

  /* ── narrow desktop (901–1200px): the reported bug ── */
  {
    const ls = {}; const w = boot(1100, ls); await ready(w); const b = w.document.body, mini = w.document.getElementById('mini');
    check('S2 narrow: starts as the icon rail, so the label offers to EXPAND', !b.classList.contains('fc-wide') && label(w) === 'Expand sidebar');
    mini.click(); await sleep(30);
    check('S2b narrow: clicking EXPANDS the rail (body.fc-wide)', b.classList.contains('fc-wide'));
    check('S2c …and the base handler did NOT also run (body.mini stays off — it would have cancelled the effect)', !b.classList.contains('mini'));
    check('S2d …the label now offers to collapse', label(w) === 'Collapse sidebar');
    mini.click(); await sleep(30);
    check('S2e clicking again collapses it', !b.classList.contains('fc-wide') && !b.classList.contains('mini') && label(w) === 'Expand sidebar');
    w.document.getElementById('mini').querySelector('svg').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await sleep(30);
    check('S2f a click on the icon inside the button counts too', b.classList.contains('fc-wide'));
    check('S2g the choice is remembered', ls.farooqco_rail_wide === '1');
    w.close();

    const w2 = boot(1100, ls); await ready(w2);
    check('S3 reopening at the same width restores the expanded sidebar', w2.document.body.classList.contains('fc-wide') && label(w2) === 'Collapse sidebar');
    w2.document.getElementById('mini').click(); await sleep(30);
    check('S3b collapsing it is remembered too', ls.farooqco_rail_wide === '0' && !w2.document.body.classList.contains('fc-wide'));
    w2.close();

    ls.farooqco_rail_wide = '1';
    const w3 = boot(1400, ls); await ready(w3); const b3 = w3.document.body;
    w3.document.getElementById('mini').click(); await sleep(30);
    check('S4 a remembered "expanded" from a narrow window does not disturb a wide one (base toggle still works)',
      b3.classList.contains('mini') && label(w3) === 'Expand sidebar');
    w3.close();
  }

  /* ── phone / small tablet (<= 900px): the hamburger owns the drawer ── */
  {
    const w = boot(800, {}); await ready(w); const b = w.document.body;
    w.document.getElementById('hamb').click(); await sleep(30);
    check('S5 <=900px: the hamburger still opens the drawer', b.classList.contains('drawer'));
    w.document.getElementById('mini').click(); await sleep(30);
    check('S5b <=900px: the (hidden) collapse button does not set fc-wide or throw', !b.classList.contains('fc-wide'));
    w.close();
  }
  {
    const w = boot(1100, {}); await ready(w);
    w.document.getElementById('hamb').click(); await sleep(30);
    check('S6 my handler swallows ONLY the collapse button: other clicks (the hamburger) still reach the app', w.document.body.classList.contains('drawer'));
    w.close();
  }

  /* ── the stylesheet ── */
  {
    const w = boot(1100, {}); await ready(w);
    const css = [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    check('S7 the CSS expands the rail only inside 901–1200px and restores labels',
      /@media \(max-width:1200px\) and \(min-width:901px\)\{[\s\S]*body\.fc-wide\{--rail:238px\}[\s\S]*body\.fc-wide \.nav span\.lbl[\s\S]*display:block/.test(css));
    check('S7b the useless collapse button is hidden at <=900px', /@media \(max-width:900px\)\{#mini\{display:none\}\}/.test(css));
    w.close();
  }

  check('Z1 nothing threw', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
