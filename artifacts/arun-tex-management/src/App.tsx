import { BankReconcilePanel, type ReconcileRequest } from '@/components/bank-reconcile-panel';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import * as XLSX from 'xlsx';
import { ErrorBoundary } from '@/components/error-boundary';
import { DispatchInvoiceForm } from '@/components/dispatch-invoice-form';
import { DispatchRecord } from '@/components/dispatch-record';
import { B2cDayBar, type B2cDaySummary } from '@/components/b2c-day-bar';
import { DeleteDayControl } from '@/components/delete-day-control';
import { OverviewCollectionStrip } from '@/components/overview-collection-strip';
import { OverviewDayPicker } from '@/components/overview-day-picker';
import { businessDate, localDateKey, pulseTransactions, summarizePulse } from '@/lib/pulse-data';
import { batchStage, invoiceKey, oneEntryPerInvoice, reconciliationLabel, reconciliationUploaded, uploadSlot } from '@/lib/reconciliation';
import { dateCell, normalizeColumn, parseVastraSheets, readField, type UploadKind } from '@/lib/vastra-import';
import { ChangeLog, UploadSlots, WorkflowSteps } from '@/components/reconciliation-workflow';
import { ReconciliationNumberInput } from '@/components/reconciliation-number-input';
import '@/components/reconciliation-date.css';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  getGetWorkspaceMeQueryKey, getGetWorkspaceStateQueryKey, getListWorkspaceUsersQueryKey, useGetWorkspaceMe,
  useGetWorkspaceState, useListWorkspaceUsers, useRequestUploadUrl, useUpdateAttendanceState,
  useDeleteB2cDay, useDeleteDispatchDay, useUpdateB2cBankState, useUpdateB2cState, useUpdateDispatchState, useUpdateHrState,
  useUpdateWorkspaceUserRole, useUploadB2cDay, useLateMatchB2cBank, useReconcileB2cBank,
} from '@workspace/api-client-react';
import type { WorkspaceState, WorkspaceUser } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowRight, ArrowUpRight, Banknote, Bell, Check,
  CheckCircle2, CircleAlert, ClipboardCheck, Clock3, FileDown,
  FileSpreadsheet, FileText, LayoutDashboard, LogOut, Menu, PackageCheck,
  Printer, Search, ShieldCheck, Shirt, Users, Wallet, X,
} from 'lucide-react';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#246451', colorForeground: '#292d37', colorMutedForeground: '#747779', colorDanger: '#a43c35', colorBackground: '#fffdf7', colorInput: '#fffdf7', colorInputForeground: '#292d37', colorNeutral: '#e4ded1', fontFamily: 'DM Sans, sans-serif', borderRadius: '0.7rem' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fffdf7] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#e4ded1]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#292d37] font-bold', headerSubtitle: 'text-[#747779]', socialButtonsBlockButtonText: 'text-[#292d37] font-semibold',
    formFieldLabel: 'text-[#292d37] font-semibold', footerActionLink: 'text-[#246451] font-semibold', footerActionText: 'text-[#747779]',
    dividerText: 'text-[#747779]', identityPreviewEditButton: 'text-[#246451]', formFieldSuccessText: 'text-[#246451]', alertText: 'text-[#292d37]',
    logoBox: 'mb-4', logoImage: 'rounded-md', socialButtonsBlockButton: 'border-[#e4ded1] bg-[#fbf9f2]',
    formButtonPrimary: 'bg-[#246451] hover:bg-[#194e3e] text-white', formFieldInput: 'border-[#e4ded1] bg-[#fffdf7] text-[#292d37]',
    footerAction: 'text-[#747779]', dividerLine: 'bg-[#e4ded1]', alert: 'bg-[#fbf1e9] border-[#ead6c3]',
    otpCodeFieldInput: 'border-[#e4ded1]', formFieldRow: 'mb-4', main: 'text-[#292d37]',
  },
};

type AnyObj = Record<string, any>;
type Role = 'admin' | 'billing' | 'accounts' | 'pending';
type LateMatchRequest = { paymentBatchId: string; invoiceNumber: string; mode: 'UPI'|'CARD'; depositBatchId: string; bankRowIndex: number; note: string };
const money = (n: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const shortDate = (d: string) => {
  if (!d) return '—';
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return (day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};
const arr = (v: unknown): AnyObj[] => Array.isArray(v) ? v : [];
const cleanName = (s: string) => s.split(/(?=[A-Z])/).join(' ').replace(/^./, x => x.toUpperCase());
function downloadTallyWorkbook(exportData: AnyObj, fallbackDate = 'batch') {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(arr(exportData.entries));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Tally Vouchers');
  XLSX.writeFile(workbook, String(exportData.fileName || `arun-tex-tally-${fallbackDate}.xlsx`));
}
function makeTallyExport(batch: AnyObj) {
  const entries = arr(batch.transactions).flatMap(transaction => {
    const amount = Math.abs(Number(transaction.totalInvoiceAmount) || 0);
    const isReturn = transaction.type === 'Return';
    const date = dateCell(transaction.date);
    const voucherNumber = String(transaction.invoiceNumber || '');
    const voucherType = isReturn ? 'Credit Note' : 'Sales';
    const salesLine = {
      Date: date,
      'Voucher Type': voucherType,
      'Voucher Number': voucherNumber,
      'Ledger Name': 'Vastra Tax Invoice B2C',
      Debit: isReturn ? amount : '',
      Credit: isReturn ? '' : amount,
    };
    if (isReturn) {
      return [salesLine, {
        Date: date, 'Voucher Type': voucherType, 'Voucher Number': voucherNumber,
        'Ledger Name': 'Cash', Debit: '', Credit: amount,
      }];
    }
    const receipts = [
      ['Cash', Number(transaction.cashAmount) || 0],
      ['HDFC UPI', Number(transaction.upiAmount) || 0],
      ['HDFC Card', Number(transaction.cardAmount) || 0],
    ].filter(([, value]) => Number(value) > 0);
    return [salesLine, ...receipts.map(([ledger, value]) => ({
      Date: date,
      'Voucher Type': voucherType,
      'Voucher Number': voucherNumber,
      'Ledger Name': ledger,
      Debit: value,
      Credit: '',
    }))];
  });
  const date = dateCell(batch.date) || new Date().toISOString().slice(0, 10);
  return {
    fileName: `arun-tex-tally-${date}.xlsx`,
    generatedAt: new Date().toISOString(),
    entries,
  };
}

function AuthPage({ mode }: { mode: 'in' | 'up' }) {
  return <main className="auth-surface">
    <div className="auth-aside">
      <Link href="/" className="brand-lockup"><span className="brand-mark"><Shirt size={20}/></span><span>The Arun Tex<small>OPERATIONS</small></span></Link>
      <div className="auth-story"><span className="eyebrow">A steadier close, every day</span><h1 className="display">From the first invoice<br/>to the final tally.</h1><p>One clear room for sales, dispatch and people operations.</p></div>
      <div className="auth-foot">BUILT FOR THE WORK BEHIND EVERY WEAVE <span>•</span> SURAT, INDIA</div>
      <div className="auth-weave" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
    </div>
    <div className="auth-card-wrap"><div className="auth-topline">THE ARUN TEX <span>WORKSPACE ACCESS</span></div>
      {mode === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}
      <p className="auth-first-user">The first account becomes Admin. Create the owner account first; an Admin assigns access to later accounts.</p>
      <Link href="/" className="auth-back">← Return to workspace overview</Link>
    </div>
  </main>;
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk(); const qc = useQueryClient();
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => { const id = user?.id ?? null; if (last.current !== undefined && last.current !== id) qc.clear(); last.current = id; });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral'|'good'|'warn'|'bad'|'gold' }) {
  return <span className={`pill pill-${tone}`}><i/>{children}</span>;
}
function Button({ children, onClick, kind = 'secondary', disabled = false, className = '', title }: { children: ReactNode; onClick?: () => void; kind?: 'primary'|'secondary'|'quiet'|'danger'; disabled?: boolean; className?: string; title?: string }) {
  return <button data-testid={`button-${String(children).replace(/[^a-z0-9]+/gi,'-').toLowerCase().slice(0,28)}`} title={title} disabled={disabled} onClick={onClick} className={`btn btn-${kind} ${className}`}>{children}</button>;
}
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section>; }
function PanelHeading({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return <div className="panel-heading"><div>{kicker && <div className="eyebrow">{kicker}</div>}<h2>{title}</h2></div>{action}</div>;
}
function Metric({ label, value, note, icon: Icon, color = 'teal' }: { label: string; value: string; note: string; icon: typeof Activity; color?: string }) {
  return <div className="metric"><div className={`metric-icon ${color}`}><Icon size={18}/></div><div className="metric-label">{label}</div><strong className="mono">{value}</strong><small>{note}</small></div>;
}
function TableEmpty({ text }: { text: string }) { return <div className="empty-state"><span><CheckCircle2 size={20}/></span><strong>All clear</strong><p>{text}</p></div>; }
function DocumentUpload({ label, disabled, onUploaded }: {label:string;disabled:boolean;onUploaded:(path:string)=>void}) {
  const upload=useRequestUploadUrl(); const [message,setMessage]=useState('');
  const choose=(file?:File)=>{
    if(!file)return;
    setMessage('Preparing upload…');
    upload.mutate({data:{name:file.name,size:file.size,contentType:file.type||'application/octet-stream'}},{
      onSuccess:async result=>{
        try{
          const response=await fetch(result.uploadURL,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
          if(!response.ok)throw new Error('Upload failed');
          onUploaded(result.objectPath);setMessage('Attached');
        }catch{setMessage('Upload failed. Try again.');}
      },
      onError:()=>setMessage('Upload failed. Try again.'),
    });
  };
  return <label className="doc-upload"><span>{label}</span><input type="file" accept="application/pdf" disabled={disabled||upload.isPending} onChange={e=>choose(e.target.files?.[0])}/><small>{message||'PDF only'}</small></label>;
}

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, section: 'WORKSPACE' },
  { path: '/reconciliation', label: 'B2C', icon: Banknote, section: 'DAILY OPERATIONS' },
  { path: '/dispatch', label: 'B2B dispatch', icon: PackageCheck },
  { path: '/people', label: 'People & attendance', icon: Users, section: 'PEOPLE' },
  { path: '/payroll', label: 'Payroll', icon: Wallet },
  { path: '/team', label: 'Team access', icon: ShieldCheck, section: 'ADMINISTRATION', admin: true },
];
function AppShell({ children, role, name }: { children: ReactNode; role: Role; name: string }) {
  const [loc] = useLocation(); const [mobileNav, setMobileNav] = useState(false); const { signOut } = useClerk();
  const display = name?.trim() || 'Workspace member';
  return <div className="app-shell shell-grain">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand-lockup"><span className="brand-mark"><Shirt size={20}/></span><span>The Arun Tex<small>OPERATIONS</small></span></Link>
      <div className="sidebar-caption">DAY-END OPERATIONS</div>
      <nav className="side-nav">{navItems.filter(item => (!item.admin || role === 'admin') && (role === 'admin' || (role === 'billing' && ['/', '/reconciliation', '/dispatch'].includes(item.path)) || (role === 'accounts' && ['/', '/reconciliation', '/people', '/payroll'].includes(item.path)) || (role === 'pending' && item.path === '/'))).map(item => <div key={item.path}>
        {item.section && <div className="nav-section">{item.section}</div>}
        <Link href={item.path} onClick={() => setMobileNav(false)} className={`nav-link ${loc === item.path ? 'active' : ''}`} data-testid={`link-${item.label.toLowerCase().replace(/[^a-z]+/g,'-')}`}><item.icon size={17}/><span>{item.label}</span>{item.path === '/reconciliation' && <span className="nav-dot"/>}</Link>
      </div>)}</nav>
      <div className="sidebar-bottom"><div className="sync-note"><span className="sync-light"/><span>Workspace synced<small>Numbers stay in step</small></span><Check size={14}/></div><div className="profile-mini"><div className="avatar">{display.slice(0,1).toUpperCase()}</div><div className="profile-copy"><strong>{display}</strong><small>{cleanName(role)} access</small></div><button title="Sign out" className="icon-button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={16}/></button></div></div>
    </aside>
    {mobileNav && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileNav(false)} data-testid="button-close-menu"/>}
    <div className="main-column"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)} data-testid="button-open-menu"><Menu size={19}/></button><div className="crumb"><span>ARUN TEX</span><span className="crumb-slash">/</span><span>{navItems.find(n => n.path === loc)?.label ?? 'Workspace'}</span></div><div className="topbar-right"><span className="live-clock"><i/> LIVE WORKSPACE</span><button className="icon-button bell-button" aria-label="Notifications" title="Operations alerts" data-testid="button-notifications"><Bell size={17}/><i/></button><div className="top-avatar">{display.slice(0,1).toUpperCase()}</div></div></header>
      <main className="page-content enter">{children}</main>
      <footer className="page-footer"><span>THE ARUN TEX <i>•</i> OPERATIONS ROOM</span><span>MADE FOR A BETTER CLOSE</span></footer>
    </div>
  </div>;
}

function useWorkspace() {
  const query = useGetWorkspaceState({ query: { queryKey: getGetWorkspaceStateQueryKey() } });
  const me = useGetWorkspaceMe({ query: { queryKey: getGetWorkspaceMeQueryKey() } });
  const qc = useQueryClient();
  const b2c = useUpdateB2cState({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const uploadB2c = useUploadB2cDay({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const deleteB2c = useDeleteB2cDay({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const b2cBank = useUpdateB2cBankState({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const lateB2cBank = useLateMatchB2cBank({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const reconcileB2cBank = useReconcileB2cBank({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,b2c:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()}) } });
  const dispatch = useUpdateDispatchState({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,dispatch:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>{void qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()});} } });
  const deleteDispatch = useDeleteDispatchDay({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,dispatch:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); }, onError:()=>{void qc.invalidateQueries({queryKey:getGetWorkspaceStateQueryKey()});} } });
  const hr = useUpdateHrState({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,hr:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); } } });
  const attendance = useUpdateAttendanceState({ mutation: { onSuccess: result => { qc.setQueryData<WorkspaceState>(getGetWorkspaceStateQueryKey(),old=>old?{...old,version:result.version,hr:result.data}:old); void qc.invalidateQueries({ queryKey: getGetWorkspaceStateQueryKey() }); } } });
  return { query, me, b2c, b2cBank, lateB2cBank, reconcileB2cBank, uploadB2c, deleteB2c, dispatch, deleteDispatch, hr, attendance };
}
function LoadingView() { return <div className="loading-view"><div className="skeleton skeleton-title"/><div className="skeleton-row">{[1,2,3,4].map(i=><div className="skeleton skeleton-card" key={i}/>)}</div><div className="skeleton skeleton-table"/></div>; }
function LoadError({ retry }: { retry: () => void }) { return <div className="error-state"><CircleAlert size={24}/><h2>Workspace data did not load</h2><p>Check the connection, then try again. No changes have been made.</p><div className="error-actions"><Button kind="primary" onClick={retry}>Try again</Button><Link href="/sign-in" className="text-link">Sign in to workspace</Link></div></div>; }
function AccessDenied() { return <div className="error-state"><ShieldCheck size={24}/><h2>This area is outside your role</h2><p>Your workspace role does not include access to this operations area.</p><Link href="/" className="text-link">Return to overview <ArrowRight size={14}/></Link></div>; }
function PageIntro({ eyebrow, title, description, actions }: { eyebrow: ReactNode; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1 className="display">{title}</h1><p>{description}</p></div>{actions && <div className="intro-actions">{actions}</div>}</div>;
}

export function Overview({ state }: { state: WorkspaceState }) {
  const todayKey = localDateKey();
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const b2c = state.b2c as AnyObj; const ds = state.dispatch as AnyObj; const hr = state.hr as AnyObj;
  const batches = arr(b2c.batches); const tx = batches.flatMap(b => arr(b.transactions)); const invoices = arr(ds.invoices);
  const employees = arr(hr.employees); const exceptions = arr(hr.attendance);
  const datedTransactions = pulseTransactions(batches);
  const day = summarizePulse(datedTransactions, selectedDay, 'day');
  const dayTransactions = datedTransactions.filter(row => row.date === selectedDay);
  const viewingToday = selectedDay === todayKey;
  const dayName = new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const unmatched = dayTransactions.filter(t => !t.bankVerified && ['UPI','CARD','SPLIT'].includes(String(t.paymentMode))).length;
  const pendingDispatch = invoices.filter(i => i.status !== 'Completed').length;
  const pendingPeople = exceptions.length;
  return <div className="page-stack">
    <PageIntro eyebrow={<OverviewDayPicker value={selectedDay} today={todayKey} recordDates={datedTransactions.map(row => row.date)} onChange={setSelectedDay}/>} title="Good morning, team." description={viewingToday ? 'Your operations room is ready. Here’s where today stands across sales, dispatch and people.' : `Viewing ${dayName}. Sales figures are for that day; dispatch and people show the current position.`} actions={<>{!viewingToday && <Button kind="primary" onClick={() => setSelectedDay(todayKey)}>Back to today</Button>}<StatusPill tone="good">Workspace healthy</StatusPill><Button kind="secondary" onClick={() => window.print()}><FileDown size={15}/> Day-end summary</Button></>}/>
    <div className="metric-grid">
      <Metric label={viewingToday ? 'B2C sales today' : 'B2C sales'} value={money(day.sales)} note={`${day.count} invoices · Vastra channel`} icon={ArrowUpRight} color="teal"/>
      <Metric label="Cash to reconcile" value={money(day.cash)} note="Denominations pending close" icon={Banknote} color="gold"/>
      <Metric label="B2B dispatches" value={`${invoices.length - pendingDispatch} / ${invoices.length}`} note={`${pendingDispatch} need attention`} icon={PackageCheck} color="blue"/>
      <Metric label="People exceptions" value={`${pendingPeople}`} note={`${employees.length} active employees`} icon={Users} color="rose"/>
    </div>
    <OverviewCollectionStrip amounts={day} format={money}/>
    <Panel className="close-panel"><PanelHeading kicker="THE NEXT RIGHT THING" title="Needs your attention"/>
      <div className="attention-list">
        <Link href="/reconciliation" className="attention-item"><span className="attention-icon coral"><FileSpreadsheet size={17}/></span><span className="attention-copy"><strong>Bank matches to review</strong><small>{unmatched} invoices awaiting a bank match</small></span><span className={`attention-count ${unmatched ? 'count-warn' : ''}`}>{unmatched}</span><ArrowRight size={16}/></Link>
        <Link href="/dispatch" className="attention-item"><span className="attention-icon amber"><PackageCheck size={17}/></span><span className="attention-copy"><strong>B2B dispatch checklist</strong><small>{pendingDispatch} invoices still in progress</small></span><span className={`attention-count ${pendingDispatch ? 'count-warn' : ''}`}>{pendingDispatch}</span><ArrowRight size={16}/></Link>
        <Link href="/people" className="attention-item"><span className="attention-icon lavender"><Clock3 size={17}/></span><span className="attention-copy"><strong>Attendance exceptions</strong><small>Review employee notes for this period</small></span><span className="attention-count">{pendingPeople}</span><ArrowRight size={16}/></Link>
      </div>
      <div className="assurance"><ShieldCheck size={16}/><span>Changes are saved to the workspace as you go.</span></div>
    </Panel>
    <Panel><PanelHeading kicker="RECENT WORK" title="Latest B2C invoices" action={<Link href="/reconciliation" className="text-link">Open B2C <ArrowRight size={14}/></Link>}/>
      {tx.length ? <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>PAYMENT</th><th>BANK MATCH</th><th className="align-right">VALUE</th></tr></thead><tbody>{tx.slice(0,5).map((t,i)=><tr key={t.invoiceNumber ?? i}><td className="strong">{t.invoiceNumber || 'Invoice record'}</td><td>{shortDate(t.date)}</td><td><span className="method-chip">{t.paymentMode || '—'}</span></td><td><StatusPill tone={t.bankVerified ? 'good' : 'warn'}>{t.bankVerified ? 'Matched' : 'Review'}</StatusPill></td><td className="align-right mono">{money(t.totalInvoiceAmount)}</td></tr>)}</tbody></table></div> : <TableEmpty text="Imported sales will appear here once today’s Vastra batch is added."/>}
    </Panel>
  </div>;
}

function Reconciliation({ state, canEdit, role, save, saveBank, upload, lateMatch, reconcile, deleteDay }: { state: AnyObj; canEdit: boolean; role: Role; save: (data: AnyObj)=>Promise<unknown>; saveBank: (data: AnyObj)=>Promise<unknown>; upload: (data: AnyObj)=>Promise<unknown>; lateMatch: (input: LateMatchRequest)=>Promise<unknown>; reconcile: (input: ReconcileRequest)=>Promise<unknown>; deleteDay?: (date: string)=>Promise<unknown> }) {
  const canBank = role==='admin'||role==='accounts';
  const batches = arr(state.batches);
  const [dayKey, setDayKey] = useState(() => businessDate(new URLSearchParams(window.location.search).get('date')) ||
    batches.map(batch=>businessDate(batch.date)).filter(Boolean).sort().at(-1) || localDateKey());
  const [tab, setTab] = useState('Transactions');
  const [importMessage, setImportMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{kind:UploadKind;date:string;fileName:string;transactions:AnyObj[];merged:number;conflicts:string[];existing:number} | null>(null);
  const [lateMatchTarget, setLateMatchTarget] = useState<{rowIndex:number;candidateKey:string;note:string} | null>(null);
  const selected = batches.findIndex(batch => businessDate(batch.date) === dayKey);
  const hasBatch = selected >= 0;
  const active = hasBatch ? batches[selected] : { date: dayKey, status: 'Open', transactions: [], bankRows: [], denominations: {} };
  const tx = arr(active.transactions);
  const bankRows: AnyObj[] = arr(active.bankRows)
    .map((row,index)=>Object.assign({},row,{_sourceIndex:index}) as AnyObj)
    .filter(row=>['UPI','CARD'].includes(String(row.mode||'').toUpperCase()));
  const uploaded = reconciliationUploaded(active);
  const duplicateDays = Array.from(new Set(batches.map(batch=>businessDate(batch.date)).filter((day,index,dates)=>day && dates.indexOf(day)!==index)));
  const dayList = batches.reduce<Record<string,B2cDaySummary>>((acc,batch)=>{const day=businessDate(batch.date);if(day&&!acc[day])acc[day]={count:arr(batch.transactions).filter(row=>row.type!=='Return').length,returns:arr(batch.transactions).filter(row=>row.type==='Return').length,stage:batchStage(batch).label};return acc;},{});
  const selectDay = (day:string) => {
    setDayKey(day); setSaveError(''); setImportMessage(''); setPendingReplace(null); setPendingFile(null); setLateMatchTarget(null);
    const url = new URL(window.location.href);
    url.searchParams.set('date',day);
    window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}${url.hash}`);
  };
  const runAction = async (action:()=>Promise<unknown>, success?:string, allowed=canEdit) => {
    if (busyRef.current || !allowed) return false;
    busyRef.current=true; setBusy(true); setSaveError('');
    try { await action(); if(success)setImportMessage(success); return true; }
    catch(error:any) { setImportMessage(''); setSaveError(error?.data?.error || error?.message || 'Save failed. Your draft has been kept. Try again.'); return false; }
    finally { busyRef.current=false; setBusy(false); }
  };
  const update = (next: AnyObj) => runAction(()=>save({ ...state, batches: batches.map((b,i)=>i===selected ? next : b) }));
  const importFile = () => document.getElementById('sales-import')?.click();
  const uploadDay = async (draft:{kind:UploadKind;date:string;fileName:string;transactions:AnyObj[];merged:number;conflicts:string[]}, replace:boolean) => {
    await upload({date:draft.date,fileName:draft.fileName,kind:draft.kind,replace,transactions:draft.transactions});
    selectDay(draft.date);
    setImportMessage(`${draft.transactions.length} ${draft.kind==='return'?'sales returns':'invoices'} ${replace?'replaced':'saved'} for ${reconciliationLabel(draft.date)}.${draft.merged?` ${draft.merged} extra item lines were merged into one entry per number.`:''}${draft.conflicts.length?` Check the net amount of ${draft.conflicts.join(', ')}: its lines disagreed, the first line was used.`:''}${draft.kind==='invoice'?' Review split allocations before submitting.':''}`);
  };
  const handleImport = (file?: File) => { if (!file || !canEdit) return;
    setSaveError(''); setImportMessage(''); setPendingReplace(null); setPendingFile(file); };
  const chooseKind = (kind:UploadKind) => { const file=pendingFile; if (!file) return;
    setPendingFile(null); setImportMessage('Reading Excel…'); void runAction(async () => {
      let workbook:XLSX.WorkBook;
      try { workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); }
      catch { throw new Error('Could not read that file. Use an XLSX, XLS or CSV export. Nothing was saved.'); }
      const sheets = workbook.SheetNames.map(name=>({ name, rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: '' }) }));
      const parsed = parseVastraSheets(sheets, kind);
      if ('error' in parsed) throw new Error(parsed.error);
      const single=oneEntryPerInvoice(parsed.rows);
      const days=Array.from(new Set(single.rows.map(row=>businessDate(row.date))));
      if (days.some(day=>!day)) throw new Error('Every row needs a valid date. Nothing was saved.');
      if (days.length!==1) throw new Error(`This file has rows for ${days.length} dates (${days.slice(0,4).map(reconciliationLabel).join(', ')}${days.length>4?', …':''}). Upload one day at a time. Nothing was saved.`);
      const day=days[0];
      const index=batches.findIndex(batch=>businessDate(batch.date)===day);
      const existing=index>=0?batches[index]:undefined;
      const taken=new Map(batches.flatMap((batch,i)=>arr(batch.transactions).filter(row=>i!==index||((row.type==='Return')!==(kind==='return'))).map(row=>[invoiceKey(row.invoiceNumber),businessDate(batch.date)] as const)));
      const repeated=single.rows.filter(row=>taken.has(invoiceKey(row.invoiceNumber)));
      if (repeated.length) throw new Error(`Already recorded in B2C for ${reconciliationLabel(taken.get(invoiceKey(repeated[0].invoiceNumber)))}: ${repeated.slice(0,5).map(row=>row.invoiceNumber).join(', ')}${repeated.length>5?` and ${repeated.length-5} more`:''}. Each invoice or return number can appear only once. Nothing was saved.`);
      const draft={kind,date:day,fileName:file.name,transactions:single.rows as AnyObj[],merged:single.merged,conflicts:single.conflicts};
      if (existing) {
        if (existing.status==='Submitted') throw new Error(`B2C for ${reconciliationLabel(day)} is locked. An Admin can delete the day first, then upload again.`);
        if (existing.billingSubmitted&&role!=='admin') throw new Error('The cash batch is submitted. Ask an Admin to change this day.');
        const slot=uploadSlot(existing,kind);
        if (slot.done) { selectDay(day); setImportMessage(''); setPendingReplace({...draft,existing:slot.count}); return; }
      }
      await uploadDay(draft,false);
    }); };
  const importBankFile = () => document.getElementById('bank-import')?.click();
  const handleBankImport = (file?:File) => { if(!file || !canBank)return; setImportMessage('Reading bank statement…'); void runAction(async()=>{
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}); const imported:AnyObj[]=[]; let ignored=0;
      for(const sheetName of workbook.SheetNames) {
        const matrix=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName],{header:1,defval:''}) as unknown[][];
        const headerIndex=matrix.findIndex(row=>{const keys=row.map(normalizeColumn);return keys.some(k=>k==='date')&&keys.some(k=>k.includes('narration'))&&keys.some(k=>k.includes('deposit'));});
        if(headerIndex<0) continue;
        const headers=matrix[headerIndex].map(String);
        for(const cells of matrix.slice(headerIndex+1)) {
          const row=Object.fromEntries(headers.map((header,i)=>[header,cells[i]])) as Record<string,unknown>;
          const narration=String(readField(row,'Narration','Description')??'');
          const amount=Number(String(readField(row,'Deposit Amt','Deposit Amount','Credit')??'').replace(/[₹,\s]/g,''));
          if(!Number.isFinite(amount)||amount<=0) continue;
          const upper=narration.toUpperCase();
          const explicit=String(readField(row,'Mode')??'').toUpperCase();
          const mode=explicit
            ? explicit.includes('UPI')?'UPI':explicit.includes('CARD')?'CARD':'UNCLASSIFIED'
            : upper.includes('UPI')||upper.includes('@')?'UPI':['POS','SWIPE','MERCHANT','SETTLEMENT'].some(word=>upper.includes(word))?'CARD':'UNCLASSIFIED';
          if(mode==='UNCLASSIFIED'){ignored++;continue;}
          imported.push({date:dateCell(readField(row,'Date')),narration,reference:String(readField(row,'Chq./Ref.No.','Reference','Ref No')??''),depositAmount:amount,mode,matchedInvoiceNumber:''});
        }
      }
      if(!imported.length){setImportMessage(`No UPI or card deposits found. Other transaction types were ignored${ignored?` (${ignored} rows)` : ''}.`);return;}
      const dated=imported.filter(row=>row.date); const skipped=imported.length-dated.length;
      if(!dated.length){setImportMessage('No deposit rows had a readable date. Nothing was uploaded.');return;}
      await saveBank({batchIndex:selected,date:businessDate(active.date),rows:dated});
      if(!hasBatch)setTab('Bank matching');
      setImportMessage(`${dated.length} UPI/card deposits imported.${ignored?` ${ignored} other transaction rows ignored.`:''}${skipped?` ${skipped} rows without a readable date were skipped.`:''}`);
  },undefined,canBank); };
  const setDenom=(key:string,value:number)=>update({...active,denominations:{...active.denominations,[key]:value}});
  const total = tx.filter(t=>t.type!=='Return').reduce((s,t)=>s+Number(t.totalInvoiceAmount||0),0);
  const returnCount = tx.filter(t=>t.type==='Return').length;
  const expectedCash = tx.reduce((s,t)=>s+(t.type==='Return'?-Math.abs(Number(t.totalInvoiceAmount)||0):Number(t.cashAmount||0)),0);
  const denomTotal = Object.entries(active.denominations || {}).reduce((s,[k,v])=>s+Number(k)*Number(v||0),0);
  const canExport=role==='admin'||role==='accounts';
  const exportTally = () => active.status==='Submitted' && downloadTallyWorkbook(active.tallyExport||makeTallyExport(active),String(active.date||'batch').slice(0,10));
  const submitCash = () => update({...active,billingSubmitted:true});
  const approveCash = () => update({...active,adminApproved:true});
  const pending = tx.filter(t=>!t.bankVerified && ['UPI','CARD','SPLIT'].includes(t.paymentMode));
  const batchEditable=canEdit&&hasBatch&&active.status!=='Submitted'&&!busy&&(role==='admin'||!active.billingSubmitted);
  const bankEditable=canBank&&hasBatch&&!busy;
  const candidatesFor = (deposit:AnyObj) => {
    const mode=String(deposit.mode||'').toUpperCase();
    if(mode!=='UPI'&&mode!=='CARD')return [];
    const depositDate=businessDate(deposit.date);
    const amount=Number(deposit.depositAmount)||0;
    return batches.flatMap((batch:AnyObj)=>arr(batch.transactions).flatMap((transaction:AnyObj)=>{
      const transactionDate=businessDate(transaction.date);
      const expected=Number(mode==='UPI'?transaction.upiAmount:transaction.cardAmount)||0;
      const matches=arr(transaction.bankMatches);
      const lateMatches=arr(transaction.lateBankMatches);
      const modeAlreadyMatched=matches.some((match:AnyObj)=>match.mode===mode)||lateMatches.some((match:AnyObj)=>match.mode===mode);
      if(transaction.type==='Return'||!transactionDate||!depositDate||depositDate<=transactionDate||expected<=0||
         Math.round(expected*100)!==Math.round(amount*100)||modeAlreadyMatched)return [];
      return [{key:`${batch.id}:${transaction.invoiceNumber}:${mode}`,paymentBatchId:String(batch.id),invoiceNumber:String(transaction.invoiceNumber),mode:mode as 'UPI'|'CARD',transactionDate,expectedAmount:expected}];
    }));
  };
  const finishLateMatch = async (rowIndex:number, deposit:AnyObj) => {
    if(!lateMatchTarget)return;
    const candidate=candidatesFor(deposit).find(item=>item.key===lateMatchTarget.candidateKey);
    if(!candidate){setSaveError('That payment is no longer eligible. Refresh the B2C page and try again.');return;}
    const ok=await runAction(()=>lateMatch({
      paymentBatchId:candidate.paymentBatchId,invoiceNumber:candidate.invoiceNumber,mode:candidate.mode,
      depositBatchId:String(active.id),bankRowIndex:rowIndex,note:lateMatchTarget.note,
    }),`Late ${candidate.mode} payment for ${candidate.invoiceNumber} matched with an audit note.`,role==='admin');
    if(ok)setLateMatchTarget(null);
  };
  return <div className="page-stack">
     <PageIntro eyebrow="VASTRA B2C · SALES CONTROL" title="B2C" description={role==='accounts'?'Pick a business date, upload its HDFC statement and review which online payments matched.':'Browse any date. Upload a Vastra invoice file and a sales return file; bank statements can also be added to empty or submitted dates.'} actions={<>{canEdit&&<><input id="sales-import" type="file" accept=".csv,.txt,.xls,.xlsx" disabled={busy} hidden onChange={e=>{handleImport(e.target.files?.[0]);e.target.value='';}}/><Button onClick={importFile} disabled={busy}><FileSpreadsheet size={15}/> Upload Excel</Button></>}{deleteDay&&<DeleteDayControl label="Delete day" noun="B2C invoices" counts={Object.fromEntries(Object.entries(dayList).map(([day,info])=>[day,info.count+info.returns||1]))} disabled={busy} warning={day=>batches.some(batch=>businessDate(batch.date)===day&&batch.status==='Submitted')?'This day is locked and already exported to Tally.':null} onDelete={async day=>{await deleteDay(day);setPendingReplace(null);setImportMessage(`B2C for ${reconciliationLabel(day)} was deleted.`);}}/>}{canExport&&<Button kind="primary" onClick={exportTally} disabled={active.status!=='Submitted'}><FileDown size={15}/> Export Tally Excel</Button>}</>}/>
    {importMessage&&<div className="recon-footnote" role="status">{importMessage}</div>}
    {saveError&&<div className="recon-error" role="alert">{saveError}</div>}
    {pendingFile&&<div className="b2c-replace" role="alertdialog" aria-label="Which Excel is this"><strong>Which Excel is {pendingFile.name}?</strong><span>The date is read from the file. A day can have one sales invoice file and one sales return file.</span><div><Button kind="primary" disabled={busy} onClick={()=>chooseKind('invoice')}>Sales invoices</Button><Button kind="primary" disabled={busy} onClick={()=>chooseKind('return')}>Sales returns</Button><Button disabled={busy} onClick={()=>{setPendingFile(null);setImportMessage('Upload cancelled. Nothing was changed.');}}>Cancel</Button></div></div>}
    {pendingReplace&&<div className="b2c-replace" role="alertdialog" aria-label="Replace this upload"><strong>B2C for {reconciliationLabel(pendingReplace.date)} already has {pendingReplace.existing} {pendingReplace.kind==='return'?'sales returns':'invoices'}.</strong><span>Replace them with the {pendingReplace.transactions.length} {pendingReplace.kind==='return'?'sales returns':'invoices'} in {pendingReplace.fileName}? The other file for this day, bank rows and cash counts are kept; cash submission and approval start again.</span><div><Button kind="primary" disabled={busy} onClick={()=>void runAction(()=>uploadDay(pendingReplace,true))}>Replace</Button><Button disabled={busy} onClick={()=>{setPendingReplace(null);setImportMessage('Upload cancelled. Nothing was changed.');}}>Cancel</Button></div></div>}
    {duplicateDays.length>0&&<div className="recon-error" role="status">Legacy duplicate dates: {duplicateDays.map(reconciliationLabel).join(', ')}. Existing records are preserved. Delete the extra day, then upload again.</div>}
    <div className="recon-toolbar"><B2cDayBar value={dayKey} today={localDateKey()} days={dayList} onSelect={selectDay}/><span className="toolbar-divider"/><div className="batch-meta"><span className="green-dot"/><span>{busy?'Saving / reading…':hasBatch?`${tx.length} transactions loaded`:'No B2C on this date'}</span></div></div>
    {hasBatch?<>
    <WorkflowSteps batch={active}/>
    <UploadSlots batch={active}/>
    <div className="metric-grid compact-grid"><Metric label="Invoice value" value={money(total)} note={returnCount?`${tx.length-returnCount} invoices · ${returnCount} returns`:`${tx.length} invoices`} icon={FileText}/><Metric label="Cash expected" value={money(expectedCash)} note="From payment allocations" icon={Banknote} color="gold"/>{role!=='accounts'&&<Metric label="Cash counted" value={money(denomTotal)} note={denomTotal===expectedCash?'Denominations balance':'Denominations need review'} icon={ClipboardCheck} color={denomTotal===expectedCash?'teal':'rose'}/>}<Metric label="Bank exceptions" value={`${pending.length}`} note="Card, UPI and split payments" icon={CircleAlert} color="rose"/></div>
    <Panel className="recon-panel"><div className="tabs">{(role==='accounts'?['Transactions','Bank matching']:['Transactions','Bank matching','Denominations']).map(t=><button key={t} onClick={()=>setTab(t)} className={`tab ${tab===t?'tab-active':''}`} data-testid={`tab-${t.toLowerCase().replace(' ','-')}`}>{t}{t==='Bank matching'&&<span className="tab-count">{pending.length}</span>}</button>)}</div>
      {tab==='Transactions' && <><div className="panel-tools"><span className="tool-note"><FileSpreadsheet size={16}/> Vastra invoice register</span><span className="tool-hint">Cash, UPI and card splits must equal each invoice before submission.</span></div>{tx.length ? <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>TYPE</th><th>PAYMENT MODE</th><th>CASH</th><th>UPI</th><th>CARD</th><th className="align-right">INVOICE TOTAL</th></tr></thead><tbody>{tx.map((t,i)=><tr key={`${selected}-${i}-${t.invoiceNumber}`}><td className="strong mono">{t.invoiceNumber || '—'}</td><td>{reconciliationLabel(t.date)}</td><td><StatusPill tone={t.type==='Return'?'bad':'neutral'}>{t.type || 'Invoice'}</StatusPill></td><td><select className="inline-select" value={t.paymentMode || 'CASH'} disabled={!batchEditable} onChange={e=>{const mode=e.target.value,amount=Number(t.totalInvoiceAmount)||0,n=[...tx];n[i]={...t,paymentMode:mode,type:mode==='RETURN'?'Return':'Invoice',cashAmount:mode==='CASH'?amount:0,upiAmount:mode==='UPI'?amount:0,cardAmount:mode==='CARD'?amount:0,bankVerified:mode==='CASH'||mode==='RETURN'};update({...active,transactions:n});}}>{['CASH','CARD','UPI','SPLIT','RETURN'].map(v=><option key={v}>{v}</option>)}</select></td>{['cashAmount','upiAmount','cardAmount'].map(k=><td key={k}><ReconciliationNumberInput label={`${k} ${t.invoiceNumber}`} disabled={!batchEditable||t.type==='Return'} value={Number(t[k] ?? 0)} onCommit={value=>{const n=[...tx];n[i]={...t,[k]:value};void update({...active,transactions:n});}}/></td>)}<td className="align-right mono strong">{money(t.totalInvoiceAmount)}</td></tr>)}</tbody></table></div> : <TableEmpty text="Create a dated B2C day, then import the Vastra B2C workbook to start matching invoices and payments."/>}</>}
      {tab==='Bank matching' && <>
        <div className="panel-tools">
          <span className="tool-note"><Banknote size={16}/> Deposits and invoice references</span>
          <span className="tool-hint">Only UPI and card deposits are kept. Same-day matches are automatic; statement rows can still be added after submission.</span>
          {canBank?<><input id="bank-import" type="file" accept=".csv,.txt,.xls,.xlsx" hidden data-testid="input-bank-statement" onChange={e=>{handleBankImport(e.target.files?.[0]);e.target.value='';}}/><Button onClick={importBankFile} disabled={!bankEditable} data-testid="button-import-bank-statement"><FileSpreadsheet size={14}/> Import HDFC statement</Button></>:<span className="tool-hint">Bank statements are uploaded by Accounts or Admin.</span>}
        </div>
        {canBank&&<BankReconcilePanel batch={active} rows={bankRows} role={role} busy={busy} format={money} onReconcile={request=>runAction(()=>reconcile(request),'Reconciliation saved with an audit note.',canBank)}/>}
        {bankRows.length ? <div className="table-wrap"><table>
          <thead><tr><th>DEPOSIT DATE</th><th>NARRATION / REFERENCE</th><th>MODE</th><th>DEPOSIT</th><th>MATCH TO INVOICE</th></tr></thead>
          <tbody>{bankRows.map((r,i)=>{
            const candidates=candidatesFor(r);
            const target=lateMatchTarget?.rowIndex===r._sourceIndex?lateMatchTarget:null;
            const selectedCandidate=candidates.find(candidate=>candidate.key===target?.candidateKey);
            return <Fragment key={`${selected}-${i}-${r.reference||r.date}`}>
              <tr>
                <td>{shortDate(r.date)}</td>
                <td><strong>{r.narration || 'Bank deposit'}</strong><small className="sub-cell">{r.reference || 'No reference'}</small></td>
                <td><span className="method-chip">{r.mode || '—'}</span></td>
                <td className="mono">{money(r.depositAmount)}</td>
                <td>
                  {r.manualNote
                    ? <span className="late-match-status"><strong>Noted · other inward</strong><small>{r.manualNote.note}</small></span>
                    : r.lateMatch
                    ? <span className="late-match-status"><strong>{r.lateMatch.kind==='club'?'Clubbed':'Late match'} · {r.matchedInvoiceNumber}</strong><small>{r.lateMatch.note}</small></span>
                    : r.matchedInvoiceNumber
                      ? <span className="mono">Matched · {r.matchedInvoiceNumber}</span>
                      : role==='admin'&&candidates.length
                        ? <Button kind="quiet" disabled={busy} onClick={()=>setLateMatchTarget({rowIndex:r._sourceIndex,candidateKey:candidates[0].key,note:''})} data-testid={`button-late-match-${r._sourceIndex}`}>Match later credit</Button>
                        : <span className="mono">Unmatched</span>}
                </td>
              </tr>
              {target&&<tr><td colSpan={5}>
                <div className="late-match-form">
                  <label>Earlier payment
                    <select className="inline-select" value={target.candidateKey} onChange={e=>setLateMatchTarget({...target,candidateKey:e.target.value})} data-testid={`select-late-match-target-${r._sourceIndex}`}>
                      {candidates.map(candidate=><option key={candidate.key} value={candidate.key}>{candidate.invoiceNumber} · {shortDate(candidate.transactionDate)} · {candidate.mode} · {money(candidate.expectedAmount)}</option>)}
                    </select>
                  </label>
                  <label>Required Admin note
                    <textarea value={target.note} maxLength={500} rows={2} placeholder="Explain why the bank credited this payment later" onChange={e=>setLateMatchTarget({...target,note:e.target.value})} data-testid={`input-late-match-note-${r._sourceIndex}`}/>
                  </label>
                  <div className="late-match-actions">
                    <Button kind="primary" disabled={busy||!target.note.trim()||!selectedCandidate} onClick={()=>void finishLateMatch(r._sourceIndex,r)} data-testid={`button-save-late-match-${r._sourceIndex}`}>Save late match</Button>
                    <Button disabled={busy} onClick={()=>setLateMatchTarget(null)} data-testid={`button-cancel-late-match-${r._sourceIndex}`}>Cancel</Button>
                  </div>
                </div>
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>:<TableEmpty text="Add UPI or card statement deposits to review bank matches."/>}
      </>}
      {tab==='Denominations' && <div className="denom-layout"><div><div className="tool-note"><Banknote size={16}/> Cash drawer count</div><p className="tool-hint denom-hint">Enter the number of notes and coins counted at close. Amounts save when you leave a field.{role==='admin'&&active.billingSubmitted&&active.status!=='Submitted'?' Admin edits are recorded in the change log and clear any approval.':''}</p><div className="denom-grid">{['500','200','100','50','20','10','5','2','1'].map(note=><label className="denom-row" key={`${selected}-${note}`}><span className="note-chip">₹{note}</span><span className="mono">×</span><ReconciliationNumberInput value={Number(active.denominations?.[note] ?? 0)} disabled={!batchEditable} label={`${note} rupee notes`} onCommit={value=>setDenom(note,value)}/><span className="mono denom-subtotal">{money(Number(note)*Number(active.denominations?.[note]||0))}</span></label>)}</div></div><div className="denom-summary"><div className="eyebrow">CASH CLOSE</div><strong className="mono">{money(denomTotal)}</strong><span>Physical count</span><div className="summary-line"/><span>Expected from sales less returns</span><b className="mono">{money(expectedCash)}</b><StatusPill tone={denomTotal===expectedCash?'good':'warn'}>{denomTotal===expectedCash?'Balanced':`${money(denomTotal-expectedCash)} variance`}</StatusPill>{active.status==='Submitted'?(canExport&&<Button kind="primary" onClick={exportTally}><FileDown size={15}/> Download Tally Excel</Button>)
          :active.billingSubmitted?<>
            <StatusPill tone="good">Cash submitted{active.billingSubmittedBy?` by ${active.billingSubmittedBy}`:''}</StatusPill>
            {role==='admin'?(active.adminApproved?<StatusPill tone="good">Approved · waiting for bank verification</StatusPill>:<Button kind="primary" disabled={busy||denomTotal!==expectedCash} onClick={approveCash}><CheckCircle2 size={15}/> Approve cash</Button>)
              :<small className="tool-hint">{active.adminApproved?'Approved. Waiting for bank verification.':'Waiting for Admin approval.'}</small>}
          </>
          :<Button kind="primary" disabled={!batchEditable||denomTotal!==expectedCash||!uploaded} onClick={submitCash}><CheckCircle2 size={15}/> Submit cash batch</Button>}</div></div>}
    </Panel>
    {role==='admin'&&<ChangeLog entries={arr(active.editLog) as any}/>}
    </>:<div className="b2c-empty"><strong>No B2C for {reconciliationLabel(dayKey)}</strong><p>{canEdit?'Upload a Vastra sales invoice or sales return Excel. The date inside the file decides which day it is saved to, so you can upload any date from here.':role==='accounts'?'Billing uploads the Vastra file for each day. You can also upload a bank statement for this date.':'Nothing has been uploaded for this date.'}</p>{canEdit&&<Button kind="primary" onClick={importFile} disabled={busy}><FileSpreadsheet size={15}/> Upload Excel</Button>}{canBank&&<><input id="bank-import" type="file" accept=".csv,.txt,.xls,.xlsx" hidden data-testid="input-bank-statement" onChange={e=>{handleBankImport(e.target.files?.[0]);e.target.value='';}}/><Button onClick={importBankFile} disabled={busy} data-testid="button-upload-bank-statement-empty-day"><Banknote size={15}/> Upload bank statement</Button></>}</div>}
    <div className="recon-footnote"><ShieldCheck size={16}/><span>Every adjustment is recorded in the workspace. Tally export uses the active batch only.</span><StatusPill tone="gold">{canEdit||canBank?'Editing enabled':'Read only'}</StatusPill></div>
  </div>;
}

function Dispatch({ state, canEdit, save, onDeleteDay }: { state: AnyObj; canEdit: boolean; save:(data:AnyObj)=>Promise<unknown>; onDeleteDay?: (day:string)=>Promise<unknown> }) {
  const [filter,setFilter]=useState('All'); const [search,setSearch]=useState('');
  const [editing,setEditing]=useState<number|null>(null); const [openInvoice,setOpenInvoice]=useState<number|null>(null); const [saveError,setSaveError]=useState('');
  const [saving,setSaving]=useState(false);
  const invoices:AnyObj[]=arr(state.invoices);
  const update=(i:number,patch:AnyObj)=>{const next=[...invoices];const item={...next[i],...patch}; const complete=Boolean(!item.ewayMovementBlocked&&item.eInvoiceDone&&item.eWayDone&&/^\d{12}$/.test(item.eWayBillNumber||'')&&item.bundleDone&&item.lrNumber&&item.lrPdfObjectPath&&item.whatsappSent&&item.courierSent&&item.courierPdfObjectPath&&item.vastraCourierUpdated);item.status=complete?'Completed':'Pending';next[i]=item;setSaveError('');setSaving(true);void save({...state,invoices:next}).catch(e=>setSaveError(e?.message||'Update failed. Refresh and try again.')).finally(()=>setSaving(false));};
  const saveInvoice=async(record:AnyObj)=>{
    if(invoices.some((v,i)=>i!==editing&&String(v.invoiceNumber).trim().toUpperCase()===String(record.invoiceNumber).trim().toUpperCase()))
      throw new Error('An invoice with this number already exists. Use Review details to edit it.');
    const next=editing===-1?[...invoices,{status:'Pending',eInvoiceDone:false,eWayDone:false,bundleDone:false,whatsappSent:false,courierSent:false,vastraCourierUpdated:false,...record}]:invoices.map((v,i)=>i===editing?{...v,...record,status:'Pending'}:v);
    await save({...state,invoices:next});setEditing(null);
  };
  const visible: Array<AnyObj & {_idx:number}>=invoices.map((v,i)=>({...v,_idx:i} as AnyObj & {_idx:number})).filter(v=>(filter==='All'||v.status===filter)&&`${v.invoiceNumber} ${v.customerName}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.invoiceNumber||'').localeCompare(String(b.invoiceNumber||''),undefined,{numeric:true}));
  const dayCounts=invoices.reduce<Record<string,number>>((acc,invoice)=>{const day=businessDate(invoice.date);if(day)acc[day]=(acc[day]||0)+1;return acc;},{});
  const deleteDay=async(day:string)=>{await onDeleteDay!(day);setOpenInvoice(null);setEditing(null);setSaveError('');};
  const printLabels=()=>window.print();
  return <div className="page-stack">
    <PageIntro eyebrow="B2B · DISPATCH DESK" title="Dispatch, without the loose ends." description="Make each compliance step visible before a bundle leaves the floor." actions={<><Button onClick={()=>setEditing(-1)} disabled={!canEdit||editing!==null}>+ Add B2B invoice</Button>{onDeleteDay&&<DeleteDayControl label="Delete day" noun="dispatch invoices" counts={dayCounts} disabled={saving||editing!==null} onDelete={deleteDay}/>}<Button kind="primary" onClick={printLabels}><Printer size={15}/> Print labels</Button></>}/>
    {editing!==null&&canEdit&&<DispatchInvoiceForm key={editing} initial={editing>=0?invoices[editing]:undefined} onSave={saveInvoice} onCancel={()=>setEditing(null)}/>}
    {saveError&&<div className="invoice-save-error" role="alert">{saveError}</div>}
    <div className="dispatch-banner"><div className="banner-icon"><PackageCheck size={19}/></div><div><strong>Compliance before courier handoff</strong><p>Complete e-invoice, e-way bill, bundle and carrier details. WhatsApp is not connected: send outside this app, then mark it sent.</p></div><span className="banner-count">{invoices.filter(i=>i.status==='Completed').length}<small>DONE</small></span></div>
    <div className="dispatch-summary"><Metric label="Invoices in queue" value={String(invoices.length)} note="B2B orders awaiting handoff" icon={FileText}/><Metric label="Ready to dispatch" value={String(invoices.filter(i=>i.status==='Completed').length)} note="All checklist items complete" icon={CheckCircle2} color="teal"/><Metric label="In progress" value={String(invoices.filter(i=>i.status!=='Completed').length)} note="Compliance steps remaining" icon={Clock3} color="gold"/></div>
    <Panel><div className="panel-heading dispatch-heading"><div><div className="eyebrow">ORDER COMPLIANCE</div><h2>Dispatch checklist</h2></div><div className="dispatch-filters"><div className="search-box"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search invoice or customer" data-testid="input-search-dispatch"/></div><select value={filter} onChange={e=>setFilter(e.target.value)} data-testid="select-dispatch-status"><option>All</option><option>Pending</option><option>Completed</option></select></div></div>
      {visible.length ? <div className="dispatch-list">{visible.map(invoice=><DispatchRecord key={invoice._idx} invoice={invoice} canEdit={canEdit} busy={saving||editing!==null} expanded={openInvoice===invoice._idx} onToggle={()=>setOpenInvoice(openInvoice===invoice._idx?null:invoice._idx)} onUpdate={patch=>update(invoice._idx,patch)} onReview={()=>setEditing(invoice._idx)}><DocumentUpload label={invoice.lrPdfObjectPath?'LR PDF attached':'Attach LR PDF'} disabled={!canEdit||saving||editing!==null} onUploaded={path=>update(invoice._idx,{lrPdfObjectPath:path})}/><DocumentUpload label={invoice.courierPdfObjectPath?'Courier PDF attached':'Attach courier PDF'} disabled={!canEdit||saving||editing!==null} onUploaded={path=>update(invoice._idx,{courierPdfObjectPath:path})}/></DispatchRecord>)}</div>:<TableEmpty text="No dispatch invoices match this view. Add dispatch data to the workspace to begin."/>}</Panel>
    {!canEdit&&<div className="recon-footnote"><ShieldCheck size={15}/> Read-only access. Ask an Admin to update dispatch compliance.</div>}
  </div>;
}

function People({ state, canEdit, canLog, save, saveAttendance }: { state:AnyObj;canEdit:boolean;canLog:boolean;save:(data:AnyObj)=>void;saveAttendance:(data:AnyObj)=>void }) {
  const [section,setSection]=useState('Attendance'); const [showForm,setShowForm]=useState(false);
  const [employeeForm,setEmployeeForm]=useState(false); const [employeeName,setEmployeeName]=useState(''); const [employeePhone,setEmployeePhone]=useState(''); const [employeeSalary,setEmployeeSalary]=useState('');
  const [swapFrom,setSwapFrom]=useState<string|null>(null);
  const employees=arr(state.employees); const exceptions=arr(state.attendance); const rosters=arr(state.sundayRosters);
   const [emp,setEmp]=useState('');const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [kind,setKind]=useState('Informed Absent');
  const submitException=()=>{if(!emp)return; saveAttendance({...state,attendance:[...exceptions,{employeeId:emp,date,exceptionType:kind}]});setShowForm(false);};
  const updateRoster=(id:string,field:string,value:string)=>save({...state,sundayRosters:rosters.map(r=>r.employeeId===id?{...r,[field]:value}:r)});
   const createEmployee=()=>{if(!employeeName.trim())return;const employee={id:`AT-${Date.now()}`,name:employeeName.trim(),contactNumber:employeePhone,status:'Active',baseSalary:Number(employeeSalary)||0,esiAmount:0,pfAmount:0,transportAllowance:0,accumulatedPto:2,weekendPenaltyCount:0};save({...state,employees:[...employees,employee]});setEmployeeForm(false);setEmployeeName('');setEmployeePhone('');setEmployeeSalary('');};
  const handleSwap=(employeeId:string)=>{if(!swapFrom){setSwapFrom(employeeId);return;}if(swapFrom===employeeId){setSwapFrom(null);return;}const first=rosters.find(r=>r.employeeId===swapFrom);const second=rosters.find(r=>r.employeeId===employeeId);if(first&&second)save({...state,sundayRosters:rosters.map(r=>r.employeeId===swapFrom?{...r,shiftType:second.shiftType,status:'Swap requested'}:r.employeeId===employeeId?{...r,shiftType:first.shiftType,status:'Swap requested'}:r)});setSwapFrom(null);};
  return <div className="page-stack">
    <PageIntro eyebrow="PEOPLE OPERATIONS" title="People, accounted for." description="Keep attendance exceptions and Sunday coverage clear before payroll is run." actions={<>{canLog&&<Button kind="primary" onClick={()=>setShowForm(v=>!v)}><Clock3 size={15}/> Log exception</Button>}</>}/>
    <div className="metric-grid compact-grid"><Metric label="Active employees" value={String(employees.filter(e=>e.status!=='Inactive').length)} note="Current employee records" icon={Users}/><Metric label="Attendance exceptions" value={String(exceptions.length)} note="Recorded for this cycle" icon={CircleAlert} color="gold"/><Metric label="Sunday roster" value={String(rosters.length)} note="Shift assignments on file" icon={ClipboardCheck} color="blue"/><Metric label="Payroll basis" value="Monthly" note="Salary and advances in Payroll" icon={Wallet} color="rose"/></div>
     {showForm&&<Panel className="exception-form"><PanelHeading kicker="NEW ATTENDANCE RECORD" title="Log an exception" action={<button className="icon-button" onClick={()=>setShowForm(false)} aria-label="Close form"><X size={17}/></button>}/><div className="form-row"><label>Employee<select value={emp} onChange={e=>setEmp(e.target.value)}><option value="">Choose employee</option>{employees.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Exception type<select value={kind} onChange={e=>setKind(e.target.value)}>{['Informed Absent','Uninformed Absent','Paid Leave','Half-Day','On-Duty'].map(x=><option key={x}>{x}</option>)}</select></label><Button kind="primary" onClick={submitException} disabled={!emp}>Save exception</Button></div></Panel>}
    <Panel><div className="tabs">{['Attendance','Employees','Sunday roster'].map(x=><button onClick={()=>setSection(x)} className={`tab ${section===x?'tab-active':''}`} key={x}>{x}</button>)}</div>
      {section==='Attendance'&&<><PanelHeading kicker="ATTENDANCE REVIEW" title="Exceptions this cycle"/>{exceptions.length?<div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>DATE</th><th>EXCEPTION</th><th>PAYROLL EFFECT</th></tr></thead><tbody>{exceptions.map((e,i)=><tr key={i}><td className="strong">{employees.find(v=>v.id===e.employeeId)?.name||e.employeeName||e.employeeId}</td><td>{shortDate(e.date)}</td><td><StatusPill tone={e.exceptionType==='Absent'?'warn':'neutral'}>{e.exceptionType}</StatusPill></td><td className="faint">{e.exceptionType==='Absent'?'Review weekend penalty':'No automatic change'}</td></tr>)}</tbody></table></div>:<TableEmpty text="No attendance exceptions have been logged for this cycle."/>}</>}
      {section==='Employees'&&<><PanelHeading kicker="EMPLOYEE REGISTER" title="Team records" action={canEdit&&<Button onClick={()=>setEmployeeForm(v=>!v)}><Users size={14}/> Add employee</Button>}/>{employeeForm&&<div className="form-row employee-form"><label>Employee name<input value={employeeName} onChange={e=>setEmployeeName(e.target.value)} placeholder="Full name"/></label><label>Contact number<input value={employeePhone} onChange={e=>setEmployeePhone(e.target.value)} placeholder="Mobile number"/></label><label>Base monthly salary (₹)<input type="number" value={employeeSalary} onChange={e=>setEmployeeSalary(e.target.value)} placeholder="Salary"/></label><Button kind="primary" onClick={createEmployee} disabled={!employeeName.trim()}>Save employee</Button></div>}{employees.length?<div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>CONTACT</th><th>STATUS</th><th>BASE SALARY</th><th>ESI / PF</th><th>ACCRUED PTO</th></tr></thead><tbody>{employees.map((e,i)=><tr key={e.id||i}><td className="strong">{e.name||'Employee'}<small className="sub-cell mono">{e.id}</small></td><td>{e.contactNumber||'—'}</td><td><StatusPill tone={e.status==='Active'?'good':'neutral'}>{e.status||'Active'}</StatusPill></td><td className="mono">{money(e.baseSalary)}</td><td className="mono">{money(Number(e.esiAmount||0)+Number(e.pfAmount||0))}</td><td>{Number(e.accumulatedPto||0)} days</td></tr>)}</tbody></table></div>:<TableEmpty text="Employee records will appear here when available in the workspace."/>}</>}
      {section==='Sunday roster'&&<><PanelHeading kicker="WEEKEND COVERAGE" title="Sunday roster" action={<label className="diwali-switch"><input type="checkbox" disabled={!canEdit} checked={Boolean(state.diwaliFullDay)} onChange={e=>save({...state,diwaliFullDay:e.target.checked})}/><span>Diwali full-day roster</span></label>}/>{rosters.length?<><div className="swap-note">Select “Swap shift” on one employee, then on another to request a roster exchange.</div><div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ROSTER DATE</th><th>SHIFT</th><th>STATUS</th><th>SWAP</th></tr></thead><tbody>{rosters.map((r,i)=><tr key={i}><td className="strong">{employees.find(e=>e.id===r.employeeId)?.name||r.employeeId}</td><td>{shortDate(r.date)}</td><td><select className="inline-select" disabled={!canEdit} value={r.shiftType||'Off'} onChange={e=>updateRoster(r.employeeId,'shiftType',e.target.value)}>{['Half-Day','Full-Day','Off'].map(v=><option key={v}>{v}</option>)}</select></td><td><StatusPill tone={r.status==='Confirmed'?'good':'warn'}>{r.status||'Draft'}</StatusPill></td><td><button className="swap-button" disabled={!canEdit} onClick={()=>handleSwap(r.employeeId)}>{swapFrom===r.employeeId?'Cancel swap':'Swap shift'}</button></td></tr>)}</tbody></table></div></>:<TableEmpty text="Sunday coverage assignments will appear here once the roster is set."/>}</>}
    </Panel>
    {!canEdit&&<div className="recon-footnote"><ShieldCheck size={15}/> Accounts access can record attendance exceptions; employee and roster records are read-only.</div>}
  </div>;
}

function Payroll({ state, canEdit, save }: {state:AnyObj;canEdit:boolean;save:(data:AnyObj)=>void}) {
  const [filter,setFilter]=useState('All');
  const [form,setForm]=useState<'note'|'salary'|null>(null);
  const [employeeId,setEmployeeId]=useState('');
  const [amount,setAmount]=useState('');
  const [repayment,setRepayment]=useState('');
  const [issueDate,setIssueDate]=useState(new Date().toISOString().slice(0,10));
  const employees=arr(state.employees);const notes=arr(state.noteAdvances);const advances=arr(state.salaryAdvances);
  const submitAdvance=()=>{
    if(!employeeId||Number(amount)<=0)return;
    const id=String(Date.now());
    if(form==='note')save({...state,noteAdvances:[...notes,{id,employeeId,totalAmount:Number(amount),remainingBalance:Number(amount),monthlyRepayment:Number(repayment)||0,issueDate,expectedCompletionDate:'',status:'Active'}]});
    if(form==='salary')save({...state,salaryAdvances:[...advances,{id,employeeId,amountIssued:Number(amount),issueDate}]});
    setForm(null);setAmount('');setRepayment('');
  };
  const totalSalary=employees.reduce((s,e)=>s+Number(e.baseSalary||0)+Number(e.transportAllowance||0)-Number(e.esiAmount||0)-Number(e.pfAmount||0),0);
  const remaining=notes.reduce((s,n)=>s+Number(n.remainingBalance||0),0);
  const visible=notes.filter(n=>filter==='All'||n.status===filter);
  return <div className="page-stack">
    <PageIntro eyebrow="PEOPLE OPERATIONS · ACCOUNTS" title="Payroll with a clear trail." description="Review salary basis and employee advances together before the month is closed." actions={<><Button onClick={()=>window.print()}><FileDown size={15}/> Print payroll view</Button>{canEdit&&<><Button onClick={()=>{setForm('note');setEmployeeId('');}}><Banknote size={14}/> Note advance</Button><Button kind="primary" onClick={()=>{setForm('salary');setEmployeeId('');}}><ArrowUpRight size={14}/> Salary advance</Button></>}</>}/>
    {form&&<Panel className="exception-form"><PanelHeading kicker={form==='note'?'RECOVERABLE EMPLOYEE ADVANCE':'ONE-TIME PAYROLL ADVANCE'} title={form==='note'?'Issue a note advance':'Record a salary advance'} action={<button className="icon-button" onClick={()=>setForm(null)} aria-label="Close form"><X size={17}/></button>}/><div className="form-row"><label>Employee<select value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{employees.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label><label>Amount (₹)<input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Enter amount"/></label>{form==='note'&&<label>Monthly repayment (₹)<input type="number" min="0" value={repayment} onChange={e=>setRepayment(e.target.value)} placeholder="Monthly deduction"/></label>}<label>Issue date<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label><Button kind="primary" onClick={submitAdvance} disabled={!employeeId||Number(amount)<=0}>Save advance</Button></div></Panel>}
    <div className="metric-grid compact-grid"><Metric label="Monthly salary basis" value={money(totalSalary)} note="Salary + transport − ESI / PF" icon={Wallet}/><Metric label="Note advance balance" value={money(remaining)} note={`${notes.length} active and completed records`} icon={Banknote} color="gold"/><Metric label="Salary advances issued" value={money(advances.reduce((s,a)=>s+Number(a.amountIssued||0),0))} note={`${advances.length} recorded this cycle`} icon={ArrowUpRight} color="blue"/><Metric label="Payroll headcount" value={String(employees.length)} note="Employee records on file" icon={Users} color="rose"/></div>
    <div className="payroll-grid"><Panel><PanelHeading kicker="MONTHLY SALARY" title="Salary register" action={<span className="mono faint">INR · MONTHLY</span>}/>{employees.length?<div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>BASE</th><th>TRANSPORT</th><th>ESI</th><th>PF</th><th className="align-right">EST. NET</th></tr></thead><tbody>{employees.map((e,i)=><tr key={e.id||i}><td className="strong">{e.name||'Employee'}<small className="sub-cell">{e.weekendPenaltyCount||0} weekend penalties</small></td><td className="mono">{money(e.baseSalary)}</td><td className="mono">{money(e.transportAllowance)}</td><td className="mono">{money(e.esiAmount)}</td><td className="mono">{money(e.pfAmount)}</td><td className="mono align-right strong">{money(Number(e.baseSalary||0)+Number(e.transportAllowance||0)-Number(e.esiAmount||0)-Number(e.pfAmount||0))}</td></tr>)}</tbody></table></div>:<TableEmpty text="Salary information is not yet available."/>}</Panel>
      <Panel><PanelHeading kicker="ADVANCES" title="Note advances" action={<select className="inline-select" value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>Active</option><option>Completed</option></select>}/>{visible.length?<div className="advance-list">{visible.map((n,i)=><div className="advance-row" key={n.id||i}><div className="advance-avatar">{(employees.find(e=>e.id===n.employeeId)?.name||'E').slice(0,1)}</div><div className="advance-detail"><strong>{employees.find(e=>e.id===n.employeeId)?.name||n.employeeName||'Employee'}</strong><small>Started {shortDate(n.issueDate)} · finishes {shortDate(n.expectedCompletionDate)}</small><div className="advance-progress"><i style={{width:`${Math.min(100,Math.max(0,100-(Number(n.remainingBalance||0)/Math.max(1,Number(n.totalAmount||1))*100)))}%`}}/></div><small>{money(n.monthlyRepayment)} monthly repayment</small></div><div className="advance-balance"><strong className="mono">{money(n.remainingBalance)}</strong><small>of {money(n.totalAmount)}</small><StatusPill tone={n.status==='Completed'?'good':'gold'}>{n.status||'Active'}</StatusPill></div></div>)}</div>:<TableEmpty text="No note advances match this view."/>}</Panel></div>
    <Panel><PanelHeading kicker="ONE-TIME SUPPORT" title="Salary advances" action={<span className="tool-hint">Issued amount and date</span>}/>{advances.length?<div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ISSUED</th><th>ISSUE DATE</th><th>RECORD</th></tr></thead><tbody>{advances.map((a,i)=><tr key={a.id||i}><td className="strong">{employees.find(e=>e.id===a.employeeId)?.name||a.employeeName||a.employeeId}</td><td className="mono">{money(a.amountIssued)}</td><td>{shortDate(a.issueDate)}</td><td><StatusPill tone="neutral">Salary advance</StatusPill></td></tr>)}</tbody></table></div>:<TableEmpty text="Salary advances issued this cycle will appear here."/>}</Panel>
    {!canEdit&&<div className="recon-footnote"><ShieldCheck size={15}/> Accounts view is read-only. Payroll master data is managed by Admin.</div>}
  </div>;
}

function Team({ role, users, loading, onRole }: {role:Role;users:WorkspaceUser[];loading:boolean;onRole:(id:string,role:Role)=>void}) {
  return <div className="page-stack"><PageIntro eyebrow="ADMINISTRATION · ACCESS CONTROL" title="The right access, for each role." description="Keep workspace permissions aligned with the work each person owns."/>
    <div className="role-intro"><div className="role-icon"><ShieldCheck size={20}/></div><div><strong>Role-based workspace access</strong><p>Admins manage access. Billing operates B2C and B2B dispatch. Accounts records attendance and views payroll. Pending accounts have no operational access.</p></div></div>
    <div className="role-cards">{[{role:'admin',label:'Admin',detail:'Full workspace access',count:'All modules'},{role:'billing',label:'Billing',detail:'B2C and dispatch operations',count:'2 modules'},{role:'accounts',label:'Accounts',detail:'Attendance input, HR and payroll view',count:'Read / log'},{role:'pending',label:'Pending',detail:'Waiting for role assignment',count:'No access'}].map((r,i)=><div className={`role-card rc-${i}`} key={r.role}><span className="role-index">0{i+1}</span><strong>{r.label}</strong><p>{r.detail}</p><small>{r.count}</small></div>)}</div>
    <Panel><PanelHeading kicker="WORKSPACE MEMBERS" title="Team access" action={<StatusPill tone={role==='admin'?'good':'warn'}>{cleanName(role)} view</StatusPill>}/>{loading?<LoadingView/>:users.length?<div className="table-wrap"><table><thead><tr><th>MEMBER</th><th>EMAIL</th><th>JOINED</th><th>ACCESS ROLE</th></tr></thead><tbody>{users.map((u,i)=><tr key={u.userId}><td><span className="member-cell"><span className="avatar avatar-light">{(u.name||u.email||'U').slice(0,1).toUpperCase()}</span><strong>{u.name||'Workspace member'}</strong></span></td><td>{u.email}</td><td>{shortDate(u.createdAt)}</td><td><select className="inline-select role-select" disabled={role!=='admin'} value={u.role} onChange={e=>onRole(u.userId,e.target.value as Role)} data-testid={`select-role-${u.userId}`}>{['admin','billing','accounts','pending'].map(x=><option key={x} value={x}>{cleanName(x)}</option>)}</select></td></tr>)}</tbody></table></div>:<TableEmpty text="No workspace members are available."/>}
      {role!=='admin'&&<div className="table-note"><ShieldCheck size={15}/> Only Admins can change member roles.</div>}
    </Panel>
  </div>;
}

function WorkspaceApp() {
  const {query,me,b2c,b2cBank,lateB2cBank,reconcileB2cBank,uploadB2c,deleteB2c,dispatch,deleteDispatch,hr,attendance}=useWorkspace();
  const roleMutation=useUpdateWorkspaceUserRole();
  const usersQuery=useListWorkspaceUsers({query:{queryKey:getListWorkspaceUsersQueryKey(),enabled:me.data?.role==='admin'}});
  const role=(me.data?.role || query.data?.user?.role || 'pending') as Role;
  const name=me.data?.name || query.data?.user?.name || '';
  const data=query.data;
  const save=(mutation:typeof b2c, module:AnyObj)=>mutation.mutate({data:{expectedVersion:data?.version||0,data:module}});
  const [loc]=useLocation();
  if(query.isLoading)return <AppShell role={role} name={name}><LoadingView/></AppShell>;
  if(query.isError||!data)return <AppShell role={role} name={name}><LoadError retry={()=>query.refetch()}/></AppShell>;
  const canOperate=role==='admin'||role==='billing';
  const canPeople=role==='admin'||role==='accounts';
  return <AppShell role={role} name={name}><ErrorBoundary resetKey={loc}><Switch>
    <Route path="/"><Overview state={data}/></Route>
    <Route path="/reconciliation">{canOperate||role==='accounts'?<Reconciliation state={data.b2c as AnyObj} canEdit={canOperate} role={role} save={next=>b2c.mutateAsync({data:{expectedVersion:data.version,data:next}})} saveBank={next=>b2cBank.mutateAsync({data:{expectedVersion:data.version,data:next}})} upload={next=>uploadB2c.mutateAsync({data:{expectedVersion:data.version,data:next}})} lateMatch={input=>lateB2cBank.mutateAsync({data:{expectedVersion:data.version,...input}})} reconcile={input=>reconcileB2cBank.mutateAsync({data:{expectedVersion:data.version,...input}})} deleteDay={role==='admin'?(date=>deleteB2c.mutateAsync({data:{expectedVersion:data.version,data:{date}}})):undefined}/>:<AccessDenied/>}</Route>
    <Route path="/dispatch">{canOperate?<Dispatch state={data.dispatch as AnyObj} canEdit={canOperate} save={next=>dispatch.mutateAsync({data:{expectedVersion:data.version,data:next}})} onDeleteDay={role==='admin'?(date=>deleteDispatch.mutateAsync({data:{expectedVersion:data.version,data:{date}}})):undefined}/>:<AccessDenied/>}</Route>
    <Route path="/people">{canPeople?<People state={data.hr as AnyObj} canEdit={role==='admin'} canLog={canPeople} save={next=>save(hr,next)} saveAttendance={next=>save(attendance,next)}/>:<AccessDenied/>}</Route>
    <Route path="/payroll">{canPeople?<Payroll state={data.hr as AnyObj} canEdit={role==='admin'} save={next=>save(hr,next)}/>:<AccessDenied/>}</Route>
    <Route path="/team">{role==='admin'?<Team role={role} users={(usersQuery.data||[]) as WorkspaceUser[]} loading={usersQuery.isLoading} onRole={(userId,nextRole)=>roleMutation.mutate({userId,data:{role:nextRole}},{onSuccess:()=>queryClient.invalidateQueries({queryKey:getListWorkspaceUsersQueryKey()})})}/>:<AccessDenied/>}</Route>
    <Route component={NotFound}/>
  </Switch></ErrorBoundary></AppShell>;

}
function AuthRouter() {
  const { isLoaded,isSignedIn }=useUser();
  const [loc,setLocation]=useLocation();
  useGetWorkspaceMe({query:{queryKey:getGetWorkspaceMeQueryKey(),enabled:isLoaded&&isSignedIn}});
  useEffect(()=>{if(isLoaded&&!isSignedIn&&loc==='/')setLocation('/sign-in',{replace:true});},[isLoaded,isSignedIn,loc,setLocation]);
  if(!isLoaded)return <LoadingView/>;
  if(!isSignedIn)return <AuthPage mode={loc.startsWith('/sign-up')?'up':'in'}/>;
  return <><ClerkCacheInvalidator/><Switch>
    <Route path="/sign-in/*?"><AuthPage mode="in"/></Route>
    <Route path="/sign-up/*?"><AuthPage mode="up"/></Route>
    <Route path="/" component={WorkspaceApp}/>
    <Route path="/reconciliation" component={WorkspaceApp}/>
    <Route path="/dispatch" component={WorkspaceApp}/>
    <Route path="/people" component={WorkspaceApp}/>
    <Route path="/payroll" component={WorkspaceApp}/>
    <Route path="/team" component={WorkspaceApp}/>
    <Route component={NotFound}/>
  </Switch></>;
}
function ClerkProviderWithRoutes() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Sign in to your operations workspace'}},signUp:{start:{title:'Join The Arun Tex',subtitle:'Create your workspace account'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><TooltipProvider><AuthRouter/><Toaster/></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  if(!clerkPubKey) return <div className="error-state"><Shirt size={24}/><h2>Workspace access is not configured</h2><p>Add the Clerk publishable key to enable secure workspace sign-in.</p></div>;
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes/></WouterRouter>;
}
export default App;
