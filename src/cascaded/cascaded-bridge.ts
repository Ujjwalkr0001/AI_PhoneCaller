import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { appendTranscript } from '../state/call-session.js';
import { SonioxClient } from './soniox-client.js';
import { CartesiaClient } from './cartesia-client.js';
import { SarvamTtsClient } from './sarvam-tts-client.js';
import type { TtsEngine } from './tts-engine.js';
import { DialogueClient } from './dialogue-client.js';
import { RoomNoiseMixer } from './room-noise.js';
import { MULAW_SILENCE_BYTE } from './mulaw.js';
import { hangupCall } from '../services/twilio.js';
import {
  outboundMediaMessage,
  outboundClearMessage,
  type TwilioMediaEvent,
  type TwilioMarkEvent,
} from '../realtime/twilio-media-events.js';
import { logger } from '../utils/logger.js';

const SILENCE_TAIL_MS = 300; // pads each turn so Twilio doesn't clip the last word

const SENTENCE_END = /[.!?।](\s|$)/;
const CLAUSE_BREAK = /[,](\s|$)/;
const MAX_CHUNK_CHARS = 150;
// Waiting for a full first sentence before Cartesia hears anything was most
// of the "long pause, then she talks" feel — flushing a short first clause
// gets audio started much sooner, at the cost of slightly choppier prosody
// on just that opening fragment.
const FIRST_CHUNK_MAX_CHARS = 28;
const FIRST_CHUNK_CLAUSE_MIN_CHARS = 10;

/** Picks the TTS language from the actual script of the generated text
 * (Devanagari/Telugu/Tamil Unicode ranges vs Latin), rather than guessing
 * from the caller's last language — this is ground truth for what Cartesia
 * needs to render, and lets one reply code-switch sentence-by-sentence
 * correctly. */
function scriptLanguage(text: string): 'hi' | 'te' | 'ta' | 'en' {
  const counts: Record<'hi' | 'te' | 'ta', number> = {
    hi: (text.match(/[ऀ-ॿ]/g) ?? []).length,
    te: (text.match(/[ఀ-౿]/g) ?? []).length,
    ta: (text.match(/[஀-௿]/g) ?? []).length,
  };
  const [best, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0] as ['hi' | 'te' | 'ta', number];
  return count > 0 ? best : 'en';
}

/** Cascaded alternative to AudioBridge: Soniox (STT) -> DialogueClient (LLM)
 * -> Cartesia (TTS), instead of one integrated OpenAI Realtime session.
 * Twilio's native 8kHz mulaw is fed to Soniox and produced by Cartesia
 * directly, so no resampling is needed anywhere in this bridge. */
/** TTS_PROVIDER, if set to "sarvam" or "cartesia", forces every chunk onto
 * that one engine (for A/B testing). Left unset, it's routed per-chunk by
 * the actual script of the text about to be spoken: Tamil goes to Sarvam,
 * everything else (Hindi, Telugu, English) goes to Cartesia. This mirrors
 * resolveDialogueProvider() in dialogue-client.ts, but keyed off
 * scriptLanguage() (the literal text being spoken) rather than the caller's
 * detected language, since that's the existing, correct signal for TTS. */
function resolveTtsProvider(language: string): 'sarvam' | 'cartesia' {
  const override = process.env.TTS_PROVIDER?.toLowerCase();
  if (override === 'sarvam' || override === 'cartesia') return override;
  return language === 'ta' ? 'sarvam' : 'cartesia';
}

export class CascadedBridge {
  private readonly soniox: SonioxClient;
  private readonly ttsCartesia: TtsEngine;
  private readonly ttsSarvam: TtsEngine;
  private readonly dialogue: DialogueClient;
  private readonly roomNoise = new RoomNoiseMixer();
  private readonly log;

  private closed = false;
  private speaking = false;
  private currentContextId: string | undefined;
  // Whichever engine most recently had speak() called for the still-current
  // context — the one handleBargeIn() must cancel. A turn can in principle
  // code-switch across engines mid-turn (Tamil sentence then Hindi
  // sentence); only the latest one is worth canceling — anything earlier
  // has either already finished or has nothing left in flight to stop.
  private activeTts: TtsEngine | undefined;
  // True once the current turn has actually sent its TTS engine a first
  // chunk. Before that, the engine has no context to cancel — telling it to
  // cancel one it never heard of is what was producing "Invalid context ID"
  // errors, and it happens exactly when the caller starts talking again
  // before the agent's reply has made any sound yet (i.e. the agent is
  // being too slow).
  private turnHasAudio = false;
  private sentenceBuffer = '';
  private turnCounter = 0;

  // Language actually established for replies, plus a pending challenger and
  // Language actually established for replies — see resolveLanguageHint().
  // Starts 'en' since the greeting always opens in English.
  private establishedLanguage = 'en';

  private durationTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Guards against the duration guard and idle timeout both firing a
  // farewell/hangup for the same call.
  private ending = false;

  constructor(private readonly session: CallSession, private readonly twilioWs: WebSocket) {
    this.log = logger.withCallSid(session.callSid);
    this.soniox = new SonioxClient(session.callSid);
    this.ttsCartesia = new CartesiaClient(session.callSid);
    this.ttsSarvam = new SarvamTtsClient(session.callSid);
    this.dialogue = new DialogueClient(session);
  }

  async start(): Promise<void> {
    this.wireClients();
    // Don't serialize the WS handshakes in front of the greeting — Soniox
    // only needs to be ready by the time the caller might speak (well after
    // the greeting starts streaming), and Cartesia only needs to be ready by
    // the time the greeting's first flushed chunk is ready to speak. Both
    // engines connect eagerly since either could end up handling a later
    // turn depending on its language, but the greeting itself is always
    // English, so it only ever waits on Cartesia — gating it on Sarvam too
    // was adding several extra seconds of dead air before the caller heard
    // anything, for a connection the greeting was never going to use.
    const sonioxConnect = this.soniox.connect().catch((error) => {
      this.log.error('Soniox connect failed', error);
    });
    const cartesiaConnect = this.ttsCartesia.connect().catch((error) => {
      this.log.error('Cartesia connect failed', error);
    });
    // Sarvam is NOT connected eagerly here — per-language routing means most
    // calls (English/Hindi/Telugu) never touch it, and an eager connection
    // just sits idle until Sarvam's server times it out around 60s in,
    // logging a spurious "TTS connection lost mid-call" error. Connected
    // lazily instead, the first time a Tamil-scripted chunk actually needs
    // it (see flush() below).

    // Outbound sales call: the agent greets the caller proactively.
    await this.speakTurn(undefined, undefined, cartesiaConnect);
    await sonioxConnect;

    this.armDurationGuard();
    this.armIdleTimer();
  }

  private sendSilenceTail(): void {
    if (!this.session.streamSid) return;
    const bytes = Math.round((8000 * SILENCE_TAIL_MS) / 1000); // 1 byte/sample @ 8kHz mu-law
    const silence = Buffer.alloc(bytes, MULAW_SILENCE_BYTE);
    this.twilioWs.send(outboundMediaMessage(this.session.streamSid, silence.toString('base64')));
  }

  private armDurationGuard(): void {
    const minutes = Number(process.env.MAX_CALL_MINUTES ?? 6);
    this.durationTimer = setTimeout(
      () =>
        void this.endCallWithFarewell(
          'Maximum call duration reached. Give one brief, warm goodbye in the ' +
            'language you were just speaking — do not mention time limits — then stop.'
        ),
      minutes * 60 * 1000
    );
  }

  /** (Re)starts the silence-since-caller-last-spoke clock. Called once after
   * the greeting and again every time the caller's turn actually finishes,
   * so it measures dead air waiting for a response, not the agent's own
   * talking time. */
  private armIdleTimer(): void {
    clearTimeout(this.idleTimer);
    const seconds = Number(process.env.IDLE_TIMEOUT_SECONDS ?? 45);
    this.idleTimer = setTimeout(
      () =>
        void this.endCallWithFarewell(
          'The caller has gone silent for a while. Give one brief, warm goodbye in ' +
            'the language you were just speaking, then stop.'
        ),
      seconds * 1000
    );
  }

  private async endCallWithFarewell(nudge: string): Promise<void> {
    if (this.ending || this.closed) return;
    this.ending = true;
    clearTimeout(this.durationTimer);
    clearTimeout(this.idleTimer);

    this.dialogue.pushSystemNudge(nudge);
    await this.speakTurn().catch((error) => this.log.error('Farewell turn failed', error));

    const delayMs = Number(process.env.END_CALL_HANGUP_DELAY_MS ?? 3000);
    setTimeout(() => {
      hangupCall(this.session.callSid).catch((error) => this.log.error('Failed to hang up call', error));
    }, delayMs);
  }

  /** Switches on the first substantial (>=12 char) line in a new language —
   * a caller giving one clean, real sentence in a new language expects the
   * agent to follow immediately, not wait for a second confirming line. A
   * two-consecutive-turn hysteresis was tried here to fight erratic
   * flip-flopping during rapid, chaotic code-switching (multiple background
   * voices swapping languages line by line), but it made the far more common
   * case — a caller genuinely switching once and staying there — feel
   * laggy/wrong, which is worse. A short utterance (a filler word, "okay", a
   * name) still doesn't count as a turn at all, matching the prompt's own "a
   * word or two isn't a real switch" rule. */
  private resolveLanguageHint(transcript: string, detected: string | undefined): string {
    if (transcript.trim().length >= 12 && detected) this.establishedLanguage = detected;
    return this.establishedLanguage;
  }

  private wireClients(): void {
    this.soniox.onFinalTurn((transcript, language) => {
      appendTranscript(this.session, 'caller', transcript);
      const languageHint = this.resolveLanguageHint(transcript, language);
      if (!this.ending) this.armIdleTimer(); // caller spoke — reset the silence clock
      void this.speakTurn(transcript, languageHint).catch((error) =>
        this.log.error('Turn processing failed', error)
      );
    });
    this.soniox.onActivity(() => this.handleBargeIn());
    this.soniox.onClose(() => {
      if (!this.closed) this.log.error('Soniox connection lost mid-call');
    });

    for (const engine of [this.ttsCartesia, this.ttsSarvam]) {
      // Both engines share the same handlers — whichever one is actually
      // producing audio for the current context is the one whose contextId
      // matches below; the idle engine's calls just no-op on that check.
      engine.onAudioChunk((contextId, audioBase64) => {
        if (contextId !== this.currentContextId || !this.session.streamSid) return;
        const noisy = this.roomNoise.mixIntoMulaw(Buffer.from(audioBase64, 'base64'));
        this.twilioWs.send(outboundMediaMessage(this.session.streamSid, noisy.toString('base64')));
      });
      engine.onContextDone((contextId) => {
        // Only pad on a turn that actually finished on its own — a barge-in
        // already cleared Twilio's buffer and moved currentContextId on, so
        // this stale onContextDone for the old context must not re-open audio.
        if (contextId !== this.currentContextId) return;
        this.sendSilenceTail();
        this.speaking = false;
      });
      engine.onClose(() => {
        if (!this.closed) this.log.error('TTS connection lost mid-call');
      });
    }
  }

  handleTwilioMedia(evt: TwilioMediaEvent): void {
    this.soniox.sendAudio(Buffer.from(evt.media.payload, 'base64'));
  }

  handleTwilioMark(_evt: TwilioMarkEvent): void {
    // No mark-based playback tracking needed — Cartesia's context lifecycle
    // (onContextDone) already tells us when the assistant has finished.
  }

  private handleBargeIn(): void {
    if (!this.speaking || !this.currentContextId) return;

    if (this.turnHasAudio) this.activeTts?.cancelContext(this.currentContextId);
    this.dialogue.cancel();
    if (this.session.streamSid) this.twilioWs.send(outboundClearMessage(this.session.streamSid));

    this.speaking = false;
    this.currentContextId = undefined;
    this.sentenceBuffer = '';
  }

  private async speakTurn(
    userText?: string,
    language?: string,
    ttsReady: Promise<void> = Promise.resolve()
  ): Promise<void> {
    const contextId = `${this.session.callSid}-${this.turnCounter++}`;
    this.currentContextId = contextId;
    this.speaking = true;
    this.turnHasAudio = false;
    this.sentenceBuffer = '';
    let assistantText = '';
    let chunksSent = 0;

    const flush = (isFinal: boolean) => {
      const text = this.sentenceBuffer.trim();
      this.sentenceBuffer = '';
      // The TTS engine rejects an empty transcript — if there's nothing left
      // over at turn-end, the last non-final chunk already carries the
      // audio, so there's nothing to close out.
      if (!text) return;
      if (contextId !== this.currentContextId) return; // canceled by a barge-in mid-turn
      chunksSent++;
      // On the greeting turn, the TTS handshake races the LLM call instead
      // of gating it — wait for it right here, at the one point that actually
      // needs the socket open, instead of blocking generation on it up front.
      // The whole body is wrapped in try/catch: this runs inside an async
      // function passed to .then() with no .catch() on the chain, so any
      // throw — including a synchronous one from engine.speak() itself, not
      // just a rejected connect() — becomes an unhandled promise rejection,
      // which Node treats as fatal and crashes the whole server (confirmed:
      // an SDK quirk in Sarvam's speak() did exactly this).
      void ttsReady.then(async () => {
        try {
          if (contextId !== this.currentContextId) return; // canceled while waiting to connect
          const language = scriptLanguage(text);
          const useSarvam = resolveTtsProvider(language) === 'sarvam';
          const engine = useSarvam ? this.ttsSarvam : this.ttsCartesia;
          // Sarvam connects lazily (see start()) — only await/establish it
          // here, on the turn that actually needs it, instead of on every call.
          if (useSarvam) {
            await engine.connect();
            if (contextId !== this.currentContextId) return; // canceled while connecting
          }
          this.turnHasAudio = true;
          this.activeTts = engine;
          engine.speak(contextId, text, { language, continue: !isFinal });
        } catch (error) {
          this.log.error('TTS speak failed', error);
        }
      });
    };

    await this.dialogue.generateReply(
      (delta) => {
        if (contextId !== this.currentContextId) return; // canceled mid-stream
        assistantText += delta;
        this.sentenceBuffer += delta;

        const isFirstChunk = chunksSent === 0;
        const maxChars = isFirstChunk ? FIRST_CHUNK_MAX_CHARS : MAX_CHUNK_CHARS;
        const brokeOnClause =
          isFirstChunk && this.sentenceBuffer.length > FIRST_CHUNK_CLAUSE_MIN_CHARS && CLAUSE_BREAK.test(this.sentenceBuffer);

        if (SENTENCE_END.test(this.sentenceBuffer) || brokeOnClause || this.sentenceBuffer.length > maxChars) {
          flush(false);
        }
      },
      userText,
      language
    );

    // Logged even when canceled by a barge-in (contextId no longer current)
    // — that text still actually played through TTS before being cut off,
    // and hiding it from the transcript was hiding this exact class of bug
    // from the very file used to review calls. Only the final TTS flush is
    // skipped on cancellation — its audio was already stopped, so there's
    // nothing left to flush.
    if (contextId === this.currentContextId) flush(true);
    if (assistantText.trim()) appendTranscript(this.session, 'agent', assistantText.trim());
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.durationTimer);
    clearTimeout(this.idleTimer);
    this.soniox.close();
    this.ttsCartesia.close();
    this.ttsSarvam.close();
  }
}
