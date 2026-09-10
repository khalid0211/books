"use client";

import { useEffect, useRef, useState } from "react";
import { cleanIsbn, isValidIsbn } from "@/lib/isbn";

type Props = {
  onDetected: (isbn: string) => void;
  onClose: () => void;
};

type Controls = { stop: () => void; switchTorch?: (on: boolean) => Promise<void> };

export default function IsbnScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<Controls | null>(null);
  const doneRef = useRef(false);

  const [status, setStatus] = useState("Starting camera…");
  const [fatal, setFatal] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [manual, setManual] = useState("");

  useEffect(() => {
    const secure = typeof window !== "undefined" && window.isSecureContext;
    const hasCam = !!navigator.mediaDevices?.getUserMedia;

    if (!secure) {
      setFatal(
        "The camera needs a secure (HTTPS) connection. Start the server with `npm run dev:https` and open the https:// address on your phone — or type the ISBN below.",
      );
      return;
    }
    if (!hasCam) {
      setFatal("This browser can't reach the camera. Type the ISBN below instead.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 400,
        });

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // @ts-expect-error focusMode is not in the TS lib yet
            advanced: [{ focusMode: "continuous" }],
          },
        };

        if (cancelled) return;
        setStatus("Point at the barcode on the back cover");

        const controls = (await reader.decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result, _err, ctrl) => {
            if (doneRef.current || !result) return;
            const raw = result.getText();
            const isbn = cleanIsbn(raw);
            if (!isValidIsbn(isbn)) {
              setStatus(`Read ${raw || "a barcode"} — not an ISBN, keep trying`);
              return;
            }
            doneRef.current = true;
            ctrl.stop();
            if (navigator.vibrate) navigator.vibrate(60);
            setStatus(`Found ${isbn}`);
            onDetected(isbn);
          },
        )) as unknown as Controls;

        controlsRef.current = controls;

        // Torch capability?
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (caps?.torch || typeof controls.switchTorch === "function") setCanTorch(true);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setFatal(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow it in the browser's site settings (tap the lock icon in the address bar), then reopen the scanner. Or type the ISBN below."
            : name === "NotFoundError"
              ? "No camera was found on this device. Type the ISBN below."
              : "Could not start the camera. Type the ISBN below instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      doneRef.current = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleTorch() {
    try {
      const next = !torchOn;
      await controlsRef.current?.switchTorch?.(next);
      setTorchOn(next);
    } catch {
      setCanTorch(false);
    }
  }

  function submitManual() {
    const isbn = cleanIsbn(manual);
    if (isValidIsbn(isbn)) {
      doneRef.current = true;
      controlsRef.current?.stop();
      onDetected(isbn);
    } else {
      setStatus("That is not a valid ISBN-10 or ISBN-13");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">Scan ISBN</span>
        <div className="flex items-center gap-2">
          {canTorch && (
            <button
              onClick={toggleTorch}
              className={`rounded-lg px-3 py-1.5 text-sm ${torchOn ? "bg-amber-400 text-black" : "bg-white/15"}`}
            >
              {torchOn ? "Torch on" : "Torch"}
            </button>
          )}
          <button onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
      </div>

      {!fatal && (
        <div className="relative flex-1">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-11/12 max-w-sm rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <p className="absolute inset-x-0 top-2 text-center text-xs text-white/80">
            Hold 15–20&nbsp;cm away · steady · good light
          </p>
          <p className="absolute inset-x-0 bottom-3 px-4 text-center text-sm text-white/90">{status}</p>
        </div>
      )}

      {fatal && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-white/80">{fatal}</p>
        </div>
      )}

      {/* Always-available manual entry */}
      <div className="safe-bottom border-t border-white/15 px-4 pt-3">
        <label className="mb-1 block text-xs text-white/60">Or type the ISBN</label>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            inputMode="numeric"
            placeholder="978…"
            className="flex-1 rounded-lg bg-white/10 px-3 py-3 text-base outline-none placeholder:text-white/40"
          />
          <button
            onClick={submitManual}
            className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black"
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
