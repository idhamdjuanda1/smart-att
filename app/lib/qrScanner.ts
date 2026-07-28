type NativeBarcode = { rawValue?: string };

type NativeBarcodeDetector = {
  detect(source: HTMLVideoElement): Promise<NativeBarcode[]>;
};

type NativeBarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => NativeBarcodeDetector;

export type QrScannerControls = {
  engine: "native" | "zxing" | "jsqr";
  stop: () => void;
};

type StartQrScannerOptions = {
  video: HTMLVideoElement;
  stream: MediaStream;
  onResult: (value: string) => void | Promise<void>;
  intervalMs?: number;
};

export function isAppleMobileBrowser(userAgent: string, maxTouchPoints = 0) {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function selectPreferredCameraDeviceId(
  devices: Array<{ deviceId: string; label: string }>,
  facingMode: "user" | "environment",
) {
  const scored = devices.map((device) => {
    const label = device.label.toLowerCase();
    const isFront = /(front|user|depan|facetime)/.test(label);
    const isBack = /(back|rear|environment|belakang)/.test(label);
    if (facingMode === "user") {
      return { id: device.deviceId, score: isFront ? 100 : isBack ? -100 : 0 };
    }
    if (!isBack) return { id: device.deviceId, score: isFront ? -100 : 0 };

    let score = 100;
    // Prefer the normal 1×/wide camera used for close-range document scanning.
    if (/(back|rear|belakang)\s+camera$/.test(label)) score += 100;
    if (/(wide angle|wide camera|1x)/.test(label)) score += 60;
    if (/(ultra[\s-]?wide|0[.,]5x)/.test(label)) score -= 180;
    if (/(telephoto|tele camera|3x)/.test(label)) score -= 140;
    if (/(dual|triple)/.test(label)) score -= 20;
    return { id: device.deviceId, score };
  }).filter((item) => item.id);

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.score > 0 ? scored[0].id : "";
}

async function optimizeAppleCameraTrack(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try { track.contentHint = "detail"; } catch {}
  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
      zoom?: { min: number; max: number; step?: number };
    };
    const advanced: Record<string, string | number> = {};
    if (capabilities.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
    if (capabilities.zoom && capabilities.zoom.min <= 1 && capabilities.zoom.max >= 1) {
      advanced.zoom = 1;
    }
    if (Object.keys(advanced).length) {
      await track.applyConstraints({
        advanced: [advanced],
      } as unknown as MediaTrackConstraints);
    }
  } catch {
    // Lens capabilities differ between iOS versions; scanning can continue.
  }
}

/**
 * Starts a QR decoder without opening a second camera stream.
 * BarcodeDetector is the fast path; ZXing keeps scanning available on iOS
 * browsers where the native BarcodeDetector API is not exposed.
 */
export async function startQrScanner({
  video,
  stream,
  onResult,
  intervalMs = 450,
}: StartQrScannerOptions): Promise<QrScannerControls> {
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "true");

  const Detector = (window as typeof window & {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }).BarcodeDetector;
  const appleMobile = isAppleMobileBrowser(
    window.navigator.userAgent,
    window.navigator.maxTouchPoints,
  );
  if (appleMobile) await optimizeAppleCameraTrack(stream);
  const useNativeDetector = Boolean(Detector) && !appleMobile;

  if (Detector && useNativeDetector) {
    const detector = new Detector({ formats: ["qr_code"] });
    let stopped = false;
    let detecting = false;
    const timer = window.setInterval(async () => {
      if (stopped || detecting || video.readyState < 2) return;
      detecting = true;
      try {
        const codes = await detector.detect(video);
        const value = codes.find((code) => code.rawValue?.trim())?.rawValue?.trim();
        if (value) void onResult(value);
      } catch {
        // A frame can fail while the camera is focusing. Keep scanning.
      } finally {
        detecting = false;
      }
    }, intervalMs);

    return {
      engine: "native",
      stop: () => {
        stopped = true;
        window.clearInterval(timer);
      },
    };
  }

  if (appleMobile) {
    const { default: jsQR } = await import("jsqr");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas-unavailable");

    let stopped = false;
    let timer: number | null = null;
    let attempt = 0;

    const decodeFrame = () => {
      if (stopped) return;
      try {
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (video.readyState >= 2 && sourceWidth > 0 && sourceHeight > 0) {
          // Alternate between the complete image and an enlarged centre crop.
          // This helps multi-lens iPhones read smaller printed QR cards.
          const cropRatio = attempt++ % 2 === 0 ? 1 : 0.72;
          const cropWidth = Math.max(1, Math.floor(sourceWidth * cropRatio));
          const cropHeight = Math.max(1, Math.floor(sourceHeight * cropRatio));
          const sourceX = Math.floor((sourceWidth - cropWidth) / 2);
          const sourceY = Math.floor((sourceHeight - cropHeight) / 2);
          const scale = Math.min(1, 1280 / cropWidth);
          const targetWidth = Math.max(1, Math.floor(cropWidth * scale));
          const targetHeight = Math.max(1, Math.floor(cropHeight * scale));

          if (canvas.width !== targetWidth) canvas.width = targetWidth;
          if (canvas.height !== targetHeight) canvas.height = targetHeight;
          context.drawImage(
            video,
            sourceX,
            sourceY,
            cropWidth,
            cropHeight,
            0,
            0,
            targetWidth,
            targetHeight,
          );
          const image = context.getImageData(0, 0, targetWidth, targetHeight);
          const result = jsQR(image.data, targetWidth, targetHeight, {
            inversionAttempts: "attemptBoth",
          });
          const value = result?.data.trim();
          if (value) void onResult(value);
        }
      } catch {
        // Safari can briefly reject a frame while switching lenses or focusing.
      } finally {
        if (!stopped) timer = window.setTimeout(decodeFrame, intervalMs);
      }
    };

    timer = window.setTimeout(decodeFrame, 80);
    return {
      engine: "jsqr",
      stop: () => {
        stopped = true;
        if (timer !== null) window.clearTimeout(timer);
      },
    };
  }

  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: intervalMs,
    delayBetweenScanSuccess: intervalMs,
  });
  const controls = await reader.decodeFromStream(stream, video, (result) => {
    const value = result?.getText().trim();
    if (value) void onResult(value);
  });

  return {
    engine: "zxing",
    stop: () => controls.stop(),
  };
}
