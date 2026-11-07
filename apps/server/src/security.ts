import { createHash, createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import argon2 from 'argon2';
import twilio from 'twilio';
import { twilioWebhookBase } from './provider-config.js';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '../../../packages/shared/src/index.js';
import { Store, demoOrg } from './db/store.js';

export const hashToken = (s: string) => createHash('sha256').update(s).digest('hex');
export const maskPhone = (s: string) =>
  s
    .replace(/\+?\d[\d ()-]{6,}\d/g, (p) => `+••••••${p.replace(/\D/g, '').slice(-4)}`)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, '[email redacted]');
export function redactSensitive(s: string, hr: boolean): string {
  if (
    hr &&
    /religio|caste|married|marital|pregnan|diagnos|disabil|hindu|muslim|christian|health|sexual|born in|years old/i.test(
      s,
    )
  )
    return '[Sensitive personal detail omitted]';
  return maskPhone(s);
}
export const webhookSignature = (body: string, timestamp: string, secret: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
export interface UserSession {
  id: string;
  user_id: string;
  org_id: string;
  role: Role;
  email: string;
  csrf: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserSession;
  }
}
export async function seedAdmin(store: Store) {
  const email = process.env.SEED_ADMIN_EMAIL,
    password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('Seed password must contain at least 12 characters');
  await store.pool.query(
    'insert into users(org_id,email,password_hash,data) values($1,$2,$3,$4) on conflict(email) do nothing',
    [
      demoOrg,
      email.toLowerCase(),
      await argon2.hash(password, { type: argon2.argon2id }),
      { role: 'admin' },
    ],
  );
}
export async function authenticate(
  req: FastifyRequest,
  store: Store,
): Promise<UserSession | undefined> {
  const raw = req.cookies.session;
  const token = raw && process.env.SESSION_SECRET ? req.unsignCookie(raw).value : raw;
  if (!token) return;
  const result = await store.pool.query(
    "select s.id,s.org_id,s.data,u.data as user_data,u.email,u.id as user_id from sessions s join users u on (s.data->>'user_id')::uuid=u.id where s.token_hash=$1 and s.expires_at>now() and s.org_id=u.org_id",
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return;
  return {
    id: row.id,
    user_id: row.user_id,
    org_id: row.org_id,
    email: row.email,
    csrf: row.data.csrf,
    role: row.user_data.role,
  };
}
export async function authRoutes(app: FastifyInstance, store: Store) {
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = z
        .object({ email: z.string().email().max(254), password: z.string().max(200) })
        .parse(req.body);
      const result = await store.pool.query('select * from users where email=$1', [
        email.toLowerCase(),
      ]);
      const user = result.rows[0];
      // Dummy hash prevents a fast missing-user path.
      const valid = await argon2.verify(
        user?.password_hash ?? (await argon2.hash('dummy-login-password')),
        password,
      );
      if (!user || !valid) return reply.code(401).send({ error: 'Invalid email or password' });
      const token = randomBytes(32).toString('hex'),
        csrf = randomBytes(32).toString('hex');
      await store.pool.query(
        "insert into sessions(org_id,token_hash,expires_at,data) values($1,$2,now()+interval '12 hours',$3)",
        [user.org_id, hashToken(token), { user_id: user.id, csrf }],
      );
      reply.setCookie('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: !!process.env.SESSION_SECRET,
        sameSite: 'strict',
        maxAge: 43200,
      });
      return { email: user.email, role: user.data.role, csrf };
    },
  );
  app.get('/api/v1/auth/me', async (req) => ({
    email: req.user!.email,
    role: req.user!.role,
    csrf: req.user!.csrf,
  }));
  app.post('/api/v1/auth/logout', async (req, reply) => {
    await store.pool.query('delete from sessions where id=$1 and org_id=$2', [
      req.user!.id,
      req.user!.org_id,
    ]);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
}
export function validTwilio(req: FastifyRequest): boolean {
  const secret = process.env.TWILIO_AUTH_TOKEN,
    base = twilioWebhookBase();
  if (!secret || !base) return false;
  const signature = req.headers['x-twilio-signature'];
  const urls = req.url.startsWith('/twilio/media')
    ? [`${base.replace(/^http/, 'ws')}${req.url}`, `${base.replace(/^http/, 'ws')}${req.url}/`]
    : [`${base}${req.url}`];
  return (
    typeof signature === 'string' &&
    urls.some((url) =>
      twilio.validateRequest(
        secret,
        signature,
        url,
        (req.body ?? {}) as Record<string, string>,
      ),
    )
  );
}
export async function safeDestination(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443')
  )
    throw new Error('Public HTTPS destination required');
  const addresses = await lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address)))
    throw new Error('Private or reserved destinations are blocked');
  return { parsed, addresses };
}
export async function postPublicWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
) {
  const { parsed, addresses } = await safeDestination(url);
  // Pin connection to the vetted address; keep original TLS SNI/Host. No redirect or DNS rebinding hop.
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: addresses[0].address,
        port: 443,
        servername: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        agent: false,
        timeout: 10000,
        headers: { ...headers, Host: parsed.host, 'Content-Length': Buffer.byteLength(body) },
      },
      (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)
          resolve();
        else reject(new Error('Webhook receiver rejected delivery'));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
export function privateAddress(ip: string) {
  if (isIP(ip) === 6) return !/^[23]/.test(ip); // Only global unicast; disallow mapped IPv4 and local ranges.
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
