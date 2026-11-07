import type { CallResult } from '../../../../packages/shared/src/index.js';
import { requirementMatch } from '../lib/requirement-match.js';
import { ShieldCheck } from 'lucide-react';
export default function RequirementMatch({
  eligibility,
}: {
  eligibility: CallResult['eligibility'];
}) {
  const match = requirementMatch(eligibility);
  return (
    <div className="match-panel">
      <div className="match-panel-top">
        <div>
          <span className="eyebrow">JOB REQUIREMENTS</span>
          <h3>
            {match.percent === null
              ? 'More information needed'
              : match.percent === 100
                ? 'Worth a closer conversation'
                : match.percent === 0
                  ? 'Review the unmet requirements'
                  : 'A few things to explore'}
          </h3>
        </div>
        <div
          className="match-ring"
          role="img"
          aria-label={
            match.percent === null
              ? 'Not enough answers to score'
              : `${match.percent}% of stated job requirements confirmed`
          }
          style={{ '--match': `${match.percent ?? 0}%` } as React.CSSProperties}
        >
          <span>{match.percent === null ? '—' : `${match.percent}%`}</span>
        </div>
      </div>
      <p>
        {match.total
          ? `${match.matched} of ${match.total} stated requirements confirmed. ${match.unknown} unanswered or unclear.`
          : 'No explicit must-have criteria were assessed.'}
      </p>
      <div className="match-footnote">
        <ShieldCheck size={14} />
        <span>Requirements coverage, not a hiring probability. Your team makes the decision.</span>
      </div>
    </div>
  );
}
