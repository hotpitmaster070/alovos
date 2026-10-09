"use client";

import Link from "next/link";
import LangSwitcher from "@/components/lang-switcher";
import Logo from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { InvitationPreview, PurchasingErrorCode } from "@/lib/purchasing/model";

/**
 * Public invitation page. Signed out: sign in or register and come back. Signed in: the restaurant
 * and role, and a form post that joins it.
 */
export default function InviteAccept({
  token,
  preview,
  error,
  signInHref,
  signUpHref,
}: {
  token: string;
  /** null while signed out (the preview is only available to signed-in users). */
  preview: InvitationPreview | null;
  error: PurchasingErrorCode | null;
  signInHref: string;
  signUpHref: string;
}) {
  const { t } = useT();
  const copy = t.purchasing.accept;

  return (
    <div className="px-4">
      <header className="mx-auto flex max-w-[390px] items-center justify-between py-4">
        <Logo />
        <LangSwitcher />
      </header>
      <main className="mx-auto mt-10 max-w-[390px] pb-16">
        <h1 className="font-serif text-[32px] font-bold leading-[1.15] tracking-tight">{copy.title}</h1>
        <Card className="mt-8 flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {t.purchasing.errors[error]}
            </p>
          )}
          {!preview ? (
            <>
              <p className="text-sm text-white/70">{copy.needAccount}</p>
              <div className="flex flex-wrap gap-2">
                <Link href={signInHref} className={buttonVariants()}>
                  {copy.signIn}
                </Link>
                <Link href={signUpHref} className={buttonVariants("outline")}>
                  {copy.signUp}
                </Link>
              </div>
            </>
          ) : preview.state === "joined" ? (
            <>
              <p className="text-sm text-white/80">{copy.states.joined(preview.tenantName ?? "")}</p>
              <Link href={ANBAR_APP_PATH} className={buttonVariants()}>
                {copy.openApp}
              </Link>
            </>
          ) : preview.state !== "valid" ? (
            <p className="text-sm text-white/70">{copy.states[preview.state]}</p>
          ) : (
            <form method="post" action="/api/invitations/accept" className="flex flex-col gap-4">
              <p className="text-sm text-white/80">
                {copy.body(preview.tenantName ?? "", preview.role ? t.purchasing.invite.roles[preview.role] : "")}
              </p>
              <input type="hidden" name="token" value={token} />
              <Button type="submit">{copy.accept}</Button>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}
