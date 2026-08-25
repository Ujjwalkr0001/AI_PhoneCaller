import type { CallSession } from '../state/call-session.js';
import { buildSalesInstructions } from '../agent/prompt.js';
import { TOOL_DEFINITIONS, dispatchToolCall } from '../realtime/tools.js';
import { logger } from '../utils/logger.js';

interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

const CHAT_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

interface StreamResult {
  toolCalls: ChatToolCall[];
  aborted: boolean;
}

/** Drives the actual conversation — Soniox and Cartesia are just ears and a
 * mouth; this is the brain, using plain OpenAI Chat Completions (not the
 * Realtime API) since it only needs text in, text out. Reuses the same
 * sales prompt and tool definitions as the Realtime pipeline. */
export class DialogueClient {
  private readonly log;
  private readonly messages: ChatMessage[];
  private abortController: AbortController | undefined;

  constructor(private readonly session: CallSession) {
    this.log = logger.withCallSid(session.callSid);
    this.messages = [{ role: 'system', content: buildSalesInstructions() }];
  }

  /** Aborts in-flight generation — used for barge-in. */
  cancel(): void {
    this.abortController?.abort();
  }

  /** Streams raw text deltas for the assistant's next turn via onDelta as
   * they arrive, running any tool calls transparently across rounds, and
   * resolves once the turn is fully complete (or aborted via cancel()).
   * userText is omitted for the opening greeting — the agent speaks first. */
  async generateReply(onDelta: (text: string) => void, userText?: string, language?: string): Promise<void> {
    if (userText) {
      const hint = language ? ` [caller's last line was predominantly in language: ${language}]` : '';
      this.messages.push({ role: 'user', content: userText + hint });
    }

    for (let round = 0; round < 5; round++) {
      const { toolCalls, aborted } = await this.streamOnce(onDelta);
      if (aborted) return;
      if (!toolCalls.length) return;

      this.messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        this.log.info('Tool call received', { name: call.function.name });
        let output: unknown;
        try {
          output = await dispatchToolCall(this.session, call.function.name, call.function.arguments);
        } catch (error) {
          this.log.error('Tool call handling failed', error);
          output = { status: 'error', message: 'Internal error handling tool call' };
        }
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
  }

  private async streamOnce(onDelta: (text: string) => void): Promise<StreamResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

    this.abortController = new AbortController();
    const toolCallsByIndex = new Map<number, ChatToolCall>();
    let assistantContent = '';

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: this.abortController.signal,
        body: JSON.stringify({
          model: process.env.DIALOGUE_MODEL ?? 'gpt-4o-mini',
          messages: this.messages,
          tools: CHAT_TOOLS,
          stream: true,
        }),
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') return { toolCalls: [], aborted: true };
      throw error;
    }

    if (!response.body) throw new Error('Chat completions response had no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === 'string' && delta.content) {
            assistantContent += delta.content;
            onDelta(delta.content);
          }

          for (const toolCallDelta of delta.tool_calls ?? []) {
            const index = toolCallDelta.index ?? 0;
            const existing = toolCallsByIndex.get(index);
            if (!existing) {
              toolCallsByIndex.set(index, {
                id: toolCallDelta.id ?? '',
                type: 'function',
                function: {
                  name: toolCallDelta.function?.name ?? '',
                  arguments: toolCallDelta.function?.arguments ?? '',
                },
              });
            } else {
              if (toolCallDelta.function?.name) existing.function.name += toolCallDelta.function.name;
              if (toolCallDelta.function?.arguments) existing.function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return { toolCalls: [], aborted: true };
      throw error;
    }

    const toolCalls = Array.from(toolCallsByIndex.values());
    // When there are tool calls, generateReply pushes the assistant message
    // itself (alongside dispatching each call) — only push here for a plain
    // content-only turn, so history doesn't get a duplicate assistant entry.
    if (!toolCalls.length) this.messages.push({ role: 'assistant', content: assistantContent });

    return { toolCalls, aborted: false };
  }
}
