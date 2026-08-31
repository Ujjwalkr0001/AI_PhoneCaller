export type Intent = 'hot' | 'warm' | 'cold' | 'unknown';

export type CallStatus = 'ringing' | 'in-progress' | 'completed' | 'no-answer' | 'busy' | 'failed';

export interface TranscriptEntry {
  role: 'caller' | 'agent';
  text: string;
  at: string;
}

export interface CallbackInfo {
  requested: boolean;
  rawPhrase?: string;
  confirmedAt?: string;
  workflowStarted?: boolean;
}

export type CallType = 'sales' | 'support' | 'unknown';

export interface Qualification {
  businessType?: string;
  productCount?: number;
  budget?: number;
  timeline?: string;
  features: string[];
  objections: string[];
}

export interface CallSession {
  callSid: string;
  streamSid?: string;
  phone: string;
  language: 'en' | 'hi' | 'te' | 'mixed' | 'unknown';
  status: CallStatus;
  callType: CallType;
  supportIssue?: string;
  qualification: Qualification;
  intent: Intent;
  callback: CallbackInfo;
  transcript: TranscriptEntry[];
  whatsappFollowUpSent: boolean;
  callStartedAt: string;
  answeredAt?: string;
  callEndedAt?: string;
  durationSeconds?: number;
}

const sessions = new Map<string, CallSession>();

export function createSession(callSid: string, phone: string): CallSession {
  const session: CallSession = {
    callSid,
    phone,
    language: 'unknown',
    status: 'ringing',
    callType: 'unknown',
    qualification: { features: [], objections: [] },
    intent: 'unknown',
    callback: { requested: false },
    transcript: [],
    whatsappFollowUpSent: false,
    callStartedAt: new Date().toISOString(),
  };
  sessions.set(callSid, session);
  return session;
}

export function getSession(callSid: string): CallSession | undefined {
  return sessions.get(callSid);
}

export function getSessionByStreamSid(streamSid: string): CallSession | undefined {
  for (const session of sessions.values()) {
    if (session.streamSid === streamSid) return session;
  }
  return undefined;
}

/** Most recently started calls first — backs the frontend's call history list. */
export function getAllSessions(): CallSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.callStartedAt.localeCompare(a.callStartedAt));
}

export function deleteSession(callSid: string): void {
  sessions.delete(callSid);
}

export function appendTranscript(session: CallSession, role: TranscriptEntry['role'], text: string): void {
  session.transcript.push({ role, text, at: new Date().toISOString() });;;;
}
