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

export type CatalogLine = CatalogProduct & {
  stock: number;
  nearestExpiry: string | null;
  value: number;
};

export type Branch = { id: string; name: string };

export const STORAGE_TYPES = ["quru", "soyuducu", "dondurucu", "custom"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];
export const isStorageType = (value: string): value is StorageType =>
  (STORAGE_TYPES as readonly string[]).includes(value);

export type StorageLocation = { id: string; name: string; type: StorageType; branchId: string; active: boolean };

export const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;
export type Unit = (typeof UNITS)[number];
export const isUnit = (value: string): value is Unit =>
  (UNITS as readonly string[]).includes(value);
