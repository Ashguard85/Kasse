import jsQR from "jsqr";

export function isCameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function openCameraStream(options = {}) {
  const width = options.width || 640;
  const height = options.height || 480;
  return await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: width },
      height: { ideal: height },
    },
    audio: false,
  });
}

function getBarcodeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    return new BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    try { return new BarcodeDetector(); } catch { return null; }
  }
}

export async function waitForVideoRef(getVideo, timeoutMs = 2500) {
  const start = performance.now();
  return await new Promise((resolve) => {
    const tick = () => {
      const video = getVideo();
      if (video) return resolve(video);
      if (performance.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export async function startQrScanner(video, onCode, options = {}) {
  if (!video) throw new Error("Kamera-Anzeige konnte nicht geöffnet werden.");

  const stream = options.stream || await openCameraStream(options);
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;

  try { await video.play(); } catch {}

  const detector = getBarcodeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let raf = null;
  let stopped = false;
  let detectorBusy = false;

  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    try { stream.getTracks().forEach((track) => track.stop()); } catch {}
    if (video.srcObject === stream) video.srcObject = null;
  };

  const emit = (value) => {
    if (!value || stopped) return;
    stop();
    onCode(String(value));
  };

  const scanWithCanvas = () => {
    const width = video.videoWidth || options.width || 640;
    const height = video.videoHeight || options.height || 480;
    if (!width || !height || !ctx) return false;

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
    if (result?.data) {
      emit(result.data);
      return true;
    }
    return false;
  };

  const loop = async () => {
    if (stopped) return;

    if (video.readyState >= 2) {
      if (detector && !detectorBusy) {
        detectorBusy = true;
        try {
          const codes = await detector.detect(video);
          if (codes?.length > 0) {
            emit(codes[0].rawValue || codes[0].rawData || "");
            detectorBusy = false;
            return;
          }
        } catch {
          // Fallback unten übernimmt.
        } finally {
          detectorBusy = false;
        }
      }

      try { if (scanWithCanvas()) return; } catch {}
    }

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
  return stop;
}
