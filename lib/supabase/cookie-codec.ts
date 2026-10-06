/**
 * Cookie format for the Supabase session, shared by the browser, server components and
 * middleware. Mirrors the layout of @supabase/ssr ("base64-" + base64url(JSON), split in
 * numbered chunks "<name>.0", "<name>.1", ...) so that package can replace this module later.
 */

export type CookiePair = { name: string; value: string };

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  [key: string]: unknown;
};

export const BASE64_PREFIX = "base64-";
export const MAX_CHUNK_SIZE = 3180;
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toBase64Url = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (input: string): string => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const encodeValue = (value: string): string => BASE64_PREFIX + toBase64Url(value);

export function decodeValue(raw: string): string | null {
  try {
    if (raw.startsWith(BASE64_PREFIX)) return fromBase64Url(raw.slice(BASE64_PREFIX.length));
    return raw;
  } catch {
    return null;
  }
}

export function splitIntoChunks(name: string, value: string): CookiePair[] {
  if (value.length <= MAX_CHUNK_SIZE) return [{ name, value }];
  const chunks: CookiePair[] = [];
  for (let i = 0, index = 0; i < value.length; i += MAX_CHUNK_SIZE, index += 1) {
    chunks.push({ name: `${name}.${index}`, value: value.slice(i, i + MAX_CHUNK_SIZE) });
  }
  return chunks;
}

/** Names (the plain one and numbered chunks) that belong to `name`. */
export const namesFor = (name: string, cookies: CookiePair[]): string[] =>
  cookies
    .map((cookie) => cookie.name)
    .filter((cookieName) => cookieName === name || new RegExp(`^${escapeRegExp(name)}\\.\\d+$`).test(cookieName));

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function joinChunks(name: string, cookies: CookiePair[]): string | null {
  const plain = cookies.find((cookie) => cookie.name === name);
  if (plain) return plain.value;

  const parts: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = cookies.find((cookie) => cookie.name === `${name}.${index}`);
    if (!chunk) break;
    parts.push(chunk.value);
  }
  return parts.length > 0 ? parts.join("") : null;
}

export function parseSession(json: string | null): StoredSession | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      isRecord(parsed) &&
      typeof parsed.access_token === "string" &&
      typeof parsed.refresh_token === "string"
    ) {
      return { ...parsed, access_token: parsed.access_token, refresh_token: parsed.refresh_token };
    }
  } catch {
    return null;
  }
  return null;
}

export function readSession(name: string, cookies: CookiePair[]): StoredSession | null {
  const raw = joinChunks(name, cookies);
  return raw ? parseSession(decodeValue(raw)) : null;
}

export function writeSession(
  name: string,
  session: StoredSession,
  existing: CookiePair[],
): { set: CookiePair[]; remove: string[] } {
  const set = splitIntoChunks(name, encodeValue(JSON.stringify(session)));
  const keep = new Set(set.map((cookie) => cookie.name));
  const remove = namesFor(name, existing).filter((cookieName) => !keep.has(cookieName));
  return { set, remove };
}

/** True when the access token is expired or about to expire (default: within 60 seconds). */
export const isSessionStale = (
  session: StoredSession,
  nowSeconds: number,
  marginSeconds = 60,
): boolean =>
  typeof session.expires_at === "number" && session.expires_at - marginSeconds <= nowSeconds;
