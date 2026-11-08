import WebSocket from 'ws';
import { FrameBuffer, sse } from '../audio.js';
import type { SttClient, SttEvent, TtsClient } from '../contracts.js';
import { gnaniSttKey, gnaniTtsKey } from '../provider-config.js';
import { acquireSpeechRequest, retryDelay } from './request-queue.js';

export class GnaniSttClient implements SttClient {
  onTurn = (_e: SttEvent) => {};
  onActivity = () => {};
  onError = (_e: Error) => {};
  private ws?: WebSocket;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private frames = new FrameBuffer(1024);
  private queue: Buffer[] = [];
  private endAt?: number;
  constructor(
    private languageCodes: string[],
    private callId: string,
    private key = gnaniSttKey(),
    private endpoint = 'wss://api.vachana.ai/stt/v3/stream',
  ) {}
  async connect() {
    if (!this.key) throw new Error('GNANI_STT or GNANI_API_KEY is required');
    if (!this.languageCodes[0]) throw new Error('Gnani STT language is required');
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.endpoint, {
        handshakeTimeout: 10000,
        headers: {
          'x-api-key-id': this.key!,
          // This streaming endpoint accepts one language code per connection.
          // A comma-separated campaign list causes an immediate provider error.
          language_code: this.languageCodes[0],
          model: 'prisma-v3.0',
          format: 'codemix',
          'x-sample-rate': '8000',
          'x-min-silence-ms': String(Math.min(1000, Math.max(300,
            Number(process.env.GNANI_MIN_SILENCE_MS) || 350))),
          'x-vad-threshold': '0.65',
          'x-api-request-id': this.callId,
        },
      }));
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('Gnani STT readiness timeout'));
      }, 12000);
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string;
            text?: string;
            detected_language_code?: string;
          };
          if (msg.type === 'connected') {
            clearTimeout(timeout);
            resolve();
          }
          if (msg.type === 'speech_start') {
            this.endAt = undefined;
            this.onActivity();
          }
          if (msg.type === 'processing') {
            this.endAt = Date.now();
            this.onActivity();
          }
          if (msg.type === 'transcript' && msg.text?.trim()) {
            this.onTurn({
              text: msg.text,
              language: msg.detected_language_code,
              endOfSpeechAt: this.endAt,
              finalAt: Date.now(),
            });
            this.endAt = undefined;
          }
          if (msg.type === 'error') this.onError(new Error('Gnani STT reported an error'));
        } catch {
          this.onError(new Error('Invalid Gnani STT event'));
        }
      });
      ws.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('Gnani STT connection failed'));
        this.onError(new Error('Gnani STT connection failed'));
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        if (!this.closed) {
          reject(new Error('Gnani STT disconnected'));
          this.onError(new Error('Gnani STT disconnected'));
        }
      });
    });
    this.timer = setInterval(() => {
      const frame = this.queue.shift();
      if (frame && this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
    }, 64);
  }
  sendAudio(pcm: Buffer) {
    this.queue.push(...this.frames.push(pcm));
    if (this.queue.length > 32) {
      this.queue = [];
      this.onError(new Error('STT audio backpressure exceeded'));
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.ws?.close();
    this.queue = [];
  }
}
export class GnaniTtsClient implements TtsClient {
  name = 'Gnani Timbre v3.0';
  constructor(private key = gnaniTtsKey()) {}
  async *synthesize(
    text: string,
    language: string,
    voice: string,
    signal: AbortSignal,
  ): AsyncGenerator<Buffer> {
    if (!this.key) throw new Error('GNANI_TTS or GNANI_API_KEY is required');
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const release = await acquireSpeechRequest(this.key, requestSignal);
    try {
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        response = await fetch('https://api.vachana.ai/api/v1/tts/sse', {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'X-API-Key-ID': this.key,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            text, language, voice, model: 'timbre-v3.0', speed: 1,
            audio_config: {
              sample_rate: 8000, num_channels: 1, sample_width: 2,
              encoding: 'pcm_mulaw', container: 'mulaw',
            },
          }),
        });
        if (![429, 503].includes(response.status) || attempt >= 2) break;
        const seconds = Number(response.headers.get('retry-after') || '0.75');
        const pause = Number.isFinite(seconds) ? Math.max(250, seconds * 1000) : 750;
        if (pause > 2000) break;
        await response.body?.cancel();
        await retryDelay(pause, requestSignal);
      }
      let complete = false;
      for await (const event of sse(response)) {
        if (event.event === 'error' || event.data.type === 'error')
          throw new Error('Gnani TTS synthesis failed');
        if (event.event === 'chunk' && typeof event.data.audio === 'string')
          yield Buffer.from(event.data.audio, 'base64');
        if (event.event === 'complete') complete = true;
      }
      if (!complete) throw new Error('Gnani TTS stream ended without completion');
    } finally {
      release();
    }
  }
}
