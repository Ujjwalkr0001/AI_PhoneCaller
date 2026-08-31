import { SarvamAIClient } from 'sarvamai';
import type { SarvamAI } from 'sarvamai';
import { logger } from '../utils/logger.js';

// Not exported as a named type from the package's public surface — derived
// structurally from the connect() method's own return type instead.
type TtsSocket = Awaited<ReturnType<SarvamAIClient['textToSpeechStreaming']['connect']>>;

type AudioChunkHandler = (contextId: string, audioBase64: string) => void;
type ContextDoneHandler = (contextId: string) => void;
type CloseHandler = (code: number) => void;

// bulbul:v3 default voice — sounds natural across all 11 supported
// languages (incl. hi-IN/ta-IN/te-IN/en-IN), not tuned per-language here
// since Sarvam doesn't document per-language voice recommendations.
const DEFAULT_SPEAKER = process.env.SARVAM_TTS_SPEAKER || 'shubh';
const MODEL = process.env.SARVAM_TTS_MODEL ?? 'bulbul:v3';

function speakerForLanguage(language: string): string {
  const overrideKey = `SARVAM_TTS_SPEAKER_${language.toUpperCase()}`;
  return process.env[overrideKey] || DEFAULT_SPEAKER;
}

const LANGUAGE_CODES: Record<string, string> = { hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', en: 'en-IN' };
function languageCodeFor(language: string): string {
  return LANGUAGE_CODES[language] ?? 'en-IN';
}

/** Cascaded-pipeline TTS engine backed by Sarvam's Bulbul streaming API.
 *
 * Sarvam's WS protocol has no multiplexed "context" per connection, and no
 * cancel message: one connection carries one turn's text at a time. So
 * barge-in here means dropping the connection outright and reconnecting for
 * the next turn — see cancelContext(). */
export class SarvamTtsClient {
  private readonly client: SarvamAIClient;
  private readonly log;
  private socket: TtsSocket | undefined;
  private connecting: Promise<void> | undefined;
  private configuredLanguage: string | undefined;
  private activeContextId: string | undefined;

  private chunkHandlers: AudioChunkHandler[] = [];
  private doneHandlers: ContextDoneHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(callSid: string) {
    this.log = logger.withCallSid(callSid);
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) throw new Error('Missing SARVAM_API_KEY');
    this.client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  }

  onAudioChunk(handler: AudioChunkHandler): void {
    this.chunkHandlers.push(handler);
  }

  onContextDone(handler: ContextDoneHandler): void {
    this.doneHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  connect(): Promise<void> {
    if (!this.connecting) this.connecting = this.openSocket();
    return this.connecting;
  }

  private async openSocket(): Promise<void> {
    const socket = await this.client.textToSpeechStreaming.connect({
      model: MODEL as SarvamAI.TextToSpeechStreamingModel,
      send_completion_event: 'true',
      reconnectAttempts: 0,
    });

    // The SDK's connect() resolves as soon as the underlying WebSocket is
    // constructed, NOT once it's actually open (confirmed directly in the
    // SDK source — TextToSpeechStreamingClient.connect() returns right after
    // `new ReconnectingWebSocket(...)`, no wait for the 'open' event). Calling
    // configureConnection()/convert() before the real handshake finishes
    // throws synchronously ("Socket is not open"), which — since this runs
    // inside an async callback passed to .then() elsewhere — becomes an
    // unhandled rejection and crashes the whole process. This was masked
    // previously because Sarvam connected eagerly, seconds before anything
    // tried to speak; connecting lazily (on the turn that needs it) removed
    // that accidental buffer. Wait for the real 'open' event before resolving.
    if (socket.readyState !== 1 /* WebSocket.OPEN */) {
      await new Promise<void>((resolve, reject) => {
        socket.on('open', () => resolve());
        socket.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
      });
    }

    socket.on('message', (message) => {
      if (this.socket !== socket) return; // event from a connection we've since replaced
      if (message.type === 'audio') {
        if (!this.activeContextId) return;
        for (const handler of this.chunkHandlers) handler(this.activeContextId, message.data.audio);
      } else if (message.type === 'event' && message.data.event_type === 'final') {
        if (!this.activeContextId) return;
        for (const handler of this.doneHandlers) handler(this.activeContextId);
      } else if (message.type === 'error') {
        this.log.error('Sarvam TTS error event', message.data);
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return; // already superseded — see cancelContext
      this.log.warn('Sarvam TTS WS closed');
      this.socket = undefined;
      this.connecting = undefined;
      for (const handler of this.closeHandlers) handler(1000);
    });

    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      this.log.error('Sarvam TTS WS error', error);
    });

    this.socket = socket;
    this.configuredLanguage = undefined;
    this.log.info('Connected to Sarvam TTS');
  }

  /** Streams one chunk of text. Unlike Cartesia's `continue` flag (which
   * keeps one context's prosody flowing across chunks), Sarvam has no such
   * concept — text just accumulates in its own internal buffer. We only
   * flush() on the last chunk of a turn so the "final" completion event
   * (used for onContextDone) reflects the whole turn being done, not just
   * one intermediate chunk. */
  speak(contextId: string, transcript: string, opts: { language: string; continue: boolean }): void {
    if (!this.socket) return; // not connected — silently drop, same tolerance CartesiaClient has
    this.activeContextId = contextId;

    const languageCode = languageCodeFor(opts.language);
    if (this.configuredLanguage !== languageCode) {
      this.socket.configureConnection({
        language_code: languageCode as SarvamAI.ConfigureConnection.Data.LanguageCode,
        speaker: speakerForLanguage(opts.language) as SarvamAI.ConfigureConnection.Data.Speaker,
        output_audio_codec: 'mulaw' as SarvamAI.ConfigureConnection.Data.OutputAudioCodec,
        speech_sample_rate: 8000,
      });
      this.configuredLanguage = languageCode;
    }

    // Sarvam's convert() rejects a transcript with no letters at all (e.g. a
    // chunk that's purely digits/punctuation, like a bare number or a stray
    // trailing "." on its own) with a fatal 422 that drops the whole socket
    // — confirmed directly against the API. Skip just that chunk's text
    // instead of losing the connection for the rest of the call; still
    // flush() on the final chunk so the turn closes out normally.
    if (/\p{L}/u.test(transcript)) {
      this.socket.convert(transcript);
    } else {
      this.log.warn('Skipping Sarvam TTS for a chunk with no letters', { transcript });
    }
    if (!opts.continue) this.socket.flush();
  }

  /** No true per-turn cancel exists in Sarvam's protocol — the only way to
   * stop an in-flight generation is to drop the connection outright. Clears
   * state before closing (so the deferred 'close' event sees a superseded
   * socket and skips notifying closeHandlers — this is an intentional,
   * self-healing close, not a real disconnect) and immediately reconnects
   * in the background for the next turn. */
  cancelContext(contextId: string): void {
    if (contextId !== this.activeContextId || !this.socket) return;
    const stale = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    this.activeContextId = undefined;
    stale.close();
    void this.connect().catch((error) => this.log.error('Sarvam TTS reconnect after barge-in failed', error));
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.connecting = undefined;
  }
}
