import PgBoss from 'pg-boss';
import twilio from 'twilio';
import type { WebSocket } from 'ws';
import type { Campaign, Contact, CallResult, Destination, Row } from '../../../packages/shared/src/index.js';
import { Store } from './db/store.js';
import { agentVersion, complianceGate, nextCallingWindow, normalizePhone } from './domain.js';
import type { SttClient, TelephonyProvider, Transport, TtsClient } from './contracts.js';
import { GnaniSttClient, GnaniTtsClient } from './providers/gnani.js';
import { MockDialogue, MockStt, MockTelephony, MockTts } from './providers/mocks.js';
import { LegacyTtsAdapter, SonioxAdapter } from './providers/legacy.js';
import { PhraseCache, ResilientStt, ResilientTts } from './providers/resilience.js';
import { CompatibleDialogue } from './providers/dialogue.js';
import { ConversationPipeline } from './pipeline.js';
import { postPublicWebhook, webhookSignature } from './security.js';
import { logger } from '../../../src/utils/logger.js';

export interface CampaignData extends Campaign { status: 'draft' | 'running' | 'paused' | 'stopped'; launch_key?: string }
export interface ContactData extends Contact { campaign_id: string; status: string; attempts: number; last_attempt?: string; blocked_reason?: string }
export interface CallData { campaign_id: string; contact_id?: string; status: string; sid?: string; agent_version: string; campaign_snapshot?: Campaign; simulation: boolean; sample: boolean; last_status: string; callback_at?: string; reservation_minutes?: number; reservation_stt?: number; reservation_tts?: number }
export interface DeliveryData { result_id: string; destination_id: string; idempotency_key: string; status: string; attempts: number; next_at?: string; error?: string }
export class TwilioProvider implements TelephonyProvider {
  private client() { if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) throw new Error('Twilio credentials missing'); return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
  async dial(to: string, id: string) {
    const base = process.env.PUBLIC_BASE_URL;
    if (!base?.startsWith('https://') || !process.env.TWILIO_PHONE_NUMBER) throw new Error('Public HTTPS URL and Twilio number required');
    return (await this.client().calls.create({ to, from: process.env.TWILIO_PHONE_NUMBER, url: `${base}/twilio/voice?call_id=${id}`, statusCallback: `${base}/twilio/status?call_id=${id}`, statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'], statusCallbackMethod: 'POST', machineDetection: 'Enable', timeout: 30 })).sid;
  }
  async hangup(sid: string) { await this.client().calls(sid).update({ status: 'completed' }); }
}
export class Platform {
  readonly simulation = process.env.MOCK_MODE === 'true'; readonly active = new Map<string, ConversationPipeline>();
  readonly monitors = new Map<WebSocket, string>(); readonly boss: PgBoss; readonly telephony: TelephonyProvider;
  draining = false; private tts: TtsClient; private errorCount = 0;
  constructor(readonly store: Store) {
    this.boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, retryLimit: 3, retryDelay: 5, retryBackoff: true, max: 4 });
    this.telephony = this.simulation ? new MockTelephony() : new TwilioProvider();
    this.tts = new PhraseCache(this.simulation ? new MockTts() : new GnaniTtsClient());
  }
  emit(org: string, callId: string, type: string, data: unknown) {
    if (['stage', 'provider', 'error'].includes(type)) logger.withCallSid(callId).info(`Call ${type}`, { org_id: org, detail: data });
    for (const [ws, tenant] of this.monitors) if (tenant === org && ws.readyState === 1) ws.send(JSON.stringify({ call_id: callId, type, data }));
  }
  async start() {
    this.boss.on('error', error => { this.errorCount++; logger.error('Background queue failed', error); });
    await this.boss.start();
    for (const name of ['dial', 'deliver', 'maintenance']) await this.boss.createQueue(name);
    await this.boss.work<{ org: string; contactId: string }>('dial', { pollingIntervalSeconds: 1 }, async jobs => { for (const job of jobs) await this.dial(job.data.org, job.data.contactId); });
    await this.boss.work<{ org: string; id: string }>('deliver', { pollingIntervalSeconds: 1 }, async jobs => { for (const job of jobs) await this.deliver(job.data.org, job.data.id); });
    await this.boss.work('maintenance', async () => this.maintenance());
    await this.boss.schedule('maintenance', '* * * * *');
  }
  async queueContact(org: string, contactId: string, when?: Date) {
    await this.boss.send('dial', { org, contactId }, { singletonKey: contactId, singletonSeconds: 30, startAfter: when ?? new Date(), retryLimit: 0 });
  }
  async launch(org: string, id: string, key: string) {
    const c = await this.store.get<CampaignData>('campaigns', org, id);
    if (!c) throw new Error('Campaign not found');
    if (!c.data.compliance.attested) throw new Error('Compliance attestation required');
    if (c.data.launch_key === key) return c;
    if (c.data.status === 'running') throw new Error('Campaign is already running');
    c.data.status = 'running'; c.data.launch_key = key;
    await this.store.put('campaigns', org, c.data, id); await this.store.audit(org, 'campaign.launch', id);
    for (const contact of await this.store.list<ContactData>('contacts', org)) if (contact.data.campaign_id === id && !['completed', 'suppressed', 'wrong_number'].includes(contact.data.status)) await this.queueContact(org, contact.id);
    return c;
  }
  async dial(org: string, contactId: string) {
    // Global transaction lock covers reservations across campaigns and workers. External dial follows durable reservation.
    const client = await this.store.pool.connect(); let call: Row<CallData> | undefined; let contact: Row<ContactData> | undefined; let campaign: Row<CampaignData> | undefined;
    try {
      await client.query('begin'); await client.query("select pg_advisory_xact_lock(hashtext('dial-reservations'))");
      contact = (await client.query('select * from contacts where org_id=$1 and id=$2 for update', [org, contactId])).rows[0];
      if (!contact) { await client.query('commit'); return; }
      campaign = (await client.query('select * from campaigns where org_id=$1 and id=$2', [org, contact.data.campaign_id])).rows[0];
      if (!campaign || campaign.data.status !== 'running' || this.draining) { await client.query('commit'); return; }
      const settings = (await client.query('select data from settings where org_id=$1 limit 1', [org])).rows[0]?.data ?? {};
      const calls = (await client.query('select * from calls where org_id=$1', [org])).rows as Row<CallData>[];
      const results = (await client.query('select * from results where org_id=$1', [org])).rows as Row<CallResult>[];
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const inDay = (date: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(date)) === today;
      const current = calls.filter(r => ['reserved', 'ringing', 'in-progress'].includes(r.data.status));
      const scoped = calls.filter(r => r.data.campaign_id === campaign!.id && inDay(r.created_at));
      const measured = results.filter(r => r.data.campaign_id === campaign!.id && inDay(r.created_at));
      const activeCampaign = current.filter(r => r.data.campaign_id === campaign!.id);
      const suppressed = (await client.query("select id from suppression where org_id=$1 and data->>'phone'=$2", [org, contact.data.phone])).rowCount! > 0;
      const reasons = complianceGate(campaign.data, contact.data.phone, {
        now: new Date(), suppressed, attempts: contact.data.attempts, duplicate: current.some(r => r.data.contact_id === contactId) || ['completed', 'wrong_number'].includes(contact.data.status),
        today: scoped.length, minutes: measured.reduce((a, r) => a + Number(r.data.duration_s ?? 0) / 60, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_minutes ?? 0), 0),
        stt: measured.reduce((a, r) => a + r.data.usage.stt_seconds, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_stt ?? 0), 0),
        tts: measured.reduce((a, r) => a + r.data.usage.tts_chars, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_tts ?? 0), 0),
        globalPaused: !!settings.kill_switch, globalMinutes: results.filter(r => inDay(r.created_at)).reduce((a, r) => a + Number(r.data.duration_s ?? 0) / 60, 0) + current.reduce((a, r) => a + (r.data.reservation_minutes ?? 0), 0), globalCap: Number(settings.global_daily_minutes ?? 200),
      });
      const maxMinutes = campaign.data.max_call_duration_s / 60;
      const allResults = results.filter(r => inDay(r.created_at));
      if (campaign.data.max_call_duration_s + allResults.reduce((a, r) => a + r.data.usage.stt_seconds, 0) + current.reduce((a, r) => a + (r.data.reservation_stt ?? 0), 0) > Number(settings.global_daily_stt_seconds ?? 12000)) reasons.push('Global STT cap reached');
      if (Math.min(10000, campaign.data.schedule.daily_tts_chars) + allResults.reduce((a, r) => a + r.data.usage.tts_chars, 0) + current.reduce((a, r) => a + (r.data.reservation_tts ?? 0), 0) > Number(settings.global_daily_tts_chars ?? 200000)) reasons.push('Global TTS cap reached');
      if (maxMinutes + results.filter(r => inDay(r.created_at)).reduce((a, r) => a + Number(r.data.duration_s ?? 0) / 60, 0) + current.reduce((a, r) => a + (r.data.reservation_minutes ?? 0), 0) > Number(settings.global_daily_minutes ?? 200)) reasons.push('Insufficient global daily minutes');
      if (campaign.data.max_call_duration_s + measured.reduce((a, r) => a + r.data.usage.stt_seconds, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_stt ?? 0), 0) > campaign.data.schedule.daily_stt_seconds) reasons.push('Insufficient remaining STT budget');
      if (Math.min(10000, campaign.data.schedule.daily_tts_chars) + measured.reduce((a, r) => a + r.data.usage.tts_chars, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_tts ?? 0), 0) > campaign.data.schedule.daily_tts_chars) reasons.push('Insufficient remaining TTS budget');
      if (maxMinutes + measured.reduce((a, r) => a + Number(r.data.duration_s ?? 0) / 60, 0) + activeCampaign.reduce((a, r) => a + (r.data.reservation_minutes ?? 0), 0) > campaign.data.schedule.daily_minutes) reasons.push('Insufficient remaining daily minutes for a full call');
      if (reasons.length) {
        contact.data.status = suppressed ? 'suppressed' : 'blocked'; contact.data.blocked_reason = reasons.join('; ');
        await client.query('update contacts set data=$1,updated_at=now() where id=$2 and org_id=$3', [contact.data, contactId, org]); await client.query('commit');
        if (reasons.every(r => /window|cap|budget|minutes/i.test(r))) await this.queueContact(org, contactId, nextCallingWindow(campaign.data, new Date(), reasons.some(r => /cap|budget|minutes/i.test(r))));
        return;
      }
      if (activeCampaign.length >= campaign.data.schedule.concurrency || current.length >= Number(process.env.GLOBAL_CONCURRENCY ?? 4)) { await client.query('commit'); await this.queueContact(org, contactId, new Date(Date.now() + 60000)); return; }
      if (contact.data.last_attempt && Date.now() - new Date(contact.data.last_attempt).getTime() < campaign.data.schedule.retry_gap_min * 60000) { await client.query('commit'); await this.queueContact(org, contactId, new Date(new Date(contact.data.last_attempt).getTime() + campaign.data.schedule.retry_gap_min * 60000)); return; }
      const data: CallData = { campaign_id: campaign.id, contact_id: contactId, status: 'reserved', campaign_snapshot: campaign.data, agent_version: agentVersion(campaign.data), simulation: this.simulation, sample: campaign.data.sample, last_status: new Date().toISOString(), reservation_minutes: maxMinutes, reservation_stt: campaign.data.max_call_duration_s, reservation_tts: Math.min(10000, campaign.data.schedule.daily_tts_chars) };
      call = (await client.query('insert into calls(org_id,data) values($1,$2) returning *', [org, data])).rows[0];
      contact.data.attempts++; contact.data.last_attempt = new Date().toISOString(); contact.data.status = 'dialing';
      await client.query('update contacts set data=$1,updated_at=now() where id=$2 and org_id=$3', [contact.data, contactId, org]); await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    if (!call || !contact || !campaign) return;
    try {
      call.data.sid = await this.telephony.dial(contact.data.phone, call.id); call.data.status = 'ringing';
      await this.store.put('calls', org, call.data, call.id); await this.store.audit(org, 'call.dial', call.id, { simulation: this.simulation });
      if (this.simulation) await this.simulate(org, campaign, call, contact);
    } catch { await this.failCall(org, call, 'FAILED'); }
  }
  async createPipeline(org: string, c: Row<CampaignData>, call: Row<CallData>, transport: Transport, firstName = '') {
    if (call.data.campaign_snapshot) c = { ...c, data: { ...call.data.campaign_snapshot, status: c.data.status } };
    const contact = call.data.contact_id ? await this.store.get<ContactData>('contacts', org, call.data.contact_id) : undefined;
    if (!firstName) firstName = contact?.data.first_name || contact?.data.candidate_name || '';
    if (contact?.data.language && c.data.languages.includes(contact.data.language)) c = { ...c, data: { ...c.data, languages: [contact.data.language, ...c.data.languages.filter(l => l !== contact.data.language)] } };
    call.data.agent_version = agentVersion(c.data);
    call.data.campaign_snapshot = c.data;
    const trace = (provider: string, event: string) => pipeline.provider(provider, event);
    const primary = this.simulation ? this.tts : process.env.TTS_PROVIDER === 'sarvam' || process.env.TTS_PROVIDER === 'cartesia' ? new LegacyTtsAdapter(process.env.TTS_PROVIDER, call.id) : this.tts;
    const fallback = process.env.TTS_FALLBACK === 'cartesia' || process.env.TTS_FALLBACK === 'sarvam' ? new LegacyTtsAdapter(process.env.TTS_FALLBACK, call.id) : undefined;
    const stt: SttClient = this.simulation ? new MockStt() : new ResilientStt(() => process.env.STT_PROVIDER === 'soniox' ? new SonioxAdapter(call.id) : new GnaniSttClient(c.data.languages, call.id), process.env.STT_FALLBACK === 'soniox' ? () => new SonioxAdapter(call.id) : undefined, trace, process.env.STT_PROVIDER === 'soniox' ? 'Soniox' : 'Gnani Prisma v3.0');
    const pipeline = new ConversationPipeline(c.data, c.id, call.data.contact_id, stt, new ResilientTts(primary, fallback, trace), this.simulation ? new MockDialogue() : new CompatibleDialogue(), transport, {
      event: (type, data) => this.emit(org, call.id, type, data),
      suppress: async () => { const contact = call.data.contact_id ? await this.store.get<ContactData>('contacts', org, call.data.contact_id) : undefined; if (contact) await this.suppress(org, contact.data.phone); },
      complete: async result => {
        call.data.callback_at = pipeline.callbackAt;
        await this.saveResult(org, call, result, c.data.destination_ids);
        if (pipeline.callbackAt && call.data.contact_id) await this.queueContact(org, call.data.contact_id, new Date(pipeline.callbackAt));
        this.active.delete(call.id);
      },
      usage: async (sttSeconds, chars) => sttSeconds <= c.data.max_call_duration_s + 2 && chars <= Math.min(10000, c.data.schedule.daily_tts_chars),
    }, this.simulation, firstName);
    this.active.set(call.id, pipeline); call.data.status = 'in-progress'; await this.store.put('calls', org, call.data, call.id);
    return pipeline;
  }
  private async simulate(org: string, c: Row<CampaignData>, call: Row<CallData>, contact: Row<ContactData>) {
    const transport: Transport = { audio() {}, clear() {}, async mark() {}, async end() {} };
    const p = await this.createPipeline(org, c, call, transport, contact.data.first_name);
    await p.start();
    for (const text of ['Yes, this is a good time.', 'yes', 'Please tell me more.', 'No questions, thank you.', 'Yes, I agree to follow-up.']) await p.turn({ text, finalAt: Date.now(), endOfSpeechAt: Date.now(), language: c.data.languages[0] });
    await p.finish();
  }
  async suppress(org: string, raw: string) {
    const phone = normalizePhone(raw); if (!phone) throw new Error('Valid E.164 number required');
    await this.store.pool.query("insert into suppression(org_id,data) values($1,$2) on conflict (org_id,(data->>'phone')) do nothing", [org, { phone, reason: 'Operator or caller do-not-call request' }]);
    await this.store.pool.query("update contacts set data=jsonb_set(data,'{status}','\"suppressed\"') where org_id=$1 and data->>'phone'=$2", [org, phone]);
    await this.store.audit(org, 'contact.suppressed', 'phone-redacted');
  }
  async saveResult(org: string, call: Row<CallData>, result: CallResult, destinationIds: string[]) {
    // Result and delivery outbox are atomic. Maintenance recovers queue sends after a crash.
    const client = await this.store.pool.connect();
    try {
      await client.query('begin');
      const saved = (await client.query("insert into results(org_id,data) values($1,$2) on conflict (org_id,(data->>'call_id')) do nothing returning id", [org, { ...result, call_id: call.id }])).rows[0];
      if (saved && result.follow_up_eligible) for (const destinationId of destinationIds) await client.query("insert into deliveries(org_id,data) values($1,$2) on conflict (org_id,(data->>'idempotency_key')) do nothing", [org, { result_id: saved.id, destination_id: destinationId, idempotency_key: `${call.id}:${destinationId}`, status: 'pending', attempts: 0 }]);
      await client.query("update calls set data=data || $1::jsonb,updated_at=now() where org_id=$2 and id=$3", [{ status: result.outcome === 'FAILED' ? 'failed' : 'completed', callback_at: call.data.callback_at ?? null, last_status: new Date().toISOString() }, org, call.id]);
      if (call.data.contact_id) await client.query("update contacts set data=data || $1::jsonb,updated_at=now() where org_id=$2 and id=$3 and data->>'status'<>'suppressed'", [{ status: result.outcome === 'CALLBACK' ? 'callback' : result.outcome === 'WRONG_NUMBER' ? 'wrong_number' : result.outcome === 'FAILED' || result.outcome === 'NO_ANSWER' ? 'retry' : 'completed' }, org, call.data.contact_id]);
      await client.query('insert into audit_log(org_id,data) values($1,$2)', [org, { action: 'result.saved', entity_id: call.id, outcome: result.outcome }]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    for (const d of await this.store.list<DeliveryData>('deliveries', org)) if (d.data.status === 'pending') await this.boss.send('deliver', { org, id: d.id }, { singletonKey: d.id, singletonSeconds: 30 });
  }
  async failCall(org: string, call: Row<CallData>, outcome: 'FAILED' | 'NO_ANSWER' | 'VOICEMAIL') {
    if (this.active.has(call.id)) { await this.active.get(call.id)!.finish(outcome); return; }
    await this.saveResult(org, call, { campaign_id: call.data.campaign_id, contact_id: call.data.contact_id, outcome, summary: 'Call ended without a completed conversation.', extracted_fields: {}, sentiment: 'unknown', languages: [], transcript: [], tool_log: [], latency: [], usage: { stt_seconds: 0, tts_chars: 0, llm_tokens: 0, telephony_minutes: 0 }, provider_trace: [], agent_version: call.data.agent_version, sample: call.data.sample, simulation: call.data.simulation, duration_s: 0, follow_up_eligible: false }, []);
    if (call.data.contact_id && outcome !== 'VOICEMAIL') { const c = await this.store.get<CampaignData>('campaigns', org, call.data.campaign_id); if (c) await this.queueContact(org, call.data.contact_id, new Date(Date.now() + c.data.schedule.retry_gap_min * 60000)); }
  }
  async deliver(org: string, id: string) {
    const row = await this.store.get<DeliveryData>('deliveries', org, id);
    if (!row || row.data.status === 'delivered' || row.data.status === 'dead_letter') return;
    if (row.data.next_at && new Date(row.data.next_at).getTime() > Date.now()) return;
    const dest = await this.store.get<Destination>('destinations', org, row.data.destination_id), result = await this.store.get<CallResult>('results', org, row.data.result_id);
    try {
      if (!dest?.data.enabled || !result) throw new Error('Destination disabled/deleted or result deleted');
      await this.sendWebhook(dest.data, { id: result.id, ...result.data }, row.data.idempotency_key);
      row.data.status = 'delivered'; row.data.attempts++; delete row.data.error;
    } catch {
      row.data.attempts++; row.data.status = row.data.attempts >= 5 ? 'dead_letter' : 'pending';
      row.data.error = 'Webhook delivery failed; check destination and delivery receiver logs'; row.data.next_at = new Date(Date.now() + 1000 * 5 * 2 ** row.data.attempts).toISOString();
    }
    await this.store.put('deliveries', org, row.data, id); await this.store.audit(org, 'destination.delivery', id, { status: row.data.status, attempts: row.data.attempts });
    if (row.data.status === 'pending') await this.boss.send('deliver', { org, id }, { startAfter: new Date(row.data.next_at!), singletonKey: id, singletonSeconds: 5 });
  }
  async sendWebhook(dest: Destination, payload: unknown, key: string) {
    if (!process.env.WEBHOOK_SIGNING_SECRET) throw new Error('Webhook signing secret is required');
    const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000).toString();
    await postPublicWebhook(dest.url, body, { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Caller-Timestamp': timestamp, 'X-Caller-Signature': webhookSignature(body, timestamp, process.env.WEBHOOK_SIGNING_SECRET) });
  }
  async maintenance() {
    const orgs = (await this.store.pool.query('select distinct org_id from campaigns union select distinct org_id from settings')).rows as { org_id: string }[];
    for (const { org_id: org } of orgs) {
      const settings = (await this.store.list('settings', org))[0]?.data ?? {};
      const days = Math.min(365, Math.max(1, Number(settings.retention_days ?? 30)));
      await this.store.pool.query("delete from results where org_id=$1 and created_at < now()-($2*interval '1 day')", [org, days]);
      await this.store.pool.query("delete from calls where org_id=$1 and created_at < now()-($2*interval '1 day')", [org, days]);
      await this.store.pool.query("delete from deliveries where org_id=$1 and created_at < now()-($2*interval '1 day')", [org, days]);
      for (const call of await this.store.list<CallData>('calls', org)) {
        if (['reserved', 'ringing', 'in-progress'].includes(call.data.status) && !this.active.has(call.id) && Date.now() - new Date(call.data.last_status).getTime() > 12 * 60000) await this.failCall(org, call, 'FAILED');
        if (call.data.callback_at && call.data.contact_id) {
          const contact = await this.store.get<ContactData>('contacts', org, call.data.contact_id);
          if (contact?.data.status === 'callback') await this.queueContact(org, contact.id, new Date(call.data.callback_at));
        }
      }
      for (const d of await this.store.list<DeliveryData>('deliveries', org)) if (d.data.status === 'pending' && (!d.data.next_at || new Date(d.data.next_at).getTime() < Date.now())) await this.boss.send('deliver', { org, id: d.id }, { singletonKey: d.id, singletonSeconds: 30 });
    }
    await this.store.pool.query('delete from sessions where expires_at<now()');
  }
  async browserCall(org: string, campaignId: string, transport: Transport) {
    if (this.draining || this.active.size >= Number(process.env.GLOBAL_CONCURRENCY ?? 4)) throw new Error('Server busy or draining');
    const c = await this.store.get<CampaignData>('campaigns', org, campaignId); if (!c) throw new Error('Campaign not found');
    const client = await this.store.pool.connect(); let call: Row<CallData>;
    try {
      await client.query('begin'); await client.query("select pg_advisory_xact_lock(hashtext('dial-reservations'))");
      const settings = (await client.query('select data from settings where org_id=$1 limit 1', [org])).rows[0]?.data ?? {};
      const current = (await client.query("select * from calls where org_id=$1 and data->>'status' in ('reserved','ringing','in-progress')", [org])).rows as Row<CallData>[];
      const results = (await client.query("select * from results where org_id=$1 and (created_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date", [org])).rows as Row<CallResult>[];
      const own = current.filter(r => r.data.campaign_id === c.id), ownResults = results.filter(r => r.data.campaign_id === c.id);
      const reservedChars = Math.min(10000, c.data.schedule.daily_tts_chars), reservedSeconds = c.data.max_call_duration_s;
      const stt = (rows: Row<CallResult>[]) => rows.reduce((sum, r) => sum + Number(r.data.usage?.stt_seconds ?? 0), 0);
      const tts = (rows: Row<CallResult>[]) => rows.reduce((sum, r) => sum + Number(r.data.usage?.tts_chars ?? 0), 0);
      const minutes = (rows: Row<CallResult>[]) => rows.reduce((sum, r) => sum + Number(r.data.duration_s ?? 0) / 60, 0);
      if (settings.kill_switch || current.length >= Number(process.env.GLOBAL_CONCURRENCY ?? 4) || own.length >= c.data.schedule.concurrency) throw new Error('Calling paused or concurrency cap reached');
      if (stt(results) + current.reduce((s, r) => s + (r.data.reservation_stt ?? 0), 0) + reservedSeconds > Number(settings.global_daily_stt_seconds ?? 12000) || tts(results) + current.reduce((s, r) => s + (r.data.reservation_tts ?? 0), 0) + reservedChars > Number(settings.global_daily_tts_chars ?? 200000) || minutes(results) + current.reduce((s, r) => s + (r.data.reservation_minutes ?? 0), 0) + reservedSeconds / 60 > Number(settings.global_daily_minutes ?? 200)) throw new Error('Global daily usage cap reached');
      if (stt(ownResults) + own.reduce((s, r) => s + (r.data.reservation_stt ?? 0), 0) + reservedSeconds > c.data.schedule.daily_stt_seconds || tts(ownResults) + own.reduce((s, r) => s + (r.data.reservation_tts ?? 0), 0) + reservedChars > c.data.schedule.daily_tts_chars || minutes(ownResults) + own.reduce((s, r) => s + (r.data.reservation_minutes ?? 0), 0) + reservedSeconds / 60 > c.data.schedule.daily_minutes) throw new Error('Campaign daily usage cap reached');
      const data: CallData = { campaign_id: c.id, status: 'in-progress', agent_version: agentVersion(c.data), simulation: this.simulation, sample: c.data.sample, last_status: new Date().toISOString(), reservation_stt: reservedSeconds, reservation_tts: reservedChars, reservation_minutes: reservedSeconds / 60 };
      call = (await client.query('insert into calls(org_id,data) values($1,$2) returning *', [org, data])).rows[0]; await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    return { call, pipeline: await this.createPipeline(org, c, call, transport) };
  }
  async close() {
    this.draining = true;
    const deadline = Date.now() + Number(process.env.DRAIN_SECONDS ?? 25) * 1000;
    while (this.active.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
    await Promise.allSettled([...this.active.values()].map(p => p.finish('FAILED')));
    for (const [ws] of this.monitors) ws.close(1001, 'Server shutting down');
    await this.boss.stop({ graceful: true, timeout: 5000 });
  }
  metrics() { return `caller_active_calls ${this.active.size}\ncaller_queue_errors_total ${this.errorCount}\ncaller_draining ${Number(this.draining)}\n`; }
}
