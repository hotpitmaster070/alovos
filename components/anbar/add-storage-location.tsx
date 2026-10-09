"use client";

import { Plus } from "lucide-react";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addStorageLocationAction } from "@/lib/anbar/actions";
import { STORAGE_NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { STORAGE_TYPES, type Branch, type StorageLocation } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

function StorageLocationForm({
  branches,
  branchId,
  onCreated,
}: {
  branches: Pick<Branch, "id" | "name">[];
  branchId: string | null;
  onCreated: (location: StorageLocation) => void;
}) {
  const { t } = useT();
  const copy = t.anbar.storage;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<AnbarErrorCode | null>(null);
  const defaultBranch = branches.some((branch) => branch.id === branchId) ? branchId : (branches[0]?.id ?? "");

  if (branches.length === 0) return <p className="text-sm text-white/70">{t.anbar.catalog.noBranch}</p>;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // The dialog is portalled, but React still bubbles submit to any form that renders this button.
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const created = await addStorageLocationAction(data);
      if (created.ok) onCreated(created.location);
      else setError(created.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="storage-name">{copy.name}</Label>
        <Input
          id="storage-name"
          name="name"
          required
          autoFocus
          maxLength={STORAGE_NAME_MAX_LENGTH}
          placeholder={copy.namePlaceholder}
          autoComplete="off"
        />
      </div>
      <div>
        <Label htmlFor="storage-type">{copy.type}</Label>
        <Select id="storage-type" name="type" defaultValue="quru">
          {STORAGE_TYPES.map((type) => (
            <option key={type} value={type}>
              {copy.types[type]}
            </option>
          ))}
        </Select>
      </div>
      {branches.length > 1 ? (
        <div>
          <Label htmlFor="storage-branch">{copy.branch}</Label>
          <Select id="storage-branch" name="branchId" defaultValue={defaultBranch ?? ""}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="branchId" value={defaultBranch ?? ""} />
      )}
      {error ? <p className="text-sm text-red-300">{t.anbar.errors[error]}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t.anbar.working : copy.submit}
      </Button>
    </form>
  );
}

/** Beige "+" pill next to a storage select; opens a dialog that creates a location in the branch. */
export default function AddStorageLocation({
  branches,
  branchId,
  onCreated,
}: {
  branches: Pick<Branch, "id" | "name">[];
  branchId: string | null;
  onCreated: (location: StorageLocation) => void;
}) {
  const { t } = useT();
  const copy = t.anbar.storage;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.add}
        title={copy.add}
        className={cn(buttonVariants("outline", "sm"), "shrink-0")}
      >
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
      {mounted &&
        createPortal(
          <Dialog open={open} onOpenChange={setOpen} title={copy.title} closeLabel={t.anbar.kitchen.cancel}>
            <StorageLocationForm
              branches={branches}
              branchId={branchId}
              onCreated={(location) => {
                setOpen(false);
                onCreated(location);
              }}
            />
          </Dialog>,
          document.body,
        )}
    </>
  );
}
