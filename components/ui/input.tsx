import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = "text", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-beige focus:outline-none disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
