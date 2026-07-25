import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";

const MAX_STUDENTS = 120;
const DEFAULT_TTL_DAYS = 3;
const clampText = (value, max) => String(value ?? "").trim().slice(0, max);
const escapeHtml = (value) => clampText(value, 500).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const validToken = (value) => /^[a-f0-9]{64}$/i.test(value);
const pdfLinkKey = (token) => `generated-pdf-links/${token}.json`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

async function responseToDataUrl(response, fallbackType = "image/png") {
  if (!response.ok) throw new Error("Aset kartu tidak dapat dimuat.");
  const contentType = response.headers.get("content-type")?.split(";")[0] || fallbackType;
  return `data:${contentType};base64,${bytesToBase64(await response.arrayBuffer())}`;
}

async function r2ImageDataUrl(env, key, uid, width, format = "image/jpeg") {
  if (!key || !key.startsWith(`users/${uid}/`)) return null;
  const object = await env.SMARTATT_R2.get(key);
  if (!object) return null;
  const originalType = object.httpMetadata?.contentType || "image/jpeg";
  if (!originalType.startsWith("image/")) return null;
  const buffer = await object.arrayBuffer();
  if (env.IMAGES) {
    try {
      const result = await env.IMAGES.input(new Blob([buffer], { type: originalType }).stream()).transform({ width }).output({ format, quality: 70 });
      return responseToDataUrl(result.response(), format);
    } catch { /* Pages does not currently expose this binding; original bytes are bounded into PDF batches below. */ }
  }
  return `data:${originalType};base64,${bytesToBase64(buffer)}`;
}

async function mapWithLimit(items, limit, worker, progress) {
  const output = new Array(items.length);
  let next = 0;
  let complete = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
      complete += 1;
      await progress(complete);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return output;
}

function schoolFallbackSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01" fill="none" stroke="#075985" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function cardHtml(student, options) {
  const initials = student.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ID";
  const photo = options.template === "photo" ? (student.photoData ? `<img class="student-photo" src="${student.photoData}" alt="">` : `<div class="photo-fallback">${escapeHtml(initials)}</div>`) : "";
  const schoolLogo = options.schoolLogo ? `<img class="school-logo" src="${options.schoolLogo}" alt="">` : schoolFallbackSvg();
  return `<article class="card ${options.template === "photo" ? "with-photo" : "without-photo"}"><header><span class="wave wave-one"></span><span class="wave wave-two"></span><img class="app-logo" src="${options.appLogo}" alt=""><div class="school-title"><strong>${escapeHtml(options.schoolName)}</strong><small>SMART-ATT · KARTU IDENTITAS SISWA</small></div><div class="school-mark">${schoolLogo}</div></header><main>${options.template === "photo" ? `<div class="photo-box">${photo}</div>` : ""}<section class="identity"><p>KARTU PELAJAR</p><h2>${escapeHtml(student.name)}</h2><dl><dt>NIS</dt><dd>${escapeHtml(student.nis)}</dd><dt>NISN</dt><dd>${escapeHtml(student.nisn || "-")}</dd><dt>KELAS</dt><dd>${escapeHtml(student.className)}</dd></dl><footer>TAHUN AJARAN ${escapeHtml(options.academicYear)}</footer></section><aside>${student.qrSvg}<b>SCAN ABSENSI</b></aside></main></article>`;
}

function pdfHtml(students, options) {
  const single = options.layout === "single";
  const perPage = single ? 1 : options.layout === "a4-10" ? 10 : 8;
  const orientation = options.layout === "a4-10" ? "portrait" : options.orientation;
  const pages = [];
  for (let offset = 0; offset < students.length; offset += perPage) pages.push(`<section class="page layout-${options.layout} orientation-${orientation}">${students.slice(offset, offset + perPage).map((student) => cardHtml(student, options)).join("")}</section>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${single ? "85.6mm 54mm" : `A4 ${orientation}`};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#0f172a}.page{display:grid;width:${single ? "85.6mm" : orientation === "landscape" ? "297mm" : "210mm"};height:${single ? "54mm" : orientation === "landscape" ? "210mm" : "297mm"};align-content:center;justify-content:center;break-after:page;page-break-after:always;background:#fff}.page:last-child{break-after:auto;page-break-after:auto}.layout-single{grid-template-columns:85.6mm;grid-auto-rows:54mm}.layout-a4-8{grid-template-columns:repeat(2,85.6mm);grid-auto-rows:54mm;padding:18mm 12mm;gap:6mm 8mm}.layout-a4-10{grid-template-columns:repeat(2,85.6mm);grid-auto-rows:54mm;padding:7mm 12mm;gap:2.5mm 8mm}.orientation-landscape:not(.layout-single){grid-template-columns:repeat(3,85.6mm);padding:8mm 12mm;gap:5mm 7mm}.card{position:relative;width:85.6mm;height:54mm;overflow:hidden;border:.25mm solid #7dd3fc;background:#fff;break-inside:avoid;page-break-inside:avoid}.card header{position:relative;display:flex;height:13.75mm;align-items:center;gap:2.6mm;overflow:hidden;background:#7dd3fc;padding:0 3.7mm;color:#082f49}.wave{position:absolute;border-radius:50%}.wave-one{left:-10mm;top:-14mm;width:64mm;height:24mm;transform:rotate(8deg);background:rgba(186,230,253,.8)}.wave-two{right:-16mm;top:-8mm;width:56mm;height:20mm;transform:rotate(-10deg);background:rgba(56,189,248,.45)}.app-logo{position:relative;width:8mm;height:8mm;object-fit:cover;border-radius:2mm;background:#fff;padding:.5mm}.school-title{position:relative;min-width:0;flex:1;overflow:hidden}.school-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:2.4mm;line-height:1.4;letter-spacing:.12em;text-transform:uppercase;font-weight:900}.school-title small{display:block;margin-top:.4mm;font-size:1.7mm;line-height:1.35;letter-spacing:.18em;color:#075985;font-weight:800}.school-mark{position:relative;width:9mm;height:9mm;flex:none}.school-mark img,.school-mark svg{width:100%;height:100%;object-fit:contain}.card main{display:grid;height:calc(100% - 13.75mm);min-height:0;align-items:stretch;gap:2.6mm;padding:3mm;background:linear-gradient(135deg,#fff 0%,#f0f9ff 100%)}.with-photo main{grid-template-columns:29% 1fr 26%}.without-photo main{grid-template-columns:1fr 27%}.photo-box{min-width:0;border:.5mm solid #7dd3fc;background:#f0f9ff;padding:1mm}.student-photo,.photo-fallback{width:100%;height:100%;object-fit:cover}.photo-fallback{display:grid;place-items:center;background:linear-gradient(135deg,#e0f2fe,#fff);font-size:4.2mm;font-weight:900;color:#075985}.identity{min-width:0;overflow:hidden;padding-top:.5mm;text-align:left}.identity p{margin:0;color:#0369a1;font-size:1.85mm;line-height:1.3;letter-spacing:.16em;font-weight:900}.identity h2{max-height:7.2mm;overflow:hidden;margin:.5mm 0 0;font-size:2.9mm;line-height:1.2;font-weight:900;overflow-wrap:anywhere}.without-photo .identity h2{max-height:10mm;font-size:4mm}.identity dl{display:grid;grid-template-columns:8.5mm 1fr;gap:.5mm 1.5mm;margin:1.5mm 0 0;font-size:1.85mm;line-height:1.25;font-weight:700}.without-photo .identity dl{font-size:2.25mm}.identity dt{color:#0369a1;letter-spacing:.12em}.identity dd{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap}.identity footer{margin-top:1.5mm;overflow:hidden;color:#94a3b8;font-size:1.45mm;line-height:1.3;letter-spacing:.12em;white-space:nowrap;font-weight:800}.card aside{display:flex;min-width:0;flex-direction:column;align-items:center;justify-content:center;border:.25mm solid #bae6fd;background:#fff;padding:1.5mm}.card aside svg{width:18mm!important;height:18mm!important;flex:none}.card aside b{margin-top:1mm;color:#075985;font-size:1.45mm;letter-spacing:.12em;text-align:center}
</style></head><body>${pages.join("")}</body></html>`;
}

export function splitPdfBatches(students, options, softLimit = 25 * 1024 * 1024, hardLimit = 30 * 1024 * 1024) {
  const perPage = options.layout === "single" ? 1 : options.layout === "a4-10" ? 10 : 8;
  const pages = [];
  for (let offset = 0; offset < students.length; offset += perPage) pages.push(students.slice(offset, offset + perPage));
  const batches = [];
  let current = [];
  for (const page of pages) {
    const candidate = [...current, ...page];
    if (current.length && new TextEncoder().encode(pdfHtml(candidate, options)).byteLength > softLimit) {
      batches.push(current);
      current = [...page];
    } else current = candidate;
    if (new TextEncoder().encode(pdfHtml(current, options)).byteLength > hardLimit) throw new Error("Satu halaman kartu melebihi batas Cloudflare. Gunakan thumbnail siswa yang lebih kecil.");
  }
  if (current.length) batches.push(current);
  return batches;
}

async function sendPdfEmail(env, data) {
  if (!env.RESEND_API_KEY) throw new Error("Layanan email belum dikonfigurasi pada Cloudflare Pages.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "user-agent": "SMART-ATT-Worker/1.0", "idempotency-key": data.jobId }, body: JSON.stringify({ from: env.PDF_EMAIL_FROM || "SMART-ATT <noreply@smart-att.web.id>", to: [data.email], subject: `PDF Kartu Pelajar · ${data.schoolName}`, html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><h2>PDF Kartu Pelajar sudah siap</h2><p><strong>${escapeHtml(data.schoolName)}</strong></p><p>${data.count} kartu pelajar berhasil dibuat. Link berlaku sampai ${escapeHtml(data.expiresLabel)}.</p><p><a href="${data.downloadUrl}" style="display:inline-block;border-radius:10px;background:#0f766e;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">Unduh PDF Kartu Pelajar</a></p><p style="color:#64748b;font-size:12px">Jika Anda tidak meminta file ini, abaikan email ini.</p></div>` }) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Email gagal dikirim${detail ? `: ${detail.slice(0, 180)}` : "."}`); }
}

function normalizeStudents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_STUDENTS) throw new Error(`Pilih 1 sampai ${MAX_STUDENTS} siswa.`);
  return value.map((raw) => { if (!raw || typeof raw !== "object") throw new Error("Data siswa tidak valid."); const id = clampText(raw.id, 128); const name = clampText(raw.name, 180); const nis = clampText(raw.nis, 64); if (!id || !name || !nis) throw new Error("Identitas siswa belum lengkap."); return { id, name, nis, nisn: clampText(raw.nisn, 64), className: clampText(raw.className, 100), photoKey: clampText(raw.photoKey, 400), photoThumbnailKey: clampText(raw.photoThumbnailKey, 400) }; });
}

export function handleGeneratedPdfDownload(request, env, url) {
  if (request.method !== "GET" || !url.pathname.startsWith("/api/storage/generated-pdf/")) return null;
  const token = url.pathname.slice("/api/storage/generated-pdf/".length);
  if (!validToken(token)) return Response.json({ error: "Link PDF tidak valid." }, { status: 400 });
  return (async () => { const metadataObject = await env.SMARTATT_R2.get(pdfLinkKey(token)); if (!metadataObject) return Response.json({ error: "Link PDF tidak ditemukan atau sudah berakhir." }, { status: 404 }); const metadata = await metadataObject.json(); if (!metadata?.key || Number(metadata.expiresAtMs) <= Date.now()) { await Promise.all([metadata?.key ? env.SMARTATT_R2.delete(metadata.key) : Promise.resolve(), env.SMARTATT_R2.delete(pdfLinkKey(token))]); return Response.json({ error: "Link PDF sudah kedaluwarsa." }, { status: 410 }); } const pdf = await env.SMARTATT_R2.get(metadata.key); if (!pdf) return Response.json({ error: "File PDF tidak ditemukan." }, { status: 404 }); return new Response(pdf.body, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${metadata.fileName || "kartu-pelajar-smart-att.pdf"}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }); })();
}

export function handleGenerateStudentCardsPdf(request, env, url, account) {
  if (request.method !== "POST" || url.pathname !== "/api/storage/generate-student-cards-pdf") return null;
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const emit = (payload) => writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
  void (async () => { let generatedKey = ""; let generatedLinkKey = ""; try {
    if (!account.email) throw new Error("Email akun guru tidak tersedia.");
    if (!env.BROWSER?.quickAction) throw new Error("Binding Cloudflare Browser Run belum aktif.");
    if (!env.RESEND_API_KEY) throw new Error("Layanan email belum dikonfigurasi pada Cloudflare Pages.");
    const body = await request.json().catch(() => null);
    const targetEmail = clampText(body?.email || body?.targetEmail || account.email, 200).toLowerCase();
    if (!targetEmail) throw new Error("Email tujuan pengiriman kartu tidak tersedia.");
    if (!env.BROWSER?.quickAction) throw new Error("Binding Cloudflare Browser Run belum aktif.");
    if (!env.RESEND_API_KEY) throw new Error("Layanan email belum dikonfigurasi pada Cloudflare Pages.");
    const students = normalizeStudents(body?.students);
    const schoolName = clampText(body?.schoolName || "Sekolah", 200);
    const academicYear = clampText(body?.academicYear || "-", 30);
    const template = body?.template === "no-photo" ? "no-photo" : "photo";
    const layout = ["single", "a4-8", "a4-10"].includes(body?.layout) ? body.layout : "a4-8";
    const orientation = body?.orientation === "landscape" ? "landscape" : "portrait";
    const schoolLogoKey = clampText(body?.schoolLogoKey, 400);
    await emit({ type: "progress", percent: 3, message: `Menyiapkan ${students.length} kartu pelajar...` });
    const publicBaseUrl = url.origin;
    const appLogo = `${publicBaseUrl}/logo.png`;
    const schoolLogo = schoolLogoKey ? await r2ImageDataUrl(env, schoolLogoKey, account.uid, 180, "image/png", 75) : null;
    const prepared = await mapWithLimit(students, 3, async (student) => { let photoData = null; if (template === "photo") { for (const key of Array.from(new Set([student.photoThumbnailKey, student.photoKey].filter(Boolean)))) { photoData = await r2ImageDataUrl(env, key, account.uid, 260, "image/jpeg", 70); if (photoData) break; } } const qrSvg = await QRCode.toString(student.id, { type: "svg", errorCorrectionLevel: "M", margin: 0, width: 256, color: { dark: "#000000", light: "#ffffff" } }); return { ...student, photoData, qrSvg }; }, async (complete) => emit({ type: "progress", percent: 5 + Math.round(complete / students.length * 55), message: `Mengoptimalkan foto dan QR... (${complete}/${students.length})` }));
    await emit({ type: "progress", percent: 65, message: "Merender desain PDF di server..." });
    const renderOptions = { schoolName, academicYear, template, layout, orientation, appLogo, schoolLogo };
    const batches = splitPdfBatches(prepared, renderOptions);
    const mergedPdf = await PDFDocument.create();
    let lastQuickActionStartedAt = 0;
    for (let index = 0; index < batches.length; index += 1) {
      const rateLimitWaitMs = Math.max(0, 10_500 - (Date.now() - lastQuickActionStartedAt));
      if (rateLimitWaitMs > 0) {
        await emit({ type: "progress", percent: 65 + Math.round(index / batches.length * 17), message: `Menunggu batas Cloudflare sebelum batch ${index + 1}/${batches.length}...` });
        await sleep(rateLimitWaitMs);
      }
      await emit({ type: "progress", percent: 65 + Math.round(index / batches.length * 17), message: `Merender batch PDF... (${index + 1}/${batches.length})` });
      let pdfResponse;
      let rateLimitDetail = "";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        lastQuickActionStartedAt = Date.now();
        pdfResponse = await env.BROWSER.quickAction("pdf", { html: pdfHtml(batches[index], renderOptions), waitForTimeout: 800, pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" }, timeout: 120000 } });
        if (pdfResponse.status !== 429) break;
        rateLimitDetail = await pdfResponse.clone().text().catch(() => "");
        if (/time limit exceeded|limit exceeded for today/i.test(rateLimitDetail)) throw new Error("Kuota Cloudflare Browser Run hari ini sudah habis. Coba lagi setelah pukul 07.00 WIB atau gunakan paket Workers Paid.");
        if (attempt < 3) {
          const retryAfterSeconds = Math.max(11, Number(pdfResponse.headers.get("retry-after")) || 0);
          await emit({ type: "progress", percent: 65 + Math.round(index / batches.length * 17), message: `Cloudflare membatasi request. Mencoba lagi dalam ${retryAfterSeconds} detik...` });
          await sleep(retryAfterSeconds * 1000);
        }
      }
      if (!pdfResponse) throw new Error("Cloudflare tidak memberikan respons PDF.");
      if (pdfResponse.status === 429) throw new Error(`Cloudflare masih membatasi pembuatan PDF batch ${index + 1}. Tunggu 1 menit lalu coba lagi.${rateLimitDetail ? ` ${rateLimitDetail.slice(0, 120)}` : ""}`);
      if (!pdfResponse.ok) throw new Error(`Cloudflare gagal membuat PDF batch ${index + 1} (${pdfResponse.status}).`);
      const batchBuffer = await pdfResponse.arrayBuffer();
      if (!batchBuffer.byteLength) throw new Error(`PDF batch ${index + 1} kosong.`);
      const batchPdf = await PDFDocument.load(batchBuffer);
      const copiedPages = await mergedPdf.copyPages(batchPdf, batchPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    const pdfBuffer = await mergedPdf.save({ useObjectStreams: true });
    if (!pdfBuffer.byteLength) throw new Error("File PDF yang dihasilkan kosong.");
    await emit({ type: "progress", percent: 82, message: "Menyimpan PDF sementara..." });
    const jobId = crypto.randomUUID();
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const ttlDays = Math.min(7, Math.max(1, Number(env.PDF_LINK_TTL_DAYS) || DEFAULT_TTL_DAYS));
    const expiresAtMs = Date.now() + ttlDays * 86400000;
    const safeSchool = schoolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "sekolah";
    const fileName = `kartu-pelajar-${safeSchool}-${students.length}.pdf`;
    const key = `generated-pdfs/${account.uid}/${jobId}.pdf`;
    generatedKey = key;
    generatedLinkKey = pdfLinkKey(token);
    await env.SMARTATT_R2.put(key, pdfBuffer, { httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" }, customMetadata: { ownerUid: account.uid, expiresAtMs: String(expiresAtMs), studentCount: String(students.length) } });
    await env.SMARTATT_R2.put(generatedLinkKey, JSON.stringify({ key, fileName, ownerUid: account.uid, expiresAtMs }), { httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" } });
    const downloadUrl = `${publicBaseUrl}/api/storage/generated-pdf/${token}`;
    await emit({ type: "progress", percent: 92, message: `Mengirim link ke ${targetEmail}...` });
    await sendPdfEmail(env, { jobId, email: targetEmail, schoolName, count: students.length, downloadUrl, expiresLabel: new Date(expiresAtMs).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }) });
    const oldObjects = await env.SMARTATT_R2.list({ prefix: `generated-pdfs/${account.uid}/`, limit: 200 });
    const expired = oldObjects.objects.filter((object) => object.uploaded.getTime() < Date.now() - ttlDays * 86400000).map((object) => object.key);
    if (expired.length) await env.SMARTATT_R2.delete(expired);
    await emit({ type: "complete", percent: 100, message: `PDF berhasil dibuat dan dikirim ke ${targetEmail}. Cek inbox atau folder spam email Anda.`, count: students.length, email: targetEmail, downloadUrl, expiresAtMs });
  } catch (error) { if (generatedKey || generatedLinkKey) await Promise.all([generatedKey ? env.SMARTATT_R2.delete(generatedKey) : Promise.resolve(), generatedLinkKey ? env.SMARTATT_R2.delete(generatedLinkKey) : Promise.resolve()]).catch(() => undefined); await emit({ type: "error", message: error instanceof Error ? error.message : "PDF gagal dibuat. Silakan coba kembali." }); } finally { await writer.close(); } })();
  return new Response(stream.readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
