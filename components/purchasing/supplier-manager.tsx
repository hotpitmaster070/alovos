"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Branch } from "@/lib/anbar/types";
import { SETTINGS_PATH } from "@/lib/auth-redirect";
import { currencyName, type Currency } from "@/lib/currency/model";
import { useT } from "@/lib/i18n/useT";
import { callPurchasingApi } from "@/lib/purchasing/client";
import { weekdayName } from "@/lib/purchasing/format";
import { SUPPLIER_CONTACT_MAX, SUPPLIER_NAME_MAX, WEEKDAYS, type Supplier } from "@/lib/purchasing/model";

type BranchOption = Pick<Branch, "id" | "name">;

function SupplierForm({
  supplier,
  branches,
  currencies,
  baseCode,
  onSaved,
}: {
  supplier: Supplier | null;
  branches: BranchOption[];
  currencies: Currency[];
  baseCode: string;
  onSaved: () => void;
}) {
  const { lang, t } = useT();
  const copy = t.purchasing.suppliers;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const phone = String(data.get("phone") ?? "");
    const email = String(data.get("email") ?? "");
    const body = {
      name: String(data.get("name") ?? ""),
      code: String(data.get("code") ?? ""),
      contact: String(data.get("contact") ?? ""),
      ...((phone.trim() !== "" || supplier?.phone) && { phone }),
      ...((email.trim() !== "" || supplier?.email) && { email }),
      delivery_days: data.getAll("delivery_days").map(String),
      branch_id: String(data.get("branch_id") ?? ""),
      lead_time_days: String(data.get("lead_time_days") ?? ""),
      default_currency: String(data.get("default_currency") ?? ""),
    };
    setPending(true);
    setError(null);
    const outcome = supplier
      ? await callPurchasingApi(`/api/suppliers/${supplier.id}`, "PATCH", body)
      : await callPurchasingApi("/api/suppliers", "POST", body);
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="supplier-name">{copy.name}</Label>
        <Input id="supplier-name" name="name" required maxLength={SUPPLIER_NAME_MAX} defaultValue={supplier?.name ?? ""} />
      </div>
      <div>
        <Label htmlFor="supplier-code">{copy.code}</Label>
        <Input
          id="supplier-code"
          name="code"
          maxLength={10}
          pattern="[A-Za-z0-9]{1,10}"
          className="uppercase"
          defaultValue={supplier?.code ?? ""}
        />
        <p className="mt-1 text-xs text-white/50">{copy.codeHint}</p>
      </div>
      <div>
        <Label htmlFor="supplier-contact">{copy.contact}</Label>
        <Input id="supplier-contact" name="contact" maxLength={SUPPLIER_CONTACT_MAX} defaultValue={supplier?.contact ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="supplier-phone">{copy.phone}</Label>
          <Input id="supplier-phone" name="phone" type="tel" inputMode="tel" placeholder={copy.phonePlaceholder} defaultValue={supplier?.phone ?? ""} />
          <p className="mt-1 text-xs text-white/50">{copy.phoneHint}</p>
        </div>
        <div>
          <Label htmlFor="supplier-email">{copy.email}</Label>
          <Input id="supplier-email" name="email" type="email" defaultValue={supplier?.email ?? ""} />
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-white/80">{copy.days}</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-1.5 text-sm text-white/80">
              <Checkbox name="delivery_days" value={day} defaultChecked={supplier?.deliveryDays.includes(day) ?? false} />
              {weekdayName(day, t.purchasing.locale)}
            </label>
          ))}
        </div>
      </fieldset>
      {branches.length > 1 && (
        <div>
          <Label htmlFor="supplier-branch">{copy.branch}</Label>
          <Select id="supplier-branch" name="branch_id" defaultValue={supplier?.branchId ?? ""}>
            <option value="">{copy.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="supplier-lead">{copy.leadTime}</Label>
        <Input
          id="supplier-lead"
          name="lead_time_days"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          defaultValue={supplier?.leadTimeDays ?? ""}
        />
      </div>
      {currencies.length > 0 && (
        <div>
          <Label htmlFor="supplier-currency">{t.labels.currency.supplier}</Label>
          <Select id="supplier-currency" name="default_currency" defaultValue={supplier?.currency ?? ""}>
            <option value="">{t.labels.currency.restaurant(baseCode)}</option>
            {currencies
              .filter((currency) => currency.code !== baseCode)
              .map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currencyName(currency, lang)}
                </option>
              ))}
          </Select>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? copy.working : copy.save}
      </Button>
    </form>
  );
}

/** Supplier list with delivery weekdays; owners and chefs add, edit and deactivate. */
export default function SupplierManager({
  suppliers,
  branches,
  canEdit,
  currencies,
  baseCode,
}: {
  suppliers: Supplier[];
  branches: BranchOption[];
  canEdit: boolean;
  currencies: Currency[];
  /** The restaurant's currency (suppliers without their own invoice in it). */
  baseCode: string;
}) {
  const { t } = useT();
  const copy = t.purchasing.suppliers;
  const router = useRouter();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const branchName = (id: string | null) => (id ? (branches.find((branch) => branch.id === id)?.name ?? "") : copy.allBranches);
  const days = (supplier: Supplier) =>
    supplier.deliveryDays.length === 0
      ? copy.noDays
      : WEEKDAYS.filter((day) => supplier.deliveryDays.includes(day))
          .map((day) => weekdayName(day, t.purchasing.locale))
          .join(", ");

  const toggleActive = async (supplier: Supplier) => {
    setBusy(supplier.id);
    setError(null);
    const outcome = await callPurchasingApi(`/api/suppliers/${supplier.id}`, "PATCH", { is_active: !supplier.active });
    setBusy(null);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href={SETTINGS_PATH} className={buttonVariants("outline", "sm")}>
            {t.purchasing.settingsLink}
          </Link>
          {canEdit && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {copy.add}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <Card>
        {suppliers.length === 0 ? (
          <p className="text-sm text-white/60">{copy.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.name}</TableHead>
                <TableHead>{copy.days}</TableHead>
                <TableHead>{copy.contact}</TableHead>
                {branches.length > 1 && <TableHead>{copy.branch}</TableHead>}
                {canEdit && <TableHead>{t.anbar.fields.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id} className={supplier.active ? undefined : "opacity-60"}>
                  <TableCell>
                    <span className="text-white">{supplier.name}</span>{" "}
                    <span className="font-mono text-xs text-white/40">{supplier.code}</span>
                    {!supplier.active && <Badge className="ml-2">{copy.inactive}</Badge>}
                  </TableCell>
                  <TableCell>{days(supplier)}</TableCell>
                  <TableCell className="text-white/70">
                    {[supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(" · ")}
                    {supplier.currency ? <span className="ml-2 font-mono text-xs text-amber-200">{supplier.currency}</span> : null}
                  </TableCell>
                  {branches.length > 1 && <TableCell>{branchName(supplier.branchId)}</TableCell>}
                  {canEdit && (
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(supplier)}>
                          {copy.edit}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy === supplier.id} onClick={() => toggleActive(supplier)}>
                          {supplier.active ? copy.deactivate : copy.activate}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? copy.add : editing ? `${copy.edit}: ${editing.name}` : ""}
        closeLabel={copy.cancel}
      >
        {editing !== null && (
          <SupplierForm
            key={editing === "new" ? "new" : editing.id}
            supplier={editing === "new" ? null : editing}
            branches={branches}
            currencies={currencies}
            baseCode={baseCode}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
