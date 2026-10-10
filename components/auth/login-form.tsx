"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import LangSwitcher from "@/components/lang-switcher";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DEMO_EMAIL, DEMO_PASSWORD, isValidEmail, signIn, signUp, type SignUpResult } from "@/lib/auth";
import { listCurrencies } from "@/lib/currency/load";
import { currencyName, guessCurrency, type Currency } from "@/lib/currency/model";
import { useT } from "@/lib/i18n/useT";
import { createClient } from "@/lib/supabase/client";

/** The browser's IANA zone (Europe/Moscow); the database ignores unknown ones. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

type Mode = "signIn" | "signUp";
type Feedback = { kind: "error"; message: string } | { kind: "confirm" } | null;

const MIN_PASSWORD_LENGTH = 6;
const APP_HOME = "/app";
const INVALID_EMAIL_MESSAGE = "Email qəbul edilmir, real email yazın.";
const RATE_LIMIT_MESSAGE =
  "Çox cəhd etdiniz. 10 dəqiqə gözləyin və ya başqa email ilə yoxlayın. Supabase email limiti doldu.";

function rawMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return "";
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

function authMessage(error: unknown): string {
  const message = rawMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || errorStatus(error) === 429) return RATE_LIMIT_MESSAGE;
  if (lower.includes("is invalid")) return INVALID_EMAIL_MESSAGE;
  return message;
}

function isMissingDemoUser(error: unknown): boolean {
  const message = rawMessage(error).toLowerCase();
  return message.includes("invalid login credentials") || message.includes("invalid credentials") || message.includes("user not found");
}

function needsEmailConfirm(error: unknown): boolean {
  return rawMessage(error).toLowerCase().includes("not confirmed");
}

export default function LoginForm({
  next,
  initialMode = "signIn",
  inviteToken = null,
}: {
  next: string;
  initialMode?: Mode;
  /** Signup from an invitation link joins that restaurant instead of creating one. */
  inviteToken?: string | null;
}) {
  const { lang, t } = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [currency, setCurrency] = useState("");
  const copy = t.login;
  const asksCurrency = mode === "signUp" && !inviteToken;

  useEffect(() => {
    if (!asksCurrency || currencies.length > 0) return;
    let live = true;
    void listCurrencies(createClient())
      .then((list) => {
        if (!live) return;
        setCurrencies(list);
        setCurrency((current) => current || guessCurrency(list, navigator.languages ?? [navigator.language])?.code || "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [asksCurrency, currencies.length]);

  const finish = (path: string) => {
    router.replace(path);
    router.refresh();
  };

  const applySignUp = (result: SignUpResult) => {
    if (result.status === "signed_in") finish(APP_HOME);
    else if (result.status === "email_taken") setFeedback({ kind: "error", message: copy.errors.emailTaken });
    else setFeedback({ kind: "confirm" });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials = {
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };
    if (!isValidEmail(credentials.email)) {
      setFeedback({ kind: "error", message: INVALID_EMAIL_MESSAGE });
      return;
    }
    if (mode === "signUp" && asksCurrency && !currency) {
      setFeedback({ kind: "error", message: t.labels.currency.signupRequired });
      return;
    }

    setPending(true);
    setFeedback(null);
    try {
      if (mode === "signIn") {
        await signIn(credentials);
        finish(next);
        return;
      }
      applySignUp(await signUp(credentials, inviteToken, { currency: asksCurrency ? currency : null, timezone: browserTimeZone() }));
    } catch (err: unknown) {
      const fallback = mode === "signUp" ? "Qeydiyyat alınmadı" : copy.errors.unknown;
      setFeedback({ kind: "error", message: authMessage(err) || fallback });
    } finally {
      setPending(false);
    }
  };

  const onDemo = async () => {
    setPending(true);
    setFeedback(null);
    try {
      await signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      finish(next);
    } catch (error) {
      if (needsEmailConfirm(error)) {
        setFeedback({ kind: "confirm" });
        setPending(false);
        return;
      }
      if (!isMissingDemoUser(error)) {
        setFeedback({ kind: "error", message: authMessage(error) || copy.errors.unknown });
        setPending(false);
        return;
      }
      try {
        applySignUp(await signUp({ email: DEMO_EMAIL, password: DEMO_PASSWORD }));
      } catch (err: unknown) {
        setFeedback({ kind: "error", message: authMessage(err) || "Qeydiyyat alınmadı" });
      }
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
        {inviteToken && mode === "signUp" && <p className="mt-2 text-sm text-beige">{t.purchasing.accept.signUpHint}</p>}

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
            {asksCurrency && (
              <div>
                <Label htmlFor="login-currency">{t.labels.currency.signup}</Label>
                <Select id="login-currency" value={currency} required onChange={(event) => setCurrency(event.target.value)}>
                  <option value="" disabled>
                    {t.labels.currency.signupPick}
                  </option>
                  {currencies.map((item) => (
                    <option key={item.code} value={item.code}>
                      {currencyName(item, lang)}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-white/50">{t.labels.currency.signupHint}</p>
              </div>
            )}

            {feedback?.kind === "error" && (
              <p role="alert" className="text-sm text-red-400">
                {feedback.message}
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
            <Button type="button" variant="outline" disabled={pending} onClick={onDemo}>
              {copy.demo}
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
