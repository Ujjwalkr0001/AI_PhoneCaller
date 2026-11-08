import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { useApp } from '../App.js';
import {
  useData,
  type CampaignRow,
  type ContactRow,
  type ResultRow,
  type CallRow,
} from '../data.js';
import { languageNames, copy } from '../strings.js';
import { workflowLabel } from '../workflows.js';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  OutcomeBar,
  Skeleton,
  StatusBadge,
} from '../ui/index.js';
export function outcomeValues(rows: ResultRow[]) {
  return [
    {
      label: 'Interested / screened',
      count: rows.filter((r) =>
        ['INTERESTED_HOT', 'INTERESTED_WARM', 'CANDIDATE_COMPLETED'].includes(r.data.outcome),
      ).length,
      tone: 'positive',
    },
    {
      label: 'Call back',
      count: rows.filter((r) => r.data.outcome === 'CALLBACK').length,
      tone: 'amber',
    },
    {
      label: 'Not interested',
      count: rows.filter((r) =>
        ['NOT_INTERESTED', 'CANDIDATE_DECLINED', 'DO_NOT_CALL'].includes(r.data.outcome),
      ).length,
      tone: 'neutral',
    },
    {
      label: 'Other outcomes',
      count: rows.filter((r) =>
        ['NO_ANSWER', 'INCOMPLETE', 'VOICEMAIL', 'WRONG_NUMBER', 'FAILED'].includes(r.data.outcome),
      ).length,
      tone: 'muted',
    },
  ];
}
export default function Campaigns() {
  const c = useData<CampaignRow[]>('/campaigns'),
    contacts = useData<ContactRow[]>('/contacts'),
    results = useData<ResultRow[]>('/results'),
    calls = useData<CallRow[]>('/calls'),
    [search, setSearch] = useState('');
  const { user } = useApp();
  if (c.isPending || contacts.isPending || results.isPending || calls.isPending)
    return <Skeleton />;
  if (contacts.isError || results.isError || calls.isError)
    return (
      <ErrorState
        message="We couldn’t load the campaign totals."
        retry={() => {
          void contacts.refetch();
          void results.refetch();
          void calls.refetch();
        }}
      />
    );
  if (c.isError)
    return <ErrorState message="We couldn’t load your campaigns." retry={() => void c.refetch()} />;
  const rows = c.data.filter((r) =>
    `${r.data.name} ${r.data.company_name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const real = (results.data ?? []).filter((r) => !r.data.sample && !r.data.simulation);
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Campaigns</span>
          <h1>{copy.campaigns}</h1>
          <p>{copy.campaignsIntro}</p>
        </div>
        {c.data.length > 0 && (
          <div className="search">
            <Search size={16} />
            <Input
              aria-label="Search campaigns"
              placeholder="Find a campaign"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>
      {c.data.length === 0 ? (
        <Card>
          <EmptyState
            title="Your first conversation starts here."
            description={
              user.role === 'admin'
                ? 'Choose Sales or HR. Add a few details and you’re ready to test.'
                : 'Ask an administrator to create your first campaign.'
            }
            action={
              user.role === 'admin' ? (
                <Link className="btn btn-primary" to="/campaigns/new">
                  <Plus size={16} />
                  Create your first campaign
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="stats" aria-label="Workspace totals">
            <div className="stat">
              <small>Calls today</small>
              <strong>
                {
                  real.filter(
                    (r) =>
                      new Date(r.created_at).toLocaleDateString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                      }) === today,
                  ).length
                }
              </strong>
            </div>
            <div className="stat">
              <small>Interested / screened</small>
              <strong>
                {real.filter((r) => /INTERESTED|CANDIDATE_COMPLETED/.test(r.data.outcome)).length}
              </strong>
            </div>
            <div className="stat">
              <small>Active campaigns</small>
              <strong>
                {c.data.filter((r) => r.data.status === 'running' && !r.data.sample).length}
              </strong>
            </div>
          </div>
          <p className="helper" style={{ marginBottom: 20 }}>
            Sample and simulated results are excluded from these totals.
          </p>
          <div className="campaign-grid">
            {rows.map((row) => {
              const own = (contacts.data ?? []).filter((t) => t.data.campaign_id === row.id),
                ownResults = (results.data ?? []).filter((r) => r.data.campaign_id === row.id),
                called = new Set(
                  (calls.data ?? [])
                    .filter((call) => call.data.campaign_id === row.id && call.data.contact_id)
                    .map((c) => c.data.contact_id),
                ).size;
              return (
                <Link to={`/campaigns/${row.id}`} key={row.id} className="card campaign-card">
                  <div>
                    <div className="row between">
                      <div className="chips">
                        <Chip>{workflowLabel(row.data)}</Chip>
                        {row.data.sample && <Chip>Sample</Chip>}
                      </div>
                      <StatusBadge status={row.data.status} />
                    </div>
                    <h2>{row.data.name}</h2>
                    <p>{row.data.company_name}</p>
                  </div>
                  <div>
                    <div className="progress-heading">
                      <span>
                        {called} of {own.length}{' '}
                        {row.data.type === 'hr' ? 'candidates' : 'contacts'} called
                      </span>
                      <span>{own.length ? Math.round((called / own.length) * 100) : 0}%</span>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${own.length ? Math.min(100, (called / own.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <OutcomeBar values={outcomeValues(ownResults)} />
                  <div className="card-footer">
                    <span>
                      {row.data.languages.map((l) => languageNames[l]).join(' + ')} ·{' '}
                      {row.data.schedule.start}–{row.data.schedule.end} IST
                    </span>
                    <ArrowRight size={16} />
                  </div>
                </Link>
              );
            })}
          </div>
          {!rows.length && (
            <EmptyState
              title="No matching campaigns."
              description="Try another name or clear your search."
            />
          )}
        </>
      )}
    </>
  );
}
