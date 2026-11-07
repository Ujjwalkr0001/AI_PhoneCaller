import type { Campaign, Stage, Turn } from '../../../../packages/shared/src/index.js';
import type { DialogueClient, DialogueReply, SttClient, SttEvent, TelephonyProvider, TtsClient } from '../contracts.js';
export class MockStt implements SttClient {
  onTurn = (_e: SttEvent) => {}; onActivity = () => {}; onError = (_e: Error) => {};
  async connect() {} sendAudio(_pcm: Buffer) {} close() {}
  utterance(text: string, language = 'en-IN') { this.onActivity(); this.onTurn({ text, language, finalAt: Date.now(), endOfSpeechAt: Date.now() }); }
}
export class MockTts implements TtsClient {
  name = 'Mock TTS (silence, simulation)';
  async *synthesize(_text: string, _language: string, _voice: string, signal: AbortSignal) { if (!signal.aborted) yield Buffer.alloc(160, 255); }
}
export class MockTelephony implements TelephonyProvider {
  async dial(_to: string, id: string) { return `MOCK-${id}`; } async hangup(_sid: string) {}
}
export class MockDialogue implements DialogueClient {
  name = 'Mock dialogue (scripted simulation)';
  async reply(c: Campaign, history: Turn[], stage: Stage, _fields: Record<string, unknown>, _signal: AbortSignal, first: () => void): Promise<DialogueReply> {
    first(); const user = history.filter(t => t.role === 'caller').at(-1)?.text ?? '';
    const result: DialogueReply = { text: '', tools: [], tokens: 0 };
    if (/unknown|guarantee|discount|robot|human|price|salary/i.test(user)) { result.text = /robot|human/i.test(user) ? 'I am an AI assistant. I can arrange a callback from the team.' : 'The team will follow up with the information that is not in my fact sheet.'; return result; }
    if (stage === 'PERMISSION') { result.text = c.type === 'hr' ? c.screening_questions[0]?.question ?? 'What job-related experience would you like to share?' : c.qualification_questions[0]?.question ?? 'What are you looking for?'; result.tools = [{ name: 'advance_stage', args: { stage: 'DISCOVERY_SCREENING' } }]; }
    else if (stage === 'DISCOVERY_SCREENING') {
      const q = c.type === 'hr' ? c.screening_questions : c.qualification_questions;
      result.tools = [{ name: 'capture_fields', args: { fields: Object.fromEntries(q.map(x => [x.field_key, user])) } }, { name: 'advance_stage', args: { stage: 'PITCH_ROLE_INTRO' } }];
      result.text = c.type === 'hr' ? c.role_summary : c.product_description || c.fact_sheet;
    } else if (stage === 'PITCH_ROLE_INTRO') { result.text = 'What questions do you have?'; result.tools = [{ name: 'advance_stage', args: { stage: 'OBJECTIONS_QA' } }]; }
    else if (stage === 'OBJECTIONS_QA') { result.text = 'May the team follow up with you?'; result.tools = [{ name: 'advance_stage', args: { stage: 'CLOSE' } }]; }
    else if (stage === 'CLOSE') {
      const consent = /yes|agree|sure|हाँ/i.test(user) && !/\bno\b|not/i.test(user);
      result.tools = [{ name: 'capture_fields', args: { fields: { consent_to_follow_up: consent } } }, { name: 'set_interest_level', args: { level: 'warm', reason: 'Scripted sample interest' } }, { name: 'advance_stage', args: { stage: 'WRAP_UP' } }];
      result.text = 'Thank you for your time. Goodbye.';
    } else { result.text = 'Thank you. Goodbye.'; result.tools = [{ name: 'end_call', args: { reason: 'completed' } }]; }
    return result;
  }
}
