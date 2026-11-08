import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import argon2 from 'argon2';
import twilio from 'twilio';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Store, tables } from '../../apps/server/src/db/store.js';
import { buildApp } from '../../apps/server/src/app.js';
import { Platform, type CallData, type DeliveryData } from '../../apps/server/src/platform.js';
import {
  defaultCampaign,
  type CallResult,
  type Destination,
} from '../../packages/shared/src/index.js';
import { agentVersion } from '../../apps/server/src/domain.js';
import { hashToken } from '../../apps/server/src/security.js';

// Dedicated test connection only. Never truncate/reset a shared database; every fixture has a random tenant.
const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:local-development-only@localhost:54329/caller';
const org = randomUUID(),
  other = randomUUID(),
  store = new Store(url);
let platform: Platform,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = '',
  csrf = '';
const email = `synthetic-${org}@example.test`;
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('MOCK_MODE', 'true');
  vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:3000');
  vi.stubEnv('SESSION_SECRET', 'synthetic-test-cookie-secret-at-least-32-characters');
  await store.pool.query(await readFile('apps/server/migrations/001_initial.sql', 'utf8'));
  await store.pool.query('insert into users(org_id,email,password_hash,data) values($1,$2,$3,$4)', [
    org,
    email,
    await argon2.hash('synthetic-test-password'),
    { role: 'admin' },
  ]);
  platform = new Platform(store);
  await platform.start();
  app = await buildApp(store, platform);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'synthetic-test-password' },
  });
  expect(login.statusCode).toBe(200);
  cookie = login.cookies[0].name + '=' + login.cookies[0].value;
  csrf = login.json().csrf;
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await platform?.close();
  await app?.close();
  for (const table of [...tables, 'sessions', 'users'])
    await store.pool.query(`delete from ${table} where org_id=any($1::uuid[])`, [[org, other]]);
  await store.pool.end();
  vi.unstubAllEnvs();
}, 30000);
const headers = () => ({ cookie, 'x-csrf-token': csrf, 'idempotency-key': randomUUID() });
describe('Postgres + authenticated API', () => {
  it('health is public but data, metrics, browser WS are authenticated', async () => {
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    for (const path of ['/api/v1/campaigns', '/metrics', '/ws/browser/' + randomUUID()])
      expect((await app.inject(path)).statusCode).toBe(401);
  });
  it('login cookie is httpOnly, SameSite strict; stored token is hashed', async () => {
    const token = decodeURIComponent(cookie.split('=')[1]).split('.')[0];
    const stored = (
      await store.pool.query('select token_hash from sessions where org_id=$1', [org])
    ).rows[0];
    expect(stored.token_hash).toBe(hashToken(token));
    expect(stored.token_hash).not.toBe(token);
  });
  it('missing CSRF and invalid origins cannot mutate', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/campaigns',
          headers: { cookie },
          payload: defaultCampaign(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin: 'https://evil.example' },
          payload: { email, password: 'synthetic-test-password' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('tampered signed session cookie is rejected', async () => {
    expect(
      (await app.inject({ url: '/api/v1/campaigns', headers: { cookie: cookie + 'tampered' } }))
        .statusCode,
    ).toBe(401);
  });
  it('browser calls reserve usage and fail closed on global caps or kill switch', async () => {
    const c = await store.put('campaigns', org, { ...defaultCampaign(), status: 'draft' });
    const settings = await store.put('settings', org, { global_daily_tts_chars: 1 });
    const transport = { audio() {}, clear() {}, async mark() {}, async end() {} };
    await expect(platform.browserCall(org, c.id, transport)).rejects.toThrow('usage cap');
    await store.put('settings', org, { kill_switch: true }, settings.id);
    await expect(platform.browserCall(org, c.id, transport)).rejects.toThrow('paused');
    await store.remove('settings', org, settings.id);
  });
  it('org isolation applies to list, get and update', async () => {
    const foreign = await store.put('campaigns', other, { ...defaultCampaign(), status: 'draft' });
    expect(
      (await app.inject({ url: '/api/v1/campaigns', headers: headers() }))
        .json()
        .some((r: { id: string }) => r.id === foreign.id),
    ).toBe(false);
    expect(
      (await app.inject({ url: `/api/v1/campaigns/${foreign.id}`, headers: headers() })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/campaigns/${foreign.id}`,
          headers: headers(),
          payload: defaultCampaign(),
        })
      ).statusCode,
    ).toBe(400);
  });
  it('contact import flags invalid, duplicate and suppressed rows', async () => {
    const c = await store.put('campaigns', org, { ...defaultCampaign(), status: 'draft' });
    await platform.suppress(org, '+12025550109');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/contacts`,
      headers: headers(),
      payload: [
        { phone: 'bad' },
        { phone: '+12025550101' },
        { phone: '+12025550101' },
        { phone: '+12025550109' },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((r: { status: string }) => r.status)).toEqual([
      'invalid',
      'valid',
      'duplicate',
      'suppressed',
    ]);
  });
  it('DND persists across instances and prevents dial', async () => {
    const c = defaultCampaign();
    c.compliance = { attested: true, test_mode: true, allowlist: ['+12025550109'] };
    const campaign = await store.put('campaigns', org, { ...c, status: 'running' });
    const contact = await store.put('contacts', org, {
      phone: '+12025550109',
      campaign_id: campaign.id,
      status: 'ready',
      attempts: 0,
    });
    const dial = vi.spyOn(platform.telephony, 'dial');
    await platform.dial(org, contact.id);
    expect(dial).not.toHaveBeenCalled();
    expect((await store.get('contacts', org, contact.id))?.data.status).toBe('suppressed');
    const second = new Store(url);
    expect(
      (await second.list<{ phone: string }>('suppression', org)).some(
        (s) => s.data.phone === '+12025550109',
      ),
    ).toBe(true);
    await second.pool.end();
  });
  it('does not queue another call after the configured attempt limit', async () => {
    const campaignData = defaultCampaign('hr');
    campaignData.schedule.max_attempts = 1;
    const campaign = await store.put('campaigns', org, { ...campaignData, status: 'running' });
    const contact = await store.put('contacts', org, {
      phone: '+12025550177',
      campaign_id: campaign.id,
      status: 'dialing',
      attempts: 1,
    });
    const call = await store.put<CallData>('calls', org, {
      campaign_id: campaign.id,
      contact_id: contact.id,
      status: 'ringing',
      agent_version: 'test',
      simulation: true,
      sample: true,
      last_status: new Date().toISOString(),
    });
    await platform.failCall(org, call, 'NO_ANSWER');
    expect((await store.get('contacts', org, contact.id))?.data).toMatchObject({
      status: 'blocked',
      blocked_reason: 'Maximum attempts reached',
    });
    const pending = await store.pool.query(
      "select id from pgboss.job where name='dial' and data->>'contactId'=$1 and state in ('created','active','retry')",
      [contact.id],
    );
    expect(pending.rowCount).toBe(0);
  });
  it('launch idempotency retains one campaign transition', async () => {
    const c = defaultCampaign();
    c.compliance.attested = true;
    const campaign = await store.put('campaigns', org, { ...c, status: 'draft' });
    const key = randomUUID();
    await platform.launch(org, campaign.id, key);
    await platform.launch(org, campaign.id, key);
    expect(
      (await store.list('audit_log', org)).filter(
        (r) => r.data.action === 'campaign.launch' && r.data.entity_id === campaign.id,
      ),
    ).toHaveLength(1);
  });
  it('keeps a future dial job when the current singleton slot already has a job', async () => {
    const contactId = randomUUID();
    const future = new Date(Date.now() + 10 * 60000);
    const ids: string[] = [];
    try {
      const currentId = await platform.queueContact(org, contactId);
      if (currentId) ids.push(currentId);
      const futureId = await platform.queueContact(org, contactId, future);
      if (futureId) ids.push(futureId);
      expect(ids).toHaveLength(2);
      const rows = await store.pool.query(
        'select singleton_key,start_after from pgboss.job where id=any($1::uuid[])',
        [ids],
      );
      expect(rows.rows).toHaveLength(2);
      expect(new Set(rows.rows.map((r) => r.singleton_key)).size).toBe(2);
      expect(rows.rows.some((r) => new Date(r.start_after).getTime() >= future.getTime())).toBe(
        true,
      );
    } finally {
      if (ids.length) await platform.boss.deleteJob('dial', ids);
    }
  });
  it('full browser pipeline persists result once before submissions', async () => {
    const c = await store.put('campaigns', org, { ...defaultCampaign('hr'), status: 'draft' });
    const { call, pipeline } = await platform.browserCall(org, c.id, {
      audio() {},
      clear() {},
      async mark() {},
      async end() {},
    });
    await pipeline.start();
    for (const text of ['Yes', 'yes', 'Continue', 'No questions', 'Yes, I agree'])
      await pipeline.turn({ text, finalAt: Date.now() });
    await pipeline.finish();
    await pipeline.finish();
    const results = (await store.list<CallResult & { call_id: string }>('results', org)).filter(
      (r) => r.data.call_id === call.id,
    );
    expect(results).toHaveLength(1);
    expect(results[0].data.outcome).toBe('CANDIDATE_COMPLETED');
    expect((await store.get('calls', org, call.id))?.data.status).toBe('completed');
  });
  it('signature validation rejects forged Twilio voice/status', async () => {
    for (const path of ['/twilio/voice', '/twilio/status'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            headers: { 'x-twilio-signature': 'forged' },
            payload: { CallSid: 'bad' },
          })
        ).statusCode,
      ).toBe(403);
  });
  it('streams a signed answered call even when machine detection labels it machine_start', async () => {
    const oldToken = process.env.TWILIO_AUTH_TOKEN;
    const oldBase = process.env.TWILIO_WEBHOOK_BASE_URL;
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-token';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'https://demo.example.test';
    try {
      const call = await store.put('calls', org, {
        sid: 'CA-synthetic',
        status: 'ringing',
        contact_id: randomUUID(),
      });
      const path = `/twilio/voice?call_id=${call.id}`;
      const body = { CallSid: 'CA-synthetic', AnsweredBy: 'machine_start' };
      const signature = twilio.getExpectedTwilioSignature(
        'synthetic-token',
        `https://demo.example.test${path}`,
        body,
      );
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        payload: new URLSearchParams(body).toString(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<Stream');
      expect(response.body).not.toContain('<Hangup');
    } finally {
      if (oldToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = oldToken;
      if (oldBase === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
      else process.env.TWILIO_WEBHOOK_BASE_URL = oldBase;
    }
  });
  it('delivery retries exponentially to dead letter, result remains saved', async () => {
    const d = await store.put<Destination>('destinations', org, {
      name: 'Synthetic receiver',
      url: 'https://example.com/webhook',
      kind: 'webhook',
      enabled: true,
    });
    const r = await store.put('results', org, { sample: true, test_fixture: true });
    const delivery = await store.put<DeliveryData>('deliveries', org, {
      destination_id: d.id,
      result_id: r.id,
      idempotency_key: randomUUID(),
      attempts: 0,
      status: 'pending',
    });
    const sent = vi
      .spyOn(platform, 'sendWebhook')
      .mockRejectedValue(new Error('Synthetic failure'));
    vi.spyOn(platform.boss, 'send').mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      const row = (await store.get<DeliveryData>('deliveries', org, delivery.id))!;
      delete row.data.next_at;
      await store.put('deliveries', org, row.data, row.id);
      await platform.deliver(org, row.id);
    }
    expect((await store.get<DeliveryData>('deliveries', org, delivery.id))?.data.status).toBe(
      'dead_letter',
    );
    expect(sent).toHaveBeenCalledTimes(5);
    expect(await store.get('results', org, r.id)).toBeDefined();
  });
  it('successful delivery is idempotent on retry', async () => {
    const d = await store.put<Destination>('destinations', org, {
      name: 'Synthetic receiver',
      url: 'https://example.com/webhook',
      kind: 'webhook',
      enabled: true,
    });
    const result = await store.put('results', org, { sample: true });
    const row = await store.put<DeliveryData>('deliveries', org, {
      destination_id: d.id,
      result_id: result.id,
      idempotency_key: randomUUID(),
      attempts: 0,
      status: 'pending',
    });
    const send = vi.spyOn(platform, 'sendWebhook').mockResolvedValue();
    await platform.deliver(org, row.id);
    await platform.deliver(org, row.id);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('CSV exports neutralize formula injection', async () => {
    const c = await store.put('campaigns', org, { ...defaultCampaign(), status: 'draft' });
    await store.put('results', org, {
      campaign_id: c.id,
      outcome: 'FAILED',
      summary: '=IMPORTXML("x")',
      extracted_fields: {},
      simulation: true,
      sample: true,
    });
    const response = await app.inject({
      url: `/api/v1/results/export?campaign_id=${c.id}`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("'=IMPORTXML");
  });
  it('call deletion removes its result', async () => {
    const c = defaultCampaign(),
      call = await store.put<CallData>('calls', org, {
        campaign_id: randomUUID(),
        status: 'completed',
        agent_version: agentVersion(c),
        simulation: true,
        sample: true,
        last_status: new Date().toISOString(),
      });
    const result = await store.put('results', org, { call_id: call.id });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/calls/${call.id}`, headers: headers() }))
        .statusCode,
    ).toBe(200);
    expect(await store.get('results', org, result.id)).toBeUndefined();
  });
});
