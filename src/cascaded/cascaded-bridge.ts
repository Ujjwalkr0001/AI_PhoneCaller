import type WebSocket from 'ws';
import type { CallSession } from '../state/call-session.js';
import { appendTranscript } from '../state/call-session.js';
import { SonioxClient } from './soniox-client.js';
import { CartesiaClient } from './cartesia-client.js';
import { DialogueClient } from './dialogue-client.js';
import {
  outboundMediaMessage,
  outboundClearMessage,
  type TwilioMediaEvent,
  type TwilioMarkEvent,
} from '../realtime/twilio-media-events.js';
import { logger } from '../utils/logger.js';

const SENTENCE_END = /[.!?।](\s|$)/;
const MAX_CHUNK_CHARS = 150;

/** Picks the TTS language from the actual script of the generated text
 * (Devanagari/Telugu Unicode ranges vs Latin), rather than guessing from the
 * caller's last language — this is ground truth for what Cartesia needs to
 * render, and lets one reply code-switch sentence-by-sentence correctly. */
function scriptLanguage(text: string): 'hi' | 'te' | 'en' {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const telugu = (text.match(/[ఀ-౿]/g) ?? []).length;
  if (telugu > devanagari && telugu > 0) return 'te';
  if (devanagari > 0) return 'hi';
  return 'en';
}

/** Cascaded alternative to AudioBridge: Soniox (STT) -> DialogueClient (LLM)
 * -> Cartesia (TTS), instead of one integrated OpenAI Realtime session.
 * Twilio's native 8kHz mulaw is fed to Soniox and produced by Cartesia
 * directly, so no resampling is needed anywhere in this bridge. */
export class CascadedBridge {
  private readonly soniox: SonioxClient;
  private readonly cartesia: CartesiaClient;
  private readonly dialogue: DialogueClient;
  private readonly log;

  private closed = false;
  private speaking = false;
  private currentContextId: string | undefined;
  private sentenceBuffer = '';
  private turnCounter = 0;

  constructor(private readonly session: CallSession, private readonly twilioWs: WebSocket) {
    this.log = logger.withCallSid(session.callSid);
    this.soniox = new SonioxClient(session.callSid);
    this.cartesia = new CartesiaClient(session.callSid);
    this.dialogue = new DialogueClient(session);
  }

  async start(): Promise<void> {
    this.wireClients();
    await Promise.all([this.soniox.connect(), this.cartesia.connect()]);
    // Outbound sales call: the agent should greet the caller proactively.
    await this.speakTurn();
  }

  private wireClients(): void {
    this.soniox.onFinalTurn((transcript, language) => {
      appendTranscript(this.session, 'caller', transcript);
      void this.speakTurn(transcript, language);
    });
    this.soniox.onActivity(() => this.handleBargeIn());
    this.soniox.onClose(() => {
      if (!this.closed) this.log.error('Soniox connection lost mid-call');
    });

    this.cartesia.onAudioChunk((contextId, audioBase64) => {
      if (contextId !== this.currentContextId || !this.session.streamSid) return;
      this.twilioWs.send(outboundMediaMessage(this.session.streamSid, audioBase64));
    });
    this.cartesia.onContextDone((contextId) => {
      if (contextId === this.currentContextId) this.speaking = false;
    });
    this.cartesia.onClose(() => {
      if (!this.closed) this.log.error('Cartesia connection lost mid-call');
    });
  }

  handleTwilioMedia(evt: TwilioMediaEvent): void {
    this.soniox.sendAudio(Buffer.from(evt.media.payload, 'base64'));
  }

  handleTwilioMark(_evt: TwilioMarkEvent): void {
    // No mark-based playback tracking needed — Cartesia's context lifecycle
    // (onContextDone) already tells us when the assistant has finished.
  }

  private handleBargeIn(): void {
    if (!this.speaking || !this.currentContextId) return;

    this.cartesia.cancelContext(this.currentContextId);
    this.dialogue.cancel();
    if (this.session.streamSid) this.twilioWs.send(outboundClearMessage(this.session.streamSid));

    this.speaking = false;
    this.currentContextId = undefined;
    this.sentenceBuffer = '';
  }

  private async speakTurn(userText?: string, language?: string): Promise<void> {
    const contextId = `${this.session.callSid}-${this.turnCounter++}`;
    this.currentContextId = contextId;
    this.speaking = true;
    this.sentenceBuffer = '';
    let assistantText = '';

    const flush = (isFinal: boolean) => {
      const text = this.sentenceBuffer.trim();
      if (!text && !isFinal) return;
      this.sentenceBuffer = '';
      if (contextId !== this.currentContextId) return; // canceled by a barge-in mid-turn
      this.cartesia.speak(contextId, text, { language: scriptLanguage(text), continue: !isFinal });
    };

    await this.dialogue.generateReply(
      (delta) => {
        if (contextId !== this.currentContextId) return; // canceled mid-stream
        assistantText += delta;
        this.sentenceBuffer += delta;
        if (SENTENCE_END.test(this.sentenceBuffer) || this.sentenceBuffer.length > MAX_CHUNK_CHARS) flush(false);
      },
      userText,
      language
    );

    if (contextId === this.currentContextId) {
      flush(true);
      if (assistantText.trim()) appendTranscript(this.session, 'agent', assistantText.trim());
    }
  }

  close(): void {
    this.closed = true;
    this.soniox.close();
    this.cartesia.close();
  }
}
