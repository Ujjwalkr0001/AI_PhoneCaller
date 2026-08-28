import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CallSession } from '../state/call-session.js';
import { logger } from '../utils/logger.js';

const TRANSCRIPTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'transcripts');

function formatIst(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
}

function buildTranscriptMarkdown(session: CallSession): string {
  const { qualification: q, callback } = session;
  const lines: string[] = [];

  lines.push(`# Call with ${session.phone}`);
  lines.push('');
  lines.push(`- **Call SID:** ${session.callSid}`);
  lines.push(`- **Started:** ${formatIst(session.callStartedAt)}`);
  lines.push(`- **Status:** ${session.status}`);
  lines.push(`- **Intent:** ${session.intent}`);
  lines.push('');;;;;

  lines.push('## Qualification captured');
  lines.push(`- Business type: ${q.businessType ?? '_not captured_'}`);
  lines.push(`- Product count: ${q.productCount ?? '_not captured_'}`);
  lines.push(`- Budget: ${q.budget ? `₹${q.budget.toLocaleString('en-IN')}` : '_not captured_'}`);
  lines.push(`- Timeline: ${q.timeline ?? '_not captured_'}`);
  lines.push(`- Features: ${q.features.length ? q.features.join(', ') : '_none_'}`);
  lines.push(`- Objections: ${q.objections.length ? q.objections.join(', ') : '_none_'}`);
  lines.push('');

  lines.push('## Callback');
  lines.push(
    callback.requested
      ? `Requested — "${callback.rawPhrase}" → resolved to ${callback.confirmedAt ? formatIst(callback.confirmedAt) : 'unresolved'}`
      : 'Not requested',
  );
  lines.push('');

  lines.push('## Transcript');
  if (!session.transcript.length) {
    lines.push('_No transcript captured for this call._');
  } else {
    for (const entry of session.transcript) {
      const time = new Date(entry.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      const speaker = entry.role === 'agent' ? 'Agent' : 'Caller';
      lines.push(`**[${time}] ${speaker}:** ${entry.text}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function saveCallTranscript(session: CallSession): Promise<void> {
  const log = logger.withCallSid(session.callSid);
  try {
    await mkdir(TRANSCRIPTS_DIR, { recursive: true });
    const safePhone = session.phone.replace(/[^\d+]/g, '');
    const filePath = path.join(TRANSCRIPTS_DIR, `${session.callSid}_${safePhone}.md`);
    await writeFile(filePath, buildTranscriptMarkdown(session), 'utf-8');
    log.info('Call transcript saved', { filePath });
  } catch (error) {
    log.error('Failed to save call transcript', error);
  }
}
