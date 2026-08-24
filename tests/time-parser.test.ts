import { describe, expect, it } from 'vitest';
import { parseCallbackPhrase } from '../src/utils/time-parser.js';

// Reference "now": Monday 2026-08-24, 09:00 IST (03:30 UTC)
const REFERENCE_NOW = new Date('2026-08-24T03:30:00.000Z');

function istHourMinute(date: Date): string {
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')} ${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

describe('parseCallbackPhrase', () => {
  it('resolves "tomorrow morning" to 10am the next day', () => {
    const result = parseCallbackPhrase('call me tomorrow morning', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-25 10:00');
    expect(result!.isExplicitTime).toBe(false);
  });

  it('resolves "tomorrow around 11" to an explicit 11am', () => {
    const result = parseCallbackPhrase('tomorrow around 11', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-25 11:00');
    expect(result!.isExplicitTime).toBe(true);
  });

  it('resolves "call me after 6" to 6pm today', () => {
    const result = parseCallbackPhrase('call me after 6', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-24 18:00');
  });

  it('resolves "tomorrow evening" to 6pm the next day', () => {
    const result = parseCallbackPhrase('tomorrow evening', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-25 18:00');
  });

  it('resolves "next Monday" to the upcoming Monday, not today', () => {
    const result = parseCallbackPhrase('give me a call next Monday', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-31 10:00');
  });

  it('resolves Hindi-transliterated "kal shaam" to tomorrow evening', () => {
    const result = parseCallbackPhrase('kal shaam call kar dena', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-25 18:00');
  });

  it('resolves Telugu-transliterated "repu udayam" to tomorrow morning', () => {
    const result = parseCallbackPhrase('repu udayam call cheyandi', REFERENCE_NOW);
    expect(result).toBeDefined();
    expect(istHourMinute(result!.date)).toBe('2026-08-25 10:00');
  });

  it('returns undefined for unparseable phrases', () => {
    expect(parseCallbackPhrase('maybe sometime later', REFERENCE_NOW)).toBeUndefined();
  });
});
