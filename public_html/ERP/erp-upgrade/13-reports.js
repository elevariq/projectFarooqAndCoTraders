/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 13
   REPORTING ENGINE
   Every figure in every report is counted from the stored transactions —
   invoices, purchases, payments, returns and stock movements — for whatever
   period is asked for. Nothing is typed in, nothing is cached, and the same
   engine feeds the screen, the print sheet, the Word file and the
   spreadsheet. (§1–§11)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, DOCX = global.DOCX;
var S = ERP.S;

function nowISO() { return new Date().toISOString(); }
function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }
function qty(n) { return Number(n || 0).toLocaleString('en-US'); }
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'];

/* ══════════════════════════════════════════════════════════════════════════
   PERIODS (§1)
   ══════════════════════════════════════════════════════════════════════════ */
var Period = ERP.Period = {
  presets: [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['lastweek', 'Last week'],
    ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'],
    ['year', 'This year'], ['lastyear', 'Last year'], ['all', 'All time']
  ],
  resolve: function (kind, a, b) {
    var t = today(), d = new Date(t + 'T00:00:00');
    function shift(n) { var y = new Date(d); y.setDate(y.getDate() + n); return iso(y); }
    function monthStart(off) { return iso(new Date(d.getFullYear(), d.getMonth() + (off || 0), 1)); }
    function monthEnd(off) { return iso(new Date(d.getFullYear(), d.getMonth() + (off || 0) + 1, 0)); }
    switch (kind) {
      case 'today':     return [t, t, 'Today'];
      case 'yesterday': return [shift(-1), shift(-1), 'Yesterday'];
      case 'week':      return [shift(-((d.getDay() + 6) % 7)), t, 'This week'];
      case 'lastweek':  return [shift(-((d.getDay() + 6) % 7) - 7), shift(-((d.getDay() + 6) % 7) - 1), 'Last week'];
      case 'month':     return [monthStart(0), t, MONTHS[d.getMonth()] + ' ' + d.getFullYear()];
      case 'lastmonth': return [monthStart(-1), monthEnd(-1),
                                MONTHS[(d.getMonth() + 11) % 12] + ' ' + (d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear())];
      case 'quarter':   var q = Math.floor(d.getMonth() / 3);
                        return [iso(new Date(d.getFullYear(), q * 3, 1)), t, 'Quarter ' + (q + 1) + ' ' + d.getFullYear()];
      case 'year':      return [d.getFullYear() + '-01-01', t, 'Year ' + d.getFullYear()];
      case 'lastyear':  return [(d.getFullYear() - 1) + '-01-01', (d.getFullYear() - 1) + '-12-31',
                                'Year ' + (d.getFullYear() - 1)];
      case 'all':       return [null, null, 'All time'];
      case 'months':    /* a month to a month, inclusive */
        var f = (a || t.slice(0, 7)) + '-01';
        var lp = (b || t.slice(0, 7)).split('-');
        var last = iso(new Date(+lp[0], +lp[1], 0));
        return [f, last, MONTHS[+(a || t.slice(0, 7)).slice(5, 7) - 1] + ' ' + (a || '').slice(0, 4) +
                ' — ' + MONTHS[+lp[1] - 1] + ' ' + lp[0]];
      case 'yearOf':    return [(a || d.getFullYear()) + '-01-01', (a || d.getFullYear()) + '-12-31',
                                'Year ' + (a || d.getFullYear())];
      default:          return [a || null, b || null,
                                (a ? fmtDate(a) : 'Beginning') + ' — ' + (b ? fmtDate(b) : 'Today')];
    }
  },
  label: function (from, to) {
    if (!from && !to) return 'All time';
    return (from ? fmtDate(from) : 'Beginning') + ' → ' + (to ? fmtDate(to) : 'Today');
  },
  within: function (d, from, to) {
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
};
var within = Period.within;

/* ══════════════════════════════════════════════════════════════════════════
   EXPENSES (§8) — the ERP had no place to record them
   ══════════════════════════════════════════════════════════════════════════ */
S.expenses = S.expenses || [];
var Expenses = ERP.Expenses = {
  categories: ['Freight', 'Loading / unloading', 'Fuel', 'Vehicle repair', 'Salaries', 'Rent',
               'Utilities', 'Godown', 'Office', 'Bank charges', 'Other'],
  all: function () { return S.expenses; },
  inRange: function (from, to) {
    return S.expenses.filter(function (e) { return within(e.expenseDate, from, to); });
  },
  save: function (o) {
    var amount = M.toP(o.amount);
    if (!(amount > 0)) return Promise.reject({ validation: ['Enter an amount greater than zero.'] });
    if (!o.category) return Promise.reject({ validation: ['Choose a category.'] });
    var opId = o.clientOpId || FDB.uid('expop');
    return FDB.tx(['sequences', 'expenses', 'auditLog', 'operations'], function (api) {
      return FDB.claimOperation(api, opId, 'Expense', {}).then(function () {
        return FDB.nextNumber(api, 'EXP').then(function (number) {
          var rec = {
            id: FDB.uid('exp'), expenseNumber: number, clientOpId: opId,
            expenseDate: o.date || today(), category: o.category,
            description: o.description || '', paidTo: o.paidTo || '',
            method: o.method || 'Cash', reference: o.reference || '',
            amount: amount, warehouseId: o.warehouseId || '',
            createdBy: global.CURRENT_USER || 'Owner', createdAt: nowISO()
          };
          api.put('expenses', rec);
          S.expenses.unshift(rec);
          ERP.Audit.write(api, { action: 'Expense recorded', entity: 'Expense', entityId: rec.id,
            ref: number, newValues: { amount: amount, category: rec.category } });
          return rec;
        });
      });
    });
  },
  remove: function (id) {
    var ix = S.expenses.findIndex(function (e) { return e.id === id; });
    if (ix < 0) return Promise.resolve();
    var rec = S.expenses[ix];
    return FDB.tx(['expenses', 'auditLog'], function (api) {
      api.del('expenses', id);
      ERP.Audit.write(api, { action: 'Expense removed', entity: 'Expense', entityId: id,
        ref: rec.expenseNumber, oldValues: { amount: rec.amount } });
    }).then(function () { S.expenses.splice(ix, 1); });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   AGGREGATION
   ══════════════════════════════════════════════════════════════════════════ */
var A = ERP.Analytics = {};

A.invoices = function (from, to, f) {
  f = f || {};
  return ERP.Invoices.live().filter(function (i) {
    if (!within(i.invoiceDate, from, to)) return false;
    if (f.customerId && i.customerId !== f.customerId) return false;
    if (f.regionId && i.regionId !== f.regionId) return false;
    if (f.warehouseId && i.warehouseId !== f.warehouseId) return false;
    if (f.productId && !ERP.Invoices.items(i.id).some(function (x) { return x.productId === f.productId; })) return false;
    return true;
  });
};

A.sales = function (from, to, f) {
  f = f || {};
  var list = A.invoices(from, to, f);
  var revenue = 0, cost = 0, bags = 0, lines = 0;
  var byProduct = {}, byRegion = {}, byCustomer = {}, byWarehouse = {}, byDay = {};
  list.forEach(function (i) {
    revenue += i.grandTotal;
    byRegion[i.regionId || 'none'] = byRegion[i.regionId || 'none'] ||
      { id: i.regionId || 'none', label: i.regionSnapshot || 'No region', revenue: 0, bags: 0, count: 0 };
    byRegion[i.regionId || 'none'].revenue += i.grandTotal;
    byRegion[i.regionId || 'none'].bags += i.totalQty;
    byRegion[i.regionId || 'none'].count++;
    byWarehouse[i.warehouseId] = byWarehouse[i.warehouseId] ||
      { id: i.warehouseId, label: i.warehouseSnapshot, revenue: 0, bags: 0, count: 0 };
    byWarehouse[i.warehouseId].revenue += i.grandTotal;
    byWarehouse[i.warehouseId].bags += i.totalQty;
    byWarehouse[i.warehouseId].count++;
    byCustomer[i.customerId] = byCustomer[i.customerId] ||
      { id: i.customerId, label: i.shopNameSnapshot, region: i.regionSnapshot,
        revenue: 0, bags: 0, count: 0, paid: 0 };
    byCustomer[i.customerId].revenue += i.grandTotal;
    byCustomer[i.customerId].bags += i.totalQty;
    byCustomer[i.customerId].count++;
    byCustomer[i.customerId].paid += ERP.Invoices.paidFor(i.id);
    byDay[i.invoiceDate] = (byDay[i.invoiceDate] || 0) + i.grandTotal;

    ERP.Invoices.items(i.id).forEach(function (it) {
      if (f.productId && it.productId !== f.productId) return;
      lines++;
      bags += it.quantity;
      cost += M.mul(it.costSnapshot || 0, it.quantity);
      var p = byProduct[it.productId] = byProduct[it.productId] ||
        { id: it.productId, name: it.descriptionSnapshot, nameEn: it.descriptionEnSnapshot,
          brand: it.brandSnapshot, pack: it.packageSnapshot, bags: 0, revenue: 0, cost: 0, count: 0 };
      p.bags += it.quantity;
      p.revenue += it.lineTotal;
      p.cost += M.mul(it.costSnapshot || 0, it.quantity);
      p.count++;
    });
  });
  var returns = S.custReturns.filter(function (r) {
    return within(r.returnDate, from, to) && r.status !== 'CANCELLED' &&
           (!f.customerId || r.customerId === f.customerId);
  });
  var returned = returns.reduce(function (a, r) { return a + r.creditAmount; }, 0);
  var collected = ERP.Payments.incoming().filter(function (p) {
    return within(p.paymentDate, from, to) && (!f.customerId || p.partyId === f.customerId);
  }).reduce(function (a, p) { return a + p.amount; }, 0);

  function sorted(map, key) {
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b[key || 'revenue'] - a[key || 'revenue']; });
  }
  return {
    from: from, to: to, invoices: list, count: list.length,
    revenue: revenue, cost: cost, grossProfit: revenue - cost,
    margin: revenue ? Math.round((revenue - cost) / revenue * 1000) / 10 : 0,
    bags: bags, lines: lines, returned: returned, returnCount: returns.length,
    netRevenue: revenue - returned, collected: collected,
    outstanding: list.reduce(function (a, i) { return a + ERP.Invoices.outstanding(i); }, 0),
    byProduct: sorted(byProduct), byRegion: sorted(byRegion), byCustomer: sorted(byCustomer),
    byWarehouse: sorted(byWarehouse),
    trend: Object.keys(byDay).sort().map(function (d) { return { date: d, value: byDay[d] }; })
  };
};

A.purchases = function (from, to, f) {
  f = f || {};
  var list = S.purchases.filter(function (p) {
    if (!within(p.purchaseDate, from, to)) return false;
    if (f.supplierId && p.supplierId !== f.supplierId) return false;
    if (f.warehouseId && p.warehouseId !== f.warehouseId) return false;
    if (f.productId && !ERP.Purchases.items(p.id).some(function (x) { return x.productId === f.productId; })) return false;
    return true;
  });
  var total = 0, bags = 0, bySupplier = {}, byProduct = {}, byDay = {};
  list.forEach(function (p) {
    total += p.grandTotal;
    bags += p.totalQty;
    var s = bySupplier[p.supplierId] = bySupplier[p.supplierId] ||
      { id: p.supplierId, label: p.supplierNameSnapshot, total: 0, bags: 0, count: 0, paid: 0 };
    s.total += p.grandTotal; s.bags += p.totalQty; s.count++;
    byDay[p.purchaseDate] = (byDay[p.purchaseDate] || 0) + p.grandTotal;
    ERP.Purchases.items(p.id).forEach(function (it) {
      if (f.productId && it.productId !== f.productId) return;
      var pr = byProduct[it.productId] = byProduct[it.productId] ||
        { id: it.productId, name: it.descriptionSnapshot, nameEn: it.descriptionEnSnapshot,
          pack: it.packageSnapshot, bags: 0, total: 0 };
      pr.bags += it.receivedQty === undefined ? it.quantity : it.receivedQty;
      pr.total += it.lineTotal;
    });
  });
  var paid = ERP.Payments.outgoing().filter(function (p) {
    return within(p.paymentDate, from, to) && (!f.supplierId || p.partyId === f.supplierId);
  });
  paid.forEach(function (p) { if (bySupplier[p.partyId]) bySupplier[p.partyId].paid += p.amount; });
  var paidTotal = paid.reduce(function (a, p) { return a + p.amount; }, 0);
  var supReturns = S.supReturns.filter(function (r) {
    return within(r.returnDate, from, to) && (!f.supplierId || r.supplierId === f.supplierId);
  });
  return {
    from: from, to: to, purchases: list, count: list.length, total: total, bags: bags,
    paid: paidTotal, returned: supReturns.reduce(function (a, r) { return a + r.debitAmount; }, 0),
    payable: f.supplierId ? ERP.Ledger.supplierBalance(f.supplierId) : ERP.Ledger.payablesTotal(),
    bySupplier: Object.keys(bySupplier).map(function (k) { return bySupplier[k]; })
      .sort(function (a, b) { return b.total - a.total; }),
    byProduct: Object.keys(byProduct).map(function (k) { return byProduct[k]; })
      .sort(function (a, b) { return b.total - a.total; }),
    trend: Object.keys(byDay).sort().map(function (d) { return { date: d, value: byDay[d] }; })
  };
};

/* ── stock movement, opening to closing, straight from the movement log ── */
var IN_KINDS = { PURCHASE_IN: 'received', CUSTOMER_RETURN_IN: 'returnedIn',
                 CUSTOMER_RETURN_DAMAGED_IN: 'damagedIn', DAMAGED_RETURN_IN: 'damagedIn',
                 TRANSFER_IN: 'transferIn', ADJUSTMENT_IN: 'adjusted', OPENING_STOCK: 'opening',
                 SALE_REVERSAL_IN: 'adjusted', SUPPLIER_REPLACEMENT_IN: 'received', ADJUSTMENT: 'adjusted' };
var OUT_KINDS = { SALE_OUT: 'sold', SUPPLIER_RETURN_OUT: 'returnedOut', TRANSFER_OUT: 'transferOut',
                  ADJUSTMENT_OUT: 'adjusted', STOCK_WRITE_OFF: 'writtenOff', DISPATCH_OUT: 'sold',
                  PURCHASE_REVERSAL_OUT: 'adjusted', REPLACEMENT_OUT: 'sold' };

A.inventory = function (from, to, f) {
  f = f || {};
  var rows = {};
  function row(pid, wid) {
    var k = pid + '|' + wid;
    if (!rows[k]) {
      var p = global.prodOf ? global.prodOf(pid) : null;
      rows[k] = { key: k, productId: pid, warehouseId: wid,
        name: p ? (p.ur || '') : '', nameEn: p ? (p.en || pid) : pid,
        brand: p ? (p.brandEn || p.brand || '') : '', pack: p && p.kg ? p.kg + ' KG' : 'Bag',
        warehouse: global.whName ? global.whName(wid) : wid,
        opening: 0, received: 0, sold: 0, returnedIn: 0, damagedIn: 0, returnedOut: 0,
        transferIn: 0, transferOut: 0, adjusted: 0, writtenOff: 0, closing: 0 };
    }
    return rows[k];
  }
  var moves = S.movements.filter(function (m) {
    if (f.productId && m.productId !== f.productId) return false;
    if (f.warehouseId && m.warehouseId !== f.warehouseId) return false;
    if (f.brand) {
      var p = global.prodOf ? global.prodOf(m.productId) : null;
      if (!p || (p.brandEn || p.brand || '') !== f.brand) return false;
    }
    return true;
  });
  moves.forEach(function (m) {
    if (m.bucket === 'damaged' && m.kind !== 'CUSTOMER_RETURN_DAMAGED_IN' &&
        m.kind !== 'DAMAGED_RETURN_IN') return;
    var r = row(m.productId, m.warehouseId);
    var d = m.date || (m.createdAt || '').slice(0, 10);
    var delta = Number(m.qtyDelta) || 0;
    if (from && d < from) { if (m.bucket !== 'damaged') r.opening += delta; return; }
    if (to && d > to) return;
    if (m.bucket === 'damaged') { r.damagedIn += Math.abs(delta); return; }
    var bucket = delta >= 0 ? IN_KINDS[m.kind] : OUT_KINDS[m.kind];
    if (!bucket) bucket = 'adjusted';
    if (bucket === 'opening') r.opening += delta;
    else r[bucket] += Math.abs(delta);
  });
  var list = Object.keys(rows).map(function (k) {
    var r = rows[k];
    r.closing = r.opening + r.received + r.returnedIn + r.transferIn + r.adjusted
              - r.sold - r.returnedOut - r.transferOut - r.writtenOff;
    /* the adjusted bucket holds both directions, so trust the live figure
       when the whole history is in view */
    if (!from) r.closing = ERP.Inventory.available(r.productId, r.warehouseId);
    return r;
  }).filter(function (r) {
    return r.opening || r.received || r.sold || r.closing || r.returnedIn || r.transferIn ||
           r.transferOut || r.returnedOut || r.adjusted || r.damagedIn;
  }).sort(function (a, b) { return b.sold - a.sold; });
  return {
    from: from, to: to, rows: list,
    opening: list.reduce(function (a, r) { return a + r.opening; }, 0),
    received: list.reduce(function (a, r) { return a + r.received; }, 0),
    sold: list.reduce(function (a, r) { return a + r.sold; }, 0),
    returnedIn: list.reduce(function (a, r) { return a + r.returnedIn; }, 0),
    closing: list.reduce(function (a, r) { return a + r.closing; }, 0),
    damaged: list.reduce(function (a, r) { return a + r.damagedIn; }, 0)
  };
};

A.returns = function (from, to, f) {
  f = f || {};
  var cust = [], sup = [];
  S.custReturns.filter(function (r) {
    return within(r.returnDate, from, to) && (!f.customerId || r.customerId === f.customerId);
  }).forEach(function (r) {
    ERP.Returns.customerItems(r.id).forEach(function (it) {
      cust.push({ date: r.returnDate, number: r.returnNumber, invoice: r.invoiceNumber,
        shop: r.customerNameSnapshot, product: it.descriptionEnSnapshot || it.descriptionSnapshot,
        productUr: it.descriptionSnapshot, qty: it.quantity,
        reason: it.reason || r.reason, condition: ERP.Returns.conditionLabel(it.condition),
        treatment: ERP.Returns.treatmentLabel(r.treatment), value: it.lineTotal });
    });
  });
  S.supReturns.filter(function (r) {
    return within(r.returnDate, from, to) && (!f.supplierId || r.supplierId === f.supplierId);
  }).forEach(function (r) {
    ERP.Returns.supplierItems(r.id).forEach(function (it) {
      sup.push({ date: r.returnDate, number: r.returnNumber, purchase: r.purchaseNumber,
        supplier: r.supplierNameSnapshot, product: it.descriptionEnSnapshot || it.descriptionSnapshot,
        productUr: it.descriptionSnapshot, qty: it.quantity, reason: it.reason || r.reason,
        value: it.lineTotal });
    });
  });
  return {
    customer: cust, supplier: sup,
    customerValue: cust.reduce(function (a, r) { return a + r.value; }, 0),
    supplierValue: sup.reduce(function (a, r) { return a + r.value; }, 0),
    customerQty: cust.reduce(function (a, r) { return a + r.qty; }, 0),
    supplierQty: sup.reduce(function (a, r) { return a + r.qty; }, 0)
  };
};

A.payments = function (from, to, f) {
  f = f || {};
  function pick(list) {
    return list.filter(function (p) {
      if (!within(p.paymentDate, from, to)) return false;
      if (f.partyId && p.partyId !== f.partyId) return false;
      if (f.method && p.method !== f.method) return false;
      return true;
    });
  }
  var received = pick(ERP.Payments.incoming());
  var madeOut = pick(ERP.Payments.outgoing());
  var refunds = pick(ERP.Payments.refunds());
  var expenses = Expenses.inRange(from, to).filter(function (e) {
    return (!f.category || e.category === f.category) && (!f.method || e.method === f.method);
  });
  var byMethod = {};
  received.concat(madeOut, refunds).forEach(function (p) {
    var m2 = byMethod[p.method] = byMethod[p.method] || { method: p.method, inAmt: 0, outAmt: 0 };
    if (p.direction === 'IN') m2.inAmt += p.amount; else m2.outAmt += p.amount;
  });
  var byCategory = {};
  expenses.forEach(function (e) {
    var c = byCategory[e.category] = byCategory[e.category] || { category: e.category, amount: 0, count: 0 };
    c.amount += e.amount; c.count++;
  });
  var byDay = {};
  expenses.forEach(function (e) { byDay[e.expenseDate] = (byDay[e.expenseDate] || 0) + e.amount; });
  return {
    received: received, made: madeOut, refunds: refunds, expenses: expenses,
    receivedTotal: received.reduce(function (a, p) { return a + p.amount; }, 0),
    madeTotal: madeOut.reduce(function (a, p) { return a + p.amount; }, 0),
    refundTotal: refunds.reduce(function (a, p) { return a + p.amount; }, 0),
    expenseTotal: expenses.reduce(function (a, e) { return a + e.amount; }, 0),
    byMethod: Object.keys(byMethod).map(function (k) { return byMethod[k]; }),
    byCategory: Object.keys(byCategory).map(function (k) { return byCategory[k]; })
      .sort(function (a, b) { return b.amount - a.amount; }),
    expenseTrend: Object.keys(byDay).sort().map(function (d) { return { date: d, value: byDay[d] }; }),
    receivable: ERP.Ledger.receivablesTotal(), payable: ERP.Ledger.payablesTotal()
  };
};

/* ── one shop, everything about it (§2 §3) ── */
A.customer = function (customerId, from, to) {
  var c = global.custBy ? global.custBy(customerId) : null;
  if (!c) return null;
  var L = ERP.Ledger.customer(customerId, from, to);
  var sales = A.sales(from, to, { customerId: customerId });
  var rows = [];
  sales.invoices.forEach(function (i) {
    ERP.Invoices.items(i.id).forEach(function (it, ix) {
      rows.push({
        date: i.invoiceDate, invoice: i.invoiceNumber,
        product: it.descriptionEnSnapshot || it.descriptionSnapshot,
        productUr: it.descriptionSnapshot, pack: it.packageSnapshot,
        qty: it.quantity, rate: it.unitPrice, amount: it.lineTotal,
        invoiceTotal: ix === 0 ? i.grandTotal : null,
        status: ERP.STATUS_LABEL[i.paymentStatus] || i.paymentStatus
      });
    });
  });
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var byDate = {};
  sales.invoices.forEach(function (i) {
    byDate[i.invoiceDate] = byDate[i.invoiceDate] || { date: i.invoiceDate, count: 0, amount: 0, bags: 0 };
    byDate[i.invoiceDate].count++; byDate[i.invoiceDate].amount += i.grandTotal;
    byDate[i.invoiceDate].bags += i.totalQty;
  });
  var returns = A.returns(from, to, { customerId: customerId });
  var paid = ERP.Payments.incoming().filter(function (p) {
    return p.partyId === customerId && within(p.paymentDate, from, to);
  });
  var region = c.region && global.regionOf ? global.regionOf(c.region) : null;
  return {
    customer: c,
    profile: {
      shop: c.sh || '', owner: c.ow || '', phone: c.ph || c.wa || '', address: c.addr || '',
      region: region ? region.ur + ' — ' + region.en : '', code: c.legacyCode || c.id,
      type: c.isCashCounter ? 'Cash counter' : (c.type || 'Credit shop'),
      route: c.route || c.area || '', openingBalance: L.opening
    },
    period: [from, to],
    summary: {
      orders: sales.count, bags: sales.bags, sales: sales.revenue,
      paid: paid.reduce(function (a, p) { return a + p.amount; }, 0),
      returns: returns.customerValue,
      opening: L.opening, closing: L.closing,
      outstanding: sales.outstanding, profit: sales.grossProfit
    },
    rows: rows, byDate: Object.keys(byDate).sort().map(function (k) { return byDate[k]; }),
    byProduct: sales.byProduct, invoices: sales.invoices, payments: paid,
    returns: returns.customer, ledger: L
  };
};

A.supplier = function (supplierId, from, to) {
  var s = global.supOf ? global.supOf(supplierId) : null;
  if (!s) return null;
  var L = ERP.Ledger.supplier(supplierId, from, to);
  var pur = A.purchases(from, to, { supplierId: supplierId });
  var rows = [];
  pur.purchases.forEach(function (p) {
    ERP.Purchases.items(p.id).forEach(function (it) {
      rows.push({ date: p.purchaseDate, purchase: p.purchaseNumber,
        product: it.descriptionEnSnapshot || it.descriptionSnapshot,
        productUr: it.descriptionSnapshot, pack: it.packageSnapshot,
        ordered: it.orderedQty === undefined ? it.quantity : it.orderedQty,
        received: it.receivedQty === undefined ? it.quantity : it.receivedQty,
        rate: it.unitPrice, amount: it.lineTotal });
    });
  });
  return {
    supplier: s,
    profile: { name: s.co || '', contact: s.cp || '', phone: s.ph || '', code: s.legacyCode || s.id,
               location: s.lo || '', openingBalance: L.opening },
    period: [from, to],
    summary: { purchases: pur.total, bags: pur.bags, count: pur.count, paid: pur.paid,
               returns: pur.returned, opening: L.opening, closing: L.closing },
    rows: rows, byProduct: pur.byProduct, purchases: pur.purchases, ledger: L
  };
};

/* ── the report in plain words (§9) ── */
A.summary = function (from, to, f) {
  f = f || {};
  var s = A.sales(from, to, f), p = A.purchases(from, to, f), pay = A.payments(from, to, f);
  var label = Period.label(from, to);
  var parts = [];
  parts.push('From ' + label + ':');
  parts.push('The business completed ' + s.count + (s.count === 1 ? ' sale' : ' sales') +
             ' covering ' + qty(s.bags) + ' bags.');
  parts.push('Total revenue was ' + M.fmt(s.revenue) +
             (s.cost ? ', against a cost of ' + M.fmt(s.cost) + ' — a gross profit of ' +
              M.fmt(s.grossProfit) + ' (' + s.margin + '%).' : '.'));
  if (s.byProduct.length) {
    parts.push('The best seller was ' + (s.byProduct[0].nameEn || s.byProduct[0].name) +
               ' at ' + qty(s.byProduct[0].bags) + ' bags (' + M.fmt(s.byProduct[0].revenue) + ').');
  }
  if (s.byRegion.length) {
    parts.push(s.byRegion[0].label + ' brought in the most, ' + M.fmt(s.byRegion[0].revenue) + '.');
  }
  if (s.byCustomer.length) {
    parts.push('The largest account was ' + s.byCustomer[0].label + ' at ' + M.fmt(s.byCustomer[0].revenue) + '.');
  }
  parts.push(M.fmt(s.collected) + ' was collected in the period; ' +
             M.fmt(pay.receivable) + ' is still owed by shops overall.');
  if (p.count) {
    parts.push(p.count + (p.count === 1 ? ' purchase' : ' purchases') + ' worth ' + M.fmt(p.total) +
               ' were received, with ' + M.fmt(pay.payable) + ' still payable to mills.');
  }
  if (s.returned) parts.push(M.fmt(s.returned) + ' came back as returns.');
  if (pay.expenseTotal) parts.push('Expenses recorded were ' + M.fmt(pay.expenseTotal) + '.');
  return parts.join(' ');
};

/* ══════════════════════════════════════════════════════════════════════════
   EXCEL (§10) — a small workbook writer on the same ZIP as the Word files
   ══════════════════════════════════════════════════════════════════════════ */
function xesc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function colName(n) {
  var s = '';
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}
var XLSX = ERP.XLSX = {
  build: function (sheets, meta) {
    var names = sheets.map(function (s, i) { return (s.name || ('Sheet' + (i + 1))).slice(0, 28).replace(/[\\\/\?\*\[\]:]/g, ' '); });
    var files = [];
    files.push({ name: '[Content_Types].xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>' });
    files.push({ name: '_rels/.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>' });
    files.push({ name: 'docProps/core.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xesc((meta && meta.title) || 'Report') +
      '</dc:title><dc:creator>' + xesc((meta && meta.author) || 'Farooq & Co Traders') +
      '</dc:creator></cp:coreProperties>' });
    files.push({ name: 'xl/workbook.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) {
        return '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' });
    files.push({ name: 'xl/styles.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEFECF9"/></patternFill></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf xfId="0"/>' +                                             /* 0 plain */
      '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/>' + /* 1 header */
      '<xf xfId="0" numFmtId="164" applyNumberFormat="1"/>' +          /* 2 money */
      '<xf xfId="0" fontId="2" applyFont="1"/>' +                      /* 3 title */
      '<xf xfId="0" fontId="1" numFmtId="164" applyFont="1" applyNumberFormat="1"/>' + /* 4 bold money */
      '</cellXfs></styleSheet>' });

    sheets.forEach(function (sheet, si) {
      var rows = (sheet.rows || []).map(function (row, ri) {
        var cells = (row || []).map(function (cell, ci) {
          var ref = colName(ci) + (ri + 1);
          var v = cell, style = 0;
          if (v && typeof v === 'object') { style = v.style || 0; v = v.v; }
          if (typeof v === 'number' && isFinite(v)) {
            if (!style) style = 2;
            return '<c r="' + ref + '" s="' + style + '"><v>' + v + '</v></c>';
          }
          if (v === null || v === undefined || v === '') return '<c r="' + ref + '" s="' + style + '"/>';
          return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
            xesc(v) + '</t></is></c>';
        }).join('');
        return '<row r="' + (ri + 1) + '">' + cells + '</row>';
      }).join('');
      var widths = (sheet.widths || []).map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('');
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        (widths ? '<cols>' + widths + '</cols>' : '') +
        '<sheetData>' + rows + '</sheetData></worksheet>' });
    });
    return DOCX.zip(files);
  },
  download: function (sheets, filename, meta) {
    var bytes = XLSX.build(sheets, meta);
    var blob = new global.Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = global.document.createElement('a');
    a.href = global.URL.createObjectURL(blob);
    a.download = filename || 'report.xlsx';
    global.document.body.appendChild(a); a.click();
    setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return a.download;
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   A REPORT AS A DOCUMENT — print, PDF and Word come from here (§10)
   ══════════════════════════════════════════════════════════════════════════ */
A.docModel = function (report) {
  var b = ERP.DocModel.business();
  var cols = report.columns || [];
  return {
    kind: 'REPORT', entityId: report.id || 'report', template: 'modern',
    title: (report.title || 'REPORT').toUpperCase(),
    number: report.number || '',
    status: 'Report', date: fmtDate(today()), rawDate: today(),
    business: b,
    party: { label: report.partyLabel || 'REPORT FOR', shop: report.partyName || b.name,
             owner: report.partyOwner || '', code: report.partyCode || '',
             contact: report.partyContact || '', region: report.partyRegion || '',
             id: report.partyId || null },
    metaLabel: 'REPORT DETAILS',
    meta: [['Report', report.title, true],
           ['Period', Period.label(report.from, report.to)],
           ['Generated', fmtDate(today()) + (report.time ? ' ' + report.time : '')],
           ['Generated by', global.CURRENT_USER || 'Owner'],
           ['Records', String((report.rows || []).length)]].concat(report.meta || []),
    strip: report.cards ? report.cards.slice(0, 4).map(function (c) { return [c.label, c.value]; }) : [],
    columns: cols,
    rows: report.rows || [],
    itemsFooter: report.footer || null,
    totals: report.totals || [],
    words: '', paymentsList: null,
    notes: report.summary || '',
    ledger: report.ledger || [],
    signatures: ['Prepared by', 'Checked by'],
    footer: { thanks: '', terms: 'Generated from the recorded transactions of ' + b.name + '.', bank: '' },
    actions: { email: true }
  };
};
})(typeof window !== 'undefined' ? window : globalThis);
