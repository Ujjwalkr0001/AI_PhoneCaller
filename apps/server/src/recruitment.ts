import { isJobRelatedQuestion, type Campaign } from '../../../packages/shared/src/index.js';
type Question = Campaign['screening_questions'][number];

function experienceRequirement(question: string) {
  const match = question.match(/\b(?:(more than|over|at least|minimum(?: of)?)\s+)?(\d+(?:\.\d+)?)\s*(\+)?\s*(years?|yrs?|months?)\b/i);
  if (!match) return undefined;
  const subject = question.slice(match.index! + match[0].length)
    .replace(/^\s*(?:of\s+)?(?:professional\s+)?(?:experience|expereince|exprience|experienced)?\s*(?:in|with|using)?\s*/i, '')
    .replace(/[?.]+$/, '').trim();
  return { amount: Number(match[2]), unit: /month/i.test(match[4]) ? 'months' : 'years',
    exclusive: /more than|over/i.test(match[1] ?? ''), subject };
}

function experienceDescription(question: string) {
  const r = experienceRequirement(question);
  return r && `${r.exclusive ? 'more than' : 'at least'} ${r.amount} ${r.unit} of professional experience${r.subject ? ` with ${r.subject}` : ''}`;
}

/** Use operator questions, grouped into a predictable interview order. */
export function recruitmentQuestions(campaign: Campaign) {
  const rank = (key: string, mustHave: boolean) =>
    mustHave ? 0
      : /experience|background/i.test(key) ? 1
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
      const raw = q.question.match(/^Do you meet this requirement:\s*(.+?)\??$/i)?.[1];
      const experience = raw && experienceDescription(raw);
      const skill = raw?.replace(/^(?:must\s+)?have\s+/i, '').replace(/\s+experience$/i, '').trim();
      return {
        ...q,
        question: experience ? `Do you have ${experience}?`
          : skill && /^[\w .+#/-]{1,60}$/.test(skill) && !/degree|certificat|licen[cs]e|willing|available|must|years?|months?/i.test(skill)
            ? `Do you have professional experience with ${skill}?` : q.question,
        index,
      };
    })
    .sort((a, b) => rank(a.field_key, a.must_have) - rank(b.field_key, b.must_have) || a.index - b.index)
    .map(({ index: _index, ...q }) => q);
}

/** Only definite answers can pass or fail a requirement; unrelated speech needs clarification. */
export function mustHaveAnswer(question: Question, text: string): string | undefined {
  if (/don.t know|not sure|prefer not|skip|rather not|^unknown$/i.test(text)) return 'unknown';
  const expected = question.expected_answer_hint.trim().toLowerCase();
  if (expected === 'yes') {
    const requirement = experienceRequirement(question.question);
    const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
    const numeric = text.toLowerCase().replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/g,
      (word) => String(words[word]));
    const durations = [...numeric.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?(years?|yrs?|months?)\b/g)];
    if (requirement && durations.length) {
      if (durations.length !== 1 || /about|around|almost|nearly|less than|under|more than|over|at least/i.test(numeric)) return undefined;
      const duration = durations[0];
      const actualYears = Number(duration[1]) / (/month/.test(duration[2]) ? 12 : 1);
      const requiredYears = requirement.amount / (requirement.unit === 'months' ? 12 : 1);
      return (requirement.exclusive ? actualYears > requiredYears : actualYears >= requiredYears) ? 'yes' : 'no';
    }
  }
  const consent = verbalConsent(text);
  if (/^(yes|no)$/.test(expected) && consent !== undefined) return consent ? 'yes' : 'no';
  if (/\b(?:don.t have|do not have|haven.t|have not|never used|no experience|not familiar|not experienced|cannot|can.t)\b/i.test(text)) return 'no';
  if (expected && text.trim().replace(/[.!]+$/, '').toLowerCase() === expected) return expected;
  return undefined;
}

export function requirementRejection(question: Question) {
  const experience = experienceDescription(question.question);
  const skill = question.question.match(/^Do you have professional experience with (.+?)\?$/)?.[1];
  const reason = experience || (skill ? `professional experience with ${skill}` : 'someone who meets this must-have requirement');
  return `I'm really sorry, but this role requires ${reason}. Thank you for your time. Goodbye.`;
}

export function verbalConsent(text: string): boolean | undefined {
  if (/\b(no|not now|don.t|do not|never)\b|नहीं/i.test(text)) return false;
  if (/\b(yes|yeah|yep|sure|okay|ok|agree|please|go ahead|haan|han|bilkul)\b|हाँ|हां/i.test(text)) return true;
  return undefined;
}

export function screeningAnswer(text: string, expected: string) {
  if (/don.t know|not sure|prefer not|skip|rather not/i.test(text)) return 'unknown';
  const consent = verbalConsent(text);
  return /^(yes|no)$/i.test(expected.trim()) && consent !== undefined
    ? consent ? 'yes' : 'no'
    : text;
}

export function screeningAnswerNeedsClarification(field: string, text: string) {
  if (screeningAnswer(text, '') === 'unknown') return false;
  if (/\b(?:and|or|but|from|at|with|for|to|of|a|an|the)[.!?\s]*$/i.test(text)) return true;
  // These lightweight checks describe English answers; preserve other scripts.
  if (/[^\p{Script=Latin}\p{Script=Common}]/u.test(text)) return false;
  if (/salary|compensation/i.test(field))
    return !/\d|salary|pay|rupee|dollar|lakh|lac\b|crore|thousand|hundred|negotiable|flexible|market|as per|discuss|prefer not|unknown|\b(?:ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i.test(text);
  if (/notice|joining/i.test(field))
    return !/\d|days?|weeks?|months?|years?|immediate|right away|any ?time|available|unemployed|no notice|not applicable|unknown|tomorrow|today/i.test(text);
  return false;
}

export function isCandidateQuestion(text: string) {
  return /\?$/.test(text)
    || /^(?:what|why|how|where|when|who|which)\s+(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|much|many|long|often)\b/i.test(text)
    || /^(?:what|which)\s+(?:salary|role|hours|benefits|location|skills|experience)\b/i.test(text)
    || /^(?:can|could|would) you\b|^(?:tell me|explain)\b/i.test(text);
}

/** Recognize conversational ways of finishing Q&A without swallowing a real question. */
export function recruitmentQaCompletion(text: string): 'close' | 'finish' | undefined {
  const normalized = text.toLowerCase().replace(/[’]/g, "'")
    .replace(/[,.!?;:]/g, ' ').replace(/\b(?:sir|madam|ma'am)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (/\b(?:(?:we|you) can|let's|please|can (?:we|you)|i (?:want|need|would like) to)\s+(?:end|cut|disconnect|stop)(?:\s+(?:the|this))?\s+call\b/.test(normalized)
    || /^(?:please )?(?:end|cut|disconnect|stop) (?:the |this )?call(?: now)?$|^(?:please )?hang up(?: now)?$/.test(normalized)) return 'finish';
  const completion = /^(?:no(?: more| other| further)?(?: questions?| doubts?)?|none|nothing(?: else)?|that's all|that is all|that's it|that answers my question|all clear|i (?:have no|don't have(?: any)?|do not have(?: any)?) (?:more |other |further )?(?:questions?|doubts?))(?: for now| at the moment| from my side)?(?: thanks| thank you)?$/;
  const acknowledgement = /^(?:(?:okay|ok|alright|understood|got it|sounds good|thik|theek|ठीक|है)(?: )?)+(?:yes|thank you(?: for (?:asking|explaining|the information|your time))?|thanks)?$|^(?:thank you(?: for (?:asking|explaining|the information|your time))?|thanks|shukriya|शुक्रिया|धन्यवाद)$|^yes (?:thanks|thank you)$/;
  if (completion.test(normalized.replace(/^no (?=no\b|i\b)/, '')) || (normalized && acknowledgement.test(normalized))) return 'close';
  return undefined;
}
