// Standard G.711 mu-law codec — Twilio Media Streams' native wire format,
// also Sarvam TTS's output format. Needed here to decode to linear PCM (to
// mix in room noise, or to feed Sarvam's STT, which has no mu-law input
// option) and re-encode back to mu-law for Twilio.

export function mulawToLinearSample(muByteIn: number): number {
  const muByte = ~muByteIn & 0xff;
  const sign = muByte & 0x80;
  const exponent = (muByte & 0x70) >> 4;
  const mantissa = muByte & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function linearToMulawSample(sampleIn: number): number {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  let sample = sampleIn;
  let mask: number;

  if (sample < 0) {
    sample = MULAW_BIAS - sample;
    mask = 0x7f;
  } else {
    sample = sample + MULAW_BIAS;
    mask = 0xff;
  }
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // find the highest set bit
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~((exponent << 4) | mantissa) & mask;
}

/** The mu-law encoding of digital silence (linear sample 0). NOT 0x00 —
 * mu-law is a log/sign-magnitude codec, so the all-zero byte actually
 * decodes to a near-full-scale sample. Padding with 0x00 produces an
 * audible click instead of quiet. */
export const MULAW_SILENCE_BYTE = linearToMulawSample(0);

/** Decodes a buffer of 8kHz mu-law samples (Twilio's native wire format) to
 * 16-bit little-endian linear PCM — the format Sarvam's STT streaming API
 * requires (it has no mu-law input option, unlike Soniox). */
export function mulawToPcm16le(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(mulawToLinearSample(mulaw[i]), i * 2);
  }
  return pcm;
}

/** Wraps raw 16-bit mono PCM in a minimal 44-byte WAV (RIFF) header. Sarvam's
 * STT streaming API validates each message's audio.encoding strictly against
 * "audio/wav" (confirmed directly against the API — "pcm_s16le" is rejected
 * outright as an invalid enum value, even though it's an accepted
 * input_audio_codec at connect time), so every audio chunk sent over the
 * socket needs its own self-contained WAV container, not just a codec label. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size for PCM
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
