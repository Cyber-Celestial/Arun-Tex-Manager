import {
  absenceTypes, calculatePayroll, completionDate, nextMonth, openMonth,
  roundMoney, salaryEligibility, scheduledNotes, todayIndia, validDate, validMonth,
  type HrState,
} from '@workspace/payroll';
import { isDeepStrictEqual } from 'node:util';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validatePayrollState(value: Obj): asserts value is Obj & HrState {
  for (const key of ['employees', 'attendance', 'sundayRosters', 'noteAdvances', 'salaryAdvances']) {
    requireRule(Array.isArray(value[key]) && value[key].every(object), `HR data must contain a valid ${key} list.`);
  }
  const state = value as unknown as HrState;
  const ids = new Set<string>();
  for (const e of state.employees) {
    requireRule(typeof e.id === 'string' && e.id.length > 0 && !ids.has(e.id), 'Employee IDs must be present and unique.');
    ids.add(e.id);
    requireRule(typeof e.name === 'string' && e.name.trim() && ['Active', 'Inactive'].includes(e.status), 'Employees need a name and valid status.');
    requireRule([e.baseSalary, e.transportAllowance, e.esiAmount, e.pfAmount, e.accumulatedPto].every(money), 'Salary, statutory deductions and PTO must be valid non-negative numbers.');
    requireRule(Number.isInteger(e.weekendPenaltyCount) && e.weekendPenaltyCount >= 0, 'Opening weekend counts must be non-negative whole numbers.');
    requireRule(e.payrollStartMonth === undefined || validMonth(e.payrollStartMonth), 'Employee payroll start month is invalid.');
  }
  const attendanceDates = new Set<string>();
  for (const a of state.attendance) {
    requireRule(ids.has(a.employeeId) && validDate(a.date) && absenceTypes.includes(a.exceptionType), 'Attendance needs an existing employee, valid date and supported exception.');
    const key = `${a.employeeId}:${a.date}`;
    requireRule(!attendanceDates.has(key), 'Only one attendance exception per employee per date is allowed.');
    attendanceDates.add(key);
  }
  const rosterDates = new Set<string>();
  for (const r of state.sundayRosters) {
    requireRule(ids.has(r.employeeId) && validDate(r.date) && new Date(r.date).getUTCDay() === 0 && ['Off', 'Half-Day', 'Full-Day'].includes(r.shiftType), 'Sunday rosters need an existing employee, Sunday date and valid shift.');
    const key = `${r.employeeId}:${r.date}`;
    requireRule(!rosterDates.has(key), 'Only one Sunday roster entry per employee per date is allowed.');
    rosterDates.add(key);
  }
  const advanceIds = new Set<string>();
  for (const n of [...state.noteAdvances, ...state.salaryAdvances]) {
    requireRule(typeof n.id === 'string' && n.id && !advanceIds.has(n.id) && ids.has(n.employeeId) && validDate(n.issueDate), 'Advances need unique IDs, an existing employee and a valid issue date.');
    advanceIds.add(n.id);
  }
  for (const n of state.noteAdvances) {
    requireRule(money(n.totalAmount) && n.totalAmount > 0 && money(n.remainingBalance) && n.remainingBalance <= n.totalAmount && money(n.monthlyRepayment) && n.monthlyRepayment > 0, 'Note advance amounts and repayments must be positive, with a valid remaining balance.');
    requireRule(['Active', 'Completed'].includes(n.status) && (n.status === 'Completed') === (n.remainingBalance === 0), 'Note advance status must match its balance.');
    requireRule(Math.ceil(n.remainingBalance / n.monthlyRepayment) <= 1200, 'The repayment schedule cannot exceed 100 years.');
  }
  for (const a of state.salaryAdvances) requireRule(money(a.amountIssued) && a.amountIssued > 0, 'Salary advances must be positive amounts.');
}

// Called before the existing version-checked UPDATE. No client-supplied payroll totals
// or repayment balances are trusted; a racing write fails the version check.
export function preparePayrollState(currentValue: Obj, requested: Obj, userId: string, now = new Date()): HrState {
  validatePayrollState(requested);
  const current = currentValue as unknown as HrState;
  const state = structuredClone(requested);
  const today = todayIndia(now), monthNow = today.slice(0, 7);
  const runs = current.payrollRuns ?? [];
  requireRule(isDeepStrictEqual(state.payrollRuns ?? [], runs), 'Confirmed payroll history cannot be edited.');
  requireRule(state.payrollStartMonth === current.payrollStartMonth, 'Payroll tracking start month cannot be edited.');
  state.payrollStartMonth = current.payrollStartMonth ?? monthNow;
  state.payrollRuns = structuredClone(runs);
  const month = openMonth(state, today);
  const closed = [...runs].map(r => r.month).sort().at(-1);
  if (closed) {
    const lockedAttendance = (s: HrState) => s.attendance.filter(a => a.date.slice(0, 7) <= closed);
    requireRule(isDeepStrictEqual(lockedAttendance(state), lockedAttendance(current)), 'Attendance in confirmed payroll months is locked.');
    // A Sunday on the first day of the next month also affects the preceding Saturday.
    const cutoff = `${nextMonth(closed)}-01`;
    const lockedRoster = (s: HrState) => (s.sundayRosters ?? []).filter(r => r.date <= cutoff);
    requireRule(isDeepStrictEqual(lockedRoster(state), lockedRoster(current)), 'Sunday rosters affecting confirmed payroll are locked.');
  }
  for (const old of current.employees ?? []) {
    const e = state.employees.find(e => e.id === old.id);
    requireRule(e, 'Keep existing employee records; mark departing employees inactive instead.');
    requireRule(e.accumulatedPto === old.accumulatedPto && e.weekendPenaltyCount === old.weekendPenaltyCount, 'PTO and imported weekend balances cannot be edited directly.');
    requireRule(e.payrollStartMonth === old.payrollStartMonth, 'Employee payroll start month cannot be edited.');
  }
  for (const e of state.employees) {
    if (!(current.employees ?? []).some(old => old.id === e.id)) {
      e.payrollStartMonth = monthNow;
      e.accumulatedPto = 0;
      e.weekendPenaltyCount = 0;
    }
  }
  // Issued salary advances are immutable. Corrections require an explicit audited workflow.
  for (const old of current.salaryAdvances ?? []) {
    requireRule(isDeepStrictEqual(state.salaryAdvances.find(a => a.id === old.id), old), 'Issued salary advances cannot be changed or deleted.');
  }
  for (const old of current.noteAdvances ?? []) {
    const n = state.noteAdvances.find(n => n.id === old.id);
    requireRule(n && n.employeeId === old.employeeId && n.issueDate === old.issueDate, 'Existing note advances cannot be deleted or reassigned.');
    requireRule(n.totalAmount >= old.totalAmount && roundMoney(n.remainingBalance - old.remainingBalance) === roundMoney(n.totalAmount - old.totalAmount), 'Note balances can only change through payroll or a matching top-up.');
    requireRule(old.status !== 'Completed' || isDeepStrictEqual(n, old), 'Completed note advances are locked; issue a new advance.');
  }
  for (const n of state.noteAdvances) {
    const old = (current.noteAdvances ?? []).find(a => a.id === n.id);
    if (!old) {
      requireRule(n.issueDate <= today && n.issueDate.slice(0, 7) >= month && n.remainingBalance === n.totalAmount, 'New note advances must be issued in an open month, not in the future, with their full balance.');
    }
    if (!old || n.totalAmount !== old.totalAmount || n.monthlyRepayment !== old.monthlyRepayment) {
      const employee = state.employees.find(e => e.id === n.employeeId);
      requireRule(employee?.status === 'Active', 'Only active employees can receive advances.');
      // Check every known obligation month, including future-dated attendance and advances.
      const months = new Set([month, nextMonth(month), nextMonth(n.issueDate.slice(0, 7)),
        ...state.salaryAdvances.filter(a => a.employeeId === n.employeeId).map(a => a.issueDate.slice(0, 7)),
        ...state.attendance.filter(a => a.employeeId === n.employeeId).map(a => a.date.slice(0, 7))]);
      for (const m of months) {
        if (m < month || m <= n.issueDate.slice(0, 7)) continue;
        const line = calculatePayroll(state, m).find(l => l.employeeId === n.employeeId);
        requireRule(line && line.gross - line.esi - line.pf - line.attendanceDeduction - line.weekendDeduction - line.salaryAdvances - scheduledNotes(state, n.employeeId, m) >= 0, 'This repayment schedule would make projected take-home pay negative.');
      }
    }
    n.expectedCompletionDate = completionDate(n, closed);
  }
  // Validate new salary draws incrementally so multiple draws cannot reuse eligibility.
  const working = { ...state, salaryAdvances: structuredClone(current.salaryAdvances ?? []) };
  for (const a of state.salaryAdvances.filter(a => !(current.salaryAdvances ?? []).some(old => old.id === a.id))) {
    requireRule(a.issueDate <= today && a.issueDate.slice(0, 7) === monthNow && a.issueDate.slice(0, 7) >= month, 'Salary advances must be issued in the current, unconfirmed month and cannot be future-dated.');
    requireRule(a.amountIssued <= salaryEligibility(working, a.employeeId, a.issueDate), 'The salary advance exceeds elapsed-day eligibility or would make projected take-home pay negative.');
    working.salaryAdvances.push(a);
  }
  if (state.payrollCommand !== undefined) {
    requireRule(object(state.payrollCommand) && state.payrollCommand.month === month, 'Confirm the next open payroll month only; a month cannot be processed twice or skipped.');
    requireRule(month < monthNow, 'Payroll can only be confirmed after the month has ended.');
    // The preview must be the exact saved input; confirmation cannot secretly edit records.
    const withoutCommand = (s: Obj) => Object.fromEntries(Object.entries(s).filter(([key]) => key !== 'payrollCommand'));
    requireRule(isDeepStrictEqual(withoutCommand(requested), withoutCommand(currentValue)), 'Save changes and review payroll again before confirming.');
    const lines = calculatePayroll(state, month);
    // An empty month still needs an audited close so the sequential ledger can
    // advance before the first hire or during a period with no active staff.
    for (const line of lines) {
      const e = state.employees.find(e => e.id === line.employeeId)!;
      e.accumulatedPto = line.closingPto;
      for (const repayment of line.noteRepayments) {
        const n = state.noteAdvances.find(n => n.id === repayment.id)!;
        n.remainingBalance = roundMoney(n.remainingBalance - repayment.amount);
        n.status = n.remainingBalance === 0 ? 'Completed' : 'Active';
        n.expectedCompletionDate = completionDate(n, month);
      }
    }
    state.payrollRuns.push({ month, confirmedAt: now.toISOString(), confirmedBy: userId, lines });
  }
  delete state.payrollCommand;
  return state;
}
