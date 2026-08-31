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

// Keeps the prompt bounded on a long call — without this, `messages` grows
// forever and every turn resends the whole call's history, so both cost and
// latency climb turn over turn. The system message at [0] always survives.
const MAX_HISTORY_MESSAGES = Number(process.env.DIALOGUE_MAX_HISTORY ?? 24);

const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';

/** Sarvam's chat completions endpoint is OpenAI-compatible (same
 * request/response shape). Tool-calling was verified directly against it:
 * correct incremental tool_calls deltas, matching finish_reason, arguments
 * parse cleanly.
 *
 * Model choice matters a lot here: plain "sarvam-105b" is a reasoning model
 * that streams chain-of-thought under delta.reasoning_content before any
 * delta.content — confirmed directly against the API to run ~2800 SSE events
 * of pure reasoning for a one-line "say hello", with real content only
 * arriving after. That's fine for an async chat UI but unusable for live
 * phone dialogue (the caller hears dead air and hangs up well before it
 * finishes). "sarvam-105b-conversations" is the non-reasoning variant —
 * confirmed to emit real content/tool-call deltas immediately, no reasoning
 * tokens at all — so that's the default, not the base model. */
function chatApiKey(): string {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('Missing SARVAM_API_KEY');
  return apiKey;
}

interface StreamResult {
  toolCalls: ChatToolCall[];
  aborted: boolean;
}

/** Drives the actual conversation — the STT/TTS clients are just ears and a
 * mouth; this is the brain, using Sarvam's OpenAI-compatible Chat Completions
 * endpoint since it only needs text in, text out. */
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

  /** Injects a system-level nudge (e.g. "wrap up, silence timeout hit")
   * without it being a caller line, so the next generateReply() call (with
   * no userText, same as the opening greeting) reacts to it. */
  pushSystemNudge(content: string): void {
    this.messages.push({ role: 'system', content });
  }


  private trimHistory(): void {
    if (this.messages.length <= MAX_HISTORY_MESSAGES + 1) return;
    let cut = this.messages.length - MAX_HISTORY_MESSAGES;
    // Don't let the cut boundary split a tool-call/tool-result pair — a
    // dangling 'tool' message with no preceding assistant tool_calls message
    // makes the Chat Completions API reject the whole request.
    while (cut < this.messages.length && this.messages[cut].role === 'tool') cut++;
    this.messages.splice(1, cut - 1);
  }

  /** Streams raw text deltas for the assistant's next turn via onDelta as
   * they arrive, running any tool calls transparently across rounds, and
   * resolves once the turn is fully complete (or aborted via cancel()).
   * userText is omitted for the opening greeting — the agent speaks first. */
  async generateReply(onDelta: (text: string) => void, userText?: string, language?: string): Promise<void> {
    this.trimHistory();
    if (userText) {
      // Not literally "this line's detected language" — cascaded-bridge.ts
      // only updates this on a substantial (>=12 char) caller turn, so on a
      // short one (a filler word, "okay", a name) it still reflects whatever
      // language was last established, not this turn's raw transcript.
      // Worded as the conversation's current language rather than "last
      // line" so that doesn't read as a mismatch/error to the model.
      const hint = language ? ` [reply in this language unless told otherwise: ${language}]` : '';
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

      // The call is being torn down — no point spending another round-trip
      // asking the model for a follow-up it'll never get to say.
      if (toolCalls.some((call) => call.function.name === 'end_call')) return;
    }
  }

  private async streamOnce(onDelta: (text: string) => void): Promise<StreamResult> {
    this.abortController = new AbortController();
    const toolCallsByIndex = new Map<number, ChatToolCall>();
    let assistantContent = '';

    let response: Response;
    try {
      response = await fetch(SARVAM_CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chatApiKey()}`, 'Content-Type': 'application/json' },
        signal: this.abortController.signal,
        body: JSON.stringify({
          model: process.env.SARVAM_MODEL ?? 'sarvam-105b-conversations',
          messages: this.messages,
          tools: CHAT_TOOLS,
          stream: true,
        }),
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') return { toolCalls: [], aborted: true };
      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      this.log.error('Chat completions request failed', { status: response.status, body });
      throw new Error(`Chat completions request failed: ${response.status}`);
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
      if (error?.name === 'AbortError') {
        // Barge-in cut this turn off — whatever was already streamed out
        // via onDelta actually played through TTS before being canceled, so
        // dropping it here (as this used to) erases the model's own memory
        // of having said/asked it. The next generateReply() call then sees
        // the caller's new line arrive right after their previous one with
        // no assistant turn in between, and treats it as an unprompted
        // fresh start — which is what was producing "jumps to a different
        // question" after an interruption. Recording the partial content
        // keeps that context intact; an in-flight tool call is incomplete
        // and unusable, so it's dropped rather than recorded.
        if (assistantContent) this.messages.push({ role: 'assistant', content: assistantContent });
        return { toolCalls: [], aborted: true };
      }
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
