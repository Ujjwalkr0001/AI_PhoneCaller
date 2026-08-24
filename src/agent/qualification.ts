import type { Qualification, Intent } from '../state/call-session.js';

const URGENT_TIMELINE_RE =
  /\b(asap|today|tomorrow|this week|right away|immediately|(?:\d+|a|one|two|three|four)\s*(day|week)s?)\b/i;
const BUDGET_OBJECTION = /\b(budget|expensive|costly|cheaper|too much|can't afford)\b/i;
const DEFERRED_DECISION = /\b(discuss|talk to|check with|partner|brother|sister|wife|husband|team|boss|family)\b/i;

/**
 * Deterministic fallback scorer, used before the model has asserted an
 * intent via the capture_qualification tool, and as a sanity baseline.
 * The model's own asserted intent (see mergeIntent) takes priority once set,
 * since it has the full conversational nuance a field-based heuristic can't see.
 */
export function scoreLead(q: Qualification): Intent {
  const hasBudget = typeof q.budget === 'number' && q.budget > 0;
  const hasTimeline = Boolean(q.timeline);
  const isUrgent = hasTimeline && URGENT_TIMELINE_RE.test(q.timeline!);
  const hasBudgetObjection = q.objections.some((o) => BUDGET_OBJECTION.test(o));
  const hasDeferredDecision = q.objections.some((o) => DEFERRED_DECISION.test(o));

  if (hasBudget && hasTimeline && isUrgent && !hasDeferredDecision) {
    return 'hot';
  }
  if (hasBudget || hasTimeline || hasDeferredDecision || hasBudgetObjection || q.features.length > 0) {
    return 'warm';
  }
  if (q.businessType) {
    return 'cold';
  }
  return 'unknown';
}

export function mergeIntent(modelAsserted: Intent | undefined, computed: Intent): Intent {
  if (modelAsserted && modelAsserted !== 'unknown') return modelAsserted;
  return computed;
}
