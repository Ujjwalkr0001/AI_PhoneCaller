import 'dotenv/config';
import { Store, demoOrg } from '../../apps/server/src/db/store.js';
import { Platform, type CampaignData } from '../../apps/server/src/platform.js';
import { defaultCampaign } from '../../packages/shared/src/index.js';
import { seedAdmin } from '../../apps/server/src/security.js';
if (process.env.MOCK_MODE !== 'true') throw new Error('Seed requires MOCK_MODE=true; it runs explicitly simulated calls only');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const store = new Store(process.env.DATABASE_URL), platform = new Platform(store);
try {
  await seedAdmin(store); await platform.start();
  if (!(await store.list('settings', demoOrg)).length) await store.put('settings', demoOrg, { retention_days: 30, kill_switch: false, global_daily_minutes: 200, rates: {} });
  for (const type of ['hr', 'sales'] as const) {
    if ((await store.list<CampaignData>('campaigns', demoOrg)).some(r => r.data.sample && r.data.type === type)) continue;
    const c = defaultCampaign(type);
    c.name = type === 'hr' ? 'Engineering, meet opportunity' : 'A better day for small teams'; c.company_name = 'Orbit Studio (sample)';
    c.company_about = 'A fictional company used for synthetic demonstrations. No real candidate or customer data.';
    c.sample = true; c.languages = ['en-IN', 'hi-IN']; c.voice['hi-IN'] = 'Shivani'; c.job_title = 'Frontend engineer'; c.job_listing_ref = 'SAMPLE-ENG-01';
    c.role_summary = 'Build accessible web experiences with TypeScript and React. This is a fictional job listing.';
    c.product_name = 'Orbit Workspace'; c.product_description = 'A fictional shared workspace for small teams.'; c.fact_sheet = type === 'hr' ? c.role_summary : c.product_description;
    c.screening_questions = [{ question: 'Have you used TypeScript for a web project?', field_key: 'typescript', required: true, must_have: true, expected_answer_hint: 'yes' }];
    c.resume_submission = { channel: 'link', value: 'https://example.com/careers', instructions: 'Sample destination only; do not upload a real resume.', deadline: '' };
    const saved = await store.put('campaigns', demoOrg, { ...c, status: 'draft' });
    await store.put('contacts', demoOrg, { campaign_id: saved.id, phone: type === 'hr' ? '+12025550101' : '+12025550102', first_name: 'Sample person', candidate_name: 'Synthetic candidate', current_role: 'Sample role', source: 'Synthetic fixture', sample: true, attempts: 0, status: 'ready' });
    // Measure a genuine run of mocks; never seed invented latency or duration figures.
    const { pipeline } = await platform.browserCall(demoOrg, saved.id, { audio() {}, clear() {}, async mark() {}, async end() {} });
    await pipeline.start();
    for (const text of ['Yes', 'yes', 'Please continue', 'No questions', 'Yes, I agree to follow-up']) await pipeline.turn({ text, finalAt: Date.now(), endOfSpeechAt: Date.now(), language: 'en-IN' });
    await pipeline.finish();
  }
  console.log('Sample campaigns and synthetic simulated results created. No live provider calls made.');
} finally { await platform.close(); await store.pool.end(); }
