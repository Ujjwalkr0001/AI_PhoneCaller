import type { VercelRequest, VercelResponse } from '@vercel/node';
import { placeOutboundCall } from '../../src/services/twilio.js';
import { createSession } from '../../src/state/call-session.js';
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
  if (typeof to !== 'string' || !/^\+\d{8,15}$/.test(to)) {
    res.status(400).json({ error: 'Body must include "to" as an E.164 phone number, e.g. +15551234567' });
    return;
  }

  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    res.status(500).json({ error: 'PUBLIC_BASE_URL is not configured' });
    return;
  }

  try {
    const call = await placeOutboundCall({
      to,
      voiceWebhookUrl: `${baseUrl}/api/twilio/voice`,
      statusCallbackUrl: `${baseUrl}/api/twilio/status`,
    });

    createSession(call.sid, to);
    logger.withCallSid(call.sid).info('Outbound call placed', { to, status: call.status });

    res.status(200).json({ callSid: call.sid, status: call.status });
  } catch (error) {
    logger.error('Failed to place outbound call', error);
    res.status(500).json({ error: 'Failed to place call' });
  }
}
