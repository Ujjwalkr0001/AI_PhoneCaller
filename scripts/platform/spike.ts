import { readFile } from 'node:fs/promises';
import { GnaniSttClient, GnaniTtsClient } from '../../apps/server/src/providers/gnani.js';
import { voices, languages } from '../../packages/shared/src/index.js';
export async function runSpike() {
  if (!process.env.GNANI_SPIKE_PCM)
    throw new Error('Supply a consented/synthetic 8kHz mono PCM16LE fixture (GNANI_SPIKE_PCM)');
  const audio = await readFile(process.env.GNANI_SPIKE_PCM);
  if (audio.length > 16000 * 15 || audio.length < 1024)
    throw new Error('Spike fixture must be 64ms–15s');
  const stt = new GnaniSttClient(['en-IN', 'hi-IN'], 'synthetic-spike');
  const events: { event: string; elapsed_ms: number; text?: string }[] = [];
  const start = Date.now();
  stt.onActivity = () => events.push({ event: 'activity', elapsed_ms: Date.now() - start });
  stt.onTurn = (e) => events.push({ event: 'final', elapsed_ms: Date.now() - start, text: e.text });
  stt.onError = (e) =>
    events.push({ event: 'error', elapsed_ms: Date.now() - start, text: e.message });
  try {
    await stt.connect();
    for (let offset = 0; offset < audio.length; offset += 1024) {
      const chunk = Buffer.alloc(1024);
      audio.copy(chunk, 0, offset, offset + 1024);
      stt.sendAudio(chunk);
      await new Promise((r) => setTimeout(r, 64));
    }
    for (let i = 0; i < 20; i++) {
      stt.sendAudio(Buffer.alloc(1024));
      await new Promise((r) => setTimeout(r, 64));
    }
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    stt.close();
  }
  const ttsStart = Date.now();
  let firstByte: number | null = null,
    bytes = 0;
  for await (const chunk of new GnaniTtsClient().synthesize(
    'Hello, I am an AI assistant. This is a synthetic test.',
    'en-IN',
    'Shivani',
    AbortSignal.timeout(20000),
  )) {
    firstByte ??= Date.now() - ttsStart;
    bytes += chunk.length;
  }
  return {
    synthetic: true,
    stt_events: events,
    first_partial_ms: null,
    partial_note: 'Current protocol emits finalized transcript segments, not assumed partials.',
    tts_first_byte_ms: firstByte,
    tts_bytes: bytes,
    catalog_source: 'Documentation, not exhaustively live-tested',
    documented_languages: languages,
    documented_voices: voices,
  };
}
