import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  CircleHelp,
  Phone,
  Plus,
  Sparkles,
} from 'lucide-react';
import { workflows } from '../workflows.js';
import { useApp } from '../App.js';
import { useData, type CampaignRow, type ResultRow } from '../data.js';
import { Card, Chip, ErrorState, Skeleton, StatusBadge } from '../ui/index.js';
import { Waveform } from '../components/VoiceVisual.js';
import { languageNames } from '../strings.js';
export default function Workspace() {
  const { providers, user } = useApp(),
    campaigns = useData<CampaignRow[]>('/campaigns'),
    results = useData<ResultRow[]>('/results');
  return (
    <div className="workspace-page">
      <div className="workspace-welcome">
        <div>
          <div className="workspace-overline">
            <span className="green-dot" /> YOUR COMMUNICATION WORKSPACE
          </div>
          <h1>
            A good conversation
            <br />
            can change everything.
          </h1>
          <p>What can we take off your plate today?</p>
        </div>
        <div className="workspace-voice">
          <AudioLines size={25} />
          <Waveform compact />
          <span>One voice. Every team.</span>
        </div>
      </div>
      <section id="workflows" className="workflows-section">
        <div className="section-label">
          <h2>Choose your conversation</h2>
          <span>Five ways to make work feel lighter</span>
        </div>
        <div className="workflow-grid">
          {workflows.map((w, i) => (
            <Link to={`/agents/${w.id}`} key={w.id} className={`workflow-card workflow-${w.color}`}>
              <div className="workflow-card-top">
                <span className={`solution-icon tone-${w.color}`}>
                  <w.icon size={24} />
                </span>
                <span className="workflow-index">0{i + 1}</span>
              </div>
              <h3>{w.name}</h3>
              <p>{w.short}</p>
              <span className="workflow-card-action">
                {w.action}
                <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <div className="workspace-bottom-grid">
        <section>
          <div className="section-label">
            <h2>Your agents & campaigns</h2>
            <Link to="/campaigns" className="text-link">
              View all <ArrowRight size={15} />
            </Link>
          </div>
          {campaigns.isPending ? (
            <Skeleton lines={2} />
          ) : campaigns.isError ? (
            <ErrorState
              message="We couldn’t load your campaigns."
              retry={() => void campaigns.refetch()}
            />
          ) : campaigns.data.length ? (
            <div className="recent-campaigns">
              {campaigns.data.slice(0, 3).map((c) => (
                <Link key={c.id} className="recent-campaign" to={`/campaigns/${c.id}`}>
                  <span className={`recent-icon ${c.data.type === 'hr' ? 'lilac' : 'mint'}`}>
                    {c.data.type === 'hr' ? <Sparkles size={19} /> : <Phone size={19} />}
                  </span>
                  <div className="grow">
                    <strong>{c.data.name}</strong>
                    <small>
                      {c.data.languages.map((l) => languageNames[l]).join(' + ')} ·{' '}
                      {c.data.type === 'hr' ? 'Recruitment' : 'Outbound conversation'}
                    </small>
                  </div>
                  {c.data.sample && <Chip>Sample</Chip>}
                  <StatusBadge status={c.data.status} />
                  <ArrowUpRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <Card className="workspace-empty">
              <span className="empty-icon">
                <Plus size={25} />
              </span>
              <h3>Your first agent is a conversation away.</h3>
              <p>Choose a workflow above. We’ll guide you through the rest.</p>
            </Card>
          )}
        </section>
        <aside>
          <div className="section-label">
            <h2>A little help getting started</h2>
          </div>
          <Card className="getting-started">
            <span className="mint-icon">
              <CircleHelp size={20} />
            </span>
            <h3>Make your first call.</h3>
            <p>
              A few details, the right questions and one phone number. That’s your starting point.
            </p>
            <div className="setup-check">
              <Check size={15} />
              <span>1. Choose a conversation</span>
            </div>
            <div className="setup-check">
              <Check size={15} />
              <span>2. Tell your agent what matters</span>
            </div>
            <div className="setup-check">
              <Check size={15} />
              <span>3. Connect Twilio and start talking</span>
            </div>
            <Link className="btn btn-secondary" to="/settings#connections">
              Check your connections <ArrowUpRight size={16} />
            </Link>
            <small>
              {providers?.simulation
                ? 'You’re exploring in simulation mode.'
                : 'Live calls use your configured providers.'}
            </small>
          </Card>
        </aside>
      </div>
      <div className="workspace-footnote">
        <span>
          <AudioLines size={15} /> Built with Gnani speech. Connected through Twilio.
        </span>
        <span>
          {results.data
            ? `${results.data.length} saved conversations`
            : 'Your conversations, together'}{' '}
          · {user.role === 'admin' ? 'Administrator' : 'Read only'}
        </span>
      </div>
    </div>
  );
}
