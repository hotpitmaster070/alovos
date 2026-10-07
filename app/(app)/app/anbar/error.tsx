"use client";

import { useEffect } from "react";
import ErrorView from "@/components/anbar/error-view";

export default function AnbarError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Anbar]", error.message, error.digest ? `digest: ${error.digest}` : "", error);
  }, [error]);

  return <ErrorView reset={reset} />;
}
