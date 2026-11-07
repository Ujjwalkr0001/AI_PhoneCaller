export { mulawToLinearSample, mulawToPcm16le, pcm16ToWav } from '../../../src/cascaded/mulaw.js';
// ITU G.711 μ-law for signed 16-bit samples (132 bias, 32635 clip).
export function linearToMulaw(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  sample = Math.min(sample, 32635) + 132;
  let exponent = 7;
  for (let bit = 0x4000; exponent > 0 && !(sample & bit); bit >>= 1) exponent--;
  return ~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 15)) & 255;
}
export function pcmToMulaw(pcm: Buffer): Buffer {
  if (pcm.length % 2) throw new Error('PCM must have an even byte length');
  return Buffer.from(
    Array.from({ length: pcm.length / 2 }, (_, i) => linearToMulaw(pcm.readInt16LE(i * 2))),
  );
}
export class FrameBuffer {
  private pending = Buffer.alloc(0);
  constructor(readonly size: number) {}
  push(data: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, data]);
    const out: Buffer[] = [];
    while (this.pending.length >= this.size) {
      out.push(this.pending.subarray(0, this.size));
      this.pending = this.pending.subarray(this.size);
    }
    return out;
  }
  flush(pad = 0): Buffer[] {
    if (!this.pending.length) return [];
    const frame = Buffer.alloc(this.size, pad);
    this.pending.copy(frame);
    this.pending = Buffer.alloc(0);
    return [frame];
  }
}
export async function* sse(
  response: Response,
): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
  if (!response.ok || !response.body) throw new Error(`Provider HTTP ${response.status}`);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, '\n');
      let index: number;
      while ((index = pending.indexOf('\n\n')) >= 0) {
        const raw = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const lines = raw.split('\n'),
          event =
            lines
              .find((x) => x.startsWith('event:'))
              ?.slice(6)
              .trim() ?? 'message';
        const data = lines
          .filter((x) => x.startsWith('data:'))
          .map((x) => x.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]')
          yield { event, data: JSON.parse(data) as Record<string, unknown> };
      }
      if (done) break;
      if (pending.length > 2000000) throw new Error('Provider SSE frame too large');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
