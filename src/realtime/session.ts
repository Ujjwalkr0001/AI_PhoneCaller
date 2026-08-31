import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { CascadedBridge } from '../cascaded/cascaded-bridge.js';
import { logger } from '../utils/logger.js';

const bridges = new Map<string, CascadedBridge>();

/** Every call runs the cascaded pipeline: Sarvam STT -> Sarvam LLM -> Sarvam TTS. */
export function attachRealtimeBridge(session: CallSession, twilioWs: WebSocket): void {
  const bridge = new CascadedBridge(session, twilioWs);
  bridges.set(session.callSid, bridge);
  bridge.start().catch((error: unknown) => {
    logger.withCallSid(session.callSid).error('Failed to start call bridge', error);
  });
}

export function getBridge(callSid: string): CascadedBridge | undefined {
  return bridges.get(callSid);
}

export function detachRealtimeBridge(callSid: string): void {
  bridges.get(callSid)?.close();
  bridges.delete(callSid);
}
