/* Payroll — employee salary management (30-payroll.js).
   2026-09-16: a minimal payment log. 2026-09-21: the client asked again ("the salary is also managed in this;
   whoever takes it the first time, we write them down afterwards") → a monthly system: per person per month
   DUE = salary + bonus − deduction, PAID = salary + advances, REMAINING; four kinds of entry; salary history;
   reversal; adding a person at their first payment; sheet / statement / slip documents; the profit report.
   The clock is pinned (FC_TODAY) so nothing here depends on the day the test is run. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${detail !== undefined ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let TODAY = '2026-09-21';

function boot(store) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://x.local/e',
    beforeParse(w) {
      w.indexedDB = store.idb || (store.idb = new FDBFactory());
      w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.alert = () => {}; w.prompt = () => 'test reason';
      w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}
async function ready(w) {
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await (w.ERP.payrollReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  w.FC_TODAY = () => TODAY;
}

async function main() {
  const store = {};
  let w = boot(store); await ready(w);
  let ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const rej = async p => { try { await p; return null; } catch (e) { return e; } };
  const P = x => M.toP(x);
  const view = () => $('#view').textContent;

  check('D1 ERP.Employees and ERP.Payroll exist', typeof ERP.Employees === 'object' && typeof ERP.Payroll === 'object');
  check('D2 the clock is pinned for this run', ERP.Payroll.currentMonth() === '2026-09');

  /* ══ EMPLOYEES ═══════════════════════════════════════════════════════════ */
  check('E1 an employee needs a name', !!(await rej(ERP.Employees.save({ name: '  ' }))).validation);
  check('E2 a name cannot carry markup characters', !!(await rej(ERP.Employees.save({ name: 'A<b>' }))).validation);
  check('E3 a salary must be a number', !!(await rej(ERP.Employees.save({ name: 'Bad', monthlySalary: 'abc' }))).validation);
  check('E4 a salary cannot be negative', !!(await rej(ERP.Employees.save({ name: 'Bad', monthlySalary: '-5' }))).validation);
  check('E5 a silly-large salary is refused', !!(await rej(ERP.Employees.save({ name: 'Bad', monthlySalary: '99999999999' }))).validation);
  check('E6 a bad start month is refused', !!(await rej(ERP.Employees.save({ name: 'Bad', startMonth: '2026-13' }))).validation);
  check('E7 nothing was created by the refusals', ERP.Employees.all().length === 0);

  const sher = await ERP.Employees.save({ name: 'Sher Bahadur', role: 'Driver', phone: '0300-1234567', monthlySalary: '30,000', startMonth: '2026-08' });
  check('E8 created with an id, salary in paisa (a comma is fine), start month', !!sher.id && sher.monthlySalaryP === P(30000) && sher.startMonth === '2026-08');
  check('E9 active by default with no end month', sher.active !== false && !sher.endMonth);
  check('E10 a second person with the same name is refused (any case, extra spaces)',
    !!(await rej(ERP.Employees.save({ name: '  sher   BAHADUR ' }))).validation);
  check('E11 …but editing that same person under the same name is fine',
    !(await rej(ERP.Employees.save({ id: sher.id, name: 'Sher Bahadur', role: 'Senior driver', monthlySalary: 30000 }))) && ERP.Employees.byId(sher.id).role === 'Senior driver');

  /* ══ THE MONTH FIGURES ═══════════════════════════════════════════════════ */
  let s = ERP.Payroll.sheet(sher, '2026-08');
  check('K1 a month with nothing paid: due is the salary, remaining all of it, "unpaid"', s.dueP === P(30000) && s.paidP === 0 && s.balanceP === P(30000) && s.status === 'unpaid');
  check('K2 before the start month nothing is due', ERP.Payroll.sheet(sher, '2026-07').dueP === 0);
  check('K3 a future month is not due yet: due 0, status "not due yet", but the planned salary is shown', (() => { const f = ERP.Payroll.sheet(sher, '2026-10'); return f.dueP === 0 && f.status === 'future' && f.planP === P(30000); })());
  check('K3b months outside 2000–2100 are not accepted as a start month', !!(await rej(ERP.Employees.save({ name: 'Bad', startMonth: '0001-01' }))).validation);

  const badAmt = await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 0, periodMonth: '2026-08' }));
  check('K4 zero / non-numeric amounts are refused', !!badAmt.validation && !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 'abc', periodMonth: '2026-08' }))).validation);
  check('K5 an unknown employee is refused', !!(await rej(ERP.Payroll.pay({ employeeId: 'nope', amount: 500, periodMonth: '2026-08' }))).validation);
  check('K6 an impossible date is refused', !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 500, date: '2026-02-31', periodMonth: '2026-08' }))).validation);
  check('K7 a bad month is refused', !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 500, periodMonth: '2026-8' }))).validation);
  check('K8 an unknown payment method is refused', !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 500, periodMonth: '2026-08', method: 'Barter' }))).validation);
  check('K9 an unknown kind is refused', !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 500, periodMonth: '2026-08', kind: 'GIFT' }))).validation);
  check('K10 none of those wrote anything', ERP.S.salaryPayments.length === 0);

  const p1 = await ERP.Payroll.pay({ employeeId: sher.id, amount: 20000, date: '2026-09-01', periodMonth: '2026-08', method: 'Bank Transfer', reference: 'TRX1', note: 'first part' });
  check('K11 a salary payment is recorded with a number, kind, month and audit entry',
    /^SAL-\d{4}-\d{6}$/.test(p1.salaryNumber) && p1.kind === 'SALARY' && p1.periodMonth === '2026-08' && p1.period === 'August 2026' &&
    ERP.S.audit.some(a => a.entityId === p1.id && /Salary paid/.test(a.action)));
  s = ERP.Payroll.sheet(sher, '2026-08');
  check('K12 August is now part paid: paid 20,000, 10,000 left', s.paidP === P(20000) && s.balanceP === P(10000) && s.status === 'part');
  check('K13 the month is the month it is FOR, not the day it was paid (paid 1 Sep for August)', ERP.Payroll.sheet(sher, '2026-09').paidP === 0);

  const over = await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 10001, date: '2026-09-02', periodMonth: '2026-08' }));
  check('K14 a salary payment above what is left is refused, and says so (with the Advance way out)',
    !!over.validation && /more than what is left/.test(over.validation[0]) && /Advance/.test(over.validation[0]), over.validation && over.validation[0]);
  const p2 = await ERP.Payroll.pay({ employeeId: sher.id, amount: 10000, date: '2026-09-02', periodMonth: '2026-08' });
  check('K15 the exact remainder is accepted and the month reads "paid"', ERP.Payroll.sheet(sher, '2026-08').status === 'paid' && ERP.Payroll.sheet(sher, '2026-08').balanceP === 0);
  check('K16 a second salary payment for a paid month is refused',
    !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 1, date: '2026-09-03', periodMonth: '2026-08' }))).validation);
  check('K17 entry numbers are unique', new Set([p1.salaryNumber, p2.salaryNumber]).size === 2);

  const adv = await ERP.Payroll.pay({ employeeId: sher.id, kind: 'ADVANCE', amount: 5000, date: '2026-09-10', periodMonth: '2026-09', method: 'Cash' });
  s = ERP.Payroll.sheet(sher, '2026-09');
  check('K18 an advance counts as paid for its month', s.advanceP === P(5000) && s.paidP === P(5000) && s.balanceP === P(25000) && s.status === 'part');
  await ERP.Payroll.pay({ employeeId: sher.id, kind: 'BONUS', amount: 2000, date: '2026-09-11', periodMonth: '2026-09', note: 'Eid' });
  s = ERP.Payroll.sheet(sher, '2026-09');
  check('K19 a bonus adds to what is due and moves no cash', s.bonusP === P(2000) && s.dueP === P(32000) && s.paidP === P(5000) && s.balanceP === P(27000));
  const bonusRec = ERP.Payroll.entriesFor(sher.id).find(e => e.kind === 'BONUS');
  check('K20 a bonus carries no method or reference', bonusRec.method === '' && bonusRec.reference === '');
  await ERP.Payroll.pay({ employeeId: sher.id, kind: 'DEDUCTION', amount: 1000, date: '2026-09-12', periodMonth: '2026-09', note: 'absent 1 day' });
  s = ERP.Payroll.sheet(sher, '2026-09');
  check('K21 a deduction takes from what is due', s.deductionP === P(1000) && s.dueP === P(31000) && s.balanceP === P(26000));
  check('K22 a deduction larger than the month is refused',
    !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, kind: 'DEDUCTION', amount: 40000, periodMonth: '2026-09' }))).validation);
  check('K23 a deduction for a month that is not due yet is refused',
    !!(await rej(ERP.Payroll.pay({ employeeId: sher.id, kind: 'DEDUCTION', amount: 100, periodMonth: '2026-10' }))).validation);
  const futSal = await rej(ERP.Payroll.pay({ employeeId: sher.id, amount: 100, periodMonth: '2026-10' }));
  check('K24 a SALARY payment for a month that has not started is refused, pointing to Advance',
    !!futSal.validation && /Advance/.test(futSal.validation[0]) && /not started/.test(futSal.validation[0]), futSal.validation && futSal.validation[0]);
  const adv2 = await ERP.Payroll.pay({ employeeId: sher.id, kind: 'ADVANCE', amount: 3000, date: '2026-09-15', periodMonth: '2026-10' });
  s = ERP.Payroll.sheet(sher, '2026-10');
  check('K25 an advance can be given ahead: October reads "paid ahead" by 3,000', s.status === 'ahead' && s.balanceP === -P(3000));

  const st = ERP.Payroll.statement(sher.id);
  check('K26 the statement runs from the start month to the latest month with anything in it', st.months.map(x => x.month).join() === '2026-08,2026-09,2026-10');
  check('K27 total due = 30,000 + 31,000; paid = 30,000 + 5,000 + 3,000; still owed = 23,000',
    st.totals.dueP === P(61000) && st.totals.paidP === P(38000) && st.totals.balanceP === P(23000), JSON.stringify(st.totals));
  check('K28 paymentsFor is cash only (salary + advances); totalPaid matches', ERP.Payroll.paymentsFor(sher.id).length === 4 && ERP.Payroll.totalPaid(sher.id) === P(38000));
  check('K29 last payment date and paidThisMonth follow the month the money is for',
    ERP.Payroll.lastPaymentDate(sher.id) === '2026-09-15' && ERP.Payroll.paidThisMonth(sher.id, '2026-09') && !ERP.Payroll.paidThisMonth(sher.id, '2026-11'));

  /* ══ REVERSAL ════════════════════════════════════════════════════════════ */
  await ERP.Payroll.reverse(adv.id, 'given twice by mistake');
  s = ERP.Payroll.sheet(sher, '2026-09');
  check('R1 a reversed advance is no longer counted', s.advanceP === 0 && s.paidP === 0 && s.balanceP === P(31000));
  check('R2 it is kept, marked reversed, with who/when/why', (() => { const r = ERP.S.salaryPayments.find(x => x.id === adv.id); return r.status === 'REVERSED' && r.reverseReason === 'given twice by mistake' && !!r.reversedAt; })());
  check('R3 the audit log records the reversal with its reason', ERP.S.audit.some(a => a.entityId === adv.id && /reversed/i.test(a.action) && a.reason === 'given twice by mistake'));
  check('R4 reversing twice is refused', !!(await rej(ERP.Payroll.reverse(adv.id, 'again'))).validation);
  check('R5 reversing an unknown entry is refused', !!(await rej(ERP.Payroll.reverse('nope', 'x'))).validation);
  check('R6 reversed entries stay in entriesFor(…, true) only', ERP.Payroll.entriesFor(sher.id, true).some(x => x.id === adv.id) && !ERP.Payroll.entriesFor(sher.id).some(x => x.id === adv.id));
  const again = await ERP.Payroll.pay({ employeeId: sher.id, amount: 31000, date: '2026-09-20', periodMonth: '2026-09' });
  check('R7 after reversing, the month can be paid in full again', ERP.Payroll.sheet(sher, '2026-09').status === 'paid' && !!again.id);
  await ERP.Payroll.reverse(again.id, 'wrong month');

  /* ══ SALARY HISTORY, LEAVING, RESTORING ══════════════════════════════════ */
  await ERP.Employees.save({ id: sher.id, name: 'Sher Bahadur', role: 'Senior driver', monthlySalary: 40000, effectiveFrom: '2026-10' });
  check('H1 a raise from October does not rewrite September (still 30,000 in September)', ERP.Payroll.sheet(ERP.Employees.byId(sher.id), '2026-09').rateP === P(30000));
  check('H2 the current salary is what applies today (September → 30,000)', ERP.Employees.byId(sher.id).monthlySalaryP === P(30000));
  TODAY = '2026-10-05';
  check('H3 in October the new salary applies: due 40,000, of which 3,000 already advanced', (() => { const x = ERP.Payroll.sheet(ERP.Employees.byId(sher.id), '2026-10'); return x.rateP === P(40000) && x.dueP === P(40000) && x.balanceP === P(37000); })());
  check('H4 changing the salary again for the SAME month replaces that step (no duplicates)', await (async () => {
    await ERP.Employees.save({ id: sher.id, name: 'Sher Bahadur', monthlySalary: 42000, effectiveFrom: '2026-10' });
    const r = ERP.Employees.byId(sher.id).rates; return r.filter(x => x.from === '2026-10').length === 1 && ERP.Employees.rateAt(ERP.Employees.byId(sher.id), '2026-10') === P(42000);
  })());
  check('H5 saving with the salary unchanged adds no history step', await (async () => {
    const n = ERP.Employees.byId(sher.id).rates.length;
    await ERP.Employees.save({ id: sher.id, name: 'Sher Bahadur', role: 'X', monthlySalary: 42000, effectiveFrom: '2026-11' });
    return ERP.Employees.byId(sher.id).rates.length === n;
  })());
  await ERP.Employees.archive(sher.id, true);
  check('H6 archiving records the last month owed (this month)', ERP.Employees.byId(sher.id).endMonth === '2026-10' && ERP.Employees.byId(sher.id).active === false);
  TODAY = '2026-11-03';
  check('H7 after they leave, later months are not due', ERP.Payroll.sheet(ERP.Employees.byId(sher.id), '2026-11').dueP === 0);
  check('H8 …and they are not listed on the later month\'s sheet', !ERP.Payroll.monthSheet('2026-11').rows.some(r => r.employee.id === sher.id));
  check('H9 …but they are still on the month they left in, with what is owed', ERP.Payroll.monthSheet('2026-10').rows.some(r => r.employee.id === sher.id));
  await ERP.Employees.archive(sher.id, false);
  check('H10 restoring clears the end month', !ERP.Employees.byId(sher.id).endMonth && ERP.Employees.byId(sher.id).active !== false);
  TODAY = '2026-09-21';

  /* ══ THE FIRST PAYMENT ADDS THE PERSON ═══════════════════════════════════ */
  const before = { emps: ERP.Employees.all().length, ents: ERP.S.salaryPayments.length, aud: ERP.S.audit.length };
  check('F1 a new person without a name is refused and nothing is created',
    !!(await rej(ERP.Payroll.pay({ newEmployee: { name: '', monthlySalary: 20000 }, amount: 20000, date: '2026-09-20', periodMonth: '2026-09' }))).validation &&
    ERP.Employees.all().length === before.emps && ERP.S.salaryPayments.length === before.ents);
  check('F2 a new person with the name of someone already listed is refused',
    !!(await rej(ERP.Payroll.pay({ newEmployee: { name: 'sher bahadur', monthlySalary: 20000 }, amount: 100, date: '2026-09-20', periodMonth: '2026-09' }))).validation);
  check('F3 a first SALARY payment above the new person\'s salary is refused and creates nobody',
    !!(await rej(ERP.Payroll.pay({ newEmployee: { name: 'Zar Wali', monthlySalary: 20000 }, amount: 25000, date: '2026-09-20', periodMonth: '2026-09' }))).validation &&
    ERP.Employees.all().length === before.emps);
  const first = await ERP.Payroll.pay({ newEmployee: { name: 'Zar Wali', role: 'Accountant', phone: '0311', monthlySalary: 40000 }, amount: 40000, date: '2026-09-20', periodMonth: '2026-09', method: 'Cash' });
  const zar = ERP.Employees.byId(first.employeeId);
  check('F4 the first payment adds the person and records the salary together', !!zar && zar.name === 'Zar Wali' && zar.role === 'Accountant' && ERP.Employees.all().length === before.emps + 1 && first.employeeNameSnapshot === 'Zar Wali');
  check('F5 they start on payroll in the month of that first payment, with their salary', zar.startMonth === '2026-09' && zar.monthlySalaryP === P(40000) && ERP.Payroll.sheet(zar, '2026-09').status === 'paid');
  check('F6 both the new person and the payment are in the audit trail', ERP.S.audit.some(a => a.entityId === zar.id && /added/i.test(a.action)) && ERP.S.audit.some(a => a.entityId === first.id));
  const dup = await rej(ERP.Payroll.pay({ employeeId: zar.id, amount: 1, date: '2026-09-21', periodMonth: '2026-09', clientOpId: 'same-op' }));
  const okOp = await ERP.Payroll.pay({ employeeId: zar.id, kind: 'ADVANCE', amount: 100, date: '2026-09-21', periodMonth: '2026-09', clientOpId: 'op-1' });
  const dup2 = await rej(ERP.Payroll.pay({ employeeId: zar.id, kind: 'ADVANCE', amount: 100, date: '2026-09-21', periodMonth: '2026-09', clientOpId: 'op-1' }));
  check('F7 a double-clicked Save (same operation id) records once', !!okOp.id && !!dup2 && !!dup2.validation && ERP.Payroll.entriesFor(zar.id).filter(e => e.clientOpId === 'op-1').length === 1, dup2 && JSON.stringify(dup2));
  check('F8 the refused salary in F7 first line changed nothing', !!dup.validation);

  /* ══ LEGACY RECORDS ══════════════════════════════════════════════════════ */
  await ERP.Employees.save({ name: 'Old Hand', monthlySalary: 10000, startMonth: '2026-09' });
  const old = ERP.Employees.all().find(e => e.name === 'Old Hand');
  ERP.S.salaryPayments.unshift({ id: 'legacy1', salaryNumber: 'SAL-2026-900001', employeeId: old.id, amount: P(10000), method: 'Cash', paymentDate: '2026-09-05', period: 'September 2026', status: 'POSTED', createdAt: '2026-09-05T00:00:00Z' });
  check('L1 an entry saved before this version (no kind, no month) counts as a SALARY for the month of its date', ERP.Payroll.sheet(old, '2026-09').paidP === P(10000) && ERP.Payroll.sheet(old, '2026-09').status === 'paid');
  const oldNoStart = { id: 'e_legacy', name: 'Legacy', monthlySalaryP: P(5000), createdAt: '2026-06-15T00:00:00Z', active: true };
  const boundary = { id: 'e_b', name: 'B', monthlySalaryP: 1, createdAt: new Date(2026, 8, 1, 1, 0, 0).toISOString(), active: true };   /* 1 a.m. LOCAL on 1 Sep — a different month in UTC anywhere east of Greenwich */
  check('L2b a legacy person added just after midnight on the 1st is placed in the LOCAL month, not the UTC one', ERP.Employees.startMonthOf(boundary) === '2026-09');
  check('L2 a person saved before this version (no start month, no salary history) still has figures', ERP.Employees.startMonthOf(oldNoStart) === '2026-06' && ERP.Employees.rateAt(oldNoStart, '2026-09') === P(5000));
  ERP.S.salaryPayments = ERP.S.salaryPayments.filter(x => x.id !== 'legacy1');

  /* ══ ROLES ═══════════════════════════════════════════════════════════════ */
  const realCan = ERP.RBAC.can; ERP.RBAC.can = perm => perm !== 'PAYROLL_MANAGE';   /* a role without payroll (a real sign-in is covered by test-accounts) */
  check('P1 a role without PAYROLL_MANAGE cannot record or reverse (in the service, not only the screen)',
    !!(await rej(ERP.Payroll.pay({ employeeId: zar.id, kind: 'ADVANCE', amount: 5, date: '2026-09-21', periodMonth: '2026-09' }))).validation &&
    !!(await rej(ERP.Payroll.reverse(okOp.id, 'x'))).validation);
  ERP.RBAC.can = realCan;

  /* ══ PROFIT REPORT ═══════════════════════════════════════════════════════ */
  const t0 = ERP.Profit.report('2026-09-01', '2026-09-30', { by: 'none' }).totals;
  const cashSep = ERP.S.salaryPayments.filter(x => x.status !== 'REVERSED' && (x.kind === 'SALARY' || x.kind === 'ADVANCE' || !x.kind) && x.paymentDate >= '2026-09-01' && x.paymentDate <= '2026-09-30').reduce((a, x) => a + x.amount, 0);
  check('G1 the profit report counts salaries actually paid in the period (cash only — not bonus, not deduction, not reversed)', t0.salaries === cashSep && cashSep > 0, t0.salaries + ' vs ' + cashSep);
  check('G2 "after expenses" now subtracts them', t0.netAfterExpenses === t0.netProfit - t0.expenses - t0.salaries);
  check('G3 a period with no salaries paid is unchanged', ERP.Profit.report('2026-01-01', '2026-01-31', { by: 'none' }).totals.salaries === 0);

  /* ══ DOCUMENTS ═══════════════════════════════════════════════════════════ */
  const sd = ERP.Payroll.sheetDoc('2026-09');
  check('T1 the salary sheet document has a row per person and a totals row', sd.rows.length === ERP.Payroll.monthSheet('2026-09').rows.length && sd.itemsFooter && /TOTAL/.test(sd.itemsFooter.description));
  const std = ERP.Payroll.statementDoc(sher.id);
  check('T2 the statement document lists months with a total', std.rows.length >= 2 && std.itemsFooter.description === 'TOTAL');
  const slip = ERP.Payroll.slipDoc(first.id);
  check('T3 a slip shows the month, what is due and what is left, with the employee\'s signature line', slip && slip.number === first.salaryNumber && slip.rows.length >= 3 && slip.signatures[0].indexOf('employee') > -1);
  check('T4 the Excel sheets are built (sheet + statement)', ERP.Payroll.sheets('2026-09')[0].rows.length > 3 && ERP.Payroll.statementSheets(sher.id).length === 2);
  check('T5 Excel builds to bytes', (() => { try { return ERP.XLSX.build(ERP.Payroll.sheets('2026-09'), { title: 't' }).length > 100; } catch (e) { return false; } })());

  /* ══ THE SCREEN ══════════════════════════════════════════════════════════ */
  check('N1 a nav entry exists in Finance', w.NAV.some(n => n.id === 'payroll') && w.NAVGROUPS.some(g => g[0] === 'Finance' && g[1].includes('payroll')));
  w.go('payroll'); await sleep(200);
  const rowsNow = $$('table.tbl tbody tr').filter(r => !r.classList.contains('pr-tot'));
  const sheetNow = ERP.Payroll.monthSheet('2026-09');
  check('S1 the salary sheet lists everyone on the September payroll, plus a totals row', rowsNow.length === sheetNow.rows.length && !!$('tr.pr-tot'), rowsNow.length + ' vs ' + sheetNow.rows.length);
  check('S2 it opens on the current month', /September 2026/.test(view()) && $('[data-prmonth]').value === '2026-09');
  check('S3 status pills show Paid / Part paid / Not paid', /Paid/.test(view()));
  click($('[data-prmove="1"]')); await sleep(120);
  check('S4 the next-month button moves to October, and back again', $('[data-prmonth]').value === '2026-10' && (click($('[data-prmove="-1"]')), true));
  await sleep(120);
  check('S5 …back on September', $('[data-prmonth]').value === '2026-09');
  change($('[data-prmonth]'), '2026-08'); await sleep(150);
  check('S6 picking a month in the box moves to it; August shows Sher\'s part payments as Paid', $('[data-prmonth]').value === '2026-08' && /Sher Bahadur/.test(view()) && /Paid/.test(view()));
  change($('[data-prmonth]'), ''); await sleep(50);
  check('S7 clearing the month box does not break the screen', /Salary sheet/.test(view()));
  click($('[data-prmove="0"]') || $('[data-prmove="1"]')); await sleep(100);
  w.go('payroll'); await sleep(120);
  check('S8 the four figure cards are there', $$('.kh-cards .kh-card').length >= 4);

  click($('[data-prview="' + sher.id + '"]')); await sleep(150);
  check('S9 the statement shows month-by-month and every entry, with reversed ones struck through', !!$('#fcPrStatement') && $$('#fcPrStatement tr.pr-rev').length >= 2 && /Month by month/.test(view()));
  check('S10 reversed entries have no Reverse button, live ones do', $$('#fcPrStatement [data-prrev]').length === ERP.Payroll.entriesFor(sher.id).length);
  const revBtn = $('#fcPrStatement [data-prrev]');
  const revId = revBtn.dataset.prrev;
  click(revBtn); await sleep(300);
  check('S11 the Reverse button asks for a reason, then reverses (dialog answered)', ERP.S.salaryPayments.find(x => x.id === revId).status === 'REVERSED');
  click($('[data-prclose]')); await sleep(100);
  check('S12 closing the statement returns to the sheet', !$('#fcPrStatement'));

  /* ── the pay panel ── */
  w.go('payroll'); await sleep(100);
  click($('[data-prpay="' + zar.id + '"]')); await sleep(150);
  check('X1 the panel opens with the right employee selected and September as the month', $('#fcSalEmp').value === zar.id && $('#fcSalMonth').value === '2026-09');
  check('X2 the live line says where the month stands', /left|paid ahead/.test($('#fcSalInfo').textContent) && /September 2026/.test($('#fcSalInfo').textContent));
  check('X3 nothing is left for someone already paid in full, so no amount is suggested', $('#fcSalAmt').value === '', $('#fcSalAmt').value);
  const sherSep = ERP.Payroll.sheet(ERP.Employees.byId(sher.id), '2026-09').balanceP;
  change($('#fcSalEmp'), sher.id); await sleep(80);
  check('X4 switching person refreshes the line, and the amount becomes what is LEFT for the month (not the full salary)',
    /September 2026/.test($('#fcSalInfo').textContent) && sherSep > 0 && Number($('#fcSalAmt').value) === M.toR(sherSep), $('#fcSalAmt').value + ' vs ' + M.toR(sherSep));
  change($('#fcSalKind'), 'BONUS'); await sleep(80);
  check('X5 for a bonus the method box is hidden and no amount is suggested', $('#fcSalCash').style.display === 'none' && $('#fcSalAmt').value === '');
  change($('#fcSalKind'), 'SALARY'); await sleep(80);
  check('X6 back to salary the method box returns', $('#fcSalCash').style.display !== 'none');
  change($('#fcSalEmp'), zar.id); await sleep(60);
  change($('#fcSalKind'), 'SALARY'); type($('#fcSalAmt'), '999999'); await sleep(30);
  click($('[data-save="1"]')); await sleep(150);
  check('X7 an over-payment is refused INSIDE the panel (still open, message shown, nothing saved)',
    $('#panel').classList.contains('on') && /more than what is left|nothing is due|Nothing is due/i.test($('#panelErr').textContent), $('#panelErr').textContent);
  const cbX = $('#panel [data-close]'); click(cbX); await sleep(80);

  /* a brand-new person from the panel */
  click($('[data-prpay=""]')); await sleep(150);
  check('X7b a header "Pay salary" starts on a blank choice — nobody is pre-selected on a money screen', $('#fcSalEmp').value === '' && !$('#panelErr').textContent);
  type($('#fcSalAmt'), '500');
  click($('[data-save="1"]')); await sleep(100);
  check('X7c saving without choosing an employee is refused in the panel', /Choose an employee/.test($('#panelErr').textContent) && $('#panel').classList.contains('on'));
  change($('#fcSalEmp'), '__new'); await sleep(60);
  check('X8a the "where the month stands" bar is hidden until it has something to say', $('#fcSalInfo').style.display === 'none');
  check('X8 choosing "New person" reveals the name/salary fields', $('#fcSalNew').style.display !== 'none');
  change($('#fcSalMonth'), '2026-08'); await sleep(40);
  check('X8b changing the month moves the start month of a new person with it', $('#fcSalNewStart').value === '2026-08');
  change($('#fcSalMonth'), '2026-09'); await sleep(40);
  type($('#fcSalNewName'), 'Amjad Khan'); type($('[data-f="newrole"]'), 'Loader'); type($('#fcSalNewRate'), '18000'); await sleep(40);
  check('X9 the live line and amount follow the new person\'s salary', Number($('#fcSalAmt').value) === 18000 && /18,000/.test($('#fcSalInfo').textContent), $('#fcSalAmt').value + ' / ' + $('#fcSalInfo').textContent);
  click($('[data-save="1"]')); await sleep(300);
  const amjad = ERP.Employees.all().find(e => e.name === 'Amjad Khan');
  check('X10 saving adds the person and the payment together', !!amjad && amjad.role === 'Loader' && ERP.Payroll.paymentsFor(amjad.id).length === 1 && ERP.Payroll.sheet(amjad, '2026-09').status === 'paid');
  check('X11 the panel closed and the sheet shows the new person', !$('#panel').classList.contains('on') && /Amjad Khan/.test(view()));

  click($('[data-prpay=""]')); await sleep(150);
  change($('#fcSalEmp'), '__new'); await sleep(60);
  type($('#fcSalAmt'), '1000');
  click($('[data-save="1"]')); await sleep(100);
  check('X12 "New person" with no name is refused in the panel', /name/i.test($('#panelErr').textContent) && $('#panel').classList.contains('on'));
  click($('#panel [data-close]')); await sleep(60);

  /* add / edit employee panel */
  click($('[data-praddemp]')); await sleep(120);
  check('A1 Add employee opens with a start-month field defaulting to this month', $('[data-f="start"]').value === '2026-09' && !$('[data-f="eff"]'));
  type($('[data-f="name"]'), 'Bilal'); type($('[data-f="salary"]'), '15000');
  click($('[data-save="1"]')); await sleep(250);
  const bilal = ERP.Employees.all().find(e => e.name === 'Bilal');
  check('A2 saving adds them, starting this month, at that salary', !!bilal && bilal.startMonth === '2026-09' && bilal.monthlySalaryP === P(15000));
  click($('[data-predit="' + bilal.id + '"]')); await sleep(120);
  check('A3 editing pre-fills, and offers "a changed salary counts from"', $('[data-f="name"]').value === 'Bilal' && !!$('[data-f="eff"]'));
  type($('[data-f="name"]'), 'Amjad Khan');
  click($('[data-save="1"]')); await sleep(150);
  check('A4 a duplicate name is refused in the panel', /already on the list/.test($('#panelErr').textContent));
  type($('[data-f="name"]'), 'Bilal Ahmed'); type($('[data-f="salary"]'), '17000'); change($('[data-f="eff"]'), '2026-10');
  click($('[data-save="1"]')); await sleep(250);
  check('A5 a raise counting from October leaves September alone', ERP.Employees.byId(bilal.id).name === 'Bilal Ahmed' && ERP.Employees.rateAt(ERP.Employees.byId(bilal.id), '2026-09') === P(15000) && ERP.Employees.rateAt(ERP.Employees.byId(bilal.id), '2026-10') === P(17000));
  click($('[data-predit="' + bilal.id + '"]')); await sleep(120);
  $('#fcEmpActive').checked = false;
  click($('[data-save="1"]')); await sleep(250);
  check('A6 unticking "still working here" archives them with this month as the last', ERP.Employees.byId(bilal.id).active === false && ERP.Employees.byId(bilal.id).endMonth === '2026-09');
  click($('[data-prpay="' + bilal.id + '"]')); await sleep(120);
  check('A7 an archived person stays selectable and pre-selected, marked archived', $('#fcSalEmp').value === bilal.id && /archived/i.test($('#fcSalEmp option:checked').textContent));
  click($('#panel [data-close]')); await sleep(60);

  /* print / excel from the screen */
  let opened = null; const origOpen = ERP.Viewer.open; ERP.Viewer.open = m => { opened = m; };
  w.go('payroll'); await sleep(100);
  click($('[data-prsheetprint]'));
  check('Y1 Print opens the salary sheet document', opened && /Salary sheet/i.test(opened.title));
  click($('[data-prview="' + sher.id + '"]')); await sleep(120);
  click($('[data-prstprint]'));
  check('Y2 Print on a statement opens the salary statement', opened && /Salary statement/i.test(opened.title));
  click($('[data-prslip]'));
  check('Y3 Slip opens a slip for that entry', opened && /slip/i.test(opened.title));
  ERP.Viewer.open = origOpen;
  let dl = 0; const oc = w.HTMLAnchorElement.prototype.click; w.HTMLAnchorElement.prototype.click = function () { if (this.download) dl++; };
  click($('[data-prsheetxls]')); click($('[data-prstxls]'));
  w.HTMLAnchorElement.prototype.click = oc;
  check('Y4 Excel downloads for the sheet and for a statement', dl === 2, dl);

  /* ══ ACCESS ══════════════════════════════════════════════════════════════ */
  ERP.RBAC.can = perm => perm !== 'PAYROLL_MANAGE';
  w.go('payroll'); await sleep(150);
  check('Z1 a role without PAYROLL_MANAGE sees the locked notice, no salaries', /not open to you/.test(view()) && !/Sher Bahadur/.test(view()));
  ERP.RBAC.can = realCan;

  /* ══ PERSISTENCE ═════════════════════════════════════════════════════════ */
  await ERP.flush(); await sleep(400);
  const snap = { emps: ERP.Employees.all().length, ents: ERP.S.salaryPayments.length, rev: ERP.S.salaryPayments.filter(x => x.status === 'REVERSED').length,
    rates: JSON.stringify(ERP.Employees.byId(sher.id).rates), bal: ERP.Payroll.statement(sher.id).totals.balanceP };
  w.close(); w = boot(store); await ready(w);
  ERP = w.ERP; M = w.Money;
  check('W1 people survive a restart, with their salary history and start month', ERP.Employees.all().length === snap.emps && JSON.stringify(ERP.Employees.byId(sher.id).rates) === snap.rates && ERP.Employees.byId(sher.id).startMonth === '2026-08');
  check('W2 entries survive, reversed ones still reversed', ERP.S.salaryPayments.length === snap.ents && ERP.S.salaryPayments.filter(x => x.status === 'REVERSED').length === snap.rev);
  check('W3 the month figures come out identical after the restart', ERP.Payroll.statement(sher.id).totals.balanceP === snap.bal);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
