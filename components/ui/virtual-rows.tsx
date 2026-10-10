"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fixed-height rows where only the visible slice (plus overscan) is rendered, so long lists stay smooth.
 * The viewport grows with the list up to maxHeight, then scrolls.
 */
export function VirtualRows<T>({
  items,
  rowHeight,
  maxHeight,
  overscan = 6,
  getKey,
  renderRow,
  className,
}: {
  items: T[];
  rowHeight: number;
  maxHeight: number;
  overscan?: number;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const height = Math.min(maxHeight, items.length * rowHeight);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((scrollTop + maxHeight) / rowHeight) + overscan);

  return (
    <div
      role="rowgroup"
      className={cn("overflow-y-auto", className)}
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: items.length * rowHeight }}>
        {items.slice(first, last).map((item, i) => (
          <div key={getKey(item)} className="absolute inset-x-0" style={{ top: (first + i) * rowHeight, height: rowHeight }}>
            {renderRow(item, first + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
