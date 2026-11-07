import pino from 'pino';
type Level = 'debug' | 'info' | 'warn' | 'error';
const sink = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const mask = (s: string) => s.replace(/\+?\d[\d ()-]{6,}\d/g, value => `+\u2022\u2022\u2022\u2022\u2022\u2022${value.replace(/\D/g, '').slice(-4)}`).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, '[email redacted]');
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested metadata omitted]';
  if (value instanceof Error) return { name: value.name, message: mask(value.message) };
  if (typeof value === 'string') return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) || /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : mask(value);
  if (Array.isArray(value)) return value.map(x => scrub(x, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /password|secret|api.?key|authorization|token|transcript|text|body|args|phone|email|from|^to$/i.test(k) ? '[redacted]' : scrub(v, depth + 1)]));
  return value;
}
export function createLogger(callSid?: string) {
  const write = (level: Level, message: string, meta?: unknown) => sink[level]({ call_id: callSid, meta: scrub(meta) }, mask(message));
  return {
    debug: (message: string, meta?: unknown) => write('debug', message, meta),
    info: (message: string, meta?: unknown) => write('info', message, meta),
    warn: (message: string, meta?: unknown) => write('warn', message, meta),
    error: (message: string, meta?: unknown) => write('error', message, meta),
    withCallSid: (next: string) => createLogger(next),
  };
}
export const logger = createLogger();
