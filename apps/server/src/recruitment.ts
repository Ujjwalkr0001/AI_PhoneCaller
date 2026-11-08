import { isJobRelatedQuestion, type Campaign } from '../../../packages/shared/src/index.js';

/** Use operator questions, grouped into a predictable interview order. */
export function recruitmentQuestions(campaign: Campaign) {
  const rank = (key: string, mustHave: boolean) =>
    /experience|background/i.test(key) && !mustHave ? 0
      : mustHave ? 1
        : /salary|compensation/i.test(key) ? 3
          : /location|work_mode/i.test(key) ? 4
            : /notice|joining/i.test(key) ? 5
              : /interview|availability/i.test(key) ? 6 : 2;
  const seen = new Set<string>();
  return campaign.screening_questions
    .filter((q) => {
      if (!isJobRelatedQuestion(q) || seen.has(q.field_key)) return false;
      seen.add(q.field_key);
      return true;
    })
    .map((q, index) => {
      const requirement = q.question.match(
        /^Do you meet this requirement:\s*(?:must\s+(?:be|have)\s+)?(\d+)\+?\s*years?\s+(?:of\s+experience\s+)?(?:in|with)\s+(.+?)\??$/i,
      );
      return {
        ...q,
        question: requirement
          ? `Do you have at least ${requirement[1]} years of professional experience with ${requirement[2]}?`
          : q.question,
        index,
      };
    })
    .sort((a, b) => rank(a.field_key, a.must_have) - rank(b.field_key, b.must_have) || a.index - b.index)
    .map(({ index: _index, ...q }) => q);
}

export function verbalConsent(text: string): boolean | undefined {
  if (/\b(no|not now|don.t|do not|never)\b|नहीं/i.test(text)) return false;
  if (/\b(yes|yeah|yep|sure|okay|ok|agree|please|go ahead)\b|हाँ|हां/i.test(text)) return true;
  return undefined;
}

export function screeningAnswer(text: string, expected: string) {
  if (/don.t know|not sure|prefer not|skip|rather not/i.test(text)) return 'unknown';
  const consent = verbalConsent(text);
  return /^(yes|no)$/i.test(expected.trim()) && consent !== undefined
    ? consent ? 'yes' : 'no'
    : text;
}

export function isCandidateQuestion(text: string) {
  return /\?$/.test(text) || /^(what|why|how|where|who|which|can you|could you|tell me|explain)\b/i.test(text);
}
