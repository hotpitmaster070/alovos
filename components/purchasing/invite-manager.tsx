"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SETTINGS_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { callPurchasingApi } from "@/lib/purchasing/client";
import { INVITE_ROLES, type Invitation } from "@/lib/purchasing/model";
import { invitePath } from "@/lib/purchasing/serialize";

/** Copy and WhatsApp share for one invitation link. */
function InviteLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const { t } = useT();
  const copy = t.purchasing.invite;
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="invite-link">{copy.link}</Label>
      <Input id="invite-link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      <p className="text-xs text-white/50">{copy.expires(new Date(expiresAt).toLocaleString(t.purchasing.locale))}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied ? copy.copied : copy.copy}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(copy.shareText(url))}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants("outline", "sm")}
        >
          {copy.share}
        </a>
      </div>
    </div>
  );
}

/** Owner invites a chef by phone: the link is single-use and expires; the phone is for reference. */
export default function InviteManager({ invitations, canInvite }: { invitations: Invitation[]; canInvite: boolean }) {
  const { t } = useT();
  const copy = t.purchasing.invite;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    setNow(Date.now());
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const outcome = await callPurchasingApi("/api/invitations", "POST", {
      phone: String(data.get("phone") ?? ""),
      role: String(data.get("role") ?? ""),
    });
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    const invitation = (outcome.data as { invitation?: { url?: unknown; expires_at?: unknown } } | null)?.invitation;
    if (typeof invitation?.url === "string" && typeof invitation.expires_at === "string") {
      setCreated({ url: invitation.url, expiresAt: invitation.expires_at });
    }
    router.refresh();
  };

  const state = (invitation: Invitation) =>
    invitation.usedAt ? "used" : now !== null && Date.parse(invitation.expiresAt) <= now ? "expired" : "pending";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <Link href={SETTINGS_PATH} className={buttonVariants("outline", "sm")}>
          {t.purchasing.settingsLink}
        </Link>
      </div>

      {!canInvite ? (
        <p className="text-sm text-white/60">{copy.ownerOnly}</p>
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="invite-phone">{copy.phone}</Label>
                <Input
                  id="invite-phone"
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder={copy.phonePlaceholder}
                />
              </div>
              <div className="sm:w-40">
                <Label htmlFor="invite-role">{copy.role}</Label>
                <Select id="invite-role" name="role" defaultValue="chef">
                  {INVITE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {copy.roles[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? copy.working : copy.create}
              </Button>
            </form>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
            {created && <InviteLink key={created.url} url={created.url} expiresAt={created.expiresAt} />}
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle>{copy.history}</CardTitle>
            {invitations.length === 0 ? (
              <p className="text-sm text-white/60">{copy.empty}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {invitations.map((invitation) => {
                  const current = state(invitation);
                  return (
                    <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="font-mono text-white">{invitation.phone}</span>
                      <span className="text-white/60">{copy.roles[invitation.role]}</span>
                      <Badge>{copy[current]}</Badge>
                      {current === "pending" && origin && (
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(copy.shareText(new URL(invitePath(invitation.token), origin).toString()))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-beige underline-offset-2 hover:underline"
                        >
                          {copy.share}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
