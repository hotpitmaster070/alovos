import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Native select (accessible, mobile friendly) styled with the design tokens. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm text-white focus:border-beige focus:outline-none disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
