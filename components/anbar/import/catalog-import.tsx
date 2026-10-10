"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { compareStorageLocations, type Branch, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { CatalogImportResponse } from "@/lib/import/catalog";
import { IMPORT_FIELDS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, type ImportError } from "@/lib/import/model";
import { cn } from "@/lib/utils";
import Confetti from "./confetti";
import PreviewTable from "./preview-table";

const ENDPOINT = "/api/anbar/import";
const REDIRECT_AFTER_MS = 2600;

type Preview = Extract<CatalogImportResponse, { rows: unknown }>;
type Failure = Extract<CatalogImportResponse, { error: unknown }>["error"];
type Progress = { phase: "upload" | "write"; value: number };
type Stage =
  | { kind: "idle" }
  | { kind: "checking"; progress: Progress }
  | { kind: "preview"; preview: Preview }
  | { kind: "importing"; preview: Preview; progress: Progress }
  | { kind: "done"; rows: number; stocked: number; seconds: number };

type Reply = { status: number; body: CatalogImportResponse | null };

/**
 * POST with upload progress (fetch has none). After the upload the server parses and writes, which
 * reports nothing, so the bar eases towards the end until the answer arrives.
 */
function send(form: FormData, onProgress: (progress: Progress) => void): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setInterval> | null = null;
    let value = 0;
    const stop = () => timer !== null && clearInterval(timer);
    xhr.open("POST", ENDPOINT);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      value = (event.loaded / event.total) * 0.35;
      onProgress({ phase: "upload", value });
    };
    xhr.upload.onload = () => {
      value = Math.max(value, 0.35);
      onProgress({ phase: "write", value });
      timer = setInterval(() => {
        value += (0.95 - value) * 0.06;
        onProgress({ phase: "write", value });
      }, 120);
    };
    xhr.onload = () => {
      stop();
      onProgress({ phase: "write", value: 1 });
      resolve({ status: xhr.status, body: (xhr.response as CatalogImportResponse | null) ?? null });
    };
    xhr.onerror = () => {
      stop();
      reject(new Error("network"));
    };
    xhr.send(form);
  });
}

function downloadTemplate() {
  const blob = new Blob([`${IMPORT_FIELDS.join(",")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "alovos-catalog-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function CatalogImport({
  allowed,
  branches,
  locations,
}: {
  allowed: boolean;
  branches: Branch[];
  locations: StorageLocation[];
}) {
  const { t } = useT();
  const copy = t.catalogImport;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const placesOf = useCallback(
    (branch: string) => locations.filter((item) => item.branchId === branch).sort(compareStorageLocations),
    [locations],
  );
  const [locationId, setLocationId] = useState<string>(placesOf(branches[0]?.id ?? "")[0]?.id ?? "");
  const places = useMemo(() => placesOf(branchId), [placesOf, branchId]);

  const failureText = (error: Failure): string =>
    error in copy.fileErrors
      ? copy.fileErrors[error as keyof typeof copy.fileErrors]
      : copy.requestErrors[error as keyof typeof copy.requestErrors];

  const request = (target: File, dryRun: boolean, branch: string, location: string, onProgress: (p: Progress) => void) => {
    const form = new FormData();
    form.set("file", target);
    form.set("dry_run", dryRun ? "1" : "0");
    if (branch) form.set("branch_id", branch);
    if (branch && location) form.set("location_id", location);
    return send(form, onProgress);
  };

  const check = async (target: File, branch = branchId, location = locationId) => {
    setFile(target);
    setMessage(null);
    setOnlyErrors(false);
    if (target.size > IMPORT_MAX_BYTES) {
      setStage({ kind: "idle" });
      setMessage(copy.fileErrors.too_large);
      return;
    }
    setStage({ kind: "checking", progress: { phase: "upload", value: 0 } });
    try {
      const { body } = await request(target, true, branch, location, (progress) =>
        setStage((current) => (current.kind === "checking" ? { kind: "checking", progress } : current)),
      );
      if (!body) throw new Error("network");
      if ("error" in body) {
        setStage({ kind: "idle" });
        setMessage(failureText(body.error));
        return;
      }
      setStage({ kind: "preview", preview: body });
    } catch {
      setStage({ kind: "idle" });
      setMessage(copy.network);
    }
  };

  const write = async () => {
    if (stage.kind !== "preview" || !file) return;
    const preview = stage.preview;
    const started = performance.now();
    setMessage(null);
    setStage({ kind: "importing", preview, progress: { phase: "upload", value: 0 } });
    try {
      const { body } = await request(file, false, branchId, locationId, (progress) =>
        setStage((current) => (current.kind === "importing" ? { ...current, progress } : current)),
      );
      if (!body) throw new Error("network");
      if ("error" in body) {
        setStage({ kind: "preview", preview });
        setMessage(failureText(body.error));
        return;
      }
      if (!body.written) {
        setStage({ kind: "preview", preview: body });
        return;
      }
      setStage({ kind: "done", rows: body.total, stocked: body.stocked, seconds: (performance.now() - started) / 1000 });
      setTimeout(() => router.push(ANBAR_CATALOG_PATH), REDIRECT_AFTER_MS);
    } catch {
      setStage({ kind: "preview", preview });
      setMessage(copy.network);
    }
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.target.files?.[0];
    event.target.value = "";
    if (target) void check(target);
  };

  const onDrag = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.type === "dragenter") dragDepth.current += 1;
    if (event.type === "dragleave") dragDepth.current -= 1;
    setDragging(dragDepth.current > 0);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const target = event.dataTransfer.files?.[0];
    if (target) void check(target);
  };

  const changeBranch = (next: string) => {
    const place = placesOf(next)[0]?.id ?? "";
    setBranchId(next);
    setLocationId(place);
    if (file && stage.kind === "preview") void check(file, next, place);
  };
  const changeLocation = (next: string) => {
    setLocationId(next);
    if (file && stage.kind === "preview") void check(file, branchId, next);
  };

  const preview = stage.kind === "preview" || stage.kind === "importing" ? stage.preview : null;
  const errorsByRow = useMemo(() => {
    const map = new Map<number, ImportError[]>();
    for (const error of preview?.errors ?? []) map.set(error.row, [...(map.get(error.row) ?? []), error]);
    return map;
  }, [preview]);
  const badRows = errorsByRow.size;
  const readyRows = (preview?.total ?? 0) - badRows;
  const shownRows = useMemo(
    () => (onlyErrors ? (preview?.rows ?? []).filter((row) => errorsByRow.has(row.row)) : (preview?.rows ?? [])),
    [onlyErrors, preview, errorsByRow],
  );
  const progress = stage.kind === "checking" || stage.kind === "importing" ? stage.progress : null;
  const busy = progress !== null;

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 hidden bg-[#0A0A0A] lg:left-64 lg:block" />
      <div className="relative z-10 -mx-4 -my-8 flex min-h-screen flex-col gap-6 bg-[#0A0A0A] p-6 text-white lg:-mx-10">
        <div className="flex items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
            <p className="mt-2 text-sm text-white/60">{copy.subtitle}</p>
          </div>
          <Link href={ANBAR_CATALOG_PATH} className={buttonVariants("outline", "sm")}>
            {copy.back}
          </Link>
        </div>

        {!allowed ? (
          <p className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 text-white/70">{copy.forbidden}</p>
        ) : stage.kind === "done" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 text-center"
          >
            <Confetti />
            <p className="font-serif text-[28px] font-bold leading-tight">{copy.done(stage.rows, stage.seconds.toFixed(1))}</p>
            {stage.stocked > 0 && <p className="text-white/70">{copy.doneStocked(stage.stocked)}</p>}
            <p className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.redirecting}
            </p>
          </motion.div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-branch">{copy.branch}</Label>
                <Select id="import-branch" value={branchId} disabled={busy} onChange={(event) => changeBranch(event.target.value)}>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                  <option value="">{copy.noBranch}</option>
                </Select>
              </div>
              {branchId && (
                <div className="space-y-1.5">
                  <Label htmlFor="import-location">{copy.location}</Label>
                  <Select
                    id="import-location"
                    value={locationId}
                    disabled={busy}
                    onChange={(event) => changeLocation(event.target.value)}
                  >
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.code} · {place.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-white/45">{copy.locationHint}</p>
                </div>
              )}
            </div>

            <AnimatePresence mode="wait">
              {!preview && (
                <motion.label
                  key="drop"
                  htmlFor="import-file"
                  onDragEnter={onDrag}
                  onDragOver={onDrag}
                  onDragLeave={onDrag}
                  onDrop={onDrop}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, scale: dragging ? 1.015 : 1 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed px-6 py-14 text-center transition-colors",
                    dragging ? "border-beige bg-beige/[0.08]" : "border-white/15 bg-white/[0.02] hover:border-white/30",
                    busy && "pointer-events-none",
                  )}
                >
                  <motion.span
                    animate={dragging ? { y: [0, -6, 0] } : { y: 0 }}
                    transition={dragging ? { repeat: Infinity, duration: 1 } : undefined}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.06]"
                  >
                    {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}
                  </motion.span>
                  <span className="text-lg font-medium">
                    {busy ? copy.checking : dragging ? copy.drop.active : copy.drop.title}
                  </span>
                  <span className="text-sm text-white/50">
                    {copy.drop.hint(IMPORT_MAX_ROWS, Math.round(IMPORT_MAX_BYTES / (1024 * 1024)))}
                  </span>
                  {!busy && <span className={buttonVariants("outline", "sm")}>{copy.drop.browse}</span>}
                  <input
                    id="import-file"
                    ref={input}
                    type="file"
                    accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    onChange={pick}
                    disabled={busy}
                  />
                </motion.label>
              )}
            </AnimatePresence>

            {progress && (
              <div className="space-y-1.5" aria-live="polite">
                <div className="flex justify-between text-xs text-white/60">
                  <span>{copy.phase[progress.phase]}</span>
                  <span className="tabular-nums">{Math.round(progress.value * 100)}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.value * 100)}
                >
                  <motion.div
                    className="h-full rounded-full bg-beige"
                    animate={{ width: `${progress.value * 100}%` }}
                    transition={{ ease: "easeOut", duration: 0.2 }}
                  />
                </div>
              </div>
            )}

            {message && (
              <p role="alert" className="rounded-[14px] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {message}
              </p>
            )}

            {!preview && !busy && (
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex items-center gap-2 self-start text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
              >
                <Download className="h-4 w-4" />
                {copy.drop.template}
              </button>
            )}

            {preview && (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <FileSpreadsheet className="h-4 w-4 text-white/60" />
                      {file?.name}
                    </span>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">{copy.summary.valid(readyRows)}</span>
                    {badRows > 0 && (
                      <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-300">{copy.summary.errors(preview.errors.length)}</span>
                    )}
                    {preview.stocked > 0 && (
                      <span className="rounded-full bg-white/10 px-3 py-1 text-white/70">{copy.summary.stocked(preview.stocked)}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {badRows > 0 && (
                      <>
                        <button type="button" className={cn(buttonVariants("ghost", "sm"), !onlyErrors && "text-white")} onClick={() => setOnlyErrors(false)}>
                          {copy.filter.all}
                        </button>
                        <button type="button" className={cn(buttonVariants("ghost", "sm"), onlyErrors && "text-white")} onClick={() => setOnlyErrors(true)}>
                          {copy.filter.errors}
                        </button>
                      </>
                    )}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                      {copy.another}
                    </Button>
                    <input
                      ref={input}
                      type="file"
                      accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="sr-only"
                      onChange={pick}
                    />
                  </div>
                </div>

                {preview.ignored.length > 0 && <p className="text-xs text-white/45">{copy.ignored(preview.ignored.join(", "))}</p>}

                <PreviewTable rows={shownRows} columns={preview.columns} errors={errorsByRow} />

                <div className="sticky bottom-0 -mx-6 flex justify-end border-t border-white/10 bg-[#0A0A0A]/90 px-6 py-4 backdrop-blur-xl">
                  <Button disabled={busy || badRows > 0 || readyRows === 0} onClick={() => void write()}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {badRows > 0 ? copy.fixFirst(preview.errors.length) : copy.submit(readyRows)}
                  </Button>
                </div>
              </motion.section>
            )}
          </>
        )}
      </div>
    </>
  );
}
