"use client";

import { Camera, Flashlight, FlashlightOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type CameraError = "denied" | "failed" | null;
type TorchCapability = ReturnType<ReturnType<Html5Qrcode["getRunningTrackCameraCapabilities"]>["torchFeature"]>;

const BEEP_HZ = 1200;
const BEEP_SECONDS = 0.12;
const VIBRATE_MS = 80;

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

function isPermissionError(cause: unknown): boolean {
  const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  return /NotAllowedError|Permission/i.test(text);
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const regionId = `scanner-${useId().replace(/:/g, "")}`;
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<CameraError>(null);
  const [torch, setTorch] = useState<TorchCapability | null>(null);
  const [torchOn, setTorchOn] = useState(false);

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

    async function start() {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: Format } = await import("html5-qrcode");
      if (stopped) return;
      scanner = new Html5Qrcode(regionId, {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
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
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: (width, height) => ({
            width: Math.max(50, Math.floor(Math.min(width * 0.85, 420))),
            height: Math.max(50, Math.floor(Math.min(height * 0.45, 240))),
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
      if (stopped) return;

      try {
        await scanner.applyVideoConstraints({
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        });
      } catch {
        // Continuous autofocus is not exposed on every device (iOS focuses on its own).
      }
      try {
        const capability = scanner.getRunningTrackCameraCapabilities().torchFeature();
        if (!stopped && capability.isSupported()) setTorch(capability);
      } catch {
        // No torch control on this device.
      }
    }

    start().catch((cause: unknown) => {
      if (!stopped) setError(isPermissionError(cause) ? "denied" : "failed");
    });

    return () => {
      stopped = true;
      const running = scanner;
      if (running?.isScanning) {
        running
          .stop()
          .then(() => running.clear())
          .catch(() => undefined);
      }
    };
  }, [audio, regionId]);

  const toggleTorch = async () => {
    if (!torch) return;
    try {
      await torch.apply(!torchOn);
      setTorchOn(!torchOn);
    } catch {
      setTorch(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={t.anbar.scan.title}
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
            aria-label={t.anbar.scan.close}
            className="rounded-full bg-white/15 p-3 text-white backdrop-blur"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <p className="text-sm font-medium">{t.anbar.scan.title}</p>
          {torch ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-label={t.anbar.scan.torch}
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
          <div id={regionId} className="w-full" />
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error === "denied" ? t.anbar.scan.denied : t.anbar.scan.failed}
            </p>
          ) : (
            <p className="text-sm text-white/80">{t.anbar.scan.hint}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

type BarcodeScannerProps = {
  onScan: (code: string) => void;
  /** Square camera button without text, for use next to an input. */
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
};

/**
 * Camera barcode/QR scanner (html5-qrcode): full-screen camera, beep and vibration on a hit,
 * torch where the device exposes it. Works in iOS Safari and Android Chrome over HTTPS.
 */
export default function BarcodeScanner({ onScan, iconOnly = false, className, disabled }: BarcodeScannerProps) {
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
      {open && (
        <ScannerOverlay
          audio={audio}
          onClose={() => setOpen(false)}
          onScan={(code) => {
            setOpen(false);
            onScan(code);
          }}
        />
      )}
    </>
  );
}
