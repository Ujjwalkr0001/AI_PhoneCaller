import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseTwilioEvent } from '../src/realtime/twilio-media-events.js';
import { getSession } from '../src/state/call-session.js';
import { logger } from '../src/utils/logger.js';
import { attachRealtimeBridge, detachRealtimeBridge, getBridge } from '../src/realtime/session.js';

// Vercel cold-starts this function on the first call after idle, which is
// where several seconds of the "silence at call start" comes from — an
// external uptime pinger hitting this plain-HTTP path every few minutes
// keeps a warm instance around so Twilio's WS upgrade never has to wait
// through a cold start.
const server = http.createServer((_req, res) => {
  res.writeHead(200).end('ok');
});
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  let callSid: string | undefined;
  let mediaCount = 0;

  ws.on('message', (data) => {
    const evt = parseTwilioEvent(data.toString());
    if (!evt) return;

    switch (evt.event) {
      case 'connected':
        logger.info('Twilio media stream connected');
        break;

      case 'start': {
        callSid = evt.start.callSid;
        const session = getSession(callSid);
        const log = logger.withCallSid(callSid);
        if (!session) {
          log.warn('No CallSession found for incoming stream start; closing socket');
          ws.close();
          return;
        }
        session.streamSid = evt.streamSid;
        session.status = 'in-progress';
        log.info('Stream started', { mediaFormat: evt.start.mediaFormat });
        attachRealtimeBridge(session, ws);
        break;
      }

      case 'media':
        mediaCount += 1;
        if (mediaCount % 50 === 0) {
          logger.withCallSid(callSid ?? 'unknown').debug('Media frames received', { count: mediaCount });
        }
        if (callSid) getBridge(callSid)?.handleTwilioMedia(evt);
        break;

      case 'stop':
        logger.withCallSid(callSid ?? 'unknown').info('Stream stopped');
        if (callSid) detachRealtimeBridge(callSid);
        break;

      case 'mark':
        if (callSid) getBridge(callSid)?.handleTwilioMark(evt);
        break;
    }
  });

  ws.on('close', () => {
    logger.withCallSid(callSid ?? 'unknown').info('Media stream socket closed');
    if (callSid) detachRealtimeBridge(callSid);
  });

  ws.on('error', (error) => {
    logger.withCallSid(callSid ?? 'unknown').error('Media stream socket error', error);
  });
});

export default server;
