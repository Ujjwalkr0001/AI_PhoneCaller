import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCampaign, type CallResult } from '../../packages/shared/src/index.js';
import { ConversationPipeline } from '../../apps/server/src/pipeline.js';
import { MockDialogue, MockStt, MockTts } from '../../apps/server/src/providers/mocks.js';
import { CircuitBreaker, ResilientTts } from '../../apps/server/src/providers/resilience.js';
import type { TtsClient } from '../../apps/server/src/contracts.js';
const live: ConversationPipeline[] = [];
afterEach(async () => {
  for (const p of live.splice(0)) await p.finish();
  vi.restoreAllMocks();
});
function fixture(type: 'sales' | 'hr' = 'sales') {
  const c = defaultCampaign(type);
  c.languages = ['en-IN', 'hi-IN'];
  c.voice['hi-IN'] = 'Shivani';
  c.screening_questions = [
    {
      question: 'Can you use TypeScript?',
      field_key: 'typescript',
      required: true,
      must_have: true,
      expected_answer_hint: 'yes',
    },
  ];
  const results: CallResult[] = [],
    events: { type: string; data: unknown }[] = [],
    suppressed = vi.fn(async () => {}),
    clear = vi.fn();
  const p = new ConversationPipeline(
    c,
    'campaign',
    'contact',
    new MockStt(),
    new MockTts(),
    new MockDialogue(),
    { audio: vi.fn(), clear, async mark() {}, async end() {} },
    {
      event: (type, data) => events.push({ type, data }),
      suppress: suppressed,
      complete: async (r) => {
        results.push(r);
      },
    },
    true,
  );
  live.push(p);
  return { p, results, events, suppressed, clear };
}
const utter = (p: ConversationPipeline, text: string, language = 'en-IN') =>
  p.turn({ text, language, finalAt: Date.now(), endOfSpeechAt: Date.now() });
describe('full mock pipeline', () => {
  it('sales positive saves consent and enables auto-submission', async () => {
    const { p, results } = fixture();
    await p.start();
    for (const text of ['Yes', 'yes', 'Tell me more', 'No questions', 'Yes, I agree to follow-up'])
      await utter(p, text);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('INTERESTED_WARM');
    expect(results[0].follow_up_eligible).toBe(true);
    expect(results[0].transcript[0].text).toContain('AI assistant');
    expect(results[0].simulation).toBe(true);
  });
  it('sales without follow-up consent is not auto-submitted', async () => {
    const { p, results } = fixture();
    await p.start();
    for (const text of ['Yes', 'yes', 'Tell me more', 'No questions', 'No, not now'])
      await utter(p, text);
    expect(results[0].follow_up_eligible).toBe(false);
  });
  for (const [text, outcome] of [
    ['Not interested', 'NOT_INTERESTED'],
    ['Wrong number', 'WRONG_NUMBER'],
    ['Stop calling and remove my number', 'DO_NOT_CALL'],
  ] as const)
    it(outcome, async () => {
      const { p, results, suppressed } = fixture();
      await p.start();
      await utter(p, text);
      expect(results[0].outcome).toBe(outcome);
      expect(suppressed).toHaveBeenCalledTimes(outcome === 'DO_NOT_CALL' ? 1 : 0);
    });
  it('DND finalization and repeated finish are idempotent', async () => {
    const { p, results } = fixture();
    await p.start();
    await utter(p, 'Do not call me');
    await Promise.all([p.finish(), p.finish()]);
    expect(results).toHaveLength(1);
  });
  it('resolves explicit callback, asks clarification for vague time', async () => {
    const { p } = fixture();
    await p.start();
    await utter(p, 'call me later');
    expect(p.callbackAt).toBeUndefined();
    await utter(p, 'call me tomorrow at 11 am');
    expect(p.callbackAt).toMatch(/T05:30:00/);
  });
  it.each(['yes', 'no'])('HR completed screening eligibility for answer %s', async (answer) => {
    const { p, results } = fixture('hr');
    await p.start();
    for (const text of ['Yes', answer, 'Tell me more', 'No questions', 'Yes, I agree'])
      await utter(p, text);
    expect(results[0].outcome).toBe('CANDIDATE_COMPLETED');
    expect(results[0].eligibility?.value).toBe(
      answer === 'yes' ? 'MEETS_ALL_MUST_HAVES' : 'DOES_NOT_MEET',
    );
    expect(results[0].follow_up_eligible).toBe(true);
  });
  it('HR declined is saved for advisory review', async () => {
    const { p, results } = fixture('hr');
    await p.start();
    await utter(p, 'Not interested');
    expect(results[0].outcome).toBe('CANDIDATE_DECLINED');
  });
  it('voicemail terminal result contains no invented transcript', async () => {
    const { p, results } = fixture();
    await p.finish('VOICEMAIL');
    expect(results[0].outcome).toBe('VOICEMAIL');
    expect(results[0].transcript).toEqual([]);
  });
  it('substantial Hindi utterance changes the recorded language', async () => {
    const { p, results } = fixture();
    await p.start();
    await utter(p, 'हाँ मुझे इस काम के बारे में बताइए', 'hi-IN');
    await p.finish();
    expect(results[0].languages).toContain('hi-IN');
  });
  it('truthfully answers human question and unknown facts', async () => {
    const { p } = fixture();
    await p.start();
    await utter(p, 'Are you a robot?');
    expect(p.transcript.at(-1)?.text).toContain('AI assistant');
    await utter(p, 'What salary guarantee can you offer?');
    expect(p.transcript.at(-1)?.text).toContain('follow up');
  });
  it('unknown fields return errors to model', async () => {
    const { p } = fixture();
    const result = await p.tool(
      { name: 'capture_fields', args: { fields: { invented: 'x' } } },
      'yes',
    );
    expect(result).toHaveProperty('error');
    expect(p.fields).toEqual({});
  });
  it('abusive caller gets graceful exit', async () => {
    const { p, results } = fixture();
    await p.start();
    await utter(p, 'Go away');
    expect(results[0].outcome).toBe('NOT_INTERESTED');
  });
  it('repeated what/noisy line ends without looping the LLM', async () => {
    const { p, results } = fixture();
    await p.start();
    await utter(p, 'What?');
    await utter(p, 'I cannot hear you');
    expect(results[0].outcome).toBe('NOT_INTERESTED');
  });
  it('idle prompt then graceful timeout, without provider charges', async () => {
    vi.useFakeTimers();
    try {
      const { p, results } = fixture();
      await p.start();
      await vi.advanceTimersByTimeAsync(25001);
      expect(p.transcript.at(-1)?.text).toBe('Are you still there?');
      await vi.advanceTimersByTimeAsync(25001);
      expect(results).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('barge-in flushes outbound playback after mandatory disclosure', async () => {
    const { p, clear } = fixture();
    await p.start();
    p.transport.mark = async () => {
      p.bargeIn();
    };
    await utter(p, 'Yes');
    expect(clear).toHaveBeenCalled();
  });
  it('does not fail the call when a caller interrupts synthesized speech', async () => {
    const { p, results, events } = fixture();
    await p.start();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    let syntheses = 0;
    p.tts.synthesize = async function* (_text, _language, _voice, signal) {
      if (++syntheses === 1) {
        resolveStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Interrupted', 'AbortError')), {
            once: true,
          });
        });
      }
      yield Buffer.alloc(160, 255);
    };
    const stt = p.stt as MockStt;
    stt.utterance('Yes');
    await started;
    stt.utterance('I can discuss the role');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(results).toHaveLength(0);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
});
describe('provider failover', () => {
  it('opens circuit after failures and recovers on success', () => {
    const b = new CircuitBreaker(2, 1000);
    b.fail();
    expect(b.open).toBe(false);
    b.fail();
    expect(b.open).toBe(true);
    b.success();
    expect(b.open).toBe(false);
  });
  it('visible fallback, never silent mocks', async () => {
    const broken: TtsClient = {
      name: 'Gnani unavailable',
      async *synthesize() {
        throw new Error('down');
        yield Buffer.alloc(0);
      },
    };
    const trace: string[] = [];
    const resilient = new ResilientTts(broken, new MockTts(), (provider, event) =>
      trace.push(`${provider}:${event}`),
    );
    const chunks = [];
    for await (const chunk of resilient.synthesize(
      'hello',
      'en-IN',
      'Shivani',
      new AbortController().signal,
    ))
      chunks.push(chunk);
    expect(chunks.length).toBe(1);
    expect(trace.some((t) => t.endsWith(':failover'))).toBe(true);
  });
});
