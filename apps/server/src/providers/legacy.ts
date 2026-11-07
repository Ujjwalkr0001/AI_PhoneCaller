import { SonioxClient } from '../../../../src/cascaded/soniox-client.js';
import { CartesiaClient } from '../../../../src/cascaded/cartesia-client.js';
import { SarvamTtsClient } from '../../../../src/cascaded/sarvam-tts-client.js';
import { mulawToPcm16le, pcmToMulaw } from '../audio.js';
import type { SttClient, SttEvent, TtsClient } from '../contracts.js';
export class SonioxAdapter implements SttClient {
  onTurn = (_e: SttEvent) => {}; onActivity = () => {}; onError = (_e: Error) => {};
  private client: SonioxClient; private closed = false;
  constructor(id: string) {
    this.client = new SonioxClient(id);
    this.client.onFinalTurn((text, language) => this.onTurn({ text, language, finalAt: Date.now() }));
    this.client.onActivity(() => this.onActivity()); this.client.onClose(() => { if (!this.closed) this.onError(new Error('Soniox disconnected')); });
  }
  connect() { return this.client.connect(); }
  sendAudio(pcm: Buffer) { this.client.sendAudio(pcmToMulaw(pcm)); }
  close() { this.closed = true; this.client.close(); }
}
export class LegacyTtsAdapter implements TtsClient {
  name: string;
  constructor(private provider: 'cartesia' | 'sarvam', private callId: string) { this.name = provider; }
  async *synthesize(text: string, language: string, _voice: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    const engine = this.provider === 'sarvam' ? new SarvamTtsClient(this.callId) : new CartesiaClient(this.callId);
    const chunks: Buffer[] = []; let done = false; let error: Error | undefined; let wake: (() => void) | undefined;
    engine.onAudioChunk((_id, audio) => { chunks.push(Buffer.from(audio, 'base64')); wake?.(); });
    engine.onContextDone(() => { done = true; wake?.(); }); engine.onClose(() => { error = new Error(`${this.name} stream closed`); wake?.(); });
    const abort = () => { done = true; wake?.(); engine.close(); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { error = new Error('Fallback TTS timeout'); wake?.(); }, 20000);
    try {
      await engine.connect(); engine.speak(this.callId, text, { language: language.slice(0, 2), continue: false });
      while (!done || chunks.length) {
        if (signal.aborted) return;
        if (error) throw error;
        if (chunks.length) yield chunks.shift()!;
        else await new Promise<void>(r => { wake = r; });
      }
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); engine.close(); }
  }
}
// Re-export decoded audio for protocol tests; legacy engines emit μ-law already.
export { mulawToPcm16le };
