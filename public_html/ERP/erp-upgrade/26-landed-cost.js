/* ══════════════════════════════════════════════════════════════════════════
   LANDED COST & TRUE PROFIT

   The business needs a layer between buying and selling where the costs that
   are not on the supplier's bill — its own truck, its own labourers, fuel,
   a transfer up to Chitral — can be added to the bags and carried into the
   profit figures.

   The rule that governs the whole module: NOTHING HERE TOUCHES A SUPPLIER.
   These stores are separate from purchases, no write in this file goes near
   `payments`, `purchases.grandTotal` or a supplier ledger, and the supplier
   balance is asserted unchanged by test.

   A note on what was already here. The ERP already allocated freight, loading
   and other charges from the purchase form across the lines, and already had
   a LANDED / PURCHASE profit basis. Those charges sit on the purchase record
   and DO raise the supplier payable — which is right when the supplier billed
   for delivery. This module is for the other case: costs the business pays to
   someone else. Both feed landed cost; only the supplier's own charges feed
   the supplier's account.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var M = global.Money, FDB = global.FDB, S = ERP.S, D = global.document;
  if (!M || !FDB || !S) return;

  function nowISO() { return new Date().toISOString(); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function who() {
    try { return (ERP.Session && ERP.Session.name && ERP.Session.name()) || 'Owner'; }
    catch (e) { return 'Owner'; }
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CATEGORIES = ['Transportation', 'Loading', 'Unloading', 'Fuel',
                    'Transfer Charges', 'Storage', 'Miscellaneous'];

  /* ════════════════════════════════════════════════════════════════════════
     STATE
     ════════════════════════════════════════════════════════════════════════ */
  S.landedCosts = S.landedCosts || [];
  S.landedCostExpenses = S.landedCostExpenses || [];
  S.inventoryCostAdjust = S.inventoryCostAdjust || [];

  /* ════════════════════════════════════════════════════════════════════════
     ALLOCATION
     Expenses are spread over the lines by value, matching how the existing
     purchase charges already behave, so the two sources agree.
     ════════════════════════════════════════════════════════════════════════ */
  function allocateOver(lines, extraP) {
    var goods = lines.reduce(function (a, l) { return a + Math.max(0, l.lineTotal || 0); }, 0);
    var extra = Math.max(0, extraP || 0);
    var out = lines.map(function (l) {
      var qty = l.receivedQty === undefined ? Number(l.quantity) || 0 : Number(l.receivedQty) || 0;
      var share = goods > 0 ? Math.round(extra * Math.max(0, l.lineTotal || 0) / goods)
                            : (lines.length ? Math.round(extra / lines.length) : 0);
      return { itemId: l.id, productId: l.productId, warehouseId: l.warehouseId,
               qty: qty, lineTotal: l.lineTotal || 0, share: share,
               perUnit: qty ? Math.round(share / qty) : 0 };
    });
    /* rounding must not lose or invent a rupee: the remainder goes to the
       largest line, which is where it is least visible per bag */
    var assigned = out.reduce(function (a, o) { return a + o.share; }, 0);
    var drift = extra - assigned;
    if (drift !== 0 && out.length) {
      var big = out.reduce(function (a, b) { return b.lineTotal > a.lineTotal ? b : a; }, out[0]);
      big.share += drift;
      big.perUnit = big.qty ? Math.round(big.share / big.qty) : 0;
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════════
     THE SERVICE
     ════════════════════════════════════════════════════════════════════════ */
  var Landed = ERP.Landed = {
    categories: function () {
      var custom = ERP.Settings.get().landedCostCategories;
      return (custom && custom.length) ? custom : CATEGORIES;
    },
    all: function () { return S.landedCosts; },
    byId: function (id) {
      return S.landedCosts.filter(function (r) { return r.id === id; })[0] || null;
    },
    expensesOf: function (landedCostId) {
      return S.landedCostExpenses.filter(function (e) { return e.landedCostId === landedCostId; });
    },
    adjustmentsOf: function (landedCostId) {
      return S.inventoryCostAdjust.filter(function (a) { return a.landedCostId === landedCostId; });
    },
    forPurchase: function (purchaseId) {
      return S.landedCosts.filter(function (r) {
        return r.purchaseId === purchaseId && r.status !== 'CANCELLED';
      });
    },
    forTransfer: function (transferId) {
      return S.landedCosts.filter(function (r) {
        return r.transferId === transferId && r.status !== 'CANCELLED';
      });
    },

    /* every operational rupee added to one purchase, from every entry */
    extraForPurchase: function (purchaseId) {
      return Landed.forPurchase(purchaseId).reduce(function (a, r) { return a + r.totalAmount; }, 0);
    },

    /* the operational share sitting on one purchase line */
    extraForItem: function (purchaseItemId) {
      return S.inventoryCostAdjust.reduce(function (a, adj) {
        if (adj.purchaseItemId !== purchaseItemId) return a;
        var lc = Landed.byId(adj.landedCostId);
        if (lc && lc.status === 'CANCELLED') return a;
        return a + adj.additionalCost;
      }, 0);
    },

    validate: function (o) {
      var errs = [];
      if (!o.purchaseId && !o.transferId) errs.push('Choose the purchase or the transfer these costs belong to.');
      if (o.purchaseId && !ERP.Purchases.byId(o.purchaseId)) errs.push('That purchase no longer exists.');
      var lines = (o.expenses || []).filter(function (e) { return e && (e.amount || e.amountR); });
      if (!lines.length) errs.push('Add at least one expense.');
      lines.forEach(function (e, i) {
        var amt = M.toP(e.amountR !== undefined ? e.amountR : e.amount);
        if (!(amt > 0)) errs.push('Line ' + (i + 1) + ': the amount must be more than zero.');
        if (!e.category) errs.push('Line ' + (i + 1) + ': choose a category.');
        if (!(e.date || o.date)) errs.push('Line ' + (i + 1) + ': give a date.');
      });
      if (o.date && o.date > today()) errs.push('The date cannot be in the future.');
      return errs;
    },

    /* ── create ──────────────────────────────────────────────────────────
       One transaction writes the entry, its expenses, the per-line cost
       adjustments and the audit record. `purchases` and `payments` are not
       in the store list, so this cannot alter a supplier balance even by
       accident. */
    create: function (o) {
      o = o || {};
      var errs = Landed.validate(o);
      if (errs.length) return Promise.reject({ validation: errs });

      var purchase = o.purchaseId ? ERP.Purchases.byId(o.purchaseId) : null;
      var lines = purchase ? ERP.Purchases.items(purchase.id) : (o.lines || []);
      if (!lines.length) return Promise.reject({ validation: ['That purchase has no lines to spread the cost over.'] });

      var expenses = (o.expenses || []).filter(function (e) { return e && (e.amount || e.amountR); })
        .map(function (e) {
          return {
            category: e.category, description: String(e.description || '').trim(),
            amountP: M.toP(e.amountR !== undefined ? e.amountR : e.amount),
            vendorName: String(e.vendorName || '').trim(),
            paymentStatus: e.paymentStatus || 'UNPAID',
            expenseDate: e.date || o.date || today()
          };
        });
      var total = expenses.reduce(function (a, e) { return a + e.amountP; }, 0);
      var alloc = allocateOver(lines, total);

      return FDB.tx(['sequences', 'landedCosts', 'landedCostExpenses', 'inventoryCostAdjust',
                     'purchaseItems', 'inventory', 'costHistory', 'auditLog'], function (api) {
        var prefix = ERP.Settings.get().landedCostPrefix || 'LC';
        return FDB.nextNumber(api, prefix).then(function (number) {
          var lcId = FDB.uid('lc');
          var rec = {
            id: lcId, referenceNumber: number,
            purchaseId: o.purchaseId || null,
            purchaseNumber: purchase ? purchase.purchaseNumber : '',
            transferId: o.transferId || null,
            warehouseId: o.warehouseId || (lines[0] && lines[0].warehouseId) || '',
            costDate: o.date || today(),
            totalAmount: total,
            goodsValue: lines.reduce(function (a, l) { return a + (l.lineTotal || 0); }, 0),
            notes: String(o.notes || '').trim(),
            description: (ERP.Desc ? ERP.Desc.clean(o.description) : (o.description || '')),
            status: 'POSTED',
            createdBy: who(), createdAt: nowISO()
          };
          api.put('landedCosts', rec);
          S.landedCosts.unshift(rec);

          expenses.forEach(function (e) {
            var exp = Object.assign({ id: FDB.uid('lce'), landedCostId: lcId }, e);
            api.put('landedCostExpenses', exp);
            S.landedCostExpenses.push(exp);
          });

          alloc.forEach(function (a) {
            var it = lines.filter(function (x) { return x.id === a.itemId; })[0];
            if (!it) return;
            var goodsUnit = it.goodsUnitCost ||
              (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.unitPrice);
            /* every operational rupee on this line, this entry included */
            var priorExtra = Landed.extraForItem(it.id);
            var totalExtra = priorExtra + a.share;
            var extraUnit = a.qty ? Math.round(totalExtra / a.qty) : 0;

            var adj = {
              id: FDB.uid('ica'), landedCostId: lcId,
              productId: it.productId, purchaseItemId: it.id,
              purchaseId: o.purchaseId || null, warehouseId: it.warehouseId,
              purchaseCost: goodsUnit,
              additionalCost: a.share,
              landedCost: goodsUnit + extraUnit,
              quantity: a.qty,
              costPerUnit: goodsUnit + extraUnit,
              createdAt: nowISO()
            };
            api.put('inventoryCostAdjust', adj);
            S.inventoryCostAdjust.push(adj);

            /* the purchase LINE carries the landed figure; the purchase
               HEADER and the supplier's bill are not touched */
            it.operationalShare = totalExtra;
            it.landedUnitCost = goodsUnit + Math.round((it.chargeShare || 0) / (a.qty || 1)) + extraUnit;
            api.put('purchaseItems', it);

            if (!a.qty) return;
            var row = ERP.Inventory.row(it.productId, it.warehouseId);
            var previous = row.avgCostP;
            row.avgCostP = Landed.weightedAverage(it.productId, it.warehouseId) || it.landedUnitCost;
            row.lastCostP = it.landedUnitCost;
            api.put('inventory', row);

            ERP.Cost.record(api, {
              kind: 'LANDED', productId: it.productId, purchaseId: o.purchaseId,
              purchaseNumber: rec.purchaseNumber, warehouseId: it.warehouseId,
              date: rec.costDate, previousCost: previous, newCost: row.avgCostP,
              goodsCost: goodsUnit, landedCost: it.landedUnitCost, quantity: a.qty,
              note: 'Operational cost ' + number + ' — ' + M.fmt(a.share) + ' on this line'
            });
          });

          ERP.Audit.write(api, {
            action: 'Landed cost posted', entity: 'LandedCost', entityId: lcId,
            ref: number,
            newValues: { total: total, expenses: expenses.length, lines: alloc.length,
                         purchase: rec.purchaseNumber || rec.transferId || '' }
          });
          return rec;
        });
      }).then(function (rec) {
        ERP.Mirror.refresh();
        try { global.paint(); } catch (e) {}
        return rec;
      });
    },

    /* ── cancel ──────────────────────────────────────────────────────────
       Reversing rather than deleting: the entry stays in the record and the
       costs it added come back out of the inventory average. */
    cancel: function (id, reason) {
      var rec = Landed.byId(id);
      if (!rec) return Promise.reject({ validation: ['That entry no longer exists.'] });
      if (rec.status === 'CANCELLED') return Promise.resolve(rec);
      var adjustments = Landed.adjustmentsOf(id);

      return FDB.tx(['landedCosts', 'inventoryCostAdjust', 'purchaseItems',
                     'inventory', 'costHistory', 'auditLog'], function (api) {
        rec.status = 'CANCELLED';
        rec.cancelledBy = who(); rec.cancelledAt = nowISO();
        rec.cancelReason = String(reason || '').trim();
        api.put('landedCosts', rec);

        adjustments.forEach(function (adj) {
          var it = (S.purchaseItems || []).filter(function (x) { return x.id === adj.purchaseItemId; })[0];
          if (!it) return;
          var goodsUnit = it.goodsUnitCost ||
            (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.unitPrice);
          var remaining = Landed.extraForItem(it.id);   /* this entry is now cancelled */
          var qty = adj.quantity || 1;
          it.operationalShare = remaining;
          it.landedUnitCost = goodsUnit + Math.round((it.chargeShare || 0) / qty) +
                              Math.round(remaining / qty);
          api.put('purchaseItems', it);

          var row = ERP.Inventory.row(it.productId, it.warehouseId);
          var previous = row.avgCostP;
          row.avgCostP = Landed.weightedAverage(it.productId, it.warehouseId) || goodsUnit;
          row.lastCostP = it.landedUnitCost;
          api.put('inventory', row);

          ERP.Cost.record(api, {
            kind: 'LANDED_REVERSAL', productId: it.productId, purchaseId: rec.purchaseId,
            purchaseNumber: rec.purchaseNumber, warehouseId: it.warehouseId,
            date: today(), previousCost: previous, newCost: row.avgCostP,
            goodsCost: goodsUnit, landedCost: it.landedUnitCost, quantity: qty,
            note: 'Reversed ' + rec.referenceNumber
          });
        });

        ERP.Audit.write(api, {
          action: 'Landed cost cancelled', entity: 'LandedCost', entityId: id,
          ref: rec.referenceNumber, oldValues: { status: 'POSTED', total: rec.totalAmount },
          newValues: { status: 'CANCELLED', reason: rec.cancelReason }
        });
        return rec;
      }).then(function (r) {
        ERP.Mirror.refresh();
        try { global.paint(); } catch (e) {}
        return r;
      });
    },

    /* the weighted average including operational cost, recomputed from every
       purchase rather than nudged, so re-running it is always safe */
    weightedAverage: function (productId, warehouseId) {
      var qty = 0, value = 0;
      var useLanded = (ERP.Cost.basis() === 'LANDED');
      (S.purchaseItems || []).forEach(function (it) {
        if (it.productId !== productId || it.warehouseId !== warehouseId) return;
        var pu = ERP.Purchases.byId(it.purchaseId);
        if (!pu || pu.status === 'CANCELLED') return;
        var q = it.receivedQty === undefined ? it.quantity : it.receivedQty;
        if (!q) return;
        var goodsUnit = it.goodsUnitCost || (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.unitPrice);
        var unit = goodsUnit;
        if (useLanded) {
          var supplierShare = Math.round((it.chargeShare || 0) / q);
          var opShare = Math.round(Landed.extraForItem(it.id) / q);
          unit = goodsUnit + supplierShare + opShare;
        }
        qty += q; value += unit * q;
      });
      return qty ? Math.round(value / qty) : 0;
    },

    /* the breakdown shown on screen and used by the reports */
    breakdown: function (purchaseId) {
      var pu = ERP.Purchases.byId(purchaseId);
      if (!pu) return null;
      var items = ERP.Purchases.items(purchaseId);
      var goods = items.reduce(function (a, i) { return a + (i.lineTotal || 0); }, 0);
      var supplierCharges = ERP.Cost.chargesOf(pu);
      var operational = Landed.extraForPurchase(purchaseId);
      var qty = items.reduce(function (a, i) {
        return a + (i.receivedQty === undefined ? i.quantity : i.receivedQty);
      }, 0);
      var totalCost = goods + supplierCharges + operational;
      return {
        purchase: pu, items: items, quantity: qty,
        goodsValue: goods,
        supplierCharges: supplierCharges,
        supplierPayable: pu.grandTotal,
        operationalCost: operational,
        totalInventoryCost: totalCost,
        costPerUnit: qty ? Math.round(totalCost / qty) : 0,
        purchaseCostPerUnit: qty ? Math.round(goods / qty) : 0,
        entries: Landed.forPurchase(purchaseId)
      };
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     HYDRATION — the new stores load with everything else
     ════════════════════════════════════════════════════════════════════════ */
  ERP.landedReady = (ERP.bootPromise || Promise.resolve()).then(function () {
    return FDB.hydrate().then(function (d) {
      S.landedCosts = (d.landedCosts || [])
        .sort(function (a, b) { return a.costDate < b.costDate ? 1 : -1; });
      S.landedCostExpenses = d.landedCostExpenses || [];
      S.inventoryCostAdjust = d.inventoryCostAdjust || [];
      ERP.Mirror.refresh();
    });
  }).catch(function () {
    S.landedCosts = S.landedCosts || [];
    S.landedCostExpenses = S.landedCostExpenses || [];
    S.inventoryCostAdjust = S.inventoryCostAdjust || [];
  });

  /* ════════════════════════════════════════════════════════════════════════
     THE COST A SALE IS MEASURED AGAINST
     ERP.Cost.weightedAverage already blended the supplier's own freight. It
     now also carries the operational cost, so a sale is costed against what
     the bag really cost to have in the godown — and every profit figure in
     the ERP follows, because they all read through this one function.
     ════════════════════════════════════════════════════════════════════════ */
  var origWeighted = ERP.Cost.weightedAverage;
  ERP.Cost.weightedAverage = function (productId, warehouseId) {
    if (ERP.Cost.basis() !== 'LANDED') return origWeighted.apply(ERP.Cost, arguments);
    return Landed.weightedAverage(productId, warehouseId) ||
           origWeighted.apply(ERP.Cost, arguments);
  };

  /* A purchase saved after its landed costs were entered must not wipe them:
     the base handler recomputes the line from the supplier charges alone, so
     the operational share is folded back in afterwards. */
  var origPurchaseSave = ERP.Purchases.save;
  ERP.Purchases.save = function (draft) {
    return origPurchaseSave.call(ERP.Purchases, draft).then(function (rec) {
      if (!rec || !Landed.forPurchase(rec.id).length) return rec;
      var items = ERP.Purchases.items(rec.id);
      return FDB.tx(['purchaseItems', 'inventory', 'auditLog'], function (api) {
        items.forEach(function (it) {
          var q = it.receivedQty === undefined ? it.quantity : it.receivedQty;
          if (!q) return;
          var extra = Landed.extraForItem(it.id);
          if (!extra) return;
          it.operationalShare = extra;
          it.landedUnitCost = (it.landedUnitCost || 0) + Math.round(extra / q);
          api.put('purchaseItems', it);
          var row = ERP.Inventory.row(it.productId, it.warehouseId);
          row.avgCostP = Landed.weightedAverage(it.productId, it.warehouseId) || row.avgCostP;
          api.put('inventory', row);
        });
      }).then(function () { ERP.Mirror.refresh(); return rec; });
    });
  };

  ERP.LandedModule = { version: '2026-09-14', categories: CATEGORIES, allocateOver: allocateOver };

})(typeof window !== 'undefined' ? window : globalThis);
