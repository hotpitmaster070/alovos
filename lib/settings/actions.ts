"use server";

import { revalidatePath } from "next/cache";
import { insertStorageLocation, updateStorageLocation } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { isUuid, validateStorageLocationInput, validateStorageLocationRename } from "@/lib/anbar/validation";
import { validateTenantSettingsInput } from "@/lib/tenant-settings/validation";

async function scope() {
  const resolved = await resolveScope();
  if (resolved.status !== "ok") return null;
  return resolved.scope;
}

function revalidateStorage() {
  revalidatePath("/app/sebeke");
  revalidatePath("/app/anbar", "layout");
}

export async function saveTenantSettings(form: FormData) {
  const input = validateTenantSettingsInput(form);
  if (!input) return;
  const current = await scope();
  if (!current) return;
  await current.client.from("tenant_settings").update(input).eq("tenant_id", current.tenantId);
  revalidatePath("/app", "layout");
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
  revalidateStorage();
}

export async function addStorageLocation(form: FormData) {
  const input = validateStorageLocationInput(form);
  if (!input.ok) return;
  const current = await scope();
  if (!current) return;
  await insertStorageLocation(current, input.value);
  revalidateStorage();
}

export async function renameStorageLocation(form: FormData) {
  const input = validateStorageLocationRename(form);
  if (!input.ok) return;
  const current = await scope();
  if (!current) return;
  await updateStorageLocation(current, input.value.id, { name: input.value.name });
  revalidateStorage();
}

/** Locations are never deleted: stock, movements and logs keep referencing them. */
export async function setStorageLocationActive(form: FormData) {
  const id = String(form.get("id") ?? "").trim();
  const active = form.get("active") === "true";
  if (!isUuid(id)) return;
  const current = await scope();
  if (!current) return;
  await updateStorageLocation(current, id, { isActive: active });
  revalidateStorage();
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
