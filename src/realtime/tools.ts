import type { CallSession } from '../state/call-session.js';
import { applyQualificationUpdate, applyScheduleCallback } from '../agent/sales-agent.js';
import { hangupCall } from '../services/twilio.js';
import { logger } from '../utils/logger.js';

export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: RealtimeToolDefinition[] = [
  {
    type: 'function',
    name: 'capture_qualification',
    description:
      "Record or update structured details learned about the caller's business, needs, and your own " +
      'assessment of buying intent. Call this whenever you learn something new — partial updates are fine.',
    parameters: {
      type: 'object',
      properties: {
        callType: {
          type: 'string',
          enum: ['sales', 'support'],
          description:
            'Set once, right after Step 0 intent routing decides whether this is a new sales lead or an ' +
            'existing customer/support call. Determines which post-call WhatsApp follow-up gets sent.',
        },
        supportIssue: {
          type: 'string',
          description: "Support calls only: a brief description of the caller's issue, in their own words.",
        },
        businessType: { type: 'string', description: 'What the caller sells or their business type' },
        productCount: { type: 'number', description: 'Roughly how many products they plan to list' },
        budget: {
          type: 'number',
          description:
            'Budget in INR, as a plain number — convert any lakh/crore figure to the full amount before ' +
            "calling (e.g. \"10 crore\" -> 100000000, \"5 lakh\" -> 500000). Never pass a string.",
        },
        timeline: { type: 'string', description: "The caller's own description of their timeline" },
        features: { type: 'array', items: { type: 'string' }, description: 'Specific features requested' },
        objections: { type: 'array', items: { type: 'string' }, description: 'Concerns or barriers raised' },
        intent: {
          type: 'string',
          enum: ['hot', 'warm', 'cold'],
          description: 'Your assessment of buying intent right now',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'schedule_callback',
    description: 'Call this once the caller has verbally confirmed a specific callback day/time.',
    parameters: {
      type: 'object',
      properties: {
        rawPhrase: { type: 'string', description: "The caller's own words describing when to call back" },
      },
      required: ['rawPhrase'],
    },
  },
  {
    type: 'function',
    name: 'end_call',
    description:
      'Call this immediately after you have said your closing goodbye and the conversation is genuinely ' +
      'finished, to hang up the call. Do not call it mid-conversation.',
    parameters: { type: 'object', properties: {} },
  },
];

export async function dispatchToolCall(session: CallSession, name: string, argsJson: string): Promise<unknown> {
  const log = logger.withCallSid(session.callSid);
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { status: 'error', message: 'Malformed arguments' };
  }

  log.info('Tool call args', { name, args });

  switch (name) {
    case 'capture_qualification':
      return applyQualificationUpdate(session, args);
    case 'schedule_callback':
      return applyScheduleCallback(session, args as { rawPhrase: string });
    case 'end_call': {
      // Delayed, not immediate: the model's closing line is still streaming
      // out through TTS/Twilio when this tool call resolves, so hanging up
      // right away risks cutting its own goodbye off mid-word. Give the
      // audio time to actually finish playing before tearing down the call.
      // Fire-and-forget beyond that: don't let a hangup failure surface as a
      // spoken error.
      const delayMs = Number(process.env.END_CALL_HANGUP_DELAY_MS ?? 3000);
      setTimeout(() => {
        hangupCall(session.callSid).catch((error) => log.error('Failed to hang up call', error));
      }, delayMs);
      return { status: 'ok' };
    }
    default:
      log.warn('Unknown tool call', { name });
      return { status: 'error', message: `Unknown tool: ${name}` };
  }
}
