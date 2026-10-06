"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import LangSwitcher from "@/components/lang-switcher";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth";
import { mapAuthError, type LoginErrorCode } from "@/lib/auth-errors";
import { useT } from "@/lib/i18n/useT";

type Mode = "signIn" | "signUp";
type Feedback = { kind: "error"; code: LoginErrorCode } | { kind: "confirm" } | null;

const MIN_PASSWORD_LENGTH = 6;

export default function LoginForm({ next }: { next: string }) {
  const { t } = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signIn");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const copy = t.login;

  const finish = () => {
    router.replace(next);
    router.refresh();
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials = {
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };

    setPending(true);
    setFeedback(null);
    try {
      if (mode === "signIn") {
        await signIn(credentials);
        finish();
        return;
      }
      const result = await signUp(credentials);
      if (result.status === "signed_in") finish();
      else if (result.status === "email_taken") setFeedback({ kind: "error", code: "emailTaken" });
      else setFeedback({ kind: "confirm" });
    } catch (error) {
      setFeedback({ kind: "error", code: mapAuthError(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="px-4">
      <header className="mx-auto flex max-w-[390px] items-center justify-between py-4">
        <Logo />
        <LangSwitcher />
      </header>
      <main className="mx-auto mt-10 max-w-[390px] pb-16">
        <h1 className="font-serif text-[32px] font-bold leading-[1.15] tracking-tight">
          {mode === "signIn" ? copy.signIn : copy.signUp}
        </h1>
        <p className="mt-3 text-sm text-white/60">{copy.subtitle}</p>

        <Card className="mt-8">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="login-email">{copy.email}</Label>
              <Input id="login-email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="login-password">{copy.password}</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                required
                minLength={MIN_PASSWORD_LENGTH}
                aria-describedby={mode === "signUp" ? "login-password-hint" : undefined}
              />
              {mode === "signUp" && (
                <p id="login-password-hint" className="mt-1.5 text-xs text-white/50">
                  {copy.passwordHint}
                </p>
              )}
            </div>

            {feedback?.kind === "error" && (
              <p role="alert" className="text-sm text-red-400">
                {copy.errors[feedback.code]}
              </p>
            )}
            {feedback?.kind === "confirm" && (
              <p role="status" className="text-sm text-beige">
                {copy.confirmEmail}
              </p>
            )}

            <Button type="submit" disabled={pending}>
              {pending ? copy.working : mode === "signIn" ? copy.signIn : copy.signUp}
            </Button>
          </form>
        </Card>

        <Button
          variant="ghost"
          className="mt-4 w-full"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setFeedback(null);
          }}
        >
          {mode === "signIn" ? copy.noAccount : copy.haveAccount}
        </Button>
      </main>
    </div>
  );
}
