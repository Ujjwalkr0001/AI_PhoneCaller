import type { TtsClient } from '../contracts.js';

/** Per-call cache for upcoming fixed questions; generated replies are never cached. */
export class PreparedSpeech {
  private entries = new Map<string, Promise<Buffer[]>>();
  private ready = new Set<string>();
  private abort = new AbortController();
  constructor(
    private engine: TtsClient,
    private onGenerate: (chars: number) => Promise<void>,
  ) {}
  private key(text: string, language: string, voice: string) {
    return `${language}:${voice}:${text}`;
  }
  prepare(text: string, language: string, voice: string) {
    const key = this.key(text, language, voice);
    if (this.entries.has(key) || this.entries.size >= 24 || this.abort.signal.aborted) return;
    const pending = (async () => {
      await this.onGenerate(text.length);
      const chunks: Buffer[] = [];
      for await (const chunk of this.engine.synthesize(text, language, voice, this.abort.signal))
        chunks.push(chunk);
      this.ready.add(key);
      return chunks;
    })();
    this.entries.set(key, pending);
    void pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
  }
  has(text: string, language: string, voice: string) {
    return this.ready.has(this.key(text, language, voice));
  }
  async *synthesize(text: string, language: string, voice: string, signal: AbortSignal) {
    const cached = this.entries.get(this.key(text, language, voice));
    if (cached) {
      try {
        for (const chunk of await cached) {
          if (signal.aborted) return;
          yield chunk;
        }
        return;
      } catch {
        if (signal.aborted) return;
        // A failed background preparation can be retried through normal streaming.
      }
    }
    if (signal.aborted) return;
    await this.onGenerate(text.length);
    for await (const chunk of this.engine.synthesize(text, language, voice, signal)) yield chunk;
  }
  close() {
    this.abort.abort();
    this.entries.clear();
    this.ready.clear();
  }
}
