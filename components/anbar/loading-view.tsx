"use client";

import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n/useT";

const PLACEHOLDER_COUNT = 3;

export default function LoadingView() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true">
      <span className="sr-only">{t.anbar.loading}</span>
      {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
        <Card key={index} className="h-36 animate-pulse" />
      ))}
    </div>
  );
}
