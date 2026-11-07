import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../../src/state/call-session.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const callSid = typeof req.query?.callSid === 'string' ? req.query.callSid : undefined;
  if (!callSid) {
    res.status(400).json({ error: 'Query must include "callSid"' });
    return;
  }

  const session = getSession(callSid);
  if (!session) {
    res.status(404).json({ error: 'Unknown callSid' });
    return;
  }

  res.status(200).json(session);
}
