import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePayrollState } from './payroll-state.ts';
import type { HrState } from '@workspace/payroll';

const now = new Date('2026-02-15T06:00:00Z');
const fixture = (): HrState => ({
  payrollStartMonth: '2026-01', payrollRuns: [],
  employees: [{ id: 'e1', name: 'Test Employee', status: 'Active', baseSalary: 10000, transportAllowance: 0, esiAmount: 0, pfAmount: 0, accumulatedPto: 0, weekendPenaltyCount: 0 }],
  attendance: [], sundayRosters: [], salaryAdvances: [],
  noteAdvances: [{ id: 'n1', employeeId: 'e1', totalAmount: 1500, remainingBalance: 1500, monthlyRepayment: 1000, issueDate: '2025-12-10', status: 'Active', expectedCompletionDate: '2026-02-28' }],
});
const confirm = (s: HrState, month = '2026-01', date = now) => preparePayrollState(s, { ...s, payrollCommand: { month } }, 'admin-test', date);

test('confirmation snapshots authoritative totals, posts PTO, repays notes and advances open month once', () => {
  const s = fixture(), saved = confirm(s);
  assert.equal(saved.payrollRuns?.[0].lines[0].net, 9000);
  assert.equal(saved.payrollRuns?.[0].confirmedBy, 'admin-test');
  assert.equal(saved.employees[0].accumulatedPto, 2);
  assert.equal(saved.noteAdvances[0].remainingBalance, 500);
  assert.equal(saved.payrollCommand, undefined);
  assert.equal(s.noteAdvances[0].remainingBalance, 1500);
  assert.throws(() => confirm(saved), /cannot be processed twice/);
  const feb = confirm(saved, '2026-02', new Date('2026-03-01T06:00:00Z'));
  assert.equal(feb.noteAdvances[0].remainingBalance, 0);
  assert.equal(feb.noteAdvances[0].status, 'Completed');
  assert.equal(feb.payrollRuns?.[1].lines[0].noteDeduction, 500);
  assert.equal(feb.employees[0].accumulatedPto, 4);
});
test('empty months can be closed before the first hire without blocking the first payable month', () => {
  const empty = fixture(); empty.employees = []; empty.noteAdvances = [];
  const january = confirm(empty);
  assert.deepEqual(january.payrollRuns?.[0].lines, []);
  assert.equal(january.payrollRuns?.[0].confirmedBy, 'admin-test');
  assert.equal(january.payrollRuns?.[0].confirmedAt, now.toISOString());
  assert.throws(() => confirm(january), /cannot be processed twice/);
  const request = structuredClone(january);
  request.employees = [{ ...fixture().employees[0], payrollStartMonth: '2026-02' }];
  const hired = preparePayrollState(january, request, 'admin-test', now);
  assert.equal(hired.employees[0].accumulatedPto, 0);
  const february = confirm(hired, '2026-02', new Date('2026-03-01T06:00:00Z'));
  assert.equal(february.payrollRuns?.[1].lines[0].net, 10000);
  assert.equal(february.employees[0].accumulatedPto, 2);
});
test('months before an existing employee start month and months with all staff inactive can close', () => {
  const s = fixture(); s.noteAdvances = []; s.employees[0].payrollStartMonth = '2026-02';
  const january = confirm(s);
  assert.deepEqual(january.payrollRuns?.[0].lines, []);
  assert.equal(january.employees[0].accumulatedPto, 0);
  january.employees[0].status = 'Inactive';
  const february = confirm(january, '2026-02', new Date('2026-03-01T06:00:00Z'));
  assert.deepEqual(february.payrollRuns?.[1].lines, []);
  assert.equal(february.employees[0].accumulatedPto, 0);
  assert.equal(february.noteAdvances.length, 0);
});
test('confirmation rejects current/future months, skipped months and edits hidden in confirmation', () => {
  const s = fixture();
  assert.throws(() => confirm(s, '2026-02'), /next open/);
  assert.throws(() => confirm(s, '2026-01', new Date('2026-01-30T00:00:00Z')), /after the month/);
  const request = structuredClone(s); request.employees[0].baseSalary = 20000;
  assert.throws(() => preparePayrollState(s, { ...request, payrollCommand: { month: '2026-01' } }, 'admin-test', now), /Save changes and review/);
});
test('confirmed history, PTO, issued advances and historical attendance cannot be rewritten', () => {
  const s = confirm(fixture());
  for (const mutate of [
    (r: HrState) => { r.payrollRuns![0].lines[0].net = 1; },
    (r: HrState) => { r.employees[0].accumulatedPto = 500; },
    (r: HrState) => { r.attendance.push({ employeeId: 'e1', date: '2026-01-05', exceptionType: 'Paid Leave' }); },
    (r: HrState) => { r.sundayRosters.push({ employeeId: 'e1', date: '2026-02-01', shiftType: 'Off' }); },
  ]) {
    const request = structuredClone(s); mutate(request);
    assert.throws(() => preparePayrollState(s, request, 'admin-test', now));
  }
});
test('salary advances enforce current dates, combined elapsed-day limit and zero-floor capacity', () => {
  const s = confirm(fixture());
  const draw = { id: 'a1', employeeId: 'e1', issueDate: '2026-02-15', amountIssued: 4500 };
  const saved = preparePayrollState(s, { ...s, salaryAdvances: [draw] }, 'admin-test', now);
  assert.equal(saved.salaryAdvances.length, 1);
  for (const advances of [
    [{ ...draw, amountIssued: 4501 }],
    [draw, { ...draw, id: 'a2', amountIssued: 4000 }],
    [{ ...draw, issueDate: '2026-02-16' }],
    [{ ...draw, issueDate: '2026-01-15' }],
    [{ ...draw, amountIssued: -1 }],
  ]) assert.throws(() => preparePayrollState(s, { ...s, salaryAdvances: advances }, 'admin-test', now));
  assert.throws(() => preparePayrollState(saved, { ...saved, salaryAdvances: [] }, 'admin-test', now), /cannot be changed or deleted/);
});
test('new notes and revised schedules reject negative projected take-home, even across multiple loans', () => {
  const s = fixture();
  const note = { id: 'n2', employeeId: 'e1', totalAmount: 20000, remainingBalance: 20000, monthlyRepayment: 9500, issueDate: '2026-02-15', status: 'Active' };
  assert.throws(() => preparePayrollState(s, { ...s, noteAdvances: [...s.noteAdvances, note] }, 'admin-test', now), /negative/);
  assert.throws(() => preparePayrollState(s, { ...s, noteAdvances: s.noteAdvances.map(n => ({ ...n, monthlyRepayment: 11000, totalAmount: 20000, remainingBalance: 20000 })) }, 'admin-test', now), /negative/);
  const saved = preparePayrollState(s, { ...s, noteAdvances: [...s.noteAdvances, { ...note, monthlyRepayment: 2000 }] }, 'admin-test', now);
  assert.equal(saved.noteAdvances[1].expectedCompletionDate, '2026-12-31');
});
test('note top-ups match principal changes and payroll alone may reduce remaining balances', () => {
  const s = fixture(), request = structuredClone(s);
  request.noteAdvances[0].totalAmount += 500; request.noteAdvances[0].remainingBalance += 500;
  request.noteAdvances[0].monthlyRepayment = 500;
  const result = preparePayrollState(s, request, 'admin-test', now);
  assert.equal(result.noteAdvances[0].remainingBalance, 2000);
  const bad = structuredClone(s); bad.noteAdvances[0].remainingBalance = 0; bad.noteAdvances[0].status = 'Completed';
  assert.throws(() => preparePayrollState(s, bad, 'admin-test', now), /only change through payroll/);
});
test('payroll preserves unpaid note debt when later attendance consumes available pay', () => {
  const s = fixture(); s.employees[0].baseSalary = 500;
  s.attendance = [{ employeeId: 'e1', date: '2026-01-01', exceptionType: 'Uninformed Absent' }];
  const saved = confirm(s);
  assert.equal(saved.payrollRuns?.[0].lines[0].net, 0);
  assert.equal(saved.noteAdvances[0].remainingBalance, 1500);
});
test('invalid amounts, impossible dates, dangling employees and duplicate attendance are rejected', () => {
  for (const mutate of [
    (s: HrState) => { s.employees[0].baseSalary = NaN; },
    (s: HrState) => { s.employees[0].pfAmount = -1; },
    (s: HrState) => { s.noteAdvances[0].monthlyRepayment = 0; },
    (s: HrState) => { s.noteAdvances[0].issueDate = '2026-02-31'; },
    (s: HrState) => { s.noteAdvances[0].employeeId = 'missing'; },
    (s: HrState) => { s.attendance = Array(2).fill({ employeeId: 'e1', date: '2026-01-02', exceptionType: 'Paid Leave' }); },
  ]) {
    const s = fixture(), request = structuredClone(s); mutate(request);
    assert.throws(() => preparePayrollState(s, request, 'admin-test', now));
  }
});
