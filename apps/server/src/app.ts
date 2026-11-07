import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openApi } from './openapi.js';
import twilio from 'twilio';
import type { WebSocket } from 'ws';
import { campaignSchema, contactSchema, destinationSchema, voices, languages, type CallResult, type Destination } from '../../../packages/shared/src/index.js';
import { Store } from './db/store.js';
import { authenticate, authRoutes, maskPhone, safeDestination, validTwilio } from './security.js';
import { Platform, type CallData, type CampaignData, type ContactData, type DeliveryData } from './platform.js';
import { normalizePhone, percentile } from './domain.js';
import { mulawToPcm16le } from './audio.js';
import type { Transport } from './contracts.js';
import type { ConversationPipeline } from './pipeline.js';
import { GnaniTtsClient } from './providers/gnani.js';
import { pcm16ToWav } from './audio.js';

const idSchema = z.object({ id: z.string().uuid() });
const csv = (value: unknown) => { let s = typeof value === 'string' ? value : JSON.stringify(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
function socketTransport(ws: WebSocket, twilioStream?: () => string | undefined, hangup?: () => Promise<void>): Transport & { ack(name: string): void } {
  const marks = new Map<string, { resolve(): void; timer: ReturnType<typeof setTimeout> }>();
  const send = (value: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
  const ack = (name: string) => { const mark = marks.get(name); if (mark) { clearTimeout(mark.timer); mark.resolve(); marks.delete(name); } };
  ws.on('close', () => { for (const name of marks.keys()) ack(name); });
  return {
    audio: frame => send(twilioStream ? { event: 'media', streamSid: twilioStream(), media: { payload: frame.toString('base64') } } : { type: 'audio', format: 'mulaw', sample_rate: 8000, audio: frame.toString('base64') }),
    clear: () => { send(twilioStream ? { event: 'clear', streamSid: twilioStream() } : { type: 'clear' }); for (const name of marks.keys()) ack(name); },
    mark: name => new Promise<void>(resolve => {
      const timer = setTimeout(() => ack(name), 15000); marks.set(name, { resolve, timer });
      send(twilioStream ? { event: 'mark', streamSid: twilioStream(), mark: { name } } : { type: 'mark', name });
    }),
    end: async () => { if (hangup) await hangup(); if (ws.readyState === 1) ws.close(1000, 'Call complete'); }, ack,
  };
}
export async function buildApp(store: Store, platform: Platform) {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: {
    level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'password', '*.password', '*.phone', '*.email'],
    serializers: { req: req => ({ method: req.method, url: String(req.url ?? '').split('?')[0] }), err: err => ({ type: err.name, message: maskPhone(err.message ?? 'Error'), stack: '' }) },
  }, disableRequestLogging: true });
  await app.register(cookie, { secret: process.env.SESSION_SECRET }); await app.register(formbody); await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'");
    const path = req.routeOptions.url ?? req.url.split('?')[0];
    if (!(path.startsWith('/api/') || path.startsWith('/ws/') || path === '/metrics')) return;
    reply.header('Cache-Control', 'no-store');
    if (path === '/api/v1/auth/login') {
      const origin = req.headers.origin; if (origin && origin !== process.env.PUBLIC_BASE_URL) return reply.code(403).send({ error: 'Invalid origin' }); return;
    }
    req.user = await authenticate(req, store);
    if (!req.user) return reply.code(401).send({ error: 'Authentication required' });
    const isWs = req.headers.upgrade?.toLowerCase() === 'websocket';
    if (isWs && req.headers.origin !== process.env.PUBLIC_BASE_URL) return reply.code(403).send({ error: 'Invalid WebSocket origin' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-csrf-token'] !== req.user.csrf) return reply.code(403).send({ error: 'CSRF token required' });
      if (req.user.role !== 'admin' && path !== '/api/v1/auth/logout') return reply.code(403).send({ error: 'Admin role required' });
    }
    if (path.startsWith('/ws/browser') && req.user.role !== 'admin') return reply.code(403).send({ error: 'Admin role required' });
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    req.log.error({ err: error }, 'Request failed');
    const err = error as { statusCode?: number; message?: string };
    const message = err.message ?? 'Request failed';
    return reply.code(err.statusCode ?? 400).send({ error: err.statusCode === 429 ? 'Too many requests' : message.startsWith('invalid input syntax') ? 'Invalid identifier' : maskPhone(message) });
  });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => { try { await store.ready(); if (platform.draining) throw new Error('draining'); return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'unavailable' }); } });
  app.get('/metrics', async (_req, reply) => reply.type('text/plain; version=0.0.4').send(platform.metrics()));
  await authRoutes(app, store);

  app.get('/api/v1/providers', async () => ({ simulation: platform.simulation, dialogue: platform.simulation ? 'Mock dialogue (simulation)' : `${process.env.DIALOGUE_PROVIDER ?? 'sarvam'} / ${process.env.DIALOGUE_MODEL ?? 'sarvam-105b-conversations'}`,
    services: [{ name: 'Gnani Prisma STT', status: platform.simulation ? 'simulated' : process.env.GNANI_API_KEY ? 'configured, not probed' : 'missing key' }, { name: 'Gnani Timbre TTS', status: platform.simulation ? 'simulated' : process.env.GNANI_API_KEY ? 'configured, not probed' : 'missing key' },
      { name: 'Dialogue model', status: platform.simulation ? 'simulated' : process.env.DIALOGUE_API_KEY || process.env.SARVAM_API_KEY ? 'configured, not probed' : 'missing key' }, { name: 'Twilio', status: platform.simulation ? 'simulated' : process.env.TWILIO_AUTH_TOKEN ? 'configured, not probed' : 'missing credentials' }, { name: 'Postgres', status: 'connected' }], voices, languages }));
  app.get('/api/v1/campaigns', async req => store.list('campaigns', req.user!.org_id));
  app.post('/api/v1/campaigns', async req => { const c = campaignSchema.parse(req.body); return store.put('campaigns', req.user!.org_id, { ...c, status: 'draft' }); });
  app.get('/api/v1/campaigns/:id', async (req, reply) => { const row = await store.get('campaigns', req.user!.org_id, idSchema.parse(req.params).id); return row ?? reply.code(404).send({ error: 'Campaign not found' }); });
  app.put('/api/v1/campaigns/:id', async req => {
    const { id } = idSchema.parse(req.params), c = campaignSchema.parse(req.body), old = await store.get<CampaignData>('campaigns', req.user!.org_id, id);
    if (!old) throw new Error('Campaign not found'); if (old.data.status === 'running') throw new Error('Pause campaign before editing');
    if (c.type !== old.data.type) throw new Error('Campaign workflow cannot change; create a new campaign');
    return store.put('campaigns', req.user!.org_id, { ...c, status: old.data.status }, id);
  });
  app.post('/api/v1/campaigns/:id/:action', async req => {
    const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['launch', 'pause', 'resume', 'stop']) }).parse(req.params), org = req.user!.org_id;
    if (action === 'launch' || action === 'resume') {
      const key = z.string().min(8).max(120).parse(req.headers['idempotency-key']); return platform.launch(org, id, key);
    }
    const c = await store.get<CampaignData>('campaigns', org, id); if (!c) throw new Error('Campaign not found');
    c.data.status = action === 'pause' ? 'paused' : 'stopped'; await store.put('campaigns', org, c.data, id); await store.audit(org, `campaign.${action}`, id); return c;
  });
  app.delete('/api/v1/campaigns/:id', async req => {
    const { id } = idSchema.parse(req.params), org = req.user!.org_id;
    if ([...platform.active.values()].some(p => p.campaignId === id)) throw new Error('End active calls before deleting');
    const client = await store.pool.connect();
    try {
      await client.query('begin');
      await client.query("delete from deliveries where org_id=$1 and data->>'result_id' in (select id::text from results where org_id=$1 and data->>'campaign_id'=$2)", [org, id]);
      for (const table of ['contacts', 'calls', 'results']) await client.query(`delete from ${table} where org_id=$1 and data->>'campaign_id'=$2`, [org, id]);
      await client.query('delete from campaigns where org_id=$1 and id=$2', [org, id]); await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    await store.audit(org, 'campaign.deleted', id); return { ok: true };
  });
  app.get('/api/v1/contacts', async req => { const { campaign_id } = z.object({ campaign_id: z.string().uuid().optional() }).parse(req.query); return (await store.list<ContactData>('contacts', req.user!.org_id)).filter(c => !campaign_id || c.data.campaign_id === campaign_id); });
  app.post('/api/v1/contacts/validate', async req => {
    const rows = z.array(contactSchema).max(Number(process.env.MAX_CONTACT_ROWS ?? 200)).parse(req.body), suppressed = await store.list<{ phone: string }>('suppression', req.user!.org_id), seen = new Set<string>();
    return rows.map((r, index) => { const phone = normalizePhone(r.phone), status = !phone ? 'invalid' : seen.has(phone) ? 'duplicate' : suppressed.some(s => s.data.phone === phone) ? 'suppressed' : 'valid'; if (phone) seen.add(phone); return { index, status }; });
  });
  app.post('/api/v1/voice-preview', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (platform.simulation) return reply.code(400).send({ error: 'Voice preview needs live Gnani configuration. Simulation TTS is silent.' });
    const { voice, language } = z.object({ voice: z.enum(voices), language: z.enum(languages) }).parse(req.body);
    const chunks = []; for await (const chunk of new GnaniTtsClient().synthesize('Hello, I am an AI assistant.', language, voice, AbortSignal.timeout(15000))) chunks.push(mulawToPcm16le(chunk));
    return reply.type('audio/wav').send(pcm16ToWav(Buffer.concat(chunks), 8000));
  });
  app.post('/api/v1/campaigns/:id/contacts', async req => {
    const org = req.user!.org_id, { id } = idSchema.parse(req.params);
    if (!await store.get('campaigns', org, id)) throw new Error('Campaign not found');
    const rows = z.array(contactSchema).min(1).max(Number(process.env.MAX_CONTACT_ROWS ?? 200)).parse(req.body);
    const existing = await store.list<ContactData>('contacts', org), suppressed = await store.list<{ phone: string }>('suppression', org);
    const seen = new Set(existing.filter(c => c.data.campaign_id === id).map(c => c.data.phone));
    const incomingNew = new Set(rows.map(r => normalizePhone(r.phone)).filter((p): p is NonNullable<typeof p> => !!p && !seen.has(p)));
    if (seen.size + incomingNew.size > Number(process.env.MAX_CONTACT_ROWS ?? 200)) throw new Error('Campaign contact cap exceeded');
    const report = [];
    for (const [index, row] of rows.entries()) {
      const phone = normalizePhone(row.phone);
      let status = !phone ? 'invalid' : seen.has(phone) ? 'duplicate' : suppressed.some(s => s.data.phone === phone) ? 'suppressed' : 'valid';
      if (status === 'valid') {
        try { await store.put('contacts', org, { ...row, phone, campaign_id: id, status: 'ready', attempts: 0 }); seen.add(phone!); } catch { status = 'duplicate'; }
      }
      report.push({ index, phone: maskPhone(row.phone), status });
    }
    return report;
  });
  app.delete('/api/v1/contacts/:id', async req => {
    const org = req.user!.org_id, { id } = idSchema.parse(req.params);
    if ([...platform.active.values()].some(p => p.contactId === id)) throw new Error('End active call before deleting');
    await store.pool.query("delete from results where org_id=$1 and data->>'contact_id'=$2", [org, id]);
    await store.pool.query("delete from calls where org_id=$1 and data->>'contact_id'=$2", [org, id]); await store.remove('contacts', org, id); await store.audit(org, 'contact.deleted', id); return { ok: true };
  });
  app.get('/api/v1/calls', async req => store.list('calls', req.user!.org_id));
  app.get('/api/v1/calls/:id', async req => { const { id } = idSchema.parse(req.params); return { call: await store.get('calls', req.user!.org_id, id), result: (await store.list<CallResult & { call_id: string }>('results', req.user!.org_id)).find(r => r.data.call_id === id) }; });
  app.delete('/api/v1/calls/:id', async req => {
    const org = req.user!.org_id, { id } = idSchema.parse(req.params); if (platform.active.has(id)) throw new Error('End active call before deleting');
    await store.pool.query("delete from deliveries where org_id=$1 and data->>'result_id' in (select id::text from results where org_id=$1 and data->>'call_id'=$2)", [org, id]);
    await store.pool.query("delete from results where org_id=$1 and data->>'call_id'=$2", [org, id]); await store.remove('calls', org, id); await store.audit(org, 'call.deleted', id); return { ok: true };
  });
  app.get('/api/v1/results', async req => store.list('results', req.user!.org_id));
  app.get('/api/v1/results/export', async (req, reply) => {
    const { campaign_id } = z.object({ campaign_id: z.string().uuid().optional() }).parse(req.query);
    const rows = (await store.list<CallResult>('results', req.user!.org_id)).filter(r => !campaign_id || r.data.campaign_id === campaign_id);
    return reply.header('Content-Disposition', 'attachment; filename="campaign-results.csv"').type('text/csv; charset=utf-8').send('\ufeff' + [['id', 'campaign_id', 'outcome', 'summary', 'fields', 'eligibility', 'simulation', 'sample', 'created_at'].join(','), ...rows.map(r => [r.id, r.data.campaign_id, r.data.outcome, r.data.summary, r.data.extracted_fields, r.data.eligibility, r.data.simulation, r.data.sample, r.created_at].map(csv).join(','))].join('\r\n'));
  });
  app.get('/api/v1/suppression', async req => store.list('suppression', req.user!.org_id));
  app.post('/api/v1/suppression', async req => { const { phone } = z.object({ phone: z.string() }).parse(req.body); await platform.suppress(req.user!.org_id, phone); return { ok: true }; });
  app.delete('/api/v1/suppression/:id', async req => { await store.remove('suppression', req.user!.org_id, idSchema.parse(req.params).id); await store.audit(req.user!.org_id, 'suppression.removed', 'phone-redacted'); return { ok: true }; });
  app.get('/api/v1/destinations', async req => store.list('destinations', req.user!.org_id));
  app.post('/api/v1/destinations', async req => { const d = destinationSchema.parse(req.body); await safeDestination(d.url); return store.put('destinations', req.user!.org_id, d); });
  app.delete('/api/v1/destinations/:id', async req => { await store.remove('destinations', req.user!.org_id, idSchema.parse(req.params).id); return { ok: true }; });
  app.post('/api/v1/destinations/:id/test', async req => {
    const d = await store.get<Destination>('destinations', req.user!.org_id, idSchema.parse(req.params).id); if (!d) throw new Error('Destination not found');
    await platform.sendWebhook(d.data, { type: 'test', simulation: true, message: 'Synthetic destination test; no contact data' }, randomUUID());
    await store.audit(req.user!.org_id, 'destination.test', d.id); return { ok: true };
  });
  app.get('/api/v1/deliveries', async req => store.list('deliveries', req.user!.org_id));
  app.post('/api/v1/deliveries/:id/retry', async req => {
    const org = req.user!.org_id, d = await store.get<DeliveryData>('deliveries', org, idSchema.parse(req.params).id); if (!d) throw new Error('Delivery not found');
    d.data.status = 'pending'; d.data.attempts = 0; delete d.data.next_at; await store.put('deliveries', org, d.data, d.id); await platform.boss.send('deliver', { org, id: d.id }); return { ok: true };
  });
  app.get('/api/v1/settings', async req => (await store.list('settings', req.user!.org_id))[0]?.data ?? { retention_days: 30, kill_switch: false, global_daily_minutes: 200, rates: {} });
  app.put('/api/v1/settings', async req => {
    const s = z.object({ retention_days: z.number().int().min(1).max(365), kill_switch: z.boolean(), global_daily_minutes: z.number().positive().max(10000), global_daily_stt_seconds: z.number().positive().default(12000), global_daily_tts_chars: z.number().positive().default(200000), rates: z.record(z.string(), z.number().nonnegative()).prefault({}) }).parse(req.body), old = (await store.list('settings', req.user!.org_id))[0];
    await store.put('settings', req.user!.org_id, s, old?.id); await store.audit(req.user!.org_id, 'settings.updated', old?.id ?? 'settings'); return s;
  });
  app.get('/api/v1/team', async req => (await store.pool.query('select id,email,data from users where org_id=$1', [req.user!.org_id])).rows);
  app.get('/api/v1/audit-log', async req => store.list('audit_log', req.user!.org_id));
  app.get('/api/v1/analytics', async req => {
    const results = (await store.list<CallResult>('results', req.user!.org_id)).map(r => ({ ...r.data, at: r.created_at }));
    const live = results.filter(r => !r.sample && !r.simulation), sample = results.filter(r => r.sample || r.simulation);
    const summarize = (rows: typeof results) => {
      const latency = rows.flatMap(r => r.latency.map(l => l.end_of_speech_to_audio_ms).filter((n): n is number => n !== undefined));
      const group = (keys: string[]) => Object.fromEntries([...new Set(keys)].map(k => [k, keys.filter(x => x === k).length]));
      return { calls: rows.length, interested: rows.filter(r => ['INTERESTED_HOT', 'INTERESTED_WARM'].includes(r.outcome)).length, screenings: rows.filter(r => r.outcome === 'CANDIDATE_COMPLETED').length,
        connected: rows.filter(r => r.transcript.length > 0).length, avg_duration_s: rows.length ? rows.reduce((a, r) => a + r.duration_s, 0) / rows.length : null,
        p50_ms: percentile(latency, .5), p95_ms: percentile(latency, .95), outcomes: group(rows.map(r => r.outcome)), languages: group(rows.flatMap(r => r.languages)),
        days: group(rows.map(r => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(r.at)))),
        today: rows.filter(r => new Date(r.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })).length };
    };
    const settings = (await store.list<{ rates?: Record<string, number> }>('settings', req.user!.org_id))[0]?.data, rates = settings?.rates;
    const configured = rates && ['stt_per_minute', 'tts_per_1000_chars', 'llm_per_1000_tokens', 'telephony_per_minute'].every(k => typeof rates[k] === 'number');
    const estimate = configured ? live.reduce((total, r) => total + r.usage.stt_seconds / 60 * rates.stt_per_minute + r.usage.tts_chars / 1000 * rates.tts_per_1000_chars + r.usage.llm_tokens / 1000 * rates.llm_per_1000_tokens + r.usage.telephony_minutes * rates.telephony_per_minute, 0) : null;
    return { real: summarize(live), sample: summarize(sample), active: platform.active.size, estimated_cost: estimate, estimate_note: 'Operator-supplied INR rate table; estimate only. Provider bills are authoritative.' };
  });
  app.get('/api/v1/openapi.json', async () => openApi());

  app.get('/ws/monitor', { websocket: true }, (ws, req) => { platform.monitors.set(ws, req.user!.org_id); ws.send(JSON.stringify({ type: 'connected', simulation: platform.simulation })); ws.on('close', () => platform.monitors.delete(ws)); });
  app.get('/ws/browser/:id', { websocket: true }, (ws, req) => {
    const transport = socketTransport(ws); let pipeline: ConversationPipeline | undefined; let started = false;
    ws.send(JSON.stringify({ type: 'ready', simulation: platform.simulation, note: platform.simulation ? 'Scripted simulation; mock TTS is silence. Use text input.' : 'Browser test call: Gnani Prisma + dialogue + Timbre' }));
    ws.on('message', (raw, binary) => {
      void (async () => {
        if (binary) { if (raw instanceof Buffer && raw.length % 2 === 0) pipeline?.input(raw); return; }
        const message = z.object({ type: z.enum(['start', 'mark', 'text', 'end']), text: z.string().max(2000).optional(), name: z.string().optional() }).parse(JSON.parse(raw.toString()));
        if (message.type === 'start' && !started) {
          started = true;
          const { call, pipeline: p } = await platform.browserCall(req.user!.org_id, z.object({ id: z.string().uuid() }).parse(req.params).id, transport); pipeline = p;
          if (ws.readyState !== 1) { await p.finish('FAILED'); return; }
          ws.send(JSON.stringify({ type: 'started', call_id: call.id })); await p.start();
        } else if (message.type === 'mark') transport.ack(message.name ?? '');
        else if (message.type === 'text' && platform.simulation && pipeline) await pipeline.turn({ text: message.text ?? '', finalAt: Date.now() });
        else if (message.type === 'end') await pipeline?.finish();
      })().catch(async () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: 'Browser call failed. Check provider configuration and server logs.' })); await pipeline?.finish('FAILED'); ws.close(1011, 'Call failed'); });
    });
    ws.on('close', () => { void pipeline?.finish().catch(error => app.log.error({ err: error }, 'Failed to persist browser result')); });
  });
  for (const path of ['/twilio/voice', '/twilio/status']) app.post(path, async (req, reply) => {
    if (!validTwilio(req)) return reply.code(403).send({ error: 'Invalid Twilio signature' });
    const query = z.object({ call_id: z.string().uuid() }).parse(req.query);
    const stored = (await store.pool.query('select * from calls where id=$1', [query.call_id])).rows[0];
    if (!stored) return reply.code(404).send('Unknown call');
    const body = req.body as Record<string, string>, call = stored as import('../../../packages/shared/src/index.js').Row<CallData>;
    if (call.data.sid && call.data.sid !== body.CallSid) return reply.code(403).send('Call SID mismatch');
    if (path === '/twilio/status') {
      if (['failed', 'completed'].includes(call.data.status)) return { ok: true };
      if (['no-answer', 'busy', 'failed', 'canceled'].includes(body.CallStatus)) await platform.failCall(call.org_id, call, body.CallStatus === 'failed' ? 'FAILED' : 'NO_ANSWER');
      else if (body.CallStatus === 'completed') { if (platform.active.has(call.id)) await platform.active.get(call.id)!.finish(); else await platform.failCall(call.org_id, call, 'FAILED'); }
      else { call.data.status = body.CallStatus === 'answered' ? 'in-progress' : body.CallStatus; call.data.last_status = new Date().toISOString(); await store.put('calls', call.org_id, call.data, call.id); }
      return { ok: true };
    }
    const xml = new twilio.twiml.VoiceResponse();
    if (body.AnsweredBy?.startsWith('machine') || body.AnsweredBy === 'fax') { xml.hangup(); await platform.failCall(call.org_id, call, 'VOICEMAIL'); }
    else { const stream = xml.connect().stream({ url: `${process.env.PUBLIC_BASE_URL!.replace(/^http/, 'ws')}/twilio/media` }); stream.parameter({ name: 'call_id', value: call.id }); }
    return reply.type('text/xml').send(xml.toString());
  });
  app.get('/twilio/media', { websocket: true, preValidation: async (req, reply) => { if (!validTwilio(req)) return reply.code(403).send('Invalid Twilio signature'); } }, (ws) => {
    let streamSid: string | undefined, pipeline: ConversationPipeline | undefined, sid: string | undefined, starting = false;
    const transport = socketTransport(ws, () => streamSid, async () => { if (sid) await platform.telephony.hangup(sid); });
    ws.on('message', raw => {
      void (async () => {
        const e = JSON.parse(raw.toString()) as { event: string; streamSid?: string; start?: { streamSid: string; callSid: string; customParameters: { call_id: string }; mediaFormat: { encoding: string; sampleRate: number; channels: number } }; media?: { payload: string }; mark?: { name: string } };
        if (e.event === 'start' && e.start && !starting) {
          starting = true; const callId = z.string().uuid().parse(e.start.customParameters.call_id);
          const call = (await store.pool.query('select * from calls where id=$1', [callId])).rows[0] as import('../../../packages/shared/src/index.js').Row<CallData> | undefined;
          if (!call || ['completed', 'failed'].includes(call.data.status) || platform.active.has(call.id) || call.data.sid !== e.start.callSid || e.start.mediaFormat.encoding !== 'audio/x-mulaw' || e.start.mediaFormat.sampleRate !== 8000 || e.start.mediaFormat.channels !== 1) throw new Error('Unexpected stream identity, state or format');
          streamSid = e.start.streamSid; sid = e.start.callSid;
          const campaign = await store.get<CampaignData>('campaigns', call.org_id, call.data.campaign_id); if (!campaign) throw new Error('Campaign missing');
          pipeline = await platform.createPipeline(call.org_id, campaign, call, transport); await pipeline.start();
        } else if (e.event === 'media' && e.media && e.streamSid === streamSid) pipeline?.input(mulawToPcm16le(Buffer.from(e.media.payload, 'base64')));
        else if (e.event === 'mark' && e.mark && e.streamSid === streamSid) transport.ack(e.mark.name);
        else if (e.event === 'stop') await pipeline?.finish();
      })().catch(async error => { app.log.error({ err: error }, 'Media stream failed'); await pipeline?.finish('FAILED'); ws.close(1011, 'Media error'); });
    });
    ws.on('close', () => { void pipeline?.finish().catch(error => app.log.error({ err: error }, 'Failed to persist phone result')); });
  });
  const webRoot = resolve('apps/web/dist');
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot, wildcard: true });
    app.setNotFoundHandler((req, reply) => req.method === 'GET' && !/^\/(api|ws|twilio)\//.test(req.url) ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found' }));
  }
  return app;
}
