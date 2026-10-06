export const PAGE_SIZE = 50;
export const MAX_PAGE = 10000;
export const LOW_STOCK_THRESHOLD = 5;
export const BARCODE_MAX_LENGTH = 64;
export const NAME_MAX_LENGTH = 120;
export const EXPIRY_FILTERS = ["week", "month", "ok"] as const;
export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number];
