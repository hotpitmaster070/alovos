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
 * Dark bottom sheet on the native <dialog>: slides up from the bottom edge, focus is trapped,
 * Escape and a tap on the backdrop close it. On wide screens it floats as a card.
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
      onClose={(event) => {
        // React bubbles `close` from dialogs portalled out of this one; only our own close counts.
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      className={cn(
        "mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[28px] border border-line bg-card p-0 text-white antialiased [color-scheme:dark] backdrop:bg-black/80 backdrop:animate-fade-in open:animate-sheet-up sm:mb-6 sm:max-w-lg sm:rounded-[28px]",
        className,
      )}
    >
      {open && (
        <div className="px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-2.5">
          <div className="mx-auto mb-5 h-[5px] w-9 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-serif text-xl font-bold tracking-tight">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-white/60">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={closeLabel}
              className="shrink-0 rounded-full border border-line p-2 text-white/70 transition-colors hover:text-white"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}
