import { useCallback, useEffect, useRef, useState } from "react";

export interface RecordedAudio {
  bytes: Uint8Array;
  mime: string;
  durationSec: number;
}

function pickMime(): string {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** Microphone recording via MediaRecorder. The OS asks for microphone permission on first use. */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveStop = useRef<((a: RecordedAudio | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setRecording(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this window.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = async () => {
        const duration = (performance.now() - startedAt.current) / 1000;
        const type = rec.mimeType || mime || "audio/mp4";
        const blob = new Blob(chunks.current, { type });
        cleanup();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        resolveStop.current?.(bytes.length ? { bytes, mime: type, durationSec: duration } : null);
        resolveStop.current = null;
      };
      recorder.current = rec;
      startedAt.current = performance.now();
      rec.start();
      setRecording(true);
      setElapsed(0);
      tick.current = setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 200);
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow FluentLoop in System Settings → Privacy & Security → Microphone."
          : name === "NotFoundError"
            ? "No microphone was found."
            : `Could not start recording: ${e instanceof Error ? e.message : String(e)}`,
      );
      cleanup();
      return false;
    }
  }, [cleanup]);

  const stop = useCallback(
    () =>
      new Promise<RecordedAudio | null>((resolve) => {
        const rec = recorder.current;
        if (!rec || rec.state === "inactive") {
          resolve(null);
          return;
        }
        resolveStop.current = resolve;
        rec.stop();
      }),
    [],
  );

  return { recording, elapsed, error, start, stop };
}
