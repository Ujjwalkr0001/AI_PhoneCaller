import { Receiver } from '@upstash/qstash';
import { placeOutboundCall } from '../../src/services/twilio.js';
import { createSession } from '../../src/state/call-session.js';
import { logger } from '../../src/utils/logger.js';

// Uses the Web Fetch API handler style (not the classic VercelRequest/
// VercelResponse pair used elsewhere) specifically to get the raw request
// body via request.text() — QStash's signature verification needs the
// exact bytes that were signed, not a re-serialized parsed object.
export default {
  async fetch(request: Request): Promise<Response> {
    const raw = await request.text();
    const signature = request.headers.get('upstash-signature') ?? '';

    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? '',
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? '',
    });

    try {
      const valid = await receiver.verify({ body: raw, signature });
      if (!valid) throw new Error('signature reported invalid');
    } catch (error) {
      logger.warn('Rejected /api/callback/fire request with invalid QStash signature', error);
      return new Response('Invalid signature', { status: 401 });
    }

    let payload: { phone?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response('Malformed body', { status: 400 });
    }

    if (!payload.phone) {
      return new Response('Missing phone', { status: 400 });
    }

    const baseUrl = process.env.PUBLIC_BASE_URL;
    if (!baseUrl) {
      logger.error('Cannot fire callback: PUBLIC_BASE_URL not configured');
      return new Response('Server misconfigured', { status: 500 });
    }

    try {
      const call = await placeOutboundCall({
        to: payload.phone,
        voiceWebhookUrl: `${baseUrl}/api/twilio/voice`,
        statusCallbackUrl: `${baseUrl}/api/twilio/status`,
      });
      createSession(call.sid, payload.phone);
      logger.withCallSid(call.sid).info('Scheduled callback call placed', { phone: payload.phone });
    } catch (error) {
      logger.error('Failed to place scheduled callback call', error);
      return new Response('Failed to place call', { status: 500 });
    }

    return new Response('OK', { status: 200 });
  },
};
