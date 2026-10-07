"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function InvoiceUpload() {
  const [note, setNote] = useState("");

  async function onSubmit(form: FormData) {
    const response = await fetch("/api/ai/scan-invoice", { method: "POST", body: form });
    const body = (await response.json()) as { mocked?: boolean; items?: unknown[] };
    setNote(body.mocked ? String(body.items?.length ?? 0) : "—");
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(new FormData(event.currentTarget));
        }}
      >
        <Input name="photo" type="file" accept="image/*" />
        <div className="flex gap-2">
          <Button type="submit">OK</Button>
          <Button type="button" variant="outline" onClick={() => window.location.assign("/api/invoices/export")}>
            1C / Xero
          </Button>
        </div>
      </form>
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
    </Card>
  );
}
