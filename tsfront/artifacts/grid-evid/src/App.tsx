import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bot, Check, ChevronRight,
  CircleHelp, Clock3, Cloud, Download, FileJson2, Gauge, GitBranch, Leaf,
  Layers3, Network, RefreshCw, ShieldCheck, SlidersHorizontal, Zap,
} from 'lucide-react';
import {
  useCreateGridRun, useGetGridDashboard, useGetGridProviders,
  useGetGridRun, useGetReferenceScenario, useListGridAgents, useListGridRuns,
  useRecordHumanDecision, useRecordShadowOutcome,
  getGetGridDashboardQueryKey, getGetGridProvidersQueryKey, getGetGridRunQueryKey,
  getListGridAgentsQueryKey, getListGridRunsQueryKey,
  type ScenarioInput, type HumanDecisionInput, type ShadowOutcomeInput,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/runs', label: 'Run history', icon: Activity },
  { href: '/new', label: 'New orchestration', icon: Layers3 },
  { href: '/agents', label: 'Agent system', icon: Bot },
  { href: '/providers', label: 'Providers', icon: Network },
];

function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const current = location === '/' ? 'Overview' : location.startsWith('/runs/') ? 'Run detail' : navItems.find(x => x.href === location)?.label || 'GRID-EVID';
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" data-testid="link-brand">
        <span className="brand-mark">G//</span>
        <span><span className="brand-title">GRID-EVID</span><span className="brand-sub">ORCHESTRATION CONTROL</span></span>
      </Link>
      <div className="nav-label">Operations</div>
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href || (href === '/runs' && location.startsWith('/runs/')) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon />{label}</Link>)}
      </nav>
      <div className="sidebar-foot">
        <div className="mode-line"><span><i className="mode-dot" />Decision support</span><CircleHelp size={14} /></div>
        <small>HUMAN-IN-THE-LOOP · NO DISPATCH</small>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <div className="breadcrumb">GRID-EVID <ChevronRight size={12} style={{ verticalAlign: 'middle', margin: '0 5px' }} /><strong>{current}</strong></div>
        <div className="top-right"><span className="environment"><i className="status-dot" />CONTROL PLANE</span><span className="mono">EU / UTC</span></div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon />{label}</Link>)}
      </nav>
      {children}
    </div>
  </div>;
}

function Page({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Layout>{children}</Layout></ErrorBoundary>;
}

function Heading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="lede">{description}</p></div>{action}</div>;
}

function Panel({ title, caption, action, children, className = '' }: { title: string; caption?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2 className="panel-title">{title}</h2>{caption && <p className="panel-caption">{caption}</p>}</div>{action}</div>{children}</section>;
}

function ErrorBox({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  return <div className="inline-error" role="alert"><span>{message}</span><button className="button button-quiet" onClick={retry} data-testid="button-retry"><RefreshCw size={14} /> Retry</button></div>;
}

function LoadingRows({ rows = 4 }: { rows?: number }) {
  return <div className="panel-body skeleton-lines" aria-label="Loading"><div className="skeleton" style={{ width: '34%' }} />{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}>{[1, 2, 3, 4].map(n => <div key={n} className="skeleton" />)}</div>)}</div>;
}

function Status({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const cls = normalized === 'needs_review' ? 'review' : normalized.replaceAll('_', '-');
  return <span className={`badge ${cls}`} data-testid={`status-${normalized}`}>{normalized.replaceAll('_', ' ')}</span>;
}

function Metric({ label, value, unit, highlight = false, icon }: { label: string; value: string | number; unit?: string; highlight?: boolean; icon: ReactNode }) {
  return <div className={`metric-card ${highlight ? 'highlight' : ''}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="metric-label">{label}<span>{icon}</span></div><div className="metric-value mono">{value}<span className="metric-unit">{unit}</span></div>
  </div>;
}

function RunsTable({ runs, compact = false }: { runs: any[]; compact?: boolean }) {
  if (!runs.length) return <div className="empty-state"><div className="empty-mark"><GitBranch size={18} /></div><h3>No orchestration runs yet</h3><p>Submit a workload and grid scenario to create the first persisted run.</p><Link className="button button-primary" href="/new" data-testid="link-create-first-run">Create a run <ArrowRight size={14} /></Link></div>;
  return <div className="table-wrap"><table><thead><tr><th>Run / scenario</th><th>Status</th><th>Workloads</th><th>Shifted</th><th>CO₂ estimate</th><th>Created</th></tr></thead><tbody>
    {runs.map(run => <tr key={run.id} data-testid={`row-run-${run.id}`}><td><Link href={`/runs/${encodeURIComponent(run.id)}`} className="table-link" data-testid={`link-run-${run.id}`}>{run.name}</Link><div className="mono" style={{ fontSize: 10, color: '#8b9699', marginTop: 4 }}>{run.id}</div></td><td><Status status={run.status} /></td><td className="mono">{run.workloadCount}</td><td className="mono">{run.shiftCount}</td><td className="mono">{format(run.estimatedCo2SavedKg)} kg</td><td className="mono">{dateTime(run.createdAt)}</td></tr>)}
  </tbody></table></div>;
}

function format(value: number | undefined, digits = 1) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
}
function dateTime(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

function OverviewPage() {
  const dashboard = useGetGridDashboard();
  const providers = useGetGridProviders();
  const runs = useListGridRuns();
  const refresh = () => { dashboard.refetch(); providers.refetch(); runs.refetch(); };
  const d = dashboard.data;
  return <main className="page">
    <Heading eyebrow="Portfolio / decision support" title="Orchestration overview" description="A transparent view of workload flexibility, evidence-backed recommendations, and operator review across your data-center portfolio." action={<Link className="button button-primary" href="/new" data-testid="button-new-orchestration"><Zap size={15} /> New orchestration</Link>} />
    {(dashboard.isError || providers.isError || runs.isError) && <ErrorBox error={dashboard.error || providers.error || runs.error} retry={refresh} />}
    <div className="metric-grid" style={{ marginTop: 18 }}>
      <Metric label="Persisted runs" value={d?.totalRuns ?? '—'} icon={<GitBranch size={15} />} />
      <Metric label="Awaiting review" value={d?.pendingReview ?? '—'} icon={<Clock3 size={15} />} highlight />
      <Metric label="Shifted workloads" value={d?.shiftedWorkloads ?? '—'} icon={<ArrowUpRight size={15} />} />
      <Metric label="Estimated CO₂ saved" value={d ? format(d.estimatedCo2SavedKg) : '—'} unit="kg" icon={<Leaf size={15} />} highlight />
    </div>
    <div className="section-grid">
      <Panel title="Recent orchestration runs" caption="Persisted run history · estimates are not dispatch confirmations" action={<Link href="/runs" className="panel-link" data-testid="link-all-runs">All runs <ArrowRight size={13} /></Link>}>
        {dashboard.isLoading || runs.isLoading ? <LoadingRows rows={3} /> : runs.data ? <RunsTable runs={(d?.recentRuns ?? runs.data).slice(0, 6)} compact /> : <div className="empty-state">No run data available.</div>}
      </Panel>
      <div className="stack">
        <Panel title="Run posture" caption="Current persisted portfolio totals">
          {dashboard.isLoading ? <LoadingRows rows={2} /> : d && <div className="panel-body">
            <div className="status-strip"><span className="badge approved"><Check size={11} /> Approved</span><span className="mono">{d.approvedRuns}</span></div>
            <div className="status-strip" style={{ marginTop: 13 }}><span className="badge review"><Clock3 size={11} /> Pending review</span><span className="mono">{d.pendingReview}</span></div>
            <div style={{ height: 1, background: '#edf0ec', margin: '16px 0' }} />
            <div className="status-strip">Estimated cost delta <strong className="mono" style={{ marginLeft: 'auto', color: '#34464a' }}>{format(d.estimatedCostDeltaEur)} EUR</strong></div>
          </div>}
        </Panel>
        <Panel title="Provider adapters" caption="Connection state from provider status API" action={<Link href="/providers" className="panel-link" data-testid="link-provider-details">Details <ArrowRight size={13} /></Link>}>
          {providers.isLoading ? <div className="panel-body"><div className="skeleton" /></div> : providers.data ? <div className="panel-body">
             {(() => {
               const connected = d?.connectedProviders ?? providers.data.filter(p => p.status === 'connected').length;
               const total = d?.providerCount ?? providers.data.length;
               return <div className="status-strip"><span className={`badge ${connected > 0 ? 'connected' : 'unconfigured'}`}><i className="status-dot" />{connected > 0 ? 'Connected' : 'Not connected'}</span><span className="mono">{connected} / {total}</span></div>;
             })()}
            <p className="panel-caption" style={{ marginTop: 12 }}>Unconfigured adapters are not treated as live data connections.</p>
          </div> : null}
        </Panel>
      </div>
    </div>
  </main>;
}

function RunsPage() {
  const query = useListGridRuns();
  return <main className="page">
    <Heading eyebrow="Operations / archive" title="Run history" description="Persistent orchestration records. Open a run to inspect recommendations, evidence lineage, agent challenges, and operator decisions." action={<Link href="/new" className="button button-primary" data-testid="button-new-run"><Zap size={15} /> New orchestration</Link>} />
    {query.isError && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    <Panel title="All runs" caption={query.data ? `${query.data.length} persisted records` : 'Loading persisted records'}>
      {query.isLoading ? <LoadingRows rows={7} /> : query.data ? <RunsTable runs={query.data} /> : null}
    </Panel>
  </main>;
}

function NewRunPage() {
  const reference = useGetReferenceScenario();
  const create = useCreateGridRun();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [json, setJson] = useState('');
  const [loadNote, setLoadNote] = useState('');
  const [parseError, setParseError] = useState('');
  const loadReference = () => {
    if (!reference.data) return;
    setJson(JSON.stringify(reference.data, null, 2));
    setLoadNote('Synthetic reference scenario loaded. This is validation data, not a live site or grid connection.');
    setParseError('');
  };
  const submit = () => {
    setParseError('');
    let scenario: ScenarioInput;
    try {
      scenario = JSON.parse(json) as ScenarioInput;
      if (!scenario || typeof scenario.name !== 'string' || !scenario.asOf || !Array.isArray(scenario.sites) || !scenario.sites.length || !Array.isArray(scenario.workloads) || !scenario.workloads.length || !Array.isArray(scenario.gridWindows) || !scenario.gridWindows.length || !Array.isArray(scenario.evidence)) {
        throw new Error('Scenario must include a name, asOf, at least one site, workload, grid window, and an evidence array.');
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Scenario JSON is invalid.');
      return;
    }
    create.mutate({ data: scenario }, {
      onSuccess: result => {
        client.invalidateQueries({ queryKey: getListGridRunsQueryKey() });
        client.invalidateQueries({ queryKey: getGetGridDashboardQueryKey() });
        setLocation(`/runs/${encodeURIComponent(result.id)}`);
      },
    });
  };
  return <main className="page">
    <Heading eyebrow="Orchestration / input" title="Submit a scenario" description="Provide a complete workload and grid snapshot. The coordinator evaluates evidence, deterministic gates, and specialist-agent review before presenting an operator decision." />
    <div className="callout" style={{ marginBottom: 16 }}><strong>Decision support only.</strong> Submission creates an analysis record. Any approval records a human decision; it does not dispatch workloads.</div>
    {reference.isError && <ErrorBox error={reference.error} retry={() => reference.refetch()} />}
    {parseError && <div className="inline-error" style={{ marginBottom: 14 }} role="alert"><span>{parseError}</span><button onClick={() => setParseError('')} className="button button-quiet" data-testid="button-dismiss-json-error">Dismiss</button></div>}
    <Panel title="Scenario payload" caption="JSON must conform to the ScenarioInput schema" action={<button className="button" onClick={loadReference} disabled={reference.isLoading || !reference.data} data-testid="button-load-reference"><FileJson2 size={14} /> Load synthetic reference</button>}>
      <div className="panel-body">
        {loadNote && <div className="callout" style={{ marginBottom: 13 }} data-testid="text-reference-label"><strong>SYNTHETIC REFERENCE</strong> · {loadNote}</div>}
        <label className="field"><span className="field-hint">Scenario JSON · editable before submission</span><textarea className="textarea" value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "name": "Operator scenario",\n  "asOf": "2025-01-01T00:00:00Z",\n  "sites": [],\n  "workloads": [],\n  "gridWindows": [],\n  "evidence": []\n}'} spellCheck={false} data-testid="input-scenario-json" /></label>
        <div className="form-actions"><div className="form-note">{reference.isLoading ? 'Retrieving synthetic example…' : 'Reference example is clearly labeled synthetic and never indicates live provider connectivity.'}</div>
          <button className="button button-primary" onClick={submit} disabled={create.isPending || !json.trim()} data-testid="button-submit-scenario">{create.isPending ? <RefreshCw size={14} /> : <ArrowRight size={14} />}{create.isPending ? 'Analyzing scenario…' : 'Create orchestration run'}</button>
        </div>
        {create.isError && <div style={{ marginTop: 12 }}><ErrorBox error={create.error} retry={submit} /></div>}
      </div>
    </Panel>
    <div className="two-column" style={{ marginTop: 16 }}>
      <Panel title="Required structure" caption="Submitted payload requirements"><div className="panel-body"><div className="status-strip"><Check size={14} /> At least one site, workload, and grid window</div><div className="status-strip" style={{ marginTop: 12 }}><Check size={14} /> Evidence array and scenario timestamp</div><div className="status-strip" style={{ marginTop: 12 }}><Check size={14} /> Safety policy is optional</div></div></Panel>
      <Panel title="Run boundary" caption="What this console does and does not do"><div className="panel-body"><p className="lede" style={{ fontSize: 12 }}>GRID-EVID coordinates analysis and surfaces traceable recommendations. It does not execute a workload move. Human approval is an auditable decision record only.</p></div></Panel>
    </div>
  </main>;
}

function AgentsPage() {
  const query = useListGridAgents();
  return <main className="page">
    <Heading eyebrow="System / specialist delegation" title="Agent responsibilities" description="Specialist roles coordinate against the submitted scenario. Read each responsibility and delegation boundary as part of the recommendation’s provenance." />
    {query.isError && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    {query.isLoading ? <Panel title="Loading agent definitions"><LoadingRows rows={4} /></Panel> : query.data?.length ? <div className="agent-grid">{query.data.map(agent => <article className="agent-card" key={agent.id} data-testid={`card-agent-${agent.id}`}><div className="agent-id">{agent.id}</div><h2 className="agent-name">{agent.name}</h2><p className="agent-copy">{agent.responsibility}</p><div className="agent-delegate"><strong>Delegates when</strong><br />{agent.delegatesWhen}</div></article>)}</div> : !query.isError && <div className="empty-state panel"><div className="empty-mark"><Bot size={18} /></div><h3>No agent definitions returned</h3><p>Agent roles will appear when the service provides definitions.</p></div>}
  </main>;
}

function ProvidersPage() {
  const query = useGetGridProviders();
  return <main className="page">
    <Heading eyebrow="System / integrations" title="Provider adapters" description="Honest adapter status from the service. Unconfigured means no connection is established; degraded is not healthy connectivity." />
    {query.isError && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    <Panel title="Adapter registry" caption={query.data ? `${query.data.length} provider adapters reported` : 'Connection state is service-reported'}>
      {query.isLoading ? <LoadingRows rows={4} /> : query.data?.length ? <>
        <div className="provider-row" style={{ borderTop: 0, background: '#fbfcfa', color: '#859096', font: '10px var(--app-font-mono)', textTransform: 'uppercase' }}><div>Provider</div><div>Status</div><div>Adapter</div><div>Detail</div></div>
        {query.data.map(provider => <div className="provider-row" key={provider.id} data-testid={`row-provider-${provider.id}`}><div><div className="provider-name">{provider.name}</div><div className="provider-role">{provider.role}</div></div><div><Status status={provider.status} /></div><div className="provider-adapter mono">{provider.adapter}</div><div className="provider-role">{provider.detail}</div></div>)}
      </> : !query.isError && <div className="empty-state"><div className="empty-mark"><Network size={18} /></div><h3>No adapters reported</h3><p>The service did not return provider status records.</p></div>}
    </Panel>
    <div className="callout" style={{ marginTop: 14 }}>Connection labels reflect only the provider-status response. GRID-EVID does not infer connectivity from an available adapter definition.</div>
  </main>;
}

function DecisionForm({ runId, onRecorded }: { runId: string; onRecorded: () => void }) {
  const decision = useRecordHumanDecision();
  const client = useQueryClient();
  const [operator, setOperator] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const record = (value: HumanDecisionInput['decision']) => {
    if (!operator.trim()) { setError('Enter the operator name to record an auditable decision.'); return; }
    setError('');
    decision.mutate({ runId, data: { decision: value, operator: operator.trim(), note: note.trim() } }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getGetGridRunQueryKey(runId) });
        client.invalidateQueries({ queryKey: getListGridRunsQueryKey() });
        client.invalidateQueries({ queryKey: getGetGridDashboardQueryKey() });
        onRecorded();
      },
    });
  };
  return <Panel title="Human decision required" caption="Decision record only · no workload dispatch" className="decision-panel">
    <div className="panel-body">
      <div className="decision-controls">
        <label className="field"><span>Operator name</span><input className="input" value={operator} onChange={e => setOperator(e.target.value)} placeholder="Name for audit record" data-testid="input-operator-name" /></label>
        <label className="field"><span>Decision note</span><textarea className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional rationale" rows={3} data-testid="input-decision-note" /></label>
        {error && <div className="field-hint" role="alert">{error}</div>}
        {decision.isError && <div className="inline-error" role="alert">{decision.error instanceof Error ? decision.error.message : 'Decision could not be recorded.'}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button button-primary" disabled={decision.isPending} onClick={() => record('approve')} data-testid="button-approve-run"><Check size={14} /> Accept analysis</button>
          <button className="button button-danger" disabled={decision.isPending} onClick={() => record('reject')} data-testid="button-reject-run"><ArrowDownRight size={14} /> Reject analysis</button>
        </div>
        <div className="field-hint">Approval records your decision; it does not trigger execution.</div>
      </div>
    </div>
  </Panel>;
}

function ShadowOutcomeForm({ runId, windowIds }: { runId: string; windowIds: string[] }) {
  const mutation = useRecordShadowOutcome();
  const client = useQueryClient();
  const [windowId, setWindowId] = useState(windowIds[0] || '');
  const [carbon, setCarbon] = useState('');
  const [price, setPrice] = useState('');
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 16));
  const [message, setMessage] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!windowId || carbon === '' || price === '' || Number(carbon) < 0 || Number(price) < 0) {
      setMessage('Select a window and enter non-negative actual carbon and price values.');
      return;
    }
    const body: ShadowOutcomeInput = { windowId, actualCarbonIntensityGco2PerKwh: Number(carbon), actualPriceEurPerMwh: Number(price), observedAt: new Date(observedAt).toISOString() };
    setMessage('');
    mutation.mutate({ runId, data: body }, {
      onSuccess: result => {
        client.invalidateQueries({ queryKey: getGetGridRunQueryKey(runId) });
        setMessage(`Observed outcome recorded. Absolute percentage error: ${format(result.absolutePercentageError, 2)}%.`);
        setCarbon(''); setPrice('');
      },
    });
  };
  return <Panel title="Record shadow outcome" caption="Enter actual observed values to update source calibration memory">
    <div className="panel-body"><form onSubmit={submit} className="decision-controls">
      <label className="field"><span>Grid window ID</span>{windowIds.length ? <select className="select" value={windowId} onChange={e => setWindowId(e.target.value)} data-testid="select-outcome-window">{windowIds.map(id => <option value={id} key={id}>{id}</option>)}</select> : <input className="input" value={windowId} onChange={e => setWindowId(e.target.value)} placeholder="Window ID" data-testid="input-outcome-window" />}</label>
      <label className="field"><span>Actual carbon intensity · gCO₂/kWh</span><input className="input" type="number" min="0" step="any" value={carbon} onChange={e => setCarbon(e.target.value)} required data-testid="input-actual-carbon" /></label>
      <label className="field"><span>Actual price · EUR/MWh</span><input className="input" type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} required data-testid="input-actual-price" /></label>
      <label className="field"><span>Observed at</span><input className="input" type="datetime-local" value={observedAt} onChange={e => setObservedAt(e.target.value)} required data-testid="input-outcome-observed-at" /></label>
      {message && <div className="field-hint" role="status" data-testid="text-outcome-status">{message}</div>}
      {mutation.isError && <div className="inline-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : 'Observed outcome could not be recorded.'}</div>}
      <button className="button button-primary" type="submit" disabled={mutation.isPending} data-testid="button-record-outcome">{mutation.isPending ? 'Recording…' : 'Record observed outcome'}</button>
    </form></div>
  </Panel>;
}

function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = decodeURIComponent(params.runId || '');
  const query = useGetGridRun(runId, { query: { enabled: !!runId, queryKey: getGetGridRunQueryKey(runId) } });
  const run = query.data;
  if (query.isLoading) return <main className="page"><div className="skeleton" style={{ height: 27, width: 240, marginBottom: 20 }} /><Panel title="Loading run record"><LoadingRows rows={5} /></Panel></main>;
  if (query.isError) return <main className="page"><ErrorBox error={query.error} retry={() => query.refetch()} /></main>;
  if (!run) return <main className="page"><div className="empty-state panel"><h3>Run record unavailable</h3><p>The requested run was not returned by the service.</p><Link className="button" href="/runs" data-testid="link-back-runs">Back to runs</Link></div></main>;
  const windowIds = Array.from(new Set(run.recommendations.map(r => r.targetWindowId).filter((v): v is string => !!v)));
  const pendingReview = run.status === 'needs_review' && !run.humanDecision;
  const exportRecommendations = () => {
    const columns = ['run_id', 'run_name', 'created_at', 'workload_id', 'workload_name', 'action', 'target_window_id', 'estimated_co2_saved_kg', 'estimated_cost_delta_eur', 'confidence', 'safety_flags', 'evidence_source_ids', 'reason'];
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = run.recommendations.map(rec => [
      run.id,
      run.name,
      dateTime(run.createdAt),
      rec.workloadId,
      rec.workloadName,
      rec.action,
      rec.targetWindowId ?? '',
      rec.estimatedCo2SavedKg,
      rec.estimatedCostDeltaEur,
      rec.confidence,
      rec.safetyFlags.join('; '),
      rec.evidenceSourceIds.join('; '),
      rec.reason,
    ]);
    const csv = [columns, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `grid-evid-${run.id}-recommendations.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="page">
    <Heading eyebrow={`Run detail / ${run.id}`} title={run.name} description={run.summary} action={<Link href="/runs" className="button" data-testid="link-back-run-history"><ArrowDownRight size={14} /> Run history</Link>} />
    <div className="metric-grid">
      <Metric label="Workloads" value={run.workloadCount} icon={<Layers3 size={15} />} />
      <Metric label="Shift recommendations" value={run.shiftCount} icon={<ArrowUpRight size={15} />} />
      <Metric label="Estimated CO₂ saved" value={format(run.estimatedCo2SavedKg)} unit="kg" highlight icon={<Leaf size={15} />} />
      <Metric label="Cost delta" value={format(run.estimatedCostDeltaEur)} unit="EUR" icon={<SlidersHorizontal size={15} />} />
    </div>
    <div className="status-strip" style={{ margin: '0 0 16px' }}><Status status={run.status} /><span className="mono">{run.executionMode}</span><span className="mono">Created {dateTime(run.createdAt)}</span><span className="mono">{run.revisionCount} revisions</span></div>
    <div className="run-layout">
      <div className="stack">
        <Panel title="Recommendations" caption="Action rationale, safety gates, and referenced evidence" action={<button className="button button-quiet" onClick={exportRecommendations} data-testid="button-export-recommendations"><Download size={14} /> Export CSV</button>}>
          {run.recommendations.length ? run.recommendations.map((rec, i) => <article className="recommendation" key={`${rec.workloadId}-${i}`} data-testid={`recommendation-${rec.workloadId}`}>
            <div><div className="rec-name">{rec.workloadName}</div><div className="rec-meta mono">{rec.workloadId} · {rec.action.toUpperCase()} {rec.targetWindowId ? `→ ${rec.targetWindowId}` : ''}</div><div className="rec-reason">{rec.reason}</div>
              <div className="rec-stats"><span>Confidence {format(rec.confidence * 100, 1)}%</span><span>CO₂ estimate {format(rec.estimatedCo2SavedKg)} kg</span><span>Cost delta {format(rec.estimatedCostDeltaEur)} EUR</span></div>
              {rec.safetyFlags.length > 0 && <div className="rec-meta flags">Safety gates: {rec.safetyFlags.join(' · ')}</div>}
              {rec.evidenceSourceIds.length > 0 && <div className="rec-meta">Evidence: {rec.evidenceSourceIds.map(id => <span className="source-pill" key={id} style={{ marginRight: 5 }}>{id}</span>)}</div>}
            </div><Status status={rec.action === 'review' ? 'needs_review' : rec.action} />
          </article>) : <div className="empty-state">No recommendations returned for this run.</div>}
        </Panel>
        <Panel title="Agent trace" caption="Delegation sequence, retries, blocks, and source references">
          <div className="panel-body">{run.trace.length ? run.trace.map((trace, i) => <div className={`trace-row ${trace.outcome === 'blocked' ? 'blocked' : ''}`} key={trace.id} data-testid={`trace-${trace.id}`}>
            <span className="trace-marker" /><div><div className="trace-stage">{trace.stage} <span style={{ color: '#859095', fontWeight: 400 }}>· {trace.agentName}</span></div><div className="trace-summary">{trace.summary}</div><div className="rec-meta">Attempt {trace.attempt} · {trace.outcome}{trace.sourceReferences.length ? ` · refs ${trace.sourceReferences.join(', ')}` : ''}</div></div><time className="trace-time">{dateTime(trace.createdAt)}</time>
          </div>) : <div className="empty-state">No trace entries are available.</div>}</div>
        </Panel>
        <Panel title="Evidence provenance" caption="Source claims passed to the coordinator">
          <div className="panel-body">{run.evidence.length ? run.evidence.map((item, i) => <div className="evidence-row" key={`${item.sourceId}-${i}`} data-testid={`evidence-${item.sourceId}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div className="evidence-title">{item.sourceName}</div><span className="source-pill">{item.category.replaceAll('_', ' ')}</span></div>
            <div className="evidence-copy">{item.claim}</div><div className="evidence-meta">{item.provider} · ref {item.recordReference} · confidence {format(item.confidence * 100, 1)}% · observed {dateTime(item.observedAt)}</div>
            {item.notes && <div className="evidence-copy">{item.notes}</div>}
            {item.provenanceUri && <div className="evidence-meta">Provenance URI: {item.provenanceUri}</div>}
          </div>) : <div className="empty-state">No evidence entries were returned.</div>}</div>
        </Panel>
      </div>
      <div className="stack">
        {pendingReview ? <DecisionForm runId={runId} onRecorded={() => query.refetch()} /> :
          <Panel title="Human decision" caption="Operator decision record">
            <div className="panel-body">{run.humanDecision ? <><Status status={run.humanDecision.decision === 'approve' ? 'approved' : 'rejected'} /><div className="evidence-title" style={{ marginTop: 12 }}>{run.humanDecision.operator}</div><div className="evidence-copy">{run.humanDecision.note || 'No decision note recorded.'}</div><div className="evidence-meta">{dateTime(run.humanDecision.decidedAt)}</div></> : <div className="empty-state" style={{ padding: '8px 0' }}>No human decision recorded for this run.</div>}</div>
          </Panel>}
        <Panel title="Run integrity" caption="Execution and safety context"><div className="panel-body"><div className="status-strip"><ShieldCheck size={15} /> Safety gates are deterministic</div><div className="status-strip" style={{ marginTop: 12 }}><Cloud size={15} /> Execution mode <strong style={{ marginLeft: 'auto' }}>{run.executionMode}</strong></div><p className="panel-caption" style={{ marginTop: 12 }}>Recommendations are not dispatch instructions. An approval is a decision record only.</p></div></Panel>
        <Panel title="Calibration memory" caption="Source accuracy memory returned with this run"><div className="panel-body">{run.calibrationMemory.length ? run.calibrationMemory.map((item, i) => <div className="evidence-row" key={`${item.sourceId}-${i}`} data-testid={`calibration-${item.sourceId}`}><div className="evidence-title">{item.sourceId}</div><div className="evidence-meta">{item.sampleCount} samples · MAPE {format(item.meanAbsolutePercentageError * 100, 2)}% · last observed {dateTime(item.lastObservedAt)}</div></div>) : <div className="empty-state" style={{ padding: '8px 0' }}>No calibration memory entries.</div>}</div></Panel>
        <ShadowOutcomeForm runId={runId} windowIds={windowIds} />
      </div>
    </div>
  </main>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>
    <Switch>
      <Route path="/"><Page><OverviewPage /></Page></Route>
      <Route path="/runs"><Page><RunsPage /></Page></Route>
      <Route path="/runs/:runId"><Page><RunDetailPage /></Page></Route>
      <Route path="/new"><Page><NewRunPage /></Page></Route>
      <Route path="/agents"><Page><AgentsPage /></Page></Route>
      <Route path="/providers"><Page><ProvidersPage /></Page></Route>
      <Route><Page><NotFound /></Page></Route>
    </Switch>
  </ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
