import WebSocket from 'ws';
import { FrameBuffer, sse } from '../audio.js';
import type { SttClient, SttEvent, TtsClient } from '../contracts.js';

export class GnaniSttClient implements SttClient {
  onTurn = (_e: SttEvent) => {}; onActivity = () => {}; onError = (_e: Error) => {};
  private ws?: WebSocket; private timer?: ReturnType<typeof setInterval>; private closed = false;
  private frames = new FrameBuffer(1024); private queue: Buffer[] = []; private endAt?: number;
  constructor(private languageCodes: string[], private callId: string, private key = process.env.GNANI_API_KEY) {}
  async connect() {
    if (!this.key) throw new Error('GNANI_API_KEY is required');
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws = new WebSocket('wss://api.vachana.ai/stt/v3/stream', { handshakeTimeout: 10000, headers: {
        'x-api-key-id': this.key!, language_code: this.languageCodes.join(','), model: 'prisma-v3.0', format: 'codemix',
        'x-sample-rate': '8000', 'x-min-silence-ms': '500', 'x-vad-threshold': '0.65', 'x-api-request-id': this.callId,
      } });
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Gnani STT readiness timeout')); }, 12000);
      ws.on('message', raw => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; text?: string; detected_language_code?: string };
          if (msg.type === 'connected') { clearTimeout(timeout); resolve(); }
          if (msg.type === 'speech_start') this.onActivity();
          if (msg.type === 'processing') { this.endAt = Date.now(); this.onActivity(); }
          if (msg.type === 'transcript' && msg.text?.trim()) this.onTurn({ text: msg.text, language: msg.detected_language_code, endOfSpeechAt: this.endAt, finalAt: Date.now() });
          if (msg.type === 'error') this.onError(new Error('Gnani STT reported an error'));
        } catch { this.onError(new Error('Invalid Gnani STT event')); }
      });
      ws.on('error', () => { clearTimeout(timeout); reject(new Error('Gnani STT connection failed')); this.onError(new Error('Gnani STT connection failed')); });
      ws.on('close', () => { clearTimeout(timeout); if (!this.closed) { reject(new Error('Gnani STT disconnected')); this.onError(new Error('Gnani STT disconnected')); } });
    });
    this.timer = setInterval(() => {
      const frame = this.queue.shift();
      if (frame && this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
    }, 64);
  }
  sendAudio(pcm: Buffer) {
    this.queue.push(...this.frames.push(pcm));
    if (this.queue.length > 32) { this.queue = []; this.onError(new Error('STT audio backpressure exceeded')); }
  }
  close() { this.closed = true; clearInterval(this.timer); this.ws?.close(); this.queue = []; }
}
export class GnaniTtsClient implements TtsClient {
  name = 'Gnani Timbre v3.0';
  constructor(private key = process.env.GNANI_API_KEY) {}
  async *synthesize(text: string, language: string, voice: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    if (!this.key) throw new Error('GNANI_API_KEY is required');
    const response = await fetch('https://api.vachana.ai/api/v1/tts/sse', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), headers: {
      'X-API-Key-ID': this.key, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    }, body: JSON.stringify({ text, language, voice, model: 'timbre-v3.0', speed: 1,
      audio_config: { sample_rate: 8000, num_channels: 1, sample_width: 2, encoding: 'pcm_mulaw', container: 'mulaw' } }) });
    let complete = false;
    for await (const event of sse(response)) {
      if (event.event === 'error' || event.data.type === 'error') throw new Error('Gnani TTS synthesis failed');
      if (event.event === 'chunk' && typeof event.data.audio === 'string') yield Buffer.from(event.data.audio, 'base64');
      if (event.event === 'complete') complete = true;
    }
    if (!complete) throw new Error('Gnani TTS stream ended without completion');
  }
}
