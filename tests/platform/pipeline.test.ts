import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCampaign, type CallResult, type Campaign } from '../../packages/shared/src/index.js';
import { expandToFullConfig, newMinimalDraft } from '../../packages/shared/src/minimal.js';
import { ConversationPipeline } from '../../apps/server/src/pipeline.js';
import { MockDialogue, MockStt, MockTts } from '../../apps/server/src/providers/mocks.js';
import { CircuitBreaker, ResilientTts } from '../../apps/server/src/providers/resilience.js';
import type { TtsClient } from '../../apps/server/src/contracts.js';
const live: ConversationPipeline[] = [];
afterEach(async () => {
  for (const p of live.splice(0)) await p.finish();
  vi.restoreAllMocks();
});
function fixture(type: 'sales' | 'hr' = 'sales', configure?: (c: Campaign) => void, firstName = '') {
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
  configure?.(c);
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
    firstName,
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
    expect(results[0].outcome).toBe(answer === 'yes' ? 'CANDIDATE_COMPLETED' : 'CANDIDATE_REQUIREMENTS_NOT_MET');
    expect(results[0].eligibility?.value).toBe(
      answer === 'yes' ? 'MEETS_ALL_MUST_HAVES' : 'DOES_NOT_MEET',
    );
    expect(results[0].follow_up_eligible).toBe(answer === 'yes');
  });
  it('HR declined is saved for advisory review', async () => {
    const { p, results } = fixture('hr');
    await p.start();
    await utter(p, 'Not interested');
    expect(results[0].outcome).toBe('CANDIDATE_DECLINED');
  });
  it('runs the full frontend recruitment form with requirements before role details and every selected question', async () => {
    const { p, results, events } = fixture('hr', (c) => Object.assign(c, expandToFullConfig({
      ...newMinimalDraft('hr'), company_name: 'Elevate Box', job_title: 'Backend Engineer',
      requirements: ['3+years of expereince in API', 'AWS'],
      screening: ['notice_period', 'expected_salary', 'current_location', 'interview_availability', 'relevant_experience'],
    }, { advanced: { role_summary: 'Build and maintain our deployment systems.' } })), 'Ujjwal');
    const dialogue = vi.spyOn(p.dialogue, 'reply');
    await p.start();
    expect(p.transcript[0].text).toContain('Hey Ujjwal, you applied to Elevate Box for the Backend Engineer position.');
    await utter(p, 'Yes');
    expect(p.transcript.at(-1)?.text).toContain('at least 3 years');
    await utter(p, 'I have four years of experience.');
    expect(p.transcript.at(-1)?.text).toContain('professional experience with AWS');
    expect(p.transcript.some((t) => t.text.includes('deployment systems'))).toBe(false);
    await utter(p, 'Yes, I have used AWS.');
    expect(p.flow.stage).toBe('PITCH_ROLE_INTRO');
    expect(p.transcript.at(-1)?.text).toContain('Build and maintain our deployment systems.');
    expect(p.transcript.at(-1)?.text).toContain('What relevant experience would you like to share?');
    for (const text of ['I built API services and deployment tools.', 'Seventy thousand rupees per month.',
      'Kolkata.', 'Thirty days.', 'Monday afternoon.']) await utter(p, text);
    expect(p.flow.stage).toBe('OBJECTIONS_QA');
    await utter(p, 'No questions');
    await utter(p, 'Yes, I agree');
    expect(results[0]).toMatchObject({outcome: 'CANDIDATE_COMPLETED', extracted_fields: {
      requirement_1: 'yes', requirement_2: 'yes', expected_salary: 'Seventy thousand rupees per month.',
      current_location: 'Kolkata.', notice_period: 'Thirty days.', interview_availability: 'Monday afternoon.',
    }});
    expect(events.filter((e) => e.type === 'screening_question').map((e) => e.data)).toMatchObject([
      {field_key: 'requirement_1'}, {field_key: 'requirement_2'}, {field_key: 'relevant_experience'},
      {field_key: 'expected_salary'}, {field_key: 'current_location'}, {field_key: 'notice_period'},
      {field_key: 'interview_availability'},
    ]);
    expect(dialogue).not.toHaveBeenCalled();
  });
  it('clarifies unrelated answers then closes with the actual unmet experience requirement', async () => {
    const { p, results } = fixture('hr', (c) => Object.assign(c, expandToFullConfig({
      ...newMinimalDraft('hr'), company_name: 'Elevate Box', job_title: 'Backend Engineer',
      requirements: ['3+years of expereince in API', 'AWS'],
    }, {advanced: {role_summary: 'Build deployment tools.'}})));
    await p.start();
    await utter(p, 'Yes');
    await utter(p, 'I am a backend developer.');
    expect(p.fields.requirement_1).toBeUndefined();
    expect(p.transcript.at(-1)?.text).toContain('Please confirm with yes or no');
    await utter(p, 'I have two years of experience.');
    expect(results[0]).toMatchObject({outcome: 'CANDIDATE_REQUIREMENTS_NOT_MET',
      end_reason: 'must_have_not_met', follow_up_eligible: false, extracted_fields: {requirement_1: 'no'},
      eligibility: {value: 'DOES_NOT_MEET'}});
    expect(p.transcript.at(-1)?.text).toContain("I'm really sorry, but this role requires at least 3 years");
    expect(p.transcript.some((t) => /deployment tools|salary expectations|notice period/.test(t.text))).toBe(false);
    expect(p.fields.requirement_2).toBeUndefined();
  });
  it('leaves unconfirmed must-haves incomplete without treating them as a mismatch', async () => {
    const {p, results} = fixture('hr');
    await p.start(); await utter(p, 'Yes');
    await utter(p, 'Hello'); await utter(p, 'I am a developer');
    expect(results[0]).toMatchObject({outcome: 'INCOMPLETE', end_reason: 'must_have_unconfirmed',
      eligibility: {value: 'UNCLEAR'}, follow_up_eligible: false});
  });
  it('finishes every configured screening question in order without LLM calls for answers', async () => {
    const { p, events, results } = fixture('hr');
    p.campaign.screening_questions.push({
      question: 'When could you start?', field_key: 'notice_period', required: false,
      must_have: false, expected_answer_hint: '',
    });
    const dialogue = vi.spyOn(p.dialogue, 'reply');
    await p.start();
    await utter(p, 'Yes, please.');
    await utter(p, 'Yes, I can use TypeScript.');
    expect(p.fields.typescript).toBe('yes');
    expect(p.transcript.at(-1)?.text).toContain('When could you start?');
    await utter(p, 'Please repeat the question.');
    expect(p.fields.notice_period).toBeUndefined();
    await utter(p, 'In thirty days.');
    expect(p.flow.stage).toBe('OBJECTIONS_QA');
    await utter(p, 'No questions.');
    expect(p.flow.stage).toBe('CLOSE');
    await utter(p, 'Yes, the team can follow up.');
    expect(results[0].outcome).toBe('CANDIDATE_COMPLETED');
    expect(results[0].extracted_fields).toMatchObject({
      typescript: 'yes', notice_period: 'In thirty days.', consent_to_follow_up: true,
    });
    expect(dialogue).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'screening_question').map((e) => e.data)).toMatchObject([
      { field_key: 'typescript', ordinal: 1 }, { field_key: 'notice_period', ordinal: 2 },
    ]);
    expect(results[0].latency.some((t) => t.route === 'structured' && t.stt_final_to_audio_ms !== undefined)).toBe(true);
  });
  it('answers candidate questions without allowing the model to skip screening', async () => {
    const { p } = fixture('hr');
    vi.spyOn(p.dialogue, 'reply').mockResolvedValue({
      text: 'The team will follow up with that information.', tokens: 1,
      tools: [{ name: 'advance_stage', args: { stage: 'WRAP_UP' } }],
    });
    await p.start();
    await utter(p, 'Yes');
    await utter(p, 'What is the salary?');
    expect(p.flow.stage).toBe('DISCOVERY_SCREENING');
    expect(p.fields.typescript).toBeUndefined();
    expect(p.transcript.at(-1)?.text).toContain('Can you use TypeScript?');
    await utter(p, 'I prefer not to answer.');
    expect(p.fields.typescript).toBe('unknown');
    expect(p.transcript.at(-1)?.text).toContain("couldn't confirm");
  });
  it('captures technical experience without mistaking domain words for handoff or callback requests', async () => {
    const { p } = fixture('hr');
    p.campaign.screening_questions = [{
      question: 'Describe your software experience.', field_key: 'relevant_experience',
      required: true, must_have: false, expected_answer_hint: '',
    }];
    await p.start();
    await utter(p, 'Yes');
    const answer = 'I built callback APIs for human resources teams.';
    await utter(p, answer);
    expect(p.fields.relevant_experience).toBe(answer);
    expect(p.flow.stage).toBe('OBJECTIONS_QA');
    expect(p.callbackAt).toBeUndefined();
    expect(p.tools.some((t) => ['schedule_callback', 'request_handoff'].includes(t.name))).toBe(false);
  });
  it('asks screening after permission and repeats it without skipping to follow-up consent', async () => {
    const { p } = fixture('hr');
    const dialogue = vi.spyOn(p.dialogue, 'reply').mockResolvedValue({
      text: 'May the team follow up with you?', tools: [], tokens: 0,
    });
    await p.start();
    await utter(p, 'Yes, please tell.');
    expect(p.flow.stage).toBe('DISCOVERY_SCREENING');
    expect(p.transcript.at(-1)?.text).toContain('Can you use TypeScript?');
    expect(dialogue).not.toHaveBeenCalled();
    await utter(p, 'Sorry, can you please repeat the question?');
    expect(p.transcript.at(-1)?.text).toBe('Can you use TypeScript?');
    expect(dialogue).not.toHaveBeenCalled();
    expect(p.fields).toEqual({});
    await utter(p, 'Yes, I can.');
    expect(p.flow.stage).toBe('OBJECTIONS_QA');
    expect(p.fields.typescript).toBe('yes');
    expect(dialogue).not.toHaveBeenCalled();
    expect(p.fields.consent_to_follow_up).toBeUndefined();
  });
  it('voicemail terminal result contains no invented transcript', async () => {
    const { p, results } = fixture();
    await p.finish('VOICEMAIL');
    expect(results[0].outcome).toBe('VOICEMAIL');
    expect(results[0].transcript).toEqual([]);
  });
  it('records an unanswered introduction as incomplete with its end source', async () => {
    const { p, results, events } = fixture('hr');
    await p.start();
    await p.finish(undefined, 'twilio_media_stop');
    await p.finish();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      outcome: 'INCOMPLETE',
      end_reason: 'twilio_media_stop',
      follow_up_eligible: false,
      summary: expect.stringContaining('answers are unknown'),
    });
    expect(events.filter((event) => event.type === 'call_end')).toHaveLength(1);
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
