import { pgTable, uuid, jsonb, timestamp, text, uniqueIndex } from 'drizzle-orm/pg-core';
// Tenant-scoped document tables use shared validated payloads; relational IDs and indexes remain explicit.
const columns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').notNull(),
  data: jsonb('data').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const campaigns = pgTable('campaigns', columns());
export const contacts = pgTable('contacts', columns());
export const calls = pgTable('calls', columns());
export const results = pgTable('results', columns());
export const auditLog = pgTable('audit_log', columns());
export const suppression = pgTable('suppression', columns());
export const destinations = pgTable('destinations', columns());
export const deliveries = pgTable('deliveries', columns());
export const settings = pgTable('settings', columns());
export const users = pgTable('users', {
  ...columns(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
});
export const sessions = pgTable(
  'sessions',
  {
    ...columns(),
    token_hash: text('token_hash').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('session_token').on(t.token_hash)],
);
