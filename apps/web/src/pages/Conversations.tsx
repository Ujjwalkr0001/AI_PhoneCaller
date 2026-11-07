import { useState } from 'react';
import { Search, ArrowDownToLine } from 'lucide-react';
import {
  useData,
  dateLabel,
  getContact,
  maskPhone,
  type ContactRow,
  type CampaignRow,
  type ResultRow,
} from '../data.js';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  StatusBadge,
  Chip,
} from '../ui/index.js';
import { ConversationDrawer } from '../components/Conversation.js';

export function ConversationList({ campaignId }: { campaignId?: string }) {
  const rows = useData<ResultRow[]>('/results'),
    contacts = useData<ContactRow[]>('/contacts'),
    campaigns = useData<CampaignRow[]>('/campaigns'),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<ResultRow>();
  if (rows.isPending || contacts.isPending || campaigns.isPending) return <Skeleton lines={2} />;
  if (contacts.isError || campaigns.isError)
    return <ErrorState message="We couldn’t load contact details." retry={() => { void contacts.refetch(); void campaigns.refetch(); }} />;
  if (rows.isError)
    return (
      <ErrorState message="We couldn’t load conversations." retry={() => void rows.refetch()} />
    );
  const own = rows.data.filter((r) => !campaignId || r.data.campaign_id === campaignId),
    filters = [
      { key: 'all', label: 'All' },
      { key: 'interested', label: 'Interested' },
      { key: 'screened', label: 'Screened' },
      { key: 'callback', label: 'Call back' },
      { key: 'other', label: 'Other' },
    ];
  const visible = own
    .filter(
      (r) =>
        filter === 'all' ||
        (filter === 'interested' && /^INTERESTED_/.test(r.data.outcome)) ||
        (filter === 'screened' && r.data.outcome === 'CANDIDATE_COMPLETED') ||
        (filter === 'callback' && r.data.outcome === 'CALLBACK') ||
        (filter === 'other' && !/^(INTERESTED_HOT|INTERESTED_WARM|CANDIDATE_COMPLETED|CALLBACK)$/.test(r.data.outcome)),
    )
    .filter((r) => {
      const contact = getContact(r, contacts.data ?? []);
      return `${contact?.data.first_name ?? ''} ${contact?.data.candidate_name ?? ''} ${campaigns.data?.find((c) => c.id === r.data.campaign_id)?.data.name ?? ''} ${r.data.outcome}`
        .toLowerCase()
        .includes(search.toLowerCase());
    });
  return (
    <div className="stack">
      <div className="row between">
        <div className="chips" role="group" aria-label="Filter outcomes">
          {filters.map((f) => (
            <button
              className="filter-chip"
              aria-pressed={f.key === filter}
              key={f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <a
          className="btn btn-secondary"
          href={`/api/v1/results/export${campaignId ? `?campaign_id=${campaignId}` : ''}`}
        >
          <ArrowDownToLine size={16} />
          Export
        </a>
      </div>
      <Card className="table-card">
        <div className="table-toolbar">
          <div className="search">
            <Search size={16} />
            <Input
              aria-label="Search conversations"
              placeholder="Find a contact or campaign"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <small>{visible.length} conversations</small>
        </div>
        {!visible.length ? (
          <EmptyState
            title={own.length ? 'No matching conversations.' : 'The next step will appear here.'}
            description={
              own.length
                ? 'Try another filter or search.'
                : 'Test an agent or launch a campaign to see its saved outcomes.'
            }
            action={
              own.length ? (
                <Button
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Campaign</th>
                  <th>Outcome</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const contact = getContact(r, contacts.data ?? []);
                  return (
                    <tr key={r.id}>
                      <td>
                        <button className="text-button" onClick={() => setSelected(r)}>
                          {contact?.data.first_name ||
                            contact?.data.candidate_name ||
                            'Browser test call'}
                        </button>
                        <small>{maskPhone(contact?.data.phone)}</small>
                      </td>
                      <td data-label="Campaign">
                        {campaigns.data?.find((c) => c.id === r.data.campaign_id)?.data.name ??
                          'Campaign'}
                      </td>
                      <td data-label="Outcome">
                        <StatusBadge status={r.data.outcome} />
                        <div className="chips" style={{ marginTop: 8 }}>
                          {r.data.sample && <Chip>Sample</Chip>}
                          {r.data.simulation && <Chip>Simulation</Chip>}
                        </div>
                      </td>
                      <td data-label="When">{dateLabel(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && <ConversationDrawer row={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
export default function Conversations() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Conversations</span>
          <h1>Every call. A clear next step.</h1>
          <p>Read what was said, what was learned, and where the result went.</p>
        </div>
      </div>
      <ConversationList />
    </>
  );
}
