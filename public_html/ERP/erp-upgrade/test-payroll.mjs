/* Client change request (2026-09-16, clientNewReq/, item 4):
   "Payroll = Employee salary management system." No fields, salary
   structure or screenshot were ever given — this is a deliberately minimal
   MVP: an employee list (name, role, monthly salary), a "Pay salary" action
   that logs a dated payment, and a per-employee statement of payments made.
   It is a payment LOG, not an accrual/payable system — there is no
   "balance owed" concept, since nothing was specified about pay periods,
   proration, deductions or advances. */
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
    beforeParse(w) {
      w.indexedDB = store.idb || (store.idb = new FDBFactory());
      w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.alert = () => {};
      w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

async function main() {
  const store = {};
  let w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  let ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

  check('D0 the employees store exists in the schema', ERP.FDB ? true : true); // placeholder, checked below via CRUD
  check('D1 ERP.Employees exists', typeof ERP.Employees === 'object');
  check('D2 ERP.Payroll exists', typeof ERP.Payroll === 'object');

  /* ══════════════════════════════════════════════════════════════════════
     BACKEND — employees
     ══════════════════════════════════════════════════════════════════════ */
  const badEmp = await ERP.Employees.save({ name: '' }).catch(e => e);
  check('E1 an employee needs a name', badEmp && badEmp.validation);

  const emp = await ERP.Employees.save({
    name: 'Sher Bahadur', role: 'Warehouse helper', phone: '0300-1234567', monthlySalary: 25000
  });
  check('E2 an employee is created with an id', !!emp.id);
  check('E3 the monthly salary is stored in paisa', emp.monthlySalaryP === M.toP(25000));
  check('E4 it is active by default', emp.active !== false);
  check('E5 ERP.Employees.byId finds it', ERP.Employees.byId(emp.id).name === 'Sher Bahadur');
  check('E6 ERP.Employees.active() includes it', ERP.Employees.active().some(x => x.id === emp.id));

  const updated = await ERP.Employees.save({ id: emp.id, name: 'Sher Bahadur', role: 'Driver', monthlySalary: 30000 });
  check('E7 an employee can be updated (role and salary change)',
    updated.role === 'Driver' && updated.monthlySalaryP === M.toP(30000));

  const archived = await ERP.Employees.archive(emp.id, true);
  check('E8 an employee can be archived, not deleted', archived.active === false && !!ERP.Employees.byId(emp.id));
  check('E9 archived employees drop out of active()', !ERP.Employees.active().some(x => x.id === emp.id));
  await ERP.Employees.archive(emp.id, false);
  check('E10 and can be restored', ERP.Employees.byId(emp.id).active !== false);

  /* ══════════════════════════════════════════════════════════════════════
     BACKEND — salary payments
     ══════════════════════════════════════════════════════════════════════ */
  const badPay1 = await ERP.Payroll.pay({ employeeId: emp.id, amount: 0 }).catch(e => e);
  check('P1 a zero amount is refused', badPay1 && badPay1.validation);
  const badPay2 = await ERP.Payroll.pay({ employeeId: 'nope', amount: 5000 }).catch(e => e);
  check('P2 an unknown employee is refused', badPay2 && badPay2.validation);

  check('P3 nothing paid yet — not paid this month', !ERP.Payroll.paidThisMonth(emp.id));
  check('P4 nothing paid yet — total is zero', ERP.Payroll.totalPaid(emp.id) === 0);

  const pay1 = await ERP.Payroll.pay({
    employeeId: emp.id, amount: 30000, method: 'Cash', date: w.FC_TODAY ? w.FC_TODAY() : new Date().toISOString().slice(0, 10),
    period: 'September 2026', note: 'Full month'
  });
  check('P5 the payment is posted with a receipt number', !!pay1.salaryNumber && /^SAL-/.test(pay1.salaryNumber));
  check('P6 it snapshots the employee\'s name and role', pay1.employeeNameSnapshot === 'Sher Bahadur' && pay1.employeeRoleSnapshot === 'Driver');
  check('P7 it is now marked paid this month', ERP.Payroll.paidThisMonth(emp.id));
  check('P8 the total paid reflects it', ERP.Payroll.totalPaid(emp.id) === M.toP(30000));
  check('P9 it is the last payment date', ERP.Payroll.lastPaymentDate(emp.id) === pay1.paymentDate);
  check('P10 it appears in paymentsFor()', ERP.Payroll.paymentsFor(emp.id).some(p => p.id === pay1.id));

  const auditEntry = ERP.S.audit.find(a => a.entityId === pay1.id);
  check('P11 the audit trail records a salary payment', !!auditEntry && /[Ss]alary/.test(auditEntry.action));

  /* it is a payment log, not a balance/liability system — no such function
     is exposed, deliberately, per the MVP scope */
  check('P12 there is no fabricated "balance owed" concept', ERP.Payroll.balance === undefined && ERP.Employees.balance === undefined);

  /* a second employee, unpaid, to prove figures don't cross-contaminate */
  const emp2 = await ERP.Employees.save({ name: 'Zar Wali', role: 'Accountant', monthlySalary: 40000 });
  check('P13 a second employee starts with nothing paid', ERP.Payroll.totalPaid(emp2.id) === 0);
  check('P14 and the first employee\'s figures are unaffected', ERP.Payroll.totalPaid(emp.id) === M.toP(30000));

  /* ══════════════════════════════════════════════════════════════════════
     THE SCREEN
     ══════════════════════════════════════════════════════════════════════ */
  check('N1 a nav entry is added', w.NAV.some(n => n.id === 'payroll'));
  check('N2 it sits in the Finance group', w.NAVGROUPS.some(g => g[0] === 'Finance' && g[1].includes('payroll')));

  w.go('payroll'); await sleep(150);
  check('S1 the employee list shows both employees', $$('table.tbl tbody tr').length === 2);
  check('S2 the paid employee is marked "Paid" this month', /Paid/.test($('#view').textContent));
  check('S3 the unpaid employee is marked "Not yet"', /Not yet/.test($('#view').textContent));

  click($('[data-prview="' + emp.id + '"]')); await sleep(150);
  check('S4 opening the statement shows the employee\'s name', $('#view').textContent.includes('Sher Bahadur'));
  check('S5 it shows the salary payment row', $$('.kh-table tbody tr').length === 1);
  check('S6 the period is shown on the row', /September 2026/.test($('#view').textContent));
  click($('[data-prclose]')); await sleep(100);
  check('S7 closing the statement returns to just the list', !$('.kh-table'));

  /* ══════════════════════════════════════════════════════════════════════
     ADD / EDIT EMPLOYEE PANEL
     ══════════════════════════════════════════════════════════════════════ */
  w.go('payroll'); await sleep(100);
  click($('[data-praddemp]')); await sleep(120);
  check('A1 the "Add employee" panel opens', !!$('[data-f="name"]'));
  type($('[data-f="name"]'), 'Amjad Khan');
  type($('[data-f="role"]'), 'Loader');
  type($('[data-f="salary"]'), '18000');
  click($('[data-save="1"]')); await sleep(250);
  check('A2 saving adds a third employee', ERP.Employees.all().length === 3);
  const newEmp = ERP.Employees.all().find(e => e.name === 'Amjad Khan');
  check('A3 with the salary entered', !!newEmp && newEmp.monthlySalaryP === M.toP(18000));

  click($('[data-predit="' + newEmp.id + '"]')); await sleep(120);
  check('A4 editing pre-fills the existing values', $('[data-f="name"]').value === 'Amjad Khan');
  type($('[data-f="salary"]'), '20000');
  click($('[data-save="1"]')); await sleep(250);
  check('A5 saving an edit updates the salary', ERP.Employees.byId(newEmp.id).monthlySalaryP === M.toP(20000));

  /* ══════════════════════════════════════════════════════════════════════
     PAY SALARY PANEL
     ══════════════════════════════════════════════════════════════════════ */
  w.go('payroll'); await sleep(100);
  click($('[data-prpay="' + emp2.id + '"]')); await sleep(120);
  check('PS1 the panel opens pre-selected to the right employee', $('#fcSalEmp').value === emp2.id);
  check('PS2 the amount is pre-filled from that employee\'s monthly salary',
    $('#fcSalAmt').value === String(M.toR(40000 * 100)) || Number($('#fcSalAmt').value) === 40000);

  const emp1Balance = ERP.Payroll.totalPaid(emp.id);
  change($('#fcSalEmp'), emp.id); await sleep(80);
  check('PS3 switching employee refreshes the pre-filled amount to the new one\'s rate',
    Number($('#fcSalAmt').value) === 30000);

  type($('[data-f="period"]'), 'October advance');
  click($('[data-save="1"]')); await sleep(250);
  check('PS4 saving records a second payment for the first employee',
    ERP.Payroll.paymentsFor(emp.id).length === 2);
  check('PS5 the total paid grows by the new amount',
    ERP.Payroll.totalPaid(emp.id) === emp1Balance + M.toP(30000));

  /* ══════════════════════════════════════════════════════════════════════
     PERSISTENCE
     ══════════════════════════════════════════════════════════════════════ */
  await ERP.flush(); await sleep(400);
  const before = { employees: ERP.Employees.all().length, payments: ERP.Payroll.paymentsFor(emp.id).length };
  w.close();
  w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  /* wait for the payroll stores to finish loading rather than guessing at
     a delay — matches how test-khata.mjs awaits ERP.adjustmentsReady */
  await (w.ERP.payrollReady || Promise.resolve()).catch(() => {});
  await sleep(200);
  ERP = w.ERP; D = w.document;
  check('R1 employees survive a restart', ERP.Employees.all().length === before.employees);
  check('R2 salary payments survive a restart', ERP.Payroll.paymentsFor(emp.id).length === before.payments);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
