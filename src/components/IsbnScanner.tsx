"use client";

import { useEffect, useRef, useState } from "react";
import { cleanIsbn, isValidIsbn } from "@/lib/isbn";

type Props = {
  onDetected: (isbn: string) => void;
  onClose: () => void;
};

// BarcodeDetector is not in the TS DOM lib yet.
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

export default function IsbnScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const doneRef = useRef(false);
  const [status, setStatus] = useState("Point the camera at the barcode on the back cover");
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const secure = typeof window !== "undefined" && window.isSecureContext;
    const hasCam = !!navigator.mediaDevices?.getUserMedia;
    const Detector = typeof window !== "undefined" ? window.BarcodeDetector : undefined;

    if (!secure) {
      setFatal(
        "The camera needs a secure (HTTPS) connection. Start the server with `npm run dev:https` and accept the certificate warning on your phone — or just type the ISBN and tap Look up.",
      );
      return;
    }
    if (!hasCam) {
      setFatal("This browser has no camera access. Type the ISBN and tap Look up instead.");
      return;
    }
    if (!Detector) {
      setFatal(
        "This browser can't decode barcodes (no BarcodeDetector). Chrome on Android works. Otherwise type the ISBN and tap Look up.",
      );
      return;
    }

    const detector = new Detector({ formats: ["ean_13"] });

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        tick(detector);
      } catch (err) {
        setFatal(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow it in the browser's site settings, or type the ISBN and tap Look up."
            : "Could not start the camera. Type the ISBN and tap Look up instead.",
        );
      }
    })();

    return () => {
      doneRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tick(detector: { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }) {
    const video = videoRef.current;
    if (doneRef.current || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => tick(detector));
      return;
    }
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const isbn = cleanIsbn(c.rawValue);
        if (isValidIsbn(isbn)) {
          doneRef.current = true;
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          streamRef.current?.getTracks().forEach((t) => t.stop());
          if (navigator.vibrate) navigator.vibrate(60);
          setStatus("Found " + isbn);
          onDetected(isbn);
          return;
        }
      }
    } catch {
      /* transient decode error — keep scanning */
    }
    rafRef.current = requestAnimationFrame(() => tick(detector));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">Scan ISBN</span>
        <button onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>

      {fatal ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-white/80">{fatal}</p>
          <button onClick={onClose} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">
            OK
          </button>
        </div>
      ) : (
        <div className="relative flex-1">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {/* Framing guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-28 w-4/5 max-w-sm rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <p className="absolute inset-x-0 bottom-8 text-center text-sm text-white/90">{status}</p>
        </div>
      )}
    </div>
  );
}
