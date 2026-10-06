"use client";

import { useState, useTransition, type FormEvent } from "react";
import { failure, type ActionResult, type AnbarErrorCode } from "@/lib/anbar/errors";

type ServerAction = (data: FormData) => Promise<ActionResult>;

type Options = {
  /** Optional client-side check that runs before the server action. */
  validate?: (data: FormData) => AnbarErrorCode | null;
  onSuccess?: () => void;
};

/** Runs a server action from a form submit, tracks pending state and resets the form on success. */
export function useAction(action: ServerAction, options: Options = {}) {
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
          form.reset();
          options.onSuccess?.();
        }
      } catch {
        setResult(failure("saveFailed"));
      }
    });
  };

  return { pending, result, onSubmit };
}
