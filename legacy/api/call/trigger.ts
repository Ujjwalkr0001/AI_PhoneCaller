import type { VercelRequest, VercelResponse } from '@vercel/node';
import { E164_PATTERN, triggerCall } from '../../src/services/call-trigger.js';
import { logger } from '../../src/utils/logger.js';

/** Same as start.ts but for the browser dashboard — no shared-secret header,
 * since it's meant to be called from the same private tunnel URL a user is
 * already looking at the page through. start.ts stays secret-protected for
 * server-to-server automation (QStash, etc). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { to } = req.body ?? {};
  if (typeof to !== 'string' || !E164_PATTERN.test(to)) {
    res.status(400).json({ error: 'Body must include "to" as an E.164 phone number, e.g. +15551234567' });
    return;
  }

  try {
    const result = await triggerCall(to);
    res.status(200).json(result);
  } catch (error) {
    logger.error('Failed to place outbound call', error);
    res.status(500).json({ error: 'Failed to place call' });
  }
}
