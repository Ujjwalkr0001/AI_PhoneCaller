import 'dotenv/config';
import { Store } from './db/store.js';
import { buildApp } from './app.js';
import { Platform } from './platform.js';
import { seedAdmin } from './security.js';
if (!process.env.DATABASE_URL || !process.env.PUBLIC_BASE_URL) throw new Error('DATABASE_URL and PUBLIC_BASE_URL are required');
if (process.env.NODE_ENV === 'production' && process.env.MOCK_MODE === 'true' && process.env.ALLOW_DEPLOYED_SIMULATION !== 'true') throw new Error('Deployed simulations require explicit ALLOW_DEPLOYED_SIMULATION=true');
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_BASE_URL.startsWith('https://')) throw new Error('Production requires HTTPS');
const store = new Store(process.env.DATABASE_URL);
await store.ready(); await seedAdmin(store);
const platform = new Platform(store); await platform.start();
const app = await buildApp(store, platform);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true; platform.draining = true;
  void platform.close().then(() => app.close()).then(() => store.pool.end()).then(() => process.exit(0)).catch(error => { app.log.error({ err: error }, 'Shutdown failed'); process.exit(1); });
});
