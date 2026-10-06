"use client";

import ErrorView from "@/components/anbar/error-view";

export default function AnbarError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorView reset={reset} />;
}
