"use server";

import { revalidatePath } from "next/cache";
import { failure, success, type ActionResult } from "./errors";
import { insertLocation, insertProduct, locationExists, moveStockRpc } from "./repository";
import { resolveScope } from "./scope";
import { validateLocationName, validateMoveInput, validateProductInput } from "./validation";

const ANBAR_PATH = "/app/anbar";

/** Every action re-verifies the session and re-resolves the organization; nothing is trusted from the client. */
export async function moveStockAction(data: FormData): Promise<ActionResult> {
  const input = validateMoveInput(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return failure("unauthenticated");
  if (resolved.status === "error") return failure("saveFailed");

  const error = await moveStockRpc(resolved.scope, input.value);
  if (error) return failure(error);

  revalidatePath(ANBAR_PATH);
  return success;
}

export async function addProductAction(data: FormData): Promise<ActionResult> {
  const input = validateProductInput(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return failure("unauthenticated");
  if (resolved.status === "error") return failure("saveFailed");

  const { scope } = resolved;
  try {
    if (input.value.locationId && !(await locationExists(scope, input.value.locationId))) {
      return failure("locationNotFound");
    }
    const error = await insertProduct(scope, input.value);
    if (error) return failure(error);
  } catch (error) {
    console.error("addProductAction failed", error instanceof Error ? error.message : "unknown");
    return failure("saveFailed");
  }

  revalidatePath(ANBAR_PATH);
  return success;
}

export async function addLocationAction(data: FormData): Promise<ActionResult> {
  const input = validateLocationName(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return failure("unauthenticated");
  if (resolved.status === "error") return failure("saveFailed");

  const error = await insertLocation(resolved.scope, input.name);
  if (error) return failure(error);

  revalidatePath(ANBAR_PATH);
  return success;
}
