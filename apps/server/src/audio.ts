/** Decode Twilio's G.711 μ-law audio to signed 16-bit PCM for Gnani STT. */
export function mulawToLinearSample(byte: number): number {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value & 0x70) >> 4;
  const mantissa = value & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}
export function mulawToPcm16le(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) pcm.writeInt16LE(mulawToLinearSample(mulaw[i]), i * 2);
  return pcm;
}
/** Wrap PCM in a WAV container for the authorized browser audio download. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
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
/** Count audio flow and exact digital reflections without logging voice payloads. */
export class MediaDiagnostics {
  private inboundFrames = 0;
  private outboundFrames = 0;
  private ignoredTracks = 0;
  private loopbackMatches = 0;
  private recent: string[] = [];
  private isVoice(frame: Buffer) {
    let energy = 0;
    for (const byte of frame) energy += Math.abs(mulawToLinearSample(byte));
    return frame.length > 0 && energy / frame.length > 250;
  }
  inbound(frame: Buffer, track: string | undefined) {
    if (track !== 'inbound') {
      this.ignoredTracks++;
      return false;
    }
    this.inboundFrames++;
    if (this.isVoice(frame)) {
      this.recent.push(frame.toString('base64'));
      if (this.recent.length > 250) this.recent.shift();
    }
    return true;
  }
  outbound(frame: Buffer) {
    this.outboundFrames++;
    if (this.isVoice(frame) && this.recent.includes(frame.toString('base64')))
      this.loopbackMatches++;
  }
  summary() {
    return {
      inbound_frames: this.inboundFrames,
      outbound_frames: this.outboundFrames,
      ignored_track_frames: this.ignoredTracks,
      exact_voice_loopback_frames: this.loopbackMatches,
    };
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
