import { describe, expect, it } from 'vitest';
import { scoreLead, mergeIntent } from '../src/agent/qualification.js';
import type { Qualification } from '../src/state/call-session.js';

function q(overrides: Partial<Qualification>): Qualification {
  return { features: [], objections: [], ...overrides };
}

describe('scoreLead', () => {
  it('classifies strong budget + urgent timeline as hot', () => {
    expect(scoreLead(q({ budget: 200000, timeline: 'within three weeks' }))).toBe('hot');;
  });

  it('classifies interest with a deferred decision as warm', () => {
    expect(scoreLead(q({ budget: 100000, objections: ['need to discuss with my brother'] }))).toBe('warm');
  });

  it('classifies a budget objection as warm, not hot', () => {
    expect(scoreLead(q({ timeline: 'next month', objections: ['budget is a bit low right now'] }))).toBe('warm');
  });

  it('classifies bare exploratory interest as cold', () => {
    expect(scoreLead(q({ businessType: 'clothing' }))).toBe('cold');
  });

  it('classifies no signal at all as unknown', () => {
    expect(scoreLead(q({}))).toBe('unknown');
  });
});

describe('mergeIntent', () => {
  it('prefers the model-asserted intent when present', () => {
    expect(mergeIntent('hot', 'warm')).toBe('hot');
  });

  it('falls back to the computed intent when the model has not asserted one', () => {
    expect(mergeIntent(undefined, 'cold')).toBe('cold');
    expect(mergeIntent('unknown', 'warm')).toBe('warm');
  });
});
