import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

type AudioChunkHandler = (contextId: string, audioBase64: string) => void;
type ContextDoneHandler = (contextId: string) => void;
type CloseHandler = (code: number) => void;

// Sindhu — native Hindi/Telugu/Tamil voice with no English-native accent to
// fight against, so cross-lingual English comes out Indian-accented rather
// than American. Female voices test better for outbound sales calls here.
export const DEFAULT_VOICE_ID = '07bc462a-c644-49f1-baf7-82d5599131be'; // Sindhu — Conversational Partner

export function voiceIdForLanguage(language: string): string {
  const overrideKey = `CARTESIA_VOICE_ID_${language.toUpperCase()}`;
  return process.env[overrideKey] || process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID;
}

/** Thin wrapper around Cartesia's streaming TTS WebSocket API. Outputs raw
 * 8kHz mulaw directly, matching Twilio's native format — no resampling
 * needed. One connection multiplexes multiple concurrent "contexts"
 * (one per assistant turn), identified by contextId. */
export class CartesiaClient {
  private ws: WebSocket | undefined;
  private readonly log;
  private chunkHandlers: AudioChunkHandler[] = [];
  private doneHandlers: ContextDoneHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(callSid: string) {
    this.log = logger.withCallSid(callSid);
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
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) throw new Error('Missing CARTESIA_API_KEY');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://api.cartesia.ai/tts/websocket?cartesia_version=2024-11-13', {
        headers: { 'X-API-Key': apiKey },
      });

      this.ws.once('open', () => {
        this.log.info('Connected to Cartesia');
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));

      this.ws.once('error', (error) => {
        this.log.error('Cartesia WS error', error);
        reject(error);
      });

      this.ws.on('close', (code) => {
        this.log.warn('Cartesia WS closed', { code });
        for (const handler of this.closeHandlers) handler(code);
      });
    });
  }

  /** Streams one chunk of text into a context. Call with `continue: true` for
   * every chunk except the last one in a turn, so Cartesia keeps the audio
   * flowing continuously instead of restarting prosody per chunk. */
  speak(contextId: string, transcript: string, opts: { language: string; continue: boolean }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        model_id: process.env.CARTESIA_MODEL ?? 'sonic-3.5',
        transcript,
        voice: { mode: 'id', id: voiceIdForLanguage(opts.language) },
        output_format: { container: 'raw', encoding: 'pcm_mulaw', sample_rate: 8000 },
        language: opts.language,
        context_id: contextId,
        continue: opts.continue,
      })
    );
  }

  /** Stops generation for an in-flight context — used for barge-in. */
  cancelContext(contextId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ context_id: contextId, cancel: true }));
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'error') {
      this.log.error('Cartesia error event', msg);
      return;
    }

    if (msg.type === 'chunk' && typeof msg.data === 'string' && typeof msg.context_id === 'string') {
      for (const handler of this.chunkHandlers) handler(msg.context_id, msg.data);
    }

    if (msg.done && typeof msg.context_id === 'string') {
      for (const handler of this.doneHandlers) handler(msg.context_id);
    }
  }

  close(): void {
    this.ws?.close();
  }
}
