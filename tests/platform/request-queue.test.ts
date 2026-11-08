import { expect, it } from 'vitest';
import { acquireSpeechRequest } from '../../apps/server/src/providers/request-queue.js';

it('cancels a waiting request without allowing later speech to overlap the active request', async () => {
  const releaseFirst = await acquireSpeechRequest('synthetic-key', new AbortController().signal);
  const second = new AbortController();
  const cancelled = acquireSpeechRequest('synthetic-key', second.signal);
  second.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  let thirdStarted = false;
  const third = acquireSpeechRequest('synthetic-key', new AbortController().signal)
    .then((release) => { thirdStarted = true; return release; });
  await new Promise((r) => setTimeout(r, 0));
  expect(thirdStarted).toBe(false);
  releaseFirst();
  (await third)();
});
