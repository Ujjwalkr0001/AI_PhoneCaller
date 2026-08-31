// Small, dependency-free formatting helpers shared across the UI.

/** mm:ss, always two-digit minutes and seconds. Used for the live call timer. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** "1m 42s" / "48s" — used in history rows and the transcript header. */
export function formatDurationWords(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

/** Light NANP-style formatting for +1 numbers; other formats pass through as-is. */
export function formatPhone(raw) {
  const match = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (match) return `+1 ${match[1]} ${match[2]} ${match[3]}`;
  return raw;
}

/** "Today, 3:42 PM" / "Yesterday, 9:05 AM" / "Aug 27, 2:10 PM" */
export function formatWhen(iso) {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Accepts loosely-formatted input (spaces, dashes, parens) and normalizes to E.164-ish. */
export function normalizePhone(raw) {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits ? `+${digits}` : '';
}

export function isValidPhone(raw) {
  return /^\+\d{8,15}$/.test(normalizePhone(raw));
}
