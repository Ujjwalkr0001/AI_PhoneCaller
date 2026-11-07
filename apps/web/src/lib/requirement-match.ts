import type { CallResult } from '../../../../packages/shared/src/index.js';
/** Read only explicit, server-evaluated job criteria; never estimate a hiring probability. */
export function requirementMatch(eligibility?: CallResult['eligibility']) {
  const reasons = eligibility?.reasons ?? [];
  const matched = reasons.filter((r) => r.endsWith(': matches explicit criterion')).length;
  const unmet = reasons.filter((r) =>
    r.endsWith(": does not exactly match the operator's expected answer"),
  ).length;
  const unknown = reasons.length - matched - unmet;
  return {
    matched,
    unmet,
    unknown,
    total: reasons.length,
    percent: matched + unmet > 0 ? Math.round((matched / reasons.length) * 100) : null,
  };
}
