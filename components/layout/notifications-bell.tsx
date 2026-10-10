"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi } from "@/lib/labels/client";
import { NEAR_EXPIRY_ANCHOR, type ExpiringNotification } from "@/lib/labels/expiry";
import { formatMoney, type CurrencyInfo } from "@/lib/money";

const listHref = (branchId: string | null): string => {
  const params = new URLSearchParams({ type: "expiring" });
  if (branchId) params.set("branch", branchId);
  return `${ANBAR_STORAGE_PATH}?${params.toString()}#${NEAR_EXPIRY_ANCHOR}`;
};

/** Unread "expiring soon" notifications of owners and chefs; opening one marks it read. */
export default function NotificationsBell({ items, currency }: { items: ExpiringNotification[]; currency: CurrencyInfo }) {
  const { t } = useT();
  const copy = t.expiry.bell;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const markRead = async (ids: string[] | null) => {
    const outcome = await callLabelsApi("/api/notifications/read", "POST", { ids });
    if (outcome.ok) router.refresh();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={copy.label(items.length)}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-[12px] border border-line p-2 text-beige"
      >
        <Bell className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-[18px] text-black">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-[14px] border border-line bg-card p-3 shadow-xl lg:left-0 lg:right-auto">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/60">{copy.title}</p>
            {items.length > 0 && (
              <button type="button" onClick={() => void markRead(null)} className="text-xs text-beige hover:underline">
                {copy.markRead}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-white/60">{copy.empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {items.map((item) => (
                <li key={item.id} className="py-2">
                  <p className="text-sm">
                    {copy.item(item.count, item.totalValue !== null ? formatMoney(item.totalValue, { ...currency, code: item.currency ?? currency.code }) : null)}
                  </p>
                  <Link
                    href={listHref(item.branchId)}
                    onClick={() => {
                      setOpen(false);
                      void markRead([item.id]);
                    }}
                    className="text-xs text-amber-200 hover:underline"
                  >
                    {copy.open}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
