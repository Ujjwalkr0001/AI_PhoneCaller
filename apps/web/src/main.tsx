import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileText,
  Headphones,
  LayoutDashboard,
  Megaphone,
  Mic,
  Moon,
  Pause,
  Phone,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import Papa from 'papaparse';
import {
  campaignSchema,
  defaultCampaign,
  languages,
  voices,
  type Campaign,
  type CallResult,
  type Contact,
  type Row,
  type Turn,
} from '../../../packages/shared/src/index.js';
import { api, csrf, setCsrf, wsUrl } from './api.js';
import { BrowserAudio } from './browser-audio.js';
import './style.css';

const query = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
type CampaignRow = Row<Campaign & { status: string }>;
type ContactRow = Row<Contact & { status: string; campaign_id: string; blocked_reason?: string }>;
type DeliveryRow = Row<{ status: string; result_id: string; attempts: number; error?: string }>;
interface Providers {
  simulation: boolean;
  dialogue: string;
  services: { name: string; status: string }[];
}
interface Summary {
  calls: number;
  today: number;
  interested: number;
  screenings: number;
  connected: number;
  avg_duration_s: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  outcomes: Record<string, number>;
  languages: Record<string, number>;
  days: Record<string, number>;
}
interface Analytics {
  real: Summary;
  sample: Summary;
  active: number;
  estimated_cost: number | null;
}
let notify: (s: string) => void = () => {};
const nice = (s: string) =>
  s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (x) => x.toUpperCase());
function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Button({
  children,
  kind = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: string }) {
  return (
    <button className={`button ${kind}`} {...props}>
      {children}
    </button>
  );
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <AudioLines size={32} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.isValidElement<{ id?: string }>(children)
        ? React.cloneElement(children, { id })
        : children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
function useData<T>(key: string, path = `/${key}`) {
  return useQuery<T>({ queryKey: [key, path], queryFn: () => api<T>(path), refetchInterval: 5000 });
}
async function mutate(path: string, method = 'POST', body?: unknown) {
  try {
    const result = await api(path, method, body);
    await query.invalidateQueries();
    return result;
  } catch (e) {
    notify((e as Error).message);
    throw e;
  }
}
function App() {
  const [user, setUser] = useState<{ email: string; role: string } | null | undefined>();
  const [toast, setToast] = useState(''),
    [dark, setDark] = useState(localStorage.getItem('theme') === 'dark');
  notify = setToast;
  useEffect(() => {
    api<{ email: string; role: string; csrf: string }>('/auth/me')
      .then((u) => {
        setCsrf(u.csrf);
        setUser(u);
      })
      .catch(() => setUser(null));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  if (user === undefined)
    return (
      <div className="loading">
        <AudioLines /> Opening your workspace…
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <span>
            ElevateBox<span className="brand-sub">CAMPAIGN STUDIO</span>
          </span>
        </Link>
        <div className="workspace">
          <span className="avatar">W</span>
          <span>
            My workspace<small>Calling operations</small>
          </span>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <NavLink end to="/">
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
          <NavLink to="/campaigns">
            <Megaphone size={18} />
            Campaigns
          </NavLink>
          <NavLink to="/leads">
            <Users size={18} />
            Leads
          </NavLink>
          <NavLink to="/candidates">
            <BriefcaseBusiness size={18} />
            Candidates
          </NavLink>
          <NavLink to="/analytics">
            <Activity size={18} />
            Analytics
          </NavLink>
        </nav>
        <div className="nav-label second">MANAGE</div>
        <nav>
          <NavLink to="/settings">
            <Settings2 size={18} />
            Settings
          </NavLink>
          <NavLink to="/compliance">
            <ShieldCheck size={18} />
            Compliance & privacy
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="gnani-note">
            <span className="status-dot" />
            Speech powered by Gnani<small>Prisma STT · Timbre TTS</small>
          </div>
          <button
            className="user"
            onClick={() => {
              void api('/auth/logout', 'POST').then(() => {
                query.clear();
                setUser(null);
              });
            }}
          >
            <span className="avatar violet">{user.email[0].toUpperCase()}</span>
            <span>
              {user.email}
              <small>{nice(user.role)} · Sign out</small>
            </span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} /> <b>Campaign Studio</b>
          </span>
          <div>
            <Badge tone="quiet">India · IST</Badge>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link to="/compliance" aria-label="Help and privacy">
              <CircleHelp size={19} />
            </Link>
          </div>
        </header>
        <main>
          <RuntimeBanner />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/new" element={<Wizard />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/campaigns/:id/edit" element={<Wizard />} />
            <Route path="/leads" element={<Results type="sales" />} />
            <Route path="/candidates" element={<Results type="hr" />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route
              path="*"
              element={
                <Empty title="Page not found">
                  <Link to="/">Back to overview</Link>
                </Empty>
              }
            />
          </Routes>
          <footer>
            Built for thoughtful conversations.
            <span>
              Gnani Prisma for recognition · Gnani Timbre for voice · <DialogueLabel />
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleHelp size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: { email: string; role: string }) => void }) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string; password: string }>();
  const [error, setError] = useState('');
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines />
          </span>
          ElevateBox
        </div>
        <div>
          <Badge tone="light">GNANI-POWERED SPEECH</Badge>
          <h1>
            Good conversations.
            <br />
            Meaningful outcomes.
          </h1>
          <p>
            Build multilingual calling campaigns that listen carefully, stay grounded, and put
            people first.
          </p>
          <div className="login-features">
            <span>
              <CheckCircle2 />
              Sales & marketing
            </span>
            <span>
              <CheckCircle2 />
              HR & recruitment
            </span>
            <span>
              <ShieldCheck />
              Disclosure built in
            </span>
          </div>
        </div>
        <small>Prisma STT + Timbre TTS. A separately configured LLM handles dialogue.</small>
      </div>
      <form
        className="login-card"
        onSubmit={handleSubmit(async (data) => {
          setError('');
          try {
            const u = await api<{ email: string; role: string; csrf: string }>(
              '/auth/login',
              'POST',
              data,
            );
            setCsrf(u.csrf);
            onLogin(u);
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
        <h2>Welcome back</h2>
        <p>Sign in to manage your calling campaigns.</p>
        <Field label="Email address">
          <input type="email" autoComplete="username" required {...register('email')} />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            {...register('password')}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button kind="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={16} />
        </Button>
        <small>Use the account seeded by your administrator. No public sign-up.</small>
      </form>
    </div>
  );
}
function DialogueLabel() {
  const { data } = useData<Providers>('providers');
  return <>Dialogue: {data?.dialogue ?? 'loading configuration'}</>;
}
function RuntimeBanner() {
  const { data } = useData<Providers>('providers');
  const { data: settings } = useData<{ kill_switch: boolean }>('settings');
  return (
    <>
      {data?.simulation && (
        <div className="banner sample">
          <Zap size={15} />
          <strong>Simulation mode</strong> Scripted dialogue and silent mock speech. Sample activity
          is labelled and excluded from live metrics.
        </div>
      )}
      {settings?.kill_switch && (
        <div className="banner danger">
          <Pause size={16} />
          Global kill switch active. All new dialing is paused.
        </div>
      )}
    </>
  );
}
function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Dashboard() {
  const { data: a } = useData<Analytics>('analytics'),
    { data: campaigns } = useData<CampaignRow[]>('campaigns'),
    { data: providers } = useData<Providers>('providers');
  const [samples, setSamples] = useState(false);
  const stats = samples ? a?.sample : a?.real;
  return (
    <>
      <PageTitle
        eyebrow="YOUR CALLING WORKSPACE"
        title="A little more human. A lot more possible."
        subtitle="Your campaigns, conversations, and next steps. All in one place."
        action={
          <Link className="button primary" to="/campaigns/new">
            <Plus size={17} />
            New campaign
          </Link>
        }
      />
      <div className="overview-controls">
        <div>
          <span className="status-dot" />
          Workspace overview
        </div>
        <label className="inline">
          <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
          Include only sample / simulated data
        </label>
        <Badge tone="quiet">Today, IST</Badge>
      </div>
      <div className="kpi-grid">
        {[
          {
            title: 'Calls today',
            value: stats?.today,
            Icon: Phone,
            hint: 'Recorded call results today',
          },
          {
            title: 'Connect rate',
            value: stats?.calls ? `${Math.round((stats.connected / stats.calls) * 100)}%` : '—',
            Icon: Radio,
            hint: 'Results with a conversation',
          },
          {
            title: 'Interested leads',
            value: stats?.interested,
            Icon: Users,
            hint: 'Hot + warm outcomes',
          },
          {
            title: 'Completed screenings',
            value: stats?.screenings,
            Icon: BriefcaseBusiness,
            hint: 'Ready for human review',
          },
        ].map(({ title, value, Icon, hint }) => (
          <div className="card kpi" key={title}>
            <div>
              {title}
              <span className="metric-icon">
                <Icon size={18} />
              </span>
            </div>
            <strong>{value ?? (a ? '0' : '…')}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card campaigns-card">
          <div className="section-title">
            <div>
              <h2>Your campaigns</h2>
              <p>From first hello to the next step.</p>
            </div>
            <Link to="/campaigns">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {!campaigns ? (
            <div className="skeleton" />
          ) : !campaigns.length ? (
            <Empty title="Your first conversation starts here">
              <p>Create a sales or recruitment campaign to get started.</p>
              <Link className="button primary" to="/campaigns/new">
                Create a campaign
                <ArrowRight size={16} />
              </Link>
            </Empty>
          ) : (
            <div className="campaign-list">
              {campaigns.slice(0, 4).map((c) => (
                <Link to={`/campaigns/${c.id}`} className="campaign-item" key={c.id}>
                  <span className={`campaign-icon ${c.data.type}`}>
                    {c.data.type === 'hr' ? (
                      <BriefcaseBusiness size={21} />
                    ) : (
                      <Megaphone size={21} />
                    )}
                  </span>
                  <div>
                    <h3>
                      {c.data.name} {c.data.sample && <Badge>Sample data</Badge>}
                    </h3>
                    <p>
                      {c.data.company_name} <span>·</span>{' '}
                      {c.data.type === 'hr' ? c.data.job_title : c.data.product_name}
                    </p>
                    <small>
                      {c.data.languages.map((l) => l.split('-')[0].toUpperCase()).join(' + ')}{' '}
                      <span>·</span>{' '}
                      {c.data.compliance.test_mode ? 'Test mode' : 'Production numbers'}
                    </small>
                  </div>
                  <Badge tone={c.data.status === 'running' ? 'success' : 'quiet'}>
                    {nice(c.data.status)}
                  </Badge>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="card health-card">
          <div className="section-title">
            <div>
              <h2>System health</h2>
              <p>Your conversation stack.</p>
            </div>
            <span className="status-dot" />
          </div>
          {providers?.services.map((p) => (
            <div className="health-row" key={p.name}>
              <span
                className={`status-dot ${p.status.includes('missing') ? 'orange' : p.status === 'simulated' ? 'purple' : ''}`}
              />
              <span>{p.name}</span>
              <small>{p.status}</small>
            </div>
          ))}
          <div className="health-foot">
            <ShieldCheck size={17} />
            <span>
              Keys stay on the server. Configured status does not imply a successful live probe.
            </span>
          </div>
        </section>
      </div>
      <div className="section-title lower">
        <div>
          <h2>Built around your next conversation</h2>
          <p>Choose the workflow. Make the agent your own.</p>
        </div>
      </div>
      <div className="workflow-grid">
        <Link to="/campaigns/new?type=sales" className="workflow-card">
          <div className="workflow-art sales-art">
            <Megaphone size={35} />
            <span className="orb one" />
            <span className="orb two" />
          </div>
          <div>
            <Badge tone="quiet">SALES & MARKETING</Badge>
            <h2>Turn interest into opportunity.</h2>
            <p>Introduce your offer, understand needs, and capture permission to follow up.</p>
            <span>
              Build a sales campaign <ArrowRight size={16} />
            </span>
          </div>
        </Link>
        <Link to="/campaigns/new?type=hr" className="workflow-card">
          <div className="workflow-art hr-art">
            <BriefcaseBusiness size={35} />
            <span className="orb one" />
            <span className="orb two" />
          </div>
          <div>
            <Badge tone="quiet">HR & RECRUITMENT</Badge>
            <h2>Find the fit. Keep the human touch.</h2>
            <p>
              Introduce the role and screen against your criteria. Your team makes every hiring
              decision.
            </p>
            <span>
              Build a recruitment campaign <ArrowRight size={16} />
            </span>
          </div>
        </Link>
      </div>
      <div className="card disclosure-note">
        <span className="icon-well">
          <ShieldCheck size={23} />
        </span>
        <div>
          <h3>Trust is part of the opening line.</h3>
          <p>
            Every agent identifies itself as AI, respects do-not-call requests, and speaks from your
            approved facts.
          </p>
        </div>
        <Link to="/compliance">
          Our safeguards <ArrowRight size={15} />
        </Link>
      </div>
    </>
  );
}
function Campaigns() {
  const { data } = useData<CampaignRow[]>('campaigns');
  const [search, setSearch] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="CAMPAIGNS"
        title="Every conversation starts with a plan."
        subtitle="Configure, test, and manage your sales and recruitment campaigns."
        action={
          <Link className="button primary" to="/campaigns/new">
            <Plus size={16} />
            New campaign
          </Link>
        }
      />
      <div className="card">
        <div className="table-toolbar">
          <Search size={16} />
          <input
            placeholder="Search campaigns"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <CampaignTable
          rows={(data ?? []).filter((c) =>
            c.data.name.toLowerCase().includes(search.toLowerCase()),
          )}
        />
      </div>
    </>
  );
}
function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Workflow</th>
            <th>Language</th>
            <th>Status</th>
            <th>Safety</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/campaigns/${c.id}`}>
                  <b>{c.data.name}</b>
                </Link>
                <small>
                  {c.data.company_name} {c.data.sample && '· Sample data'}
                </small>
              </td>
              <td>{c.data.type === 'hr' ? 'HR & recruitment' : 'Sales & marketing'}</td>
              <td>{c.data.languages.join(', ')}</td>
              <td>
                <Badge tone={c.data.status === 'running' ? 'success' : 'quiet'}>
                  {nice(c.data.status)}
                </Badge>
              </td>
              <td>
                <Badge>
                  {c.data.compliance.test_mode ? 'Test allowlist' : 'Operator attested'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No campaigns yet">
      <Link to="/campaigns/new">Create your first campaign</Link>
    </Empty>
  );
}

const steps = ['Workflow', 'Company & offer', 'Agent', 'Contacts', 'Schedule & safety', 'Review'];
function Wizard() {
  const navigate = useNavigate();
  const { id: editingId } = useParams();
  const importedRows = useRef('');
  const [c, setC] = useState<Campaign>(() => {
    try {
      const raw = localStorage.getItem('campaign-draft');
      if (raw) return JSON.parse(raw) as Campaign;
    } catch {
      /* discarded invalid local draft */
    }
    return defaultCampaign(
      new URLSearchParams(location.search).get('type') === 'hr' ? 'hr' : 'sales',
    );
  });
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<string | undefined>(editingId),
    [busy, setBusy] = useState(false),
    [testId, setTestId] = useState<string>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  useEffect(() => {
    if (editingId) {
      void api<CampaignRow>(`/campaigns/${editingId}`)
        .then((row) => {
          setC(row.data);
          setStep(1);
        })
        .catch((e) => setError(e.message));
      void api<ContactRow[]>(`/contacts?campaign_id=${editingId}`)
        .then((rows) => {
          const values = rows.map((r) => ({
            phone: r.data.phone,
            first_name: r.data.first_name,
            candidate_name: r.data.candidate_name,
            current_role: r.data.current_role,
            source: r.data.source,
            language: r.data.language,
            sample: r.data.sample,
          }));
          setContacts(values);
          importedRows.current = JSON.stringify(values);
        })
        .catch((e) => setError(e.message));
    }
  }, [editingId]);
  useEffect(() => {
    localStorage.setItem('campaign-draft', JSON.stringify(c));
  }, [c]);
  const set = <K extends keyof Campaign>(key: K, value: Campaign[K]) => {
    setC((p) => ({ ...p, [key]: value }));
  };
  const textField = (key: keyof Campaign, label: string, area = false, hint?: string) => (
    <Field label={label} hint={hint}>
      {area ? (
        <textarea
          value={String(c[key] ?? '')}
          onChange={(e) => set(key, e.target.value as never)}
          rows={3}
          maxLength={5000}
        />
      ) : (
        <input
          value={String(c[key] ?? '')}
          onChange={(e) => set(key, e.target.value as never)}
          maxLength={500}
        />
      )}
    </Field>
  );
  const tags = (
    key:
      | 'languages'
      | 'key_benefits'
      | 'do_not_say'
      | 'nice_to_have'
      | 'disqualifiers'
      | 'eligibility_rules'
      | 'key_facts',
    label: string,
  ) => (
    <Field label={label} hint="One item per line">
      <textarea
        rows={3}
        value={(c[key] as string[]).join('\n')}
        onChange={(e) => set(key, e.target.value.split('\n') as never)}
      />
    </Field>
  );
  async function save() {
    const parsed = campaignSchema.parse(c);
    const row = await api<CampaignRow>(
      saved ? `/campaigns/${saved}` : '/campaigns',
      saved ? 'PUT' : 'POST',
      parsed,
    );
    setSaved(row.id);
    if (contacts.length && importedRows.current !== JSON.stringify(contacts)) {
      const report = await api<{ status: string }[]>(
        `/campaigns/${row.id}/contacts`,
        'POST',
        contacts,
      );
      const rejected = report.filter(
        (r) => r.status !== 'valid' && r.status !== 'duplicate',
      ).length;
      if (rejected)
        notify(`${rejected} contact rows were rejected. Check contacts in campaign detail.`);
    }
    importedRows.current = JSON.stringify(contacts);
    await query.invalidateQueries();
    return row.id;
  }
  async function next() {
    setError('');
    if (
      step === 1 &&
      (!c.company_name.trim() ||
        (c.type === 'hr' && (!c.job_title.trim() || !c.role_summary.trim())) ||
        (c.type === 'sales' && !c.product_name.trim()))
    ) {
      setError('Complete your company name and offer or role details.');
      return;
    }
    if (step >= 4) {
      const checked = campaignSchema.safeParse(c);
      if (!checked.success) {
        setError(checked.error.issues.map((i) => i.message).join('; '));
        return;
      }
    }
    setStep((s) => Math.min(5, s + 1));
  }
  const repeated = (
    kind: 'faqs' | 'screening_questions' | 'qualification_questions' | 'objection_playbook',
  ) => {
    const rows = c[kind] as unknown as Record<string, unknown>[];
    const keys =
      kind === 'faqs'
        ? ['q', 'a']
        : kind === 'objection_playbook'
          ? ['objection', 'response']
          : ['question', 'field_key', 'expected_answer_hint'];
    return (
      <div className="repeat-group">
        <div className="section-title">
          <h3>{nice(kind)}</h3>
          <Button
            type="button"
            onClick={() =>
              set(kind, [
                ...rows,
                Object.fromEntries([
                  ...keys.map((k) => [k, '']),
                  ...(!['faqs', 'objection_playbook'].includes(kind)
                    ? [
                        ['required', true],
                        ['must_have', true],
                      ]
                    : []),
                ]),
              ] as never)
            }
          >
            <Plus size={14} />
            Add row
          </Button>
        </div>
        {rows.map((row, i) => (
          <div className="repeat-row" key={i}>
            {keys.map((k) => (
              <Field key={k} label={nice(k)}>
                <input
                  aria-label={`${nice(k)} ${i + 1}`}
                  value={String(row[k] ?? '')}
                  onChange={(e) =>
                    set(
                      kind,
                      rows.map((r, n) => (n === i ? { ...r, [k]: e.target.value } : r)) as never,
                    )
                  }
                />
              </Field>
            ))}
            {kind.includes('questions') && (
              <label className="inline">
                <input
                  type="checkbox"
                  checked={Boolean(row.must_have)}
                  onChange={(e) =>
                    set(
                      kind,
                      rows.map((r, n) =>
                        n === i
                          ? { ...r, must_have: e.target.checked, required: e.target.checked }
                          : r,
                      ) as never,
                    )
                  }
                />
                Must-have
              </label>
            )}
            <button
              className="icon-button"
              aria-label={`Remove row ${i + 1}`}
              onClick={() => set(kind, rows.filter((_, n) => n !== i) as never)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    );
  };
  return (
    <>
      <PageTitle
        eyebrow="NEW CAMPAIGN"
        title="Make a great first impression."
        subtitle="A few thoughtful details. An agent that sounds like your team."
        action={
          <Badge tone="quiet">
            <Check size={13} />
            Draft saved on this device
          </Badge>
        }
      />
      <div className="stepper">
        {steps.map((s, i) => (
          <div className={i === step ? 'current' : i < step ? 'done' : ''} key={s}>
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {s}
          </div>
        ))}
      </div>
      <div className="wizard-grid">
        <section className="card wizard-form">
          <div className="wizard-heading">
            <Badge tone="quiet">STEP {step + 1} OF 6</Badge>
            <h2>
              {
                [
                  'What would you like to achieve?',
                  'Tell us what matters.',
                  'Give your agent a voice.',
                  'Who are we talking to?',
                  'Set the boundaries.',
                  'Ready for the first hello?',
                ][step]
              }
            </h2>
            <p>
              {
                [
                  'Choose a purpose. We’ll tailor the conversation around it.',
                  'Only approved facts from this campaign may be spoken.',
                  'AI disclosure is always included in the opening.',
                  'Use synthetic data or contacts with documented consent.',
                  'Every dial is checked again, including callbacks.',
                  'Test your agent and review the safety checks before launching.',
                ][step]
              }
            </p>
          </div>
          {step === 0 && (
            <div className="choice-grid">
              {(['sales', 'hr'] as const).map((type) => (
                <button
                  key={type}
                  className={`choice-card ${c.type === type ? 'selected' : ''}`}
                  onClick={() => {
                    const next = defaultCampaign(type);
                    setC((p) => ({
                      ...next,
                      name: p.name,
                      company_name: p.company_name,
                      company_about: p.company_about,
                    }));
                  }}
                >
                  <span className="choice-icon">
                    {type === 'sales' ? <Megaphone /> : <BriefcaseBusiness />}
                  </span>
                  <h3>{type === 'sales' ? 'Sales & Marketing' : 'HR & Recruitment'}</h3>
                  <p>
                    {type === 'sales'
                      ? 'Introduce your offer, qualify interest, and arrange the next step.'
                      : 'Introduce the role, ask job-related questions, and prepare a screening summary.'}
                  </p>
                  <span className="choice-check">{c.type === type && <Check size={13} />}</span>
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <>
              <div className="form-grid">
                {textField('name', 'Campaign name')}
                {textField('company_name', 'Company name')}
                {textField('company_about', 'About the company', true)}
                {textField('website', 'Website (optional)')}
                {c.type === 'sales' ? (
                  <>
                    {textField('product_name', 'Product or service name')}
                    {textField('product_description', 'Product description', true)}
                    {textField('target_audience', 'Target audience')}
                    {textField(
                      'price_text',
                      'Approved price wording',
                      false,
                      'Leave empty to refer all pricing questions to your team.',
                    )}
                    {tags('key_benefits', 'Key benefits')}
                    <Field label="Price flexibility">
                      <select
                        value={c.price_flexibility}
                        onChange={(e) =>
                          set('price_flexibility', e.target.value as Campaign['price_flexibility'])
                        }
                      >
                        <option value="none">No negotiation</option>
                        <option value="escalate">Escalate to team</option>
                        <option value="scripted_discount">Scripted discount</option>
                      </select>
                    </Field>
                    {c.price_flexibility === 'scripted_discount' && (
                      <>
                        <Field label="Maximum discount %">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={c.discount_max_percent}
                            onChange={(e) => set('discount_max_percent', Number(e.target.value))}
                          />
                        </Field>
                        {textField('discount_conditions', 'Approved discount conditions')}
                      </>
                    )}
                    {textField('offer', 'Offer (optional)')}
                    {textField('offer_expiry', 'Offer expiry')}
                    {textField('cta', 'Next step on interest')}
                    {tags('disqualifiers', 'Disqualifiers')}
                  </>
                ) : (
                  <>
                    {textField('job_title', 'Job title')}
                    {textField('job_listing_ref', 'Job listing reference')}
                    {textField('department', 'Department')}
                    {textField('location', 'Location')}
                    <Field label="Work mode">
                      <select
                        value={c.work_mode}
                        onChange={(e) => set('work_mode', e.target.value as Campaign['work_mode'])}
                      >
                        {['onsite', 'hybrid', 'remote'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    {textField('employment_type', 'Employment type')}
                    <Field label="Openings">
                      <input
                        type="number"
                        min="1"
                        value={c.openings}
                        onChange={(e) => set('openings', Number(e.target.value))}
                      />
                    </Field>
                    {textField('experience_range', 'Experience range')}
                    {textField('role_summary', 'Role summary', true)}
                    {textField('salary_range_text', 'Approved salary wording (optional)')}
                    {textField('notice_period_preference', 'Notice period preference')}
                    {tags('nice_to_have', 'Nice-to-have skills')}
                    {tags('eligibility_rules', 'Job-related eligibility rules')}
                    {textField('interview_process_text', 'Interview process', true)}
                    <Field label="Resume submission channel">
                      <select
                        value={c.resume_submission.channel}
                        onChange={(e) =>
                          set('resume_submission', {
                            ...c.resume_submission,
                            channel: e.target.value as 'link' | 'email' | 'whatsapp',
                          })
                        }
                      >
                        {['link', 'email', 'whatsapp'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Resume destination">
                      <input
                        value={c.resume_submission.value}
                        onChange={(e) =>
                          set('resume_submission', {
                            ...c.resume_submission,
                            value: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Resume instructions">
                      <textarea
                        value={c.resume_submission.instructions}
                        onChange={(e) =>
                          set('resume_submission', {
                            ...c.resume_submission,
                            instructions: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </>
                )}
                {textField(
                  'fact_sheet',
                  'Approved fact sheet',
                  true,
                  `${c.fact_sheet.length}/5000 characters · Unknown information is referred to your team.`,
                )}
                {tags('key_facts', 'Key facts')}
              </div>
              {repeated(c.type === 'hr' ? 'screening_questions' : 'qualification_questions')}
              {repeated('faqs')}
              {c.type === 'sales' && repeated('objection_playbook')}
            </>
          )}
          {step === 2 && (
            <>
              <div className="form-grid">
                <Field label="Agent name">
                  <input
                    value={c.agent_persona.name}
                    onChange={(e) =>
                      set('agent_persona', { ...c.agent_persona, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Conversation tone">
                  <select
                    value={c.agent_persona.tone}
                    onChange={(e) =>
                      set('agent_persona', {
                        ...c.agent_persona,
                        tone: e.target.value as Campaign['agent_persona']['tone'],
                      })
                    }
                  >
                    {['friendly', 'formal', 'energetic'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Primary language">
                  <select
                    value={c.languages[0]}
                    onChange={(e) => {
                      set('languages', [
                        e.target.value as Campaign['languages'][number],
                        ...c.languages.slice(1).filter((l) => l !== e.target.value),
                      ]);
                      set('voice', { ...c.voice, [e.target.value]: 'Shivani' });
                    }}
                  >
                    {languages.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Additional languages (up to 3)">
                  <select
                    multiple
                    value={c.languages.slice(1)}
                    onChange={(e) => {
                      const selected = Array.from(
                        e.target.selectedOptions,
                        (x) => x.value as Campaign['languages'][number],
                      )
                        .filter((l) => l !== c.languages[0])
                        .slice(0, 3);
                      set('languages', [c.languages[0], ...selected]);
                      set(
                        'voice',
                        Object.fromEntries(
                          [c.languages[0], ...selected].map((l) => [l, c.voice[l] ?? 'Shivani']),
                        ),
                      );
                    }}
                  >
                    {languages
                      .filter((l) => l !== c.languages[0])
                      .map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                  </select>
                </Field>
                {c.languages.map((lang) => (
                  <Field key={lang} label={`Timbre voice · ${lang}`}>
                    <select
                      value={c.voice[lang] ?? 'Shivani'}
                      onChange={(e) =>
                        set('voice', {
                          ...c.voice,
                          [lang]: e.target.value as (typeof voices)[number],
                        })
                      }
                    >
                      {voices.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                ))}
                {textField('callback_number_or_contact', 'Approved callback contact')}
                <Field label="Maximum call duration (seconds)">
                  <input
                    type="number"
                    min="30"
                    max="600"
                    value={c.max_call_duration_s}
                    onChange={(e) => set('max_call_duration_s', Number(e.target.value))}
                  />
                </Field>
                {tags('do_not_say', 'Do not say')}
              </div>
              <div className="banner">
                <ShieldCheck size={18} />
                AI disclosure cannot be disabled. Recording is off.
              </div>
              <VoicePreview
                voice={c.voice[c.languages[0]] ?? 'Shivani'}
                language={c.languages[0]}
              />
            </>
          )}
          {step === 3 && <ContactsImport contacts={contacts} onChange={setContacts} />}
          {step === 4 && (
            <>
              <div className="form-grid">
                <Field label="Calling window starts (IST)">
                  <input
                    type="time"
                    min="09:00"
                    max="20:59"
                    value={c.schedule.start}
                    onChange={(e) => set('schedule', { ...c.schedule, start: e.target.value })}
                  />
                </Field>
                <Field label="Calling window ends (IST)">
                  <input
                    type="time"
                    min="09:01"
                    max="21:00"
                    value={c.schedule.end}
                    onChange={(e) => set('schedule', { ...c.schedule, end: e.target.value })}
                  />
                </Field>
                {(
                  [
                    'max_attempts',
                    'retry_gap_min',
                    'concurrency',
                    'daily_cap',
                    'daily_minutes',
                    'daily_stt_seconds',
                    'daily_tts_chars',
                  ] as const
                ).map((key) => (
                  <Field key={key} label={nice(key)}>
                    <input
                      type="number"
                      min={key === 'retry_gap_min' ? 30 : 1}
                      max={key === 'max_attempts' ? 2 : undefined}
                      value={c.schedule[key]}
                      onChange={(e) =>
                        set('schedule', { ...c.schedule, [key]: Number(e.target.value) })
                      }
                    />
                  </Field>
                ))}
              </div>
              <label className="check-card">
                <input
                  type="checkbox"
                  checked={c.compliance.test_mode}
                  onChange={(e) =>
                    set('compliance', { ...c.compliance, test_mode: e.target.checked })
                  }
                />
                <span>
                  <b>Test mode</b>
                  <small>Dial only your teammates’ explicitly allowlisted numbers.</small>
                </span>
                <Badge>Recommended</Badge>
              </label>
              <Field label="Test allowlist · one E.164 number per line">
                <textarea
                  placeholder="Teammates’ own phones only"
                  value={c.compliance.allowlist.join('\n')}
                  onChange={(e) =>
                    set('compliance', {
                      ...c.compliance,
                      allowlist: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                />
              </Field>
              <label className="check-card">
                <input
                  type="checkbox"
                  checked={c.compliance.attested}
                  onChange={(e) =>
                    set('compliance', { ...c.compliance, attested: e.target.checked })
                  }
                />
                <span>
                  <b>I confirm the operator obligations are met.</b>
                  <small>
                    Consent, DND scrubbing and telemarketing registration are my responsibility.
                    This app does not scrub NCPR/DLT registries.
                  </small>
                </span>
              </label>
              <DestinationPicker
                selected={c.destination_ids}
                onChange={(ids) => set('destination_ids', ids)}
              />
            </>
          )}
          {step === 5 && (
            <>
              <div className="review-grid">
                <div>
                  <small>Campaign</small>
                  <b>{c.name}</b>
                  <span>{c.type === 'hr' ? 'HR & recruitment' : 'Sales & marketing'}</span>
                </div>
                <div>
                  <small>Company & purpose</small>
                  <b>{c.company_name}</b>
                  <span>{c.type === 'hr' ? c.job_title : c.product_name}</span>
                </div>
                <div>
                  <small>Contacts</small>
                  <b>{contacts.length} imported rows</b>
                  <span>Validation runs again on save</span>
                </div>
                <div>
                  <small>Schedule</small>
                  <b>
                    {c.schedule.start}–{c.schedule.end} IST
                  </b>
                  <span>
                    {c.schedule.daily_cap} calls/day · {c.schedule.concurrency} concurrent
                  </span>
                </div>
              </div>
              <div className="banner">
                <ShieldCheck size={18} />
                {c.compliance.attested
                  ? 'Attestation recorded.'
                  : 'Attestation is required before launch.'}{' '}
                {c.compliance.test_mode
                  ? 'Test allowlist enforced.'
                  : 'Production calling enabled by operator.'}
              </div>
              <div className="banner quiet">
                <FileText size={18} />
                Estimated usage: up to {(contacts.length * c.max_call_duration_s) / 60} call minutes
                for one attempt per row. Cost unavailable until provider rates are configured.
              </div>
              <Button
                onClick={() => {
                  setBusy(true);
                  void save()
                    .then(setTestId)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
                disabled={busy}
              >
                <Mic size={16} />
                Test in browser
              </Button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="wizard-actions">
            <Button onClick={() => (step ? setStep((s) => s - 1) : navigate('/campaigns'))}>
              <ArrowLeft size={16} />
              {step ? 'Back' : 'Cancel'}
            </Button>
            <span>
              {step === 0 ? 'Start with your purpose' : 'You can edit this before launch'}
            </span>
            {step < 5 ? (
              <Button
                kind="primary"
                onClick={() => {
                  void next();
                }}
              >
                Continue
                <ArrowRight size={16} />
              </Button>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void save()
                      .then((id) => {
                        localStorage.removeItem('campaign-draft');
                        navigate(`/campaigns/${id}`);
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Save draft
                </Button>
                <Button
                  kind="primary"
                  disabled={busy || !c.compliance.attested}
                  onClick={() => {
                    setBusy(true);
                    void save()
                      .then(async (id) => {
                        await mutate(`/campaigns/${id}/launch`);
                        localStorage.removeItem('campaign-draft');
                        navigate(`/campaigns/${id}`);
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Play size={15} />
                  Launch campaign
                </Button>
              </>
            )}
          </div>
        </section>
        <aside className="agent-preview card">
          <div className="preview-top">
            <span className="eyebrow">LIVE AGENT PREVIEW</span>
            <span className="status-dot" />
          </div>
          <div className="agent-avatar">
            <AudioLines size={34} />
          </div>
          <h2>{c.agent_persona.name}</h2>
          <p>{nice(c.agent_persona.tone)} AI assistant</p>
          <div className="voice-wave">
            {Array.from({ length: 29 }, (_, i) => (
              <i key={i} style={{ height: `${8 + Math.sin(i * 1.7) ** 2 * 30}px` }} />
            ))}
          </div>
          <div className="opening-preview">
            <Badge>OPENING LINE</Badge>
            <p>
              Hello, I’m {c.agent_persona.name}, an <strong>AI assistant</strong> calling on behalf
              of <strong>{c.company_name}</strong>. Is this a good time?
            </p>
            <small>Localized at runtime for supported primary languages.</small>
          </div>
          <div className="preview-details">
            <span>
              Recognition<b>Gnani Prisma</b>
            </span>
            <span>
              Voice<b>Gnani Timbre · {c.voice[c.languages[0]]}</b>
            </span>
            <span>
              Dialogue
              <b>
                <DialogueLabel />
              </b>
            </span>
            <span>
              Recording<b>Off</b>
            </span>
          </div>
          <div className="preview-safe">
            <ShieldCheck size={16} />
            Grounded in your campaign facts.
          </div>
        </aside>
      </div>
      {testId && <BrowserTest id={testId} close={() => setTestId(undefined)} />}
    </>
  );
}
function DestinationPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data } = useData<Row<{ name: string }>[]>('destinations');
  return (
    <div className="repeat-group">
      <h3>Result destinations</h3>
      <p className="muted">Internal database is always on. Add webhooks in Settings.</p>
      {data?.map((d) => (
        <label className="inline" key={d.id}>
          <input
            type="checkbox"
            checked={selected.includes(d.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, d.id] : selected.filter((id) => id !== d.id),
              )
            }
          />
          {d.data.name}
        </label>
      ))}
    </div>
  );
}
function ContactsImport({
  contacts,
  onChange,
}: {
  contacts: Contact[];
  onChange: (rows: Contact[]) => void;
}) {
  const [validation, setValidation] = useState<{ index: number; status: string }[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (contacts.length)
        void api<{ index: number; status: string }[]>('/contacts/validate', 'POST', contacts)
          .then(setValidation)
          .catch(() => setValidation([]));
      else setValidation([]);
    }, 350);
    return () => clearTimeout(timer);
  }, [contacts]);
  const [raw, setRaw] = useState(''),
    [parsed, setParsed] = useState<Record<string, string>[]>([]),
    [columns, setColumns] = useState<string[]>([]),
    [phoneColumn, setPhoneColumn] = useState('phone'),
    [nameColumn, setNameColumn] = useState('first_name');
  function parse(text: string) {
    setRaw(text);
    const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    setParsed(result.data);
    setColumns(result.meta.fields ?? []);
  }
  function apply() {
    onChange(
      parsed.map((r) => ({
        phone: r[phoneColumn] ?? '',
        first_name: r[nameColumn] ?? '',
        candidate_name: r.candidate_name ?? '',
        current_role: r.current_role ?? '',
        source: r.source ?? '',
        sample: false,
        language: undefined,
      })),
    );
  }
  return (
    <>
      <label
        className="upload-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void f.text().then(parse);
        }}
      >
        <ArrowDownToLine size={28} />
        <b>Drop a CSV, or click to choose</b>
        <span>Up to 200 rows · E.164 phone numbers · synthetic or consented data</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then(parse);
          }}
        />
      </label>
      <Field
        label="Or paste CSV / add a row manually"
        hint="Headers: phone,first_name,candidate_name,current_role,source"
      >
        <textarea
          rows={5}
          value={raw}
          onChange={(e) => parse(e.target.value)}
          placeholder={'phone,first_name\n+12025550101,Sample candidate'}
        />
      </Field>
      {columns.length > 0 && (
        <div className="form-grid">
          <Field label="Phone column">
            <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)}>
              {columns.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Name column">
            <select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
              {columns.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Button onClick={apply}>
            <Check size={15} />
            Apply column mapping
          </Button>
        </div>
      )}
      <div className="section-title">
        <h3>
          {contacts.length} contact rows{' '}
          <small>
            {['valid', 'invalid', 'duplicate', 'suppressed']
              .map((status) => `${validation.filter((v) => v.status === status).length} ${status}`)
              .join(' / ')}
          </small>
        </h3>
        <Button
          onClick={() =>
            onChange([
              ...contacts,
              {
                phone: '',
                first_name: '',
                candidate_name: '',
                current_role: '',
                source: '',
                sample: false,
              },
            ])
          }
        >
          <Plus size={14} />
          Manual row
        </Button>
      </div>
      {contacts.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Phone number</th>
                <th>Name</th>
                <th>Review</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={`Phone row ${i + 1}`}
                      value={r.phone}
                      onChange={(e) =>
                        onChange(
                          contacts.map((x, n) => (i === n ? { ...x, phone: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Name row ${i + 1}`}
                      value={r.first_name}
                      onChange={(e) =>
                        onChange(
                          contacts.map((x, n) =>
                            i === n ? { ...x, first_name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Badge
                      tone={
                        !/^\+\d{8,15}$/.test(r.phone)
                          ? 'danger'
                          : contacts.slice(0, i).some((x) => x.phone === r.phone)
                            ? 'warn'
                            : 'quiet'
                      }
                    >
                      {!/^\+\d{8,15}$/.test(r.phone)
                        ? 'Invalid format'
                        : contacts.slice(0, i).some((x) => x.phone === r.phone)
                          ? 'Duplicate'
                          : (validation[i]?.status ?? 'Validating?')}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Remove contact ${i + 1}`}
                      onClick={() => onChange(contacts.filter((_, n) => n !== i))}
                    >
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
function VoicePreview({ voice, language }: { voice: string; language: string }) {
  const [busy, setBusy] = useState(false);
  const { data } = useData<Providers>('providers');
  return (
    <Button
      disabled={busy || data?.simulation}
      title={
        data?.simulation
          ? 'Live Gnani credentials required; mock audio is silent.'
          : 'Synthesizes a short sample using Timbre'
      }
      onClick={() => {
        setBusy(true);
        void fetch('/api/v1/voice-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ voice, language }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error((await response.json()).error);
            const url = URL.createObjectURL(await response.blob());
            const audio = new Audio(url);
            audio.onended = () => URL.revokeObjectURL(url);
            await audio.play();
          })
          .catch((error) => notify(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <Play size={15} />
      {busy
        ? 'Synthesizing…'
        : data?.simulation
          ? 'Voice preview requires live Gnani'
          : 'Preview Timbre voice'}
    </Button>
  );
}
function CampaignDetail() {
  const { id } = useParams();
  const { data: c } = useData<CampaignRow>(`campaign-${id}`, `/campaigns/${id}`);
  const { data: contacts } = useData<ContactRow[]>(`contacts-${id}`, `/contacts?campaign_id=${id}`);
  const [tab, setTab] = useState('Contacts'),
    [test, setTest] = useState(false),
    [importing, setImporting] = useState(false),
    [rows, setRows] = useState<Contact[]>([]);
  if (!c) return <div className="skeleton" />;
  return (
    <>
      <Link className="back-link" to="/campaigns">
        <ArrowLeft size={14} />
        All campaigns
      </Link>
      <PageTitle
        eyebrow={`${c.data.type.toUpperCase()} CAMPAIGN`}
        title={c.data.name}
        subtitle={`${c.data.company_name} · ${c.data.languages.join(', ')} · ${c.data.schedule.start}–${c.data.schedule.end} IST`}
        action={
          <div className="inline">
            <Badge>{c.data.status}</Badge>
            <Button onClick={() => setTest(true)}>
              <Mic size={16} />
              Browser test call
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                void mutate(
                  `/campaigns/${id}/${c.data.status === 'running' ? 'pause' : c.data.status === 'draft' ? 'launch' : 'resume'}`,
                ).catch(() => {});
              }}
            >
              {c.data.status === 'running' ? <Pause size={15} /> : <Play size={15} />}
              {c.data.status === 'running'
                ? 'Pause'
                : c.data.status === 'draft'
                  ? 'Launch'
                  : 'Resume'}
            </Button>
            <Button
              onClick={() => {
                void mutate(`/campaigns/${id}/stop`).catch(() => {});
              }}
            >
              <Square size={14} />
              Stop
            </Button>
          </div>
        }
      />
      {c.data.sample && (
        <div className="banner sample">Sample data · Synthetic contacts and results</div>
      )}
      <div className="tabs">
        {['Contacts', 'Live monitor', 'Results', 'Configuration'].map((t) => (
          <button className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Contacts' && (
        <div className="card">
          <div className="section-title">
            <h2>Campaign contacts</h2>
            <Button onClick={() => setImporting(!importing)}>
              <Plus size={15} />
              Import contacts
            </Button>
          </div>
          {importing && (
            <div className="padded">
              <ContactsImport contacts={rows} onChange={setRows} />
              <Button
                kind="primary"
                disabled={!rows.length}
                onClick={() => {
                  void mutate(`/campaigns/${id}/contacts`, 'POST', rows)
                    .then((report) => {
                      notify(JSON.stringify(report));
                      setImporting(false);
                    })
                    .catch(() => {});
                }}
              >
                Save validated contacts
              </Button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Details</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts?.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.data.first_name || r.data.candidate_name || 'Unnamed contact'}
                      {r.data.sample && <small>Sample data</small>}
                    </td>
                    <td>{r.data.phone.replace(/\d(?=\d{4})/g, '•')}</td>
                    <td>
                      <Badge>{nice(r.data.status)}</Badge>
                    </td>
                    <td>{r.data.blocked_reason ?? '—'}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label="Delete contact and calls"
                        onClick={() => {
                          void mutate(`/contacts/${r.id}`, 'DELETE').catch(() => {});
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!contacts?.length && (
              <Empty title="No contacts added">
                <p>Import a CSV or add a contact to start.</p>
              </Empty>
            )}
          </div>
        </div>
      )}
      {tab === 'Live monitor' && <Monitor />}
      {tab === 'Results' && <Results type={c.data.type} campaignId={id} />}
      {tab === 'Configuration' && (
        <div className="card padded">
          <h2>Campaign configuration</h2>
          <Link className="button" to={`/campaigns/${id}/edit`}>
            Edit campaign configuration
            <ArrowRight size={15} />
          </Link>
          <p className="muted">
            Agent version and configuration are snapshotted into each result. Pause before making
            changes through the API.
          </p>
          <pre>{JSON.stringify(c.data, null, 2)}</pre>
          <Button
            kind="danger"
            onClick={() => {
              if (
                window.confirm(
                  'Delete this campaign, contacts, calls and results? This cannot be undone.',
                )
              )
                void mutate(`/campaigns/${id}`, 'DELETE')
                  .then(() => location.assign('/campaigns'))
                  .catch(() => {});
            }}
          >
            <Trash2 size={16} />
            Delete campaign data
          </Button>
        </div>
      )}
      {test && <BrowserTest id={id!} close={() => setTest(false)} />}
    </>
  );
}
function Monitor({ callId }: { callId?: string }) {
  const [events, setEvents] = useState<{ type: string; data: unknown; call_id?: string }[]>([]),
    [selected, setSelected] = useState(callId ?? '');
  useEffect(() => {
    const ws = new WebSocket(wsUrl('/ws/monitor'));
    ws.onmessage = (e) => {
      const item = JSON.parse(e.data);
      setEvents((old) => [...old.slice(-300), item]);
    };
    return () => ws.close();
  }, []);
  useEffect(() => {
    if (callId) setSelected(callId);
  }, [callId]);
  const ids = [...new Set(events.map((e) => e.call_id).filter((s): s is string => Boolean(s)))],
    filtered = events.filter((e) => !selected || e.call_id === selected);
  const stage = filtered.filter((e) => e.type === 'stage').at(-1)?.data as string | undefined,
    turns = filtered.filter((e) => e.type === 'transcript').map((e) => e.data as Turn),
    latency = filtered.filter((e) => e.type === 'latency').at(-1)?.data as
      | { end_of_speech_to_audio_ms?: number }
      | undefined;
  return (
    <div className="card monitor">
      <div className="section-title">
        <div>
          <h2>
            <span className="status-dot" />
            Live monitor
          </h2>
          <p>Events from active calls in your workspace.</p>
        </div>
        <select
          aria-label="Select active call"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">All active calls</option>
          {ids.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </div>
      <div className="monitor-state">
        <Badge>{stage ? nice(stage) : 'Waiting for conversation'}</Badge>
        <span>
          <Activity size={14} />
          {latency?.end_of_speech_to_audio_ms !== undefined
            ? `${latency.end_of_speech_to_audio_ms} ms to first audio`
            : 'No latency measurement yet'}
        </span>
      </div>
      <div className="monitor-grid">
        <div className="transcript">
          {!turns.length ? (
            <Empty title="Listening for the first hello">
              <p>Start a browser test or launch a campaign to see events.</p>
            </Empty>
          ) : (
            turns.map((t, i) => (
              <div className={`turn ${t.role}`} key={i}>
                <small>
                  {t.role === 'agent' ? 'AI ASSISTANT' : 'CALLER'} ·{' '}
                  {new Date(t.at).toLocaleTimeString()}
                </small>
                <p>{t.text}</p>
              </div>
            ))
          )}
        </div>
        <div className="event-log">
          <h3>Fields & tools</h3>
          {filtered
            .filter((e) => ['fields', 'tool', 'provider', 'error', 'barge_in'].includes(e.type))
            .map((e, i) => (
              <div key={i}>
                <Badge tone={e.type === 'error' ? 'danger' : 'quiet'}>{nice(e.type)}</Badge>
                <pre>{JSON.stringify(e.data, null, 2)}</pre>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
function useDialogFocus(close: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, a[href]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, []);
  return ref;
}
function BrowserTest({ id, close }: { id: string; close: () => void }) {
  const dialogRef = useDialogFocus(close);
  const { data: providers } = useData<Providers>('providers');
  const audio = useRef<BrowserAudio>();
  const [status, setStatus] = useState('Ready when you are.'),
    [callId, setCallId] = useState(''),
    [started, setStarted] = useState(false),
    [text, setText] = useState('');
  useEffect(() => () => audio.current?.end(), []);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Browser test call"
      >
        <div className="section-title">
          <div>
            <Badge tone={providers?.simulation ? 'warn' : 'success'}>
              {providers?.simulation ? 'SIMULATION · SILENT MOCK SPEECH' : 'BROWSER TEST CALL'}
            </Badge>
            <h2>Meet your agent.</h2>
            <p>
              {providers?.simulation
                ? 'Scripted text test. This is not a live Gnani call.'
                : 'Real microphone → Prisma → dialogue model → Timbre. No Twilio needed.'}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close browser test"
            onClick={() => {
              audio.current?.end();
              close();
            }}
          >
            <X />
          </button>
        </div>
        <div className="browser-controls">
          <span>
            <Headphones size={18} />
            {status}
          </span>
          {!started ? (
            <Button
              kind="primary"
              disabled={!providers}
              onClick={() => {
                setStarted(true);
                audio.current = new BrowserAudio(setStatus, setCallId);
                void audio.current.start(id, providers!.simulation).catch((e) => {
                  setStatus(e.message);
                  setStarted(false);
                  audio.current?.end();
                });
              }}
            >
              <Mic size={16} />
              Start {providers?.simulation ? 'simulation' : 'browser test call'}
            </Button>
          ) : (
            <Button
              kind="danger"
              onClick={() => {
                audio.current?.end();
                setStarted(false);
              }}
            >
              <Square size={15} />
              End call
            </Button>
          )}
        </div>
        <Monitor callId={callId} />
        {providers?.simulation && started && (
          <form
            className="inline simulation-input"
            onSubmit={(e) => {
              e.preventDefault();
              audio.current?.text(text);
              setText('');
            }}
          >
            <input
              aria-label="Simulated caller response"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a synthetic caller response…"
            />
            <Button kind="primary">
              Send
              <ArrowRight size={14} />
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
function Results({ type, campaignId }: { type: 'sales' | 'hr'; campaignId?: string }) {
  const { data: results } = useData<Row<CallResult>[]>('results'),
    { data: campaigns } = useData<CampaignRow[]>('campaigns');
  const [filter, setFilter] = useState(''),
    [detail, setDetail] = useState<Row<CallResult>>();
  const rows = (results ?? []).filter(
    (r) =>
      campaigns?.find((c) => c.id === r.data.campaign_id)?.data.type === type &&
      (!campaignId || r.data.campaign_id === campaignId) &&
      (!filter || r.data.outcome === filter),
  );
  return (
    <>
      {!campaignId && (
        <PageTitle
          eyebrow={type === 'hr' ? 'CANDIDATES' : 'LEADS'}
          title={type === 'hr' ? 'Potential, with perspective.' : 'Interest worth following up.'}
          subtitle={
            type === 'hr'
              ? 'Job-related screening summaries. Advisory only; humans make hiring decisions.'
              : 'Call outcomes and follow-up consent, together.'
          }
          action={
            <a className="button" href="/api/v1/results/export">
              <ArrowDownToLine size={16} />
              Export CSV
            </a>
          }
        />
      )}
      <div className="card">
        <div className="table-toolbar">
          <h2>{rows.length} results</h2>
          <select
            aria-label="Filter outcomes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All outcomes</option>
            {[...new Set((results ?? []).map((r) => r.data.outcome))].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {campaignId && (
            <a className="button" href={`/api/v1/results/export?campaign_id=${campaignId}`}>
              <ArrowDownToLine size={15} />
              Export
            </a>
          )}
        </div>
        {!rows.length ? (
          <Empty title="The next step will show up here">
            <p>Complete a browser test or a campaign call to see a saved result.</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Conversation</th>
                  <th>Outcome</th>
                  <th>{type === 'hr' ? 'Eligibility' : 'Follow-up'}</th>
                  <th>Language</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setDetail(r)}>
                    <td>
                      <button className="text-button" onClick={() => setDetail(r)}>
                        {campaigns?.find((c) => c.id === r.data.campaign_id)?.data.name ??
                          'Campaign result'}
                      </button>
                      <small>
                        {new Date(r.created_at).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })}
                      </small>
                    </td>
                    <td>
                      <Badge
                        tone={
                          r.data.outcome.includes('INTERESTED') ||
                          r.data.outcome === 'CANDIDATE_COMPLETED'
                            ? 'success'
                            : 'quiet'
                        }
                      >
                        {nice(r.data.outcome)}
                      </Badge>
                    </td>
                    <td>
                      {type === 'hr'
                        ? nice(r.data.eligibility?.value ?? 'UNCLEAR')
                        : r.data.extracted_fields.consent_to_follow_up === true
                          ? 'Consent recorded'
                          : 'No consent'}
                    </td>
                    <td>{r.data.languages.join(', ') || '—'}</td>
                    <td>
                      <Badge tone={r.data.simulation || r.data.sample ? 'warn' : 'success'}>
                        {r.data.simulation
                          ? 'Simulation'
                          : r.data.sample
                            ? 'Sample data'
                            : 'Live run'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {detail && <ResultDrawer row={detail} close={() => setDetail(undefined)} />}
    </>
  );
}
function ResultDrawer({ row, close }: { row: Row<CallResult>; close: () => void }) {
  const dialogRef = useDialogFocus(close);
  const r = row.data;
  const { data: deliveries } = useData<DeliveryRow[]>('deliveries');
  return (
    <div className="drawer-backdrop">
      <section
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Call result"
      >
        <div className="section-title">
          <h2>Conversation detail</h2>
          <button className="icon-button" aria-label="Close result" onClick={close}>
            <X />
          </button>
        </div>
        <Badge>{nice(r.outcome)}</Badge>
        {r.simulation && <Badge tone="warn">Simulation</Badge>}
        <h3>Summary</h3>
        <p className="prewrap">{r.summary}</p>
        {r.eligibility && (
          <>
            <h3>Advisory eligibility</h3>
            <Badge>{nice(r.eligibility.value)}</Badge>
            <ul>
              {r.eligibility.reasons.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p>{r.recommendation}</p>
          </>
        )}
        <h3>Captured fields</h3>
        <pre>{JSON.stringify(r.extracted_fields, null, 2)}</pre>
        <h3>Transcript</h3>
        {r.transcript.map((t, i) => (
          <div className={`turn ${t.role}`} key={i}>
            <small>{t.role}</small>
            <p>{t.text}</p>
          </div>
        ))}
        <h3>Measured turn latency</h3>
        <pre>{JSON.stringify(r.latency, null, 2)}</pre>
        <h3>Providers & usage</h3>
        <pre>
          {JSON.stringify(
            { providers: r.provider_trace, usage: r.usage, agent_version: r.agent_version },
            null,
            2,
          )}
        </pre>
        <h3>Submissions</h3>
        <p>Internal database: saved</p>
        {deliveries
          ?.filter((d) => d.data.result_id === row.id)
          .map((d) => (
            <div className="delivery" key={d.id}>
              <Badge>{nice(d.data.status)}</Badge>
              <span>{d.data.attempts} attempts</span>
              {d.data.error && <p>{d.data.error}</p>}
              {d.data.status !== 'delivered' && (
                <Button
                  onClick={() => {
                    void mutate(`/deliveries/${d.id}/retry`).catch(() => {});
                  }}
                >
                  Retry
                </Button>
              )}
            </div>
          ))}
      </section>
    </div>
  );
}
function AnalyticsPage() {
  const { data } = useData<Analytics>('analytics');
  const [sample, setSample] = useState(false);
  const s = sample ? data?.sample : data?.real;
  const bars = (map: Record<string, number> | undefined) =>
    Object.entries(map ?? {}).map(([k, n]) => (
      <div className="bar-row" key={k}>
        <span>{nice(k)}</span>
        <div>
          <i style={{ width: `${(n / Math.max(1, ...Object.values(map!))) * 100}%` }} />
        </div>
        <b>{n}</b>
      </div>
    ));
  return (
    <>
      <PageTitle
        eyebrow="ANALYTICS"
        title="Understand every outcome."
        subtitle="Measured activity from stored results. Sample data stays separate."
      />
      <label className="inline">
        <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
        Show only sample and simulated results
      </label>
      <div className="kpi-grid lower">
        {[
          ['Call results', s?.calls ?? '—'],
          [
            'Average duration',
            s?.avg_duration_s == null ? '—' : `${Math.round(s.avg_duration_s)}s`,
          ],
          ['Latency p50', s?.p50_ms == null ? '—' : `${s.p50_ms}ms`],
          ['Latency p95', s?.p95_ms == null ? '—' : `${s.p95_ms}ms`],
        ].map(([k, v]) => (
          <div className="card kpi" key={k}>
            <div>{k}</div>
            <strong>{v}</strong>
            <small>{sample ? 'Sample / simulated records' : 'Real runs only'}</small>
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <section className="card padded">
          <h2>Outcomes</h2>
          {s?.calls ? bars(s.outcomes) : <Empty title="No measured outcomes yet" />}
        </section>
        <section className="card padded">
          <h2>Language distribution</h2>
          {s?.calls ? bars(s.languages) : <Empty title="No language data yet" />}
        </section>
        <section className="card padded">
          <h2>Calls over time · IST</h2>
          {bars(s?.days)}
        </section>
        <section className="card padded">
          <h2>Cost estimates</h2>
          <p>—</p>
          <p className="muted">
            No rate table configured. Provider bills are authoritative. No billed-cost estimate is
            claimed.
          </p>
          <Link to="/settings">
            Manage settings
            <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </>
  );
}
function SettingsPage() {
  const { data: providers } = useData<Providers>('providers'),
    { data: suppression } = useData<Row<{ phone: string }>[]>('suppression'),
    { data: destinations } = useData<Row<{ name: string; url: string }>[]>('destinations'),
    { data: deliveries } = useData<DeliveryRow[]>('deliveries'),
    { data: team } = useData<{ id: string; email: string; data: { role: string } }[]>('team');
  const { data: settings } = useData<{
    retention_days: number;
    kill_switch: boolean;
    global_daily_minutes: number;
    rates: Record<string, number>;
  }>('settings');
  const [rates, setRates] = useState<Record<string, number>>({}),
    [cap, setCap] = useState<number>();
  const [phone, setPhone] = useState(''),
    [destName, setDestName] = useState(''),
    [url, setUrl] = useState(''),
    [retention, setRetention] = useState<number>();
  return (
    <>
      <PageTitle
        eyebrow="SETTINGS"
        title="Your workspace, your boundaries."
        subtitle="Manage providers, destinations, privacy, and calling controls."
      />
      <div className="settings-grid">
        <section className="card padded">
          <h2>Providers</h2>
          <p className="muted">Keys are configured in server environment variables.</p>
          {providers?.services.map((s) => (
            <div className="health-row" key={s.name}>
              <span>{s.name}</span>
              <Badge tone={s.status.includes('missing') ? 'warn' : 'quiet'}>{s.status}</Badge>
            </div>
          ))}
          <p>
            <DialogueLabel />
          </p>
        </section>
        <section className="card padded">
          <h2>Safety & retention</h2>
          <Field label="Global daily call minutes">
            <input
              type="number"
              min="1"
              value={cap ?? settings?.global_daily_minutes ?? 200}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </Field>
          <Field label="Transcript retention (days)">
            <input
              type="number"
              min="1"
              max="365"
              value={retention ?? settings?.retention_days ?? 30}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </Field>
          <Button
            onClick={() => {
              if (settings)
                void mutate('/settings', 'PUT', {
                  ...settings,
                  global_daily_minutes: cap ?? settings.global_daily_minutes,
                  retention_days: retention ?? settings.retention_days,
                })
                  .then(() => notify('Retention updated.'))
                  .catch(() => {});
            }}
          >
            Save limits & retention
          </Button>
          <div className="divider" />
          <h3>INR estimate rates</h3>
          <p className="muted">
            Enter your provider rates. These produce estimates, never billed amounts.
          </p>
          {[
            'stt_per_minute',
            'tts_per_1000_chars',
            'llm_per_1000_tokens',
            'telephony_per_minute',
          ].map((key) => (
            <Field key={key} label={nice(key)}>
              <input
                type="number"
                min="0"
                step="0.0001"
                placeholder="Not configured"
                value={rates[key] ?? settings?.rates?.[key] ?? ''}
                onChange={(e) => setRates((old) => ({ ...old, [key]: Number(e.target.value) }))}
              />
            </Field>
          ))}
          <Button
            onClick={() => {
              if (settings)
                void mutate('/settings', 'PUT', {
                  ...settings,
                  rates: { ...settings.rates, ...rates },
                })
                  .then(() => notify('Estimate rates saved.'))
                  .catch(() => {});
            }}
          >
            Save rate table
          </Button>
          <div className="divider" />
          <h3>Global kill switch</h3>
          <p className="muted">
            Stops new dialing across every campaign. Active calls finish normally.
          </p>
          <Button
            kind={settings?.kill_switch ? 'primary' : 'danger'}
            onClick={() => {
              if (settings)
                void mutate('/settings', 'PUT', {
                  ...settings,
                  kill_switch: !settings.kill_switch,
                }).catch(() => {});
            }}
          >
            {settings?.kill_switch ? <Play size={15} /> : <Pause size={15} />}
            {settings?.kill_switch ? 'Allow dialing' : 'Pause all dialing'}
          </Button>
        </section>
        <section className="card padded">
          <h2>Suppression list</h2>
          <p className="muted">
            Suppressed numbers are blocked before every dial, including retries.
          </p>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('/suppression', 'POST', { phone })
                .then(() => setPhone(''))
                .catch(() => {});
            }}
          >
            <input
              aria-label="Suppress phone number"
              placeholder="E.164 number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Button>Add</Button>
          </form>
          {suppression?.map((s) => (
            <div className="health-row" key={s.id}>
              <span>{s.data.phone.replace(/\d(?=\d{4})/g, '•')}</span>
              <button
                className="icon-button"
                aria-label="Remove suppression"
                onClick={() => {
                  void mutate(`/suppression/${s.id}`, 'DELETE').catch(() => {});
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </section>
        <section className="card padded">
          <h2>Webhook destinations</h2>
          <p className="muted">
            HTTPS only. HMAC signed, with idempotency keys and durable retries.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('/destinations', 'POST', {
                name: destName,
                url,
                kind: 'webhook',
                enabled: true,
              })
                .then(() => {
                  setDestName('');
                  setUrl('');
                })
                .catch(() => {});
            }}
          >
            <Field label="Destination name">
              <input required value={destName} onChange={(e) => setDestName(e.target.value)} />
            </Field>
            <Field label="Public HTTPS URL">
              <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Button>
              <Plus size={15} />
              Add destination
            </Button>
          </form>
          {destinations?.map((d) => (
            <div className="delivery" key={d.id}>
              <b>{d.data.name}</b>
              <small>{d.data.url}</small>
              <Button
                onClick={() => {
                  void mutate(`/destinations/${d.id}/test`)
                    .then(() => notify('Synthetic test delivered.'))
                    .catch(() => {});
                }}
              >
                Test send
              </Button>
              <button
                className="icon-button"
                aria-label="Delete destination"
                onClick={() => {
                  void mutate(`/destinations/${d.id}`, 'DELETE').catch(() => {});
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </section>
        <section className="card padded">
          <h2>Delivery log & dead letters</h2>
          {!deliveries?.length && <p className="muted">No external deliveries attempted yet.</p>}
          {deliveries?.map((d) => (
            <div className="delivery" key={d.id}>
              <Badge tone={d.data.status === 'dead_letter' ? 'danger' : 'quiet'}>
                {nice(d.data.status)}
              </Badge>
              <span>{d.data.attempts} attempts</span>
              {d.data.status !== 'delivered' && (
                <Button
                  onClick={() => {
                    void mutate(`/deliveries/${d.id}/retry`).catch(() => {});
                  }}
                >
                  Retry
                </Button>
              )}
            </div>
          ))}
        </section>
        <section className="card padded">
          <h2>Team</h2>
          <p className="muted">Admin can manage campaigns. Viewer has read-only access.</p>
          {team?.map((u) => (
            <div className="health-row" key={u.id}>
              <span>{u.email}</span>
              <Badge>{u.data.role}</Badge>
            </div>
          ))}
          <small>
            Provision additional users through your administrator. No public registration.
          </small>
        </section>
      </div>
    </>
  );
}
function Compliance() {
  return (
    <>
      <PageTitle
        eyebrow="COMPLIANCE & PRIVACY"
        title="Clear intentions. Respectful conversations."
        subtitle="Built-in controls help your operators act responsibly. They do not replace legal obligations."
      />
      <div className="compliance-grid">
        {[
          {
            Icon: ShieldCheck,
            title: 'Always an AI introduction',
            text: 'The first turn identifies the assistant as AI and names the company. Disclosure cannot be disabled. Questions about being human are answered truthfully.',
          },
          {
            Icon: FileText,
            title: 'Facts have boundaries',
            text: 'Agents use approved campaign facts, prices, job information and answers. Missing information is referred to your team. Review live runs; prompt safeguards are not a proof of zero hallucinations.',
          },
          {
            Icon: Phone,
            title: 'Every dial has a gate',
            text: 'Attestation, valid E.164 numbers, suppression, test allowlists, calling hours, attempts and caps are checked before every dial. The outer window is 09:00–21:00 IST; campaigns can narrow it.',
          },
          {
            Icon: Users,
            title: 'People decide hiring outcomes',
            text: 'Screening uses explicit job-related questions and deterministic criteria. Sensitive utterances are conservatively filtered before storage. Eligibility and recommendations are advisory; humans decide.',
          },
          {
            Icon: Trash2,
            title: 'Keep only what you need',
            text: 'Raw audio recording is disabled. Redacted transcripts, fields, call metadata and delivery logs are stored in Postgres. Default retention is 30 days. Admins can export results and delete contacts, calls or campaigns.',
          },
          {
            Icon: CheckCircle2,
            title: 'Operator obligations',
            text: 'You must obtain consent, meet applicable DLT/NCPR/TRAI registration and telemarketing requirements, and scrub the national DND registry where required. This application does not perform national registry scrubbing. Use synthetic or consented data; test calls only to teammates’ phones.',
          },
        ].map(({ Icon, title, text }) => (
          <section className="card padded" key={title}>
            <span className="icon-well">
              <Icon size={24} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={query}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
