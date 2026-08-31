import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { appendTranscript } from '../state/call-session.js';
import { RealtimeClient } from './realtime-client.js';
import { TOOL_DEFINITIONS, dispatchToolCall } from './tools.js';
import { buildSalesInstructions } from '../agent/prompt.js';
import {
  outboundMediaMessage,
  outboundClearMessage,
  outboundMarkMessage,
  type TwilioMediaEvent,
  type TwilioMarkEvent,
} from './twilio-media-events.js';
import { logger } from '../utils/logger.js';

/** Both event names are handled defensively — see realtime-client.ts for why. */
const AUDIO_DELTA_EVENTS = new Set(['response.output_audio.delta', 'response.audio.delta']);

export class AudioBridge {
  private realtime: RealtimeClient;
  private readonly log;

  private latestMediaTimestamp = 0;
  private lastAssistantItemId: string | undefined;
  private responseStartTimestampTwilio: number | undefined;
  private markQueue: string[] = [];
  private markCounter = 0;
  private closed = false;
  private reconnectAttempted = false;

  constructor(private readonly session: CallSession, private readonly twilioWs: WebSocket) {
    this.log = logger.withCallSid(session.callSid);
    this.realtime = this.createRealtimeClient();
  }

  private createRealtimeClient(): RealtimeClient {
    return new RealtimeClient({
      callSid: this.session.callSid,
      instructions: buildSalesInstructions(),
      tools: TOOL_DEFINITIONS,
    });
  }

  async start(): Promise<void> {
    this.wireRealtimeClient();
    await this.realtime.connect();
    // Outbound sales call: the agent should greet the caller proactively
    // rather than waiting for them to speak first.
    this.realtime.send({ type: 'response.create' });
  }

  private wireRealtimeClient(): void {
    this.realtime.onEvent((event) => this.handleRealtimeEvent(event));
    this.realtime.onClose(() => this.handleRealtimeClose());
  }

  private handleRealtimeClose(): void {
    if (this.closed) return; // expected close from our own detachRealtimeBridge/close()

    if (this.reconnectAttempted) {
      this.log.error('Realtime connection lost twice; ending the call rather than leaving dead air');
      this.twilioWs.close();
      return;
    }

    this.reconnectAttempted = true;
    this.log.warn('Realtime connection lost mid-call; attempting one reconnect');
    this.lastAssistantItemId = undefined;
    this.responseStartTimestampTwilio = undefined;
    this.markQueue = [];

    this.realtime = this.createRealtimeClient();
    this.wireRealtimeClient();
    this.realtime
      .connect()
      .then(() => this.realtime.send({ type: 'response.create' }))
      .catch((error) => {
        this.log.error('Reconnect failed; ending the call', error);
        this.twilioWs.close();
      });
  }

  handleTwilioMedia(evt: TwilioMediaEvent): void {
    if (evt.media.timestamp) this.latestMediaTimestamp = Number(evt.media.timestamp);
    this.realtime.appendInputAudio(evt.media.payload);
  }

  handleTwilioMark(_evt: TwilioMarkEvent): void {
    this.markQueue.shift();
  }

  private handleRealtimeEvent(event: any): void {
    if (AUDIO_DELTA_EVENTS.has(event.type)) {
      this.sendAudioDeltaToTwilio(event);
      return;
    }

    switch (event.type) {
      case 'response.done':
        this.lastAssistantItemId = undefined;
        this.responseStartTimestampTwilio = undefined;
        this.captureAssistantTranscript(event);
        break;
      case 'input_audio_buffer.speech_started':
        this.handleBargeIn();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.transcript === 'string' && event.transcript.trim()) {
          appendTranscript(this.session, 'caller', event.transcript.trim());
        }
        break;
      case 'response.function_call_arguments.done':
        void this.handleToolCall(event);
        break;
      case 'error':
        this.log.error('Realtime API error event', event);
        break;
      default:
        break;
    }
  }

  /** Pulls the final spoken text out of a completed response, rather than
   * stitching together incremental transcript-delta events (whose event name
   * has the same output_audio_transcript / audio_transcript ambiguity noted
   * in realtime-client.ts). */
  private captureAssistantTranscript(event: any): void {
    const outputs = event.response?.output;
    if (!Array.isArray(outputs)) return;

    for (const item of outputs) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (typeof part?.transcript === 'string' && part.transcript.trim()) {
          appendTranscript(this.session, 'agent', part.transcript.trim());
        }
      }
    }
  }

  private sendAudioDeltaToTwilio(event: any): void {
    if (!this.session.streamSid || typeof event.delta !== 'string') return;

    if (this.responseStartTimestampTwilio === undefined) {
      this.responseStartTimestampTwilio = this.latestMediaTimestamp;
    }
    if (typeof event.item_id === 'string') this.lastAssistantItemId = event.item_id;

    this.twilioWs.send(outboundMediaMessage(this.session.streamSid, event.delta));

    const markName = `mark-${this.markCounter++}`;
    this.markQueue.push(markName);
    this.twilioWs.send(outboundMarkMessage(this.session.streamSid, markName));
  }

  private handleBargeIn(): void {
    // lastAssistantItemId is only set while a response is actually in
    // flight (set on its first audio delta, cleared on response.done or a
    // prior barge-in) — that alone tells us whether there's anything to
    // truncate/cancel, without depending on catching response.created.
    if (!this.lastAssistantItemId || this.responseStartTimestampTwilio === undefined) {
      return;
    }

    const elapsedMs = Math.max(0, this.latestMediaTimestamp - this.responseStartTimestampTwilio);
    this.realtime.truncateItem(this.lastAssistantItemId, elapsedMs);
    this.realtime.cancelResponse();

    if (this.session.streamSid) this.twilioWs.send(outboundClearMessage(this.session.streamSid));

    this.markQueue = [];
    this.lastAssistantItemId = undefined;
    this.responseStartTimestampTwilio = undefined;
  }

  private async handleToolCall(event: any): Promise<void> {
    const { name, call_id: callId, arguments: argsJson } = event;
    if (typeof name !== 'string' || typeof callId !== 'string') return;

    this.log.info('Tool call received', { name });
    try {
      const output = await dispatchToolCall(this.session, name, argsJson ?? '{}');
      this.realtime.sendToolResult(callId, output);
    } catch (error) {
      this.log.error('Tool call handling failed', error);
      this.realtime.sendToolResult(callId, { status: 'error', message: 'Internal error handling tool call' });
    }
  }

  close(): void {
    this.closed = true;
    this.realtime.close();
  }
}
