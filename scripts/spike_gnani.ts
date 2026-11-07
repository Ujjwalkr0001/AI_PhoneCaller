import 'dotenv/config';
import { appendFile } from 'node:fs/promises';
// Real audio required; never stream silence in a loop to consume credits.
if (process.env.RUN_LIVE_GNANI !== 'true' || !process.env.GNANI_API_KEY) {
  console.log('NOT RUN: set RUN_LIVE_GNANI=true, GNANI_API_KEY and supply a synthetic PCM fixture via GNANI_SPIKE_PCM.');
} else {
  const { runSpike } = await import('./platform/spike.js');
  const report = await runSpike();
  await appendFile('docs/DECISIONS.md', `\n## Gnani spike ${new Date().toISOString()}\n\n${JSON.stringify(report, null, 2)}\n`);
  console.log(report);
}
