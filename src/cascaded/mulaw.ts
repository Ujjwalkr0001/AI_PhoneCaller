// Standard G.711 mu-law codec (the format Twilio Media Streams and Cartesia's
// "pcm_mulaw" output both use) — needed here only to decode to linear PCM,
// mix in room noise, and re-encode, since neither Twilio nor Cartesia speak
// linear PCM directly.

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
