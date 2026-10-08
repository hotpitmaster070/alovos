/** Calendar dates (YYYY-MM-DD) and day boundaries in a tenant's IANA time zone. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function isTimeZone(value: string): boolean {
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time of an instant in the zone, read back as if it were UTC. */
function wallClockMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetMs(instant: Date, timeZone: string): number {
  return wallClockMs(instant, timeZone) - Math.floor(instant.getTime() / 1000) * 1000;
}

function parseDate(date: string): number | null {
  const match = DATE_ONLY.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return utc;
}

const formatDate = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

export function isDateOnly(value: string): boolean {
  return parseDate(value) !== null;
}

export function todayIn(timeZone: string, now: Date): string {
  return formatDate(wallClockMs(now, timeZone));
}

/** "YYYY-MM-DD HH:MM" of a timestamp in the zone; the input unchanged when it is not a timestamp. */
export function localDateTime(timestamp: string, timeZone: string): string {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return timestamp;
  return new Date(wallClockMs(instant, timeZone)).toISOString().slice(0, 16).replace("T", " ");
}

export function addDays(date: string, days: number): string {
  const base = parseDate(date);
  if (base === null) throw new RangeError(`invalid date: ${date}`);
  return formatDate(base + days * MS_PER_DAY);
}

/** Whole calendar days from `from` to `to`; null when either is not a YYYY-MM-DD date. */
export function daysBetween(from: string, to: string): number | null {
  const start = parseDate(from);
  const end = parseDate(to.slice(0, 10));
  if (start === null || end === null) return null;
  return Math.round((end - start) / MS_PER_DAY);
}

/** The instant the calendar date starts in the zone (DST-aware). */
export function startOfDate(date: string, timeZone: string): Date {
  const local = parseDate(date);
  if (local === null) throw new RangeError(`invalid date: ${date}`);
  let instant = local - offsetMs(new Date(local), timeZone);
  instant = local - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** [start, end) of a calendar date in the zone, as ISO timestamps for created_at filters. */
export function dateBounds(date: string, timeZone: string): { start: string; end: string } {
  return {
    start: startOfDate(date, timeZone).toISOString(),
    end: startOfDate(addDays(date, 1), timeZone).toISOString(),
  };
}

export function todayBounds(timeZone: string, now: Date): { start: string; end: string } {
  return dateBounds(todayIn(timeZone, now), timeZone);
}
