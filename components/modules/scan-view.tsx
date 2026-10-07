"use client";

import { useState } from "react";
import BarcodeScanner from "@/components/anbar/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBlock, getBlockLabel } from "@/lib/blocks";
import { useT } from "@/lib/i18n/useT";

export default function ScanView() {
  const { lang } = useT();
  const block = getBlock("ai-skaner");
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState("");

  async function lookup(value: string) {
    setBarcode(value);
    const response = await fetch("/api/barcode/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ barcode: value }),
    });
    const body = (await response.json()) as { product?: { name?: string } | null };
    setResult(body.product?.name ?? "—");
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-white">
        {block ? getBlockLabel(block, lang) : "ai-skaner"}
      </h1>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup(barcode);
          }}
        >
          <Input value={barcode} onChange={(event) => setBarcode(event.target.value)} name="barcode" />
          <div className="flex gap-2">
            <Button type="submit">OK</Button>
            <BarcodeScanner onScan={(value) => void lookup(value)} />
          </div>
        </form>
        {result ? <p className="mt-4 text-sm text-white">{result}</p> : null}
      </Card>
    </div>
  );
}
