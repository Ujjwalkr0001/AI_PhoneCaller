import { useState } from 'react';
import { Play } from 'lucide-react';
import type { CampaignDraftMinimal } from '../../../../packages/shared/src/minimal.js';
import { screeningPresets } from '../../../../packages/shared/src/minimal.js';
import { csrf } from '../api.js';
import { useApp } from '../App.js';
import { Button, Card, Chip, Disclosure } from '../ui/index.js';
const samples = new Map<string, string>();
export function previewOpening(d: CampaignDraftMinimal, name = 'Mira') {
  const company = d.company_name.trim() || 'your company';
  if (d.languages[0] === 'hi-IN')
    return `नमस्ते, मैं ${name}, ${company} की ओर से एक AI सहायक हूँ। क्या अभी बात करने का सही समय है?`;
  return `Hello, I’m ${name}, an AI assistant calling on behalf of ${company}. Is this a good time?`;
}
export function VoiceSample({
  voice = 'Shivani',
  language = 'en-IN',
}: {
  voice?: string;
  language?: string;
}) {
  const { providers } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (providers?.simulation)
    return (
      <p className="helper">Voice sample needs live voice settings. Simulation audio is silent.</p>
    );
  return (
    <div className="stack-small">
      <Button
        onClick={() => {
          setBusy(true);
          setError('');
          const key = `${voice}:${language}`;
          void (async () => {
            let url = samples.get(key);
            if (!url) {
              const response = await fetch('/api/v1/voice-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ voice, language }),
              });
              if (!response.ok)
                throw new Error((await response.json()).error ?? 'Voice sample unavailable.');
              url = URL.createObjectURL(await response.blob());
              samples.set(key, url);
            }
            await new Audio(url).play();
          })()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
        disabled={busy}
      >
        <Play size={14} />
        {busy ? 'Preparing sample…' : 'Hear it'}
      </Button>
      <small>Voice sample · {voice}</small>
      {error && (
        <p className="field-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
export default function AgentPreview({
  draft,
  name = 'Mira',
  voice = 'Shivani',
}: {
  draft: CampaignDraftMinimal;
  name?: string;
  voice?: string;
}) {
  const captures =
    draft.type === 'hr'
      ? [
          ...draft.requirements.slice(0, 2),
          ...draft.screening.map((k) => screeningPresets[k].label),
        ].slice(0, 5)
      : ['Interest', 'Next step', 'Follow-up consent'];
  const card = (
    <Card className="preview-card">
      <span className="eyebrow">Your agent’s first hello</span>
      <p className="preview-bubble">{previewOpening(draft, name)}</p>
      <VoiceSample language={draft.languages[0]} voice={voice} />
      <div className="capture">
        <p>What you’ll learn</p>
        <div className="chips">
          {captures.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
      </div>
    </Card>
  );
  return (
    <>
      <aside className="preview-desktop" aria-label="Agent preview">
        {card}
      </aside>
      <div className="preview-mobile">
        <Disclosure title="Preview">{card}</Disclosure>
      </div>
    </>
  );
}
