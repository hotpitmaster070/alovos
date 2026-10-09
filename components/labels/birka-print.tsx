"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { isUnit } from "@/lib/anbar/types";
import { getExpiryInfo } from "@/lib/expiry";
import { useT } from "@/lib/i18n/useT";
import type { Lot } from "@/lib/labels/model";
import { formatQty } from "@/lib/purchasing/format";
import { encodeQr, qrSvgPath } from "@/lib/qr";
import type { ExpirySettings } from "@/lib/tenant-settings/parse";

const QUIET_ZONE = 2;

export type BirkaLabel = { lot: Lot; productName: string; storageName: string };

/** "2026-10-16" -> "16.10.2026": fixed width, the same in every language. */
const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

function LotQr({ value }: { value: string }) {
  const matrix = useMemo(() => encodeQr(value), [value]);
  if (!matrix) return null;
  const size = matrix.length + QUIET_ZONE * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[20mm] w-[20mm] shrink-0" shapeRendering="crispEdges" aria-label={value} role="img">
      <rect width={size} height={size} fill="#fff" />
      <path d={qrSvgPath(matrix, QUIET_ZONE)} fill="#000" />
    </svg>
  );
}

/** One 58 mm label: QR of the lot number, name, lot, dates, composition, quantity and storage. */
export function BirkaPrint({ label, settings }: { label: BirkaLabel; settings: ExpirySettings }) {
  const { t } = useT();
  const copy = t.labels.birka;
  const { lot } = label;
  const unit = isUnit(lot.unit) ? t.anbar.units[lot.unit] : lot.unit;
  const expiry = getExpiryInfo(lot.expiryDate, new Date(), settings);
  const urgent = expiry.level === "red" || expiry.level === "expired";

  return (
    <div className="box-border w-[58mm] break-inside-avoid bg-white px-[3mm] py-[2mm] font-sans text-[9pt] leading-tight text-black [&:not(:last-child)]:[break-after:page]">
      <div className="flex items-start gap-[2mm]">
        <LotQr value={lot.lotNumber} />
        <div className="min-w-0">
          <p className="text-[7pt] uppercase">{copy.name}</p>
          <p className="break-words text-[11pt] font-bold">{label.productName}</p>
          <p className="mt-[1mm] text-[7pt] uppercase">{copy.lot}</p>
          <p className="font-mono text-[8pt] font-bold">{lot.lotNumber}</p>
        </div>
      </div>
      <dl className="mt-[1.5mm] grid grid-cols-[auto_1fr] gap-x-[2mm] gap-y-[0.5mm]">
        <dt>{copy.made}</dt>
        <dd className="font-semibold">{labelDate(lot.productionDate)}</dd>
        <dt className={urgent ? "font-bold text-red-600" : undefined}>{copy.expires}</dt>
        <dd className={urgent ? "text-[11pt] font-bold text-red-600" : "text-[11pt] font-bold"}>{labelDate(lot.expiryDate)}</dd>
        <dt>{copy.qty}</dt>
        <dd className="font-semibold">
          {formatQty(lot.quantity)} {unit}
          {lot.portions !== null && ` · ${copy.portions(lot.portions)}`}
        </dd>
        <dt>{copy.storage}</dt>
        <dd className="font-semibold">{label.storageName}</dd>
        {lot.composition.length > 0 && (
          <>
            <dt>{copy.composition}</dt>
            <dd>
              {lot.composition.map((item, index) => (
                <span key={`${item.productId ?? item.name}-${index}`} className="block">
                  {item.name}
                  {item.lotNumber && <span className="font-mono text-[7pt]"> ({item.lotNumber})</span>}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * Sends the labels (each repeated `copies` times) to the browser print dialog once mounted; only the
 * sheet is printed (globals.css). Browsers do not print silently, so the dialog opens with the
 * thermal printer chosen last time. onDone runs after the dialog closes.
 */
export function BirkaPrintSheet({
  labels,
  settings,
  onDone,
}: {
  labels: { label: BirkaLabel; copies: number }[];
  settings: ExpirySettings;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const finish = () => done.current();
    window.addEventListener("afterprint", finish, { once: true });
    const timer = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, []);

  return createPortal(
    <div className="birka-sheet">
      {labels.flatMap(({ label, copies }) =>
        Array.from({ length: copies }, (_, copy) => <BirkaPrint key={`${label.lot.id}-${copy}`} label={label} settings={settings} />),
      )}
    </div>,
    document.body,
  );
}
