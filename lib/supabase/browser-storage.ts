import type { SupportedStorage } from "@supabase/supabase-js";
import {
  COOKIE_MAX_AGE_SECONDS,
  encodeValue,
  joinChunks,
  namesFor,
  splitIntoChunks,
  decodeValue,
  type CookiePair,
} from "./cookie-codec";

const hasDocument = (): boolean => typeof document !== "undefined";

function readCookies(): CookiePair[] {
  if (!hasDocument() || document.cookie === "") return [];
  return document.cookie.split("; ").map((entry) => {
    const separator = entry.indexOf("=");
    return {
      name: decodeURIComponent(entry.slice(0, separator)),
      value: decodeURIComponent(entry.slice(separator + 1)),
    };
  });
}

function writeCookie(name: string, value: string, maxAge: number): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/** supabase-js storage adapter that keeps the session in cookies so the server can read it. */
export const cookieStorage: SupportedStorage = {
  getItem(key) {
    const raw = joinChunks(key, readCookies());
    return raw === null ? null : decodeValue(raw);
  },
  setItem(key, value) {
    if (!hasDocument()) return;
    const chunks = splitIntoChunks(key, encodeValue(value));
    const keep = new Set(chunks.map((chunk) => chunk.name));
    for (const stale of namesFor(key, readCookies())) {
      if (!keep.has(stale)) writeCookie(stale, "", 0);
    }
    for (const chunk of chunks) writeCookie(chunk.name, chunk.value, COOKIE_MAX_AGE_SECONDS);
  },
  removeItem(key) {
    if (!hasDocument()) return;
    for (const name of namesFor(key, readCookies())) writeCookie(name, "", 0);
  },
};
