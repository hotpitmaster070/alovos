import { NextResponse } from "next/server";
import { invalidLabelsInput, labelsError, labelsResponse, serializePreparation } from "@/lib/labels/api";
import { validatePreparationDraft } from "@/lib/labels/model";
import { createPreparation, listPreparations } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** Recipes of the tenant; ?include_inactive=1 adds archived ones. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const includeInactive = new URL(request.url).searchParams.get("include_inactive") === "1";
  try {
    const preparations = await listPreparations(current.scope, { includeInactive });
    return NextResponse.json({ preparations: preparations.map(serializePreparation) });
  } catch (error) {
    console.error("preparations GET failed", error instanceof Error ? error.message : "unknown");
    return labelsError("save_failed", 500);
  }
}

/** Owners and chefs: {name, inputs: [{product_id, qty}], outputs: [{product_id, qty, portions?, name?}]}. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validatePreparationDraft(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  return labelsResponse(await createPreparation(current.scope, input.value), (preparation) => ({
    preparation: serializePreparation(preparation),
  }), 201);
}
