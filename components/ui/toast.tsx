"use client";

import { useEffect, useState } from "react";

export function Toast({ token, text }: { token: number | null; text: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (token === null) return;
    setOpen(true);
    const id = window.setTimeout(() => setOpen(false), 2800);
    return () => window.clearTimeout(id);
  }, [token]);

  if (!open || token === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm rounded-full bg-beige px-4 py-2 text-center text-sm font-medium text-black shadow-lg"
    >
      {text}
    </div>
  );
}
