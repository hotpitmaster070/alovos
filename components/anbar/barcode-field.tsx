"use client";

import { ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import { useT } from "@/lib/i18n/useT";
import ScannerDialog from "./scanner-dialog";

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
 * which submits the surrounding form natively. A camera button appears only where the
 * BarcodeDetector API exists.
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
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    setCameraSupported("BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const onDetected = (value: string) => {
    setScanning(false);
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
        {cameraSupported && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScanning(true)}
            aria-label={t.anbar.scan.open}
            title={t.anbar.scan.open}
          >
            <ScanLine className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>
      {cameraSupported && (
        <ScannerDialog open={scanning} onOpenChange={setScanning} onDetected={onDetected} />
      )}
    </div>
  );
}
