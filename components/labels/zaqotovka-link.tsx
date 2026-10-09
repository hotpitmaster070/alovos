"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";

export default function ZaqotovkaLink() {
  const { t } = useT();
  return (
    <Link href={ZAQOTOVKA_PATH} className={`${buttonVariants("outline", "sm")} mb-4 self-start`}>
      {t.labels.prep.nav} →
    </Link>
  );
}
