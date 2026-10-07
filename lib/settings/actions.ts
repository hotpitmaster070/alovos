"use server";

import { revalidatePath } from "next/cache";
import { resolveScope } from "@/lib/anbar/scope";

async function scope() {
  const resolved = await resolveScope();
  if (resolved.status !== "ok") return null;
  return resolved.scope;
}

export async function saveTenantSettings(form: FormData) {
  const current = await scope();
  if (!current) return;
  const settings = {
    currency: String(form.get("currency") ?? "").trim(),
    currency_symbol: String(form.get("currency_symbol") ?? "").trim(),
    language: String(form.get("language") ?? "").trim(),
  };
  const clean = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== ""));
  await current.client.from("tenants").update({ settings: clean }).eq("id", current.tenantId);
  revalidatePath("/app/sebeke");
  revalidatePath("/app/anbar");
}

export async function addBranch(form: FormData) {
  const current = await scope();
  if (!current) return;
  const name = String(form.get("name") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  if (!name) return;
  await current.client.from("branches").insert({
    tenant_id: current.tenantId,
    name,
    address: address || null,
  });
  revalidatePath("/app/sebeke");
}

export async function addStorageLocation(form: FormData) {
  const current = await scope();
  if (!current) return;
  const name = String(form.get("name") ?? "").trim();
  const type = String(form.get("type") ?? "").trim();
  const branchId = String(form.get("branch_id") ?? "").trim();
  if (!name || !type) return;
  await current.client.from("storage_locations").insert({
    tenant_id: current.tenantId,
    name,
    type,
    branch_id: branchId || null,
  });
  revalidatePath("/app/sebeke");
  revalidatePath("/app/anbar");
}

export async function addUnit(form: FormData) {
  const current = await scope();
  if (!current) return;
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  if (!code || !name) return;
  await current.client.from("units").insert({ tenant_id: current.tenantId, code, name });
  revalidatePath("/app/sebeke");
}
