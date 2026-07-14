export type PhotoAspect = "3:4" | "4:3";

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Foto gagal diproses.")), "image/webp", quality));
}

async function compressCanvas(canvas: HTMLCanvasElement, maxBytes: number, minimumQuality: number) {
  let working = canvas;
  let quality = 0.84;
  let blob = await canvasBlob(working, quality);
  while (blob.size > maxBytes && quality > minimumQuality) {
    quality = Math.max(minimumQuality, quality - 0.08);
    blob = await canvasBlob(working, quality);
  }
  while (blob.size > maxBytes && working.width > 320 && working.height > 320) {
    const reduced = document.createElement("canvas");
    const scale = Math.max(0.82, 320 / Math.min(working.width, working.height));
    reduced.width = Math.round(working.width * scale);
    reduced.height = Math.round(working.height * scale);
    const context = reduced.getContext("2d");
    if (!context) break;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(working, 0, 0, reduced.width, reduced.height);
    working = reduced;
    blob = await canvasBlob(working, minimumQuality);
  }
  if (blob.size > maxBytes) throw new Error(`Foto belum dapat diperkecil di bawah ${Math.ceil(maxBytes / 1024)} KB.`);
  return blob;
}

export function loadPhoto(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Foto tidak dapat dibaca.")); };
    image.src = url;
  });
}

export async function resizeStudentPhoto(file: File, maxBytes = 350 * 1024) {
  const image = await loadPhoto(file);
  const maxWidth = image.width >= image.height ? 1600 : 1200;
  const maxHeight = image.height > image.width ? 1600 : 1200;
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Pemrosesan foto tidak didukung browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await compressCanvas(canvas, maxBytes, 0.42);
  return new File([blob], "foto-siswa.webp", { type: "image/webp" });
}

export function cropOutputSize(aspect: PhotoAspect) {
  return aspect === "3:4" ? { width: 360, height: 480 } : { width: 480, height: 360 };
}

export function drawStudentCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, aspect: PhotoAspect, zoom: number, positionX: number, positionY: number) {
  const output = cropOutputSize(aspect);
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const scale = Math.max(output.width / image.width, output.height / image.height) * zoom;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const overflowX = Math.max(0, drawWidth - output.width);
  const overflowY = Math.max(0, drawHeight - output.height);
  const x = -overflowX * ((positionX + 100) / 200);
  const y = -overflowY * ((positionY + 100) / 200);
  context.fillStyle = "#e2e8f0";
  context.fillRect(0, 0, output.width, output.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

export async function createStudentThumbnail(file: File, aspect: PhotoAspect, zoom: number, positionX: number, positionY: number, maxBytes = 100 * 1024) {
  const image = await loadPhoto(file);
  const canvas = document.createElement("canvas");
  drawStudentCrop(canvas, image, aspect, zoom, positionX, positionY);
  const blob = await compressCanvas(canvas, maxBytes, 0.38);
  return new File([blob], "thumbnail-siswa.webp", { type: "image/webp" });
}
