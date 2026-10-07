"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import BarcodeScanner from "./barcode-scanner";

type BarcodeFieldProps = {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Submit the surrounding form right after a camera scan (used by the search form). */
  submitOnScan?: boolean;
};

/**
 * Text input for barcodes. USB/Bluetooth scanners type like a keyboard and finish with Enter,
 * which submits the surrounding form natively. The camera button opens the phone scanner.
 */
export default function BarcodeField({
  id,
  name,
  label,
  defaultValue = "",
  placeholder,
  autoFocus = false,
  submitOnScan = false,
}: BarcodeFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onScan = (value: string) => {
    const input = inputRef.current;
    if (!input) return;
    input.value = value.slice(0, BARCODE_MAX_LENGTH);
    if (submitOnScan) input.form?.requestSubmit();
  };

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoFocus={autoFocus}
          maxLength={BARCODE_MAX_LENGTH}
          defaultValue={defaultValue}
          placeholder={placeholder}
        />
        <BarcodeScanner iconOnly onScan={onScan} />
      </div>
    </div>
  );
}
