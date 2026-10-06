"use client";

import type { ActionResult } from "@/lib/anbar/errors";
import { useT } from "@/lib/i18n/useT";

export default function ActionMessage({ result }: { result: ActionResult | null }) {
  const { t } = useT();
  if (!result || result.ok) return null;

  return (
    <p role="alert" className="text-xs text-red-400">
      {t.anbar.errors[result.error]}
    </p>
  );
}
