import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn(
          "mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-white/50",
          className,
        )}
        {...props}
      />
    );
  },
);
