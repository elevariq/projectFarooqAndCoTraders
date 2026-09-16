/* ══════════════════════════════════════════════════════════════════════════
   PAYROLL — EMPLOYEE SALARY MANAGEMENT (MVP)

   Client request (2026-09-16, clientNewReq/): "Payroll = Employee salary
   management system." No fields, salary structure or screenshot were ever
   given, even after a follow-up — so this deliberately stays a minimal,
   honest MVP rather than guessing at a real HR/accrual data model:

     - An employee list: name, role, phone, monthly salary rate, active/
       archived.
     - "Pay salary" — records a dated payment (amount, method, an optional
       free-text period like "September 2026", reference, note). This is a
       payment LOG, not an accrual/payable system — there is no "balance
       owed" concept, because nothing was specified about pay periods,
       proration, deductions or advances, and a wrong balance on a payroll
       screen would be worse than no balance at all.
     - A per-employee statement: the same dated-table-plus-summary-cards
       shape as the customer/supplier ledger, showing every salary payment
       made, when it was last paid, and whether this calendar month has
       been paid yet.

   Deliberately NOT built here (flagged for the client to specify before
   any of this is attempted): attendance, deductions/advances, tax,
   printable payslips, multi-currency, pay-period accrual.

   Its own pair of IndexedDB stores (01-db.js, DB_VER 10) — separate from
   `salesmen` (area sales-coverage is a different concern from who is on
   payroll) and from `payments` (a salary is never a customer/supplier
   balance movement).
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

  /* ════════════════════════════════════════════════════════════════════════
     EMPLOYEES
     ════════════════════════════════════════════════════════════════════════ */
  var Employees = ERP.Employees = {
    all: function () { return S.employees || (S.employees = []); },
    active: function () { return Employees.all().filter(function (e) { return e.active !== false; }); },
    byId: function (id) { return Employees.all().filter(function (e) { return e.id === id; })[0] || null; },

    save: function (o) {
      var errs = [];
      if (!o.name) errs.push('Enter the employee’s name.');
      var salaryP = M.toP(o.monthlySalary || 0);
      if (salaryP < 0) errs.push('Monthly salary can’t be negative.');
      if (errs.length) return Promise.reject({ validation: errs });
      var existing = o.id ? Employees.byId(o.id) : null;
      var rec = Object.assign({
        id: o.id || FDB.uid('emp'), createdAt: nowISO(), createdBy: global.CURRENT_USER || 'Owner'
      }, existing || {}, {
        name: o.name, role: o.role || '', phone: o.phone || '', notes: o.notes || '',
        monthlySalaryP: salaryP,
        active: o.active === undefined ? (existing ? existing.active !== false : true) : !!o.active,
        updatedAt: nowISO()
      });
      return FDB.tx(['employees', 'auditLog'], function (api) {
        api.put('employees', rec);
        var ix = Employees.all().map(function (e) { return e.id; }).indexOf(rec.id);
        if (ix > -1) Employees.all()[ix] = rec; else Employees.all().push(rec);
        ERP.Audit.write(api, {
          action: existing ? 'Employee updated' : 'Employee added', entity: 'Employee',
          entityId: rec.id, ref: rec.name,
          oldValues: existing ? { name: existing.name, role: existing.role, monthlySalary: M.toR(existing.monthlySalaryP) } : null,
          newValues: { name: rec.name, role: rec.role, monthlySalary: M.toR(rec.monthlySalaryP), active: rec.active }
        });
        return rec;
      });
    },
    archive: function (id, on) {
      var e = Employees.byId(id);
      if (!e) return Promise.resolve(null);
      return FDB.tx(['employees', 'auditLog'], function (api) {
        e.active = !on; e.updatedAt = nowISO();
        api.put('employees', e);
        ERP.Audit.write(api, { action: on ? 'Employee archived' : 'Employee restored',
          entity: 'Employee', entityId: id, ref: e.name });
        return e;
      });
    }
  };

  /* ════════════════════════════════════════════════════════════════════════
     SALARY PAYMENTS
     ════════════════════════════════════════════════════════════════════════ */
  var Payroll = ERP.Payroll = {
    paymentsFor: function (employeeId) {
      return (S.salaryPayments || []).filter(function (p) {
        return p.employeeId === employeeId && p.status !== 'REVERSED';
      }).sort(function (a, b) { return a.paymentDate < b.paymentDate ? -1 : (a.paymentDate > b.paymentDate ? 1 : 0); });
    },
    totalPaid: function (employeeId) {
      return Payroll.paymentsFor(employeeId).reduce(function (a, p) { return a + p.amount; }, 0);
    },
    lastPaymentDate: function (employeeId) {
      var rows = Payroll.paymentsFor(employeeId);
      return rows.length ? rows[rows.length - 1].paymentDate : null;
    },
    paidThisMonth: function (employeeId, monthKey) {
      monthKey = monthKey || today().slice(0, 7);
      return Payroll.paymentsFor(employeeId).some(function (p) { return (p.paymentDate || '').slice(0, 7) === monthKey; });
    },
    pay: function (o) {
      var amountP = M.toP(o.amount);
      if (!(amountP > 0)) return Promise.reject({ validation: ['Enter an amount greater than zero.'] });
      var emp = Employees.byId(o.employeeId);
      if (!emp) return Promise.reject({ validation: ['Choose an employee.'] });
      return FDB.tx(['sequences', 'salaryPayments', 'auditLog'], function (api) {
        return FDB.nextNumber(api, 'SAL').then(function (number) {
          var rec = {
            id: FDB.uid('sal'), salaryNumber: number, employeeId: o.employeeId,
            employeeNameSnapshot: emp.name, employeeRoleSnapshot: emp.role || '',
            amount: amountP, method: o.method || 'Cash', reference: o.reference || '',
            period: o.period || '', paymentDate: o.date || today(), note: o.note || '',
            status: 'POSTED', paidBy: global.CURRENT_USER || 'Owner',
            createdAt: nowISO(), createdBy: global.CURRENT_USER || 'Owner'
          };
          api.put('salaryPayments', rec);
          (S.salaryPayments || (S.salaryPayments = [])).unshift(rec);
          ERP.Audit.write(api, {
            action: 'Salary paid', entity: 'SalaryPayment', entityId: rec.id, ref: rec.salaryNumber,
            newValues: { employee: rec.employeeNameSnapshot, amount: M.toR(rec.amount), period: rec.period }
          });
          return rec;
        });
      });
    }
  };

  (ERP.bootPromise || Promise.resolve()).then(function () {
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
  var PR = { selectedId: null };
  var EMP_EDIT = null, PAYSAL_FOR = null;

  function card(cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }

  global.PAGES.payroll = function () {
    var rows = Employees.all().slice().sort(function (a, b) {
      return (a.name || '').toLowerCase() < (b.name || '').toLowerCase() ? -1 : 1;
    });
    var monthKey = today().slice(0, 7);

    var body = rows.map(function (e) {
      var paid = Payroll.totalPaid(e.id);
      var thisMonth = Payroll.paidThisMonth(e.id, monthKey);
      return '<tr>' +
        '<td data-label="Name"><b>' + esc(e.name) + '</b>' + (e.phone ? '<div class="sub">' + esc(e.phone) + '</div>' : '') + '</td>' +
        '<td data-label="Role">' + esc(e.role || '—') + '</td>' +
        '<td data-label="Monthly salary" class="r">' + M.fmtPlain(e.monthlySalaryP || 0) + '</td>' +
        '<td data-label="This month">' + (thisMonth ? pill('ok', 'Paid') : pill('warn', 'Not yet')) + '</td>' +
        '<td data-label="Total paid" class="r">' + M.fmtPlain(paid) + '</td>' +
        '<td data-label="Status">' + (e.active !== false ? pill('ok', 'Active') : pill('neu', 'Archived')) + '</td>' +
        '<td data-label="" class="c fcb-rowacts">' +
          '<button class="btn sm pri" data-prpay="' + e.id + '">Pay salary</button>' +
          '<button class="btn sm" data-prview="' + e.id + '">Statement</button>' +
          '<button class="btn sm" data-predit="' + e.id + '">Edit</button>' +
        '</td></tr>';
    }).join('');

    var listCard = '<div class="card"><div class="card-h"><h3>Employees</h3>' +
        '<span class="pill neu">' + rows.length + '</span>' +
        '<div class="grow"></div>' +
        '<button class="btn pri" data-praddemp>' + I('plus') + 'Add employee</button>' +
      '</div><div class="card-b" style="padding:0">' +
      (rows.length
        ? '<div class="tw"><table class="tbl"><thead><tr>' +
            '<th>Name</th><th>Role</th><th class="r">Monthly salary</th><th>This month</th>' +
            '<th class="r">Total paid</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<div class="empty"><div class="ei">' + I('users') + '</div><b>No employees yet</b>' +
          '<p>Add the people on payroll to start recording salaries.</p>' +
          '<button class="btn pri" data-praddemp>' + I('plus') + 'Add employee</button></div>') +
    '</div></div>';

    var detail = '';
    var emp = PR.selectedId ? Employees.byId(PR.selectedId) : null;
    if (emp) {
      var pays = Payroll.paymentsFor(emp.id).slice().reverse();
      var payRows = pays.map(function (p) {
        return '<tr><td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
          '<td data-label="Reference" class="mono">' + esc(p.salaryNumber) + '</td>' +
          '<td data-label="Period">' + esc(p.period || '—') + '</td>' +
          '<td data-label="Method">' + esc(p.method) + '</td>' +
          '<td data-label="Note">' + esc(p.note || '—') + '</td>' +
          '<td data-label="Amount" class="r">' + M.fmtPlain(p.amount) + '</td></tr>';
      }).join('');
      detail = '<div class="card" style="margin-top:14px"><div class="card-h">' +
          '<h3>' + esc(emp.name) + '</h3><span class="pill neu">' + esc(emp.role || 'Employee') + '</span>' +
          '<div class="grow"></div>' +
          '<button class="btn pri" data-prpay="' + emp.id + '">' + I('wallet') + 'Pay salary</button>' +
          '<button class="btn" data-prclose>Close</button>' +
        '</div><div class="card-b">' +
        '<div class="kh-cards">' +
          card('', 'Monthly salary', M.fmt(emp.monthlySalaryP || 0)) +
          card('credit', 'Total paid', M.fmt(Payroll.totalPaid(emp.id))) +
          card('', 'Last payment', Payroll.lastPaymentDate(emp.id) ? fmtDate(Payroll.lastPaymentDate(emp.id)) : '—') +
          card(Payroll.paidThisMonth(emp.id, monthKey) ? 'credit' : 'due', 'This month',
            Payroll.paidThisMonth(emp.id, monthKey) ? 'Paid' : 'Not yet') +
        '</div>' +
        (pays.length
          ? '<div class="tw" style="margin-top:12px"><table class="kh-table"><thead><tr>' +
              '<th>Date</th><th>Reference</th><th>Period</th><th>Method</th><th>Note</th><th class="r">Amount</th>' +
            '</tr></thead><tbody>' + payRows + '</tbody></table></div>'
          : '<p class="hint" style="margin-top:12px">No salary payments recorded yet.</p>') +
      '</div></div>';
    }

    return listCard + detail;
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
        '<label class="f"><span>Monthly salary</span>' +
          '<input data-f="salary" inputmode="decimal" placeholder="e.g. 25000" value="' +
          (emp ? M.toR(emp.monthlySalaryP || 0) : '') + '"></label>' +
        '<label class="f"><span>Internal note</span><input data-f="notes" placeholder="Optional" value="' + esc(emp ? emp.notes : '') + '"></label>' +
        (emp ? '<label class="f"><span><input type="checkbox" id="fcEmpActive"' +
          (emp.active !== false ? ' checked' : '') + '> Active</span></label>' : '');
    },
    save: function (v) {
      if (!v.name) return 'Enter the employee’s name.';
      var activeBox = D.getElementById('fcEmpActive');
      ERP.Employees.save({
        id: EMP_EDIT || undefined, name: v.name, role: v.role, phone: v.phone,
        monthlySalary: v.salary, notes: v.notes,
        active: activeBox ? activeBox.checked : true
      }).then(function () {
        global.paint(); say('Employee saved.'); EMP_EDIT = null;
      }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save the employee.'); });
      return { msg: 'Saving…' };
    }
  };

  PANELS.paysalary = {
    t: 'Pay salary', s: 'Record a salary payment for an employee', cta: 'Record payment',
    f: function () {
      var emps = Employees.active();
      if (!emps.length) return '<div class="banner warn">' + I('alert') +
        '<div><b>No employees on file</b><p>Add an employee first.</p></div></div>';
      var pre = (PAYSAL_FOR && emps.some(function (e) { return e.id === PAYSAL_FOR; })) ? PAYSAL_FOR : emps[0].id;
      var emp = Employees.byId(pre);
      return '<label class="f"><span>Employee</span><select data-f="emp" id="fcSalEmp">' +
          emps.map(function (e) {
            return '<option value="' + e.id + '"' + (e.id === pre ? ' selected' : '') + '>' +
              esc(e.name) + (e.role ? ' — ' + esc(e.role) : '') + '</option>';
          }).join('') + '</select></label>' +
        '<div class="banner info" id="fcSalRate">' + I('wallet') + '<div><p>Monthly salary: <b>' +
          M.fmt(emp.monthlySalaryP || 0) + '</b></p></div></div>' +
        '<div class="f2"><label class="f"><span>Amount</span>' +
          '<input data-f="amt" inputmode="decimal" id="fcSalAmt" value="' + M.toR(emp.monthlySalaryP || 0) + '"></label>' +
          '<label class="f"><span>Method</span><select data-f="method">' +
            ERP.ENUM.methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="f2"><label class="f"><span>Date</span><input type="date" data-f="date" value="' + today() + '"></label>' +
          '<label class="f"><span>Period</span><input data-f="period" placeholder="e.g. September 2026"></label></div>' +
        '<label class="f"><span>Reference</span><input data-f="ref" class="mono" placeholder="Optional"></label>' +
        '<label class="f"><span>Note</span><input data-f="note" placeholder="Optional"></label>';
    },
    save: function (v) {
      var amount = String(v.amt || '').replace(/[^\d.]/g, '');
      if (!amount || Number(amount) <= 0) return 'Enter the amount to pay.';
      ERP.Payroll.pay({
        employeeId: v.emp, amount: amount, method: v.method, reference: v.ref,
        date: v.date || today(), period: v.period, note: v.note
      }).then(function (p) {
        global.paint();
        say('Salary payment ' + p.salaryNumber + ' recorded.');
      }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save the payment.'); });
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
        'The people on payroll, their monthly rate, and every salary payment made to them.'];
    }
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     HANDLERS
     ════════════════════════════════════════════════════════════════════════ */
  D.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'fcSalEmp') {
      var emp = Employees.byId(el.value);
      var rate = D.getElementById('fcSalRate');
      if (rate) rate.innerHTML = I('wallet') + '<div><p>Monthly salary: <b>' +
        M.fmt(emp ? emp.monthlySalaryP || 0 : 0) + '</b></p></div>';
      var amtF = D.getElementById('fcSalAmt');
      if (amtF) amtF.value = M.toR(emp ? emp.monthlySalaryP || 0 : 0);
    }
  });

  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var add = e.target.closest('[data-praddemp]');
    if (add) { e.preventDefault(); EMP_EDIT = null; global.openPanel('employee'); return; }
    var edit = e.target.closest('[data-predit]');
    if (edit) { e.preventDefault(); EMP_EDIT = edit.dataset.predit; global.openPanel('employee'); return; }
    var pay = e.target.closest('[data-prpay]');
    if (pay) { e.preventDefault(); PAYSAL_FOR = pay.dataset.prpay; global.openPanel('paysalary'); return; }
    var view = e.target.closest('[data-prview]');
    if (view) { e.preventDefault(); PR.selectedId = view.dataset.prview; global.paint(); return; }
    var close = e.target.closest('[data-prclose]');
    if (close) { e.preventDefault(); PR.selectedId = null; global.paint(); return; }
  });
})(typeof window !== 'undefined' ? window : this);
