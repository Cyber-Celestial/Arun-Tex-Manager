import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePayroll, completionDate, nextMonth, openMonth, salaryEligibility,
  todayIndia, validDate, type HrState,
} from './index.ts';

const fixture = (): HrState => ({
  payrollStartMonth: '2026-01',
  employees: [{ id: 'e1', name: 'Test Employee', status: 'Active', baseSalary: 27000, transportAllowance: 3000, esiAmount: 100, pfAmount: 200, accumulatedPto: 0, weekendPenaltyCount: 0 }],
  attendance: [], sundayRosters: [], noteAdvances: [], salaryAdvances: [], payrollRuns: [],
});
test('PTO covers informed, paid and half-day leave but never uninformed absence', () => {
  const s = fixture();
  s.attendance = [
    { employeeId: 'e1', date: '2026-01-02', exceptionType: 'Paid Leave' },
    { employeeId: 'e1', date: '2026-01-03', exceptionType: 'Informed Absent' },
    { employeeId: 'e1', date: '2026-01-04', exceptionType: 'Half-Day' },
    { employeeId: 'e1', date: '2026-01-05', exceptionType: 'Uninformed Absent' },
    { employeeId: 'e1', date: '2026-01-06', exceptionType: 'On-Duty' },
    { employeeId: 'e1', date: '2026-02-01', exceptionType: 'Uninformed Absent' },
  ];
  const [line] = calculatePayroll(s, '2026-01');
  assert.equal(line.accrual, 2);
  assert.equal(line.ptoUsed, 2);
  assert.equal(line.closingPto, 0);
  assert.equal(line.unpaidDays, 1.5);
  assert.equal(line.attendanceDeduction, 750);
  assert.equal(line.dailyRate, 1000);
  assert.equal(line.net, 28950);
});
test('unused and fractional PTO carries forward, inactive staff do not accrue', () => {
  const s = fixture();
  s.employees[0].accumulatedPto = 1.25;
  s.attendance = [{ employeeId: 'e1', date: '2026-01-02', exceptionType: 'Half-Day' }];
  assert.equal(calculatePayroll(s, '2026-01')[0].closingPto, 2.75);
  s.employees[0].status = 'Inactive';
  assert.deepEqual(calculatePayroll(s, '2026-01'), []);
});
test('weekend penalties apply to each fourth-and-later annual absence, not working Sundays', () => {
  const s = fixture();
  for (const date of ['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24']) {
    s.attendance.push({ employeeId: 'e1', date, exceptionType: 'Informed Absent' });
    const sunday = new Date(date); sunday.setUTCDate(sunday.getUTCDate() + 1);
    s.sundayRosters.push({ employeeId: 'e1', date: sunday.toISOString().slice(0, 10), shiftType: 'Off' });
  }
  s.attendance.push({ employeeId: 'e1', date: '2026-02-02', exceptionType: 'Paid Leave' });
  s.sundayRosters.push({ employeeId: 'e1', date: '2026-02-01', shiftType: 'Off' });
  assert.equal(calculatePayroll(s, '2026-01')[0].weekendDeduction, 1000);
  const feb = calculatePayroll(s, '2026-02')[0];
  assert.equal(feb.weekendCount, 5);
  assert.equal(feb.weekendDeduction, 1000);
  s.sundayRosters.at(-1)!.shiftType = 'Half-Day';
  assert.equal(calculatePayroll(s, '2026-02')[0].weekendDeduction, 0);
  assert.equal(calculatePayroll(s, '2027-01')[0].weekendCount, 0);
});
test('imported annual count is an opening balance and resets in the next year', () => {
  const s = fixture(); s.employees[0].weekendPenaltyCount = 3;
  s.attendance = [{ employeeId: 'e1', date: '2026-01-03', exceptionType: 'Paid Leave' }];
  s.sundayRosters = [{ employeeId: 'e1', date: '2026-01-04', shiftType: 'Off' }];
  assert.equal(calculatePayroll(s, '2026-01')[0].weekendDeduction, 1000);
  assert.equal(calculatePayroll(s, '2027-01')[0].weekendDeduction, 0);
});
test('note repayments start in the following month and final installment uses only remaining balance', () => {
  const s = fixture();
  s.noteAdvances = [{ id: 'n1', employeeId: 'e1', totalAmount: 2500, remainingBalance: 500, monthlyRepayment: 1000, issueDate: '2026-01-10', status: 'Active' }];
  assert.equal(calculatePayroll(s, '2026-01')[0].noteDeduction, 0);
  assert.equal(calculatePayroll(s, '2026-02')[0].noteDeduction, 500);
  assert.equal(completionDate(s.noteAdvances[0]), '2026-02-28');
  assert.equal(completionDate({ ...s.noteAdvances[0], remainingBalance: 2500 }), '2026-04-30');
  assert.equal(completionDate(s.noteAdvances[0], '2026-02'), '2026-03-31');
});
test('actual note repayment cannot exceed available net; remaining debt is not forgiven', () => {
  const s = fixture(); s.employees[0].baseSalary = 500; s.employees[0].transportAllowance = 0;
  s.noteAdvances = [{ id: 'n1', employeeId: 'e1', totalAmount: 1000, remainingBalance: 1000, monthlyRepayment: 1000, issueDate: '2025-12-10', status: 'Active' }];
  const [line] = calculatePayroll(s, '2026-01');
  assert.equal(line.noteDeduction, 200);
  assert.equal(line.net, 0);
  assert.equal(s.noteAdvances[0].remainingBalance, 1000, 'preview is pure');
  s.attendance = [{ employeeId: 'e1', date: '2026-01-02', exceptionType: 'Uninformed Absent' }];
  const capped = calculatePayroll(s, '2026-01')[0];
  assert.equal(capped.net, 0);
  assert.equal(capped.noteDeduction, 0);
  assert.equal(capped.cappedDeductions, 300);
});
test('advance suggestion follows elapsed days, existing draws, notes, nearest ₹10 and remaining net cap', () => {
  const s = fixture();
  s.salaryAdvances = [{ id: 'a1', employeeId: 'e1', issueDate: '2026-01-02', amountIssued: 3000 },
    { id: 'prior', employeeId: 'e1', issueDate: '2025-12-02', amountIssued: 2000 }];
  s.noteAdvances = [{ id: 'n1', employeeId: 'e1', issueDate: '2025-12-02', totalAmount: 4000, remainingBalance: 4000, monthlyRepayment: 1000, status: 'Active' }];
  assert.equal(salaryEligibility(s, 'e1', '2026-01-15'), 12500);
  assert.equal(salaryEligibility(s, 'e1', '2026-01-01'), 0);
  assert.equal(salaryEligibility(s, 'e1', '2026-01-31'), 25700, '31-day rounding cannot exceed actual remaining pay');
  s.noteAdvances = []; s.salaryAdvances = []; s.employees[0].baseSalary = 27010;
  assert.equal(salaryEligibility(s, 'e1', '2026-01-02'), 2000);
});
test('calendar helpers handle leap days, December rollover and Indian business date', () => {
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-31'), false);
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(todayIndia(new Date('2026-01-31T21:00:00Z')), '2026-02-01');
  assert.equal(openMonth(fixture()), '2026-01');
});
