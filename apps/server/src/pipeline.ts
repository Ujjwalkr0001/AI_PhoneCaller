import { z } from 'zod';
import type { Campaign, CallResult, Outcome, Turn } from '../../../packages/shared/src/index.js';
import type {
  DialogueClient,
  SttClient,
  SttEvent,
  ToolCall,
  Transport,
  TtsClient,
} from './contracts.js';
import {
  CallFlow,
  agentVersion,
  eligibility,
  opening,
  questions,
  safeReply,
  shouldSubmit,
  validateFields,
} from './domain.js';
import { FrameBuffer } from './audio.js';
import { redactSensitive } from './security.js';
import { analyzeCall } from './analysis.js';
import { parseCallbackPhrase } from '../../../src/utils/time-parser.js';
export interface PipelineHooks {
  event(type: string, data: unknown): void;
  suppress(): Promise<void>;
  complete(result: CallResult): Promise<void>;
  usage?(stt: number, tts: number): Promise<boolean>;
}
export class ConversationPipeline {
  readonly flow = new CallFlow();
  readonly transcript: Turn[] = [];
  readonly fields: Record<string, string | boolean | number> = {};
  readonly tools: CallResult['tool_log'] = [];
  readonly trace: CallResult['provider_trace'] = [];
  readonly latency: CallResult['latency'] = [];
  private started = Date.now();
  private abort = new AbortController();
  private generation = 0;
  private finishing?: Promise<void>;
  private duration?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private idleCount = 0;
  private outcome?: Outcome;
  private interest?: 'hot' | 'warm' | 'cold';
  private language: string;
  private spokenLanguages = new Set<string>();
  private sttSeconds = 0;
  private ttsChars = 0;
  private tokens = 0;
  private busy = false;
  private toolResult: unknown;
  private repeatCount = 0;
  private resolveIntro!: () => void;
  private introDone = new Promise<void>((resolve) => {
    this.resolveIntro = resolve;
  });
  callbackAt?: string;
  constructor(
    readonly campaign: Campaign,
    readonly campaignId: string,
    readonly contactId: string | undefined,
    readonly stt: SttClient,
    readonly tts: TtsClient,
    readonly dialogue: DialogueClient,
    readonly transport: Transport,
    readonly hooks: PipelineHooks,
    readonly simulation: boolean,
    private firstName = '',
  ) {
    this.language = campaign.languages[0];
  }
  provider(provider: string, event: string) {
    const trace = { provider, event, at: new Date().toISOString() };
    this.trace.push(trace);
    this.hooks.event('provider', trace);
  }
  async start() {
    this.stt.onActivity = () => this.bargeIn();
    this.stt.onTurn = (e) => {
      void this.turn(e).catch((error: unknown) => {
        // A caller can interrupt TTS. Its aborted request belongs to the old
        // turn and must not terminate the newly started conversation turn.
        if (error instanceof Error && error.name === 'AbortError') return;
        this.hooks.event('error', {
          code: 'TURN_FAILED',
          name: error instanceof Error ? error.name : 'Unknown',
        });
        if (!this.abort.signal.aborted) return this.finish('FAILED');
      });
    };
    this.stt.onError = (error) => {
      this.hooks.event('error', { message: error.message });
      void this.finish('FAILED');
    };
    await this.stt.connect();
    this.provider(
      this.simulation ? 'Mock STT (simulation)' : 'Speech recognition',
      'ready; see connection/failover trace for actual provider',
    );
    this.provider(this.dialogue.name, 'selected');
    this.duration = setTimeout(() => {
      this.hooks.event('exit', 'TIMEOUT');
      void this.finish(this.outcome ?? 'INCOMPLETE', 'duration_limit');
    }, this.campaign.max_call_duration_s * 1000);
    await this.say(opening(this.campaign, this.firstName));
    this.flow.advance('PERMISSION');
    this.resolveIntro();
    this.hooks.event('stage', this.flow.stage);
    this.armIdle();
  }
  input(pcm: Buffer) {
    if (!this.finishing) {
      this.sttSeconds += pcm.length / 16000;
      if (this.sttSeconds > this.campaign.max_call_duration_s) {
        void this.finish('FAILED');
        return;
      }
      this.stt.sendAudio(pcm);
    }
  }
  bargeIn() {
    if (!this.busy || this.flow.stage === 'GREETING_DISCLOSURE') return;
    this.generation++;
    this.abort.abort();
    this.transport.clear();
    this.busy = false;
    this.hooks.event('barge_in', { at: Date.now() });
  }
  private armIdle() {
    clearTimeout(this.idle);
    this.idle = setTimeout(
      () => {
        if (++this.idleCount > 1) void this.finish(this.outcome ?? 'INCOMPLETE', 'idle_timeout');
        else
          void this.say('Are you still there?')
            .then(() => this.armIdle())
            .catch(() => this.finish('FAILED'));
      },
      Number(process.env.IDLE_TIMEOUT_SECONDS ?? 25) * 1000,
    );
  }
  private record(role: Turn['role'], text: string) {
    const turn = {
      role,
      text: redactSensitive(text, this.campaign.type === 'hr'),
      at: new Date().toISOString(),
    };
    this.transcript.push(turn);
    this.hooks.event('transcript', turn);
  }
  async turn(e: SttEvent) {
    if (this.flow.stage === 'GREETING_DISCLOSURE') await this.introDone;
    if (this.finishing) return;
    clearTimeout(this.idle);
    this.idleCount = 0;
    this.bargeIn();
    const token = ++this.generation;
    this.abort = new AbortController();
    this.busy = true;
    const text = redactSensitive(e.text.trim(), this.campaign.type === 'hr');
    this.record('caller', text);
    const lang = e.language?.includes('-')
      ? e.language
      : e.language
        ? `${e.language}-IN`
        : undefined;
    if (
      text.length >= 12 &&
      lang &&
      this.campaign.languages.includes(lang as Campaign['languages'][number])
    )
      this.language = lang;
    this.spokenLanguages.add(this.language);
    if (
      /do not call|don't call|stop calling|remove my number|never call|do not contact|don't contact|^stop[.!]?\s*$|मुझे कॉल मत|कॉल मत करना|फोन मत|కాల్ చేయవద్దు|కాల్ చేయకండి|ఫోన్ చేయొద్దు|அழைக்க வேண்டாம்/i.test(
        text,
      )
    ) {
      await this.tool({ name: 'mark_do_not_call', args: {} }, text);
      await this.say('I am sorry. I have added your number to our do-not-call list. Goodbye.');
      return this.finish('DO_NOT_CALL');
    }
    if (/wrong (person|number)|not the right person/i.test(text)) {
      await this.say('Sorry for the interruption. Goodbye.');
      return this.finish('WRONG_NUMBER');
    }
    if (/\b(fuck|go away|leave me alone|shut up)\b/i.test(text)) {
      await this.say('I am sorry for the interruption. Goodbye.');
      return this.finish('NOT_INTERESTED');
    }
    if (
      !/\p{L}/u.test(text) ||
      /unintelligible|noisy line|^what\??$|cannot hear|can't hear/i.test(text)
    ) {
      if (++this.repeatCount >= 2) {
        await this.say('We can try another time. Thank you. Goodbye.');
        return this.finish('NOT_INTERESTED');
      }
      await this.say('Could you please repeat that?');
      this.armIdle();
      return;
    }
    this.repeatCount = 0;
    if (/not interested|no interest|नहीं चाहिए/i.test(text)) {
      await this.say('Thank you for your time. Goodbye.');
      return this.finish(this.campaign.type === 'hr' ? 'CANDIDATE_DECLINED' : 'NOT_INTERESTED');
    }
    if (/call me (later|tomorrow|after)|call back|callback|कल.*कॉल/i.test(text)) {
      const result = await this.tool(
        { name: 'schedule_callback', args: { when_text: text } },
        text,
      );
      await this.say(
        this.callbackAt
          ? 'Thank you. The team will call at the confirmed time. Goodbye.'
          : 'Please confirm an exact day and time for the callback.',
      );
      if (this.callbackAt) return this.finish('CALLBACK');
      this.toolResult = result;
      this.armIdle();
      return;
    }
    if (/are you (a )?(robot|human|ai)|real person/i.test(text)) {
      await this.say(
        'I am an AI assistant calling on behalf of ' + this.campaign.company_name + '.',
      );
      this.armIdle();
      return;
    }
    if (/human|person please|speak to.*team/i.test(text)) {
      await this.tool({ name: 'request_handoff', args: {} }, text);
      await this.say(
        'I can arrange a callback from the team. What exact day and time works for you?',
      );
      this.armIdle();
      return;
    }
    if (this.flow.stage === 'PERMISSION' && /\bno\b|busy|bad time/i.test(text)) {
      await this.say('Understood. Goodbye.');
      return this.finish('NOT_INTERESTED');
    }
    const timing: CallResult['latency'][number] = {
      stt_final_ms: e.endOfSpeechAt ? e.finalAt - e.endOfSpeechAt : undefined,
    };
    const began = Date.now();
    const reply = await this.dialogue.reply(
      this.campaign,
      this.transcript,
      this.flow.stage,
      { ...this.fields, last_tool_results: this.toolResult },
      this.abort.signal,
      () => {
        timing.llm_first_token_ms = Date.now() - began;
      },
    );
    if (token !== this.generation || this.finishing) return;
    this.tokens += reply.tokens;
    const results: unknown[] = [];
    for (const tool of reply.tools) results.push(await this.tool(tool, text));
    this.toolResult = results;
    await this.say(
      this.outcome === 'DO_NOT_CALL'
        ? 'I am sorry. Your number has been added to our do-not-call list. Goodbye.'
        : safeReply(this.campaign, reply.text),
      timing,
      e.endOfSpeechAt,
    );
    this.latency.push(timing);
    this.hooks.event('latency', timing);
    this.busy = false;
    if (
      this.outcome === 'DO_NOT_CALL' ||
      this.outcome === 'WRONG_NUMBER' ||
      this.flow.stage === 'WRAP_UP'
    )
      return this.finish(this.outcome);
    this.armIdle();
  }
  async tool(call: ToolCall, callerText: string): Promise<unknown> {
    let result: unknown;
    try {
      switch (call.name) {
        case 'capture_fields':
          Object.assign(
            this.fields,
            validateFields(
              this.campaign,
              z.record(z.string(), z.unknown()).parse(call.args.fields),
              callerText,
            ),
          );
          result = { captured: Object.keys(this.fields) };
          break;
        case 'advance_stage': {
          const complete = questions(this.campaign)
            .filter((q) => q.required || q.must_have)
            .every((q) => this.fields[q.field_key] !== undefined);
          this.flow.advance(
            z
              .enum([
                'PERMISSION',
                'DISCOVERY_SCREENING',
                'PITCH_ROLE_INTRO',
                'OBJECTIONS_QA',
                'CLOSE',
                'WRAP_UP',
              ])
              .parse(call.args.stage),
            complete,
          );
          this.hooks.event('stage', this.flow.stage);
          result = { stage: this.flow.stage };
          break;
        }
        case 'set_interest_level':
          this.interest = z.enum(['hot', 'warm', 'cold']).parse(call.args.level);
          result = { interest: this.interest };
          break;
        case 'mark_do_not_call':
          await this.hooks.suppress();
          this.outcome = 'DO_NOT_CALL';
          result = { suppressed: true };
          break;
        case 'mark_wrong_number':
          this.outcome = 'WRONG_NUMBER';
          result = { wrong_number: true };
          break;
        case 'schedule_callback': {
          const phrase = z.string().max(500).parse(call.args.when_text),
            parsed = parseCallbackPhrase(phrase, new Date());
          if (!parsed?.isExplicitTime)
            throw new Error('Ask caller for an explicit confirmed day and time');
          const clock = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(parsed.date);
          if (clock < this.campaign.schedule.start || clock >= this.campaign.schedule.end)
            throw new Error('Ask for a time inside the calling window');
          this.callbackAt = parsed.date.toISOString();
          this.outcome = 'CALLBACK';
          result = { callback_at: this.callbackAt };
          break;
        }
        case 'request_handoff':
          result = {
            mode: 'callback',
            instruction: 'Ask for a specific callback time; no warm transfer is available',
          };
          break;
        case 'end_call':
          if (this.flow.stage !== 'WRAP_UP')
            throw new Error('Complete required flow before ending');
          result = { ending: true };
          break;
        default:
          throw new Error('Unknown tool');
      }
    } catch (error) {
      if (call.name === 'mark_do_not_call') throw error;
      result = { error: error instanceof Error ? error.message : 'Invalid tool arguments' };
    }
    const entry = {
      name: call.name,
      args: redactSensitive(JSON.stringify(call.args), this.campaign.type === 'hr'),
      result,
      at: new Date().toISOString(),
    };
    this.tools.push(entry);
    this.hooks.event('tool', entry);
    this.hooks.event('fields', this.fields);
    return result;
  }
  private async say(text: string, timing?: CallResult['latency'][number], endAt?: number) {
    if (!text.trim()) return;
    const signal = this.abort.signal,
      frames = new FrameBuffer(160),
      began = Date.now();
    let first = true;
    this.busy = true;
    this.ttsChars += text.length;
    if (this.hooks.usage && !(await this.hooks.usage(this.sttSeconds, this.ttsChars)))
      throw new Error('Usage cap reached');
    this.record('agent', text);
    const sentences = text.match(/[^.!?।]+[.!?।]?/g) ?? [text];
    for (const sentence of sentences) {
      for await (const chunk of this.tts.synthesize(
        sentence.trim(),
        this.language,
        this.campaign.voice[this.language as Campaign['languages'][number]] ?? 'Shivani',
        signal,
      )) {
        if (signal.aborted) return;
        if (first) {
          first = false;
          if (timing) {
            timing.tts_first_byte_ms = Date.now() - began;
            if (endAt) timing.end_of_speech_to_audio_ms = Date.now() - endAt;
          }
        }
        for (const frame of frames.push(chunk)) this.transport.audio(frame);
      }
    }
    for (const frame of frames.flush(255)) this.transport.audio(frame);
    for (let i = 0; i < 15; i++) this.transport.audio(Buffer.alloc(160, 255));
    await this.transport.mark(`turn-${this.generation}`);
    this.busy = false;
  }
  finish(outcome?: Outcome, source = 'pipeline'): Promise<void> {
    if (this.finishing) return this.finishing;
    this.hooks.event('call_end', {
      source,
      requested_outcome: outcome,
      stage: this.flow.stage,
      caller_turns: this.transcript.filter((turn) => turn.role === 'caller').length,
    });
    this.finishing = this.finalize(outcome, source);
    return this.finishing;
  }
  private async finalize(outcome: Outcome | undefined, source: string) {
    clearTimeout(this.duration);
    clearTimeout(this.idle);
    this.resolveIntro();
    this.abort.abort();
    this.stt.close();
    const completed = this.flow.stage === 'WRAP_UP';
    const finalOutcome =
      outcome ??
      this.outcome ??
      (this.campaign.type === 'hr' && completed
        ? 'CANDIDATE_COMPLETED'
        : this.interest === 'hot'
          ? 'INTERESTED_HOT'
          : this.interest === 'warm'
            ? 'INTERESTED_WARM'
            : 'INCOMPLETE');
    let postCall: Awaited<ReturnType<typeof analyzeCall>> | undefined;
    if (!this.simulation && this.transcript.some((turn) => turn.role === 'caller')) {
      try {
        postCall = await analyzeCall(this.campaign, this.transcript, finalOutcome, this.fields);
        this.tokens += postCall.tokens;
        this.provider(this.dialogue.name, 'post-call analysis complete');
      } catch {
        this.provider(this.dialogue.name, 'post-call analysis unavailable; saved transcript retained');
      }
    }
    const result: CallResult = {
      campaign_id: this.campaignId,
      contact_id: this.contactId,
      outcome: finalOutcome,
      end_reason: source,
      summary: postCall?.summary ?? (!this.transcript.some((turn) => turn.role === 'caller')
        ? 'The call ended before any caller response was captured. Interest and qualification answers are unknown.'
        : `${this.simulation ? '[SIMULATION] ' : ''}${this.campaign.type === 'hr' ? 'Advisory screening' : 'Campaign call'} ended at ${this.flow.stage}.\n${
        Object.entries(this.fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') || 'No qualification fields captured.'
      }\nHuman review required.`),
      extracted_fields: this.fields,
      sentiment: 'unknown',
      languages: [...this.spokenLanguages],
      transcript: this.transcript,
      tool_log: this.tools,
      latency: this.latency,
      usage: {
        stt_seconds: this.sttSeconds,
        tts_chars: this.ttsChars,
        llm_tokens: this.tokens,
        telephony_minutes: this.contactId ? (Date.now() - this.started) / 60000 : 0,
      },
      provider_trace: this.trace,
      agent_version: agentVersion(this.campaign),
      sample: this.campaign.sample,
      simulation: this.simulation,
      duration_s: (Date.now() - this.started) / 1000,
      follow_up_eligible: false,
    };
    if (this.campaign.type === 'hr') {
      result.eligibility = eligibility(this.campaign, this.fields);
      result.recommendation = postCall?.job_related_comments
        ? `${postCall.job_related_comments} Human review required.`
        : 'Review the job-related answers and transcript. A human makes the hiring decision.';
    }
    result.follow_up_eligible = shouldSubmit(result);
    await this.hooks.complete(result);
    this.hooks.event('result', result);
    await this.transport.end();
  }
}
