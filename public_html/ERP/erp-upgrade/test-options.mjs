/* Every option editable — the settings catalogue, the dropdown lists,
   custom fields, and the owner-only rule. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(store) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://x.local/e',
    beforeParse(win) {
      win.indexedDB = store.idb || (store.idb = new FDBFactory());
      win.IDBKeyRange = FDBKeyRange;
      win.print = () => {}; win.confirm = () => true; win.alert = () => {};
      win.scrollTo = () => {}; win.open = () => null;
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

async function main() {
  const store = {};
  let win = boot(store);
  for (let i = 0; i < 400 && !(win.ERP && win.ERP.ready); i++) await sleep(25);
  await sleep(300);
  let ERP = win.ERP;
  const D = win.document;
  const $ = s => D.querySelector(s);
  const $$ = s => [...D.querySelectorAll(s)];
  const click = el => el && el.dispatchEvent(new win.Event('click', { bubbles: true }));

  check('O0 the app boots with the options module', !!(ERP && ERP.OptionsModule));

  /* ── the catalogue covers what used to be code-only ─────────────────── */
  const cat = ERP.OptionsModule.catalog;
  const keys = Object.values(cat).flat().filter(i => i.k).map(i => i.k);
  check('O1 the catalogue exposes a substantial set of settings',
    keys.length >= 40, String(keys.length));
  const defaults = ERP.Settings.defaults();
  const wasCodeOnly = ['taxEnabled', 'defaultTaxRate', 'currency', 'receiptPrefix',
    'orderPrefix', 'dispatchPrefix', 'invoiceFooter', 'terms', 'bankDetails',
    'preparedByLabel', 'receivedByLabel', 'taglineUr', 'slogan', 'ntn',
    'registrationNo', 'smsProvider', 'whatsappProvider', 'legalName', 'website'];
  const missing = wasCodeOnly.filter(k => !keys.includes(k));
  check('O2 every previously code-only setting now has a field',
    missing.length === 0, missing.join(','));

  /* ── settings screen renders them ───────────────────────────────────── */
  win.go('settings'); await sleep(300);
  check('O3 the settings screen opens for the owner', !!$('[data-stsection]'));
  check('O4 the extra cards are injected', !!$('[data-stextra]'));
  const ctl = k => (k === 'logoDataUrl' ? $('#stBody [data-stlogo]')
    : $(`#stBody [data-stfield="${k}"],#stBody [data-fcset="${k}"],#stBody [data-sttoggle="${k}"],#stBody [data-fcprofit="${k}"]`));
  const generalKeys = cat.general.filter(i => i.k).map(i => i.k);
  const uncovered = generalKeys.filter(k => !ctl(k));
  check('O5 every General setting has exactly one control on screen',
    uncovered.length === 0, uncovered.join(','));
  check('O6 Urdu settings are marked right-to-left',
    ctl('taglineUr').getAttribute('dir') === 'rtl');
  check('O7 multi-line settings use a textarea',
    ctl('address').tagName === 'TEXTAREA');
  check('O8 the tax setting has a control (the older card owns it)', !!ctl('taxEnabled'));
  check('O8c the logo can be uploaded', !!ctl('logoDataUrl'));
  const allKeys = $$('#stBody [data-stfield],#stBody [data-fcset]')
    .map(e => e.dataset.stfield || e.dataset.fcset);
  const dupes = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
  check('O8b no setting is rendered twice', dupes.length === 0, dupes.join(','));

  /* ── a change actually saves ────────────────────────────────────────── */
  const curEl = ctl('currency');
  curEl.value = 'PKR ';
  curEl.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(300);
  check('O9 editing a catalogue field saves on change',
    String(ERP.Settings.get().currency).trim() === 'PKR',
    JSON.stringify(ERP.Settings.get().currency));
  /* the older Business profile card collects its fields behind a Save button
     rather than saving per keystroke — check the value round-trips there */
  await ERP.Settings.save({ businessName: 'Farooq & Co Traders (Dir)' });
  win.go('settings'); await sleep(250);
  check('O9b the older card shows the saved value, ampersand intact',
    ctl('businessName').value === 'Farooq & Co Traders (Dir)',
    ctl('businessName').value);

  /* a setting this module owns, rendered as a switch */
  ERP.SettingsUI.section = 'invoice'; win.go('settings'); await sleep(300);
  const sw = $('#stBody [data-sttoggle="waEnabled"]');
  check('O10 the catalogue renders switches', !!sw);
  const wasOn = !!ERP.Settings.get().waEnabled;
  click(sw); await sleep(300);
  check('O10b a switch flips and saves',
    !!ERP.Settings.get().waEnabled === !wasOn, String(ERP.Settings.get().waEnabled));
  ERP.SettingsUI.section = 'general'; win.go('settings'); await sleep(250);

  /* ── document wording flows into the documents ──────────────────────── */
  await ERP.Settings.save({ invoiceFooter: 'Shukriya — please check every bag.' });
  await ERP.Settings.save({ allowNegativeStock: true });
  let anyInv = ERP.Invoices.all().find(i => i.status !== 'DRAFT');
  if (!anyInv) {
    anyInv = await ERP.Invoices.save({
      customerId: win.CUSTOMERS[0].id, warehouseId: win.WAREHOUSES[0].id,
      invoiceDate: '2026-09-11', paidAmount: 0,
      items: [{ productId: win.PRODUCTS[0].id, quantity: 2, unitPrice: 1900,
                discount: 0, warehouseId: win.WAREHOUSES[0].id }]
    });
  }
  if (anyInv) {
    const m = ERP.DocModel.invoice(anyInv.id);
    check('O11 the edited invoice footer reaches the invoice document',
      m.footer && m.footer.thanks === 'Shukriya — please check every bag.',
      m.footer && m.footer.thanks);
    check('O11b and is printed on it', ERP.Paper.html(m).includes('Shukriya'));
  } else check('O11 an invoice was available', false);

  /* ── the WhatsApp closing line is editable ──────────────────────────── */
  await ERP.Settings.save({ waThanks: 'Shukriya from {business}.' });
  if (anyInv) {
    const t = ERP.Wa.invoiceText(ERP.Invoices.byId(anyInv.id));
    check('O12 the WhatsApp closing line follows the setting', t.includes('Shukriya from'));
    check('O13 {business} is substituted, not printed literally', !t.includes('{business}'));
  } else { check('O12 an invoice was available', false); check('O13', false); }

  /* ── dropdown lists ─────────────────────────────────────────────────── */
  const before = ERP.Options.list('paymentMethods').slice();
  await ERP.Lists.add('paymentMethods', 'Raast');
  check('O14 a new payment method is added',
    ERP.Options.list('paymentMethods').includes('Raast'));
  check('O15 ERP.ENUM.methods follows the editable list',
    ERP.ENUM.methods.includes('Raast'), ERP.ENUM.methods.join(','));

  const payForm = win.PANELS.payment.f();
  check('O16 the new method appears in the Receive payment form',
    /Raast/.test(payForm));
  check('O16b and in the Pay supplier form', /Raast/.test(win.PANELS.paysup.f()));
  check('O16c and the return form follows its own list',
    /Damaged product/.test(win.PANELS.creditnote.f()));

  await ERP.Lists.remove('paymentMethods', 'Raast');
  check('O17 removing it takes it back out',
    !ERP.Options.list('paymentMethods').includes('Raast'));
  check('O18 the original methods are untouched',
    before.every(m => ERP.Options.list('paymentMethods').includes(m)));

  /* an emptied list must not leave a dropdown with nothing in it */
  await ERP.Settings.save({ returnReasons: [] });
  check('O19 an emptied list falls back to its defaults',
    ERP.Options.list('returnReasons').length > 0,
    String(ERP.Options.list('returnReasons').length));

  await ERP.Lists.add('adjustmentReasons', 'Bardana adjustment');
  check('O20 adjustment reasons are editable',
    ERP.Adjustments.reasons.includes('Bardana adjustment'));

  /* ── custom fields on master data ───────────────────────────────────── */
  for (const ent of ['product', 'customer', 'supplier']) {
    await ERP.Fields.add(ent, { label: 'Broker code', type: 'text' });
    const has = ERP.Fields.of(ent).some(f => f.l === 'Broker code');
    check(`O21 a custom field can be added to ${ent}`, has);
  }
  const dup = await ERP.Fields.add('product', { label: 'Broker code' }).then(() => false, () => true);
  check('O22 a duplicate custom field is refused', dup);
  await ERP.Fields.remove('product', ERP.Fields.all('product')[0].k);
  check('O23 a custom field can be removed',
    !ERP.Fields.of('product').some(f => f.l === 'Broker code'));

  /* ── owner only ─────────────────────────────────────────────────────── */
  let owner = ERP.Users.all().find(u => u.role === 'OWNER');
  if (!owner) owner = await ERP.Users.save({ name: 'Owner', role: 'OWNER', pin: '' });
  let staff = ERP.Users.all().find(u => u.role !== 'OWNER');
  if (!staff) staff = await ERP.Users.save({ name: 'Counter', role: 'INVENTORY', pin: '' });

  await ERP.Session.signIn(staff.id, '');
  win.go('settings'); await sleep(250);
  check('O24 staff cannot open settings', /not open to you/i.test($('#view').textContent));

  const blocked = await ERP.Settings.save({ businessName: 'Hacked' })
    .then(() => false, () => true);
  check('O25 staff cannot save a setting even directly', blocked);
  check('O26 the value is unchanged',
    ERP.Settings.get().businessName !== 'Hacked', ERP.Settings.get().businessName);

  await ERP.Session.signIn(owner.id, '');
  win.go('settings'); await sleep(250);
  check('O27 the owner can still open settings', !!$('[data-stsection]'));
  const okAgain = await ERP.Settings.save({ city: 'Dir Bala, KP' }).then(() => true, () => false);
  check('O28 and can still save', okAgain);

  /* ── statement headings follow their settings ───────────────────────── */
  await ERP.Settings.save({ stmtDescriptionLabel: 'Tafseel / تفصیل' });
  win.go('khata', win.CUSTOMERS[0].id); await sleep(400);
  const heads = $$('table.kh-table thead th').map(t => t.textContent.trim());
  check('O33 the statement heading follows the setting',
    heads.includes('Tafseel / تفصیل'), heads.join(' | '));

  /* ── settings survive a restart ─────────────────────────────────────── */
  await ERP.flush(); await sleep(400);
  const expect = {
    name: ERP.Settings.get().businessName,
    footer: ERP.Settings.get().invoiceFooter,
    tax: ERP.Settings.get().taxEnabled,
    reasons: ERP.Options.list('adjustmentReasons').length
  };
  win.close();
  win = boot(store);
  for (let i = 0; i < 400 && !(win.ERP && win.ERP.ready); i++) await sleep(25);
  await (win.ERP.adjustmentsReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  ERP = win.ERP;
  check('O29 an edited setting survives a restart',
    ERP.Settings.get().businessName === expect.name, ERP.Settings.get().businessName);
  check('O30 edited document wording survives',
    ERP.Settings.get().invoiceFooter === expect.footer);
  check('O31 a toggle survives', ERP.Settings.get().taxEnabled === expect.tax);
  check('O32 an edited list survives',
    ERP.Options.list('adjustmentReasons').length === expect.reasons);
  win.close();

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
