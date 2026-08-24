// One-off diagnostic: exercises the real sendPostCallFollowUp() code path
// (recap text + resume + architecture image) against a fabricated session,
// instead of hitting the Graph API directly like test-whatsapp.ts does.
import 'dotenv/config';
import { config as loadEnvLocal } from 'dotenv';
loadEnvLocal({ path: '.env.local', override: true });

import type { CallSession } from '../src/state/call-session.js';
import { sendPostCallFollowUp } from '../src/services/whatsapp.js';

const phone = process.argv[2] ?? '+917548999341';

const session: CallSession = {
  callSid: 'CA-diagnostic',
  phone,
  language: 'en',
  status: 'completed',
  qualification: {
    businessType: 'handmade jewelry',
    productCount: 40,
    budget: 45000,
    timeline: 'within the next 2 weeks',
    features: ['payment gateway', 'WhatsApp integration'],
    objections: ['needs to check with her business partner'],
  },
  intent: 'hot',
  callback: { requested: false },
  transcript: [],
  whatsappFollowUpSent: false,
  callStartedAt: new Date().toISOString(),
};

sendPostCallFollowUp(session).then(() => {
  console.log('Done. whatsappFollowUpSent =', session.whatsappFollowUpSent);
});
