"use client";

import { useEffect, useRef, useState } from "react";
import { cleanIsbn, isValidIsbn } from "@/lib/isbn";
import { stopScanner } from "@/lib/stop-scanner";

type Props = {
  onDetected: (isbn: string) => void;
  onClose: () => void;
};

type Controls = { stop: () => void; switchTorch?: (on: boolean) => Promise<void> };
type StillReader = { decodeFromImageUrl: (url: string) => Promise<{ getText: () => string }> };

/** `zoom` isn't in the TS MediaTrack types yet. */
function zoomConstraint(z: number): MediaTrackConstraints {
  return { advanced: [{ zoom: z }] } as unknown as MediaTrackConstraints;
}

export default function IsbnScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<Controls | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const stillReaderRef = useRef<StillReader | null>(null);
  const doneRef = useRef(false);

  const [status, setStatus] = useState("Starting camera…");
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");

  useEffect(() => {
    // Strict Mode runs setup → cleanup → setup with the same refs.
    doneRef.current = false;
    const secure = typeof window !== "undefined" && window.isSecureContext;
    const hasCam = !!navigator.mediaDevices?.getUserMedia;
    if (!secure) {
      setFatal("The camera needs an HTTPS connection. Run `npm run dev:https` and open the https:// address — or type the ISBN below.");
      return;
    }
    if (!hasCam) {
      setFatal("This browser can't reach the camera. Type the ISBN below.");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let sessionControls: Controls | null = null;

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled) return;

        const still = new Map();
        still.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        still.set(DecodeHintType.TRY_HARDER, true);
        stillReaderRef.current = new BrowserMultiFormatReader(still) as unknown as StillReader;

        // TRY_HARDER also checks more rows and rotated barcodes.
        const live = new Map();
        live.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
        live.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(live, { delayBetweenScanAttempts: 250 });

        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled || doneRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const controls = await reader.decodeFromStream(
          stream,
          videoRef.current!,
          (result) => {
            if (!cancelled && !doneRef.current && result) handleText(result.getText());
          },
        );
        sessionControls = controls;
        if (cancelled || doneRef.current) {
          stopScanner(controls);
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        controlsRef.current = controls;

        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks?.()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as {
          torch?: boolean;
          zoom?: { min: number; max: number; step?: number };
        };
        if (caps.torch || typeof controls.switchTorch === "function") setCanTorch(true);
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          const start = track?.getSettings().zoom ?? caps.zoom.min;
          setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
          setZoom(start);
        }
        setReady(true);
        setStatus("Scanning automatically… Keep the whole barcode sharp and level, or tap “Scan now”.");
      } catch (err) {
        stopScanner(sessionControls);
        stream?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setFatal(
          name === "NotAllowedError"
            ? "Camera permission denied. Tap the padlock → Site settings → Camera → Allow, then reopen. Or type the ISBN below."
            : name === "NotFoundError"
              ? "No camera found on this device. Type the ISBN below."
              : `Could not start the camera (${(err as Error)?.message || name || "unknown"}). Type the ISBN below.`,
        );
      }
    })();

    return () => {
      cancelled = true;
      doneRef.current = true;
      stopScanner(sessionControls);
      stream?.getTracks().forEach((track) => track.stop());
      controlsRef.current = null;
      trackRef.current = null;
      stillReaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(isbn: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    stopScanner(controlsRef.current);
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
    setStatus(`Read "${raw}" — not an ISBN. Try again.`);
    return false;
  }

  async function decodeUrl(url: string): Promise<boolean> {
    const reader = stillReaderRef.current;
    if (!reader) return false;
    try {
      const res = await reader.decodeFromImageUrl(url);
      if (doneRef.current || stillReaderRef.current !== reader) return true;
      return handleText(res.getText());
    } catch {
      return false; // NotFoundException — no barcode in this image
    }
  }

  function frameToUrl(cropFactor: number): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = Math.round(vw * cropFactor);
    const ch = Math.round(vh * cropFactor);
    const sx = Math.round((vw - cw) / 2);
    const sy = Math.round((vh - ch) / 2);
    const scale = Math.min(2, 1600 / Math.max(cw, ch));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(ch * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  }

  async function capture() {
    if (!ready || busy || doneRef.current) return;
    setBusy(true);
    setStatus("Reading…");
    try {
      for (const factor of [0.55, 0.8, 1]) {
        const url = frameToUrl(factor);
        if (url && (await decodeUrl(url))) return;
      }
      if (!doneRef.current) setStatus("No ISBN found. Keep all the bars in view, move back if blurry, add light, and tap Scan now again.");
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
      if (!(await decodeUrl(url)) && !doneRef.current) {
        setStatus("No barcode found in that photo. Retake it closer, with the barcode sharp and level.");
      }
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  async function changeZoom(v: number) {
    setZoom(v);
    try {
      await trackRef.current?.applyConstraints(zoomConstraint(v));
    } catch {
      /* ignore */
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
    <div role="dialog" aria-modal="true" aria-label="Scan ISBN" className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col overflow-y-auto bg-black text-white">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">Scan ISBN {ready || fatal ? "" : "· loading…"}</span>
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
        <div className="relative min-h-32 flex-1 bg-black">
          <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/3 w-11/12 max-w-sm rounded-lg border-2 border-white/80" />
          </div>
        </div>
      )}

      {fatal && (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-sm text-white/80">{fatal}</p>
        </div>
      )}

      <div className="safe-bottom shrink-0 space-y-3 border-t border-white/15 px-4 pt-3">
        <p role="status" className="text-center text-sm text-white/90">{fatal ? "Enter the ISBN below to look up the book." : status}</p>
        {!fatal && zoomRange && zoom !== null && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">Zoom</span>
            <input
              type="range"
              min={zoomRange.min}
              max={zoomRange.max}
              step={zoomRange.step}
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="flex-1"
            />
          </div>
        )}
        {!fatal && (
          <div className="flex gap-2">
            <button
              onClick={capture}
              disabled={!ready || busy}
              className="flex-1 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? "Reading…" : "Scan now"}
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
              className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-3 text-base outline-none placeholder:text-white/40"
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
