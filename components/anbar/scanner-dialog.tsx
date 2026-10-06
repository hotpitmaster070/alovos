"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/useT";

const DETECT_INTERVAL_MS = 250;

type ScannerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (value: string) => void;
};

type CameraError = "denied" | "failed" | null;

function CameraView({ onDetected }: { onDetected: (value: string) => void }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(onDetected);
  const [error, setError] = useState<CameraError>(null);

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new BarcodeDetector();
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value && !cancelled) detectedRef.current(value);
          } catch {
            // A frame that cannot be analysed is skipped; scanning continues.
          }
        }, DETECT_INTERVAL_MS);
      } catch (cause) {
        const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
        if (!cancelled) setError(denied ? "denied" : "failed");
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={videoRef}
        muted
        playsInline
        className="aspect-[4/3] w-full rounded-[12px] border border-line bg-black object-cover"
      />
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error === "denied" ? t.anbar.scan.denied : t.anbar.scan.failed}
        </p>
      ) : (
        <p className="text-xs text-white/50">{t.anbar.scan.hint}</p>
      )}
    </div>
  );
}

export default function ScannerDialog({ open, onOpenChange, onDetected }: ScannerDialogProps) {
  const { t } = useT();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.anbar.scan.title}
      closeLabel={t.anbar.scan.close}
    >
      <CameraView onDetected={onDetected} />
    </Dialog>
  );
}
