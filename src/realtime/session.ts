import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { AudioBridge } from './audio-bridge.js';
import { logger } from '../utils/logger.js';

const bridges = new Map<string, AudioBridge>();

export function attachRealtimeBridge(session: CallSession, twilioWs: WebSocket): void {
  const bridge = new AudioBridge(session, twilioWs);
  bridges.set(session.callSid, bridge);
  bridge.start().catch((error) => {
    logger.withCallSid(session.callSid).error('Failed to start realtime bridge', error);
  });
}

export function getBridge(callSid: string): AudioBridge | undefined {
  return bridges.get(callSid);
}

export function detachRealtimeBridge(callSid: string): void {
  bridges.get(callSid)?.close();
  bridges.delete(callSid);
}
