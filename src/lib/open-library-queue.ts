// Shared by all lookup requests in this server process, including PC and phone.
// Keep the queue across development hot reloads.
const shared = globalThis as typeof globalThis & {
  openLibraryQueue?: Promise<void>;
};

export function queueOpenLibrary<T>(request: () => Promise<T>): Promise<T> {
  const result = (shared.openLibraryQueue ?? Promise.resolve()).then(request);
  // Leave a full second after each completed request, even when it fails.
  // The caller receives its result immediately; only the next request waits.
  shared.openLibraryQueue = result.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  );
  return result;
}
