import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Store } from '../../apps/server/src/db/store.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const store = new Store(process.env.DATABASE_URL);
try {
  const client = await store.pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('caller-migrations'))");
    await client.query(await readFile('apps/server/migrations/001_initial.sql', 'utf8'));
    await client.query('commit');
    console.log('Database migration applied');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await store.pool.end();
}
