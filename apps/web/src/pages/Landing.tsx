import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  Globe2,
  Menu,
  MessageSquareText,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Brand } from '../components/Brand.js';
import VoiceVisual, { Waveform } from '../components/VoiceVisual.js';
import { workflows } from '../workflows.js';
import { PRODUCT_NAME } from '../config.js';
export default function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const [active, setActive] = useState(0),
    [menu, setMenu] = useState(false);
  const selected = workflows[active];
  const entry = signedIn ? '/workspace' : '/login';
  return (
    <div className="marketing-site">
      <a href="#landing-main" className="sr-only skip-link">
        Skip to content
      </a>
      <header className="marketing-header">
        <div className="marketing-nav">
          <Brand />
          <nav aria-label="Website" className={menu ? 'open' : ''}>
            <a href="#solutions" onClick={() => setMenu(false)}>
              Solutions
            </a>
            <a href="#how-it-works" onClick={() => setMenu(false)}>
              How it works
            </a>
            <a href="#why-elevate" onClick={() => setMenu(false)}>
              Why {PRODUCT_NAME}
            </a>
          </nav>
          <div className="marketing-actions">
            <Link className="sign-in-link" to={entry}>
              {signedIn ? 'Workspace' : 'Sign in'}
              <ArrowUpRight size={15} />
            </Link>
            <Link className="btn btn-primary" to={entry}>
              Get started <ArrowRight size={16} />
            </Link>
            <button
              className="mobile-menu"
              aria-label={menu ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero marketing-container">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="green-dot" /> YOUR BUSINESS. BETTER CONNECTED.
            </div>
            <h1>
              Your Entire Business Communication,
              <br />
              <span>All in one place.</span>
            </h1>
            <p>
              From your first sales hello to your next great hire. Bring sales, marketing, customer
              care, recruitment and appointments together with AI voice agents.
            </p>
            <div className="hero-actions">
              <Link to={entry} className="btn btn-primary">
                Let’s get talking <ArrowUpRight size={18} />
              </Link>
              <a href="#how-it-works" className="hero-secondary">
                See how it works <ArrowDown size={16} />
              </a>
            </div>
            <div className="hero-trust">
              <span>
                <Check size={14} />
                Your words. Your workflow.
              </span>
              <span>
                <Check size={14} />
                Made for real conversations.
              </span>
            </div>
          </div>
          <VoiceVisual />
        </section>
        <div className="capability-strip">
          <div className="marketing-container">
            ONE WORKSPACE. EVERY CONVERSATION.
            <div>
              {workflows.map((w) => (
                <a href="#solutions" key={w.id} onClick={() => setActive(workflows.indexOf(w))}>
                  <w.icon size={18} />
                  {w.name}
                </a>
              ))}
            </div>
          </div>
        </div>
        <section className="marketing-container solutions-section" id="solutions">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A VOICE FOR EVERY PART OF YOUR BUSINESS</span>
              <h2>
                Different teams.
                <br />
                <span>The same personal touch.</span>
              </h2>
            </div>
            <p>
              Let your people focus on what they do best.
              <br />
              Your AI agent can take the first conversation.
            </p>
          </div>
          <div className="solution-tabs" role="tablist" aria-label="Explore solutions">
            {workflows.map((w, i) => (
              <button
                key={w.id}
                role="tab"
                id={`solution-tab-${i}`}
                aria-controls="solution-panel"
                aria-selected={i === active}
                onClick={() => setActive(i)}
              >
                <w.icon size={17} />
                {w.name}
              </button>
            ))}
          </div>
          <div
            className="solution-feature"
            role="tabpanel"
            id="solution-panel"
            aria-labelledby={`solution-tab-${active}`}
          >
            <div className="solution-copy">
              <span className={`solution-icon tone-${selected.color}`}>
                <selected.icon size={27} />
              </span>
              <h3>{selected.short}</h3>
              <p>{selected.description}</p>
              <ul>
                {selected.questions.slice(0, 3).map((q) => (
                  <li key={q[0]}>
                    <Check size={15} />
                    {q[1]}
                  </li>
                ))}
              </ul>
              <Link
                className="text-link"
                to={signedIn ? `/agents/${selected.id}` : `/login?next=/agents/${selected.id}`}
              >
                Build your {selected.id === 'hr' ? 'recruitment' : selected.name.toLowerCase()}{' '}
                agent <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="example-conversation">
              <div className="example-header">
                <div className="agent-avatar">
                  <AudioLines size={24} />
                </div>
                <div>
                  <strong>Your {selected.name.toLowerCase()} agent</strong>
                  <small>Illustrative conversation</small>
                </div>
                <span className="example-badge">AI ASSISTANT</span>
              </div>
              <div className="example-bubble">
                Hello! I’m an AI assistant calling on behalf of your team. Is this a good time?
              </div>
              <div className="example-bubble example-reply">Yes, happy to chat.</div>
              <div className="example-bubble">{selected.questions[0][1]}</div>
              <div className="example-footer">
                <Waveform compact />
                <span>Every call starts with an AI introduction.</span>
              </div>
            </div>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="marketing-container">
            <div className="section-heading">
              <div>
                <span className="eyebrow">LESS SETUP. MORE CONNECTION.</span>
                <h2>
                  Your next conversation
                  <br />
                  starts in three simple steps.
                </h2>
              </div>
              <Link to={entry} className="btn btn-secondary">
                Create your agent <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="how-grid">
              {[
                {
                  n: '01',
                  title: 'Choose the conversation.',
                  text: 'Sales call or candidate screening? Pick a workflow that fits your team.',
                  icon: SlidersHorizontal,
                },
                {
                  n: '02',
                  title: 'Make it yours.',
                  text: 'Share your company details, approved answers and the questions that matter.',
                  icon: MessageSquareText,
                },
                {
                  n: '03',
                  title: 'Call. Learn. Follow through.',
                  text: 'Add a number, place a call through Twilio and find the summary in your workspace.',
                  icon: Phone,
                },
              ].map((s) => (
                <article key={s.n}>
                  <div className="how-top">
                    <span>{s.n}</span>
                    <s.icon size={23} />
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="marketing-container why-section" id="why-elevate">
          <div className="why-editorial">
            <span className="eyebrow">THOUGHTFUL BY DESIGN</span>
            <h2>
              Technology that listens.
              <br />
              <span>A workspace that just makes sense.</span>
            </h2>
            <p>
              No complicated dashboards. No scattered conversations. Just your team, your agent and
              a clear next step.
            </p>
            <Link to={entry} className="text-link">
              Find your first conversation <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="why-list">
            {[
              {
                icon: Globe2,
                title: 'Speak their language.',
                text: 'Choose from the supported Indian languages, including English and Hindi.',
              },
              {
                icon: MessageSquareText,
                title: 'Get the story, not just a call log.',
                text: 'Transcripts, captured answers and concise summaries stay together.',
              },
              {
                icon: ShieldCheck,
                title: 'Stay in control.',
                text: 'AI disclosure, consent, calling hours and do-not-call checks stay built in.',
              },
            ].map((w) => (
              <article key={w.title}>
                <w.icon size={22} />
                <div>
                  <h3>{w.title}</h3>
                  <p>{w.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="marketing-container closing-wrap">
          <div className="closing-cta">
            <span className="eyebrow">GOOD CONVERSATIONS START HERE</span>
            <h2>
              A little less busywork.
              <br />A lot more connection.
            </h2>
            <Link to={entry} className="btn btn-primary">
              Meet your AI workspace <ArrowUpRight size={18} />
            </Link>
            <div className="closing-line" aria-hidden="true">
              <Waveform />
            </div>
          </div>
        </section>
      </main>
      <footer className="marketing-footer marketing-container">
        <div>
          <Brand />
          <p>
            Your entire business communication,
            <br />
            all in one place.
          </p>
        </div>
        <div className="footer-links">
          <a href="#solutions">Solutions</a>
          <a href="#how-it-works">How it works</a>
          <Link to={entry}>
            {signedIn ? 'Open workspace' : 'Sign in'} <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {PRODUCT_NAME}
          </span>
          <span>Built with Gnani speech · Connected through Twilio</span>
          <span>Made for people.</span>
        </div>
      </footer>
    </div>
  );
}
