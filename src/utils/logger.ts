type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, callSid: string | undefined, message: string, meta?: unknown) {
  const tag = callSid ? `[${callSid}]` : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${tag} ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) {
    fn(line, meta);
  } else {
    fn(line);
  }
}

export function createLogger(callSid?: string) {
  return {
    debug: (message: string, meta?: unknown) => write('debug', callSid, message, meta),
    info: (message: string, meta?: unknown) => write('info', callSid, message, meta),
    warn: (message: string, meta?: unknown) => write('warn', callSid, message, meta),
    error: (message: string, meta?: unknown) => write('error', callSid, message, meta),
    withCallSid: (nextCallSid: string) => createLogger(nextCallSid),
  };
}

export const logger = createLogger();
