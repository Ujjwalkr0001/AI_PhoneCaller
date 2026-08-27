import { existsSync, readFileSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { mulawToLinearSample, linearToMulawSample } from './mulaw.js';

function clampSample(sample: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(sample)));
}

/** Loads a real recorded room-tone loop if ROOM_NOISE_FILE points at one —
 * raw 8kHz mono mu-law, same format Twilio streams. Not bundled by default;
 * drop a short ambient recording at that path to use it. Falls back to the
 * synthesized floor below if unset or unreadable. */
function loadNoiseLoop(): Buffer | undefined {
  const path = process.env.ROOM_NOISE_FILE;
  if (!path) return undefined;
  if (!existsSync(path)) {
    logger.warn(`ROOM_NOISE_FILE="${path}" not found — falling back to synthetic room noise.`);
    return undefined;
  }
  const buf = readFileSync(path);
  logger.info(`Loaded room noise loop from ${path} (${(buf.length / 8000).toFixed(1)}s @ 8kHz)`);
  return buf;
}

/** Mixes a very low-level noise floor into outbound TTS audio so it sounds
 * like a call placed from an ordinary room rather than a silent studio
 * recording. Cartesia's API has no built-in ambience option, so this
 * decodes each mulaw sample, adds noise, and re-encodes. Keeps state across
 * chunks (one instance per call) so the noise doesn't click or reset
 * between sentences.
 *
 * Two sources, picked once at construction:
 *  - ROOM_NOISE_FILE unset (default): procedurally generated, low-pass
 *    filtered white noise.
 *  - ROOM_NOISE_FILE set: loops a real recorded ambient clip instead —
 *    tends to read as more authentic than synthesized hiss. */
export class RoomNoiseMixer {
  private filterState = 0;
  private readonly amplitude = Number(process.env.ROOM_NOISE_LEVEL ?? 180);
  private readonly smoothing = 0.9; // higher = softer/lower-frequency hum, lower = more hiss-like

  private readonly loop = loadNoiseLoop();
  private readonly loopGain = Number(process.env.ROOM_NOISE_FILE_GAIN ?? 0.15);
  private loopPos = 0;

  mixIntoMulaw(mulaw: Buffer): Buffer {
    return this.loop ? this.mixLoop(mulaw, this.loop) : this.mixSynthetic(mulaw);
  }

  private mixSynthetic(mulaw: Buffer): Buffer {
    const out = Buffer.alloc(mulaw.length);
    for (let i = 0; i < mulaw.length; i++) {
      const sample = mulawToLinearSample(mulaw[i]);
      const rawNoise = (Math.random() * 2 - 1) * this.amplitude;
      this.filterState = this.smoothing * this.filterState + (1 - this.smoothing) * rawNoise;
      out[i] = linearToMulawSample(clampSample(sample + this.filterState));
    }
    return out;
  }

  private mixLoop(mulaw: Buffer, loop: Buffer): Buffer {
    const out = Buffer.alloc(mulaw.length);
    for (let i = 0; i < mulaw.length; i++) {
      const sample = mulawToLinearSample(mulaw[i]);
      const noiseSample = mulawToLinearSample(loop[this.loopPos]) * this.loopGain;
      this.loopPos = (this.loopPos + 1) % loop.length;
      out[i] = linearToMulawSample(clampSample(sample + noiseSample));
    }
    return out;
  }
}
