const tails = new Map<string, Promise<void>>();

/** Serialize requests per provider key without keeping credentials in logs. */
export async function acquireSpeechRequest(key: string, signal: AbortSignal) {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  tails.set(key, tail);
  void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  let onAbort!: () => void;
  try {
    await Promise.race([previous, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
    signal.throwIfAborted();
    return release;
  } catch (error) {
    release();
    throw error;
  } finally { signal.removeEventListener('abort', onAbort); }
}

export async function retryDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
