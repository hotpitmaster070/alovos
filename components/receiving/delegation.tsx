"use client";

import { LoaderCircle, PauseCircle, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { displayName } from "@/components/inventory/ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useT } from "@/lib/i18n/useT";
import type { StaffMember } from "@/lib/inventory/model";
import { endDelegationAction, startDelegationAction } from "@/lib/receiving/actions";
import {
  DELEGATION_DURATIONS,
  DELEGATION_REASON_MAX,
  minutesLeft,
  type Delegation,
  type DelegationDuration,
  type ReceivingErrorCode,
} from "@/lib/receiving/model";
import { cn } from "@/lib/utils";

const TICK_MS = 30_000;

const nameOf = (email: string | null) => (email ? displayName(email) : "—");

/** "I stepped away": the owner/chef picks who receives goods at the branch, for how long and why. */
export function DelegateButton({
  branchId,
  candidates,
  onDone,
}: {
  branchId: string;
  candidates: StaffMember[];
  onDone: (text: string) => void;
}) {
  const { t } = useT();
  const copy = t.receiving.delegation;
  const router = useRouter();
  const reasonsId = useId();
  const [open, setOpen] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [minutes, setMinutes] = useState<DelegationDuration>(30);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ReceivingErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const durationLabel = (value: DelegationDuration) =>
    value === 30 ? copy.durations.m30 : value === 120 ? copy.durations.h2 : value === 1440 ? copy.durations.d1 : copy.durations.open;

  const activate = () => {
    if (!toUserId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await startDelegationAction({ branchId, toUserId, minutes, reason });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const person = candidates.find((candidate) => candidate.userId === toUserId);
        setOpen(false);
        onDone(copy.activated(nameOf(person?.email ?? null)));
        router.refresh();
      } catch {
        setError("save_failed");
      }
    });
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {copy.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={copy.title} description={copy.description} closeLabel={copy.close}>
        <div className="flex flex-col gap-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-white/60">{copy.noCandidates}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-white/60">{copy.to}</span>
                <Select value={toUserId} disabled={pending} onChange={(event) => setToUserId(event.target.value)}>
                  <option value="">{copy.toPlaceholder}</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.userId} value={candidate.userId}>
                      {nameOf(candidate.email)} · {candidate.role}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-white/60">{copy.duration}</span>
                <Select
                  value={minutes === null ? "open" : String(minutes)}
                  disabled={pending}
                  onChange={(event) => setMinutes(event.target.value === "open" ? null : (Number(event.target.value) as DelegationDuration))}
                >
                  {DELEGATION_DURATIONS.map((value) => (
                    <option key={value ?? "open"} value={value === null ? "open" : String(value)}>
                      {durationLabel(value)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-white/60">{copy.reason}</span>
                <Input
                  list={reasonsId}
                  value={reason}
                  maxLength={DELEGATION_REASON_MAX}
                  placeholder={copy.reasonPlaceholder}
                  disabled={pending}
                  onChange={(event) => setReason(event.target.value)}
                />
                <datalist id={reasonsId}>
                  {copy.reasons.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <div className="flex flex-wrap gap-1.5">
                  {copy.reasons.map((item) => (
                    <button
                      key={item}
                      type="button"
                      disabled={pending}
                      onClick={() => setReason(item)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition",
                        reason === item ? "border-beige bg-beige/15 text-beige" : "border-line text-white/60 hover:border-beige/60",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {t.receiving.errors[error]}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" disabled={pending || !toUserId} onClick={activate}>
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
              {copy.activate}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** A running hand-over with the time left and "End early"; refreshes the page when it runs out. */
export function DelegationBanner({
  delegation,
  onEnded,
}: {
  delegation: Delegation;
  onEnded: (text: string) => void;
}) {
  const { t } = useT();
  const copy = t.receiving.delegation;
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<ReceivingErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const left = minutesLeft(delegation.endAt, now);

  useEffect(() => {
    if (!delegation.endAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [delegation.endAt]);

  useEffect(() => {
    if (left === 0) router.refresh();
  }, [left, router]);

  const end = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await endDelegationAction(delegation.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onEnded(copy.ended);
        router.refresh();
      } catch {
        setError("save_failed");
      }
    });
  };

  const incoming = delegation.direction === "incoming";
  const leftText = left === null ? copy.untilReturn : copy.left(left);
  const reason = delegation.reason ?? "—";
  const text = incoming
    ? copy.incoming(nameOf(delegation.fromEmail), leftText, reason)
    : copy.outgoing(nameOf(delegation.toEmail), leftText, reason);

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-sm",
        incoming ? "border-amber-400/50 bg-amber-400/10 text-amber-100" : "border-sky-400/40 bg-sky-400/10 text-sky-100",
      )}
    >
      <span className="flex items-center gap-2">
        {!incoming && <PauseCircle className="h-4 w-4 shrink-0" aria-hidden />}
        {text}
      </span>
      <div className="flex items-center gap-3">
        {error && <span className="text-xs text-red-300">{t.receiving.errors[error]}</span>}
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={end}>
          {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {copy.endEarly}
        </Button>
      </div>
    </div>
  );
}
