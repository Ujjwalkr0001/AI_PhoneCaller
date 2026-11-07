import { describe, it, expect } from 'vitest';
import { requirementMatch } from '../../apps/web/src/lib/requirement-match.js';
describe('requirements coverage', () => {
  it('uses only explicit server-assessed job criteria and keeps unknowns visible', () => {
    expect(
      requirementMatch({
        value: 'UNCLEAR',
        reasons: [
          'react: matches explicit criterion',
          "location: does not exactly match the operator's expected answer",
          'notice: missing answer or explicit expected answer',
        ],
      }),
    ).toEqual({ matched: 1, unmet: 1, unknown: 1, total: 3, percent: 33 });
  });
  it('does not invent a percentage when no requirements were assessed', () => {
    expect(requirementMatch().percent).toBeNull();
    expect(
      requirementMatch({
        value: 'UNCLEAR',
        reasons: ['experience: missing answer or explicit expected answer'],
      }).percent,
    ).toBeNull();
  });
  it('reports full coverage only when every explicit requirement matches', () => {
    expect(
      requirementMatch({
        value: 'MEETS_ALL_MUST_HAVES',
        reasons: ['skill: matches explicit criterion', 'availability: matches explicit criterion'],
      }).percent,
    ).toBe(100);
    expect(
      requirementMatch({
        value: 'DOES_NOT_MEET',
        reasons: ["skill: does not exactly match the operator's expected answer"],
      }).percent,
    ).toBe(0);
  });
});
