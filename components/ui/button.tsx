import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost";
type Size = "default" | "sm" | "icon";

const VARIANTS: Record<Variant, string> = {
  default: "bg-beige text-black hover:bg-beige/90",
  outline: "border border-beige text-beige hover:bg-beige hover:text-black",
  ghost: "text-white/70 hover:text-white",
};

const SIZES: Record<Size, string> = {
  default: "px-5 py-2.5 text-sm",
  sm: "px-4 py-2 text-xs",
  icon: "h-9 w-9",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const buttonVariants = (variant: Variant = "default", size: Size = "default"): string =>
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-beige disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "default", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants(variant, size), className)} {...props} />;
});
