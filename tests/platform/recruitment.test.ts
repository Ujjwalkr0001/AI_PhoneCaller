import { expect, it } from 'vitest';
import { defaultCampaign, questionSchema } from '../../packages/shared/src/index.js';
import { recruitmentQuestions, screeningAnswer } from '../../apps/server/src/recruitment.js';

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
    'relevant_experience', 'requirement_1', 'expected_salary', 'notice_period', 'interview_availability',
  ]);
  expect(plan[1].question).toBe('Do you have at least 2 years of professional experience with React?');
  expect(questionSchema.safeParse(c.screening_questions[4]).success).toBe(false);
  expect(screeningAnswer('Yes, I have used it professionally.', 'yes')).toBe('yes');
  expect(screeningAnswer('I prefer not to answer.', '')).toBe('unknown');
});
