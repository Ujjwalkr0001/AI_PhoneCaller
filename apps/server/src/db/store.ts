import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Row } from '../../../../packages/shared/src/index.js';

export const tables = ['campaigns', 'contacts', 'calls', 'results', 'audit_log', 'suppression', 'destinations', 'deliveries', 'settings'] as const;
export type Table = typeof tables[number];
export const demoOrg = '00000000-0000-4000-8000-000000000001';
export class Store {
  readonly pool: pg.Pool;
  readonly orm: ReturnType<typeof drizzle>;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, application_name: 'gnani-caller' });
    this.orm = drizzle(this.pool);
  }
  async ready() { await this.orm.execute(sql`select 1`); }
  async list<T = Record<string, unknown>>(table: Table, org: string): Promise<Row<T>[]> {
    return (await this.orm.execute(sql`select * from ${sql.identifier(table)} where org_id=${org} order by created_at desc limit 5000`)).rows as unknown as Row<T>[];
  }
  async get<T = Record<string, unknown>>(table: Table, org: string, id: string): Promise<Row<T> | undefined> {
    return (await this.orm.execute(sql`select * from ${sql.identifier(table)} where org_id=${org} and id=${id}`)).rows[0] as unknown as Row<T> | undefined;
  }
  async put<T>(table: Table, org: string, data: T, id: string = randomUUID()): Promise<Row<T>> {
    const result = await this.pool.query(`insert into ${table} (id,org_id,data) values ($1,$2,$3) on conflict (id) do update set data=excluded.data,updated_at=now() where ${table}.org_id=excluded.org_id returning *`, [id, org, JSON.stringify(data)]);
    if (!result.rows[0]) throw new Error('Tenant mismatch');
    return result.rows[0];
  }
  async remove(table: Table, org: string, id: string) { await this.pool.query(`delete from ${table} where org_id=$1 and id=$2`, [org, id]); }
  async audit(org: string, action: string, entity_id: string, detail: Record<string, unknown> = {}) { await this.put('audit_log', org, { action, entity_id, ...detail }); }
}
