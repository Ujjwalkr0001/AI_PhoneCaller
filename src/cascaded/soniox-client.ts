import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

interface SonioxToken {
  text: string;
  is_final?: boolean;
  language?: string;
}

type FinalTurnHandler = (transcript: string, language: string | undefined) => void;
type ActivityHandler = () => void;
type CloseHandler = (code: number) => void;

/** Picks the language with the most transcribed characters in the turn — a
 * proxy for "which language dominated this line" that the sales prompt's
 * own 80%-dominance language-switching rule reasons about. */
function dominantLanguage(tokens: SonioxToken[]): string | undefined {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (!token.language) continue;
    counts.set(token.language, (counts.get(token.language) ?? 0) + token.text.length);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

/** Thin wrapper around Soniox's real-time STT WebSocket API, fed Twilio's
 * native 8kHz mulaw frames directly (no resampling needed). */
export class SonioxClient {
  private ws: WebSocket | undefined;
  private readonly log;
  private finalTokens: SonioxToken[] = [];
  private finalHandlers: FinalTurnHandler[] = [];
  private activityHandlers: ActivityHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(callSid: string) {
    this.log = logger.withCallSid(callSid);
  }

  onFinalTurn(handler: FinalTurnHandler): void {
    this.finalHandlers.push(handler);
  }

  /** Fires on any transcription activity (interim or final) — used to detect
   * the caller has started talking again, e.g. to trigger a barge-in. */
  onActivity(handler: ActivityHandler): void {
    this.activityHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  connect(): Promise<void> {
    const apiKey = process.env.SONIOX_API_KEY;
    if (!apiKey) throw new Error('Missing SONIOX_API_KEY');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

      this.ws.once('open', () => {
        this.send({
          api_key: apiKey,
          model: process.env.SONIOX_MODEL ?? 'stt-rt-v5',
          audio_format: 'mulaw',
          sample_rate: 8000,
          num_channels: 1,
          language_hints: ['en', 'hi', 'te', 'ta'],
          enable_language_identification: true,
          enable_endpoint_detection: true,
          // Default is 2000ms of silence before a turn is considered over —
          // that alone was most of the "long pause before she answers" feel.
          // Was pushed down to 500ms for snappier replies, but real calls
          // showed that's too short: a caller pausing mid-sentence to think
          // ("I have a bakery shop, so I want to list the cakes— / Over
          // there.") gets cut into multiple separate "final" turns, and the
          // agent replies to each fragment as if it were the whole answer —
          // reading as the agent not listening / talking over itself.
          max_endpoint_delay_ms: Number(process.env.SONIOX_ENDPOINT_DELAY_MS ?? 800),
        });
        this.log.info('Connected to Soniox');
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));

      this.ws.once('error', (error) => {
        this.log.error('Soniox WS error', error);
        reject(error);
      });

      this.ws.on('close', (code) => {
        this.log.warn('Soniox WS closed', { code });
        for (const handler of this.closeHandlers) handler(code);
      });
    });
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  sendAudio(mulawPayload: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(mulawPayload);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.error_code) {
      this.log.error('Soniox error event', msg);
      return;
    }

    const tokens: SonioxToken[] = Array.isArray(msg.tokens) ? msg.tokens : [];
    if (tokens.length) for (const handler of this.activityHandlers) handler();

    for (const token of tokens) {
      if (token.text === '<end>') {
        const transcript = this.finalTokens
          .map((t) => t.text)
          .join('')
          .trim();
        const language = dominantLanguage(this.finalTokens);
        this.finalTokens = [];
        if (transcript) for (const handler of this.finalHandlers) handler(transcript, language);
        continue;
      }
      if (token.is_final) this.finalTokens.push(token);
    }
  }

  close(): void {
    this.ws?.close();
  }
}
