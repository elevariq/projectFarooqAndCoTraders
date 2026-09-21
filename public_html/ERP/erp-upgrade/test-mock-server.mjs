/* The mock of the business-data API, shared by test-server-db.mjs (the office app on the server driver) and
   test-warehouse-server.mjs (the Warehouse app on the same driver). It follows exactly the rules api/_data.php enforces
   (revisions, atomic commits, conflicts, unique numbers, append-only audit log); those rules are tested against the real
   database by scripts/test-data-core.php. */
import fs from 'fs';
import path from 'path';

export const MANIFEST = JSON.parse(fs.readFileSync(path.resolve('../database/stores.json'), 'utf8'));
export const SEED = JSON.parse(fs.readFileSync(path.resolve('../database/fresh-install-backup.json'), 'utf8'));
SEED.data.users = [{ id: 'usr_seed_owner', createdAt: '2026-09-17T05:00:00.000Z', createdBy: 'system', pin: '', salt: '', active: true, lastSignIn: null, name: 'Owner', role: 'OWNER' }];

/* ── the mock server: same rules as api/_data.php ─────────────────────────── */
export const UNIQUE = { invoices: 'invoiceNumber', purchases: 'purchaseNumber', payments: 'receiptNumber', customerReturns: 'returnNumber',
  supplierReturns: 'returnNumber', orders: 'orderNumber', stockDocs: 'docNumber', accountAdjustments: 'adjustmentNumber',
  expenses: 'expenseNumber', landedCosts: 'referenceNumber', salaryPayments: 'salaryNumber', millingJobs: 'jobNumber',
  millingArrivals: 'arrivalNumber' };
export class Mock {
  constructor(seed, opts = {}) {
    this.backend = opts.backend || 'server'; this.stores = {}; this.version = 1; this.csrf = 'csrf-test-token';
    this.log = []; this.fail = {}; this.commits = 0; this.hydrates = 0; this.reads = 0; this.statusEmpty = false; this.available = true;
    for (const s of Object.keys(MANIFEST)) this.stores[s] = new Map();
    if (seed) for (const s of Object.keys(MANIFEST)) for (const r of (seed.data[s] || [])) this.stores[s].set(String(r[MANIFEST[s].pk]), { r: 1, d: JSON.parse(JSON.stringify(r)) });
  }
  rows(s) { return [...this.stores[s].values()].map(x => x.d); }
  count(s) { return this.stores[s].size; }
  rev(s, k) { const e = this.stores[s].get(k); return e ? e.r : 0; }
  handle(url, init) {
    const u = new URL(url, 'https://farooq.local/'); const p = u.pathname.split('/').pop(); const method = (init && init.method) || 'GET';
    this.log.push(method + ' ' + p);
    if (this.fail[p]) { const f = this.fail[p]; if (f.times-- > 0) { if (!f.times) delete this.fail[p]; if (f.kind === 'network') throw new Error('offline'); return [f.status || 500, { error: 'x' }]; } }
    if (p === 'status.php') return [200, { backend: this.backend, available: this.available, version: this.version, empty: this.statusEmpty, csrf: this.csrf, user: { id: 'u1', role: 'OWNER', name: this.userName || 'Farooq Ahmed', username: 'owner' } }];
    if (p === 'version.php') return [200, { version: this.version }];
    if (p === 'hydrate.php' || p === 'read.php') {
      const only = p === 'read.php' ? (u.searchParams.get('stores') || '').split(',') : null;
      if (p === 'hydrate.php') this.hydrates++; else this.reads++;
      const stores = {};
      const recent = u.searchParams.get('recent');
      if (recent !== null && (p !== 'read.php' || !(+recent >= 1 && +recent <= 1000))) return [400, { error: 'bad recent' }];
      for (const s of Object.keys(MANIFEST)) {
        if (only && !only.includes(s)) continue;
        let list = [...this.stores[s].entries()].map(([k, e]) => [k, e.r, JSON.parse(JSON.stringify(e.d))]);
        if (recent !== null) list = list.reverse().slice(0, +recent);
        stores[s] = list;
      }
      return [200, { version: this.version, stores }];
    }
    if (p === 'commit.php') {
      const h = (init && init.headers) || {};
      if (h['X-CSRF-Token'] !== this.csrf) return [419, { error: 'csrf' }];
      this.commits++;
      const body = JSON.parse(init.body); const conflicts = [];
      const seen = new Set();
      for (const o of body.ops) {
        if (!MANIFEST[o.s]) return [400, { error: 'bad store' }];
        if (o.d && String(o.d[MANIFEST[o.s].pk]) !== o.k) return [400, { error: 'key mismatch' }];
        if (o.s === 'auditLog' && !(o.d && o.r === 0)) return [403, { error: 'append-only' }];
        if (seen.has(o.s + o.k)) return [400, { error: 'dup op' }]; seen.add(o.s + o.k);
        const cur = this.rev(o.s, o.k);
        if (o.r !== null && o.r !== cur) conflicts.push({ s: o.s, k: o.k, expected: o.r, current: cur });
      }
      for (const r of body.reads) { const cur = this.rev(r.s, r.k); if (r.r !== cur) conflicts.push({ s: r.s, k: r.k, expected: r.r, current: cur }); }
      if (conflicts.length) { if (process.env.DEBUG_COMMITS) console.error('CONFLICT', JSON.stringify(conflicts), 'ops:', body.ops.map(o => o.s + '/' + o.k).join(',')); return [409, { ok: false, conflict: conflicts }]; }
      // unique numbers (checked against the state AFTER the batch, like the real indexes)
      const after = {}; for (const s of Object.keys(UNIQUE)) after[s] = new Map([...this.stores[s].entries()].map(([k, e]) => [k, e.d[UNIQUE[s]]]));
      for (const o of body.ops) if (UNIQUE[o.s]) { if (o.d === null) after[o.s].delete(o.k); else after[o.s].set(o.k, o.d[UNIQUE[o.s]]); }
      for (const s of Object.keys(UNIQUE)) { const seenN = new Set(); for (const v of after[s].values()) { if (v === '' || v == null) continue; if (seenN.has(v)) return [409, { ok: false, duplicate: true, error: 'dup number', value: v }]; seenN.add(v); } }
      const revs = [];
      for (const o of body.ops) {
        if (o.d === null) { this.stores[o.s].delete(o.k); revs.push([o.s, o.k, 0]); }
        else { const cur = this.rev(o.s, o.k); this.stores[o.s].set(o.k, { r: cur + 1, d: o.d }); revs.push([o.s, o.k, cur + 1]); }
      }
      this.version++;
      return [200, { ok: true, version: this.version, revs }];
    }
    return [404, { error: 'nope' }];
  }
  fetchFor() {
    return (url, init) => new Promise((resolve, reject) => {
      let res; try { res = this.handle(url, init); } catch (e) { return reject(e); }
      setTimeout(() => resolve({ status: res[0], text: () => Promise.resolve(JSON.stringify(res[1])) }), 0);
    });
  }
}

