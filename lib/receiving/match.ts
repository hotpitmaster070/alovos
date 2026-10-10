import type { Unit } from "@/lib/anbar/types";

/** Below this similarity an invoice name is left unmatched for a person to pick. */
export const MATCH_THRESHOLD = 0.55;

const LETTERS = "a-z0-9а-яёəğıöüşç";
const UNIT_WORDS = new RegExp(`\\d+([.,]\\d+)?\\s*(кг|kg|гр|г|gr|g|мл|ml|лт|л|lt|l|шт|pcs|ədəd|ed)(?![${LETTERS}])\\.?`, "gi");
const NON_WORD = new RegExp(`[^${LETTERS}]+`, "g");
const NON_LETTER = new RegExp(`[^${LETTERS}]`, "g");

/** Lowercase letters and digits only, units and pack sizes dropped ("Мука в/с 50кг" -> "мука в с"). */
export function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(UNIT_WORDS, " ")
    .replace(NON_WORD, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const text = ` ${value} `;
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient over character bigrams of normalized names, 0..1. */
export function similarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return 0.9;
  const x = bigrams(left);
  const y = bigrams(right);
  let shared = 0;
  let total = 0;
  x.forEach((count, gram) => {
    shared += Math.min(count, y.get(gram) ?? 0);
    total += count;
  });
  y.forEach((count) => {
    total += count;
  });
  return total === 0 ? 0 : (2 * shared) / total;
}

/** The best catalog entry for a name, or null under the threshold. */
export function bestMatch<T extends { name: string }>(name: string, candidates: T[]): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = similarity(name, item.name);
    if (!best || score > best.score) best = { item, score };
    if (score === 1) break;
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

/** Invoice unit text to a catalog unit; kg when unknown. */
export function unitFromInvoice(value: string): Unit {
  const unit = value.toLocaleLowerCase().replace(NON_LETTER, "").replace(/\d/g, "");
  if (["г", "гр", "g", "gr", "qr", "gram", "грамм"].includes(unit)) return "g";
  if (["л", "l", "lt", "litr", "литр", "liter"].includes(unit)) return "l";
  if (["мл", "ml"].includes(unit)) return "ml";
  if (["шт", "pcs", "pc", "ədəd", "ed", "ед", "штук", "piece", "уп", "pack"].includes(unit)) return "pcs";
  return "kg";
}
