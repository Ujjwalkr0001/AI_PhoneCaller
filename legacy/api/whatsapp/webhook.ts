import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../../src/utils/logger.js';

interface WhatsAppMessage {
  from?: string;
  type?: string;
  text?: { body?: string };
}

interface WhatsAppStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WhatsAppChangeValue {
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

// Meta's Cloud API webhook: a GET verification handshake (run once, when you
// register the callback URL in the App Dashboard), then POSTs for every
// inbound event afterwards. We don't act on inbound messages yet — just log,
// same as the old Twilio inbound handler did for sandbox join messages.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && expected && token === expected) {
      logger.info('WhatsApp webhook verified by Meta');
      res.status(200).send(String(challenge ?? ''));
      return;
    }

    logger.warn('WhatsApp webhook verification failed', { mode, token });
    res.status(403).send('Verification failed');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const entries = req.body?.entry;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value: WhatsAppChangeValue = change?.value ?? {};
        for (const message of value.messages ?? []) {
          logger.info('Inbound WhatsApp message', {
            from: message.from,
            type: message.type,
            body: message.text?.body,
          });
        }
        for (const status of value.statuses ?? []) {
          logger.info('WhatsApp delivery status', {
            id: status.id,
            status: status.status,
            recipient: status.recipient_id,
            errors: status.errors,
          });
        }
      }
    }
  }

  // Meta expects a fast 200 regardless of what the payload contained.
  res.status(200).end();
}
