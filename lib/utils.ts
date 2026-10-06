export type ClassValue = string | false | null | undefined;

/** Joins class names, skipping falsy values (shadcn-style helper without extra dependencies). */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
