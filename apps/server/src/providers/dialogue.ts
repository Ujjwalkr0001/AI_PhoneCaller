import { z } from 'zod';
import type { Campaign, Stage, Turn } from '../../../../packages/shared/src/index.js';
import type { DialogueClient } from '../contracts.js';
import { promptBuilder } from '../domain.js';
import { sse } from '../audio.js';
const output = z.object({ text: z.string().max(2000), tools: z.array(z.object({ name: z.enum(['capture_fields', 'set_interest_level', 'schedule_callback', 'mark_do_not_call', 'mark_wrong_number', 'request_handoff', 'end_call', 'advance_stage']), args: z.record(z.unknown()) })).max(8) });
// OpenAI-compatible Chat Completions text endpoint; Gnani does not decide dialogue in this pipeline.
export class CompatibleDialogue implements DialogueClient {
  name = `${process.env.DIALOGUE_PROVIDER ?? 'sarvam'} / ${process.env.DIALOGUE_MODEL ?? 'sarvam-105b-conversations'}`;
  async reply(c: Campaign, history: Turn[], stage: Stage, fields: Record<string, unknown>, signal: AbortSignal, first: () => void) {
    const key = process.env.DIALOGUE_API_KEY ?? process.env.SARVAM_API_KEY;
    if (!key) throw new Error('DIALOGUE_API_KEY is required');
    const response = await fetch(process.env.DIALOGUE_URL ?? 'https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DIALOGUE_MODEL ?? 'sarvam-105b-conversations', temperature: 0.2, max_tokens: 600, stream: true, stream_options: { include_usage: true },
        messages: [{ role: 'system', content: `${promptBuilder(c)}\nCurrent stage: ${stage}. Captured fields and tool results: ${JSON.stringify(fields)}\nReturn ONLY JSON: {"text":"short spoken response","tools":[{"name":"tool_name","args":{}}]}. Never embed tool calls in spoken text.` },
          ...history.slice(-20).map(t => ({ role: t.role === 'caller' ? 'user' : 'assistant', content: t.text }))], response_format: { type: 'json_object' } }),
    });
    let content = '', tokens = 0, seen = false;
    for await (const { data } of sse(response)) {
      const event = data as { choices?: { delta?: { content?: string } }[]; usage?: { total_tokens?: number } };
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) { if (!seen) { seen = true; first(); } content += delta; }
      tokens = event.usage?.total_tokens ?? tokens;
    }
    return { ...output.parse(JSON.parse(content)), tokens };
  }
}
