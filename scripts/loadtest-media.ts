import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import twilio from 'twilio';
import { Store, tables } from '../apps/server/src/db/store.js';
import { Platform, type CallData } from '../apps/server/src/platform.js';
import { buildApp } from '../apps/server/src/app.js';
import { defaultCampaign } from '../packages/shared/src/index.js';
import { agentVersion, percentile } from '../apps/server/src/domain.js';
if (process.env.MOCK_MODE !== 'true') throw new Error('Media load test requires MOCK_MODE=true');
const count = Number(process.env.LOAD_CLIENTS ?? 4); if (!Number.isInteger(count) || count < 1 || count > 40) throw new Error('Use 1–40 synthetic clients');
const base = 'http://localhost:3002'; process.env.PUBLIC_BASE_URL = base; process.env.TWILIO_AUTH_TOKEN = 'synthetic-loadtest-signing-token';
const store = new Store(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-development-only@localhost:54329/caller'); process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-development-only@localhost:54329/caller';
const platform = new Platform(store), app = await buildApp(store, platform), org = randomUUID();
const c = defaultCampaign('hr'); c.sample = true;
const campaign = await store.put('campaigns', org, { ...c, status: 'draft' });
const timings: number[] = []; let failed = 0;
try {
  await platform.start(); await app.listen({ port: 3002, host: '127.0.0.1' });
  const memoryStart = process.memoryUsage().rss;
  await Promise.all(Array.from({ length: count }, async () => {
    const id = randomUUID(), sid = `CA${randomUUID().replace(/-/g, '')}`, streamSid = `MZ${randomUUID().replace(/-/g, '')}`;
    await store.put<CallData>('calls', org, { campaign_id: campaign.id, sid, status: 'ringing', agent_version: agentVersion(c), simulation: true, sample: true, last_status: new Date().toISOString() }, id);
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, `${base}/twilio/media`, {}), began = performance.now();
    await new Promise<void>(resolve => {
      const ws = new WebSocket('ws://localhost:3002/twilio/media', { headers: { 'X-Twilio-Signature': signature } }); let first = false, frames = 0;
      const timer = setInterval(() => { if (ws.readyState === 1) { ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: Buffer.alloc(160, 255).toString('base64'), timestamp: String(frames++ * 20) } })); } }, 20);
      const deadline = setTimeout(() => { ws.send(JSON.stringify({ event: 'stop', streamSid })); setTimeout(() => ws.close(), 500); }, 2000);
      ws.on('open', () => { ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' })); ws.send(JSON.stringify({ event: 'start', streamSid, start: { streamSid, callSid: sid, customParameters: { call_id: id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } })); });
      ws.on('message', raw => { const event = JSON.parse(raw.toString()); if (event.event === 'media' && !first) { first = true; timings.push(performance.now() - began); } if (event.event === 'mark') ws.send(JSON.stringify({ event: 'mark', streamSid, mark: event.mark })); });
      ws.on('error', () => { failed++; }); ws.on('close', () => { clearInterval(timer); clearTimeout(deadline); if (!first) failed++; resolve(); });
    });
  }));
  const report = { ran_at: new Date().toISOString(), simulation: true, scope: 'Local 2-second synthetic Twilio Media Streams against silent mocks; NOT live provider capacity or Fly benchmark', clients: count, first_audio_observations: timings.length, failures: failed, connection_to_first_mock_audio_p50_ms: percentile(timings, .5), connection_to_first_mock_audio_p95_ms: percentile(timings, .95), rss_delta_bytes: process.memoryUsage().rss - memoryStart, node: process.version, platform: process.platform };
  await writeFile('docs/LOADTEST.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  await platform.close(); await app.close();
  for (const table of tables) await store.pool.query(`delete from ${table} where org_id=$1`, [org]); await store.pool.end();
}
