type ScannerControls = { stop: () => void | Promise<void> };
const stopped = new WeakSet<ScannerControls>();

/** ZXing may reject when resetting the torch after it has released the camera. */
export function stopScanner(controls: ScannerControls | null | undefined) {
  if (!controls || stopped.has(controls)) return;
  stopped.add(controls);
  try {
    // The installed library types say void, but torch-capable cameras return a promise.
    void Promise.resolve(controls.stop()).catch(() => {
      // Decoding and camera release occur before the optional torch reset.
    });
  } catch {
    // Cleanup must remain safe during unmount and repeated stop requests.
  }
}
