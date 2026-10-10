export type CatalogProduct = {
  id: string;
  name: string;
  barcode: string | null;
  internalCode: string;
  photoUrl: string | null;
  category: string | null;
  unit: string;
  /** products.cost; null when the role may not see costs. */
  pricePerUnit: number | null;
  /** Days a fresh delivery keeps; pre-fills the expiry date on goods receipt. */
  shelfLifeDays: number | null;
  /** Reorder threshold in the product unit. */
  minStock: number | null;
  /** products.expiry_date; the catalog shows the nearest lot expiry when stock exists. */
  expiryDate: string | null;
  branchId: string | null;
  branchName: string | null;
  /** Default storage location; pre-selects the location on goods receipt. */
  storageLocationId: string | null;
};

/** A product offered on goods receipt; lastLotPrice is null when the role may not see costs. */
export type ReceiptProduct = CatalogProduct & {
  /** Cost per unit of the newest priced lot; pre-fills the price before products.cost. */
  lastLotPrice: number | null;
};

/** Matches shown for a typed name or code on goods receipt. */
export const RECEIPT_SEARCH_LIMIT = 20;

export type CatalogLine = CatalogProduct & {
  stock: number;
  nearestExpiry: string | null;
  value: number;
};

/** code: unique in the tenant; used in lot numbers, not in storage place codes. */
export type Branch = { id: string; name: string; code: string };

/** Display order; public.storage_type_rank() sorts the same way. */
export const STORAGE_TYPES = ["soyuducu", "dondurucu", "quru", "custom"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];
export const isStorageType = (value: string): value is StorageType =>
  (STORAGE_TYPES as readonly string[]).includes(value);

/** Middle part of a place code; public.storage_type_code() is the source the database uses. */
export const STORAGE_TYPE_CODES: Record<StorageType, string> = { soyuducu: "SOY", dondurucu: "DON", quru: "ANB", custom: "DIG" };

/** The code the database gives a place: {TYPE}-{number}, unique within its branch. */
export const storageLocationCode = (type: StorageType, number: number): string => `${STORAGE_TYPE_CODES[type]}-${number}`;

/** number: fixed per branch and type (Soyuducu #1, #2 ...); code: SOY-1. The branch is branchId only. */
export type StorageLocation = {
  id: string;
  name: string;
  type: StorageType;
  number: number;
  code: string;
  branchId: string;
  active: boolean;
};

/** Type order, then number. */
export const compareStorageLocations = (a: StorageLocation, b: StorageLocation): number =>
  STORAGE_TYPES.indexOf(a.type) - STORAGE_TYPES.indexOf(b.type) || a.number - b.number || a.id.localeCompare(b.id);

export const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;
export type Unit = (typeof UNITS)[number];
export const isUnit = (value: string): value is Unit =>
  (UNITS as readonly string[]).includes(value);
