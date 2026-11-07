import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { defaultCampaign } from '../packages/shared/src/index.js';
const base = process.env.SMOKE_BASE_URL ?? process.env.PUBLIC_BASE_URL;
if (!base || !process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) throw new Error('Set SMOKE_BASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD');
for (const path of ['/healthz', '/readyz']) { const r = await fetch(`${base}${path}`); if (!r.ok) throw new Error(`${path} failed`); }
const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error('Login failed');
const user = await login.json() as { csrf: string }, cookie = login.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
const request = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': user.csrf, 'Idempotency-Key': randomUUID(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed: HTTP ${r.status}`); return r.json() as Promise<{ id: string }>;
};
const c = defaultCampaign('hr'); c.name = 'Synthetic smoke test'; c.company_name = 'Synthetic test company'; c.sample = true;
const saved = await request('/campaigns', 'POST', c);
try {
  // Only handshake; do not start chargeable speech providers.
  await new Promise<void>((resolve, reject) => { const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/browser/${saved.id}`, { headers: { Cookie: cookie, Origin: base } }); const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Browser handshake timeout')); }, 8000); ws.on('message', () => { clearTimeout(timeout); ws.close(); resolve(); }); ws.on('error', reject); });
  if (process.env.SMOKE_DESTINATION_ID) await request(`/destinations/${process.env.SMOKE_DESTINATION_ID}/test`, 'POST');
  else console.log('Destination test-send NOT RUN: set SMOKE_DESTINATION_ID for an approved synthetic receiver.');
  console.log('PASS: health, readiness, login, campaign CRUD, authenticated browser-call handshake');
} finally { await request(`/campaigns/${saved.id}`, 'DELETE'); await request('/auth/logout', 'POST'); }
