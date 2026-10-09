import InviteManager from "@/components/purchasing/invite-manager";
import { INVITE_PATH } from "@/lib/auth-redirect";
import { canInvite } from "@/lib/purchasing/model";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { listInvitations } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const { scope, role } = await purchasingPageScope(INVITE_PATH);
  const allowed = canInvite(role);
  const invitations = allowed ? await listInvitations(scope) : [];
  return <InviteManager invitations={invitations} canInvite={allowed} />;
}
