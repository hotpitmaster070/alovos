"use client";

import { ChevronDown, Package } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { StatusDot as Dot } from "@/lib/anbar/catalog-status";
import { cn } from "@/lib/utils";

/** 16px text keeps iOS Safari from zooming into the field on focus. */
const FIELD =
  "h-11 w-full rounded-[12px] bg-[#F5F5F7] px-3.5 text-[16px] text-neutral-900 placeholder:text-neutral-400 outline-none transition focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.06)] focus:ring-1 focus:ring-black/10 disabled:opacity-50";

export const LightInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function LightInput({ className, type = "text", ...props }, ref) {
    return <input ref={ref} type={type} className={cn(FIELD, "appearance-none", className)} {...props} />;
  },
);

export function LightSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(FIELD, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
        strokeWidth={2}
        aria-hidden="true"
      />
    </div>
  );
}

export function LightLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] text-neutral-500">
      {children}
      {hint && <span className="text-neutral-400"> · {hint}</span>}
    </label>
  );
}

export const PRIMARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 px-6 text-[17px] font-medium text-white transition hover:bg-neutral-800 active:scale-[0.99] disabled:opacity-50";

export const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-black/5 px-5 text-[15px] font-medium text-neutral-900 transition hover:bg-black/10 disabled:opacity-50";

/** Apple system colours, used only as small status dots. */
const DOT_CLASSES: Record<Dot, string> = {
  green: "bg-[#34C759]",
  yellow: "bg-[#FFCC00]",
  red: "bg-[#FF3B30]",
};

export function StatusDot({ dot, label, className }: { dot: Dot; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white", DOT_CLASSES[dot], className)}
    />
  );
}

export function ProductImage({ url, name, className }: { url: string | null; name: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden bg-[#F5F5F7]", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- photos come from arbitrary storage URLs
        <img src={url} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-8 w-8 text-neutral-300" strokeWidth={1.25} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-red-600">
      {children}
    </p>
  );
}
