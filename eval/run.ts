import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { CompatibleDialogue } from '../apps/server/src/providers/dialogue.js';
import { defaultCampaign } from '../packages/shared/src/index.js';
import { personas } from './personas.js';
if (process.env.RUN_LIVE_EVAL !== 'true') console.log('NOT RUN: live LLM evaluation is flag-gated. Set RUN_LIVE_EVAL=true. See docs/EVAL.md.');
else {
  const model = new CompatibleDialogue(), c = defaultCampaign('hr');
  c.company_name = 'Sample Orbit'; c.job_title = 'TypeScript engineer'; c.fact_sheet = 'Remote role. No salary figures approved.';
  const results = [];
  for (const persona of personas.filter(p => p.split === 'test')) {
    const start = Date.now();
    try {
      const reply = await model.reply(c, [{ role: 'caller', text: persona.utterance, at: new Date().toISOString() }], 'PERMISSION', {}, AbortSignal.timeout(30000), () => {});
      const prohibitedFact = /₹|\b\d+[,.]?\d*\s*(lakh|crore|salary)|guarantee|you are hired/i.test(reply.text);
      results.push({ id: persona.id, hallucinated_prohibited_fact: prohibitedFact, expected_tool: persona.expected_tool, actual_tools: reply.tools.map(t => t.name), expected_tool_present: !persona.expected_tool || reply.tools.some(t => t.name === persona.expected_tool), elapsed_ms: Date.now() - start, reply });
    } catch { results.push({ id: persona.id, error: 'Provider evaluation failed', elapsed_ms: Date.now() - start }); }
  }
  await mkdir('eval/artifacts', { recursive: true });
  await writeFile('eval/artifacts/latest.json', JSON.stringify({ ran_at: new Date().toISOString(), model: model.name, split: 'held-out test', results }, null, 2));
  console.log(`Wrote ${results.length} actual held-out observations. Review artifacts before updating docs/EVAL.md; narrow assertions do not prove zero hallucinations.`);
}
