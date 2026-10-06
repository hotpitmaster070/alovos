export const BLOCK_SLUGS = [
  "anbar",
  "techizat",
  "hesablar",
  "reseptler",
  "tullanti",
  "hazirliq",
  "pos",
  "analitika",
  "komanda",
  "haccp",
  "ai-skaner",
  "sebeke",
] as const;

export type BlockSlug = (typeof BLOCK_SLUGS)[number];

/** Blocks that have their own static route and therefore skip the generic placeholder page. */
export const IMPLEMENTED_SLUGS: readonly BlockSlug[] = ["anbar"];
