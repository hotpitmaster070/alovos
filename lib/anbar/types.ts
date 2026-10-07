export type Location = {
  id: string;
  name: string;
};

export type CatalogProduct = {
  id: string;
  name: string;
  barcode: string | null;
  internalCode: string;
  photoUrl: string | null;
  category: string | null;
  unit: string;
  pricePerUnit: number | null;
  /** Days a fresh delivery keeps; pre-fills the expiry date on goods receipt. */
  shelfLifeDays: number | null;
  /** Reorder threshold in the product unit. */
  minStock: number | null;
  /** products.expiry_date; the catalog shows the nearest lot expiry when stock exists. */
  expiryDate: string | null;
  branchId: string | null;
  branchName: string | null;
};

export type CatalogLine = CatalogProduct & {
  stock: number;
  nearestExpiry: string | null;
  value: number;
};

export type Branch = { id: string; name: string };

export type StorageLocation = { id: string; name: string; type: string; branchId: string | null };

export type Product = {
  id: string;
  name: string;
  barcode: string | null;
  expiryDate: string | null;
  qty: number;
  unit: string;
  cost: number | null;
  locationId: string | null;
};

export const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;
export type Unit = (typeof UNITS)[number];
export const isUnit = (value: string): value is Unit =>
  (UNITS as readonly string[]).includes(value);
