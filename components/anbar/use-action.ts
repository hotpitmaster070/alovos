"use client";

import { useState, useTransition, type FormEvent } from "react";
import { failure, type ActionResult, type AnbarErrorCode } from "@/lib/anbar/errors";

type ServerAction<T extends ActionResult> = (data: FormData) => Promise<T>;

type Options<T extends ActionResult> = {
  /** Optional client-side check that runs before the server action. */
  validate?: (data: FormData) => AnbarErrorCode | null;
  onSuccess?: (result: T & { ok: true }) => void;
  /** Set false to keep the submitted values on screen after a successful save. */
  resetOnSuccess?: boolean;
};

/** Runs a server action from a form submit, tracks pending state and resets the form on success. */
export function useAction<T extends ActionResult>(action: ServerAction<T>, options: Options<T> = {}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const invalid = options.validate?.(data) ?? null;
    if (invalid) {
      setResult(failure(invalid));
      return;
    }

    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await action(data);
        setResult(outcome);
        if (outcome.ok) {
          if (options.resetOnSuccess !== false) form.reset();
          options.onSuccess?.(outcome as T & { ok: true });
        }
      } catch {
        setResult(failure("saveFailed"));
      }
    });
  };

  return { pending, result, onSubmit };
}
