"use client";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/useT";

export default function ErrorView({ reset }: { reset: () => void }) {
  const { t } = useT();

  return (
    <Card className="text-center" role="alert">
      <CardTitle>{t.anbar.errorTitle}</CardTitle>
      <Button className="mt-4" onClick={reset}>
        {t.anbar.retry}
      </Button>
    </Card>
  );
}
