import { SarvamAIClient } from 'sarvamai';
import type { SarvamAI } from 'sarvamai';
import { logger } from '../utils/logger.js';
import { mulawToPcm16le, pcm16ToWav } from './mulaw.js';

type SttSocket = Awaited<ReturnType<SarvamAIClient['speechToTextStreaming']['connect']>>;

type FinalTurnHandler = (transcript: string, language: string | undefined) => void;
type ActivityHandler = () => void;
type CloseHandler = (code: number) => void;

const MODEL = process.env.SARVAM_STT_MODEL ?? 'saaras:v3';
// 'unknown' auto-detects across all of Sarvam's supported languages, which
// covers the en/hi/te/ta mix this agent handles — mirrors Soniox's
// enable_language_identification rather than pinning one language up front.
const LANGUAGE_CODE = (process.env.SARVAM_STT_LANGUAGE ?? 'unknown') as SarvamAI.SpeechToTextStreamingLanguageCode;

// Each message sent over the socket is independently wrapped as its own WAV
// clip (see sendAudio() below) — sending one per raw 20ms Twilio frame was
// tried first and accepted with no error, but never produced a transcript or
// VAD signal: 20ms is too short to contain any recognizable speech (300ms
// confirmed to work well). Buffering frames into a window before wrapping
// fixes that, but every ms here is dead air added directly after the caller
// stops talking — the last, most recent words sit in this buffer until it
// fills before Sarvam ever sees them. Tried 100ms (10 msgs/sec) to cut that
// tail latency further, but one real call went completely silent afterward
// — connected fine, zero VAD/transcript events for the whole call — with no
// error logged; plausibly a rate limit or degraded state on Sarvam's side
// that fails silently rather than erroring, though not confirmed. Settled on
// 200ms as a safer middle ground pending more data.
const CHUNK_MS = Number(process.env.SARVAM_STT_CHUNK_MS ?? 200);
const CHUNK_BYTES = CHUNK_MS * 8; // 8kHz mu-law = 1 byte/sample = 8 bytes/ms

// Sarvam's own VAD ends a turn on a much shorter pause than a natural
// mid-sentence thinking pause — confirmed directly on real calls: one
// caller thought ("I have a bakery shop, so I want to sell / cakes in my
// shop / End of the story") arrived as three separate END_SPEECH-finalized
// transcripts a few hundred ms apart. Dispatching each fragment immediately
// as its own "turn" made the agent reply mid-thought, wastefully cancel and
// restart the LLM/TTS on every fragment, and fed the language-switch logic
// confusing single-fragment signals instead of one coherent line. Waiting
// this long after a fragment for a possible continuation, and merging it
// into one turn if the caller keeps talking, fixes all three.
const TURN_DEBOUNCE_MS = Number(process.env.SARVAM_STT_TURN_DEBOUNCE_MS ?? 500);

/** Thin wrapper around Sarvam's real-time STT WebSocket API. Unlike Soniox,
 * this endpoint has no mu-law input option, so Twilio's native 8kHz mulaw
 * frames are decoded to 16-bit PCM before being sent. There's also no
 * token-level is_final flag in the response — each "data" message carries
 * the current transcript for the utterance in progress, and VAD "events"
 * messages (enabled via vad_signals) mark when the caller actually stopped
 * talking. A fragment is closed out on END_SPEECH — but confirmed directly
 * against the API, the transcript for that fragment can arrive either
 * before or after its END_SPEECH event (observed both orders across real
 * calls), so this tracks whichever comes first and closes out on the other.
 * Closed-out fragments are then merged (see finalizeTurn()/TURN_DEBOUNCE_MS)
 * rather than dispatched as their own turn immediately, since Sarvam's VAD
 * often ends a fragment mid-thought. */
export class SarvamSttClient {
  private readonly client: SarvamAIClient;
  private readonly log;
  private socket: SttSocket | undefined;

  private latestTranscript = '';
  private latestLanguage: string | undefined;
  // Set on END_SPEECH when no transcript has arrived yet for that utterance —
  // the next "data" message finalizes the turn instead of just buffering it.
  private awaitingFinalTranscript = false;

  private pendingMulaw: Buffer[] = [];
  private pendingBytes = 0;

  // The turn-in-progress, accumulated across fragments still within the
  // debounce window of each other — see finalizeTurn().
  private mergedTranscript = '';
  private mergedLanguage: string | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  private finalHandlers: FinalTurnHandler[] = [];
  private activityHandlers: ActivityHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(callSid: string) {
    this.log = logger.withCallSid(callSid);
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) throw new Error('Missing SARVAM_API_KEY');
    this.client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  }

  onFinalTurn(handler: FinalTurnHandler): void {
    this.finalHandlers.push(handler);
  }

  /** Fires on the VAD's START_SPEECH signal — used to detect the caller has
   * started talking again, e.g. to trigger a barge-in. */
  onActivity(handler: ActivityHandler): void {
    this.activityHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  async connect(): Promise<void> {
    const socket = await this.client.speechToTextStreaming.connect({
      'language-code': LANGUAGE_CODE,
      model: MODEL as SarvamAI.SpeechToTextStreamingModel,
      input_audio_codec: 'wav' as SarvamAI.SpeechToTextStreamingInputAudioCodec,
      sample_rate: '8000',
      vad_signals: 'true' as SarvamAI.SpeechToTextStreamingVadSignals,
      high_vad_sensitivity: 'true' as SarvamAI.SpeechToTextStreamingHighVadSensitivity,
    });

    // Same quirk as the TTS streaming client: connect() resolves once the
    // underlying WebSocket is constructed, not once it's actually open.
    if (socket.readyState !== 1 /* WebSocket.OPEN */) await socket.waitForOpen();

    socket.on('message', (message) => {
      if (this.socket !== socket) return; // event from a connection we've since replaced
      if (message.type === 'data') {
        const data = message.data as SarvamAI.SpeechToTextTranscriptionData;
        this.latestTranscript = data.transcript ?? '';
        this.latestLanguage = data.language_code;
        this.log.debug('Sarvam STT transcript update', { transcript: this.latestTranscript, language: this.latestLanguage });
        if (this.awaitingFinalTranscript) this.finalizeTurn();
      } else if (message.type === 'events') {
        const events = message.data as SarvamAI.EventsData;
        this.log.debug('Sarvam STT VAD event', { signalType: events.signal_type });
        if (events.signal_type === 'START_SPEECH') {
          for (const handler of this.activityHandlers) handler();
        } else if (events.signal_type === 'END_SPEECH') {
          if (this.latestTranscript.trim()) this.finalizeTurn();
          else this.awaitingFinalTranscript = true;
        }
      } else if (message.type === 'error') {
        this.log.error('Sarvam STT error event', message.data);
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.log.warn('Sarvam STT WS closed');
      this.socket = undefined;
      for (const handler of this.closeHandlers) handler(1000);
    });

    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      this.log.error('Sarvam STT WS error', error);
    });

    this.socket = socket;
    this.log.info('Connected to Sarvam STT');
  }

  private finalizeTurn(): void {
    const transcript = this.latestTranscript.trim();
    const language = this.latestLanguage;
    this.latestTranscript = '';
    this.latestLanguage = undefined;
    this.awaitingFinalTranscript = false;
    if (!transcript) return;

    this.mergedTranscript = this.mergedTranscript ? `${this.mergedTranscript} ${transcript}` : transcript;
    this.mergedLanguage = language ?? this.mergedLanguage;

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.dispatchMergedTurn(), TURN_DEBOUNCE_MS);
  }

  private dispatchMergedTurn(): void {
    const transcript = this.mergedTranscript;
    const language = this.mergedLanguage;
    this.mergedTranscript = '';
    this.mergedLanguage = undefined;
    if (transcript) for (const handler of this.finalHandlers) handler(transcript, language);
  }

  sendAudio(mulawPayload: Buffer): void {
    if (!this.socket || this.socket.readyState !== 1 /* WebSocket.OPEN */) return;
    this.pendingMulaw.push(mulawPayload);
    this.pendingBytes += mulawPayload.length;
    if (this.pendingBytes < CHUNK_BYTES) return;

    const mulaw = Buffer.concat(this.pendingMulaw);
    this.pendingMulaw = [];
    this.pendingBytes = 0;
    const wav = pcm16ToWav(mulawToPcm16le(mulaw), 8000);
    this.socket.transcribe({ audio: wav.toString('base64'), sample_rate: 8000, encoding: 'audio/wav' });
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.pendingMulaw = [];
    this.pendingBytes = 0;
    this.awaitingFinalTranscript = false;
    clearTimeout(this.debounceTimer);
    this.mergedTranscript = '';
    this.mergedLanguage = undefined;
  }
}
