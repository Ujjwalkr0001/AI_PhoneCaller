import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, MoreHorizontal, Pause, Play, Square } from 'lucide-react';
import { useApp } from '../App.js';
import {
  change,
  maskPhone,
  useData,
  type CampaignRow,
  type ContactRow,
  type ResultRow,
  type CallRow,
} from '../data.js';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  EmptyState,
  ErrorState,
  OutcomeBar,
  Skeleton,
  StatusBadge,
} from '../ui/index.js';
import { BrowserTest, ConversationDrawer, useLive } from '../components/Conversation.js';
import { ConversationList } from './Conversations.js';
import { outcomeValues } from './Campaigns.js';
import { languageNames, stageNames } from '../strings.js';
import { workflowLabel } from '../workflows.js';
export default function CampaignPage() {
  const { id } = useParams(),
    navigate = useNavigate(),
    { notify, user } = useApp(),
    campaign = useData<CampaignRow>(`/campaigns/${id}`),
    contacts = useData<ContactRow[]>('/contacts'),
    results = useData<ResultRow[]>('/results'),
    calls = useData<CallRow[]>('/calls'),
    live = useLive(),
    [tab, setTab] = useState('people'),
    [test, setTest] = useState(false),
    [selected, setSelected] = useState<ResultRow>(),
    [watch, setWatch] = useState<string>();
  if (campaign.isPending) return <Skeleton />;
  if (contacts.isPending || results.isPending || calls.isPending) return <Skeleton />;
  if (contacts.isError || results.isError || calls.isError)
    return (
      <ErrorState
        message="We couldn’t load the campaign activity."
        retry={() => {
          void contacts.refetch();
          void results.refetch();
          void calls.refetch();
        }}
      />
    );
  if (campaign.isError || !campaign.data)
    return (
      <ErrorState message="We couldn’t load this campaign." retry={() => void campaign.refetch()} />
    );
  const c = campaign.data,
    people = (contacts.data ?? []).filter((r) => r.data.campaign_id === id),
    ownResults = (results.data ?? []).filter((r) => r.data.campaign_id === id),
    ownCalls = (calls.data ?? []).filter((r) => r.data.campaign_id === id),
    called = new Set(ownCalls.filter((r) => r.data.contact_id).map((r) => r.data.contact_id)).size,
    active = ownCalls.filter((r) => ['reserved', 'ringing', 'in-progress'].includes(r.data.status));
  const act = (action: string) => {
    void change(`/campaigns/${id}/${action}`)
      .then(() =>
        notify(
          action === 'pause'
            ? 'Campaign paused.'
            : action === 'stop'
              ? 'Campaign stopped.'
              : 'Campaign resumed.',
        ),
      )
      .catch((e) => notify(e.message));
  };
  return (
    <>
      <Link className="row helper" to="/campaigns" style={{ marginBottom: 24 }}>
        <ArrowLeft size={14} />
        All campaigns
      </Link>
      <div className="page-heading">
        <div>
          <div className="row" style={{ marginBottom: 16 }}>
            <Chip>{workflowLabel(c.data)}</Chip>
            <StatusBadge status={c.data.status} />
            {c.data.sample && <Chip>Sample</Chip>}
          </div>
          <h1 className="small-title">{c.data.name}</h1>
          <p>
            {c.data.company_name} · {c.data.languages.map((l) => languageNames[l]).join(' + ')}
          </p>
        </div>
        {user.role === 'admin' && (
          <div className="row">
            <Button onClick={() => setTest(true)}>Test in browser</Button>
            {c.data.status === 'running' ? (
              <Button onClick={() => act('pause')}>
                <Pause size={16} />
                Pause
              </Button>
            ) : (
              <Button onClick={() => act(c.data.status === 'draft' ? 'launch' : 'resume')}>
                <Play size={16} />
                {c.data.status === 'draft' ? 'Launch' : 'Resume'}
              </Button>
            )}
            <details className="overflow-menu">
              <summary aria-label="Campaign actions">
                <MoreHorizontal size={20} />
              </summary>
              <div className="overflow-content">
                <Button
                  kind="ghost"
                  onClick={() => {
                    if (confirm('Stop new calls for this campaign? Active calls can finish.'))
                      act('stop');
                  }}
                >
                  <Square size={15} />
                  Stop campaign
                </Button>
              </div>
            </details>
          </div>
        )}
      </div>
      <Card className="pad">
        <div className="row between">
          <div>
            <h2>
              {called} of {people.length} {c.data.type === 'hr' ? 'candidates' : 'contacts'} called
            </h2>
            <p className="helper" style={{ marginTop: 4 }}>
              {c.data.schedule.start}–{c.data.schedule.end} IST ·{' '}
              {c.data.compliance.test_mode ? 'Test numbers only' : 'Operator-attested contacts'}
            </p>
          </div>
          <span className="helper">
            {people.length ? Math.round((called / people.length) * 100) : 0}%
          </span>
        </div>
        <div className="progress-track" style={{ margin: '24px 0' }}>
          <span
            style={{
              width: `${people.length ? Math.min(100, (called / people.length) * 100) : 0}%`,
            }}
          />
        </div>
        <OutcomeBar values={outcomeValues(ownResults)} />
      </Card>
      {active.map((call) => {
        const person = people.find((p) => p.id === call.data.contact_id),
          stage = live.events.filter((e) => e.call_id === call.id && e.type === 'stage').at(-1)
            ?.data as string | undefined;
        return (
          <div className="live-strip" key={call.id}>
            <span className="row">
              <span className="dot" />
              {person?.data.first_name || 'Browser test call'} ·{' '}
              {stageNames[stage ?? ''] ?? 'Connecting'}
            </span>
            <Button kind="ghost" onClick={() => setWatch(call.id)}>
              Watch
              <ArrowRightIcon />
            </Button>
          </div>
        );
      })}
      <div className="tabs" role="tablist" aria-label="Campaign sections">
        {[
          { key: 'people', label: c.data.type === 'hr' ? 'Candidates' : 'Leads' },
          { key: 'calls', label: 'Calls' },
          { key: 'settings', label: 'Settings' },
        ].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t.key}
            key={t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        aria-label={
          tab === 'people'
            ? c.data.type === 'hr'
              ? 'Candidates'
              : 'Leads'
            : tab === 'calls'
              ? 'Calls'
              : 'Settings'
        }
      >
        {tab === 'people' && (
          <PeopleTable campaign={c} contacts={people} results={ownResults} onSelect={setSelected} />
        )}
        {tab === 'calls' && <ConversationList campaignId={id} />}
        {tab === 'settings' && (
          <Card className="pad">
            <div className="row between">
              <div>
                <h2>Campaign settings</h2>
                <p className="helper" style={{ marginTop: 8 }}>
                  Pause before editing. New settings apply to future calls.
                </p>
              </div>
              {user.role === 'admin' && (
                <Link className="btn btn-secondary" to={`/campaigns/${id}/edit`}>
                  Edit details
                </Link>
              )}
            </div>
            <dl className="label-values">
              <div>
                <dt>Voice & languages</dt>
                <dd>
                  {c.data.agent_persona.name} ·{' '}
                  {c.data.languages.map((l) => languageNames[l]).join(' + ')}
                </dd>
              </div>
              <div>
                <dt>Calling hours</dt>
                <dd>
                  {c.data.schedule.start}–{c.data.schedule.end} IST
                </dd>
              </div>
              <div>
                <dt>Contacts</dt>
                <dd>
                  {c.data.compliance.test_mode
                    ? 'Only allowlisted test numbers'
                    : 'Operator-attested numbers'}
                </dd>
              </div>
            </dl>
            <Disclosure title="Data & safety">
              <p className="text-small">
                Consent, calling hours, do-not-call checks and usage limits remain enforced before
                every dial. Recording is off.
              </p>
              {user.role === 'admin' && (
                <Button
                  kind="danger"
                  onClick={() => {
                    if (
                      confirm(
                        'Delete this campaign, contacts and call results? This cannot be undone.',
                      )
                    )
                      void change(`/campaigns/${id}`, 'DELETE')
                        .then(() => navigate('/campaigns'))
                        .catch((e) => notify(e.message));
                  }}
                >
                  Delete campaign data
                </Button>
              )}
            </Disclosure>
          </Card>
        )}
      </section>
      {test && <BrowserTest campaign={c} onClose={() => setTest(false)} />}
      {selected && <ConversationDrawer row={selected} onClose={() => setSelected(undefined)} />}
      {watch && <ConversationDrawer liveId={watch} onClose={() => setWatch(undefined)} />}
    </>
  );
}
function ArrowRightIcon() {
  return <span aria-hidden="true">↗</span>;
}
function PeopleTable({
  campaign,
  contacts,
  results,
  onSelect,
}: {
  campaign: CampaignRow;
  contacts: ContactRow[];
  results: ResultRow[];
  onSelect: (r: ResultRow) => void;
}) {
  const [filter, setFilter] = useState('all'),
    [search, setSearch] = useState('');
  const hr = campaign.data.type === 'hr',
    rows = contacts
      .filter((c) =>
        `${c.data.first_name} ${c.data.candidate_name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .filter(
        (c) =>
          filter === 'all' ||
          (filter === 'completed' && results.some((r) => r.data.contact_id === c.id)) ||
          (filter === 'waiting' && !results.some((r) => r.data.contact_id === c.id)),
      );
  return (
    <Card className="table-card">
      <div className="table-toolbar">
        <div className="chips" role="group" aria-label="Contact outcomes">
          {[
            { key: 'all', label: 'All' },
            { key: 'completed', label: 'Called' },
            { key: 'waiting', label: 'Waiting' },
          ].map((f) => (
            <button
              className="filter-chip"
              key={f.key}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <a className="btn btn-secondary" href={`/api/v1/results/export?campaign_id=${campaign.id}`}>
          <ArrowDownToLine size={15} />
          Export
        </a>
      </div>
      <div className="table-toolbar">
        <input
          className="input"
          aria-label="Search contacts"
          placeholder="Find a contact"
          style={{ maxWidth: 300 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!rows.length ? (
        <EmptyState
          title="No contacts to show."
          description="Add contacts through Edit details, or clear your filters."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name & phone</th>
                <th>{hr ? 'Match' : 'Interest'}</th>
                <th>{hr ? 'Notice period' : 'Key detail'}</th>
                <th>{hr ? 'Interview availability' : 'Next step'}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((contact) => {
                const r = results.find((r) => r.data.contact_id === contact.id);
                const fields = r?.data.extracted_fields ?? {};
                return (
                  <tr key={contact.id}>
                    <td>
                      {r ? (
                        <button className="text-button" onClick={() => onSelect(r)}>
                          {contact.data.first_name || contact.data.candidate_name || 'Contact'}
                        </button>
                      ) : (
                        <strong>
                          {contact.data.first_name || contact.data.candidate_name || 'Contact'}
                        </strong>
                      )}
                      <small>{maskPhone(contact.data.phone)}</small>
                      {contact.data.sample && <Chip>Sample</Chip>}
                    </td>
                    <td data-label={hr ? 'Match' : 'Interest'}>
                      {hr ? (
                        (
                          {
                            MEETS_ALL_MUST_HAVES: 'Meets all',
                            PARTIAL: 'Partial',
                            DOES_NOT_MEET: 'Not met',
                            UNCLEAR: 'Unclear',
                          } as Record<string, string>
                        )[r?.data.eligibility?.value ?? 'UNCLEAR']
                      ) : r ? (
                        <StatusBadge status={r.data.outcome} />
                      ) : (
                        'Not called'
                      )}
                    </td>
                    <td data-label={hr ? 'Notice period' : 'Key detail'}>
                      {String(fields[hr ? 'notice_period' : 'interest_details'] ?? '—')}
                    </td>
                    <td data-label={hr ? 'Interview availability' : 'Next step'}>
                      {String(
                        fields[hr ? 'interview_availability' : 'next_step'] ??
                          (r?.data.outcome === 'CALLBACK' ? 'Callback requested' : '—'),
                      )}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={contact.data.status} />
                      {contact.data.blocked_reason && (
                        <details>
                          <summary className="helper">Why?</summary>
                          <p className="helper">{contact.data.blocked_reason}</p>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
