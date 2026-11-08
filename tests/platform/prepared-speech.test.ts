import { expect, it, vi } from 'vitest';
import { PreparedSpeech } from '../../apps/server/src/providers/prepared-speech.js';
import type { TtsClient } from '../../apps/server/src/contracts.js';

it('prepares fixed speech once and streams cached audio without a second provider request', async () => {
  let generated = 0;
  const engine: TtsClient = { name: 'test', async *synthesize() {
    generated++;
    yield Buffer.from([1, 2, 3]);
  } };
  const usage = vi.fn(async () => {});
  const cache = new PreparedSpeech(engine, usage);
  cache.prepare('Next question?', 'en-IN', 'Shivani');
  await vi.waitFor(() => expect(cache.has('Next question?', 'en-IN', 'Shivani')).toBe(true));
  const chunks = [];
  for await (const chunk of cache.synthesize('Next question?', 'en-IN', 'Shivani', new AbortController().signal))
    chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
  expect(generated).toBe(1);
  expect(usage).toHaveBeenCalledTimes(1);
  cache.close();
});

it('does not cache arbitrary generated replies and recovers from a failed preparation', async () => {
  let generated = 0;
  const engine: TtsClient = { name: 'test', async *synthesize() {
    if (++generated === 1) throw new Error('Temporary provider error');
    yield Buffer.from([4]);
  } };
  const cache = new PreparedSpeech(engine, async () => {});
  cache.prepare('Question?', 'en-IN', 'Shivani');
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 2; i++)
    for await (const chunk of cache.synthesize('Question?', 'en-IN', 'Shivani', new AbortController().signal))
      expect(chunk[0]).toBe(4);
  expect(generated).toBe(3);
  cache.close();
});

it('cancels unfinished background speech when the call ends', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let aborted = false;
  const engine: TtsClient = { name: 'test', async *synthesize(_text, _lang, _voice, signal) {
    started();
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('Call ended', 'AbortError'));
    }, { once: true }));
    yield Buffer.alloc(0);
  } };
  const cache = new PreparedSpeech(engine, async () => {});
  cache.prepare('Question?', 'en-IN', 'Shivani');
  await ready;
  cache.close();
  await new Promise((r) => setTimeout(r, 0));
  expect(aborted).toBe(true);
  expect(cache.has('Question?', 'en-IN', 'Shivani')).toBe(false);
});
