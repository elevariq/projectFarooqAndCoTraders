/* ══════════════════════════════════════════════════════════════════════════
   EVERY OPTION EDITABLE (§ client request)

   The ERP already had a good Settings shell, a generic save handler and a
   chip-style list editor. What it did not have was coverage: 58 business
   settings existed in the data model but only 9 had a field, and six option
   lists were written into the forms as literal arrays, so changing a payment
   method or a return reason meant editing code.

   This module closes that gap. It adds no new storage mechanism — every value
   below is an ordinary key on the existing `business` settings record, saved
   through `ERP.Settings.save()` and audited by the handlers already in place.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var D = global.document;
  var Lists = ERP.Lists;
  if (!Lists || !ERP.Settings) return;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isOwner() {
    try { return (ERP.Session && ERP.Session.role ? ERP.Session.role() : 'OWNER') === 'OWNER'; }
    catch (e) { return true; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     1 — THE OPTION LISTS
     Lists that used to be literal arrays inside the forms. Each keeps its
     original contents as the default, so nothing changes until the owner
     edits it, and an emptied list falls back to the default rather than
     leaving a dropdown with nothing in it.
     ════════════════════════════════════════════════════════════════════════ */
  var EXTRA_DEFAULTS = {
    returnReasons:     ['Damaged product', 'Defective stock', 'Wrong product',
                        'Excess supplied', 'Unsold stock', 'Other approved return'],
    adjustmentReasons: ['Opening balance correction', 'Discount allowed', 'Rounding',
                        'Bad debt written off', 'Cheque returned', 'Additional charges',
                        'Freight recovered', 'Other correction'],
    packages:          ['Bag', 'KG', 'Ton', 'Piece', 'Carton'],
    salespersons:      []
  };
  Object.keys(EXTRA_DEFAULTS).forEach(function (k) {
    if (!Lists.defaults[k]) Lists.defaults[k] = EXTRA_DEFAULTS[k];
  });

  var Options = ERP.Options = {
    /* never returns an empty list: an emptied setting falls back to the
       default so a form can never render a dropdown with no choices */
    list: function (name) {
      var l = Lists.get(name);
      if (l && l.length) return l;
      return Lists.defaults[name] || [];
    },
    options: function (name, selected) {
      return Options.list(name).map(function (v) {
        return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    }
  };

  /* Payment methods were read from ERP.ENUM.methods in four places. Making it
     a live getter means every one of them now follows the editable list
     without touching the call sites, and anything that still reads ENUM
     directly keeps working. */
  try {
    var enumOwn = ERP.ENUM;
    Object.defineProperty(enumOwn, 'methods', {
      configurable: true,
      enumerable: true,
      get: function () { return Options.list('paymentMethods'); }
    });
  } catch (e) {}

  /* Adjustment reasons, same idea. */
  try {
    if (ERP.Adjustments) {
      Object.defineProperty(ERP.Adjustments, 'reasons', {
        configurable: true,
        enumerable: true,
        get: function () { return Options.list('adjustmentReasons'); }
      });
    }
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     2 — THE SETTINGS CATALOGUE
     Every remaining key, grouped under the section it belongs to. `t` is the
     control: text, area (multi-line), urdu (RTL), num, dec, toggle, or a list
     of choices.
     ════════════════════════════════════════════════════════════════════════ */
  var CATALOG = {
    general: [
      { h: 'Business identity' },
      { k: 'businessName', l: 'Business name', wide: true },
      { k: 'legalName',    l: 'Registered legal name', n: 'Used on formal paperwork when it differs from the trading name' },
      { k: 'proprietor',   l: 'Proprietor' },
      { k: 'tagline',      l: 'Tagline (English)', wide: true },
      { k: 'taglineUr',    l: 'Tagline (Urdu)', t: 'urdu', wide: true },
      { k: 'slogan',       l: 'Slogan (Urdu)', t: 'urdu', wide: true },
      { k: 'logoText',     l: 'Logo initials', n: 'Shown when no logo image is set' },
      { k: 'logoDataUrl',  l: 'Logo image', t: 'image',
        n: 'Printed on invoices, receipts and statements in place of the initials' },

      { h: 'Contact' },
      { k: 'address',   l: 'Address', t: 'area', wide: true },
      { k: 'city',      l: 'City / district' },
      { k: 'phone',     l: 'Phone' },
      { k: 'shopPhone', l: 'Shop phone' },
      { k: 'whatsapp',  l: 'WhatsApp number', n: 'Printed on documents. Each shop has its own number for sending.' },
      { k: 'email',     l: 'Email' },
      { k: 'website',   l: 'Website' },

      { h: 'Registration' },
      { k: 'ntn',            l: 'NTN' },
      { k: 'registrationNo', l: 'Registration number' },

      { h: 'Currency and tax' },
      { k: 'currency',       l: 'Currency code', n: 'PKR. Changing this does not convert existing figures.' },
      { k: 'currencyLabel',  l: 'Currency shown on documents' },
      { k: 'taxEnabled',     l: 'Charge tax on invoices', t: 'toggle' },
      { k: 'defaultTaxRate', l: 'Default tax rate (%)', t: 'dec' }
    ],

    invoice: [
      { h: 'Numbering' },
      { k: 'invoicePrefix',  l: 'Invoice prefix' },
      { k: 'purchasePrefix', l: 'Purchase prefix' },
      { k: 'receiptPrefix',  l: 'Receipt prefix' },
      { k: 'orderPrefix',    l: 'Sales order prefix' },
      { k: 'dispatchPrefix', l: 'Dispatch prefix' },

      { h: 'Wording on printed documents' },
      { k: 'invoiceFooter',     l: 'Invoice footer', t: 'area', wide: true },
      { k: 'terms',             l: 'Terms and conditions', t: 'area', wide: true },
      { k: 'bankDetails',       l: 'Bank details', t: 'area', wide: true,
        n: 'Printed on the invoice so shops can transfer directly' },
      { k: 'preparedByLabel',   l: 'Label for the preparer signature' },
      { k: 'receivedByLabel',   l: 'Label for the receiver signature' },

      { h: 'Statement wording' },
      { k: 'stmtDescriptionLabel', l: 'Description column heading',
        d: 'Description / تفصیل', n: 'Appears on the customer and supplier statement' },
      { k: 'stmtDebitLabel',   l: 'Debit column heading',   d: 'Debit / بنام' },
      { k: 'stmtCreditLabel',  l: 'Credit column heading',  d: 'Credit / جمع' },
      { k: 'stmtBalanceLabel', l: 'Balance column heading', d: 'Balance / بقایا' },
      { k: 'stmtQtyLabel',     l: 'Quantity column heading', d: 'Qty' },
      { k: 'stmtRefLabel',     l: 'Reference column heading', d: 'Folio / Reference #' },

      { h: 'WhatsApp message' },
      { k: 'waThanks', l: 'Closing line', t: 'area', wide: true,
        d: 'Thank you for doing business with {business}. 🙏',
        n: 'Use {business} for the business name' },
      { k: 'waEnabled', l: 'Show the Send on WhatsApp button', t: 'toggle', d: true }
    ],

    sales: [
      { h: 'Credit and terms' },
      { k: 'defaultDueDays', l: 'Days until an invoice is due', t: 'num' },
      { h: 'Amount Paid' },
      { k: 'allowOverpay', l: 'Allow paying more than the invoice total', t: 'toggle',
        n: 'Off refuses an overpayment and asks for it to be recorded as a payment on account' }
    ],

    system: [
      { h: 'Behaviour' },
      { k: 'invoiceExportFlow', l: 'After saving an invoice', t: 'choice',
        c: [['ask', 'Ask each time'], ['edit', 'Open the editor'], ['direct', 'Go straight to the document']],
        d: 'ask' },
      { k: 'requirePinOnSwitch', l: 'Ask for a PIN when switching user', t: 'toggle', d: true }
    ],

    notify: [
      { k: 'smsProvider',      l: 'SMS provider' },
      { k: 'smsSenderId',      l: 'SMS sender ID' },
      { k: 'whatsappProvider', l: 'WhatsApp provider' }
    ]
  };

  /* ════════════════════════════════════════════════════════════════════════
     3 — RENDERING
     Cards are appended into the open section after each paint. They reuse the
     data-stfield / data-sttoggle / data-stlist* attributes the Settings module
     already listens for, so saving and auditing needed no new code.
     ════════════════════════════════════════════════════════════════════════ */
  function value(item) {
    var v = ERP.Settings.get()[item.k];
    if (v === undefined || v === null || v === '') return item.d !== undefined ? item.d : '';
    return v;
  }

  function control(item) {
    var v = value(item);
    var cls = 'f' + (item.wide ? ' wide' : '');
    if (item.t === 'toggle') {
      var on = !!v;
      return '<div class="st-row"><div><b>' + esc(item.l) + '</b>' +
        (item.n ? '<span class="hint">' + esc(item.n) + '</span>' : '') + '</div>' +
        '<button class="st-sw' + (on ? ' on' : '') + '" data-sttoggle="' + item.k + '" ' +
        'role="switch" aria-checked="' + on + '"><i></i></button></div>';
    }
    if (item.t === 'choice') {
      return '<label class="' + cls + '"><span>' + esc(item.l) + '</span>' +
        '<select data-stfield="' + item.k + '">' + item.c.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(v) === o[0] ? ' selected' : '') +
            '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>' +
        (item.n ? '<span class="hint">' + esc(item.n) + '</span>' : '') + '</label>';
    }
    if (item.t === 'image') {
      return '<div class="f wide st-logo"><span>' + esc(item.l) + '</span>' +
        (v ? '<img src="' + esc(v) + '" alt="Current logo">' : '<span class="hint">No image set.</span>') +
        '<div class="st-add"><input type="file" accept="image/*" data-stlogo>' +
        (v ? '<button class="btn" data-stlogoclear>Remove</button>' : '') + '</div>' +
        (item.n ? '<span class="hint">' + esc(item.n) + '</span>' : '') + '</div>';
    }
    if (item.t === 'area') {
      return '<label class="' + cls + '"><span>' + esc(item.l) + '</span>' +
        '<textarea data-stfield="' + item.k + '" rows="2">' + esc(v) + '</textarea>' +
        (item.n ? '<span class="hint">' + esc(item.n) + '</span>' : '') + '</label>';
    }
    var extra = item.t === 'num' ? ' inputmode="numeric"'
              : item.t === 'dec' ? ' inputmode="decimal"'
              : item.t === 'urdu' ? ' dir="rtl" lang="ur"' : '';
    return '<label class="' + cls + '"><span>' + esc(item.l) + '</span>' +
      '<input data-stfield="' + item.k + '"' + extra + ' value="' + esc(v) + '">' +
      (item.n ? '<span class="hint">' + esc(item.n) + '</span>' : '') + '</label>';
  }

  /* Some of these keys already have a control on the page — the older
     "Business profile" card covers 25 of them. Rendering a second input for
     the same key would give the owner two boxes that disagree, so anything
     already on screen is skipped and the existing field is left to do its
     job. */
  function alreadyOnPage(key) {
    try {
      return !!D.querySelector('#stBody [data-fcset="' + key + '"], ' +
                               '#stBody [data-stfield="' + key + '"], ' +
                               '#stBody [data-sttoggle="' + key + '"]');
    } catch (e) { return false; }
  }

  function catalogCard(sectionId) {
    var items = (CATALOG[sectionId] || []).filter(function (it) {
      return it.h || !alreadyOnPage(it.k);
    });
    /* drop a heading left with nothing under it */
    items = items.filter(function (it, i) {
      if (!it.h) return true;
      var next = items[i + 1];
      return next && !next.h;
    });
    if (!items.length || !items.some(function (it) { return it.k; })) return '';
    var out = '', open = false;
    items.forEach(function (it) {
      if (it.h) {
        if (open) out += '</div>';
        out += '<h4 class="st-h">' + esc(it.h) + '</h4><div class="st-grid">';
        open = true;
        return;
      }
      if (!open) { out += '<div class="st-grid">'; open = true; }
      out += control(it);
    });
    if (open) out += '</div>';
    return '<div class="card" data-stextra><div class="card-h"><h3>' +
      (sectionId === 'general' ? 'Business profile' :
       sectionId === 'invoice' ? 'Documents and wording' :
       sectionId === 'sales'   ? 'Sales rules' : 'Providers') +
      '</h3></div><div class="card-b">' + out + '</div></div>';
  }

  /* chip editor, matching the one already in Settings */
  function listCard(sectionId) {
    var sets = {
      general:   [['paymentMethods', 'Payment methods', 'Offered wherever money is taken or paid']],
      inventory: [['packages', 'Package types', 'Bag, KG, Ton and anything else you sell by']],
      sales:     [['returnReasons', 'Customer return reasons', ''],
                  ['adjustmentReasons', 'Account adjustment reasons', '']],
      purchase:  [['expenseCategories', 'Expense categories', '']]
    }[sectionId];
    if (!sets) return '';
    var body = sets.map(function (s) {
      var name = s[0], list = Options.list(name);
      return '<div class="fce-sec"><h4>' + esc(s[1]) + '</h4>' +
        (s[2] ? '<p class="hint" style="margin:0 0 6px">' + esc(s[2]) + '</p>' : '') +
        '<div class="st-chips">' + (list.length ? list.map(function (x) {
          return '<span class="st-chip">' + esc(x) + '<button data-stlistdel="' + name +
            '" data-value="' + esc(x) + '" title="Remove">✕</button></span>';
        }).join('') : '<span class="hint">Nothing yet.</span>') + '</div>' +
        '<div class="st-add"><input data-stlistadd="' + name + '" placeholder="Add…">' +
        '<button class="btn" data-stlistgo="' + name + '">Add</button></div></div>';
    }).join('');
    return '<div class="card" data-stextra><div class="card-h"><h3>Choices in the dropdowns</h3></div>' +
      '<div class="card-b">' + body + '</div></div>';
  }

  var CSS =
    '.st-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:6px}' +
    '.st-grid .f.wide{grid-column:1/-1}' +
    '.st-h{margin:16px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;opacity:.65}' +
    '.st-h:first-child{margin-top:0}' +
    '.st-row{display:flex;align-items:center;justify-content:space-between;gap:14px;' +
    'padding:9px 0;border-bottom:1px solid var(--line-2);grid-column:1/-1}' +
    '.st-row .hint{display:block}' +
    '[dir="rtl"][data-stfield]{text-align:right}' +
    '.st-logo img{max-height:64px;max-width:200px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--surface);margin:6px 0}' +
    '.st-logo .st-add{align-items:center}' +
    '@media(max-width:760px){.st-grid{grid-template-columns:1fr}}';
  try {
    var st = D.createElement('style');
    st.setAttribute('data-fc', 'options');
    st.textContent = CSS;
    D.head.appendChild(st);
  } catch (e) {}

  /* The older Business profile card renders Urdu settings as plain inputs.
     Rather than duplicate those fields just to add a direction, the existing
     control is upgraded in place. */
  var URDU_KEYS = ['taglineUr', 'slogan', 'stmtDescriptionLabel', 'stmtDebitLabel',
                   'stmtCreditLabel', 'stmtBalanceLabel'];
  function markUrdu() {
    try {
      URDU_KEYS.forEach(function (k) {
        var el = D.querySelector('#stBody [data-fcset="' + k + '"], #stBody [data-stfield="' + k + '"]');
        if (el && el.getAttribute('dir') !== 'rtl') {
          el.setAttribute('dir', 'rtl');
          el.setAttribute('lang', 'ur');
        }
      });
    } catch (e) {}
  }

  function inject() {
    if (global.cur !== 'settings') return;
    var host = D.getElementById('stBody');
    if (!host || host.querySelector('[data-stextra]')) return;
    var section = (ERP.SettingsUI && ERP.SettingsUI.section) || 'general';
    var html = catalogCard(section) + listCard(section);
    if (html) host.insertAdjacentHTML('beforeend', html);
  }

  var origPaint = global.paint;
  global.paint = function () {
    var r = origPaint.apply(this, arguments);
    try { inject(); } catch (e) {}
    try { applyHeadings(); } catch (e) {}
    try { markUrdu(); } catch (e) {}
    return r;
  };

  /* ════════════════════════════════════════════════════════════════════════
     4 — OWNER ONLY
     The Settings screen previously opened for the owner, a manager and an
     accountant. The business asked for settings to be the owner's alone.
     ════════════════════════════════════════════════════════════════════════ */
  var origSettingsPage = global.PAGES.settings;
  global.PAGES.settings = function () {
    if (!isOwner()) {
      return '<div class="empty"><div class="ei"></div><b>Settings are not open to you</b>' +
        '<p>Only the owner can change how the ERP works. Ask the owner if something needs changing.</p></div>';
    }
    return origSettingsPage.apply(this, arguments);
  };

  /* A non-owner must not be able to save even if they reach a control.

     Two keys are exempt. `currentRole` is who is using the ERP right now, not
     a business setting — gating it would make switching role one-way, since a
     warehouse user could never switch back. `lastAutoBackupAt` is bookkeeping
     the backup writes for itself. Neither changes how the business runs. */
  var NOT_CONFIG = ['currentRole', 'lastAutoBackupAt'];
  function isConfigChange(patch) {
    return Object.keys(patch || {}).some(function (k) { return NOT_CONFIG.indexOf(k) === -1; });
  }
  var origSettingsSave = ERP.Settings.save;
  ERP.Settings.save = function (patch) {
    if (isConfigChange(patch) && !isOwner()) {
      global.say && global.say('Only the owner can change settings.');
      return Promise.reject({ validation: ['Only the owner can change settings.'] });
    }
    return origSettingsSave.call(ERP.Settings, patch);
  };

  /* ════════════════════════════════════════════════════════════════════════
     5 — MAKE THE WORDING SETTINGS ACTUALLY TAKE EFFECT
     A setting that saves but changes nothing is worse than no setting at all,
     so each wording key below is read at the point the text is produced. Each
     falls back to the wording that was previously hard-coded.
     ════════════════════════════════════════════════════════════════════════ */
  function text(key, fallback) {
    var v = ERP.Settings.get()[key];
    return (v === undefined || v === null || v === '') ? fallback : v;
  }
  ERP.OptionText = text;

  /* the WhatsApp closing line */
  if (ERP.Wa && ERP.Wa.invoiceText) {
    var origInvoiceText = ERP.Wa.invoiceText;
    ERP.Wa.invoiceText = function (inv) {
      var b = ERP.Settings.get();
      var name = b.businessName || 'Farooq & Co';
      var built = origInvoiceText.call(ERP.Wa, inv);
      var oldTail = 'Thank you for doing business with ' + name + '. 🙏';
      var tail = text('waThanks', oldTail).replace(/\{business\}/g, name);
      return built.replace(oldTail, tail);
    };
  }

  /* statement column headings, on screen and in every export */
  var HEADINGS = [
    ['stmtRefLabel',         'Folio / Reference #'],
    ['stmtDescriptionLabel', 'Description / \u062a\u0641\u0635\u06cc\u0644'],
    ['stmtQtyLabel',         'Qty'],
    ['stmtDebitLabel',       'Debit / \u0628\u0646\u0627\u0645'],
    ['stmtCreditLabel',      'Credit / \u062c\u0645\u0639'],
    ['stmtBalanceLabel',     'Balance / \u0628\u0642\u0627\u06cc\u0627']
  ];
  function applyHeadings(root) {
    try {
      var changed = HEADINGS.filter(function (h) { return text(h[0], h[1]) !== h[1]; });
      if (!changed.length) return;
      var ths = (root || D).querySelectorAll('table.kh-table thead th');
      Array.prototype.forEach.call(ths, function (th) {
        var t = (th.textContent || '').trim();
        changed.forEach(function (h) { if (t === h[1]) th.textContent = text(h[0], h[1]); });
      });
    } catch (e) {}
  }

  /* the logo needs a handler of its own: it is the one setting that is not a
     value typed into a box */
  try {
    D.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || !el.dataset || el.dataset.stlogo === undefined) return;
      var file = el.files && el.files[0];
      if (!file) return;
      if (file.size > 400 * 1024) {
        global.say && global.say('That image is too large — use one under 400 KB.');
        el.value = ''; return;
      }
      var r = new global.FileReader();
      r.onload = function () {
        ERP.Settings.save({ logoDataUrl: String(r.result) }).then(function () {
          global.say && global.say('Logo updated.');
          global.paint();
        }).catch(function () { global.say && global.say('Could not save the logo.'); });
      };
      r.readAsDataURL(file);
    });
    D.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('[data-stlogoclear]')) return;
      e.preventDefault();
      ERP.Settings.save({ logoDataUrl: '' }).then(function () {
        global.say && global.say('Logo removed.');
        global.paint();
      });
    });
  } catch (e) {}

  ERP.OptionsModule = { version: '2026-09-14', catalog: CATALOG, Options: Options };

})(typeof window !== 'undefined' ? window : globalThis);
