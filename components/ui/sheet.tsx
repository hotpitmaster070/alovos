"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  className?: string;
};

/**
 * Light iOS-style bottom sheet on the native <dialog>: slides up from the bottom edge, focus is
 * trapped, Escape and a tap on the backdrop close it. On wide screens it floats as a card.
 * Content is mounted only while open, so forms reset every time.
 */
export function Sheet({ open, onOpenChange, title, description, closeLabel, children, className }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      className={cn(
        "mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[28px] border-0 bg-white p-0 font-system text-[#1d1d1f] antialiased shadow-[0_-12px_48px_rgba(0,0,0,0.14)] backdrop:bg-black/25 backdrop:animate-fade-in open:animate-sheet-up sm:mb-6 sm:max-w-lg sm:rounded-[28px]",
        className,
      )}
    >
      {open && (
        <div className="px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-2.5">
          <div className="mx-auto mb-5 h-[5px] w-9 rounded-full bg-black/15 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-[15px] text-neutral-500">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={closeLabel}
              className="shrink-0 rounded-full bg-black/5 p-2 text-neutral-500 transition-colors hover:bg-black/10 hover:text-neutral-900"
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}
