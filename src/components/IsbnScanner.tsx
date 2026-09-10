"use client";

import { useEffect, useRef, useState } from "react";
import { cleanIsbn, isValidIsbn } from "@/lib/isbn";

type Props = {
  onDetected: (isbn: string) => void;
  onClose: () => void;
};

type Controls = { stop: () => void; switchTorch?: (on: boolean) => Promise<void> };
type StillReader = { decodeFromImageUrl: (url: string) => Promise<{ getText: () => string }> };

export default function IsbnScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<Controls | null>(null);
  const stillReaderRef = useRef<StillReader | null>(null);
  const doneRef = useRef(false);

  const [status, setStatus] = useState("Starting camera…");
  const [fatal, setFatal] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [busy, setBusy] = useState(false);
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

        stillReaderRef.current = new BrowserMultiFormatReader(hints) as unknown as StillReader;

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 150,
          delayBetweenScanSuccess: 500,
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
        setStatus("Line the barcode up in the box, then tap “Capture & read”");

        const controls = (await reader.decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result) => {
            if (doneRef.current || !result) return;
            handleText(result.getText());
          },
        )) as unknown as Controls;
        controlsRef.current = controls;

        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (caps?.torch || typeof controls.switchTorch === "function") setCanTorch(true);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setFatal(
          name === "NotAllowedError"
            ? "Camera permission was denied. Tap the padlock in the address bar → Site settings → Camera → Allow, then reopen the scanner. Or type the ISBN below."
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

  function finish(isbn: string) {
    doneRef.current = true;
    controlsRef.current?.stop();
    if (navigator.vibrate) navigator.vibrate(60);
    setStatus(`Found ${isbn}`);
    onDetected(isbn);
  }

  function handleText(raw: string): boolean {
    const isbn = cleanIsbn(raw);
    if (isValidIsbn(isbn)) {
      finish(isbn);
      return true;
    }
    setStatus(`Read "${raw}" — that is not an ISBN. Try again.`);
    return false;
  }

  async function decodeUrl(url: string): Promise<boolean> {
    const reader = stillReaderRef.current;
    if (!reader) return false;
    try {
      const res = await reader.decodeFromImageUrl(url);
      return handleText(res.getText());
    } catch {
      return false;
    }
  }

  /** Grab the current frame and decode it — the explicit "shutter" action. */
  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy || doneRef.current) return;
    setBusy(true);
    setStatus("Reading…");
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 1) Centre band, magnified 2x (mimics the guide box, helps small barcodes).
      const cw = Math.round(vw * 0.92);
      const ch = Math.round(vh * 0.4);
      const sx = Math.round((vw - cw) / 2);
      const sy = Math.round((vh - ch) / 2);
      canvas.width = cw * 2;
      canvas.height = ch * 2;
      ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
      if (await decodeUrl(canvas.toDataURL("image/png"))) return;

      // 2) Whole frame as a fallback.
      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(video, 0, 0, vw, vh);
      if (await decodeUrl(canvas.toDataURL("image/png"))) return;

      setStatus("Couldn't read it. Fill the box with the barcode, hold steady, add light, and tap again.");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy || doneRef.current) return;
    setBusy(true);
    setStatus("Reading photo…");
    const url = URL.createObjectURL(file);
    try {
      if (!(await decodeUrl(url))) {
        setStatus("No barcode found in that photo. Get closer so the barcode is sharp and fills the frame.");
      }
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

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
    if (isValidIsbn(isbn)) finish(isbn);
    else setStatus("That is not a valid ISBN-10 or ISBN-13");
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
            <div className="h-2/5 w-11/12 max-w-sm rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <p className="absolute inset-x-0 bottom-3 px-4 text-center text-sm text-white/90">{status}</p>
        </div>
      )}

      {fatal && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-white/80">{fatal}</p>
        </div>
      )}

      <div className="safe-bottom space-y-3 border-t border-white/15 px-4 pt-3">
        {!fatal && (
          <div className="flex gap-2">
            <button
              onClick={capture}
              disabled={busy}
              className="flex-1 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? "Reading…" : "Capture & read"}
            </button>
            <label className="rounded-lg bg-white/15 px-4 py-3 text-center text-sm font-medium">
              Photo
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
            </label>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-white/60">Or type the ISBN</label>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="numeric"
              placeholder="978…"
              className="flex-1 rounded-lg bg-white/10 px-3 py-3 text-base outline-none placeholder:text-white/40"
            />
            <button onClick={submitManual} className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black">
              Use
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
