import { expect, it } from 'vitest';
import { defaultCampaign, questionSchema } from '../../packages/shared/src/index.js';
import { mustHaveAnswer, recruitmentQaCompletion, recruitmentQuestions, requirementRejection, screeningAnswer } from '../../apps/server/src/recruitment.js';

it('orders role questions, preserves field keys, and omits unrelated personal questions', () => {
  const c = defaultCampaign('hr');
  const q = (field_key: string, question: string, must_have = false) => ({
    field_key, question, must_have, required: must_have, expected_answer_hint: must_have ? 'yes' : '',
  });
  c.screening_questions = [
    q('interview_availability', 'When can you interview?'),
    q('expected_salary', 'What are your salary expectations?'),
    q('requirement_1', 'Do you meet this requirement: must be 2+ years in React?', true),
    q('relevant_experience', 'Describe your relevant experience.'),
    q('personal', 'What are your genital measurements?'),
    q('notice_period', 'What is your notice period?'),
  ];
  const plan = recruitmentQuestions(c);
  expect(plan.map((x) => x.field_key)).toEqual([
    'requirement_1', 'relevant_experience', 'expected_salary', 'notice_period', 'interview_availability',
  ]);
  expect(plan[0].question).toBe('Do you have at least 2 years of professional experience with React?');
  expect(questionSchema.safeParse(c.screening_questions[4]).success).toBe(false);
  expect(screeningAnswer('Yes, I have used it professionally.', 'yes')).toBe('yes');
  expect(screeningAnswer('I prefer not to answer.', '')).toBe('unknown');
});

it('recognizes Q&A completion without confusing actual role questions', () => {
  for (const text of ['No question.', 'No questions.', "I don't have any questions", 'No more questions, thank you.',
    'No questions from my side.', 'Okay, thank you for asking.', 'Yes, thanks.', 'Got it.'])
    expect(recruitmentQaCompletion(text), text).toBe('close');
  for (const text of ['We can cut the call', 'Can we end the call?', 'Please hang up.'])
    expect(recruitmentQaCompletion(text), text).toBe('finish');
  for (const text of ['How many hours do we have to work?', 'No, what is the work location?',
    'Okay, but what is the salary?', 'Can we cut deployment time?', 'Yes'])
    expect(recruitmentQaCompletion(text), text).toBeUndefined();
});

it('understands the actual saved experience requirement and declines only definite mismatches', () => {
  const c = defaultCampaign('hr');
  c.screening_questions = [{question: 'Do you meet this requirement: Must have 3+years of expereince in api?',
    field_key: 'requirement_1', required: true, must_have: true, expected_answer_hint: 'yes'}];
  const q = recruitmentQuestions(c)[0];
  expect(q.question).toBe('Do you have at least 3 years of professional experience with api?');
  expect(mustHaveAnswer(q, 'I have two years of experience.')).toBe('no');
  expect(mustHaveAnswer(q, 'I have three years of experience.')).toBe('yes');
  expect(mustHaveAnswer(q, 'I have 48 months of experience.')).toBe('yes');
  expect(mustHaveAnswer(q, 'I am a backend developer.')).toBeUndefined();
  expect(mustHaveAnswer(q, 'I have around 3 years.')).toBeUndefined();
  expect(mustHaveAnswer(q, 'I have 2 years with API and 5 years overall.')).toBeUndefined();
  expect(mustHaveAnswer(q, "I don't know.")).toBe('unknown');
  expect(requirementRejection(q)).toContain('at least 3 years of professional experience with api');
});
