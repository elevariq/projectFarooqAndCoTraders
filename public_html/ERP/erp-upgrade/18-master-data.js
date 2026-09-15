/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 18
   MASTER DATA  ·  areas, salesmen, and which mill supplies what
   A mill is not "a rice supplier" or "a flour supplier" — it is whatever it
   actually sends. So suppliers and products are mapped to each other, and
   the category shown is worked out from the mapping rather than typed in.
   Everything here is editable; nothing that has transactions behind it can
   be deleted, only archived.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, D = global.document;
var S = ERP.S;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function u(t) { return global.u ? global.u(t) : esc(t); }
function say(m) { return global.say ? global.say(m) : null; }
function nowISO() { return new Date().toISOString(); }
function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }

/* ══════════════════════════════════════════════════════════════════════════
   SALESMEN
   ══════════════════════════════════════════════════════════════════════════ */
var Staff = ERP.Staff = {
  all: function () { return S.salesmen || (S.salesmen = []); },
  active: function () { return Staff.all().filter(function (s) { return s.active !== false; }); },
  byId: function (id) { return Staff.all().filter(function (s) { return s.id === id; })[0] || null; },

  save: function (o) {
    var errs = [];
    if (!o.name) errs.push('Enter the salesman\u2019s name.');
    if (errs.length) return Promise.reject({ validation: errs });
    var existing = o.id ? Staff.byId(o.id) : null;
    var rec = Object.assign({
      id: o.id || FDB.uid('sm'), createdAt: nowISO(), createdBy: global.CURRENT_USER || 'Owner'
    }, existing || {}, {
      name: o.name, phone: o.phone || '', whatsapp: o.whatsapp || '',
      employeeId: o.employeeId || '', notes: o.notes || '',
      regionIds: o.regionIds || (existing ? existing.regionIds : []) || [],
      active: o.active === undefined ? (existing ? existing.active !== false : true) : !!o.active,
      updatedAt: nowISO()
    });
    return FDB.tx(['salesmen', 'auditLog'], function (api) {
      api.put('salesmen', rec);
      var ix = Staff.all().map(function (s) { return s.id; }).indexOf(rec.id);
      if (ix > -1) Staff.all()[ix] = rec; else Staff.all().push(rec);
      ERP.Audit.write(api, {
        action: existing ? 'Salesman updated' : 'Salesman added', entity: 'Salesman',
        entityId: rec.id, ref: rec.name,
        oldValues: existing ? { name: existing.name, regions: existing.regionIds } : null,
        newValues: { name: rec.name, regions: rec.regionIds, active: rec.active }
      });
      return rec;
    });
  },
  archive: function (id, on) {
    var s = Staff.byId(id);
    if (!s) return Promise.resolve(null);
    return FDB.tx(['salesmen', 'auditLog'], function (api) {
      s.active = !on; s.updatedAt = nowISO();
      api.put('salesmen', s);
      ERP.Audit.write(api, { action: on ? 'Salesman archived' : 'Salesman restored',
        entity: 'Salesman', entityId: id, ref: s.name });
      return s;
    });
  },
  /* areas a salesman covers, and the salesman covering a shop */
  forRegion: function (regionId) {
    return Staff.active().filter(function (s) { return (s.regionIds || []).indexOf(regionId) > -1; });
  },
  forCustomer: function (customerId) {
    var c = global.custBy ? global.custBy(customerId) : null;
    if (!c) return null;
    if (c.salesmanId && Staff.byId(c.salesmanId)) return c.salesmanId;   /* direct override */
    var byRegion = Staff.forRegion(c.region);
    return byRegion.length ? byRegion[0].id : null;
  },
  nameForCustomer: function (customerId) {
    var id = Staff.forCustomer(customerId);
    var s = id ? Staff.byId(id) : null;
    return s ? s.name : '';
  },
  customers: function (salesmanId) {
    return (global.CUSTOMERS || []).filter(function (c) { return Staff.forCustomer(c.id) === salesmanId; });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   AREAS — editable, with a salesman and no hard-coded list
   ══════════════════════════════════════════════════════════════════════════ */
var Areas = ERP.Areas = {
  all: function () { return global.REGIONS || []; },
  active: function () { return Areas.all().filter(function (r) { return r.active !== false; }); },
  byId: function (id) { return Areas.all().filter(function (r) { return r.id === id; })[0] || null; },
  customers: function (id) { return (global.CUSTOMERS || []).filter(function (c) { return c.region === id; }); },

  save: function (o) {
    var errs = [];
    if (!o.en && !o.ur) errs.push('Give the area a name.');
    var norm = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
    var clash = Areas.all().filter(function (r) {
      return r.id !== o.id && (norm(r.en) === norm(o.en) && norm(o.en)) ;
    });
    if (clash.length) errs.push('An area called “' + o.en + '” already exists.');
    if (errs.length) return Promise.reject({ validation: errs });
    var existing = o.id ? Areas.byId(o.id) : null;
    var rec = Object.assign({ id: o.id || ('rg-' + norm(o.en).replace(/[^a-z0-9]+/g, '-')) },
      existing || {}, {
        en: o.en || (existing && existing.en) || '', ur: o.ur || (existing && existing.ur) || '',
        active: o.active === undefined ? (existing ? existing.active !== false : true) : !!o.active,
        updatedAt: nowISO()
      });
    return FDB.tx(['regions', 'auditLog'], function (api) {
      api.put('regions', rec);
      var list = Areas.all();
      var ix = list.map(function (r) { return r.id; }).indexOf(rec.id);
      if (ix > -1) list[ix] = rec; else list.push(rec);
      ERP.Audit.write(api, {
        action: existing ? 'Area updated' : 'Area added', entity: 'Region', entityId: rec.id,
        ref: rec.en, oldValues: existing ? { en: existing.en, ur: existing.ur } : null,
        newValues: { en: rec.en, ur: rec.ur, active: rec.active }
      });
      return rec;
    });
  },
  archive: function (id, on) {
    var r = Areas.byId(id);
    if (!r) return Promise.resolve(null);
    if (on && Areas.customers(id).length) {
      return Promise.reject({ validation: [
        Areas.customers(id).length + ' shops are still in this area. Move them first, or leave it active.'] });
    }
    return FDB.tx(['regions', 'auditLog'], function (api) {
      r.active = !on; api.put('regions', r);
      ERP.Audit.write(api, { action: on ? 'Area archived' : 'Area restored', entity: 'Region',
        entityId: id, ref: r.en });
      return r;
    });
  },
  assignSalesman: function (regionId, salesmanId) {
    var s = Staff.byId(salesmanId);
    if (!s) return Promise.reject({ validation: ['Choose a salesman.'] });
    var before = (s.regionIds || []).slice();
    /* one area, one salesman: take it off anyone else first */
    var others = Staff.all().filter(function (x) { return x.id !== salesmanId; });
    return FDB.tx(['salesmen', 'auditLog'], function (api) {
      others.forEach(function (x) {
        if ((x.regionIds || []).indexOf(regionId) > -1) {
          x.regionIds = x.regionIds.filter(function (r) { return r !== regionId; });
          api.put('salesmen', x);
        }
      });
      s.regionIds = (s.regionIds || []).concat([regionId]).filter(function (v, i, a) { return a.indexOf(v) === i; });
      api.put('salesmen', s);
      ERP.Audit.write(api, { action: 'Area assigned to salesman', entity: 'Salesman', entityId: s.id,
        ref: s.name, oldValues: { regions: before }, newValues: { regions: s.regionIds, area: regionId } });
      return s;
    });
  },
  moveCustomer: function (customerId, regionId, reason) {
    var c = global.custBy(customerId);
    if (!c) return Promise.reject({ validation: ['Shop not found.'] });
    var before = c.region;
    return FDB.tx(['customers', 'auditLog'], function (api) {
      c.region = regionId; c.regionAssumed = false;
      api.put('customers', c);
      ERP.Audit.write(api, {
        action: 'Shop moved to another area', entity: 'Customer', entityId: c.id, ref: c.sh,
        oldValues: { region: before }, newValues: { region: regionId }, reason: reason || ''
      });
      return c;
    }).then(function (r) { ERP.Mirror.refresh(); return r; });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   SUPPLIER ↔ PRODUCT MAPPING
   ══════════════════════════════════════════════════════════════════════════ */
var Mapping = ERP.Mapping = {
  all: function () { return S.supplierProducts || (S.supplierProducts = []); },
  forSupplier: function (supplierId) {
    return Mapping.all().filter(function (m) { return m.supplierId === supplierId; });
  },
  forProduct: function (productId) {
    return Mapping.all().filter(function (m) { return m.productId === productId; });
  },
  has: function (supplierId, productId) {
    return Mapping.all().some(function (m) { return m.supplierId === supplierId && m.productId === productId; });
  },
  /* which mill a product is taken to have come from, for supplier profit */
  supplierOf: function (productId) {
    var preferred = Mapping.forProduct(productId).filter(function (m) { return m.preferred; })[0];
    if (preferred) return preferred.supplierId;
    var last = null;
    S.purchaseItems.forEach(function (it) {
      if (it.productId !== productId) return;
      var pu = ERP.Purchases.byId(it.purchaseId);
      if (!pu) return;
      if (!last || pu.purchaseDate > last.date) last = { date: pu.purchaseDate, supplierId: pu.supplierId };
    });
    if (last) return last.supplierId;
    var any = Mapping.forProduct(productId)[0];
    return any ? any.supplierId : null;
  },
  /* Rice, Flour, or both — read from what is mapped, never typed in */
  categoriesOf: function (supplierId) {
    var cats = {};
    Mapping.forSupplier(supplierId).forEach(function (m) {
      var p = global.prodOf ? global.prodOf(m.productId) : null;
      if (p && p.cat) cats[p.cat] = 1;
    });
    S.purchaseItems.forEach(function (it) {
      var pu = ERP.Purchases.byId(it.purchaseId);
      if (!pu || pu.supplierId !== supplierId) return;
      var p = global.prodOf ? global.prodOf(it.productId) : null;
      if (p && p.cat) cats[p.cat] = 1;
    });
    return Object.keys(cats);
  },
  label: function (supplierId) {
    var cats = Mapping.categoriesOf(supplierId);
    if (!cats.length) return 'No products mapped yet';
    var en = cats.map(function (c) {
      return c === 'چاول' ? 'Rice' : c === 'آٹا' ? 'Flour' : c === 'وغیرہ' ? 'Other' : c;
    });
    return en.join(' & ') + ' supplier';
  },

  add: function (supplierId, productId, opts) {
    opts = opts || {};
    if (!supplierId || !productId) return Promise.reject({ validation: ['Choose a supplier and a product.'] });
    if (Mapping.has(supplierId, productId)) return Promise.resolve(null);   /* no duplicates */
    var rec = {
      id: FDB.uid('sp'), supplierId: supplierId, productId: productId,
      preferred: !!opts.preferred, note: opts.note || '',
      createdAt: nowISO(), createdBy: global.CURRENT_USER || 'Owner'
    };
    return FDB.tx(['supplierProducts', 'auditLog'], function (api) {
      if (rec.preferred) {
        Mapping.forProduct(productId).forEach(function (m) {
          if (m.preferred) { m.preferred = false; api.put('supplierProducts', m); }
        });
      }
      api.put('supplierProducts', rec);
      Mapping.all().push(rec);
      var p = global.prodOf ? global.prodOf(productId) : null;
      var s = global.supOf ? global.supOf(supplierId) : null;
      ERP.Audit.write(api, { action: 'Supplier product mapped', entity: 'SupplierProduct',
        entityId: rec.id, ref: (s ? s.co : supplierId),
        newValues: { product: p ? (p.en || p.ur) : productId, preferred: rec.preferred } });
      return rec;
    });
  },
  remove: function (id) {
    var m = Mapping.all().filter(function (x) { return x.id === id; })[0];
    if (!m) return Promise.resolve(null);
    return FDB.tx(['supplierProducts', 'auditLog'], function (api) {
      api.del('supplierProducts', id);
      S.supplierProducts = Mapping.all().filter(function (x) { return x.id !== id; });
      var p = global.prodOf ? global.prodOf(m.productId) : null;
      var s = global.supOf ? global.supOf(m.supplierId) : null;
      ERP.Audit.write(api, { action: 'Supplier product mapping removed', entity: 'SupplierProduct',
        entityId: id, ref: (s ? s.co : m.supplierId),
        oldValues: { product: p ? (p.en || p.ur) : m.productId } });
    });
  },
  setPreferred: function (id) {
    var m = Mapping.all().filter(function (x) { return x.id === id; })[0];
    if (!m) return Promise.resolve(null);
    return FDB.tx(['supplierProducts', 'auditLog'], function (api) {
      Mapping.forProduct(m.productId).forEach(function (x) {
        var was = x.preferred;
        x.preferred = x.id === id;
        if (was !== x.preferred) api.put('supplierProducts', x);
      });
      ERP.Audit.write(api, { action: 'Preferred supplier set', entity: 'SupplierProduct', entityId: id });
      return m;
    });
  },
  /* context shown while a product is picked on a purchase */
  context: function (productId, warehouseId) {
    var p = global.prodOf ? global.prodOf(productId) : null;
    var last = null;
    S.purchaseItems.forEach(function (it) {
      if (it.productId !== productId) return;
      var pu = ERP.Purchases.byId(it.purchaseId);
      if (!pu) return;
      if (!last || pu.purchaseDate > last.date) {
        last = { date: pu.purchaseDate, supplier: pu.supplierNameSnapshot,
                 cost: it.landedUnitCost || it.unitPrice };
      }
    });
    return {
      category: p ? p.cat : '', lastSupplier: last ? last.supplier : '',
      lastCost: last ? last.cost : 0, lastDate: last ? last.date : '',
      averageCost: ERP.Inventory.costOf(productId, warehouseId),
      stock: ERP.Inventory.totalFor(productId)
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EDIT AND ARCHIVE — master data only; posted transactions are not touched
   ══════════════════════════════════════════════════════════════════════════ */
var Master = ERP.Master = {
  /* what would break if this record went away */
  references: function (entity, id) {
    var n = 0;
    if (entity === 'supplier') {
      n += S.purchases.filter(function (p) { return p.supplierId === id; }).length;
      n += S.supReturns.filter(function (r) { return r.supplierId === id; }).length;
      n += S.payments.filter(function (p) { return p.partyId === id && p.partyType === 'SUPPLIER'; }).length;
    } else if (entity === 'customer') {
      n += S.invoices.filter(function (i) { return i.customerId === id; }).length;
      n += S.payments.filter(function (p) { return p.partyId === id && p.partyType === 'CUSTOMER'; }).length;
      n += S.custReturns.filter(function (r) { return r.customerId === id; }).length;
    } else if (entity === 'product') {
      n += S.invoiceItems.filter(function (i) { return i.productId === id; }).length;
      n += S.purchaseItems.filter(function (i) { return i.productId === id; }).length;
      n += S.movements.filter(function (m) { return m.productId === id; }).length;
    } else if (entity === 'region') {
      n += Areas.customers(id).length;
    } else if (entity === 'salesman') {
      n += Staff.customers(id).length;
    }
    return n;
  },
  canDelete: function (entity, id) { return Master.references(entity, id) === 0; },

  update: function (entity, id, patch, reason) {
    var map = { supplier: ['SUPPLIERS', 'suppliers'], customer: ['CUSTOMERS', 'customers'],
                product: ['PRODUCTS', 'products'] };
    var spec = map[entity];
    if (!spec) return Promise.reject({ validation: ['Unknown record type.'] });
    var list = global[spec[0]] || [];
    var rec = list.filter(function (r) { return r.id === id; })[0];
    if (!rec) return Promise.reject({ validation: ['That record no longer exists.'] });
    var before = {};
    Object.keys(patch).forEach(function (k) { before[k] = rec[k]; });
    Object.assign(rec, patch, { updatedAt: nowISO() });
    return FDB.tx([spec[1], 'auditLog'], function (api) {
      api.put(spec[1], rec);
      ERP.Audit.write(api, {
        action: entity.charAt(0).toUpperCase() + entity.slice(1) + ' edited',
        entity: entity, entityId: id,
        ref: rec.co || rec.sh || rec.en || rec.id,
        oldValues: before, newValues: patch, reason: reason || ''
      });
      return rec;
    }).then(function (r) {
      if (ERP.markMasterDirty) ERP.markMasterDirty();
      ERP.Mirror.refresh();
      return r;
    });
  },

  archive: function (entity, id, on, reason) {
    return Master.update(entity, id, { active: !on, archivedAt: on ? nowISO() : null },
      reason || (on ? 'Archived' : 'Restored'));
  },

  remove: function (entity, id, reason) {
    var count = Master.references(entity, id);
    if (count) {
      return Promise.reject({ validation: [
        'This record is used by ' + count + ' transaction' + (count === 1 ? '' : 's') +
        '. It cannot be deleted — archive it instead, so the history keeps reading correctly.'] });
    }
    var map = { supplier: ['SUPPLIERS', 'suppliers'], customer: ['CUSTOMERS', 'customers'],
                product: ['PRODUCTS', 'products'] };
    var spec = map[entity];
    if (!spec) return Promise.reject({ validation: ['Unknown record type.'] });
    var list = global[spec[0]] || [];
    var rec = list.filter(function (r) { return r.id === id; })[0];
    if (!rec) return Promise.resolve(null);
    return FDB.tx([spec[1], 'auditLog'], function (api) {
      api.del(spec[1], id);
      var ix = list.map(function (r) { return r.id; }).indexOf(id);
      if (ix > -1) list.splice(ix, 1);
      ERP.Audit.write(api, { action: entity + ' deleted', entity: entity, entityId: id,
        ref: rec.co || rec.sh || rec.en || id, oldValues: rec, reason: reason || '' });
    }).then(function () { ERP.Mirror.refresh(); });
  }
};

/* ── purchases offer the mill's own products first ───────────────────────
   Not a restriction: everything else is still one tap away, and picking
   something new offers to remember it for next time. ── */
var origSearch = null;
(function hookPicker() {
  if (!ERP.BuilderUI || origSearch) return;
  origSearch = ERP.BuilderUI.searchProducts;
  ERP.BuilderUI.searchProducts = function (q) {
    var list = origSearch.apply(ERP.BuilderUI, arguments);
    var B = ERP.Builder;
    if (!B || !B.draft || B.mode !== 'purchase' || !B.draft.supplierId) return list;
    var mapped = {};
    Mapping.forSupplier(B.draft.supplierId).forEach(function (m) { mapped[m.productId] = 1; });
    if (!Object.keys(mapped).length) return list;
    return list.slice().sort(function (a, b) {
      var am = mapped[a.id] ? 1 : 0, bm = mapped[b.id] ? 1 : 0;
      return bm - am;
    });
  };
})();

/* remember a new product for that mill after a purchase is saved */
var origPurchaseSave2 = ERP.Purchases.save;
ERP.Purchases.save = function (draft) {
  return origPurchaseSave2.call(ERP.Purchases, draft).then(function (rec) {
    var jobs = ERP.Purchases.items(rec.id)
      .filter(function (it) { return !Mapping.has(rec.supplierId, it.productId); })
      .map(function (it) { return Mapping.add(rec.supplierId, it.productId, { note: 'From ' + rec.purchaseNumber }); });
    return Promise.all(jobs).then(function () { return rec; }).catch(function () { return rec; });
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   SCREENS
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
.md-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start}
@media(max-width:1000px){.md-grid{grid-template-columns:1fr}}
.md-list{max-height:460px;overflow:auto;border:1px solid var(--line);border-radius:var(--r)}
.md-row{display:flex;align-items:center;gap:9px;padding:9px 11px;border-bottom:1px solid var(--line-2);width:100%;
  text-align:left;background:none;border-left:none;border-right:none;border-top:none}
.md-row:last-child{border-bottom:none}
.md-row:hover{background:var(--violet-50)}
.md-row.on{background:var(--violet-50);box-shadow:inset 3px 0 0 var(--violet)}
.md-row b{display:block;font-size:14px}
.md-row span{display:block;font-size:12px;color:var(--muted)}
.md-row .grow{flex:1;min-width:0}
.md-pill{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--surface-2);color:var(--muted)}
.md-pill.pref{background:var(--green-50);color:var(--green)}
.md-search{padding:8px;border-bottom:1px solid var(--line)}
.md-search input{width:100%;padding:8px 10px;border:1.5px solid var(--line);border-radius:var(--r-sm);font-size:15px}
.md-tools{display:flex;gap:6px;align-items:center}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-master-css'; s.textContent = CSS; D.head.appendChild(s); })();

var MAP = { supplierId: null, qLeft: '', qRight: '', filter: '' };

global.PAGES.mapping = function () {
  var sups = (global.SUPPLIERS || []).filter(function (s) {
    return !MAP.qLeft || (s.co || '').toLowerCase().indexOf(MAP.qLeft.toLowerCase()) > -1;
  });
  if (!MAP.supplierId && sups.length) MAP.supplierId = sups[0].id;
  var sup = MAP.supplierId ? global.supOf(MAP.supplierId) : null;
  var mapped = MAP.supplierId ? Mapping.forSupplier(MAP.supplierId) : [];
  var mappedIds = {}; mapped.forEach(function (m) { mappedIds[m.productId] = m; });
  var avail = (global.PRODUCTS || []).filter(function (p) {
    if (p.active === false || mappedIds[p.id]) return false;
    if (MAP.filter && p.cat !== MAP.filter) return false;
    if (MAP.qRight) {
      var hay = [p.en, p.ur, p.brand, p.brandEn, p.cat].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(MAP.qRight.toLowerCase()) === -1) return false;
    }
    return true;
  }).slice(0, 120);

  return '<div class="banner info">' + I('alert') + '<div><p>A mill supplies whatever it actually sends — ' +
      'rice, flour, or both. Map its products here and the category on its profile follows from the mapping.</p></div></div>' +
    '<div class="md-grid">' +
      '<div class="card"><div class="card-h"><h3>Suppliers</h3><span class="pill neu">' +
        (global.SUPPLIERS || []).length + '</span></div>' +
        '<div class="md-search"><input placeholder="Find a mill…" data-mapq="left" value="' + esc(MAP.qLeft) + '"></div>' +
        '<div class="md-list">' + sups.map(function (s) {
          var n = Mapping.forSupplier(s.id).length;
          return '<button class="md-row' + (s.id === MAP.supplierId ? ' on' : '') + '" data-mapsup="' + s.id + '">' +
            '<span class="grow"><b>' + esc(s.co) + '</b><span>' + esc(Mapping.label(s.id)) + '</span></span>' +
            '<span class="md-pill">' + n + '</span></button>';
        }).join('') + '</div></div>' +

      '<div class="card"><div class="card-h"><h3>Products supplied</h3>' +
        '<span class="pill ' + (mapped.length ? 'ok' : 'neu') + '">' + mapped.length + '</span></div>' +
        '<div class="card-b" style="padding:10px 12px">' +
          (sup ? '<b>' + esc(sup.co) + '</b><div class="hint">' + esc(Mapping.label(sup.id)) + '</div>' : '') +
        '</div>' +
        '<div class="md-list">' + (mapped.length ? mapped.map(function (m) {
          var p = global.prodOf(m.productId) || {};
          var ctx = Mapping.context(m.productId);
          return '<div class="md-row">' +
            '<span class="grow"><b>' + u(p.ur || '') + ' ' + esc(p.en || '') + '</b>' +
            '<span>' + esc(p.cat || '') + (ctx.lastCost ? ' · last ' + M.fmt(ctx.lastCost) : '') +
            (ctx.lastDate ? ' · ' + global.fmtDate(ctx.lastDate) : '') + '</span></span>' +
            (m.preferred ? '<span class="md-pill pref">Preferred</span>'
              : '<button class="btn sm" data-mappref="' + m.id + '">Prefer</button>') +
            '<button class="icon-btn sm danger" data-mapdel="' + m.id + '" title="Remove">✕</button></div>';
        }).join('') : '<div class="fcb-none" style="padding:20px">Nothing mapped yet. ' +
          'Add from the list on the right, or simply record a purchase — the mill remembers what it sent.</div>') +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h3>Add a product</h3></div>' +
        '<div class="md-search"><input placeholder="Search products…" data-mapq="right" value="' + esc(MAP.qRight) + '">' +
          '<div class="md-tools" style="margin-top:6px">' +
            ['', 'چاول', 'آٹا', 'وغیرہ'].map(function (cat) {
              return '<button class="btn sm' + (MAP.filter === cat ? ' pri' : '') + '" data-mapfil="' + cat + '">' +
                (cat === '' ? 'All' : cat === 'چاول' ? 'Rice' : cat === 'آٹا' ? 'Flour' : 'Other') + '</button>';
            }).join('') + '</div></div>' +
        '<div class="md-list">' + avail.map(function (p) {
          return '<button class="md-row" data-mapadd="' + p.id + '">' +
            '<span class="grow"><b>' + u(p.ur || '') + ' ' + esc(p.en || '') + '</b>' +
            '<span>' + esc(p.cat || '') + (p.kg ? ' · ' + p.kg + ' KG' : '') + '</span></span>' +
            '<span class="md-pill">Add</span></button>';
        }).join('') + '</div></div>' +
    '</div>';
};
if (global.PAGEMETA) {
  global.PAGEMETA.mapping = ['Supplier product mapping',
    'Which mill supplies which products. The rice or flour label on a supplier comes from this, not from a typed-in category.'];
  global.PAGEMETA.areas = ['Areas & salesmen',
    'Every shop belongs to an area, and every area has someone who collects from it.'];
}

global.PAGES.areas = function () {
  var areas = Areas.all();
  var staff = Staff.all();
  return '<div class="bar"><div class="grow"></div>' +
      '<button class="btn" data-panel="salesman">' + I('plus') + 'Add salesman</button>' +
      '<button class="btn pri" data-panel="area">' + I('plus') + 'Add area</button></div>' +
    '<div class="card"><div class="card-h"><h3>Areas</h3><span class="pill neu">' + areas.length + '</span></div>' +
    '<div class="card-b" style="padding:0"><div class="tw"><table class="fcb-list"><thead><tr>' +
      '<th>Area</th><th class="c">Shops</th><th>Salesman</th><th class="r">Outstanding</th>' +
      '<th>Status</th><th class="c">Actions</th></tr></thead><tbody>' +
      areas.map(function (r) {
        var cs = Areas.customers(r.id);
        var due = cs.reduce(function (a, c) { return a + Math.max(0, ERP.Ledger.customerBalance(c.id)); }, 0);
        var sm = Staff.forRegion(r.id);
        return '<tr><td data-label="Area"><b>' + u(r.ur || '') + '</b><div class="sub">' + esc(r.en || '') + '</div></td>' +
          '<td data-label="Shops" class="c num">' + cs.length + '</td>' +
          '<td data-label="Salesman">' + (sm.length ? esc(sm.map(function (s) { return s.name; }).join(', '))
            : '<span class="hint">Not assigned</span>') + '</td>' +
          '<td data-label="Outstanding" class="r num">' + M.fmtPlain(due) + '</td>' +
          '<td data-label="Status">' + (global.pill ? global.pill(r.active === false ? 'neu' : 'ok',
            r.active === false ? 'Archived' : 'Active') : '') + '</td>' +
          '<td data-label="" class="c fcb-rowacts">' +
            '<button class="btn sm" data-areaedit="' + r.id + '">Edit</button>' +
            '<button class="btn sm" data-areaassign="' + r.id + '">Salesman</button>' +
            '<button class="btn sm" data-collect="' + r.id + '">Collection sheet</button>' +
            '<button class="btn sm" data-areaarchive="' + r.id + '">' +
              (r.active === false ? 'Restore' : 'Archive') + '</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +

    '<div class="card"><div class="card-h"><h3>Salesmen</h3><span class="pill neu">' + staff.length + '</span></div>' +
    '<div class="card-b" style="padding:0">' + (staff.length
      ? '<div class="tw"><table class="fcb-list"><thead><tr><th>Name</th><th>Phone</th>' +
        '<th>Areas</th><th class="c">Shops</th><th class="r">Outstanding</th><th>Status</th>' +
        '<th class="c">Actions</th></tr></thead><tbody>' +
        staff.map(function (s) {
          var cs = Staff.customers(s.id);
          var due = cs.reduce(function (a, c) { return a + Math.max(0, ERP.Ledger.customerBalance(c.id)); }, 0);
          return '<tr><td data-label="Name"><b>' + esc(s.name) + '</b>' +
            (s.employeeId ? '<div class="sub">' + esc(s.employeeId) + '</div>' : '') + '</td>' +
            '<td data-label="Phone">' + esc(s.phone || '—') + '</td>' +
            '<td data-label="Areas">' + ((s.regionIds || []).map(function (id) {
              var a = Areas.byId(id); return a ? esc(a.en) : id; }).join(', ') || '<span class="hint">None</span>') + '</td>' +
            '<td data-label="Shops" class="c num">' + cs.length + '</td>' +
            '<td data-label="Outstanding" class="r num">' + M.fmtPlain(due) + '</td>' +
            '<td data-label="Status">' + (global.pill ? global.pill(s.active === false ? 'neu' : 'ok',
              s.active === false ? 'Archived' : 'Active') : '') + '</td>' +
            '<td data-label="" class="c fcb-rowacts">' +
              '<button class="btn sm" data-smedit="' + s.id + '">Edit</button>' +
              '<button class="btn sm" data-collectsm="' + s.id + '">Collection sheet</button>' +
              '<button class="btn sm" data-smarchive="' + s.id + '">' +
                (s.active === false ? 'Restore' : 'Archive') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty" style="padding:26px"><b>No salesmen yet</b>' +
        '<p>Add the people who visit the shops, then give each of them their areas.</p>' +
        '<button class="btn pri" data-panel="salesman">' + I('plus') + 'Add salesman</button></div>') +
    '</div></div>';
};

/* ══════════════════════════════════════════════════════════════════════════
   PANELS
   ══════════════════════════════════════════════════════════════════════════ */
var EDIT = { area: null, salesman: null, supplier: null, product: null, customer: null, assignArea: null };

global.PANELS.area = {
  t: 'Area', s: 'Add or rename an area', cta: 'Save area',
  f: function () {
    var r = EDIT.area ? Areas.byId(EDIT.area) : null;
    return '<div class="f2">' +
      '<label class="f"><span>Name (English)</span><input data-f="en" value="' + esc(r ? r.en : '') + '"></label>' +
      '<label class="f"><span>Name (Urdu)</span><input data-f="ur" value="' + esc(r ? r.ur : '') + '"></label></div>' +
      (r ? '<div class="banner info">' + I('alert') + '<div><p>' + Areas.customers(r.id).length +
        ' shops are in this area. Renaming it does not move them.</p></div></div>' : '');
  },
  save: function (v) {
    Areas.save({ id: EDIT.area, en: v.en, ur: v.ur }).then(function () {
      EDIT.area = null; global.paint(); say('Area saved.');
    }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save the area.'); });
    return { msg: 'Saving…' };
  }
};

global.PANELS.salesman = {
  t: 'Salesman', s: 'Someone who visits the shops and collects', cta: 'Save salesman',
  f: function () {
    var s = EDIT.salesman ? Staff.byId(EDIT.salesman) : null;
    return '<label class="f"><span>Name</span><input data-f="name" value="' + esc(s ? s.name : '') + '"></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Phone</span><input data-f="phone" class="mono" value="' + esc(s ? s.phone : '') + '"></label>' +
        '<label class="f"><span>WhatsApp</span><input data-f="whatsapp" class="mono" value="' + esc(s ? s.whatsapp : '') + '"></label>' +
      '</div>' +
      '<div class="f2">' +
        '<label class="f"><span>Employee ID</span><input data-f="employeeId" value="' + esc(s ? s.employeeId : '') + '"></label>' +
        '<label class="f"><span>Status</span><select data-f="active">' +
          '<option value="yes"' + (!s || s.active !== false ? ' selected' : '') + '>Active</option>' +
          '<option value="no"' + (s && s.active === false ? ' selected' : '') + '>Archived</option></select></label>' +
      '</div>' +
      '<label class="f"><span>Areas covered</span><select data-f="regions" multiple size="6">' +
        Areas.active().map(function (r) {
          var on = s && (s.regionIds || []).indexOf(r.id) > -1;
          return '<option value="' + r.id + '"' + (on ? ' selected' : '') + '>' + esc(r.en) + ' — ' + esc(r.ur) + '</option>';
        }).join('') + '</select><span class="hint">Hold Ctrl (or Cmd) to pick more than one.</span></label>' +
      '<label class="f"><span>Notes</span><input data-f="notes" value="' + esc(s ? s.notes : '') + '"></label>';
  },
  save: function (v) {
    var sel = D.querySelector('[data-f="regions"]');
    var regions = sel ? Array.prototype.filter.call(sel.options, function (o) { return o.selected; })
      .map(function (o) { return o.value; }) : [];
    Staff.save({ id: EDIT.salesman, name: v.name, phone: v.phone, whatsapp: v.whatsapp,
      employeeId: v.employeeId, notes: v.notes, regionIds: regions, active: v.active !== 'no' })
      .then(function () { EDIT.salesman = null; global.paint(); say('Salesman saved.'); })
      .catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save.'); });
    return { msg: 'Saving…' };
  }
};

global.PANELS.assignarea = {
  t: 'Assign a salesman', s: 'Who collects from this area', cta: 'Assign',
  f: function () {
    var r = Areas.byId(EDIT.assignArea);
    var list = Staff.active();
    if (!list.length) return '<div class="banner warn">' + I('alert') +
      '<div><b>No salesmen yet</b><p>Add one first from Areas &amp; salesmen.</p></div></div>';
    return '<div class="banner info">' + I('pin') + '<div><p>Area: <b>' +
        (r ? esc(r.en) + ' — ' + esc(r.ur) : '') + '</b> · ' +
        (r ? Areas.customers(r.id).length : 0) + ' shops</p></div></div>' +
      '<label class="f"><span>Salesman</span><select data-f="sm">' +
        list.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') +
      '</select></label>';
  },
  save: function (v) {
    Areas.assignSalesman(EDIT.assignArea, v.sm).then(function () {
      global.paint(); say('Area assigned.');
    }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not assign.'); });
    return { msg: 'Assigning…' };
  }
};

global.PANELS.editsupplier = {
  t: 'Supplier details', s: 'Everything about a mill, editable', cta: 'Save supplier',
  f: function () {
    var s = EDIT.supplier ? global.supOf(EDIT.supplier) : null;
    if (!s) return '<p class="hint">Supplier not found.</p>';
    var refs = Master.references('supplier', s.id);
    return '<label class="f"><span>Mill / supplier name</span><input data-f="co" value="' + esc(s.co || '') + '"></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Contact person</span><input data-f="cp" value="' + esc(s.cp || '') + '"></label>' +
        '<label class="f"><span>Mobile</span><input data-f="ph" class="mono" value="' + esc(s.ph || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>WhatsApp</span><input data-f="wa" class="mono" value="' + esc(s.wa || '') + '"></label>' +
        '<label class="f"><span>Email</span><input data-f="email" value="' + esc(s.email || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>City / location</span><input data-f="lo" value="' + esc(s.lo || '') + '"></label>' +
        '<label class="f"><span>NTN</span><input data-f="ntn" class="mono" value="' + esc(s.ntn || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Payment terms</span><input data-f="terms" value="' + esc(s.terms || '') + '" placeholder="e.g. 15 days"></label>' +
        '<label class="f"><span>Status</span><select data-f="active">' +
          '<option value="yes"' + (s.active !== false ? ' selected' : '') + '>Active</option>' +
          '<option value="no"' + (s.active === false ? ' selected' : '') + '>Archived</option></select></label></div>' +
      '<label class="f"><span>Notes</span><input data-f="notes" value="' + esc(s.notes || '') + '"></label>' +
      '<div class="banner info">' + I('box') + '<div><p>Supplies: <b>' + esc(Mapping.label(s.id)) + '</b> · ' +
        Mapping.forSupplier(s.id).length + ' products mapped · ' + refs + ' transactions on record.' +
        (refs ? ' It cannot be deleted, only archived.' : '') + '</p></div></div>';
  },
  save: function (v) {
    Master.update('supplier', EDIT.supplier, {
      co: v.co, cp: v.cp, ph: v.ph, wa: v.wa, email: v.email, lo: v.lo, ntn: v.ntn,
      terms: v.terms, notes: v.notes, active: v.active !== 'no'
    }).then(function () { global.paint(); say('Supplier saved.'); })
      .catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save.'); });
    return { msg: 'Saving…' };
  }
};

global.PANELS.editproduct = {
  t: 'Product details', s: 'Names, prices and the mills that supply it', cta: 'Save product',
  f: function () {
    var p = EDIT.product ? global.prodOf(EDIT.product) : null;
    if (!p) return '<p class="hint">Product not found.</p>';
    var sups = Mapping.forProduct(p.id);
    var ctx = Mapping.context(p.id);
    return '<div class="f2">' +
        '<label class="f"><span>Name (English)</span><input data-f="en" value="' + esc(p.en || '') + '"></label>' +
        '<label class="f"><span>Name (Urdu)</span><input data-f="ur" value="' + esc(p.ur || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Brand</span><input data-f="brandEn" value="' + esc(p.brandEn || p.brand || '') + '"></label>' +
        '<label class="f"><span>Category</span><select data-f="cat">' +
          ['چاول', 'آٹا', 'وغیرہ', 'غیر متعین'].map(function (c) {
            return '<option' + (p.cat === c ? ' selected' : '') + '>' + c + '</option>';
          }).join('') + '</select></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>SKU / folio</span><input data-f="sku" class="mono" value="' + esc(p.sku || p.sourceFolio || '') + '"></label>' +
        '<label class="f"><span>Bag weight (kg)</span><input data-f="kg" inputmode="decimal" value="' + esc(p.kg || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Default selling price</span><input data-f="sell" inputmode="decimal" value="' +
          esc(p.sell || '') + '"></label>' +
        '<label class="f"><span>Minimum selling price</span><input data-f="min" inputmode="decimal" value="' +
          esc(p.min || '') + '"><span class="hint">A warning appears below this.</span></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Reorder level (bags)</span><input data-f="reorder" inputmode="decimal" value="' +
          esc(p.reorder || '') + '"></label>' +
        '<label class="f"><span>Status</span><select data-f="active">' +
          '<option value="yes"' + (p.active !== false ? ' selected' : '') + '>Active</option>' +
          '<option value="no"' + (p.active === false ? ' selected' : '') + '>Archived</option></select></label></div>' +
      '<div class="banner info">' + I('box') + '<div><p>' +
        'Average cost <b>' + M.fmt(ctx.averageCost) + '</b>' +
        (ctx.lastSupplier ? ' · last bought from <b>' + esc(ctx.lastSupplier) + '</b> at ' + M.fmt(ctx.lastCost) : '') +
        ' · ' + Number(ctx.stock).toLocaleString('en-US') + ' bags in stock.</p>' +
        '<p>Mills: ' + (sups.length ? sups.map(function (m) {
          var s = global.supOf(m.supplierId);
          return esc(s ? s.co : m.supplierId) + (m.preferred ? ' (preferred)' : '');
        }).join(', ') : 'none mapped yet') + '</p></div></div>';
  },
  save: function (v) {
    Master.update('product', EDIT.product, {
      en: v.en, ur: v.ur, brandEn: v.brandEn, cat: v.cat, sku: v.sku,
      kg: v.kg ? Number(String(v.kg).replace(/[^\d.]/g, '')) : null,
      sell: v.sell ? Number(String(v.sell).replace(/[^\d.]/g, '')) : null,
      min: v.min ? Number(String(v.min).replace(/[^\d.]/g, '')) : null,
      minSellP: v.min ? M.toP(v.min) : 0,
      reorder: v.reorder ? Number(String(v.reorder).replace(/[^\d.]/g, '')) : null,
      active: v.active !== 'no', needsReview: false
    }).then(function () { global.paint(); say('Product saved.'); })
      .catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save.'); });
    return { msg: 'Saving…' };
  }
};

global.PANELS.editcustomer = {
  t: 'Shop details', s: 'Contact, area and salesman', cta: 'Save shop',
  f: function () {
    var c = EDIT.customer ? global.custBy(EDIT.customer) : null;
    if (!c) return '<p class="hint">Shop not found.</p>';
    return '<label class="f"><span>Shop / business</span><input data-f="sh" value="' + esc(c.sh || '') + '"></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Owner</span><input data-f="ow" value="' + esc(c.ow || '') + '"></label>' +
        '<label class="f"><span>Mobile</span><input data-f="ph" class="mono" value="' + esc(c.ph || '') + '"></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>WhatsApp</span><input data-f="wa" class="mono" value="' + esc(c.wa || '') + '"></label>' +
        '<label class="f"><span>Credit limit</span><input data-f="limit" inputmode="decimal" value="' +
          esc(c.limit || '') + '"></label></div>' +
      '<label class="f"><span>Address</span><input data-f="addr" value="' + esc(c.addr || '') + '"></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Area</span><select data-f="region">' +
          Areas.active().map(function (r) {
            return '<option value="' + r.id + '"' + (c.region === r.id ? ' selected' : '') + '>' +
              esc(r.en) + ' — ' + esc(r.ur) + '</option>';
          }).join('') + '</select>' +
          (c.regionAssumed ? '<span class="hint">This area was assumed from a route file — please confirm it.</span>' : '') +
        '</label>' +
        '<label class="f"><span>Salesman</span><select data-f="salesmanId">' +
          '<option value="">Whoever covers the area</option>' +
          Staff.active().map(function (s) {
            return '<option value="' + s.id + '"' + (c.salesmanId === s.id ? ' selected' : '') + '>' +
              esc(s.name) + '</option>';
          }).join('') + '</select></label>' +
      '</div>' +
      '<div class="f2">' +
        '<label class="f"><span>Route</span><input data-f="route" value="' + esc(c.route || '') + '"></label>' +
        '<label class="f"><span>Status</span><select data-f="active">' +
          '<option value="yes"' + (c.active !== false ? ' selected' : '') + '>Active</option>' +
          '<option value="no"' + (c.active === false ? ' selected' : '') + '>Archived</option></select></label></div>';
  },
  save: function (v) {
    var c = global.custBy(EDIT.customer) || {};
    var moved = c.region !== v.region;
    Master.update('customer', EDIT.customer, {
      sh: v.sh, ow: v.ow, ph: v.ph, wa: v.wa, addr: v.addr, route: v.route,
      region: v.region, regionAssumed: moved ? false : c.regionAssumed,
      salesmanId: v.salesmanId || null,
      limit: v.limit ? Number(String(v.limit).replace(/[^\d.]/g, '')) : null,
      active: v.active !== 'no'
    }, moved ? 'Area changed from ' + (c.region || 'none') + ' to ' + v.region : '')
      .then(function () { global.paint(); say('Shop saved.'); })
      .catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save.'); });
    return { msg: 'Saving…' };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var hit = function (sel) { return e.target.closest(sel); };
  var t;
  if ((t = hit('[data-mapsup]'))) { e.preventDefault(); MAP.supplierId = t.dataset.mapsup; global.paint(); return; }
  if ((t = hit('[data-mapadd]'))) {
    e.preventDefault();
    Mapping.add(MAP.supplierId, t.dataset.mapadd).then(function () { global.paint(); });
    return;
  }
  if ((t = hit('[data-mapdel]'))) { e.preventDefault(); Mapping.remove(t.dataset.mapdel).then(function () { global.paint(); }); return; }
  if ((t = hit('[data-mappref]'))) { e.preventDefault(); Mapping.setPreferred(t.dataset.mappref).then(function () { global.paint(); }); return; }
  if ((t = hit('[data-mapfil]'))) { e.preventDefault(); MAP.filter = t.dataset.mapfil; global.paint(); return; }

  if ((t = hit('[data-areaedit]'))) { e.preventDefault(); EDIT.area = t.dataset.areaedit; global.openPanel('area'); return; }
  if ((t = hit('[data-areaassign]'))) { e.preventDefault(); EDIT.assignArea = t.dataset.areaassign; global.openPanel('assignarea'); return; }
  if ((t = hit('[data-areaarchive]'))) {
    e.preventDefault();
    var r = Areas.byId(t.dataset.areaarchive);
    Areas.archive(r.id, r.active !== false).then(function () { global.paint(); say('Area updated.'); })
      .catch(function (err) { say(err && err.validation ? err.validation[0] : 'Could not archive.'); });
    return;
  }
  if ((t = hit('[data-smedit]'))) { e.preventDefault(); EDIT.salesman = t.dataset.smedit; global.openPanel('salesman'); return; }
  if ((t = hit('[data-smarchive]'))) {
    e.preventDefault();
    var s = Staff.byId(t.dataset.smarchive);
    Staff.archive(s.id, s.active !== false).then(function () { global.paint(); });
    return;
  }
  if ((t = hit('[data-editsupplier]'))) { e.preventDefault(); EDIT.supplier = t.dataset.editsupplier; global.openPanel('editsupplier'); return; }
  if ((t = hit('[data-editproduct]'))) { e.preventDefault(); EDIT.product = t.dataset.editproduct; global.openPanel('editproduct'); return; }
  if ((t = hit('[data-editcustomer]'))) { e.preventDefault(); EDIT.customer = t.dataset.editcustomer; global.openPanel('editcustomer'); return; }
  if ((t = hit('[data-masterdelete]'))) {
    e.preventDefault();
    var parts = t.dataset.masterdelete.split(':');
    Master.remove(parts[0], parts[1]).then(function () { global.paint(); say('Deleted.'); })
      .catch(function (err) { say(err && err.validation ? err.validation[0] : 'Could not delete.'); });
    return;
  }
  if ((t = hit('[data-panel="area"]'))) { EDIT.area = null; }
  if ((t = hit('[data-panel="salesman"]'))) { EDIT.salesman = null; }
}, true);

D.addEventListener('input', function (e) {
  var el = e.target;
  if (!el.dataset || el.dataset.mapq === undefined) return;
  MAP[el.dataset.mapq === 'left' ? 'qLeft' : 'qRight'] = el.value;
  clearTimeout(el._t);
  el._t = setTimeout(function () {
    if (global.cur !== 'mapping') return;
    var which = el.dataset.mapq, pos = el.selectionStart;
    global.paint();
    var back = D.querySelector('[data-mapq="' + which + '"]');
    if (back) { back.focus(); try { back.setSelectionRange(pos, pos); } catch (err) {} }
  }, 180);
});

/* profile screens gain their edit buttons */
['customerProfile', 'supplierProfile'].forEach(function (page) {
  var orig = global.PAGES[page];
  if (!orig) return;
  global.PAGES[page] = function (id) {
    var isCust = page === 'customerProfile';
    return '<div class="bar"><div class="grow"></div>' +
      '<button class="btn" data-' + (isCust ? 'editcustomer' : 'editsupplier') + '="' + id + '">' +
        I('edit') + 'Edit details</button>' +
      (isCust ? '' : '<button class="btn" data-go="mapping">' + I('box') + 'Products supplied</button>') +
      '</div>' + orig(id);
  };
});

/* the new screens join the navigation */
if (global.NAV && !global.NAV.some(function (n) { return n.id === 'areas'; })) {
  var ix = global.NAV.map(function (n) { return n.id; }).indexOf('customers');
  var entries = [{ id: 'areas', l: 'Areas & salesmen', i: 'pin', g: 'Business' },
                 { id: 'mapping', l: 'Supplier products', i: 'box', g: 'Business' }];
  entries.forEach(function (en, k) { global.NAV.splice((ix > -1 ? ix + 1 : global.NAV.length) + k, 0, en); });
}

/* load the new master records */
(ERP.bootPromise || Promise.resolve()).then(function () {
  return FDB.hydrate().then(function (d) {
    S.salesmen = d.salesmen || [];
    S.supplierProducts = d.supplierProducts || [];
  });
}).catch(function () {
  S.salesmen = S.salesmen || []; S.supplierProducts = S.supplierProducts || [];
});
})(typeof window !== 'undefined' ? window : globalThis);
