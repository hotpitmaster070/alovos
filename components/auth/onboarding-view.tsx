"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import LangSwitcher from "@/components/lang-switcher";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signOut } from "@/lib/auth";
import { LOGIN_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";

export default function OnboardingView() {
  const { t } = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = t.onboarding;

  const leave = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      router.replace(LOGIN_PATH);
      router.refresh();
    }
  };

  return (
    <div className="px-4">
      <header className="mx-auto flex max-w-[390px] items-center justify-between py-4">
        <Logo />
        <LangSwitcher />
      </header>
      <main className="mx-auto mt-10 max-w-[390px] pb-16">
        <h1 className="font-serif text-[32px] font-bold leading-[1.15] tracking-tight">{copy.title}</h1>
        <Card className="mt-8">
          <p role="alert" className="text-sm text-white/70">
            {copy.body}
          </p>
          <Button className="mt-4 w-full" onClick={() => router.refresh()} disabled={pending}>
            {copy.retry}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={leave} disabled={pending}>
            {t.sidebar.signOut}
          </Button>
        </Card>
      </main>
    </div>
  );
}
