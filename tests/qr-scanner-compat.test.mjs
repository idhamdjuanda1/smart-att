import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAppleMobileBrowser, selectPreferredCameraDeviceId } from "../app/lib/qrScanner.ts";

test("iPhone dan iPad selalu melewati BarcodeDetector WebKit", () => {
  assert.equal(isAppleMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)", 5), true);
  assert.equal(isAppleMobileBrowser("Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X)", 5), true);
  assert.equal(isAppleMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true);
  assert.equal(isAppleMobileBrowser("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5), false);
});

test("kamera belakang iPhone memilih lensa 1x dan menghindari ultra-wide", () => {
  const devices = [
    { deviceId: "front", label: "Front Camera" },
    { deviceId: "ultra", label: "Back Ultra Wide Camera" },
    { deviceId: "wide", label: "Back Camera" },
    { deviceId: "tele", label: "Back Telephoto Camera" },
  ];
  assert.equal(selectPreferredCameraDeviceId(devices, "environment"), "wide");
  assert.equal(selectPreferredCameraDeviceId(devices, "user"), "front");
});

test("scanner menyediakan decoder frame khusus browser iPhone", async () => {
  const scanner = await readFile(new URL("../app/lib/qrScanner.ts", import.meta.url), "utf8");

  assert.match(scanner, /BarcodeDetector/);
  assert.match(scanner, /import\("@zxing\/browser"\)/);
  assert.match(scanner, /import\("jsqr"\)/);
  assert.match(scanner, /context\.drawImage/);
  assert.match(scanner, /getImageData/);
  assert.match(scanner, /contentHint = "detail"/);
  assert.match(scanner, /advanced\.zoom = 1/);
  assert.match(scanner, /decodeFromStream\(stream, video/);
  assert.match(scanner, /controls\.stop\(\)/);
  assert.match(scanner, /if \(appleMobile\)/);
});

test("semua jalur scanner aplikasi memakai decoder kompatibel", async () => {
  const [operationalViews, smartAttApp] = await Promise.all([
    readFile(new URL("../app/components/OperationalViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SmartAttApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(operationalViews, /startQrScanner/);
  assert.match(smartAttApp, /startQrScanner/);
  assert.doesNotMatch(operationalViews, /Gunakan Chrome terbaru/);
  assert.doesNotMatch(smartAttApp, /Browser belum mendukung pemindai QR/);
  assert.doesNotMatch(`${operationalViews}\n${smartAttApp}`, /\.BarcodeDetector/);
});
