/* ══════════════════════════════════════════════════════════════════════════
   PAYROLL — EMPLOYEE SALARY MANAGEMENT

   History. 2026-09-16: a deliberately minimal payment LOG (client: "Payroll =
   Employee salary management system", nothing more). 2026-09-21 the client
   said it again, in a voice note: the people who take their salary from here
   are managed in it — "whoever takes it the first time, we write them down
   afterwards, and the salary is also managed in this". So this is now a real
   monthly salary system, still deliberately small:

     - The people: name, role, phone, the month they start, a monthly salary
       that keeps its HISTORY (a raise from October does not rewrite
       September), and a "last month" when they leave (archive).
     - Per person, per month:   DUE = salary + bonus − deduction
                                PAID = salary payments + advances for that month
                                REMAINING = DUE − PAID
       The month is the month the money is FOR, not the day it was handed over
       (paying September's salary on 2 October counts for September).
     - Four kinds of entry, all in the one `salaryPayments` store (no schema
       change, nothing to apply on the live database):
           SALARY     cash out   — counts as paid for its month
           ADVANCE    cash out   — the same, given before the month is finished
           BONUS      no cash    — adds to what the month is owed
           DEDUCTION  no cash    — takes from what the month is owed
       An entry with no `kind` (everything recorded before this version) is a
       SALARY for the month of its payment date.
     - "Pay salary" can add the person on the spot: choose "New person" and the
       employee and the first payment are saved in ONE transaction.
     - A wrong entry is REVERSED (kept, struck through, never deleted, reason in
       the audit log) — before this version there was no way to undo one.
     - Salary sheet for any month (print / Excel), a month-by-month statement
       per person (print / Excel), and a printable salary slip per entry.

   What the rules refuse, so the screen cannot quietly go wrong: a salary
   payment larger than what is left for that month (record the extra as an
   ADVANCE), a deduction larger than the month's pay, a second person with the
   same name, an impossible date or month, an amount that is not a number.

   Money safety in server mode: every entry claims its client operation id
   (a double-clicked Save cannot pay twice) and touches one small shared row
   per person (`meta` store, `salguard:<id>`), so a second window working from
   an old copy is refused ("NOT saved — reload") instead of paying the same
   month twice. Same pattern as the mill guard in 32-milling.js.

   Not built (say so if asked): tax, attendance, overtime by the hour, loans
   repaid in instalments (record each advance, deduct in the month you want),
   pro-rating a part month (use a Deduction), payslips by e-mail/WhatsApp.
   Browser-side roles only (`PAYROLL_MANAGE`, owner unless given to a role),
   like every screen here — it is not a data boundary.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var M = global.Money, FDB = global.FDB, D = global.document, S = ERP.S;
  if (!M || !FDB || !S || !global.PAGES || !global.PANELS) return;

  (function injectCss() {
    var s = D.createElement('style');
    s.id = 'fc-payroll-css';
    s.textContent = 'table.tbl .sub{font-size:12px;color:var(--muted);margin-top:1px}' +
      'table.tbl td.c,table.tbl th.c{text-align:center}' +
      '.pr-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}' +
      '.pr-bar input[type=month]{height:38px;min-width:150px}' +
      '.pr-bar .pr-title{font-weight:800;font-size:16px;margin:0 6px}' +
      'tr.pr-rev td{color:var(--muted);text-decoration:line-through}' +
      'tr.pr-rev td:last-child,tr.pr-rev td .pill{text-decoration:none}' +
      'tr.pr-tot td{font-weight:800;border-top:2px solid var(--line)}' +
      'a.pr-link,button.pr-link{background:none;border:0;padding:0;color:var(--violet,#5b3df5);cursor:pointer;font:inherit;text-decoration:underline}' +
      '#fcSalNew{border:1px dashed var(--line);border-radius:10px;padding:10px 12px;margin:0 0 10px}';
    D.head.appendChild(s);
  })();

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function I(n) { return global.I ? global.I(n) : (global.icon ? global.icon(n) : ''); }
  function say(m) { try { global.say(m); } catch (e) {} }
  function fmtDate(d) { return global.fmtDate ? global.fmtDate(d) : d; }
  function nowISO() { return new Date().toISOString(); }
  function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
  function pill(cls, label) { return global.pill ? global.pill(cls, label) : esc(label); }
  function currentUser() { return global.CURRENT_USER || 'Owner'; }
  function canManage() { return ERP.Can ? ERP.Can('PAYROLL_MANAGE') : true; }

  /* ════════════════════════════════════════════════════════════════════════
     MONTHS AND DATES
     ════════════════════════════════════════════════════════════════════════ */
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  function isMonth(m) {
    m = String(m || '');
    return MONTH_RE.test(m) && Number(m.slice(0, 4)) >= 2000 && Number(m.slice(0, 4)) <= 2100;
  }
  function isDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
    var d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function monthOf(d) { return String(d || '').slice(0, 7); }
  /* the LOCAL month of a stored UTC timestamp (1 a.m. on the 1st in Pakistan is still last month in UTC) */
  function localMonthOfISO(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? curMonth() : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function curMonth() { return monthOf(today()); }
  function addMonths(m, n) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + n;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + String(mo + 1).padStart(2, '0');
  }
  function monthLabel(m) { return isMonth(m) ? MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4) : String(m || ''); }
  function monthsFrom(a, b) {          /* a..b inclusive, oldest first */
    var out = [], m = a, guard = 0;
    while (m <= b && guard++ < 1200) { out.push(m); m = addMonths(m, 1); }
    return out;
  }
  /* "25,000" / " 25000 " → rupees, or NaN when it is not a plain number */
  function rupees(x) {
    if (typeof x === 'number') return x;
    var t = String(x === null || x === undefined ? '' : x).replace(/[,\s]/g, '');
    if (t === '') return NaN;
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
  }
  var MAX_RUPEES = 1e9;

  var KINDS = ['SALARY', 'ADVANCE', 'BONUS', 'DEDUCTION'];
  var KIND_LABEL = { SALARY: 'Salary', ADVANCE: 'Advance', BONUS: 'Bonus', DEDUCTION: 'Deduction' };
  function isCash(kind) { return kind === 'SALARY' || kind === 'ADVANCE'; }
  function kindOf(p) { return KINDS.indexOf(p && p.kind) > -1 ? p.kind : 'SALARY'; }
  function entryMonth(p) { return isMonth(p && p.periodMonth) ? p.periodMonth : monthOf(p && p.paymentDate); }

  /* One small shared row per person that every entry and reversal reads and
     rewrites inside its own transaction — see the header. */
  function touchGuard(api, empId) {
    var k = 'salguard:' + empId;
    return api.get('meta', k).then(function (g) { api.put('meta', { k: k, v: ((g && Number(g.v)) || 0) + 1 }); });
  }

  /* ════════════════════════════════════════════════════════════════════════
     EMPLOYEES
     ════════════════════════════════════════════════════════════════════════ */
  function allEntries() { return S.salaryPayments || (S.salaryPayments = []); }

  var Employees = ERP.Employees = {
    all: function () { return S.employees || (S.employees = []); },
    active: function () { return Employees.all().filter(function (e) { return e.active !== false; }); },
    byId: function (id) { return Employees.all().filter(function (e) { return e.id === id; })[0] || null; },

    /* the first month they are owed a salary. Older records have none: fall
       back to the month of their first entry, then the month they were added */
    startMonthOf: function (e) {
      if (e && isMonth(e.startMonth)) return e.startMonth;
      var first = null;
      allEntries().forEach(function (p) {
        if (e && p.employeeId === e.id && p.status !== 'REVERSED') {
          var m = entryMonth(p); if (!first || m < first) first = m;
        }
      });
      if (first) return first;
      return e && e.createdAt ? localMonthOfISO(e.createdAt) : curMonth();
    },
    /* the monthly salary that applied in a month (history, not just today's) */
    rateAt: function (e, month) {
      if (!e) return 0;
      var rates = (e.rates || []).slice().sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
      if (!rates.length) return e.monthlySalaryP || 0;
      var r = rates[0].salaryP;
      rates.forEach(function (x) { if (x.from <= month) r = x.salaryP; });
      return r;
    },
    /* is the person on the payroll in that month (started, and not left before it) */
    inMonth: function (e, month) {
      return month >= Employees.startMonthOf(e) && (!e.endMonth || month <= e.endMonth);
    },

    /* the pure part of save(): what is wrong with this input (nothing written) */
    check: function (o) {
      var errs = [];
      var name = String(o.name || '').trim().replace(/\s+/g, ' ');
      if (!name) errs.push('Enter the employee’s name.');
      else if (/[<>"]/.test(name)) errs.push('The name cannot contain < > or ".');
      var existing = o.id ? Employees.byId(o.id) : null;
      if (o.id && !existing) errs.push('That employee is no longer on the list.');
      if (name) {
        var low = name.toLowerCase();
        if (Employees.all().some(function (e) { return e.id !== o.id && String(e.name || '').trim().toLowerCase() === low; })) {
          errs.push('“' + name + '” is already on the list — choose them there, or add a word to tell the two apart.');
        }
      }
      var sal = o.monthlySalary === undefined || o.monthlySalary === '' ? 0 : rupees(o.monthlySalary);
      if (isNaN(sal)) errs.push('Enter the monthly salary as a number, for example 25000.');
      else if (sal < 0) errs.push('Monthly salary can’t be negative.');
      else if (sal > MAX_RUPEES) errs.push('That monthly salary is too large — check the digits.');
      if (o.startMonth && !isMonth(o.startMonth)) errs.push('Choose the month they start from.');
      if (o.effectiveFrom && !isMonth(o.effectiveFrom)) errs.push('Choose the month the new salary starts from.');
      return errs;
    },

    save: function (o) {
      var errs = Employees.check(o);
      if (errs.length) return Promise.reject({ validation: errs });
      var existing = o.id ? Employees.byId(o.id) : null;
      var name = String(o.name).trim().replace(/\s+/g, ' ');
      var salaryP = M.toP(o.monthlySalary === undefined || o.monthlySalary === '' ? 0 : rupees(o.monthlySalary));
      var start = isMonth(o.startMonth) ? o.startMonth : (existing ? Employees.startMonthOf(existing) : curMonth());
      var eff = isMonth(o.effectiveFrom) ? o.effectiveFrom : curMonth();
      if (eff < start) eff = start;

      var rec = Object.assign({
        id: o.id || FDB.uid('emp'), createdAt: nowISO(), createdBy: currentUser()
      }, existing || {}, {
        name: name, role: String(o.role || '').trim(), phone: String(o.phone || '').trim(),
        notes: String(o.notes || '').trim(), startMonth: start, updatedAt: nowISO()
      });

      /* salary history: a changed figure starts in `eff`; nothing before it moves */
      var rates = existing
        ? (existing.rates && existing.rates.length ? existing.rates.slice()
            : [{ from: Employees.startMonthOf(existing), salaryP: existing.monthlySalaryP || 0 }])
        : [];
      if (!existing) rates = [{ from: start, salaryP: salaryP }];
      else if (o.monthlySalary !== undefined && Employees.rateAt(existing, eff) !== salaryP) {
        rates = rates.filter(function (r) { return r.from !== eff; });
        rates.push({ from: eff, salaryP: salaryP });
      }
      rates.sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
      rec.rates = rates;
      rec.monthlySalaryP = Employees.rateAt(rec, curMonth());

      var active = o.active === undefined ? (existing ? existing.active !== false : true) : !!o.active;
      rec.active = active;
      rec.endMonth = active ? '' : (isMonth(o.endMonth) ? o.endMonth : ((existing && existing.endMonth) || curMonth()));

      return FDB.tx(['employees', 'auditLog'], function (api) {
        api.put('employees', rec);
        ERP.Audit.write(api, {
          action: existing ? 'Employee updated' : 'Employee added', entity: 'Employee',
          entityId: rec.id, ref: rec.name,
          oldValues: existing ? { name: existing.name, role: existing.role, monthlySalary: M.toR(existing.monthlySalaryP) } : null,
          newValues: { name: rec.name, role: rec.role, monthlySalary: M.toR(rec.monthlySalaryP), startMonth: rec.startMonth, active: rec.active }
        });
        return rec;
      }).then(function (r) { putEmployee(r); return r; });
    },
    /* archive keeps the person and their history; the current month is still owed */
    archive: function (id, on) {
      var e = Employees.byId(id);
      if (!e) return Promise.resolve(null);
      var rec = Object.assign({}, e, { active: !on, endMonth: on ? (e.endMonth || curMonth()) : '', updatedAt: nowISO() });
      return FDB.tx(['employees', 'auditLog'], function (api) {
        api.put('employees', rec);
        ERP.Audit.write(api, { action: on ? 'Employee archived' : 'Employee restored',
          entity: 'Employee', entityId: id, ref: e.name });
        return rec;
      }).then(function (r) { putEmployee(r); return r; });
    }
  };
  function putEmployee(rec) {
    var ix = Employees.all().map(function (e) { return e.id; }).indexOf(rec.id);
    if (ix > -1) Employees.all()[ix] = rec; else Employees.all().push(rec);
  }

  /* ════════════════════════════════════════════════════════════════════════
     SALARY ENTRIES AND THE MONTH FIGURES
     ════════════════════════════════════════════════════════════════════════ */
  function byDate(a, b) {
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? -1 : 1;
    return (a.createdAt || '') < (b.createdAt || '') ? -1 : ((a.createdAt || '') > (b.createdAt || '') ? 1 : 0);
  }

  var Payroll = ERP.Payroll = {
    KINDS: KINDS, KIND_LABEL: KIND_LABEL,
    monthLabel: monthLabel, addMonths: addMonths, currentMonth: curMonth, kindOf: kindOf, entryMonth: entryMonth,

    /* every entry of a person, oldest first; `all:true` keeps the reversed ones */
    entriesFor: function (employeeId, all) {
      return allEntries().filter(function (p) {
        return p.employeeId === employeeId && (all || p.status !== 'REVERSED');
      }).sort(byDate);
    },
    /* money actually handed over (salary + advances) */
    paymentsFor: function (employeeId) {
      return Payroll.entriesFor(employeeId).filter(function (p) { return isCash(kindOf(p)); });
    },
    totalPaid: function (employeeId) {
      return Payroll.paymentsFor(employeeId).reduce(function (a, p) { return a + p.amount; }, 0);
    },
    lastPaymentDate: function (employeeId) {
      var rows = Payroll.paymentsFor(employeeId);
      return rows.length ? rows[rows.length - 1].paymentDate : null;
    },
    /* has anything been handed over FOR this month */
    paidThisMonth: function (employeeId, monthKey) {
      monthKey = monthKey || curMonth();
      return Payroll.paymentsFor(employeeId).some(function (p) { return entryMonth(p) === monthKey; });
    },

    /* The figures for one person in one month. `emp` may be a person who is not
       saved yet, and `entries` the entries to count (default: their saved ones). */
    sheet: function (emp, month, entries) {
      entries = entries || (emp && emp.id ? Payroll.entriesFor(emp.id) : []);
      var accrues = emp && Employees.inMonth(emp, month) && month <= curMonth();
      var r = { month: month, rateP: accrues ? Employees.rateAt(emp, month) : 0,
        planP: emp && Employees.inMonth(emp, month) ? Employees.rateAt(emp, month) : 0,
        bonusP: 0, deductionP: 0, salaryPaidP: 0, advanceP: 0, entries: [] };
      entries.forEach(function (p) {
        if (p.status === 'REVERSED' || entryMonth(p) !== month) return;
        var k = kindOf(p); r.entries.push(p);
        if (k === 'BONUS') r.bonusP += p.amount;
        else if (k === 'DEDUCTION') r.deductionP += p.amount;
        else if (k === 'ADVANCE') r.advanceP += p.amount;
        else r.salaryPaidP += p.amount;
      });
      r.dueP = r.rateP + r.bonusP - r.deductionP;
      r.paidP = r.salaryPaidP + r.advanceP;
      r.balanceP = r.dueP - r.paidP;
      r.status = r.entries.length === 0 && r.dueP === 0 ? (month > curMonth() && r.planP ? 'future' : 'none')
        : r.paidP > r.dueP ? 'ahead'
        : r.paidP === r.dueP ? (r.dueP === 0 ? 'none' : 'paid')
        : r.paidP > 0 ? 'part' : (month > curMonth() ? 'future' : 'unpaid');
      return r;
    },
    /* month by month, oldest first, from the start month to the latest month
       that has anything in it (or today) */
    statement: function (empId) {
      var emp = Employees.byId(empId); if (!emp) return null;
      var entries = Payroll.entriesFor(empId);
      var first = Employees.startMonthOf(emp), last = curMonth();
      entries.forEach(function (p) {
        var m = entryMonth(p); if (m < first) first = m; if (m > last) last = m;
      });
      var months = monthsFrom(first, last).map(function (m) { return Payroll.sheet(emp, m, entries); });
      var t = { dueP: 0, paidP: 0, balanceP: 0, bonusP: 0, deductionP: 0, advanceP: 0, rateP: 0 };
      months.forEach(function (x) {
        t.dueP += x.dueP; t.paidP += x.paidP; t.balanceP += x.balanceP;
        t.bonusP += x.bonusP; t.deductionP += x.deductionP; t.advanceP += x.advanceP; t.rateP += x.rateP;
      });
      return { employee: emp, months: months, totals: t };
    },
    /* the whole payroll for one month: who is on it, and the totals */
    monthSheet: function (month) {
      var rows = [];
      Employees.all().forEach(function (e) {
        var has = allEntries().some(function (p) { return p.employeeId === e.id && p.status !== 'REVERSED' && entryMonth(p) === month; });
        if (!Employees.inMonth(e, month) && !has) return;
        rows.push({ employee: e, sheet: Payroll.sheet(e, month) });
      });
      rows.sort(function (a, b) {
        return String(a.employee.name).toLowerCase() < String(b.employee.name).toLowerCase() ? -1 : 1;
      });
      var t = { people: rows.length, rateP: 0, planP: 0, bonusP: 0, deductionP: 0, dueP: 0, paidP: 0, balanceP: 0 };
      rows.forEach(function (r) {
        var s = r.sheet; t.rateP += s.rateP; t.planP += s.planP; t.bonusP += s.bonusP; t.deductionP += s.deductionP;
        t.dueP += s.dueP; t.paidP += s.paidP; t.balanceP += s.balanceP;
      });
      return { month: month, rows: rows, totals: t };
    },
    /* cash handed out between two dates (inclusive; null = open) — what the
       profit report subtracts, on the same day-of-payment basis as expenses */
    paidInRange: function (from, to) {
      var t = 0;
      allEntries().forEach(function (p) {
        if (p.status === 'REVERSED' || !isCash(kindOf(p))) return;
        if ((!from || p.paymentDate >= from) && (!to || p.paymentDate <= to)) t += p.amount;
      });
      return t;
    },

    /* the pure part of pay(): everything that would make it be refused, so the
       panel can say so while it is still open. Nothing is written. */
    check: function (o) {
      var errs = [];
      var kind = String(o.kind || 'SALARY').toUpperCase();
      if (KINDS.indexOf(kind) < 0) errs.push('Choose what this entry is: salary, advance, bonus or deduction.');
      var amt = rupees(o.amount);
      if (isNaN(amt) || !(amt > 0)) errs.push('Enter an amount greater than zero, as a number.');
      else if (amt > MAX_RUPEES) errs.push('That amount is too large — check the digits.');
      var date = o.date || today();
      if (!isDate(date)) errs.push('Choose a real date.');
      var month = o.periodMonth || (isDate(date) ? monthOf(date) : '');
      if (!isMonth(month)) errs.push('Choose the month this is for.');
      var method = o.method || 'Cash';
      if (isCash(kind) && (ERP.ENUM.methods || []).indexOf(method) < 0) errs.push('Choose how it was paid.');

      var emp = null;
      if (o.newEmployee) {
        var ne = Object.assign({}, o.newEmployee);
        var nErrs = Employees.check({ name: ne.name, monthlySalary: ne.monthlySalary, startMonth: ne.startMonth });
        errs = errs.concat(nErrs);
        if (!nErrs.length && isMonth(month)) {
          var sal = ne.monthlySalary === undefined || ne.monthlySalary === '' ? 0 : rupees(ne.monthlySalary);
          var st = isMonth(ne.startMonth) ? ne.startMonth : month;
          emp = { id: null, startMonth: st, monthlySalaryP: M.toP(sal), rates: [{ from: st, salaryP: M.toP(sal) }], active: true };
        }
      } else {
        emp = Employees.byId(o.employeeId);
        if (!emp) errs.push('Choose an employee.');
      }
      if (errs.length || !emp) return errs;

      var amountP = M.toP(amt), sh = Payroll.sheet(emp, month), label = monthLabel(month);
      if (kind === 'SALARY') {
        if (sh.dueP <= 0) errs.push('Nothing is due to ' + (o.newEmployee ? 'this person' : emp.name) + ' for ' + label +
          (month > curMonth() ? ' yet — that month has not started. To pay ahead, record an Advance.' :
            '. Set their monthly salary first, or record an Advance.'));
        else if (amountP > sh.balanceP) errs.push('That is more than what is left for ' + label + ' (' + M.fmt(Math.max(0, sh.balanceP)) +
          '). To give more, record the extra as an Advance.');
      } else if (kind === 'DEDUCTION') {
        if (amountP > sh.dueP) errs.push('A deduction cannot be more than what ' + label + ' is worth (' + M.fmt(Math.max(0, sh.dueP)) + ').');
      }
      return errs;
    },

    /* Record an entry. `newEmployee: {name, role, phone, monthlySalary, startMonth}` adds the person and the entry in one go. */
    pay: function (o) {
      if (!canManage()) return Promise.reject({ validation: ['Salaries are not open to your role.'] });
      var errs = Payroll.check(o);
      if (errs.length) return Promise.reject({ validation: errs });
      var kind = String(o.kind || 'SALARY').toUpperCase();
      var date = o.date || today();
      var month = o.periodMonth || monthOf(date);
      var amountP = M.toP(rupees(o.amount));
      var emp = o.newEmployee ? null : Employees.byId(o.employeeId);
      var newEmp = null;
      if (o.newEmployee) {
        var ne = o.newEmployee, sal = M.toP(ne.monthlySalary === undefined || ne.monthlySalary === '' ? 0 : rupees(ne.monthlySalary));
        var st = isMonth(ne.startMonth) ? ne.startMonth : month;
        newEmp = {
          id: FDB.uid('emp'), name: String(ne.name).trim().replace(/\s+/g, ' '), role: String(ne.role || '').trim(),
          phone: String(ne.phone || '').trim(), notes: '', startMonth: st, rates: [{ from: st, salaryP: sal }],
          monthlySalaryP: 0, active: true, endMonth: '', createdAt: nowISO(), createdBy: currentUser(), updatedAt: nowISO()
        };
        newEmp.monthlySalaryP = Employees.rateAt(newEmp, curMonth());
        emp = newEmp;
      }
      var id = FDB.uid('sal');
      var opId = (o.clientOpId || id) + '#0';

      return FDB.tx(['sequences', 'salaryPayments', 'employees', 'auditLog', 'operations', 'meta'], function (api) {
        return FDB.claimOperation(api, opId, 'SalaryEntry', { entityId: id }).then(function () {
          return touchGuard(api, emp.id);
        }).then(function () {
          return FDB.nextNumber(api, 'SAL');
        }).then(function (number) {
          var rec = {
            id: id, salaryNumber: number, clientOpId: o.clientOpId || id, employeeId: emp.id,
            employeeNameSnapshot: emp.name, employeeRoleSnapshot: emp.role || '',
            kind: kind, amount: amountP,
            method: isCash(kind) ? (o.method || 'Cash') : '', reference: isCash(kind) ? String(o.reference || '') : '',
            periodMonth: month, period: String(o.period || '') || monthLabel(month),
            paymentDate: date, note: String(o.note || ''),
            status: 'POSTED', paidBy: currentUser(), createdAt: nowISO(), createdBy: currentUser()
          };
          if (newEmp) {
            api.put('employees', newEmp);
            ERP.Audit.write(api, { action: 'Employee added', entity: 'Employee', entityId: newEmp.id, ref: newEmp.name,
              newValues: { name: newEmp.name, role: newEmp.role, monthlySalary: M.toR(newEmp.monthlySalaryP), startMonth: newEmp.startMonth,
                           note: 'added while recording their first ' + KIND_LABEL[kind].toLowerCase() } });
          }
          api.put('salaryPayments', rec);
          ERP.Audit.write(api, {
            action: KIND_LABEL[kind] === 'Salary' ? 'Salary paid' : (KIND_LABEL[kind] + ' recorded'),
            entity: 'SalaryPayment', entityId: rec.id, ref: rec.salaryNumber,
            newValues: { employee: rec.employeeNameSnapshot, kind: kind, amount: M.toR(rec.amount), month: month }
          });
          return rec;
        });
      }).then(function (rec) {
        if (newEmp) putEmployee(newEmp);
        allEntries().unshift(rec);
        return rec;
      }).catch(function (err) {
        if (err && err.duplicate) throw { validation: [err.message] };
        throw err;
      });
    },

    /* undo an entry: kept, marked reversed, never counted again */
    reverse: function (id, reason) {
      if (!canManage()) return Promise.reject({ validation: ['Salaries are not open to your role.'] });
      var p = allEntries().filter(function (x) { return x.id === id; })[0];
      if (!p) return Promise.reject({ validation: ['That entry no longer exists.'] });
      if (p.status === 'REVERSED') return Promise.reject({ validation: ['That entry is already reversed.'] });
      reason = String(reason || '').trim() || 'No reason given';
      var rec = Object.assign({}, p, { status: 'REVERSED', reversedAt: nowISO(), reversedBy: currentUser(), reverseReason: reason });
      return FDB.tx(['salaryPayments', 'auditLog', 'meta'], function (api) {
        return touchGuard(api, p.employeeId).then(function () {
          api.put('salaryPayments', rec);
          ERP.Audit.write(api, { action: 'Salary entry reversed', entity: 'SalaryPayment', entityId: id, ref: p.salaryNumber,
            reason: reason, oldValues: { kind: kindOf(p), amount: M.toR(p.amount), month: entryMonth(p) } });
          return rec;
        });
      }).then(function (r) {
        var ix = allEntries().map(function (x) { return x.id; }).indexOf(id);
        if (ix > -1) allEntries()[ix] = r;
        return r;
      });
    },

    /* ── documents ─────────────────────────────────────────────────────── */
    sheetDoc: function (month) {
      var ms = Payroll.monthSheet(month), t = ms.totals;
      var rows = ms.rows.map(function (r, i) {
        var s = r.sheet;
        return { sr: String(i + 1), description: r.employee.name + (r.employee.role ? ' — ' + r.employee.role : ''),
          salary: M.fmtPlain(s.rateP), adj: (s.bonusP ? '+' + M.fmtPlain(s.bonusP) : '') + (s.bonusP && s.deductionP ? ' ' : '') + (s.deductionP ? '−' + M.fmtPlain(s.deductionP) : '') || '—',
          due: M.fmtPlain(s.dueP), paid: M.fmtPlain(s.paidP), left: M.fmtPlain(s.balanceP) };
      });
      var m = ERP.Analytics.docModel({
        id: 'payrollsheet', title: 'Salary sheet — ' + monthLabel(month), from: null, to: null,
        partyLabel: 'PAYROLL FOR', partyName: ERP.Settings.get().businessName,
        columns: [
          { key: 'sr', label: '#', width: 0.05 }, { key: 'description', label: 'Employee', width: 0.29 },
          { key: 'salary', label: 'Salary', align: 'right', width: 0.13 }, { key: 'adj', label: 'Bonus / deduction', align: 'right', width: 0.15 },
          { key: 'due', label: 'Due', align: 'right', width: 0.13 }, { key: 'paid', label: 'Paid', align: 'right', width: 0.12 },
          { key: 'left', label: 'Remaining', align: 'right', width: 0.13 }
        ],
        rows: rows,
        footer: { description: 'TOTAL', salary: M.fmtPlain(t.rateP), due: M.fmtPlain(t.dueP), paid: M.fmtPlain(t.paidP), left: M.fmtPlain(t.balanceP) },
        meta: [['Month', monthLabel(month)], ['People', String(t.people)]],
        totals: [{ label: 'Due for ' + monthLabel(month), value: M.fmt(t.dueP) }, { label: 'Paid', value: M.fmt(t.paidP) },
          { label: 'REMAINING', value: M.fmt(t.balanceP), big: true, rule: true }],
        summary: 'Due = salary + bonus − deduction. Paid = salary payments and advances made for this month. A negative remaining figure means paid ahead.'
      });
      m.meta = m.meta.filter(function (x) { return x[0] !== 'Period' && x[0] !== 'Records'; });
      return m;
    },
    statementDoc: function (empId) {
      var st = Payroll.statement(empId); if (!st) return null;
      var e = st.employee, t = st.totals;
      var rows = st.months.slice().reverse().filter(function (s) { return s.dueP || s.paidP || s.entries.length; }).map(function (s, i) {
        return { sr: String(i + 1), description: monthLabel(s.month), salary: M.fmtPlain(s.rateP),
          bonus: s.bonusP ? M.fmtPlain(s.bonusP) : '—', ded: s.deductionP ? M.fmtPlain(s.deductionP) : '—',
          due: M.fmtPlain(s.dueP), paid: M.fmtPlain(s.paidP), left: M.fmtPlain(s.balanceP) };
      });
      var m = ERP.Analytics.docModel({
        id: 'salarystatement', title: 'Salary statement', from: null, to: null,
        partyLabel: 'EMPLOYEE', partyName: e.name, partyContact: e.phone || '',
        columns: [
          { key: 'sr', label: '#', width: 0.05 }, { key: 'description', label: 'Month', width: 0.2 },
          { key: 'salary', label: 'Salary', align: 'right', width: 0.12 }, { key: 'bonus', label: 'Bonus', align: 'right', width: 0.11 },
          { key: 'ded', label: 'Deduction', align: 'right', width: 0.12 }, { key: 'due', label: 'Due', align: 'right', width: 0.13 },
          { key: 'paid', label: 'Paid', align: 'right', width: 0.13 }, { key: 'left', label: 'Balance', align: 'right', width: 0.14 }
        ],
        rows: rows,
        footer: { description: 'TOTAL', salary: M.fmtPlain(t.rateP), bonus: M.fmtPlain(t.bonusP), ded: M.fmtPlain(t.deductionP),
          due: M.fmtPlain(t.dueP), paid: M.fmtPlain(t.paidP), left: M.fmtPlain(t.balanceP) },
        meta: [['Role', e.role || '—'], ['On payroll from', monthLabel(Employees.startMonthOf(e))]],
        totals: [{ label: 'Total due', value: M.fmt(t.dueP) }, { label: 'Total paid', value: M.fmt(t.paidP) },
          { label: t.balanceP >= 0 ? 'STILL OWED TO THEM' : 'PAID AHEAD', value: M.fmt(Math.abs(t.balanceP)), big: true, rule: true }],
        summary: 'Reversed entries are not counted.'
      });
      m.meta = m.meta.filter(function (x) { return x[0] !== 'Period' && x[0] !== 'Records'; });
      return m;
    },
    /* a slip for one entry: what the month was worth and where it stands */
    slipDoc: function (entryId) {
      var p = allEntries().filter(function (x) { return x.id === entryId; })[0]; if (!p) return null;
      var e = Employees.byId(p.employeeId) || { name: p.employeeNameSnapshot, role: p.employeeRoleSnapshot, phone: '' };
      var month = entryMonth(p), sh = Payroll.sheet(Employees.byId(p.employeeId), month);
      var lines = [['Salary for ' + monthLabel(month), M.fmtPlain(sh.rateP)]];
      if (sh.bonusP) lines.push(['Bonus', M.fmtPlain(sh.bonusP)]);
      if (sh.deductionP) lines.push(['Deduction', '−' + M.fmtPlain(sh.deductionP)]);
      lines.push(['Due for the month', M.fmtPlain(sh.dueP)], ['Paid in total for the month', M.fmtPlain(sh.paidP)]);
      var rows = lines.map(function (l, i) { return { sr: String(i + 1), description: l[0], amount: l[1] }; });
      var m = ERP.Analytics.docModel({
        id: 'salaryslip', number: p.salaryNumber, title: KIND_LABEL[kindOf(p)] === 'Salary' ? 'Salary slip' : (KIND_LABEL[kindOf(p)] + ' slip'),
        from: null, to: null, partyLabel: 'EMPLOYEE', partyName: e.name, partyContact: e.phone || '',
        columns: [{ key: 'sr', label: '#', width: 0.08 }, { key: 'description', label: 'Description', width: 0.62 },
          { key: 'amount', label: 'Rs.', align: 'right', width: 0.3 }],
        rows: rows,
        meta: [['Entry', p.salaryNumber + ' · ' + KIND_LABEL[kindOf(p)]], ['Date', fmtDate(p.paymentDate)],
          ['For month', monthLabel(month)], ['Method', p.method || '—']],
        totals: [{ label: KIND_LABEL[kindOf(p)] + ' recorded now', value: M.fmt(p.amount), bold: true },
          { label: sh.balanceP >= 0 ? 'STILL TO PAY FOR THE MONTH' : 'PAID AHEAD', value: M.fmt(Math.abs(sh.balanceP)), big: true, rule: true }],
        summary: p.note || ''
      });
      m.meta = m.meta.filter(function (x) { return x[0] !== 'Period' && x[0] !== 'Records' && x[0] !== 'Generated'; });
      m.signatures = ['Received by (employee)', 'Paid by'];
      return m;
    },
    sheets: function (month) {
      var ms = Payroll.monthSheet(month), t = ms.totals;
      var rows = [['Salary sheet — ' + monthLabel(month)], [],
        ['Employee', 'Role', 'Salary', 'Bonus', 'Deduction', 'Due', 'Salary paid', 'Advances', 'Paid', 'Remaining']];
      ms.rows.forEach(function (r) {
        var s = r.sheet;
        rows.push([r.employee.name, r.employee.role || '', M.toR(s.rateP), M.toR(s.bonusP), M.toR(s.deductionP), M.toR(s.dueP),
          M.toR(s.salaryPaidP), M.toR(s.advanceP), M.toR(s.paidP), M.toR(s.balanceP)]);
      });
      rows.push([], ['TOTAL', '', M.toR(t.rateP), M.toR(t.bonusP), M.toR(t.deductionP), M.toR(t.dueP), '', '', M.toR(t.paidP), M.toR(t.balanceP)]);
      return [{ name: 'Salary sheet', rows: rows }];
    },
    statementSheets: function (empId) {
      var st = Payroll.statement(empId); if (!st) return [];
      var mrows = [['Salary statement — ' + st.employee.name], [], ['Month', 'Salary', 'Bonus', 'Deduction', 'Due', 'Paid', 'Balance']];
      st.months.slice().reverse().forEach(function (s) {
        if (s.dueP || s.paidP || s.entries.length) mrows.push([monthLabel(s.month), M.toR(s.rateP), M.toR(s.bonusP), M.toR(s.deductionP), M.toR(s.dueP), M.toR(s.paidP), M.toR(s.balanceP)]);
      });
      var t = st.totals;
      mrows.push([], ['TOTAL', M.toR(t.rateP), M.toR(t.bonusP), M.toR(t.deductionP), M.toR(t.dueP), M.toR(t.paidP), M.toR(t.balanceP)]);
      var erows = [['Date', 'Number', 'Type', 'For month', 'Method', 'Reference', 'Note', 'Amount', 'Status']];
      Payroll.entriesFor(empId, true).forEach(function (p) {
        erows.push([p.paymentDate, p.salaryNumber, KIND_LABEL[kindOf(p)], monthLabel(entryMonth(p)), p.method || '', p.reference || '',
          p.note || '', M.toR(p.amount), p.status === 'REVERSED' ? 'Reversed: ' + (p.reverseReason || '') : 'Posted']);
      });
      return [{ name: 'By month', rows: mrows }, { name: 'Entries', rows: erows }];
    }
  };

  /* exposed so callers (and tests, after simulating a restart) can know
     when the payroll stores have actually finished loading, rather than
     guessing with a fixed delay — the same pattern 16-khata.js uses for
     ERP.adjustmentsReady */
  ERP.payrollReady = (ERP.bootPromise || Promise.resolve()).then(function () {
    return FDB.hydrate().then(function (d) {
      S.employees = d.employees || [];
      S.salaryPayments = d.salaryPayments || [];
    });
  }).catch(function () {
    S.employees = S.employees || []; S.salaryPayments = S.salaryPayments || [];
  });

  /* ════════════════════════════════════════════════════════════════════════
     THE SCREEN
     ════════════════════════════════════════════════════════════════════════ */
  var PR = { selectedId: null, month: null };
  var EMP_EDIT = null, PAYSAL_FOR = null, PAYSAL_KIND = 'SALARY', PAYSAL_OP = null, PAYSAL_MONTH = null;

  function card(cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }
  function statusPill(s) {
    return s === 'paid' ? pill('ok', 'Paid') : s === 'part' ? pill('warn', 'Part paid') :
      s === 'unpaid' ? pill('warn', 'Not paid') : s === 'ahead' ? pill('info', 'Paid ahead') :
      s === 'future' ? pill('neu', 'Not due yet') : pill('neu', '—');
  }
  function adjText(s) {
    var a = [];
    if (s.bonusP) a.push('+' + M.fmtPlain(s.bonusP));
    if (s.deductionP) a.push('−' + M.fmtPlain(s.deductionP));
    return a.length ? a.join(' ') : '—';
  }
  function remainText(p) { return p < 0 ? '(' + M.fmtPlain(-p) + ')' : M.fmtPlain(p); }
  function month() { return isMonth(PR.month) ? PR.month : curMonth(); }

  global.PAGES.payroll = function () {
    var mo = month(), ms = Payroll.monthSheet(mo), t = ms.totals;

    var bar = '<div class="pr-bar">' +
      '<button class="btn sm" data-prmove="-1" title="Previous month">‹</button>' +
      '<input type="month" data-prmonth value="' + esc(mo) + '">' +
      '<button class="btn sm" data-prmove="1" title="Next month">›</button>' +
      '<span class="pr-title">' + esc(monthLabel(mo)) + '</span>' +
      (mo !== curMonth() ? '<button class="btn sm" data-prmove="0">This month</button>' : '') +
      '<div class="grow"></div>' +
      '<button class="btn sm" data-prsheetprint>' + I('print') + 'Print</button>' +
      '<button class="btn sm" data-prsheetxls>' + I('download') + 'Excel</button>' +
      '<button class="btn pri" data-prpay="">' + I('wallet') + 'Pay salary</button>' +
      '</div>';

    var cards = '<div class="kh-cards" style="margin-bottom:12px">' +
      card('', 'People', String(t.people)) +
      card('', 'Due for ' + monthLabel(mo).split(' ')[0], M.fmt(t.dueP)) +
      card('credit', 'Paid', M.fmt(t.paidP)) +
      card(t.balanceP > 0 ? 'due' : 'credit', t.balanceP < 0 ? 'Paid ahead' : 'Remaining', M.fmt(Math.abs(t.balanceP))) +
      '</div>';

    var body = ms.rows.map(function (r) {
      var e = r.employee, s = r.sheet;
      return '<tr>' +
        '<td data-label="Name"><b>' + esc(e.name) + '</b>' + (e.active === false ? ' ' + pill('neu', 'Archived') : '') +
          (e.role || e.phone ? '<div class="sub">' + esc([e.role, e.phone].filter(Boolean).join(' · ')) + '</div>' : '') + '</td>' +
        '<td data-label="Salary" class="r">' + M.fmtPlain(s.planP) + '</td>' +
        '<td data-label="Bonus / deduction" class="r">' + adjText(s) + '</td>' +
        '<td data-label="Due" class="r">' + M.fmtPlain(s.dueP) + '</td>' +
        '<td data-label="Paid" class="r">' + M.fmtPlain(s.paidP) + '</td>' +
        '<td data-label="Remaining" class="r"><b>' + remainText(s.balanceP) + '</b></td>' +
        '<td data-label="Status">' + statusPill(s.status) + '</td>' +
        '<td data-label="" class="c fcb-rowacts">' +
          '<button class="btn sm pri" data-prpay="' + esc(e.id) + '">Pay</button>' +
          '<button class="btn sm" data-prview="' + esc(e.id) + '">Statement</button>' +
          '<button class="btn sm" data-predit="' + esc(e.id) + '">Edit</button>' +
        '</td></tr>';
    }).join('');

    var listCard = '<div class="card"><div class="card-h"><h3>Salary sheet — ' + esc(monthLabel(mo)) + '</h3>' +
        '<span class="pill neu">' + ms.rows.length + '</span>' +
        '<div class="grow"></div>' +
        '<button class="btn pri" data-praddemp>' + I('plus') + 'Add employee</button>' +
      '</div><div class="card-b" style="padding:0">' +
      (ms.rows.length
        ? '<div class="tw"><table class="tbl"><thead><tr>' +
            '<th>Name</th><th class="r">Salary</th><th class="r">Bonus / deduction</th><th class="r">Due</th>' +
            '<th class="r">Paid</th><th class="r">Remaining</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + body +
          '<tr class="pr-tot"><td data-label="">Total</td><td data-label="Salary" class="r">' + M.fmtPlain(t.planP) + '</td><td data-label="Bonus / deduction" class="r">' +
            adjText({ bonusP: t.bonusP, deductionP: t.deductionP }) + '</td><td data-label="Due" class="r">' + M.fmtPlain(t.dueP) +
            '</td><td data-label="Paid" class="r">' + M.fmtPlain(t.paidP) + '</td><td data-label="Remaining" class="r">' + remainText(t.balanceP) + '</td><td></td><td></td></tr>' +
          '</tbody></table></div>'
        : '<div class="empty"><div class="ei">' + I('users') + '</div><b>' +
          (Employees.all().length ? 'Nobody is on the payroll for ' + esc(monthLabel(mo)) : 'No employees yet') + '</b>' +
          '<p>Add the people on payroll — or press “Pay salary” and add someone at their first payment.</p>' +
          '<button class="btn pri" data-praddemp>' + I('plus') + 'Add employee</button></div>') +
    '</div></div>';

    var detail = '';
    var emp = PR.selectedId ? Employees.byId(PR.selectedId) : null;
    if (emp) {
      var st = Payroll.statement(emp.id), tt = st.totals;
      var monthRows = st.months.slice().reverse().filter(function (s) { return s.dueP || s.paidP || s.entries.length || s.month === curMonth(); }).map(function (s) {
        return '<tr><td data-label="Month"><button class="pr-link" data-prgo="' + s.month + '">' + esc(monthLabel(s.month)) + '</button></td>' +
          '<td data-label="Salary" class="r">' + M.fmtPlain(s.rateP) + '</td>' +
          '<td data-label="Bonus" class="r">' + (s.bonusP ? M.fmtPlain(s.bonusP) : '—') + '</td>' +
          '<td data-label="Deduction" class="r">' + (s.deductionP ? M.fmtPlain(s.deductionP) : '—') + '</td>' +
          '<td data-label="Due" class="r">' + M.fmtPlain(s.dueP) + '</td>' +
          '<td data-label="Paid" class="r">' + M.fmtPlain(s.paidP) + '</td>' +
          '<td data-label="Balance" class="r"><b>' + remainText(s.balanceP) + '</b></td>' +
          '<td data-label="Status">' + statusPill(s.status) + '</td></tr>';
      }).join('');
      var ents = Payroll.entriesFor(emp.id, true).slice().reverse().map(function (p) {
        var rev = p.status === 'REVERSED', k = kindOf(p);
        return '<tr' + (rev ? ' class="pr-rev"' : '') + '><td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
          '<td data-label="Number" class="mono">' + esc(p.salaryNumber) + '</td>' +
          '<td data-label="Type">' + esc(KIND_LABEL[k]) + '</td>' +
          '<td data-label="For month">' + esc(monthLabel(entryMonth(p))) + '</td>' +
          '<td data-label="Method">' + esc(p.method || '—') + '</td>' +
          '<td data-label="Note">' + esc(p.note || '—') + (rev ? ' <span class="pill neu">Reversed' + (p.reverseReason ? ': ' + esc(p.reverseReason) : '') + '</span>' : '') + '</td>' +
          '<td data-label="Amount" class="r">' + (k === 'DEDUCTION' ? '−' : '') + M.fmtPlain(p.amount) + '</td>' +
          '<td data-label="" class="c fcb-rowacts">' + (rev ? '' :
            '<button class="btn sm" data-prslip="' + esc(p.id) + '">Slip</button>' +
            '<button class="btn sm" data-prrev="' + esc(p.id) + '">Reverse</button>') + '</td></tr>';
      }).join('');
      detail = '<div class="card" id="fcPrStatement" style="margin-top:14px"><div class="card-h">' +
          '<h3>' + esc(emp.name) + '</h3><span class="pill neu">' + esc(emp.role || 'Employee') + '</span>' +
          (emp.active === false ? pill('neu', 'Archived') : '') +
          '<div class="grow"></div>' +
          '<button class="btn pri" data-prpay="' + esc(emp.id) + '">' + I('wallet') + 'Pay salary</button>' +
          '<button class="btn" data-prstprint>' + I('print') + 'Print</button>' +
          '<button class="btn" data-prstxls>' + I('download') + 'Excel</button>' +
          '<button class="btn" data-prclose>Close</button>' +
        '</div><div class="card-b">' +
        '<div class="kh-cards">' +
          card('', 'Monthly salary', M.fmt(Employees.rateAt(emp, curMonth()))) +
          card('', 'On payroll from', esc(monthLabel(Employees.startMonthOf(emp))) + (emp.endMonth ? '<div class="d">until ' + esc(monthLabel(emp.endMonth)) + '</div>' : '')) +
          card('', 'Total due', M.fmt(tt.dueP)) +
          card('credit', 'Total paid', M.fmt(tt.paidP), Payroll.lastPaymentDate(emp.id) ? 'last ' + esc(fmtDate(Payroll.lastPaymentDate(emp.id))) : '') +
          card(tt.balanceP > 0 ? 'due' : 'credit', tt.balanceP < 0 ? 'Paid ahead' : 'Still owed', M.fmt(Math.abs(tt.balanceP))) +
        '</div>' +
        '<h4 style="margin:14px 0 6px">Month by month</h4>' +
        '<div class="tw"><table class="kh-table"><thead><tr><th>Month</th><th class="r">Salary</th><th class="r">Bonus</th>' +
          '<th class="r">Deduction</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Balance</th><th>Status</th></tr></thead><tbody>' +
          monthRows + '</tbody></table></div>' +
        '<h4 style="margin:14px 0 6px">Every entry</h4>' +
        (ents
          ? '<div class="tw"><table class="kh-table"><thead><tr><th>Date</th><th>Number</th><th>Type</th><th>For month</th>' +
              '<th>Method</th><th>Note</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + ents + '</tbody></table></div>'
          : '<p class="hint">Nothing recorded yet.</p>') +
      '</div></div>';
    }

    return bar + cards + listCard + detail;
  };

  /* ════════════════════════════════════════════════════════════════════════
     PANELS — add/edit an employee, pay a salary
     ════════════════════════════════════════════════════════════════════════ */
  var PANELS = global.PANELS;

  PANELS.employee = {
    t: 'Employee', s: 'Add or edit a person on payroll', cta: 'Save employee',
    f: function () {
      var emp = EMP_EDIT ? Employees.byId(EMP_EDIT) : null;
      return '<label class="f"><span>Name</span><input data-f="name" value="' + esc(emp ? emp.name : '') + '"></label>' +
        '<div class="f2"><label class="f"><span>Role</span>' +
          '<input data-f="role" placeholder="e.g. Warehouse helper, Driver, Accountant" value="' + esc(emp ? emp.role : '') + '"></label>' +
          '<label class="f"><span>Phone</span><input data-f="phone" value="' + esc(emp ? emp.phone : '') + '"></label></div>' +
        '<div class="f2"><label class="f"><span>Monthly salary</span>' +
          '<input data-f="salary" inputmode="decimal" placeholder="e.g. 25000" value="' +
          (emp ? M.toR(Employees.rateAt(emp, curMonth())) : '') + '"></label>' +
          '<label class="f"><span>' + (emp ? 'On payroll from' : 'Starts from') + '</span>' +
          '<input type="month" placeholder="YYYY-MM" data-f="start" value="' + esc(emp ? Employees.startMonthOf(emp) : curMonth()) + '"></label></div>' +
        (emp ? '<label class="f"><span>A changed salary counts from</span>' +
          '<input type="month" placeholder="YYYY-MM" data-f="eff" value="' + esc(curMonth()) + '"></label>' +
          '<p class="hint">Earlier months keep the salary they had. Only used if you change the salary above.</p>' : '') +
        '<label class="f"><span>Internal note</span><input data-f="notes" placeholder="Optional" value="' + esc(emp ? emp.notes : '') + '"></label>' +
        (emp ? '<label class="f"><span><input type="checkbox" id="fcEmpActive"' +
          (emp.active !== false ? ' checked' : '') + '> Still working here</span></label>' +
          '<p class="hint">Untick when they leave: the current month is still owed, later months are not.</p>' : '');
    },
    save: function (v) {
      if (!canManage()) return 'Salaries are not open to your role.';
      var activeBox = D.getElementById('fcEmpActive');
      var o = { id: EMP_EDIT || undefined, name: v.name, role: v.role, phone: v.phone,
        monthlySalary: v.salary, notes: v.notes, startMonth: v.start || undefined, effectiveFrom: v.eff || undefined,
        active: activeBox ? activeBox.checked : true };
      var errs = Employees.check(o);
      if (errs.length) return errs[0];
      Employees.save(o).then(function () {
        EMP_EDIT = null; global.paint(); say('Employee saved.');
      }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save the employee.'); });
      return { msg: 'Saving…' };
    }
  };

  function newOpId() { return FDB.uid('salop'); }

  /* the small "where does this month stand" line and the amount to suggest */
  function panelState() {
    var g = function (q) { var el = D.querySelector(q); return el ? el.value : ''; };
    return { emp: g('#fcSalEmp'), kind: g('#fcSalKind') || 'SALARY', month: g('#fcSalMonth') || curMonth(),
      newRate: g('#fcSalNewRate'), newStart: g('#fcSalNewStart') };
  }
  function refreshSalPanel(resetAmount) {
    var st = panelState(), info = D.getElementById('fcSalInfo'), amt = D.getElementById('fcSalAmt');
    var box = D.getElementById('fcSalNew'), isNew = st.emp === '__new';
    if (box) box.style.display = isNew ? '' : 'none';
    var meth = D.getElementById('fcSalCash'); if (meth) meth.style.display = isCash(st.kind) ? '' : 'none';
    if (!isMonth(st.month)) { if (info) { info.innerHTML = ''; info.style.display = 'none'; } return; }
    var emp = null;
    if (isNew) {
      var sal = rupees(st.newRate), start = isMonth(st.newStart) ? st.newStart : st.month;
      if (!isNaN(sal)) emp = { id: null, startMonth: start, rates: [{ from: start, salaryP: M.toP(sal) }], monthlySalaryP: M.toP(sal) };
    } else emp = Employees.byId(st.emp);
    var sh = emp ? Payroll.sheet(emp, st.month) : null;
    if (info) {
      info.innerHTML = !sh ? '' : I('wallet') + '<div><p><b>' + esc(monthLabel(st.month)) + '</b> — salary ' + M.fmt(sh.rateP) +
        (sh.bonusP ? ' · bonus ' + M.fmt(sh.bonusP) : '') + (sh.deductionP ? ' · deduction ' + M.fmt(sh.deductionP) : '') +
        ' · already paid ' + M.fmt(sh.paidP) + ' · <b>' + (sh.balanceP < 0 ? 'paid ahead ' + M.fmt(-sh.balanceP) : 'left ' + M.fmt(sh.balanceP)) + '</b></p></div>';
    }
    if (info) info.style.display = info.innerHTML ? '' : 'none';
    if (resetAmount && amt) amt.value = (st.kind === 'SALARY' && sh && sh.balanceP > 0) ? M.toR(sh.balanceP) : '';
  }

  PANELS.paysalary = {
    t: 'Pay salary', s: 'Salary, advance, bonus or deduction for an employee', cta: 'Record',
    f: function () {
      var emps = Employees.active();
      /* an archived employee can still be pre-filled here (e.g. a final
         settlement) — they must stay visible in the dropdown, or the panel
         would silently substitute a different employee with no warning */
      var preRec = PAYSAL_FOR ? Employees.byId(PAYSAL_FOR) : null;
      if (preRec && !emps.some(function (e) { return e.id === preRec.id; })) emps = emps.concat([preRec]);
      var pre = preRec ? preRec.id : (emps.length ? '' : '__new');
      var mo = PAYSAL_MONTH && isMonth(PAYSAL_MONTH) ? PAYSAL_MONTH : month();
      if (!PAYSAL_OP) PAYSAL_OP = newOpId();
      var kinds = KINDS.map(function (k) {
        return '<option value="' + k + '"' + (k === PAYSAL_KIND ? ' selected' : '') + '>' + ({
          SALARY: 'Salary payment', ADVANCE: 'Advance (paid before the month is done)',
          BONUS: 'Bonus (adds to what is owed — no cash now)', DEDUCTION: 'Deduction (takes from what is owed — no cash now)' })[k] + '</option>';
      }).join('');
      return '<label class="f"><span>What is this?</span><select data-f="kind" id="fcSalKind">' + kinds + '</select></label>' +
        '<label class="f"><span>Employee</span><select data-f="emp" id="fcSalEmp">' +
          '<option value=""' + (pre === '' ? ' selected' : '') + '>— Choose an employee —</option>' +
          emps.map(function (e) {
            return '<option value="' + esc(e.id) + '"' + (e.id === pre ? ' selected' : '') + '>' +
              esc(e.name) + (e.role ? ' — ' + esc(e.role) : '') + (e.active === false ? ' (archived)' : '') + '</option>';
          }).join('') +
          '<option value="__new"' + (pre === '__new' ? ' selected' : '') + '>＋ New person — not on the list yet</option></select></label>' +
        '<div id="fcSalNew" style="display:none">' +
          '<label class="f"><span>Name</span><input data-f="newname" id="fcSalNewName"></label>' +
          '<div class="f2"><label class="f"><span>Role</span><input data-f="newrole" placeholder="Optional"></label>' +
            '<label class="f"><span>Phone</span><input data-f="newphone" placeholder="Optional"></label></div>' +
          '<div class="f2"><label class="f"><span>Monthly salary</span><input data-f="newrate" id="fcSalNewRate" inputmode="decimal" placeholder="e.g. 25000"></label>' +
            '<label class="f"><span>On payroll from</span><input type="month" placeholder="YYYY-MM" data-f="newstart" id="fcSalNewStart" value="' + esc(mo) + '"></label></div>' +
          '<p class="hint">They are added to the payroll together with this entry.</p></div>' +
        '<div class="f2"><label class="f"><span>For the month of</span><input type="month" placeholder="YYYY-MM" data-f="month" id="fcSalMonth" value="' + esc(mo) + '"></label>' +
          '<label class="f"><span>Amount</span><input data-f="amt" inputmode="decimal" id="fcSalAmt"></label></div>' +
        '<div class="banner info" id="fcSalInfo"></div>' +
        '<div class="f2"><label class="f"><span>Date</span><input type="date" data-f="date" value="' + today() + '"></label>' +
          '<label class="f" id="fcSalCash"><span>Method</span><select data-f="method">' +
            ERP.ENUM.methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label></div>' +
        '<label class="f"><span>Reference</span><input data-f="ref" class="mono" placeholder="Optional — cheque or transaction no."></label>' +
        '<label class="f"><span>Note</span><input data-f="note" placeholder="Optional"></label>';
    },
    /* the panel is drawn by the app; fill in the live line and the suggested amount once it is in the page */
    after: function () { refreshSalPanel(true); },
    save: function (v) {
      if (!canManage()) return 'Salaries are not open to your role.';
      var isNew = v.emp === '__new';
      var o = { kind: v.kind, amount: v.amt, method: v.method, reference: v.ref, date: v.date || today(),
        periodMonth: v.month, note: v.note, clientOpId: PAYSAL_OP };
      if (isNew) o.newEmployee = { name: v.newname, role: v.newrole, phone: v.newphone, monthlySalary: v.newrate, startMonth: v.newstart || undefined };
      else o.employeeId = v.emp;
      var errs = Payroll.check(o);
      if (errs.length) return errs[0];
      var opId = PAYSAL_OP; PAYSAL_OP = null;
      Payroll.pay(o).then(function (p) {
        PAYSAL_FOR = null; PAYSAL_MONTH = null;
        global.paint();
        say(KIND_LABEL[kindOf(p)] + ' ' + p.salaryNumber + ' recorded.');
      }).catch(function (e) {
        PAYSAL_OP = opId;
        say(e && e.validation ? e.validation[0] : 'Could not save this entry.');
      });
      return { msg: 'Saving…' };
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     NAV — one entry under Finance
     ════════════════════════════════════════════════════════════════════════ */
  try {
    var NAV = global.NAV, GROUPS = global.NAVGROUPS;
    if (!NAV.some(function (n) { return n.id === 'payroll'; })) {
      var at = NAV.map(function (n) { return n.id; }).indexOf('soa');
      NAV.splice(at < 0 ? NAV.length : at + 1, 0, { id: 'payroll', l: 'Payroll', i: 'users' });
    }
    GROUPS.forEach(function (g) {
      if (g[0] === 'Finance' && g[1].indexOf('payroll') === -1) {
        var pos = g[1].indexOf('soa');
        g[1].splice(pos < 0 ? g[1].length : pos + 1, 0, 'payroll');
      }
    });
    if (global.PAGEMETA) {
      global.PAGEMETA.payroll = ['Payroll',
        'Each month’s salary: what is due, what has been paid, what is left — with advances, bonuses and deductions.'];
    }
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     HANDLERS
     ════════════════════════════════════════════════════════════════════════ */
  function download(bytes, name) {
    var blob = new global.Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = D.createElement('a');
    a.href = global.URL.createObjectURL(blob); a.download = name;
    D.body.appendChild(a); a.click();
    setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  }
  function xlsx(sheets, title, name) {
    try {
      download(ERP.XLSX.build(sheets, { title: title, author: ERP.Settings.get().businessName }), name);
      say('Excel file downloaded — ' + name);
    } catch (err) { say('Could not build the Excel file.'); }
  }
  function slug(s) { return String(s || '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'employee'; }

  D.addEventListener('input', function (e) {
    var el = e.target;
    if (el && (el.id === 'fcSalNewRate')) refreshSalPanel(true);
  });
  D.addEventListener('change', function (e) {
    var el = e.target; if (!el) return;
    if (el.id === 'fcSalEmp' || el.id === 'fcSalMonth' || el.id === 'fcSalKind' || el.id === 'fcSalNewStart') {
      if (el.id === 'fcSalKind') PAYSAL_KIND = el.value;
      /* a person added with this payment starts in the month it is for, unless they choose otherwise */
      if (el.id === 'fcSalMonth' && isMonth(el.value)) { var ns = D.getElementById('fcSalNewStart'); if (ns) ns.value = el.value; }
      refreshSalPanel(true);
      return;
    }
    if (el.matches && el.matches('[data-prmonth]')) {
      if (isMonth(el.value)) { PR.month = el.value; global.paint(); }
    }
  });

  function openPay(empId, kind, mo) {
    PAYSAL_FOR = empId || null; PAYSAL_KIND = kind || 'SALARY'; PAYSAL_OP = newOpId(); PAYSAL_MONTH = mo || null;
    global.openPanel('paysalary');
    refreshSalPanel(true);
  }

  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var t;
    if ((t = e.target.closest('[data-praddemp]'))) { e.preventDefault(); EMP_EDIT = null; global.openPanel('employee'); return; }
    if ((t = e.target.closest('[data-predit]'))) { e.preventDefault(); EMP_EDIT = t.dataset.predit; global.openPanel('employee'); return; }
    if ((t = e.target.closest('[data-prpay]'))) { e.preventDefault(); openPay(t.dataset.prpay, 'SALARY', month()); return; }
    if ((t = e.target.closest('[data-prview]'))) { e.preventDefault(); PR.selectedId = t.dataset.prview; global.paint(); return; }
    if ((t = e.target.closest('[data-prclose]'))) { e.preventDefault(); PR.selectedId = null; global.paint(); return; }
    if ((t = e.target.closest('[data-prmove]'))) {
      e.preventDefault();
      var n = Number(t.dataset.prmove);
      PR.month = n === 0 ? curMonth() : addMonths(month(), n);
      global.paint(); return;
    }
    if ((t = e.target.closest('[data-prgo]'))) { e.preventDefault(); PR.month = t.dataset.prgo; global.paint(); return; }
    if (e.target.closest('[data-prsheetprint]')) { e.preventDefault(); ERP.Viewer.open(Payroll.sheetDoc(month())); return; }
    if (e.target.closest('[data-prsheetxls]')) { e.preventDefault(); xlsx(Payroll.sheets(month()), 'Salary sheet', 'Salary-sheet-' + month() + '.xlsx'); return; }
    if ((t = e.target.closest('[data-prstprint]'))) {
      e.preventDefault(); var dm = Payroll.statementDoc(PR.selectedId); if (dm) ERP.Viewer.open(dm); return;
    }
    if (e.target.closest('[data-prstxls]')) {
      e.preventDefault(); var emp = Employees.byId(PR.selectedId); if (!emp) return;
      xlsx(Payroll.statementSheets(emp.id), 'Salary statement', 'Salary-' + slug(emp.name) + '-' + today() + '.xlsx'); return;
    }
    if ((t = e.target.closest('[data-prslip]'))) {
      e.preventDefault(); var sd = Payroll.slipDoc(t.dataset.prslip); if (sd) ERP.Viewer.open(sd); return;
    }
    if ((t = e.target.closest('[data-prrev]'))) {
      e.preventDefault();
      var id = t.dataset.prrev;
      ERP.UI.prompt('Reverse this entry?', {
        detail: 'It stays on the list, struck through, and is no longer counted. The reason is kept in the audit log.',
        label: 'Reason', placeholder: 'Why is this being reversed?', okText: 'Reverse entry', cancelText: 'Keep it', tone: 'danger'
      }).then(function (why) {
        if (why === null) return;
        return Payroll.reverse(id, why).then(function () { global.paint(); say('Entry reversed.'); })
          .catch(function (err) { say((err && err.validation && err.validation[0]) || 'Could not reverse that.'); });
      });
      return;
    }
  });
})(typeof window !== 'undefined' ? window : this);
