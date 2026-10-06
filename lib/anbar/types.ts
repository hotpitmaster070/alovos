export type Location = {
  id: string;
  name: string;
};

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
