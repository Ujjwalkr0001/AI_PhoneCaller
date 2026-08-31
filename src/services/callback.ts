import type { CallSession } from '../state/call-session.js';
import { logger } from '../utils/logger.js';
import { scheduleFutureCall } from './qstash.js';
import { sendPostCallFollowUp } from './whatsapp.js';
import { saveCallTranscript } from './call-log.js';

export async function scheduleCallback(session: CallSession, targetDate: Date): Promise<void> {
  const log = logger.withCallSid(session.callSid);
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    log.error('Cannot schedule callback: PUBLIC_BASE_URL not configured');
    return;
  }

  try {
    await scheduleFutureCall({
      targetUrl: `${baseUrl}/api/callback/fire`,
      body: { phone: session.phone },
      fireAt: targetDate,
    });
    session.callback.workflowStarted = true;
    log.info('Callback scheduled via QStash', { targetDate: targetDate.toISOString() });
  } catch (error) {
    log.error('Failed to schedule callback (call continues)', error);
  }
}

export async function runPostCallFollowUp(session: CallSession): Promise<void> {
  const log = logger.withCallSid(session.callSid);
  await saveCallTranscript(session);
  try {
    await sendPostCallFollowUp(session);
  } catch (error) {
    log.error('Post-call follow-up failed', error);
  }
  // Session is deliberately kept in memory (not deleted) after this point —
  // the frontend dashboard's call history and transcript views read it via
  // /api/call/status and /api/call/list. It only goes away on process restart.
}
