import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../../src/state/call-session.js';
import { logger } from '../../src/utils/logger.js';
import { runPostCallFollowUp } from '../../src/services/callback.js';

const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const callSid = typeof req.body?.CallSid === 'string' ? req.body.CallSid : undefined;
  const callStatus = typeof req.body?.CallStatus === 'string' ? req.body.CallStatus : undefined;
  const callDuration = typeof req.body?.CallDuration === 'string' ? Number(req.body.CallDuration) : undefined;
  const log = logger.withCallSid(callSid ?? 'unknown');

  if (!callSid || !callStatus) {
    log.warn('Status callback missing CallSid/CallStatus', req.body);
    res.status(200).end();
    return;
  }

  log.info('Call status update', { callStatus });

  const session = getSession(callSid);
  if (!session) {
    log.warn('Status callback for unknown session');
    res.status(200).end();
    return;
  }

  if (callStatus === 'in-progress') {
    session.status = 'in-progress';
    session.answeredAt ??= new Date().toISOString();
  } else if (callStatus === 'completed') {
    session.status = 'completed';
    session.callEndedAt = new Date().toISOString();
    if (callDuration !== undefined && !Number.isNaN(callDuration)) session.durationSeconds = callDuration;
    try {
      await runPostCallFollowUp(session);
    } catch (error) {
      log.error('Post-call follow-up failed', error);
    }
  } else if (callStatus === 'no-answer' || callStatus === 'busy' || callStatus === 'failed') {
    session.status = callStatus;
    session.callEndedAt = new Date().toISOString();
    log.info('Call ended without connecting', { callStatus });
  } else if (TERMINAL_STATUSES.has(callStatus)) {
    session.callEndedAt = new Date().toISOString();
    log.info('Call reached terminal status', { callStatus });
  }

  res.status(200).end();
}
