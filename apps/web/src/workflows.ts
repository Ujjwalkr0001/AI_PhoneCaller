import { BriefcaseBusiness, CalendarDays, Headphones, Megaphone, TrendingUp } from 'lucide-react';
export const workflows = [
  {
    id: 'sales',
    name: 'Sales',
    short: 'Turn interest into opportunity.',
    description: 'Meet your leads, understand what they need and make the next conversation count.',
    icon: TrendingUp,
    color: 'mint',
    action: 'Qualify a lead',
    detailLabel: 'What are you offering?',
    placeholder: 'Your product, who it helps, and the details your agent can share.',
    questions: [
      ['interest', 'What are you looking for?'],
      ['budget', 'What budget do you have in mind?'],
      ['timeline', 'When would you like to get started?'],
      ['next_step', 'Would you like the team to arrange a demo?'],
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    short: 'Make every campaign a conversation.',
    description: 'Introduce an offer, reconnect with your audience and capture what resonates.',
    icon: Megaphone,
    color: 'peach',
    action: 'Start a campaign',
    detailLabel: 'What is your campaign about?',
    placeholder:
      'Describe your campaign and the approved offer. Only include claims your team can support.',
    questions: [
      ['interest', 'Would you like to learn more about this offer?'],
      ['feedback', 'What do you think of the offer?'],
      ['follow_up', 'Would you like our team to follow up?'],
    ],
  },
  {
    id: 'care',
    name: 'Customer care',
    short: 'A little more care. Every time.',
    description: 'Listen to customer concerns, share approved answers and capture the next step.',
    icon: Headphones,
    color: 'sky',
    action: 'Help a customer',
    detailLabel: 'How should your agent help?',
    placeholder: 'Approved support information, answers and the issue you are following up on.',
    questions: [
      ['issue', 'What would you like help with?'],
      ['details', 'Could you share a little more about the issue?'],
      ['resolution', 'Did that answer your question?'],
      ['callback', 'Would you like a team member to call you back?'],
    ],
  },
  {
    id: 'hr',
    name: 'HR & recruitment',
    short: 'Find the people behind the CVs.',
    description:
      'Screen for job requirements, ask the right questions and bring the answers together.',
    icon: BriefcaseBusiness,
    color: 'lilac',
    action: 'Screen a candidate',
    detailLabel: 'Tell us about the role',
    placeholder: 'Responsibilities and approved information about the role.',
    questions: [
      ['notice_period', 'What is your notice period?'],
      ['expected_salary', 'What are your salary expectations for this role?'],
      ['current_location', 'Which city would you work from?'],
      ['interview_availability', 'When are you available for an interview?'],
      ['relevant_experience', 'What relevant experience would you like to share?'],
    ],
  },
  {
    id: 'appointments',
    name: 'Appointments & bookings',
    short: 'Make room for the next step.',
    description:
      'Collect preferred dates, confirm interest and pass booking requests to your team.',
    icon: CalendarDays,
    color: 'sand',
    action: 'Arrange an appointment',
    detailLabel: 'What would you like to arrange?',
    placeholder: 'The appointment type, available options and any details the caller should know.',
    questions: [
      ['appointment_type', 'What would you like to book?'],
      ['preferred_date', 'Which date and time would you prefer?'],
      ['preferences', 'Do you have any preferences we should pass to the team?'],
      ['confirmation', 'May our team contact you to confirm the booking?'],
    ],
  },
] as const;
export type WorkflowId = (typeof workflows)[number]['id'];
export function getWorkflow(id?: string) {
  return workflows.find((w) => w.id === id) ?? workflows[0];
}
export function workflowLabel(campaign: { type: string; name: string }) {
  if (campaign.type === 'hr') return 'HR & recruitment';
  return workflows.find((w) => campaign.name.startsWith(w.name + ' · '))?.name ?? 'Sales';
}
