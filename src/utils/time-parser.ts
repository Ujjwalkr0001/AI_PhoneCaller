const IST_OFFSET_MINUTES = 5 * 60 + 30;

const DAY_KEYWORDS: Array<{ pattern: RegExp; offsetDays: number }> = [
  { pattern: /\b(day after tomorrow|parso|repu roju kaadu|repu tarvata)\b/i, offsetDays: 2 },
  { pattern: /\b(tomorrow|kal|repu)\b/i, offsetDays: 1 },
  { pattern: /\b(today|aaj|ivala|ivvala)\b/i, offsetDays: 0 },
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const TIME_OF_DAY_KEYWORDS: Array<{ pattern: RegExp; hour: number }> = [
  { pattern: /\b(morning|subah|udayam)\b/i, hour: 10 },
  { pattern: /\b(afternoon|dopahar|madhyahnam)\b/i, hour: 14 },
  { pattern: /\b(evening|shaam|sham|sayantram)\b/i, hour: 18 },
  { pattern: /\b(night|raat|ratri)\b/i, hour: 20 },
];

export interface ParsedCallbackTime {
  date: Date;
  /** true when the caller gave a specific hour/minute; false when we defaulted from a vague time-of-day word */
  isExplicitTime: boolean;
  matchedPhrase: string;
}

function istWallClockToUtc(y: number, m: number, d: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(y, m, d, hour, minute) - IST_OFFSET_MINUTES * 60000);
}

function toIstParts(date: Date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    weekday: ist.getUTCDay(),
  };
}

function findExplicitHourMinute(phrase: string): { hour: number; minute: number } | undefined {
  const explicit = phrase.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!explicit) return undefined;

  let hour = parseInt(explicit[1], 10);
  const minute = explicit[2] ? parseInt(explicit[2], 10) : 0;
  const meridiem = explicit[3]?.toLowerCase();

  if (hour > 23 || minute > 59) return undefined;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (!meridiem && hour >= 1 && hour <= 11) {
    // Bare hour with no am/pm and no time-of-day word nearby: assume the
    // common "call me after/at N" usage, which in casual speech usually
    // means the evening for small numbers like "after 6".
    const impliesEvening = /\bafter\b/i.test(phrase);
    if (impliesEvening) hour += 12;
  }

  return { hour, minute };
}

/**
 * Resolves a caller's natural-language callback phrase into a concrete IST
 * date/time, relative to `referenceNow`. Returns undefined when nothing
 * resolvable was found, so the caller (the sales agent) can ask again
 * rather than silently guessing.
 */
export function parseCallbackPhrase(phrase: string, referenceNow: Date): ParsedCallbackTime | undefined {
  const normalized = phrase.trim();
  if (!normalized) return undefined;

  const nowIst = toIstParts(referenceNow);
  let targetDay = { year: nowIst.year, month: nowIst.month, day: nowIst.day };
  let dayMatched = false;
  let explicitToday = false;

  for (const { pattern, offsetDays } of DAY_KEYWORDS) {
    if (pattern.test(normalized)) {
      const base = istWallClockToUtc(nowIst.year, nowIst.month, nowIst.day + offsetDays, 0, 0);
      const parts = toIstParts(base);
      targetDay = { year: parts.year, month: parts.month, day: parts.day };
      dayMatched = true;
      if (offsetDays === 0) explicitToday = true;
      break;
    }
  }

  if (!dayMatched) {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`, 'i').test(normalized)) {
        let delta = (i - nowIst.weekday + 7) % 7;
        if (delta === 0) delta = 7; // "next Monday" means the upcoming one, not today
        const base = istWallClockToUtc(nowIst.year, nowIst.month, nowIst.day + delta, 0, 0);
        const parts = toIstParts(base);
        targetDay = { year: parts.year, month: parts.month, day: parts.day };
        dayMatched = true;
        break;
      }
    }
  }

  const explicitTime = findExplicitHourMinute(normalized);
  let hour: number;
  let minute: number;
  let isExplicitTime: boolean;

  if (explicitTime) {
    hour = explicitTime.hour;
    minute = explicitTime.minute;
    isExplicitTime = true;
  } else {
    const timeOfDay = TIME_OF_DAY_KEYWORDS.find(({ pattern }) => pattern.test(normalized));
    if (timeOfDay) {
      hour = timeOfDay.hour;
      minute = 0;
      isExplicitTime = false;
    } else if (dayMatched) {
      hour = 10;
      minute = 0;
      isExplicitTime = false;
    } else {
      return undefined;
    }
  }

  const date = istWallClockToUtc(targetDay.year, targetDay.month, targetDay.day, hour, minute);

  if (date.getTime() <= referenceNow.getTime()) {
    // No day word was matched at all (e.g. "call me in the morning" said at
    // 7pm) — the implied day defaulted to today, but that time has already
    // passed, so the caller almost certainly meant the next occurrence.
    // If they explicitly said "today", though, don't guess — that's a real
    // ambiguity worth asking about rather than silently firing a callback
    // in the past (QStash schedules a past time immediately).
    if (explicitToday) return undefined;
    const rolled = istWallClockToUtc(targetDay.year, targetDay.month, targetDay.day + 1, hour, minute);
    return { date: rolled, isExplicitTime, matchedPhrase: normalized };
  }

  return { date, isExplicitTime, matchedPhrase: normalized };
}
