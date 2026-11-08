import { z } from 'zod';
import type { Campaign, Stage, Turn } from '../../../../packages/shared/src/index.js';
import type { DialogueClient } from '../contracts.js';
import { promptBuilder } from '../domain.js';
import { sse } from '../audio.js';
import { dialogueConfig } from '../provider-config.js';
const output = z.object({
  text: z.string().max(2000),
  tools: z
    .array(
      z.object({
        name: z.enum([
          'capture_fields',
          'set_interest_level',
          'schedule_callback',
          'mark_do_not_call',
          'mark_wrong_number',
          'request_handoff',
          'end_call',
          'advance_stage',
        ]),
        args: z.record(z.string(), z.unknown()),
      }),
    )
    .max(8)
    .default([]),
});
// OpenAI-compatible Chat Completions text endpoint; Gnani does not decide dialogue in this pipeline.
export class CompatibleDialogue implements DialogueClient {
  name = `${dialogueConfig().provider} / ${dialogueConfig().model}`;
  async reply(
    c: Campaign,
    history: Turn[],
    stage: Stage,
    fields: Record<string, unknown>,
    signal: AbortSignal,
    first: () => void,
  ) {
    const config = dialogueConfig();
    if (!config.key) throw new Error('GROQ_API_KEY or DIALOGUE_API_KEY is required');
    const response = await fetch(
      config.url,
      {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 600,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            {
              role: 'system',
              content: `${promptBuilder(c)}\nCurrent stage: ${stage}. Captured fields and tool results: ${JSON.stringify(fields)}\nSpoken facts and questions must copy approved campaign sentences verbatim. Do not paraphrase or translate unapproved factual claims. Safe conversational phrases: What questions do you have? May the team follow up with you? Thank you for your time. Goodbye. Could you please repeat that? The team will follow up. Use native-script facts supplied by the operator for other languages.\nReturn ONLY JSON: {"text":"short spoken response","tools":[{"name":"tool_name","args":{}}]}. Never embed tool calls in spoken text.`,
            },
            ...history
              .slice(-20)
              .map((t) => ({ role: t.role === 'caller' ? 'user' : 'assistant', content: t.text })),
          ],
          response_format: { type: 'json_object' },
        }),
      },
    );
    let content = '',
      tokens = 0,
      seen = false;
    for await (const { data } of sse(response)) {
      const event = data as {
        choices?: { delta?: { content?: string } }[];
        usage?: { total_tokens?: number };
      };
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        if (!seen) {
          seen = true;
          first();
        }
        content += delta;
      }
      tokens = event.usage?.total_tokens ?? tokens;
    }
    return { ...output.parse(JSON.parse(content)), tokens };
  }
}
