"use client";

import { Badge } from "@/components/ui/badge";
import { EXPIRY_BADGE_CLASSES, getExpiryInfo } from "@/lib/expiry";
import { useT } from "@/lib/i18n/useT";

export default function ExpiryBadge({ expiryDate, now }: { expiryDate: string | null; now: Date }) {
  const { t } = useT();
  const { level, daysLeft } = getExpiryInfo(expiryDate, now);
  if (level === "none" || daysLeft === null) return null;

  const text =
    level === "expired"
      ? t.anbar.expiry.expired
      : daysLeft === 0
        ? t.anbar.expiry.today
        : t.anbar.expiry.daysLeft(daysLeft);

  return <Badge className={EXPIRY_BADGE_CLASSES[level]}>{text}</Badge>;
}
