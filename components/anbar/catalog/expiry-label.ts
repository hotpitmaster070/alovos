"use client";

import type { ExpiryStatus } from "@/lib/anbar/catalog-status";
import { useT } from "@/lib/i18n/useT";

/** Human text for an expiry status: "3 days left", "Expires today", "Expired 2 days ago". */
export function useExpiryLabel() {
  const { t } = useT();
  const shelf = t.anbar.shelf;
  return ({ daysLeft }: ExpiryStatus): string => {
    if (daysLeft === null) return shelf.noExpiry;
    if (daysLeft < 0) return shelf.expired(-daysLeft);
    if (daysLeft === 0) return shelf.expiresToday;
    return shelf.expiresIn(daysLeft);
  };
}
