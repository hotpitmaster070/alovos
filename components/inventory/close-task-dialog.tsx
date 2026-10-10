"use client";

import { motion } from "framer-motion";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { OWNER_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { closeInventoryTaskAction } from "@/lib/inventory/actions";
import type { InventoryErrorCode } from "@/lib/inventory/model";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";

/** "Close and write off": confirmation with the expected loss, then the toast and the owner dashboard. */
export default function CloseTaskButton({
  taskId,
  estimatedLoss,
  currency,
  label,
  autoOpen = false,
  redirectTo = OWNER_DASHBOARD_PATH,
}: {
  taskId: string;
  estimatedLoss: number;
  currency: CurrencyInfo;
  label?: string;
  autoOpen?: boolean;
  redirectTo?: string;
}) {
  const { t } = useT();
  const copy = t.inventory.report.close;
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<InventoryErrorCode | null>(null);
  const [toast, setToast] = useState<{ token: number; text: string } | null>(null);

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeInventoryTaskAction(taskId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        setToast({ token: Date.now(), text: copy.done(formatMoney(result.value.loss, currency)) });
        window.setTimeout(() => router.push(redirectTo), 1600);
      } catch {
        setError("save_failed");
      }
    });
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="bg-red-500 text-white hover:bg-red-500/90">
        <ShieldAlert className="h-4 w-4" aria-hidden />
        {label ?? copy.button}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)} title={copy.title} closeLabel={t.inventory.common.close}>
        <div className="flex flex-col gap-4">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-4"
          >
            <p className="text-base font-semibold text-red-300">{copy.text(formatMoney(estimatedLoss, currency))}</p>
            <p className="mt-2 text-sm text-white/65">{copy.details}</p>
          </motion.div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {t.inventory.errors[error]}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {t.inventory.common.cancel}
            </Button>
            <Button type="button" disabled={pending} onClick={confirm} className="bg-red-500 text-white hover:bg-red-500/90">
              {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {pending ? t.inventory.common.working : copy.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
      <Toast token={toast?.token ?? null} text={toast?.text ?? ""} />
    </>
  );
}
