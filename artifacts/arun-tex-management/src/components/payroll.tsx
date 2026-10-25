import { useState } from 'react';
import './payroll.css';
import {
  calculatePayroll, completionDate, openMonth, salaryEligibility, scheduledNotes, todayIndia,
  type HrState, type NoteAdvance,
} from '@workspace/payroll';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
type Props = { state: HrState; canEdit: boolean; save: (data: HrState) => Promise<unknown> };

export function Payroll({ state, canEdit, save }: Props) {
  const today = todayIndia();
  const next = openMonth(state, today);
  const [selectedMonth, setMonth] = useState('');
  const month = selectedMonth || next;
  const [form, setForm] = useState<'note' | 'salary' | null>(null);
  const [employeeId, setEmployee] = useState('');
  const [amount, setAmount] = useState('');
  const [repayment, setRepayment] = useState('');
  const [issueDate, setDate] = useState(today);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState('');
  const employees = state.employees ?? [], notes = state.noteAdvances ?? [], advances = state.salaryAdvances ?? [];
  const run = (state.payrollRuns ?? []).find(r => r.month === month);
  const lines = run?.lines ?? calculatePayroll(state, month);
  const eligible = employeeId ? salaryEligibility(state, employeeId, issueDate) : 0;
  const monthAdvances = advances.filter(a => a.issueDate.startsWith(month));
  const commit = async (data: HrState, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await save(data); setMessage(success); setForm(null); setReview(false); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed. Refresh and try again.'); return false; }
    finally { setBusy(false); }
  };
  const start = (kind: 'note' | 'salary', note?: NoteAdvance) => {
    setForm(kind); setEmployee(note?.employeeId ?? ''); setAmount('');
    setRepayment(note ? String(note.monthlyRepayment) : ''); setDate(today);
    setEditNote(note?.id ?? null); setError(''); setMessage('');
  };
  const submitAdvance = async () => {
    const value = Number(amount), monthly = Number(repayment);
    if (!employeeId || !Number.isFinite(value) || value < (editNote ? 0 : 0.01)) { setError('Enter a valid positive advance amount.'); return; }
    if (form === 'salary' && value > eligible) { setError('Amount exceeds elapsed-day eligibility or the remaining take-home pay.'); return; }
    if (form === 'note' && (!Number.isFinite(monthly) || monthly <= 0)) { setError('Enter a positive monthly repayment.'); return; }
    if (form === 'salary') {
      await commit({ ...state, salaryAdvances: [...advances, { id: crypto.randomUUID(), employeeId, amountIssued: value, issueDate }] }, 'Salary advance saved.');
    } else {
      const existing = notes.find(n => n.id === editNote);
      const note: NoteAdvance = existing
        ? { ...existing, totalAmount: existing.totalAmount + value, remainingBalance: existing.remainingBalance + value, monthlyRepayment: monthly }
        : { id: crypto.randomUUID(), employeeId, totalAmount: value, remainingBalance: value, monthlyRepayment: monthly, issueDate, status: 'Active' };
      note.expectedCompletionDate = completionDate(note, (state.payrollRuns ?? []).map(r => r.month).sort().at(-1));
      await commit({ ...state, noteAdvances: existing ? notes.map(n => n.id === existing.id ? note : n) : [...notes, note] }, 'Note advance and repayment schedule saved.');
    }
  };
  const months = Array.from(new Set([next, ...(state.payrollRuns ?? []).map(r => r.month)])).sort().reverse();
  return <div className="page-stack">
    <div className="page-intro"><div><div className="eyebrow">PEOPLE OPERATIONS · ACCOUNTS</div><h1>Payroll with a clear trail.</h1><p>Review attendance, paid leave and advance deductions before confirming a month.</p></div>
      <div className="payroll-actions"><button className="btn btn-secondary" onClick={() => window.print()}>Print payroll view</button>
        {canEdit && <><button className="btn btn-secondary" disabled={busy} onClick={() => start('note')}>Note advance</button><button className="btn btn-primary" disabled={busy} onClick={() => start('salary')}>Salary advance</button></>}</div>
    </div>
    {error && <div role="alert" className="payroll-error">{error}</div>}
    {message && <div role="status" className="recon-footnote">{message}</div>}
    <section className="panel payroll-policy">
      <strong>Confirmed payroll rules</strong>
      <p>2 PTO days accrue per active employee each month. Paid leave, informed absence and half-days use PTO first. Uninformed absence is always unpaid. Uncovered days cost ₹500; half-days ₹250. Each weekend-adjacent absence after the third annual violation costs ₹1,000. Daily salary basis: (base + transport) ÷ 30.</p>
      <small>PTO posts once on confirmation. Existing PTO and weekend counts are opening balances at the start of payroll tracking. Note repayments start the following month. Deductions are capped at zero take-home; any unaffordable note balance stays outstanding.</small>
    </section>
    {form && <section className="panel">
      <div className="panel-heading"><div><div className="eyebrow">EMPLOYEE ADVANCE</div><h2>{editNote ? 'Top up or change repayment' : form === 'note' ? 'Issue a note advance' : 'Record a salary advance'}</h2></div><button className="btn btn-quiet" disabled={busy} onClick={() => setForm(null)}>Close</button></div>
      <div className="form-row payroll-form">
        <label>Employee<select disabled={busy || !!editNote} value={employeeId} onChange={e => setEmployee(e.target.value)}><option value="">Choose employee</option>{employees.filter(e => e.status === 'Active').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>{editNote ? 'Top-up amount (₹; 0 to change repayment only)' : 'Amount (₹)'}<input type="number" min={editNote ? 0 : 0.01} step="0.01" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>
        {form === 'note' && <label>Monthly repayment (₹)<input type="number" min="0.01" step="0.01" value={repayment} disabled={busy} onChange={e => setRepayment(e.target.value)} /></label>}
        {!editNote && <label>Issue date<input type="date" max={today} min={form === 'salary' ? `${today.slice(0, 7)}-01` : `${next}-01`} value={issueDate} disabled={busy} onChange={e => setDate(e.target.value)} /></label>}
        <button className="btn btn-primary" disabled={busy || !employeeId || (!editNote && Number(amount) <= 0)} onClick={submitAdvance}>{busy ? 'Saving…' : 'Save advance'}</button>
      </div>
      {employeeId && form === 'salary' && <div className="payroll-policy"><strong>Suggested eligible advance: {money(eligible)}</strong><p>((base + transport − this month's advances) ÷ 30 × elapsed days) − due note repayments, rounded to ₹10 and capped at remaining net pay. Elapsed days: {Number(issueDate.slice(8, 10))}. Existing advances are excluded. Future dates are not eligible.</p><button className="btn btn-secondary" disabled={busy || eligible <= 0} onClick={() => setAmount(String(eligible))}>Use suggested amount</button></div>}
    </section>}
    <div className="metric-grid compact-grid">
      {[['Take-home pay', money(lines.reduce((s, l) => s + l.net, 0))], ['Note advance balance', money(notes.reduce((s, n) => s + n.remainingBalance, 0))], ['Note repayments this month', money(lines.reduce((s, l) => s + l.noteDeduction, 0))], ['Salary advances this month', money(monthAdvances.reduce((s, a) => s + a.amountIssued, 0))]].map(([label, value]) => <div className="metric" key={label}><div className="metric-label">{label}</div><strong className="mono">{value}</strong><small>{month}</small></div>)}
    </div>
    <section className="panel">
      <div className="panel-heading"><div><div className="eyebrow">MONTHLY SALARY</div><h2>{run ? 'Confirmed salary register' : 'Payroll preview'}</h2></div><label>Payroll month<select value={month} disabled={busy} onChange={e => { setMonth(e.target.value); setReview(false); setError(''); }}>{months.map(m => <option key={m}>{m}</option>)}</select></label></div>
      {run && <p className="payroll-policy">Confirmed {new Date(run.confirmedAt).toLocaleString('en-IN')} · locked snapshot. Later salary changes do not change this payroll.</p>}
      {!run && month >= today.slice(0, 7) && <p className="payroll-policy">Preview only until this month ends. Attendance is assumed present unless an exception is logged.</p>}
      <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>BASE + TRANSPORT</th><th>ESI / PF</th><th>ATTENDANCE</th><th>WEEKEND</th><th>SALARY ADVANCE</th><th>NOTE REPAYMENT</th><th>TAKE-HOME</th></tr></thead><tbody>{lines.map(l => <tr key={l.employeeId}>
        <td className="strong">{l.name}<details><summary>Calculation breakdown</summary><div className="payroll-breakdown">
          <p>Base {money(l.base)} + transport {money(l.transport)} = {money(l.gross)}</p>
          <p>Daily salary basis: {money(l.dailyRate)}</p>
          <p>PTO: {l.openingPto} opening + {l.accrual} accrued − {l.ptoUsed} used = {l.closingPto} days</p>
          <p>Unpaid: {l.unpaidDays} days × ₹500 = {money(l.attendanceDeduction)}</p>
          <p>Weekend: {l.weekendViolations} this month; {l.weekendCount} in calendar year · deduction {money(l.weekendDeduction)}</p>
          <p>ESI {money(l.esi)} + PF {money(l.pf)} + salary advances {money(l.salaryAdvances)} + note repayments {money(l.noteDeduction)}</p>
          <p>Take-home = max(₹0, gross − deductions): <strong>{money(l.net)}</strong></p>
          {l.cappedDeductions > 0 && <p>Zero-floor adjustment: {money(l.cappedDeductions)} of attendance/statutory deductions cannot be collected.</p>}
          {l.noteRepayments.map(n => <p key={n.id}>Note {n.id.slice(0, 8)}: actual repayment {money(n.amount)}</p>)}
        </div></details></td>
        <td className="mono">{money(l.gross)}</td><td className="mono">{money(l.esi + l.pf)}</td><td className="mono">{money(l.attendanceDeduction)}</td><td className="mono">{money(l.weekendDeduction)}</td><td className="mono">{money(l.salaryAdvances)}</td><td className="mono">{money(l.noteDeduction)}</td><td className="mono strong">{money(l.net)}</td>
      </tr>)}</tbody></table></div>
      {!lines.length && <p className="payroll-policy">No active employees for this payroll month. Admin can confirm an ended empty month with a zero-total snapshot to advance to the next month.</p>}
      {canEdit && !run && <div className="payroll-policy">
        {!review ? <button className="btn btn-primary" disabled={busy || month >= today.slice(0, 7)} onClick={() => setReview(true)}>Review and confirm payroll</button> : <>
          <p><strong>Confirm payroll for {month}?</strong> {lines.length ? 'This locks the month, posts PTO and deducts only the note repayments shown above.' : 'This records an empty month with no employees paid, no PTO accrued and no repayments collected, then advances payroll to the next month.'} Total take-home: {money(lines.reduce((s, l) => s + l.net, 0))}. This does not transfer money.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => commit({ ...state, payrollCommand: { month } }, `Payroll for ${month} confirmed.`)}>{busy ? 'Confirming…' : 'Confirm payroll'}</button>{' '}
          <button className="btn btn-secondary" disabled={busy} onClick={() => setReview(false)}>Cancel</button>
        </>}
      </div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">RECOVERABLE SUPPORT</div><h2>Note advances</h2></div><select aria-label="Note advance status" value={filter} onChange={e => setFilter(e.target.value)}>{['All', 'Active', 'Completed'].map(s => <option key={s}>{s}</option>)}</select></div>
      <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>BALANCE / TOTAL</th><th>MONTHLY REPAYMENT</th><th>EXPECTED COMPLETION</th><th>STATUS</th>{canEdit && <th>ACTION</th>}</tr></thead><tbody>{notes.filter(n => filter === 'All' || n.status === filter).map(n => <tr key={n.id}><td>{employees.find(e => e.id === n.employeeId)?.name}</td><td className="mono">{money(n.remainingBalance)} / {money(n.totalAmount)}</td><td className="mono">{money(n.monthlyRepayment)}</td><td>{n.status === 'Completed' ? 'Repaid' : completionDate(n, (state.payrollRuns ?? []).map(r => r.month).sort().at(-1))}</td><td>{n.status}</td>{canEdit && <td>{n.status === 'Active' && <button className="btn btn-secondary" disabled={busy} onClick={() => start('note', n)}>Manage note</button>}</td>}</tr>)}</tbody></table></div>
      {!notes.length && <p className="payroll-policy">No note advances recorded.</p>}
      <p className="payroll-policy">Expected completion assumes the scheduled amount is affordable each month. Uncollected installments remain outstanding.</p>
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">ONE-TIME SUPPORT</div><h2>Salary advances · {month}</h2></div></div>
      <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ISSUED THIS MONTH</th><th>NOTE BALANCE</th><th>DUE NOTE REPAYMENT</th><th>SUGGESTED ELIGIBLE</th></tr></thead><tbody>{employees.filter(e => monthAdvances.some(a => a.employeeId === e.id)).map(e => <tr key={e.id}><td>{e.name}</td><td className="mono">{money(monthAdvances.filter(a => a.employeeId === e.id).reduce((s, a) => s + a.amountIssued, 0))}</td><td className="mono">{money(notes.filter(n => n.employeeId === e.id).reduce((s, n) => s + n.remainingBalance, 0))}</td><td className="mono">{money(run?.lines.find(l => l.employeeId === e.id)?.noteDeduction ?? scheduledNotes(state, e.id, month))}</td><td className="mono">{run ? 'Month confirmed' : money(salaryEligibility(state, e.id, month === today.slice(0, 7) ? today : `${month}-01`))}</td></tr>)}</tbody></table></div>
      {!monthAdvances.length && <p className="payroll-policy">No salary advances issued this month.</p>}
      {monthAdvances.map(a => <p className="payroll-ledger" key={a.id}>{employees.find(e => e.id === a.employeeId)?.name} · {a.issueDate} · {money(a.amountIssued)}</p>)}
    </section>
    {!canEdit && <div className="recon-footnote">Accounts view is read-only. Only Admin can issue advances or confirm payroll.</div>}
  </div>;
}
