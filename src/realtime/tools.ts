import type { RealtimeToolDefinition } from './realtime-client.js';
import type { CallSession } from '../state/call-session.js';
import { applyQualificationUpdate, applyScheduleCallback } from '../agent/sales-agent.js';
import { logger } from '../utils/logger.js';

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
        businessType: { type: 'string', description: 'What the caller sells or their business type' },
        productCount: { type: 'number', description: 'Roughly how many products they plan to list' },
        budget: { type: 'number', description: 'Budget in INR' },
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
];

export async function dispatchToolCall(session: CallSession, name: string, argsJson: string): Promise<unknown> {
  const log = logger.withCallSid(session.callSid);
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { status: 'error', message: 'Malformed arguments' };
  }

  switch (name) {
    case 'capture_qualification':
      return applyQualificationUpdate(session, args);
    case 'schedule_callback':
      return applyScheduleCallback(session, args as { rawPhrase: string });
    default:
      log.warn('Unknown tool call', { name });
      return { status: 'error', message: `Unknown tool: ${name}` };
  }
}
