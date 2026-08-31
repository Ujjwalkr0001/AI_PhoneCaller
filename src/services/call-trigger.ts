import { placeOutboundCall } from './twilio.js';
import { createSession } from '../state/call-session.js';
import { logger } from '../utils/logger.js';

export const E164_PATTERN = /^\+\d{8,15}$/;

export interface TriggerCallResult {
  callSid: string;
  status: string;
}

export async function triggerCall(to: string): Promise<TriggerCallResult> {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error('PUBLIC_BASE_URL is not configured');
  }

  const call = await placeOutboundCall({
    to,
    voiceWebhookUrl: `${baseUrl}/api/twilio/voice`,
    statusCallbackUrl: `${baseUrl}/api/twilio/status`,
  });

  createSession(call.sid, to);
  logger.withCallSid(call.sid).info('Outbound call placed', { to, status: call.status });

  return { callSid: call.sid, status: call.status };
}
