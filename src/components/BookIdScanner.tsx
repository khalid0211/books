"use client";
import { useEffect, useRef, useState } from "react";
import { parseBookId } from "@/lib/book-id";
import { stopScanner } from "@/lib/stop-scanner";

export default function BookIdScanner({ onDetected, onClose }: { onDetected: (id: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const photoReader = useRef<((url: string) => Promise<void>) | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [status, setStatus] = useState("Starting camera…");
  useEffect(() => {
    let cancelled = false;
    let done = false;
    let stream: MediaStream | undefined;
    let controls: { stop: () => void } | undefined;
    async function start() {
      try {
        if (!window.isSecureContext) throw new Error("Open the app using HTTPS to scan, or close this screen and enter the book ID manually.");
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (cancelled) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        const stillReader = new BrowserMultiFormatReader(hints);
        function accept(raw: string) {
          if (cancelled || done) return;
          raw = raw.trim();
          if (!/^B\d+$/i.test(raw) || !parseBookId(raw)) { setStatus("Scan a library book ID such as B000123."); return; }
          done = true;
          stopScanner(controls);
          stream?.getTracks().forEach((track) => track.stop());
          onDetected(raw);
        }
        photoReader.current = async (url) => {
          try { accept((await stillReader.decodeFromImageUrl(url)).getText()); }
          catch { if (!cancelled && !done) setStatus("No barcode found. Take a sharp photo of the complete barcode with white space at both ends."); }
        };
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 },
        } });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step?: number } }) | undefined;
        if (caps?.focusMode?.includes("continuous")) {
          try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints); } catch { /* Keep the camera's default focus if unsupported. */ }
        }
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
          setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
          setZoom(track.getSettings().zoom ?? caps.zoom.min);
        }
        setStatus("Keep the complete barcode sharp and level, with white space at both ends. Move back if blurry; use zoom or Photo for a small label.");
        controls = await reader.decodeFromStream(stream, video.current!, (result) => {
          if (result) accept(result.getText());
        });
        if (cancelled || done) stopScanner(controls);
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Could not open the camera. Enter the ID manually.");
      }
    }
    void start();
    return () => { cancelled = true; photoReader.current = null; trackRef.current = null; stopScanner(controls); stream?.getTracks().forEach((track) => track.stop()); };
  }, [onDetected]);
  async function readPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const read = photoReader.current;
    if (!file || !read || readingPhoto) return;
    setReadingPhoto(true); setStatus("Reading photo…");
    const url = URL.createObjectURL(file);
    try { await read(url); }
    finally { URL.revokeObjectURL(url); setReadingPhoto(false); }
  }
  async function changeZoom(value: number) {
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints);
      setZoom(value);
    } catch { setStatus("Camera zoom is unavailable. Move the label into focus or use Photo."); }
  }
  return <div role="dialog" aria-modal="true" aria-label="Scan book ID" className="fixed inset-0 z-50 flex flex-col bg-black p-4 text-white">
    <div className="flex items-center justify-between"><h2>Scan book ID</h2><button autoFocus onClick={onClose} className="rounded-lg bg-white/20 px-4 py-3">Close</button></div>
    <video ref={video} autoPlay playsInline muted className="min-h-0 flex-1 object-contain" />
    {zoomRange && <label className="flex shrink-0 items-center gap-3 py-3">Zoom<input aria-label="Camera zoom" type="range" className="flex-1" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={zoom} onChange={(event) => void changeZoom(Number(event.target.value))} /></label>}
    <label className="shrink-0 rounded-lg bg-white/20 px-4 py-3 text-center">{readingPhoto ? "Reading photo…" : "Photo — take or choose a barcode image"}<input aria-label="Scan book barcode from photo" type="file" accept="image/*" capture="environment" disabled={readingPhoto} onChange={readPhoto} className="sr-only" /></label>
    <p role="status" className="py-5 text-center">{status}</p>
  </div>;
}

