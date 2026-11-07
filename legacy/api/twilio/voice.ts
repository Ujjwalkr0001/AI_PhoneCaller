import type { VercelRequest, VercelResponse } from '@vercel/node';
import twilio from 'twilio';
import { logger } from '../../src/utils/logger.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const callSid = typeof req.body?.CallSid === 'string' ? req.body.CallSid : undefined;
  const baseUrl = process.env.PUBLIC_BASE_URL;

  if (!baseUrl) {
    logger.error('PUBLIC_BASE_URL is not configured; cannot build media stream URL');
    res.status(500).send('Server misconfigured');
    return;
  }

  const streamUrl = `${baseUrl.replace(/^http/, 'ws')}/api/media-stream`;

  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: streamUrl });

  logger.withCallSid(callSid ?? 'unknown').info('Serving voice TwiML', { streamUrl });

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}
