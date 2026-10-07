"use client";

import { Camera, Flashlight, FlashlightOff, Keyboard, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type CameraErrorKind = "insecure" | "inApp" | "unsupported" | "denied" | "notFound" | "busy" | "failed";
type CameraError = { kind: CameraErrorKind; detail: string | null };
type Engine = "native" | "zxing";
type Diagnostics = { engine: Engine; resolution: string | null };
type TorchCapability = ReturnType<ReturnType<Html5Qrcode["getRunningTrackCameraCapabilities"]>["torchFeature"]>;

const BEEP_HZ = 1200;
const BEEP_SECONDS = 0.12;
const VIBRATE_MS = 80;
const LOG_PREFIX = "[scanner]";

/** Instagram, Facebook, WhatsApp, Telegram, WeChat, TikTok and Snapchat webviews often block the camera. */
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Telegram|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat/i;
/** Native BarcodeDetector is used only when it covers every retail format we need. */
const NATIVE_FORMATS = ["ean_13", "ean_8", "code_128", "upc_a"];
/** 1D barcodes need resolution: at the 640x480 default most phones cannot resolve EAN bars. */
const HD_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};
const BASIC_CONSTRAINTS: MediaTrackConstraints = { facingMode: "environment" };

function feedback(audio: AudioContext | null) {
  navigator.vibrate?.(VIBRATE_MS);
  if (!audio) return;
  try {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = BEEP_HZ;
    gain.gain.value = 0.2;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + BEEP_SECONDS);
  } catch {
    // Sound is a nicety; the scan result is delivered regardless.
  }
}

function isInAppBrowser(): boolean {
  return IN_APP_BROWSER.test(navigator.userAgent);
}

function errorText(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "name" in cause) {
    const message = "message" in cause ? String(cause.message) : "";
    return `${String(cause.name)}: ${message}`;
  }
  return String(cause);
}

function classify(text: string): CameraErrorKind {
  if (/NotAllowed|Permission|SecurityError/i.test(text)) return isInAppBrowser() ? "inApp" : "denied";
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(text)) return "notFound";
  if (/NotReadable|TrackStart|Could not start video/i.test(text)) return "busy";
  return "failed";
}

/** Reasons the camera cannot work at all, checked before asking for permission. */
function preflight(): CameraErrorKind | null {
  if (!window.isSecureContext) return "insecure";
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return isInAppBrowser() ? "inApp" : "unsupported";
  }
  return null;
}

async function hasNativeDetector(): Promise<boolean> {
  if (!("BarcodeDetector" in window)) return false;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    return NATIVE_FORMATS.every((format) => supported.includes(format));
  } catch {
    return false;
  }
}

function ScannerOverlay({
  audio,
  onScan,
  onClose,
}: {
  audio: AudioContext | null;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.scan;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const regionId = `scanner-${useId().replace(/:/g, "")}`;
  const onScanRef = useRef(onScan);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<CameraError | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [torch, setTorch] = useState<TorchCapability | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let stopped = false;
    let delivered = false;
    let scanner: Html5Qrcode | null = null;

    const blocked = preflight();
    if (blocked) {
      console.error(LOG_PREFIX, "camera unavailable:", blocked, {
        isSecureContext: window.isSecureContext,
        hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
        userAgent: navigator.userAgent,
      });
      setError({ kind: blocked, detail: null });
      return;
    }

    const stopScanner = (instance: Html5Qrcode) => {
      if (instance.isScanning) {
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => undefined);
      } else {
        try {
          instance.clear();
        } catch {
          // Nothing was rendered yet.
        }
      }
    };

    async function launch(constraints: MediaTrackConstraints, native: boolean) {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: Format } = await import("html5-qrcode");
      if (stopped) return;
      const instance = new Html5Qrcode(regionId, {
        verbose: false,
        useBarCodeDetectorIfSupported: native,
        formatsToSupport: [
          Format.EAN_13,
          Format.EAN_8,
          Format.UPC_A,
          Format.UPC_E,
          Format.CODE_128,
          Format.CODE_39,
          Format.QR_CODE,
        ],
      });
      scanner = instance;
      await instance.start(
        { facingMode: "environment" },
        {
          fps: 12,
          disableFlip: true,
          videoConstraints: constraints,
          qrbox: (width, height) => ({
            width: Math.max(50, Math.floor(Math.min(width * 0.9, 480))),
            height: Math.max(50, Math.floor(Math.min(height * 0.4, 220))),
          }),
        },
        (text) => {
          const code = text.trim().slice(0, BARCODE_MAX_LENGTH);
          if (delivered || code === "") return;
          delivered = true;
          feedback(audio);
          onScanRef.current(code);
        },
        () => {
          // Frames without a code are expected; scanning continues.
        },
      );
    }

    async function start() {
      const native = await hasNativeDetector();
      if (stopped) return;
      try {
        await launch(HD_CONSTRAINTS, native);
      } catch (first: unknown) {
        const kind = classify(errorText(first));
        if (stopped || kind === "denied" || kind === "inApp") throw first;
        console.warn(LOG_PREFIX, "HD camera start failed, retrying with basic constraints:", first);
        if (scanner) stopScanner(scanner);
        await launch(BASIC_CONSTRAINTS, native);
      }

      const running = scanner;
      if (!running) return;
      if (stopped) {
        stopScanner(running);
        return;
      }

      const settings = running.getRunningTrackSettings();
      const resolution = settings.width && settings.height ? `${settings.width}×${settings.height}` : null;
      setDiagnostics({ engine: native ? "native" : "zxing", resolution });
      console.info(LOG_PREFIX, "camera started", { engine: native ? "BarcodeDetector" : "ZXing", resolution });

      try {
        await running.applyVideoConstraints({
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        });
      } catch {
        // Continuous autofocus is not exposed on every device (iOS focuses on its own).
      }
      try {
        const capability = running.getRunningTrackCameraCapabilities().torchFeature();
        if (!stopped && capability.isSupported()) setTorch(capability);
      } catch {
        // No torch control on this device.
      }
    }

    start().catch((cause: unknown) => {
      console.error(LOG_PREFIX, "camera start failed:", cause);
      if (stopped) return;
      const detail = errorText(cause);
      setError({ kind: classify(detail), detail });
    });

    return () => {
      stopped = true;
      if (scanner) stopScanner(scanner);
    };
  }, [audio, regionId, attempt]);

  const toggleTorch = async () => {
    if (!torch) return;
    try {
      await torch.apply(!torchOn);
      setTorchOn(!torchOn);
    } catch (cause) {
      console.error(LOG_PREFIX, "torch failed:", cause);
      setTorch(null);
    }
  };

  const retry = () => {
    setError(null);
    setDiagnostics(null);
    setTorch(null);
    setTorchOn(false);
    setAttempt((value) => value + 1);
  };

  const submitManual = () => {
    const code = manualCode.trim().slice(0, BARCODE_MAX_LENGTH);
    if (code !== "") onScanRef.current(code);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={copy.title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="relative flex h-full w-full flex-col">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="rounded-full bg-white/15 p-3 text-white backdrop-blur"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <p className="text-sm font-medium">{copy.title}</p>
          {torch ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-label={copy.torch}
              aria-pressed={torchOn}
              className={cn(
                "rounded-full p-3 backdrop-blur",
                torchOn ? "bg-beige text-black" : "bg-white/15 text-white",
              )}
            >
              {torchOn ? (
                <FlashlightOff className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Flashlight className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="h-11 w-11" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-1 items-center justify-center overflow-hidden">
          <div key={attempt} id={regionId} className="w-full" />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-2">
              <p className="text-sm font-medium text-red-400">{copy.errors[error.kind]}</p>
              {error.detail && <p className="break-all font-mono text-[11px] text-red-400/70">{error.detail}</p>}
              <Button variant="outline" size="sm" onClick={retry} className="inline-flex items-center gap-2">
                <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                {copy.retry}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-white/80">{copy.hint}</p>
          )}

          {manualOpen ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                // React events bubble through portals; the scanner button may sit inside a search form.
                event.preventDefault();
                event.stopPropagation();
                submitManual();
              }}
            >
              <Input
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                maxLength={BARCODE_MAX_LENGTH}
                placeholder={copy.manualPlaceholder}
                aria-label={copy.manualPlaceholder}
                inputMode="text"
                autoComplete="off"
                autoFocus
              />
              <Button type="submit" disabled={manualCode.trim() === ""}>
                {copy.manualSubmit}
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() => setManualOpen(true)}
              className="inline-flex items-center justify-center gap-2"
            >
              <Keyboard className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              {copy.manual}
            </Button>
          )}

          {diagnostics && (
            <p className="font-mono text-[10px] text-white/40">
              {diagnostics.engine === "native" ? "BarcodeDetector" : "ZXing"}
              {diagnostics.resolution ? ` · ${diagnostics.resolution}` : ""}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}

export type ScannerTrigger = { open: () => void; disabled: boolean; label: string };

type BarcodeScannerProps = {
  onScan: (code: string) => void;
  /** Square camera button without text, for use next to an input. */
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
  /** Custom trigger instead of the default outline button. */
  renderTrigger?: (trigger: ScannerTrigger) => ReactNode;
};

/**
 * Camera barcode/QR scanner (html5-qrcode): full-screen camera, beep and vibration on a hit,
 * torch where the device exposes it, manual entry as a fallback. Works in iOS Safari and Android
 * Chrome over HTTPS; in-app browsers (Instagram, WhatsApp) get a hint to open the real browser.
 */
export default function BarcodeScanner({
  onScan,
  iconOnly = false,
  className,
  disabled = false,
  renderTrigger,
}: BarcodeScannerProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [audio, setAudio] = useState<AudioContext | null>(null);

  const openScanner = () => {
    // iOS only allows audio that was unlocked inside a user gesture.
    if (!audio) {
      const Context =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context) {
        const created = new Context();
        void created.resume().catch(() => undefined);
        setAudio(created);
      }
    } else {
      void audio.resume().catch(() => undefined);
    }
    setOpen(true);
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ open: openScanner, disabled, label: t.anbar.scan.open })
      ) : (
        <Button
          variant="outline"
          size={iconOnly ? "icon" : "default"}
          onClick={openScanner}
          disabled={disabled}
          aria-label={t.anbar.scan.open}
          title={t.anbar.scan.open}
          className={cn("inline-flex shrink-0 items-center justify-center gap-2", className)}
        >
          <Camera className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          {!iconOnly && t.anbar.scan.button}
        </Button>
      )}
      {open &&
        createPortal(
          <ScannerOverlay
            audio={audio}
            onClose={() => setOpen(false)}
            onScan={(code) => {
              setOpen(false);
              onScan(code);
            }}
          />,
          document.body,
        )}
    </>
  );
}
