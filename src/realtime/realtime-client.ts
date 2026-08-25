import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RealtimeClientOptions {
  instructions: string;
  tools: RealtimeToolDefinition[];
  callSid: string;
}

type EventHandler = (event: any) => void;

/**
 * Thin wrapper around the OpenAI Realtime WebSocket API.
 *
 * Session shape verified against the official Twilio reference
 * implementation (github.com/twilio-samples/speech-assistant-openai-realtime-api-node).
 * One known unsettled point: OpenAI's docs name the audio delta event
 * `response.output_audio.delta`, but some session/API-version combos still
 * emit the older `response.audio.delta` — the bridge listens for both.
 */
export class RealtimeClient {
  private ws: WebSocket | undefined;
  private handlers: EventHandler[] = [];
  private closeHandlers: Array<(code: number) => void> = [];
  private readonly log;

  constructor(private readonly options: RealtimeClientOptions) {
    this.log = logger.withCallSid(options.callSid);
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /** Fires on any WS close, including after a successful connection — used for reconnect logic. */
  onClose(handler: (code: number) => void): void {
    this.closeHandlers.push(handler);
  }

  connect(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    const model = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      this.ws.once('open', () => {
        this.log.info('Connected to OpenAI Realtime API', { model });
        this.send(this.buildSessionUpdate());
        resolve();
      });

      this.ws.on('message', (data) => {
        let event: any;
        try {
          event = JSON.parse(data.toString());
        } catch {
          return;
        }
        for (const handler of this.handlers) handler(event);
      });

      this.ws.once('error', (error) => {
        this.log.error('Realtime WS error', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        this.log.warn('Realtime WS closed', { code, reason: reason.toString() });
        for (const handler of this.closeHandlers) handler(code);
      });
    });
  }

  private buildSessionUpdate() {
    const model = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        model,
        output_modalities: ['audio'],
        instructions: this.options.instructions,
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            // Noise suppression does the work of rejecting caller-side background
            // noise, so turn_detection can stay close to stock sensitivity — that
            // keeps real speech registering (and barge-in firing) near-instantly,
            // instead of raising the threshold and dulling genuine interruptions.
            noise_reduction: { type: process.env.OPENAI_NOISE_REDUCTION_MODE ?? 'near_field' },
            turn_detection: {
              type: 'server_vad',
              threshold: Number(process.env.OPENAI_VAD_THRESHOLD ?? 0.5),
              prefix_padding_ms: Number(process.env.OPENAI_VAD_PREFIX_PADDING_MS ?? 300),
              silence_duration_ms: Number(process.env.OPENAI_VAD_SILENCE_MS ?? 250),
            },
            transcription: { model: 'whisper-1' },
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: 'alloy',
          },
        },
        tools: this.options.tools,
      },
    };
  }

  appendInputAudio(base64Payload: string): void {
    this.send({ type: 'input_audio_buffer.append', audio: base64Payload });
  }

  cancelResponse(): void {
    this.send({ type: 'response.cancel' });
  }

  truncateItem(itemId: string, audioEndMs: number): void {
    this.send({ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: audioEndMs });
  }

  sendToolResult(callId: string, output: unknown): void {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    });
    this.send({ type: 'response.create' });
  }

  send(event: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  close(): void {
    this.ws?.close();
  }
}
