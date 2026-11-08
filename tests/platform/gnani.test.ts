import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { GnaniSttClient, GnaniTtsClient } from '../../apps/server/src/providers/gnani.js';
import { MockStt } from '../../apps/server/src/providers/mocks.js';
import { ResilientStt } from '../../apps/server/src/providers/resilience.js';
afterEach(() => vi.restoreAllMocks());
it('Prisma auth/config, final events and exactly 1024-byte paced PCM against a local protocol mock', async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('No test socket');
  let headers: Record<string, unknown> = {};
  const frames: { length: number; at: number }[] = [];
  server.on('connection', (ws, req) => {
    headers = req.headers;
    ws.send(JSON.stringify({ type: 'connected' }));
    ws.on('message', (raw) => {
      frames.push({ length: raw.toString().length, at: Date.now() });
      if (frames.length === 2) {
        ws.send(JSON.stringify({ type: 'processing' }));
        ws.send(
          JSON.stringify({
            type: 'transcript',
            text: 'नमस्ते, मैं बात कर सकता हूँ।',
            detected_language_code: 'hi-IN',
          }),
        );
      }
    });
  });
  const client = new GnaniSttClient(
    ['en-IN', 'hi-IN'],
    'synthetic-protocol-test',
    'synthetic-key',
    `ws://localhost:${address.port}`,
  );
  const turn = vi.fn();
  client.onTurn = turn;
  try {
    await client.connect();
    client.sendAudio(Buffer.alloc(2048));
    await new Promise((r) => setTimeout(r, 180));
    expect(headers['x-api-key-id']).toBe('synthetic-key');
    expect(headers.language_code).toBe('en-IN');
    expect(headers['x-sample-rate']).toBe('8000');
    expect(headers['x-min-silence-ms']).toBe('350');
    expect(frames.map((f) => f.length)).toEqual([1024, 1024]);
    expect(frames[1].at - frames[0].at).toBeGreaterThanOrEqual(45);
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'hi-IN', text: expect.stringContaining('नमस्ते') }),
    );
  } finally {
    client.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
it('Timbre uses documented SSE endpoint/auth/model/voice/μ-law container', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(
        'event: chunk\ndata: {"audio":"//8="}\n\nevent: complete\ndata: {"audio":"","is_final":true}\n\n',
      ),
    );
  const chunks = [];
  for await (const chunk of new GnaniTtsClient('synthetic-key').synthesize(
    'Hello',
    'en-IN',
    'Shivani',
    new AbortController().signal,
  ))
    chunks.push(chunk);
  const [endpoint, init] = fetch.mock.calls[0];
  expect(endpoint).toBe('https://api.vachana.ai/api/v1/tts/sse');
  expect(init?.headers).toHaveProperty('X-API-Key-ID', 'synthetic-key');
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: 'timbre-v3.0',
    voice: 'Shivani',
    audio_config: { container: 'mulaw', sample_rate: 8000 },
  });
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([255, 255]));
});
it('Timbre rejects truncated responses instead of pretending completion', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('event: chunk\ndata: {"audio":"//8="}\n\n'),
  );
  await expect(
    (async () => {
      for await (const chunk of new GnaniTtsClient('synthetic-key').synthesize(
        'Hello',
        'en-IN',
        'Shivani',
        new AbortController().signal,
      )) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    })(),
  ).rejects.toThrow('without completion');
});
it('serializes speech requests per key and retries a rate limit before emitting audio', async () => {
  let active = 0, peak = 0, requests = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    if (++requests === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
    return new Response('event: chunk\ndata: {"audio":"//8="}\n\nevent: complete\ndata: {}\n\n');
  });
  const collect = async () => {
    const chunks = [];
    for await (const chunk of new GnaniTtsClient('same-synthetic-key').synthesize(
      'Hello', 'en-IN', 'Shivani', new AbortController().signal,
    )) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const audio = await Promise.all([collect(), collect()]);
  expect(peak).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(audio).toEqual([Buffer.from([255, 255]), Buffer.from([255, 255])]);
});
it('STT startup failover is visible and does not silently select mocks', async () => {
  const broken = new MockStt();
  broken.connect = async () => {
    throw new Error('Synthetic Gnani outage');
  };
  const fallback = new MockStt(),
    events: string[] = [],
    ready = new ResilientStt(
      () => broken,
      () => fallback,
      (p, e) => events.push(`${p}:${e}`),
    );
  const turn = vi.fn();
  ready.onTurn = turn;
  await ready.connect();
  fallback.utterance('Synthetic caller');
  expect(turn).toHaveBeenCalled();
  expect(events).toContain('Soniox:failover');
  ready.close();
});
