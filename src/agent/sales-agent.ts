import type { CallSession, Intent } from '../state/call-session.js';
import { mergeIntent, scoreLead } from './qualification.js';
import { parseCallbackPhrase } from '../utils/time-parser.js';
import { scheduleCallback } from '../services/callback.js';
import { logger } from '../utils/logger.js';

export interface CaptureQualificationArgs {
  callType?: 'sales' | 'support';
  supportIssue?: string;
  businessType?: string;
  productCount?: number;
  budget?: number;
  timeline?: string;
  features?: string[];
  objections?: string[];
  intent?: Intent;
}

/** The tool schema declares budget as a number, but models occasionally send
 * it as a numeral string (e.g. "10000000") despite that — coerce rather than
 * silently drop it, since a dropped budget means the post-call WhatsApp
 * recap goes out missing a fact the caller actually stated. */
function coerceBudget(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function applyQualificationUpdate(session: CallSession, args: CaptureQualificationArgs): { intent: Intent } {
  const log = logger.withCallSid(session.callSid);
  if (args.callType) session.callType = args.callType;
  if (args.supportIssue) session.supportIssue = args.supportIssue;

  const q = session.qualification;
  if (args.businessType) q.businessType = args.businessType;
  if (typeof args.productCount === 'number') q.productCount = args.productCount;
  if (args.budget !== undefined) {
    const budget = coerceBudget(args.budget);
    if (budget !== undefined) q.budget = budget;
    else log.warn('capture_qualification: budget present but unparseable, dropped', { budget: args.budget });
  }
  if (args.timeline) q.timeline = args.timeline;
  if (args.features?.length) q.features = Array.from(new Set([...q.features, ...args.features]));
  if (args.objections?.length) q.objections = Array.from(new Set([...q.objections, ...args.objections]));

  const computed = scoreLead(q);
  session.intent = mergeIntent(args.intent, computed);

  return { intent: session.intent };
}

export interface ScheduleCallbackArgs {
  rawPhrase: string;
}

export async function applyScheduleCallback(session: CallSession, args: ScheduleCallbackArgs): Promise<unknown> {
  const log = logger.withCallSid(session.callSid);
  const parsed = parseCallbackPhrase(args.rawPhrase, new Date());

  if (!parsed) {
    return {
      status: 'error',
      message: 'Could not resolve a specific day/time from that phrase — ask the caller for an exact day and time.',
    };
  }

  session.callback = { requested: true, rawPhrase: args.rawPhrase, confirmedAt: parsed.date.toISOString() };
  void scheduleCallback(session, parsed.date);
  log.info('Callback scheduled', { targetDate: parsed.date.toISOString() });

  return { status: 'confirmed', resolvedTimeIso: parsed.date.toISOString() };
}
