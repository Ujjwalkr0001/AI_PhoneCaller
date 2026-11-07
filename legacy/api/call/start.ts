import type { VercelRequest, VercelResponse } from '@vercel/node';
import { E164_PATTERN, triggerCall } from '../../src/services/call-trigger.js';
import { logger } from '../../src/utils/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const providedSecret = req.headers['x-call-secret'];
  const expectedSecret = process.env.CALL_TRIGGER_SECRET;
  if (!expectedSecret || providedSecret !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
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
