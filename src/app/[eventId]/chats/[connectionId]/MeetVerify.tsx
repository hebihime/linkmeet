"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  confirmMeetScan,
  markMet,
  mintMeetToken,
  type MeetCoords,
  type MetState,
} from "@/lib/actions";

// Best-effort GPS: a confidence signal, never a requirement — permission
// denied or a slow fix just means a QR-only (lower-confidence) verify.
function getCoords(): Promise<MeetCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve(null);
    const timer = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 30000 },
    );
  });
}

type Mode = "menu" | "show" | "scan" | "done";

export default function MeetVerify({
  connectionId,
  otherName,
  onMet,
  onClose,
}: {
  connectionId: string;
  otherName: string;
  onMet: (met: MetState) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const firstName = otherName.split(" ")[0];

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // ---- Show my code ---------------------------------------------------------
  const showCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    setMode("show");
    const coords = await getCoords();
    const res = await mintMeetToken(connectionId, coords);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      setMode("menu");
      return;
    }
    if (res.autoConfirmed) {
      // Test-user counterparty: the scan is simulated server-side.
      onMet(res.autoConfirmed);
      setMode("done");
      return;
    }
    setQrDataUrl(
      await QRCode.toDataURL(res.token, { width: 560, margin: 1 }),
    );
    setSecondsLeft(res.ttlSeconds);
  }, [connectionId, onMet]);

  // Countdown + auto-refresh while showing: the other side's scan confirms;
  // we just keep a fresh token on screen.
  useEffect(() => {
    if (mode !== "show" || !qrDataUrl) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) showCode();
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, qrDataUrl, showCode]);

  // ---- Scan their code ------------------------------------------------------
  async function handleDecoded(text: string) {
    if (!scanningRef.current) return;
    scanningRef.current = false;
    stopCamera();
    setBusy(true);
    const coords = await getCoords();
    const res = await confirmMeetScan(text, coords);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      setMode("menu");
      return;
    }
    onMet(res.met);
    setMode("done");
  }

  const startScan = useCallback(async () => {
    setError(null);
    setMode("scan");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      scanningRef.current = true;

      // BarcodeDetector where the browser has it; jsQR canvas frames elsewhere
      // (iOS Safari). Both feed the same confirm path.
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      const detector = Detector
        ? new Detector({ formats: ["qr_code"] })
        : null;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        const v = videoRef.current;
        if (v.readyState >= 2) {
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes[0]?.rawValue) return handleDecoded(codes[0].rawValue);
            } else if (ctx) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, {
                inversionAttempts: "dontInvert",
              });
              if (code?.data) return handleDecoded(code.data);
            }
          } catch {
            // transient decode failure — keep scanning
          }
        }
        setTimeout(tick, 120);
      };
      tick();
    } catch {
      setError(
        "Couldn't open the camera. Allow camera access, or show your code instead.",
      );
      setMode("menu");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Soft fallback — the honor tap. Grants nothing (no ratings, no reputation).
  async function softMet() {
    setBusy(true);
    const state = await markMet(connectionId);
    setBusy(false);
    if (state) onMet(state);
    onClose();
  }

  function backToMenu() {
    stopCamera();
    setQrDataUrl(null);
    setMode("menu");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border border-neutral-800 bg-neutral-950 px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {mode === "done" ? "Verified! 🎉" : `Met ${firstName}?`}
          </h2>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {mode === "menu" && (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-sm text-neutral-400">
              Verify it in person — one of you shows a code, the other scans
              it. Verified meets unlock ratings.
            </p>
            <button
              onClick={showCode}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 font-semibold text-white transition hover:brightness-110"
            >
              Show my code
            </button>
            <button
              onClick={startScan}
              className="rounded-full border border-neutral-700 px-6 py-3 font-semibold text-white transition hover:bg-neutral-900"
            >
              Scan {firstName}&apos;s code
            </button>
            <button
              onClick={softMet}
              disabled={busy}
              className="pt-1 text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              Can&apos;t scan right now? Mark as met without verifying
            </button>
          </div>
        )}

        {mode === "show" && (
          <div className="flex flex-col items-center gap-3 pb-2">
            {qrDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="Your verification code"
                  className="h-64 w-64 rounded-2xl bg-white p-2"
                />
                <p className="text-center text-sm text-neutral-400">
                  Have {firstName} scan this. Refreshes in {secondsLeft}s.
                </p>
              </>
            ) : (
              <p className="py-16 text-sm text-neutral-400">
                {busy ? "Getting your code…" : ""}
              </p>
            )}
            <button
              onClick={backToMenu}
              className="text-sm text-neutral-400 hover:text-white"
            >
              Back
            </button>
          </div>
        )}

        {mode === "scan" && (
          <div className="flex flex-col items-center gap-3 pb-2">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-square w-64 rounded-2xl border border-neutral-800 object-cover"
            />
            <p className="text-sm text-neutral-400">
              {busy ? "Confirming…" : `Point at ${firstName}'s code`}
            </p>
            <button
              onClick={backToMenu}
              className="text-sm text-neutral-400 hover:text-white"
            >
              Back
            </button>
          </div>
        )}

        {mode === "done" && (
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <p className="text-sm text-neutral-300">
              You and {firstName} verified you met in person — that&apos;s the
              whole point. You can now rate the meet.
            </p>
            <button
              onClick={onClose}
              className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
