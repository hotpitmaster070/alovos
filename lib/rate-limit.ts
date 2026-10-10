/**
 * Sliding-window limiter kept in the memory of one server instance: good enough to stop a client
 * from hammering a paid API, not a global quota (each serverless instance counts on its own).
 */
const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000;

/** Records a hit for key; false when it already had `limit` hits within the last `windowMs`. */
export function takeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const since = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((time) => time > since);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    hits.forEach((times, other) => {
      if (times.every((time) => time <= since)) hits.delete(other);
    });
  }
  return true;
}
