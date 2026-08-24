import { Client } from '@upstash/qstash';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export interface ScheduleFutureCallParams {
  targetUrl: string;
  body: Record<string, unknown>;
  fireAt: Date;
}

/**
 * Schedules a one-time future HTTP POST via Upstash QStash. Chosen instead
 * of the `workflow` npm package because that package requires the Nitro
 * build system (see src/services/callback.ts for context) — QStash needs no
 * build changes and carries the callback payload in the message itself, so
 * no persistent store is needed either.
 */
export async function scheduleFutureCall({ targetUrl, body, fireAt }: ScheduleFutureCallParams): Promise<void> {
  const client = new Client({ token: requireEnv('QSTASH_TOKEN') });
  await client.publishJSON({
    url: targetUrl,
    body,
    notBefore: Math.floor(fireAt.getTime() / 1000),
  });
}
