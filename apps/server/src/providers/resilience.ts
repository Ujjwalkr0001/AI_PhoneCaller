import type { TtsClient } from '../contracts.js';
export class CircuitBreaker {
  failures = 0; openUntil = 0;
  constructor(private threshold = 3, private cooldown = 30000) {}
  get open() { return Date.now() < this.openUntil; }
  success() { this.failures = 0; this.openUntil = 0; }
  fail() { if (++this.failures >= this.threshold) this.openUntil = Date.now() + this.cooldown; }
}
export class ResilientTts implements TtsClient {
  name: string; readonly breaker = new CircuitBreaker();
  constructor(private primary: TtsClient, private fallback: TtsClient | undefined, private trace: (provider: string, event: string) => void) { this.name = primary.name; }
  async *synthesize(text: string, language: string, voice: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    let emitted = false;
    try {
      if (this.breaker.open) throw new Error('Circuit open');
      this.trace(this.primary.name, 'selected');
      for await (const chunk of this.primary.synthesize(text, language, voice, signal)) { emitted = true; yield chunk; }
      this.breaker.success();
    } catch (error) {
      if (signal.aborted) throw error;
      this.breaker.fail(); this.trace(this.primary.name, 'failed');
      // Never replay an already partly-spoken sentence through another provider.
      if (!this.fallback || emitted) throw error;
      this.trace(this.fallback.name, 'failover');
      for await (const chunk of this.fallback.synthesize(text, language, voice, signal)) yield chunk;
    }
  }
}
export class PhraseCache implements TtsClient {
  name: string; private cache = new Map<string, Buffer[]>();
  constructor(private engine: TtsClient, private maxEntries = 100) { this.name = engine.name; }
  async *synthesize(text: string, language: string, voice: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    const key = `${this.engine.name}:${language}:${voice}:${text}`;
    // Cache only fixed phrases and disclosure; never contact-specific generated replies.
    const cacheable = /AI assistant|Are you still there|Goodbye|One moment|नमस्ते/.test(text) && text.length < 400;
    const hit = this.cache.get(key);
    if (hit) { for (const chunk of hit) { if (signal.aborted) return; yield chunk; } return; }
    const chunks: Buffer[] = [];
    for await (const chunk of this.engine.synthesize(text, language, voice, signal)) { if (cacheable) chunks.push(chunk); yield chunk; }
    if (cacheable && chunks.length) { if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!); this.cache.set(key, chunks); }
  }
}
