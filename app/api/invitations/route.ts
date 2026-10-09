import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { validateInvitationInput } from "@/lib/purchasing/model";
import { createInvitation } from "@/lib/purchasing/repository";
import { serializeInvitation } from "@/lib/purchasing/serialize";

export const dynamic = "force-dynamic";

/**
 * Owner invites a chef (or co-owner): {phone, role: "chef"}. Returns a single-use link on this site's
 * own origin; it expires after tenant_settings.invite_ttl_days.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateInvitationInput(body) : null;
  if (!input?.ok) return invalidInput();
  const origin = new URL(request.url).origin;
  return resultResponse(
    await createInvitation(current.scope, input.value.phone, input.value.role),
    (invitation) => ({ invitation: serializeInvitation(invitation, origin) }),
    201,
  );
}
