'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * In-browser camera barcode/QR scanner.
 * Uses the browser's built-in BarcodeDetector (Chrome/Edge on Android & desktop).
 * <CameraScanner onScan={(text) => ...} onClose={() => ...} />
 */
export default function CameraScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const stopRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // always call the latest handler without restarting the camera
  const [error, setError] = useState('');

  useEffect(() => {
    let stream;
    stopRef.current = false;

    async function start() {
      // Camera needs a secure context (HTTPS or localhost)
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          window.isSecureContext === false
            ? 'The camera is blocked on plain HTTP. On the phone open chrome://flags, search "Insecure origins treated as secure", add this site address, relaunch Chrome — or type the code manually.'
            : 'This browser cannot access the camera. Type the code manually.'
        );
        return;
      }
      if (!('BarcodeDetector' in window)) {
        setError('This browser has no built-in barcode reader. Use Chrome on Android, or type the code manually.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, // back camera
          audio: false,
        });
        // The component may have been unmounted/remounted while the camera
        // was being opened (React does this in development) — bail out cleanly
        if (stopRef.current || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          // play() interrupted by an unmount — not a real failure, just stop quietly
          if (stopRef.current || playErr.name === 'AbortError') return;
          throw playErr;
        }
        if (stopRef.current) return;

        const detector = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'data_matrix'],
        });

        const tick = async () => {
          if (stopRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length && codes[0].rawValue) {
              stopRef.current = true;
              if (navigator.vibrate) navigator.vibrate(80); // little buzz on success
              onScanRef.current(codes[0].rawValue.trim());
              return;
            }
          } catch { /* frame not ready yet */ }
          setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        setError(
          e.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow the camera for this site and try again.'
            : `Camera error: ${e.message}`
        );
      }
    }

    start();
    return () => {
      stopRef.current = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []); // camera starts once per open — never restarted by re-renders

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-white font-bold">📷 Point the camera at the label</p>
        <button onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/15 text-white font-bold text-lg">✕</button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-white/90 text-sm px-8 text-center leading-relaxed">{error}</p>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            {/* Aiming frame */}
            <div className="relative w-64 h-64 pointer-events-none">
              <div className="absolute -top-0.5 -left-0.5 w-10 h-10 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
              <div className="absolute -top-0.5 -right-0.5 w-10 h-10 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
              <div className="absolute -bottom-0.5 -left-0.5 w-10 h-10 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
              <div className="absolute -bottom-0.5 -right-0.5 w-10 h-10 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
            </div>
          </>
        )}
      </div>

      <p className="text-white/50 text-xs text-center pb-6 px-6">
        The code fills in automatically the moment it&apos;s recognized.
      </p>
    </div>
  );
}
