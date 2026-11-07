import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllSessions } from '../../src/state/call-session.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const summaries = getAllSessions().map((session) => ({
    callSid: session.callSid,
    phone: session.phone,
    status: session.status,
    intent: session.intent,
    callType: session.callType,
    callStartedAt: session.callStartedAt,
    callEndedAt: session.callEndedAt,
    durationSeconds: session.durationSeconds,
    transcriptLength: session.transcript.length,
  }));

  res.status(200).json({ calls: summaries });
}
