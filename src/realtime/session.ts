import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { AudioBridge } from './audio-bridge.js';
import { CascadedBridge } from '../cascaded/cascaded-bridge.js';
import { logger } from '../utils/logger.js';

type Bridge = AudioBridge | CascadedBridge;

const bridges = new Map<string, Bridge>();

/** VOICE_PIPELINE=cascaded uses Soniox (STT) + Cartesia (TTS) instead of the
 * single OpenAI Realtime session — set for comparing the two without code
 * changes; defaults to the original Realtime pipeline. */
export function attachRealtimeBridge(session: CallSession, twilioWs: WebSocket): void {
  const bridge: Bridge =
    process.env.VOICE_PIPELINE === 'cascaded'
      ? new CascadedBridge(session, twilioWs)
      : new AudioBridge(session, twilioWs);
  bridges.set(session.callSid, bridge);
  bridge.start().catch((error) => {
    logger.withCallSid(session.callSid).error('Failed to start realtime bridge', error);
  });
}

export function getBridge(callSid: string): Bridge | undefined {
  return bridges.get(callSid);
}

export function detachRealtimeBridge(callSid: string): void {
  bridges.get(callSid)?.close();
  bridges.delete(callSid);
}
