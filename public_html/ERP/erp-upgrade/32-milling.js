/* ══════════════════════════════════════════════════════════════════════════
   MILLING JOBS — TOLL MILLING (wheat out, flour + chokar back)

   Client request, analysed 2026-09-16 (clientNewReq/): Farooq & Co hand
   wheat to a flour mill and get flour bags plus chokar (bran) back, with
   some grain lost in grinding, and settle the difference in the mill's
   own account — currently kept on a paper khata page with four columns:
   تعداد (bags), وزن (weight), ریٹ (rate), رقم (amount). This is a second-hand
   reading of that request (the referenced photo of the paper page was not
   available), confirmed against the ERP's own data rather than guessed:
   25 of 32 suppliers are flour mills, there is a "گندم 49 کلو" (wheat)
   product and two "چوکر" (chokar/bran) products, and a supplier record is
   literally named "Zam Zam chokar khata" carrying a running balance.

     - A "Milling job": pick a mill (an existing supplier), list the wheat
       issued and the flour/bran received back, each line in bags AND
       kilograms (weight auto-fills from the product's existing bag-weight
       field and stays editable for the real weighbridge figure).
     - Process loss (issued weight − received weight) is calculated and
       shown, never enforced — no saved yield recipes or conversion ratios.
       Output heavier than input is refused (grinding cannot create mass);
       a loss outside a rough 1–8% band is flagged, never blocked.
     - The money settles into the mill's own existing supplier khata: wheat
       issued reduces what is owed, flour/chokar received plus a milling
       fee increase it — only the net difference moves the balance. A
       "Grinding fee only" setting is also offered for the case where the
       wheat never changes ownership and only a milling charge is owed.

   Deliberately NOT built here (flagged for the client to specify before
   any of this is attempted): saved yield recipes / expected conversion
   ratios, an in-house (no-mill) production mode, editing a posted job
   (only Cancel, which reverses the stock movements — same as every other
   posted document in this app).

   Its own pair of IndexedDB stores (01-db.js, DB_VER 11) — separate from
   `purchases`/`stockDocs` because this is neither a purchase (the mill
   doesn't sell the wheat back) nor a plain stock adjustment (it settles a
   supplier balance). The financial side reuses the supplier's own khata
   rather than a new ledger store — see the ERP.Ledger.supplier patch
   below, which follows the same pattern 16-khata.js uses for customer
   account adjustments.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var M = global.Money, FDB = global.FDB, D = global.document, S = ERP.S;
  if (!M || !FDB || !S || !global.PAGES || !ERP.Ledger || !ERP.Inventory || !ERP.Settings) return;
  var Inventory = ERP.Inventory, Audit = ERP.Audit;

  S.millingJobs = S.millingJobs || [];
  S.millingJobItems = S.millingJobItems || [];

  (function injectCss() {
    var s = D.createElement('style');
    s.id = 'fc-milling-css';
    s.textContent = '.fc-mill-lines input,.fc-mill-lines select{width:100%}' +
      'table.tbl .sub{font-size:12px;color:var(--muted);margin-top:1px}' +
      'table.tbl td.c,table.tbl th.c{text-align:center}';
    D.head.appendChild(s);
  })();

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function I(n) { return global.icon ? global.icon(n) : ''; }
  function say(m) { try { global.say(m); } catch (e) {} }
  function fmtDate(d) { return global.fmtDate ? global.fmtDate(d) : d; }
  function nowISO() { return new Date().toISOString(); }
  function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
  function pill(cls, label) { return global.pill ? global.pill(cls, label) : esc(label); }
  function whName(id) { return global.whName ? global.whName(id) : id; }
  function prodOf(id) { return (global.prodOf && global.prodOf(id)) || null; }
  function currentUser() { return global.CURRENT_USER || 'Owner'; }
  function can(p) { return ERP.Can ? ERP.Can(p) : true; }
  function qtyFmt(q) { return Number(q).toLocaleString('en-US'); }
  function activeProducts() {
    var list = ERP.sources ? ERP.sources.PRODS() : (global.PRODUCTS || []);
    return list.filter(function (p) { return p.active !== false; });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SERVICE
     ══════════════════════════════════════════════════════════════════════════ */
  var Milling = ERP.Milling = {
    all: function () {
      return (S.millingJobs || []).slice().sort(function (a, b) {
        if (a.jobDate !== b.jobDate) return a.jobDate < b.jobDate ? 1 : -1;
        return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
      });
    },
    byId: function (id) { return (S.millingJobs || []).filter(function (j) { return j.id === id; })[0] || null; },
    items: function (jobId) {
      return (S.millingJobItems || []).filter(function (i) { return i.jobId === jobId; })
        .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    },
    /* only posted jobs move the mill's balance — a cancelled job contributes nothing */
    forMill: function (millId) {
      return (S.millingJobs || []).filter(function (j) { return j.millId === millId && j.status !== 'CANCELLED'; });
    },

    /* live totals for the entry screen — plain rupee arithmetic, nothing
       persisted, so an incomplete draft can still be previewed */
    summary: function (draft) {
      function calcSide(lines) {
        return (lines || []).filter(function (l) { return l && l.productId; }).map(function (l) {
          var qty = Number(l.quantity) || 0, weightKg = Number(l.weightKg) || 0, rate = Number(l.unitRate) || 0;
          var basis = l.rateBasis === 'KG' ? 'KG' : 'BAG';
          var basisQty = basis === 'KG' ? weightKg : qty;
          return { weightKg: weightKg, lineTotal: Math.round(basisQty * rate * 100) / 100 };
        });
      }
      var issue = calcSide(draft.issue), receive = calcSide(draft.receive);
      var inWeightKg = Math.round(issue.reduce(function (a, l) { return a + l.weightKg; }, 0) * 1000) / 1000;
      var outWeightKg = Math.round(receive.reduce(function (a, l) { return a + l.weightKg; }, 0) * 1000) / 1000;
      var lossKg = Math.round((inWeightKg - outWeightKg) * 1000) / 1000;
      var lossPct = inWeightKg > 0 ? Math.round((lossKg / inWeightKg) * 10000) / 100 : 0;
      var issuedValue = Math.round(issue.reduce(function (a, l) { return a + l.lineTotal; }, 0) * 100) / 100;
      var receivedValue = Math.round(receive.reduce(function (a, l) { return a + l.lineTotal; }, 0) * 100) / 100;
      var fee = Number(draft.feeAmount) || 0;
      var settle = draft.settle === 'FEE_ONLY' ? 'FEE_ONLY' : 'NET';
      var net = settle === 'FEE_ONLY' ? fee : (receivedValue + fee - issuedValue);
      return { inWeightKg: inWeightKg, outWeightKg: outWeightKg, lossKg: lossKg, lossPct: lossPct,
        issuedValue: issuedValue, receivedValue: receivedValue, fee: fee, net: net, settle: settle };
    },

    save: function (draft) {
      var mill = draft.millId ? global.supOf(draft.millId) : null;
      var errs = [];
      if (!mill) errs.push('Choose a mill.');
      if (!draft.warehouseId) errs.push('Choose a warehouse.');
      var settle = draft.settle === 'FEE_ONLY' ? 'FEE_ONLY' : 'NET';

      var issueRaw = (draft.issue || []).filter(function (l) { return l && l.productId; });
      var receiveRaw = (draft.receive || []).filter(function (l) { return l && l.productId; });
      if (!issueRaw.length) errs.push('Add at least one line to what was issued.');
      if (!receiveRaw.length) errs.push('Add at least one line to what was received back.');

      function checkLine(l, n, side) {
        var p = prodOf(l.productId);
        var label = side + ' line ' + (n + 1) + (p ? ' (' + (p.en || p.ur) + ')' : '');
        if (!p) { errs.push(label + ': that product no longer exists.'); return null; }
        var qty = M.qty(l.quantity);
        if (!(qty > 0)) { errs.push(label + ': bag count must be more than zero.'); return null; }
        var weightKg = Number(l.weightKg);
        if (!(weightKg > 0)) { errs.push(label + ': weight must be more than zero.'); return null; }
        var rate = M.toP(l.unitRate || 0);
        if (rate < 0) { errs.push(label + ': the rate cannot be negative.'); return null; }
        var basis = l.rateBasis === 'KG' ? 'KG' : 'BAG';
        var basisQty = basis === 'KG' ? weightKg : qty;
        var lineTotal = settle === 'FEE_ONLY' ? 0 : M.mul(rate, basisQty);
        return { productId: l.productId, product: p, quantity: qty, weightKg: weightKg,
          bagKg: p.kg || 0, rateBasis: basis, unitRate: rate, lineTotal: lineTotal };
      }

      var issueClean = [], receiveClean = [];
      issueRaw.forEach(function (l, n) { var c = checkLine(l, n, 'Issued'); if (c) issueClean.push(c); });
      receiveRaw.forEach(function (l, n) { var c = checkLine(l, n, 'Received'); if (c) receiveClean.push(c); });
      if (errs.length) return Promise.reject({ validation: errs });

      /* stock check on the issue side only — same rule as any other
         outgoing movement in the app */
      if (!ERP.Settings.allowNegativeStock()) {
        var demand = {};
        issueClean.forEach(function (l) { demand[l.productId] = (demand[l.productId] || 0) + l.quantity; });
        Object.keys(demand).forEach(function (pid) {
          var have = Inventory.available(pid, draft.warehouseId);
          if (demand[pid] > have) {
            var p = prodOf(pid) || {};
            errs.push('Only ' + have + ' bags of ' + (p.en || p.ur || pid) + ' are available in ' +
              whName(draft.warehouseId) + '. Requested: ' + demand[pid] + '.');
          }
        });
      }
      if (errs.length) return Promise.reject({ validation: errs });

      var inWeightKg = Math.round(issueClean.reduce(function (a, l) { return a + l.weightKg; }, 0) * 1000) / 1000;
      var outWeightKg = Math.round(receiveClean.reduce(function (a, l) { return a + l.weightKg; }, 0) * 1000) / 1000;
      var lossKg = Math.round((inWeightKg - outWeightKg) * 1000) / 1000;
      if (lossKg < 0) {
        return Promise.reject({ validation: ['The weight received back (' + outWeightKg +
          ' kg) is more than the weight issued (' + inWeightKg + ' kg). Grinding cannot create extra ' +
          'weight — check the entries.'] });
      }
      var lossPct = inWeightKg > 0 ? Math.round((lossKg / inWeightKg) * 10000) / 100 : 0;

      var issuedValue = M.sum(issueClean.map(function (l) { return l.lineTotal; }));
      var receivedValue = M.sum(receiveClean.map(function (l) { return l.lineTotal; }));
      var feeAmount = M.toP(draft.feeAmount || 0);
      if (feeAmount < 0) return Promise.reject({ validation: ['The milling fee cannot be negative.'] });
      var netAmount = settle === 'FEE_ONLY' ? feeAmount : (receivedValue + feeAmount - issuedValue);

      draft.id = draft.id || FDB.uid('mil');
      var opId = (draft.clientOpId || draft.id) + '#0';

      return FDB.tx(['sequences', 'millingJobs', 'millingJobItems', 'inventory', 'stockMovements',
        'auditLog', 'operations'], function (api) {
        return FDB.claimOperation(api, opId, 'MillingJob', { entityId: draft.id }).then(function () {
          return FDB.nextNumber(api, 'MIL').then(function (number) {
            var rec = {
              id: draft.id, jobNumber: number, clientOpId: draft.clientOpId || draft.id,
              jobDate: draft.jobDate || today(),
              millId: draft.millId, millSnapshot: mill.co,
              warehouseId: draft.warehouseId, warehouseSnapshot: whName(draft.warehouseId),
              settle: settle,
              inWeightKg: inWeightKg, outWeightKg: outWeightKg, lossKg: lossKg, lossPct: lossPct,
              issuedValue: issuedValue, receivedValue: receivedValue,
              feeAmount: feeAmount, feeNote: draft.feeNote || '', netAmount: netAmount,
              notes: draft.notes || '', status: 'POSTED', cancelReason: '',
              createdBy: currentUser(), createdAt: nowISO()
            };
            var sort = 0;
            issueClean.forEach(function (l) {
              var r = {
                id: FDB.uid('mli'), jobId: rec.id, sortOrder: sort++, side: 'ISSUE',
                productId: l.productId, productSnapshot: l.product.en || l.product.ur || '',
                productUrSnapshot: l.product.ur || '', packageSnapshot: l.bagKg ? l.bagKg + ' KG' : 'Bag',
                quantity: l.quantity, bagKg: l.bagKg, weightKg: l.weightKg,
                rateBasis: l.rateBasis, unitRate: l.unitRate, lineTotal: l.lineTotal, unitCostP: 0
              };
              api.put('millingJobItems', r); (S.millingJobItems || (S.millingJobItems = [])).push(r);
              Inventory.apply(api, {
                productId: l.productId, warehouseId: rec.warehouseId, qtyDelta: -l.quantity,
                kind: 'MILL_ISSUE_OUT', ref: number, refType: 'MILLING',
                note: 'Issued for milling — ' + rec.millSnapshot, date: rec.jobDate
              });
            });
            receiveClean.forEach(function (l) {
              var costPerBag = l.quantity > 0 ? Math.round(l.lineTotal / l.quantity) : 0;
              var r = {
                id: FDB.uid('mli'), jobId: rec.id, sortOrder: sort++, side: 'RECEIVE',
                productId: l.productId, productSnapshot: l.product.en || l.product.ur || '',
                productUrSnapshot: l.product.ur || '', packageSnapshot: l.bagKg ? l.bagKg + ' KG' : 'Bag',
                quantity: l.quantity, bagKg: l.bagKg, weightKg: l.weightKg,
                rateBasis: l.rateBasis, unitRate: l.unitRate, lineTotal: l.lineTotal, unitCostP: costPerBag
              };
              api.put('millingJobItems', r); (S.millingJobItems || (S.millingJobItems = [])).push(r);
              Inventory.apply(api, {
                productId: l.productId, warehouseId: rec.warehouseId, qtyDelta: l.quantity,
                kind: 'MILL_RECEIPT_IN', ref: number, refType: 'MILLING',
                note: 'Received from mill — ' + rec.millSnapshot, date: rec.jobDate, unitCostP: costPerBag
              });
            });
            api.put('millingJobs', rec); (S.millingJobs || (S.millingJobs = [])).unshift(rec);
            Audit.write(api, {
              action: 'Milling job posted', entity: 'MillingJob', entityId: rec.id, ref: number,
              newValues: { mill: rec.millSnapshot, inWeightKg: inWeightKg, outWeightKg: outWeightKg,
                lossKg: lossKg, net: M.toR(netAmount) }
            });
            return rec;
          });
        });
      }).then(function (rec) { if (ERP.Mirror) ERP.Mirror.refresh(); return rec; });
    },

    cancel: function (id, reason) {
      var job = Milling.byId(id);
      if (!job) return Promise.reject(new Error('Milling job not found.'));
      if (job.status === 'CANCELLED') return Promise.resolve(job);
      return FDB.tx(['millingJobs', 'inventory', 'stockMovements', 'auditLog'], function (api) {
        Milling.items(id).forEach(function (it) {
          if (it.side === 'ISSUE') {
            Inventory.apply(api, {
              productId: it.productId, warehouseId: job.warehouseId, qtyDelta: it.quantity,
              kind: 'MILL_ISSUE_REVERSAL_IN', ref: job.jobNumber, refType: 'MILLING_CANCEL',
              note: 'Milling job cancelled — ' + (reason || 'no reason given'), date: today()
            });
          } else {
            Inventory.apply(api, {
              productId: it.productId, warehouseId: job.warehouseId, qtyDelta: -it.quantity,
              kind: 'MILL_RECEIPT_REVERSAL_OUT', ref: job.jobNumber, refType: 'MILLING_CANCEL',
              note: 'Milling job cancelled — ' + (reason || 'no reason given'), date: today()
            });
          }
        });
        var old = { status: job.status };
        job.status = 'CANCELLED'; job.cancelReason = reason || ''; job.cancelledAt = nowISO();
        api.put('millingJobs', job);
        Audit.write(api, {
          action: 'Milling job cancelled', entity: 'MillingJob', entityId: job.id, ref: job.jobNumber,
          oldValues: old, newValues: { status: 'CANCELLED' }, reason: reason || ''
        });
        return job;
      }).then(function (r) { if (ERP.Mirror) ERP.Mirror.refresh(); return r; });
    }
  };

  /* ── the mill's own khata now includes milling jobs — patched in one place
     the same way 16-khata.js patches ERP.Ledger.customer for account
     adjustments, so the statement, the payables total and the invoice-style
     "current balance" figure cannot disagree. ── */
  var origSupplierLedger = ERP.Ledger.supplier;
  ERP.Ledger.supplier = function (supplierId, fromISO, toISO) {
    var full = origSupplierLedger.call(ERP.Ledger, supplierId, null, null);
    var rows = full.rows.map(function (r) {
      return { iso: r.iso, ref: r.ref, what: r.what, dr: r.dr, cr: r.cr, kind: r.kind,
        id: r.id, createdAt: r.createdAt };
    });
    Milling.forMill(supplierId).forEach(function (j) {
      if (j.settle !== 'FEE_ONLY') {
        if (j.issuedValue) rows.push({
          iso: j.jobDate, ref: j.jobNumber, what: 'Wheat issued — milling job',
          dr: j.issuedValue, cr: 0, kind: 'MILLING', id: j.id + '#issue', createdAt: (j.createdAt || '') + '#1'
        });
        if (j.receivedValue) rows.push({
          iso: j.jobDate, ref: j.jobNumber, what: 'Received from mill — milling job',
          dr: 0, cr: j.receivedValue, kind: 'MILLING', id: j.id + '#recv', createdAt: (j.createdAt || '') + '#2'
        });
      }
      if (j.feeAmount) rows.push({
        iso: j.jobDate, ref: j.jobNumber, what: 'Milling fee',
        dr: 0, cr: j.feeAmount, kind: 'MILLING', id: j.id + '#fee', createdAt: (j.createdAt || '') + '#3'
      });
    });
    return ERP.Ledger._roll(rows, fromISO, toISO, true);
  };

  /* exposed so callers (and tests, after simulating a restart) can know when
     the milling stores have actually finished loading — same pattern
     30-payroll.js uses for ERP.payrollReady */
  ERP.millingReady = (ERP.bootPromise || Promise.resolve()).then(function () {
    return FDB.hydrate().then(function (d) {
      S.millingJobs = d.millingJobs || [];
      S.millingJobItems = d.millingJobItems || [];
    });
  }).catch(function () {
    S.millingJobs = S.millingJobs || []; S.millingJobItems = S.millingJobItems || [];
  });

  /* ════════════════════════════════════════════════════════════════════════
     THE SCREEN
     ════════════════════════════════════════════════════════════════════════ */
  var MILL = { view: 'list', selectedId: null };
  var DRAFT = null;
  var RID = 0;

  function blankLine() {
    return { rid: 'r' + (++RID), productId: '', quantity: '', weightKg: '', weightManual: false,
      rateBasis: 'KG', unitRate: '' };
  }
  function freshDraft() {
    var whs = global.activeWh ? global.activeWh() : [];
    return { millId: '', warehouseId: (whs[0] || {}).id || '', jobDate: today(), settle: 'NET',
      feeAmount: '', feeNote: '', notes: '', issue: [blankLine()], receive: [blankLine()] };
  }
  function autoWeight(line) {
    var p = line.productId ? prodOf(line.productId) : null;
    var bagKg = p ? (Number(p.kg) || 0) : 0;
    var qty = Number(line.quantity) || 0;
    return bagKg && qty ? Math.round(bagKg * qty * 1000) / 1000 : '';
  }

  function card(cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }

  function millOptions(preId) {
    var all = (global.SUPPLIERS || []);
    var sups = all.filter(function (s) { return s.active !== false; });
    /* an inactive mill a job already points at stays selectable, marked
       (inactive) — the same fix made for the payment Area filter and the
       Statement of Account screen, so a job doesn't silently swap mills */
    if (preId && !sups.some(function (s) { return s.id === preId; })) {
      var inactive = all.filter(function (s) { return s.id === preId; })[0];
      if (inactive) sups = sups.concat([inactive]);
    }
    if (!sups.length) return '<option value="">— no suppliers on file —</option>';
    return '<option value="">— choose a mill —</option>' + sups.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === preId ? ' selected' : '') + '>' +
        esc(s.co) + (s.active === false ? ' (inactive)' : '') + '</option>';
    }).join('');
  }

  function warehouseOptions(preId) {
    var whs = global.activeWh ? global.activeWh() : (global.WAREHOUSES || []).filter(function (w) { return w.active !== false; });
    if (preId && !whs.some(function (w) { return w.id === preId; })) {
      var inactive = (global.WAREHOUSES || []).filter(function (w) { return w.id === preId; })[0];
      if (inactive) whs = whs.concat([inactive]);
    }
    return whs.map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === preId ? ' selected' : '') + '>' +
        esc(w.name) + (w.active === false ? ' (inactive)' : '') + '</option>';
    }).join('');
  }

  function lineRow(side, l) {
    var basis = l.rateBasis === 'KG' ? 'KG' : 'BAG';
    var basisQty = basis === 'KG' ? (Number(l.weightKg) || 0) : (Number(l.quantity) || 0);
    var amount = Math.round((Number(l.unitRate) || 0) * basisQty);
    return '<tr>' +
      '<td><select data-millrow="' + l.rid + '" data-millside="' + side + '" data-millf="product">' +
        '<option value="">— choose —</option>' +
        activeProducts().map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === l.productId ? ' selected' : '') + '>' +
            esc(p.en || p.ur || p.id) + (p.kg ? ' — ' + p.kg + ' KG' : '') + '</option>';
        }).join('') + '</select></td>' +
      '<td><input data-millrow="' + l.rid + '" data-millside="' + side + '" data-millf="qty" ' +
        'inputmode="decimal" value="' + esc(l.quantity) + '"></td>' +
      '<td><input data-millrow="' + l.rid + '" data-millside="' + side + '" data-millf="weight" ' +
        'inputmode="decimal" value="' + esc(l.weightKg) + '"></td>' +
      '<td><select data-millrow="' + l.rid + '" data-millside="' + side + '" data-millf="basis">' +
        '<option value="KG"' + (basis === 'KG' ? ' selected' : '') + '>/kg</option>' +
        '<option value="BAG"' + (basis === 'BAG' ? ' selected' : '') + '>/bag</option></select></td>' +
      '<td><input data-millrow="' + l.rid + '" data-millside="' + side + '" data-millf="rate" ' +
        'inputmode="decimal" value="' + esc(l.unitRate) + '"></td>' +
      '<td class="r">' + amount.toLocaleString('en-US') + '</td>' +
      '<td><button class="btn sm" data-millrmline="' + side + ':' + l.rid + '">' + I('x') + '</button></td>' +
    '</tr>';
  }

  function linesTable(side, title, lines) {
    return '<div class="f fc-mill-lines" style="margin-top:10px"><span>' + esc(title) + '</span>' +
      '<div class="tw"><table class="tbl"><thead><tr>' +
        '<th>Product</th><th>Bags / تعداد</th><th>Weight (kg) / وزن</th><th>Basis</th>' +
        '<th>Rate / ریٹ</th><th class="r">Amount / رقم</th><th></th>' +
      '</tr></thead><tbody>' + lines.map(function (l) { return lineRow(side, l); }).join('') +
      '</tbody></table></div>' +
      '<button class="btn sm" data-milladdline="' + side + '" style="margin-top:6px">' + I('plus') + 'Add line</button>' +
    '</div>';
  }

  function entryView() {
    var sum = Milling.summary(DRAFT);
    var warnBand = sum.inWeightKg > 0 && (sum.lossPct < 1 || sum.lossPct > 8);
    var millRec = DRAFT.millId && global.supOf ? global.supOf(DRAFT.millId) : null;
    return '<div class="card"><div class="card-h"><h3>New milling job</h3><div class="grow"></div>' +
        '<button class="btn" data-millentrycancel>Cancel</button></div><div class="card-b">' +
      '<div class="f2">' +
        '<label class="f"><span>Mill</span><select data-millh="mill">' + millOptions(DRAFT.millId) + '</select></label>' +
        '<label class="f"><span>Warehouse</span><select data-millh="wh">' + warehouseOptions(DRAFT.warehouseId) + '</select></label>' +
      '</div>' +
      '<div class="f2">' +
        '<label class="f"><span>Date</span><input type="date" data-millh="date" value="' + esc(DRAFT.jobDate) + '"></label>' +
        '<label class="f"><span>Settlement</span><select data-millh="settle">' +
          '<option value="NET"' + (DRAFT.settle !== 'FEE_ONLY' ? ' selected' : '') + '>Net off against the mill’s account</option>' +
          '<option value="FEE_ONLY"' + (DRAFT.settle === 'FEE_ONLY' ? ' selected' : '') + '>Grinding fee only — wheat stays ours</option>' +
        '</select></label>' +
      '</div>' +
      linesTable('issue', 'Issued — wheat out', DRAFT.issue) +
      linesTable('receive', 'Received — back from the mill', DRAFT.receive) +
      '<div class="kh-cards" style="margin-top:12px">' +
        card('', 'Weight issued', sum.inWeightKg.toLocaleString('en-US') + ' kg') +
        card('', 'Weight received', sum.outWeightKg.toLocaleString('en-US') + ' kg') +
        card(warnBand ? 'due' : '', 'Process loss', sum.lossKg.toLocaleString('en-US') + ' kg (' + sum.lossPct + '%)',
          warnBand ? 'Outside the usual 1–8% range — check the weights' : '') +
      '</div>' +
      (sum.settle !== 'FEE_ONLY'
        ? '<div class="f2" style="margin-top:10px">' +
            '<div class="f"><span>Value issued</span><b>' + sum.issuedValue.toLocaleString('en-US') + '</b></div>' +
            '<div class="f"><span>Value received</span><b>' + sum.receivedValue.toLocaleString('en-US') + '</b></div>' +
          '</div>'
        : '') +
      '<div class="f2" style="margin-top:10px">' +
        '<label class="f"><span>Milling fee</span><input data-millh="fee" inputmode="decimal" value="' + esc(DRAFT.feeAmount) + '"></label>' +
        '<label class="f"><span>Fee note</span><input data-millh="feenote" placeholder="Optional" value="' + esc(DRAFT.feeNote) + '"></label>' +
      '</div>' +
      '<label class="f"><span>Notes</span><input data-millh="notes" placeholder="Optional" value="' + esc(DRAFT.notes) + '"></label>' +
      '<div class="banner ' + (sum.net >= 0 ? 'info' : 'warn') + '" style="margin-top:10px">' + I('wallet') +
        '<div><p>Net ' + (sum.net >= 0 ? 'payable to' : 'receivable from') + ' ' +
        esc(millRec ? millRec.co : 'the mill') + ' <b>' + Math.abs(sum.net).toLocaleString('en-US') + '</b></p></div></div>' +
      '<div style="margin-top:12px">' +
        (can('PURCHASE_CREATE') ? '<button class="btn pri" data-millsave>' + I('check') + 'Save milling job</button>' : '') +
      '</div>' +
    '</div></div>';
  }

  function itemRow(it) {
    return '<tr><td>' + esc(it.productSnapshot) + '</td><td class="r">' + it.quantity + '</td>' +
      '<td class="r">' + it.weightKg + ' kg</td>' +
      '<td class="r">' + M.fmtPlain(it.unitRate) + ' /' + (it.rateBasis === 'KG' ? 'kg' : 'bag') + '</td>' +
      '<td class="r">' + M.fmtPlain(it.lineTotal) + '</td></tr>';
  }

  function listView() {
    var rows = Milling.all();
    var body = rows.map(function (j) {
      return '<tr>' +
        '<td data-label="Date">' + esc(fmtDate(j.jobDate)) + '</td>' +
        '<td data-label="Job #" class="mono">' + esc(j.jobNumber) + '</td>' +
        '<td data-label="Mill">' + esc(j.millSnapshot) + '</td>' +
        '<td data-label="In (kg)" class="r">' + Number(j.inWeightKg).toLocaleString('en-US') + '</td>' +
        '<td data-label="Out (kg)" class="r">' + Number(j.outWeightKg).toLocaleString('en-US') + '</td>' +
        '<td data-label="Loss %" class="r">' + j.lossPct + '%</td>' +
        '<td data-label="Net" class="r">' + M.fmtPlain(j.netAmount) + '</td>' +
        '<td data-label="Status">' + (j.status === 'CANCELLED' ? pill('neu', 'Cancelled') : pill('ok', 'Posted')) + '</td>' +
        '<td data-label="" class="c fcb-rowacts">' +
          '<button class="btn sm" data-millview="' + j.id + '">View</button>' +
          '<button class="btn sm" data-millprint="' + j.id + '">Print</button>' +
          (j.status !== 'CANCELLED' && can('PURCHASE_CREATE')
            ? '<button class="btn sm" data-millcancel="' + j.id + '">Cancel</button>' : '') +
        '</td></tr>';
    }).join('');

    var listCard = '<div class="card"><div class="card-h"><h3>Milling jobs</h3>' +
        '<span class="pill neu">' + rows.length + '</span><div class="grow"></div>' +
        (rows.length ? '<button class="btn" data-millexcel>' + I('sheet') + 'Excel</button>' : '') +
        (can('PURCHASE_CREATE') ? '<button class="btn pri" data-millnew>' + I('plus') + 'New milling job</button>' : '') +
      '</div><div class="card-b" style="padding:0">' +
      (rows.length
        ? '<div class="tw"><table class="tbl"><thead><tr>' +
            '<th>Date</th><th>Job #</th><th>Mill</th><th class="r">In (kg)</th><th class="r">Out (kg)</th>' +
            '<th class="r">Loss %</th><th class="r">Net</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<div class="empty"><div class="ei">' + I('mill') + '</div><b>No milling jobs yet</b>' +
          '<p>Record wheat handed to a mill and the flour and chokar received back.</p>' +
          (can('PURCHASE_CREATE') ? '<button class="btn pri" data-millnew>' + I('plus') + 'New milling job</button>' : '') +
          '</div>') +
      '</div></div>';

    var detail = '';
    var job = MILL.selectedId ? Milling.byId(MILL.selectedId) : null;
    if (job) {
      var items = Milling.items(job.id);
      var issueRows = items.filter(function (i) { return i.side === 'ISSUE'; });
      var recvRows = items.filter(function (i) { return i.side === 'RECEIVE'; });
      detail = '<div class="card" style="margin-top:14px"><div class="card-h">' +
          '<h3>' + esc(job.jobNumber) + '</h3><span class="pill neu">' + esc(job.millSnapshot) + '</span>' +
          '<div class="grow"></div>' +
          '<button class="btn" data-millprint="' + job.id + '">' + I('print') + 'Print / PDF</button>' +
          (job.status !== 'CANCELLED' && can('PURCHASE_CREATE')
            ? '<button class="btn" data-millcancel="' + job.id + '">Cancel</button>' : '') +
          '<button class="btn" data-millclose>Close</button>' +
        '</div><div class="card-b">' +
        '<div class="kh-cards">' +
          card('', 'Weight issued', Number(job.inWeightKg).toLocaleString('en-US') + ' kg') +
          card('', 'Weight received', Number(job.outWeightKg).toLocaleString('en-US') + ' kg') +
          card('', 'Process loss', Number(job.lossKg).toLocaleString('en-US') + ' kg (' + job.lossPct + '%)') +
          card(job.netAmount >= 0 ? 'due' : 'credit', 'Net', M.fmt(job.netAmount)) +
        '</div>' +
        (issueRows.length ? '<p class="hint" style="margin-top:12px">Issued — wheat out</p>' +
          '<div class="tw"><table class="kh-table"><thead><tr><th>Product</th><th class="r">Bags</th>' +
          '<th class="r">Weight</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>' +
          issueRows.map(itemRow).join('') + '</tbody></table></div>' : '') +
        (recvRows.length ? '<p class="hint" style="margin-top:12px">Received — back from the mill</p>' +
          '<div class="tw"><table class="kh-table"><thead><tr><th>Product</th><th class="r">Bags</th>' +
          '<th class="r">Weight</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>' +
          recvRows.map(itemRow).join('') + '</tbody></table></div>' : '') +
        (job.status === 'CANCELLED' ? '<div class="banner warn" style="margin-top:10px">' + I('alert') +
          '<div><p><b>Cancelled</b> — ' + esc(job.cancelReason || 'No reason given') + '</p></div></div>' : '') +
      '</div></div>';
    }
    return listCard + detail;
  }

  global.PAGES.milling = function () { return MILL.view === 'entry' && DRAFT ? entryView() : listView(); };

  /* ════════════════════════════════════════════════════════════════════════
     NAV — one entry under Inventory & supply
     ════════════════════════════════════════════════════════════════════════ */
  try {
    var NAV = global.NAV, GROUPS = global.NAVGROUPS;
    if (!NAV.some(function (n) { return n.id === 'milling'; })) {
      var at = NAV.map(function (n) { return n.id; }).indexOf('purchases');
      NAV.splice(at < 0 ? NAV.length : at + 1, 0, { id: 'milling', l: 'Milling', i: 'mill' });
    }
    GROUPS.forEach(function (g) {
      if (g[0] === 'Inventory & supply' && g[1].indexOf('milling') === -1) {
        var pos = g[1].indexOf('purchases');
        g[1].splice(pos < 0 ? g[1].length : pos + 1, 0, 'milling');
      }
    });
    if (global.PAGEMETA) {
      global.PAGEMETA.milling = ['Milling',
        'Wheat handed to a mill and the flour and chokar received back, with the process loss shown and the net settled into the mill’s own account.'];
    }
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     HANDLERS
     ════════════════════════════════════════════════════════════════════════ */
  D.addEventListener('change', function (e) {
    var el = e.target; if (!el.dataset) return;
    if (el.dataset.millh !== undefined && DRAFT) {
      var k = el.dataset.millh;
      if (k === 'mill') DRAFT.millId = el.value;
      else if (k === 'wh') DRAFT.warehouseId = el.value;
      else if (k === 'date') DRAFT.jobDate = el.value;
      else if (k === 'settle') DRAFT.settle = el.value;
      else if (k === 'fee') DRAFT.feeAmount = el.value;
      else if (k === 'feenote') DRAFT.feeNote = el.value;
      else if (k === 'notes') DRAFT.notes = el.value;
      global.paint(); return;
    }
    if (el.dataset.millrow !== undefined && DRAFT) {
      var side = el.dataset.millside === 'receive' ? 'receive' : 'issue';
      var line = DRAFT[side].filter(function (l) { return l.rid === el.dataset.millrow; })[0];
      if (!line) return;
      var field = el.dataset.millf;
      if (field === 'product') { line.productId = el.value; if (!line.weightManual) line.weightKg = autoWeight(line); }
      else if (field === 'qty') { line.quantity = el.value; if (!line.weightManual) line.weightKg = autoWeight(line); }
      else if (field === 'weight') { line.weightKg = el.value; line.weightManual = true; }
      else if (field === 'basis') { line.rateBasis = el.value; }
      else if (field === 'rate') { line.unitRate = el.value; }
      global.paint();
    }
  });

  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var t;
    if (e.target.closest('[data-millnew]')) {
      e.preventDefault(); DRAFT = freshDraft(); MILL.view = 'entry'; global.paint(); return;
    }
    if (e.target.closest('[data-millentrycancel]')) {
      e.preventDefault(); DRAFT = null; MILL.view = 'list'; global.paint(); return;
    }
    if ((t = e.target.closest('[data-milladdline]'))) {
      e.preventDefault();
      if (DRAFT) DRAFT[t.dataset.milladdline].push(blankLine());
      global.paint(); return;
    }
    if ((t = e.target.closest('[data-millrmline]'))) {
      e.preventDefault();
      var parts = t.dataset.millrmline.split(':');
      if (DRAFT) {
        DRAFT[parts[0]] = DRAFT[parts[0]].filter(function (l) { return l.rid !== parts[1]; });
        /* never leave a side with no rows at all — same rule 27-landed-ui.js
           uses for its own dynamic line list, so there is always a row to
           type into rather than a dead-end empty table */
        if (!DRAFT[parts[0]].length) DRAFT[parts[0]].push(blankLine());
      }
      global.paint(); return;
    }
    if (e.target.closest('[data-millsave]')) {
      e.preventDefault();
      if (!DRAFT) return;
      /* captured so a slower save that resolves after the person has
         already moved on to a second draft (e.g. clicked "New milling job"
         again before this one finished) cannot wipe that second draft out
         from under them */
      var savingDraft = DRAFT;
      Milling.save(savingDraft).then(function (job) {
        if (DRAFT === savingDraft) { DRAFT = null; MILL.view = 'list'; }
        MILL.selectedId = job.id;
        global.paint(); say('Milling job ' + job.jobNumber + ' posted.');
        setTimeout(function () {
          var m = ERP.DocModel && ERP.DocModel.millingJob ? ERP.DocModel.millingJob(job.id) : null;
          if (m) ERP.Viewer.open(m);
        }, 220);
      }).catch(function (err) { say(err && err.validation ? err.validation[0] : 'Could not save the milling job.'); });
      return;
    }
    if ((t = e.target.closest('[data-millview]'))) {
      e.preventDefault(); MILL.selectedId = t.dataset.millview; global.paint(); return;
    }
    if (e.target.closest('[data-millclose]')) {
      e.preventDefault(); MILL.selectedId = null; global.paint(); return;
    }
    if ((t = e.target.closest('[data-millprint]'))) {
      e.preventDefault();
      var m2 = ERP.DocModel && ERP.DocModel.millingJob ? ERP.DocModel.millingJob(t.dataset.millprint) : null;
      if (m2) ERP.Viewer.open(m2);
      return;
    }
    if ((t = e.target.closest('[data-millcancel]'))) {
      e.preventDefault();
      var id2 = t.dataset.millcancel;
      ERP.UI.prompt('Cancel this milling job?', {
        detail: 'The stock movements are reversed. The reason is kept in the audit log.',
        label: 'Reason', placeholder: 'Why is this milling job being cancelled?',
        okText: 'Cancel job', cancelText: 'Keep job', tone: 'danger'
      }).then(function (why) {
        if (why === null) return;
        return Milling.cancel(id2, why || 'No reason given').then(function () {
          global.paint(); say('Milling job cancelled and the stock movements reversed.');
        }).catch(function (err) { say((err && err.validation && err.validation[0]) || 'Could not cancel that.'); });
      });
      return;
    }
    if (e.target.closest('[data-millexcel]')) {
      e.preventDefault();
      var rows = [['Date', 'Job #', 'Mill', 'In (kg)', 'Out (kg)', 'Loss (kg)', 'Loss %', 'Issued', 'Received', 'Fee', 'Net', 'Status']];
      Milling.all().forEach(function (j) {
        rows.push([fmtDate(j.jobDate), j.jobNumber, j.millSnapshot, j.inWeightKg, j.outWeightKg,
          j.lossKg, j.lossPct, M.toR(j.issuedValue), M.toR(j.receivedValue), M.toR(j.feeAmount),
          M.toR(j.netAmount), j.status]);
      });
      if (ERP.XLSX) {
        ERP.XLSX.download([{ name: 'Milling jobs', rows: rows }], 'Milling-jobs-' + today() + '.xlsx',
          { title: 'Milling jobs', author: ERP.Settings.get().businessName });
        ERP.Audit.detached({ action: 'Milling jobs exported to Excel', entity: 'Report', entityId: 'milling' });
      }
      return;
    }
  });
})(typeof window !== 'undefined' ? window : this);
