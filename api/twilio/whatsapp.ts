import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../../src/utils/logger.js';

// Twilio posts inbound WhatsApp messages here, including sandbox "join <code>"
// messages. We don't need to act on them — just log so it's visible whether
// the target number has joined the sandbox during setup/testing.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const from = typeof req.body?.From === 'string' ? req.body.From : 'unknown';
  const body = typeof req.body?.Body === 'string' ? req.body.Body : '';
  logger.info('Inbound WhatsApp message', { from, body });
  res.status(200).send('');
}
