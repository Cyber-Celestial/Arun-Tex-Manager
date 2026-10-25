export interface Employee {
  id: string; name: string; status: string; baseSalary: number;
  transportAllowance: number; esiAmount: number; pfAmount: number;
  accumulatedPto: number; weekendPenaltyCount: number; payrollStartMonth?: string;
  [key: string]: unknown;
}
export interface Attendance { employeeId: string; date: string; exceptionType: string }
export interface Roster { employeeId: string; date: string; shiftType: string }
export interface NoteAdvance {
  id: string; employeeId: string; totalAmount: number; remainingBalance: number;
  monthlyRepayment: number; issueDate: string; expectedCompletionDate?: string; status: string;
}
export interface SalaryAdvance { id: string; employeeId: string; amountIssued: number; issueDate: string }
export interface PayrollLine {
  employeeId: string; name: string; base: number; transport: number; gross: number;
  dailyRate: number; esi: number; pf: number; openingPto: number; accrual: number;
  ptoUsed: number; closingPto: number; unpaidDays: number; attendanceDeduction: number;
  weekendCount: number; weekendViolations: number; weekendDeduction: number;
  salaryAdvances: number; noteRepayments: { id: string; amount: number }[];
  noteDeduction: number; rawNet: number; net: number; cappedDeductions: number;
}
export interface PayrollRun { month: string; confirmedAt: string; confirmedBy: string; lines: PayrollLine[] }
export interface HrState {
  employees: Employee[]; attendance: Attendance[]; sundayRosters: Roster[];
  noteAdvances: NoteAdvance[]; salaryAdvances: SalaryAdvance[]; payrollRuns?: PayrollRun[];
  payrollStartMonth?: string; payrollCommand?: { month: string };
  [key: string]: unknown;
}
export const absenceTypes = ['Informed Absent', 'Uninformed Absent', 'Paid Leave', 'Half-Day', 'On-Duty'];
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function todayIndia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function nextMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}
export function openMonth(state: HrState, today = todayIndia()): string {
  const months = (state.payrollRuns ?? []).map(run => run.month).sort();
  return months.length ? nextMonth(months[months.length - 1]) : state.payrollStartMonth ?? today.slice(0, 7);
}
function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
// One violation per absence date, even if the same Sunday has absences on both sides.
function weekendEvents(state: HrState, employeeId: string): string[] {
  const off = new Set(state.sundayRosters.filter(r => r.employeeId === employeeId && r.shiftType === 'Off').map(r => r.date));
  return state.attendance.filter(a => {
    if (a.employeeId !== employeeId || !['Paid Leave', 'Informed Absent', 'Uninformed Absent'].includes(a.exceptionType)) return false;
    const day = new Date(`${a.date}T00:00:00Z`).getUTCDay();
    return (day === 6 && off.has(shiftDate(a.date, 1))) || (day === 1 && off.has(shiftDate(a.date, -1)));
  }).map(a => a.date).sort();
}
export function calculatePayroll(state: HrState, month: string): PayrollLine[] {
  return state.employees.filter(e => e.status === 'Active' && (!e.payrollStartMonth || e.payrollStartMonth <= month)).map(e => {
    const gross = roundMoney(Number(e.baseSalary) + Number(e.transportAllowance));
    const openingPto = Number(e.accumulatedPto);
    let pto = openingPto + 2;
    let unpaidDays = 0;
    for (const a of state.attendance.filter(a => a.employeeId === e.id && a.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))) {
      if (a.exceptionType === 'On-Duty') continue;
      const days = a.exceptionType === 'Half-Day' ? 0.5 : 1;
      const covered = a.exceptionType === 'Uninformed Absent' ? 0 : Math.min(pto, days);
      pto -= covered;
      unpaidDays += days - covered;
    }
    // Existing counters are an imported opening balance, before payroll tracking began.
    const start = state.payrollStartMonth ?? month;
    const openingCount = month.slice(0, 4) === start.slice(0, 4) ? Number(e.weekendPenaltyCount || 0) : 0;
    const events = weekendEvents(state, e.id).filter(date => date.slice(0, 4) === month.slice(0, 4) && date.slice(0, 7) >= start);
    const before = openingCount + events.filter(date => date.slice(0, 7) < month).length;
    const violations = events.filter(date => date.startsWith(month)).length;
    const weekendCount = before + violations;
    const weekendDeduction = (Math.max(0, weekendCount - 3) - Math.max(0, before - 3)) * 1000;
    const attendanceDeduction = roundMoney(unpaidDays * 500);
    const salaryAdvances = roundMoney(state.salaryAdvances.filter(a => a.employeeId === e.id && a.issueDate.startsWith(month)).reduce((sum, a) => sum + Number(a.amountIssued), 0));
    const esi = Number(e.esiAmount), pf = Number(e.pfAmount);
    const beforeNotes = roundMoney(gross - esi - pf - attendanceDeduction - weekendDeduction - salaryAdvances);
    let available = Math.max(0, beforeNotes);
    // Stable ordering makes partial repayments deterministic if later attendance reduces pay.
    const noteRepayments = state.noteAdvances.filter(n => n.employeeId === e.id && n.status !== 'Completed' && n.issueDate.slice(0, 7) < month)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id.localeCompare(b.id)).map(n => {
        const amount = roundMoney(Math.min(Number(n.remainingBalance), Number(n.monthlyRepayment), available));
        available = roundMoney(available - amount);
        return { id: n.id, amount };
      });
    const noteDeduction = roundMoney(noteRepayments.reduce((sum, n) => sum + n.amount, 0));
    const rawNet = roundMoney(beforeNotes - noteDeduction);
    return {
      employeeId: e.id, name: e.name, base: Number(e.baseSalary), transport: Number(e.transportAllowance),
      gross, dailyRate: roundMoney(gross / 30), esi, pf, openingPto, accrual: 2,
      ptoUsed: roundMoney(openingPto + 2 - pto), closingPto: roundMoney(pto), unpaidDays,
      attendanceDeduction, weekendCount, weekendViolations: violations, weekendDeduction,
      salaryAdvances, noteRepayments, noteDeduction, rawNet, net: Math.max(0, rawNet),
      cappedDeductions: Math.max(0, -rawNet),
    };
  });
}
export function scheduledNotes(state: HrState, employeeId: string, month: string): number {
  return roundMoney(state.noteAdvances.filter(n => n.employeeId === employeeId && n.status !== 'Completed' && n.issueDate.slice(0, 7) < month)
    .reduce((sum, n) => sum + Math.min(Number(n.remainingBalance), Number(n.monthlyRepayment)), 0));
}
export function salaryEligibility(state: HrState, employeeId: string, issueDate: string): number {
  const month = issueDate.slice(0, 7);
  const line = calculatePayroll(state, month).find(l => l.employeeId === employeeId);
  if (!line) return 0;
  const notes = scheduledNotes(state, employeeId, month);
  const raw = ((line.gross - line.salaryAdvances) / 30 * Number(issueDate.slice(8, 10))) - notes;
  const remaining = line.gross - line.esi - line.pf - line.attendanceDeduction - line.weekendDeduction - line.salaryAdvances - notes;
  return roundMoney(Math.max(0, Math.min(Math.round(raw / 10) * 10, remaining)));
}
export function completionDate(note: NoteAdvance, afterMonth?: string): string {
  if (Number(note.remainingBalance) <= 0) return '';
  const start = afterMonth && afterMonth > note.issueDate.slice(0, 7) ? afterMonth : note.issueDate.slice(0, 7);
  const date = new Date(`${start}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Math.ceil(Number(note.remainingBalance) / Number(note.monthlyRepayment)) + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}
