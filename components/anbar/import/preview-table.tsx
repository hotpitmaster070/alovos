"use client";

import { Check, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import type { ImportError, ImportField, RawImportRow } from "@/lib/import/model";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 60;
const VIEW_HEIGHT = 480;
const OVERSCAN = 8;

/**
 * Preview of the file rows: only the visible slice is rendered, so thousands of rows scroll smoothly.
 * Rows are green when ready and red with the reasons inline when not.
 */
export default function PreviewTable({
  rows,
  columns,
  errors,
}: {
  rows: RawImportRow[];
  columns: ImportField[];
  errors: Map<number, ImportError[]>;
}) {
  const { t } = useT();
  const copy = t.catalogImport;
  const [scrollTop, setScrollTop] = useState(0);

  const template = `56px 44px repeat(${columns.length}, minmax(130px, 1fr))`;
  const minWidth = 100 + columns.length * 130;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = useMemo(() => rows.slice(first, last), [rows, first, last]);

  const reason = (error: ImportError) =>
    error.field === "row" ? copy.rowErrors[error.code] : `${copy.fields[error.field]}: ${copy.rowErrors[error.code]}`;

  return (
    <div className="overflow-x-auto rounded-[18px] border border-white/10 bg-white/[0.02]">
      <div style={{ minWidth }}>
        <div
          role="row"
          className="grid border-b border-white/10 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-white/50"
          style={{ gridTemplateColumns: template }}
        >
          <span>{copy.table.row}</span>
          <span className="sr-only">{copy.table.status}</span>
          {columns.map((field) => (
            <span key={field} className="truncate pr-3">
              {copy.fields[field]}
            </span>
          ))}
        </div>
        <div
          role="rowgroup"
          className="overflow-y-auto"
          style={{ height: Math.min(VIEW_HEIGHT, rows.length * ROW_HEIGHT) }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
            {visible.map((line, i) => {
              const problems = errors.get(line.row) ?? [];
              const bad = new Set(problems.map((problem) => problem.field));
              return (
                <div
                  key={line.row}
                  role="row"
                  className={cn(
                    "absolute inset-x-0 grid content-center gap-y-1 border-b border-white/5 px-3 text-sm",
                    problems.length ? "bg-red-500/[0.07]" : "bg-emerald-500/[0.04]",
                  )}
                  style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: template }}
                >
                  <span className="tabular-nums text-white/40">{line.row}</span>
                  <span className="flex items-center" title={problems.length ? undefined : copy.table.ok}>
                    {problems.length ? (
                      <CircleAlert className="h-4 w-4 text-red-400" aria-label={copy.table.status} />
                    ) : (
                      <Check className="h-4 w-4 text-emerald-400" aria-label={copy.table.ok} />
                    )}
                  </span>
                  {columns.map((field) => (
                    <span
                      key={field}
                      className={cn("truncate pr-3", bad.has(field) ? "font-medium text-red-300" : "text-white/85")}
                      title={line.values[field] ?? ""}
                    >
                      {line.values[field] || <span className="text-white/20">—</span>}
                    </span>
                  ))}
                  {problems.length > 0 && (
                    <span
                      className="truncate text-xs text-red-300/90"
                      style={{ gridColumn: "3 / -1" }}
                      title={problems.map(reason).join(" · ")}
                    >
                      {problems.map(reason).join(" · ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
