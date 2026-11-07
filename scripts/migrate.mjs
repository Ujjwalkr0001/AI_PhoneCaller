import pg from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect(); await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('caller-migrations'))");
  await client.query(await readFile('apps/server/migrations/001_initial.sql', 'utf8'));
  await client.query('commit'); console.log('Migration complete');
} catch (e) { await client.query('rollback').catch(() => undefined); throw e; } finally { await client.end(); }
