import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const distClient = resolve(root, "dist", "client");
const distServer = resolve(root, "dist", "server");
const pagesOutput = resolve(root, ".pages-deploy");
const workerBundle = resolve(pagesOutput, "_worker");
const studentCardPdfHelper = resolve(root, "worker", "student-card-pdf.js");
const adminDeleteHelper = resolve(root, "worker", "admin-delete.js");

const workerSource = String.raw`import rscHandler from "./_worker/index.js";
import bcrypt from "bcryptjs";
import { handleGeneratedPdfDownload, handleGenerateStudentCardsPdf } from "./student-card-pdf.js";
import { handleAdminSchoolDeletion, handleAdminUserDeletion } from "./admin-delete.js";

const FIREBASE_API_KEY = "AIzaSyD2FV_FSGtqD-u7BQtxLpRfSZZqOTXJqcQ";
const FIREBASE_PROJECT_ID = "smart-att-90ef9";
const VINEXT_STATIC_FILE_HEADER = "x-vinext-static-file";
const DEFAULT_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const DEFAULT_IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];
const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const SAFE_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/bmp",
  "image/tiff",
]);

async function authenticatedUser(request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const idToken = authorization.slice(7);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) return null;
  const body = await response.json();
  const account = body.users?.[0];
  return account?.localId ? { uid: account.localId, email: account.email ?? "" } : null;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

const safePublicId = (value, min = 12) => new RegExp("^[A-Za-z0-9_-]{" + min + ",128}$").test(value);
const savingsShareKey = (shareId) => "savings-shares/" + shareId + ".json";
const savingsCredentialKey = (ownerUid, studentId) => "savings-credentials/" + ownerUid + "/" + studentId + ".json";
const savingsSessionKey = (token) => "savings-sessions/" + token + ".json";

async function readR2Json(env, key) {
  const object = await env.SMARTATT_R2.get(key);
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

async function putR2Json(env, key, value, metadata = {}) {
  await env.SMARTATT_R2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
    customMetadata: metadata,
  });
}

function findSavingsStudent(share, nis) {
  const normalized = nis.trim();
  return share.students.find((student) => student.nis.trim() === normalized) ?? null;
}

async function createSavingsSession(env, share, credential) {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const session = { shareId: share.shareId, ownerUid: share.ownerUid, studentId: credential.studentId, credentialCreatedAtMs: credential.createdAtMs, expiresAtMs: Date.now() + 12 * 60 * 60 * 1000 };
  await putR2Json(env, savingsSessionKey(token), session, { ownerUid: share.ownerUid, studentId: credential.studentId });
  return token;
}

async function handleStorage(request, env, url) {
  const generatedPdfDownload = handleGeneratedPdfDownload(request, env, url);
  if (generatedPdfDownload) return await generatedPdfDownload;
  if (request.method === "GET" && url.pathname === "/api/storage/public-savings/status") {
    const shareId = url.searchParams.get("share")?.trim() ?? "";
    const nis = url.searchParams.get("nis")?.trim() ?? "";
    if (!safePublicId(shareId) || !nis || nis.length > 64) return json({ error: "Link atau NIS tidak valid" }, 400);
    const share = await readR2Json(env, savingsShareKey(shareId));
    if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis);
    if (!student) return json({ error: "NIS tidak ditemukan pada data guru" }, 404);
    const credential = await readR2Json(env, savingsCredentialKey(share.ownerUid, student.id));
    return json({ studentName: student.name, needsPassword: !credential });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/public-savings/register") {
    const body = await request.json().catch(() => null);
    const shareId = body?.shareId?.trim() ?? "";
    const nis = body?.nis?.trim() ?? "";
    const password = body?.password ?? "";
    if (!safePublicId(shareId) || !nis) return json({ error: "Link atau NIS tidak valid" }, 400);
    if (password.length < 6 || password.length > 72) return json({ error: "Password harus 6 sampai 72 karakter" }, 400);
    if (password !== body?.confirmation) return json({ error: "Konfirmasi password tidak sama" }, 400);
    const share = await readR2Json(env, savingsShareKey(shareId));
    if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis);
    if (!student) return json({ error: "NIS tidak ditemukan pada data guru" }, 404);
    const credentialKey = savingsCredentialKey(share.ownerUid, student.id);
    if (await env.SMARTATT_R2.head(credentialKey)) return json({ error: "Password sudah dibuat. Silakan masuk." }, 409);
    const credential = { ownerUid: share.ownerUid, studentId: student.id, passwordHash: await bcrypt.hash(password, 10), createdAtMs: Date.now() };
    await putR2Json(env, credentialKey, credential, { ownerUid: share.ownerUid, studentId: student.id });
    return json({ sessionToken: await createSavingsSession(env, share, credential) }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/storage/public-savings/login") {
    const body = await request.json().catch(() => null);
    const shareId = body?.shareId?.trim() ?? "";
    const nis = body?.nis?.trim() ?? "";
    const password = body?.password ?? "";
    if (!safePublicId(shareId) || !nis || password.length > 72) return json({ error: "Data login tidak valid" }, 400);
    const share = await readR2Json(env, savingsShareKey(shareId));
    if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis);
    if (!student) return json({ error: "NIS atau password salah" }, 401);
    const credential = await readR2Json(env, savingsCredentialKey(share.ownerUid, student.id));
    if (!credential || !await bcrypt.compare(password, credential.passwordHash)) return json({ error: "NIS atau password salah" }, 401);
    return json({ sessionToken: await createSavingsSession(env, share, credential) });
  }

  if (request.method === "GET" && url.pathname === "/api/storage/public-savings/account") {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!safePublicId(token, 40)) return json({ error: "Sesi tidak valid" }, 401);
    const session = await readR2Json(env, savingsSessionKey(token));
    if (!session || session.expiresAtMs <= Date.now()) {
      if (session) await env.SMARTATT_R2.delete(savingsSessionKey(token));
      return json({ error: "Sesi telah berakhir. Silakan masuk kembali." }, 401);
    }
    const [share, credential] = await Promise.all([readR2Json(env, savingsShareKey(session.shareId)), readR2Json(env, savingsCredentialKey(session.ownerUid, session.studentId))]);
    if (!share || share.ownerUid !== session.ownerUid || !credential || credential.createdAtMs !== session.credentialCreatedAtMs) return json({ error: "Password telah di-reset. Silakan buat password baru." }, 401);
    const student = share.students.find((item) => item.id === session.studentId);
    if (!student) return json({ error: "Data siswa tidak lagi tersedia" }, 404);
    const transactions = share.transactions.filter((item) => item.studentId === student.id && item.status === "active").sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAtMs - a.createdAtMs);
    const totalDeposit = transactions.filter((item) => item.type === "deposit").reduce((sum, item) => sum + item.amount, 0);
    const totalWithdrawal = transactions.filter((item) => item.type === "withdrawal").reduce((sum, item) => sum + item.amount, 0);
    return json({ student: { ...student, schoolName: share.schoolName }, transactions, totalDeposit, totalWithdrawal, balance: totalDeposit - totalWithdrawal });
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/storage/article/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/storage/article/".length));
    if (!key.startsWith("articles/")) return json({ error: "Forbidden" }, 403);
    const object = await env.SMARTATT_R2.get(key);
    if (!object) return json({ error: "File tidak ditemukan" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=86400");
    return new Response(object.body, { headers });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/public-guardian-photo") {
    const form = await request.formData();
    const file = form.get("file");
    const snapshotId = String(form.get("snapshotId") ?? "");
    const studentId = String(form.get("studentId") ?? "");
    const variant = form.get("variant") === "thumbnail" ? "thumbnail" : "photo";
    if (!(file instanceof File)) return json({ error: "Foto tidak ditemukan" }, 400);
    if (!/^[A-Za-z0-9_-]{1,250}$/.test(snapshotId) || !/^[A-Za-z0-9_-]{1,128}$/.test(studentId)) return json({ error: "Data pendataan tidak valid" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format foto tidak didukung" }, 415);
    if (file.size > 700 * 1024) return json({ error: "Ukuran foto maksimal 700 KB" }, 413);
    const snapshotResponse = await fetch(
      "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/publicSnapshots/" + encodeURIComponent(snapshotId) + "?key=" + FIREBASE_API_KEY,
    );
    if (!snapshotResponse.ok) return json({ error: "Link pendataan tidak tersedia" }, 403);
    const snapshot = await snapshotResponse.json();
    const fields = snapshot.fields ?? {};
    const ownerUid = fields.ownerUid?.stringValue ?? "";
    const students = fields.students?.arrayValue?.values ?? [];
    const validStudent = fields.published?.booleanValue === true && fields.type?.stringValue === "guardian" && /^[A-Za-z0-9_-]{10,128}$/.test(ownerUid) && students.some((item) => item.mapValue?.fields?.id?.stringValue === studentId);
    if (!validStudent) return json({ error: "Siswa tidak terdaftar pada link ini" }, 403);
    const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    const key = "guardian-submissions/" + ownerUid + "/" + studentId + "/" + variant + "-" + crypto.randomUUID() + "." + extension;
    await env.SMARTATT_R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: "private, no-store" },
      customMetadata: { ownerUid, studentId, snapshotId, variant },
    });
    return json({ key });
  }

  const account = await authenticatedUser(request);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const uid = account.uid;

  const generatedStudentCards = handleGenerateStudentCardsPdf(request, env, url, account);
  if (generatedStudentCards) return generatedStudentCards;

  if (request.method === "POST" && url.pathname === "/api/storage/savings-share") {
    const body = await request.json().catch(() => null);
    const shareId = body?.shareId?.trim() ?? "";
    if (!safePublicId(shareId)) return json({ error: "ID link tidak valid" }, 400);
    const existing = await readR2Json(env, savingsShareKey(shareId));
    if (existing && existing.ownerUid !== uid) return json({ error: "Link sudah digunakan akun lain" }, 409);
    const students = (Array.isArray(body?.students) ? body.students : []).slice(0, 3000).flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const id = String(row.id ?? "").trim(); const nis = String(row.nis ?? "").trim(); const name = String(row.name ?? "").trim();
      if (!safePublicId(id, 1) || !nis || !name) return [];
      return [{ id, nis: nis.slice(0, 64), nisn: String(row.nisn ?? "").slice(0, 64), name: name.slice(0, 180), className: String(row.className ?? "").slice(0, 100) }];
    });
    const studentIds = new Set(students.map((student) => student.id));
    const transactions = (Array.isArray(body?.transactions) ? body.transactions : []).slice(0, 50000).flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const studentId = String(row.studentId ?? ""); const amount = Number(row.amount); const type = row.type === "withdrawal" ? "withdrawal" : row.type === "deposit" ? "deposit" : null;
      if (!studentIds.has(studentId) || !type || !Number.isFinite(amount) || amount <= 0) return [];
      return [{ id: String(row.id ?? crypto.randomUUID()).slice(0, 128), studentId, type, amount, transactionDate: String(row.transactionDate ?? "").slice(0, 20), note: String(row.note ?? "").slice(0, 500), officerName: String(row.officerName ?? "Petugas").slice(0, 150), status: row.status === "void" ? "void" : "active", createdAtMs: Number(row.createdAtMs) || 0 }];
    });
    const share = { shareId, ownerUid: uid, schoolName: String(body?.schoolName ?? "Sekolah").slice(0, 200), students, transactions, updatedAtMs: Date.now() };
    await putR2Json(env, savingsShareKey(shareId), share, { ownerUid: uid });
    return json({ shareId, studentCount: students.length, transactionCount: transactions.length });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/savings-password-reset") {
    const body = await request.json().catch(() => null);
    const studentId = body?.studentId?.trim() ?? "";
    if (!safePublicId(studentId, 1)) return json({ error: "Siswa tidak valid" }, 400);
    await env.SMARTATT_R2.delete(savingsCredentialKey(uid, studentId));
    return json({ reset: true });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/accept-guardian-photo") {
    const body = await request.json().catch(() => null);
    const sourceKey = body?.sourceKey ?? "";
    const studentId = body?.studentId ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentId) || !sourceKey.startsWith("guardian-submissions/" + uid + "/" + studentId + "/")) return json({ error: "Sumber foto tidak valid" }, 400);
    const source = await env.SMARTATT_R2.get(sourceKey);
    if (!source) return json({ error: "Foto kiriman tidak ditemukan" }, 404);
    const contentType = source.httpMetadata?.contentType ?? "image/webp";
    if (!contentType.startsWith("image/")) return json({ error: "File bukan foto" }, 415);
    const extension = sourceKey.split(".").pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "webp";
    const key = "users/" + uid + "/students/" + crypto.randomUUID() + "." + safeExtension;
    await env.SMARTATT_R2.put(key, source.body, {
      httpMetadata: { contentType, cacheControl: "private, max-age=3600" },
      customMetadata: { ownerUid: uid, studentId, importedFromGuardian: "true" },
    });
    return json({ key });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/articles") {
    if (account.email.toLowerCase() !== "idhamdjuanda@gmail.com") return json({ error: "Forbidden" }, 403);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "File tidak ditemukan" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format gambar tidak didukung" }, 415);
    if (file.size > 3 * 1024 * 1024) return json({ error: "Ukuran gambar maksimal 3 MB" }, 413);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = "articles/" + crypto.randomUUID() + "." + extension;
    await env.SMARTATT_R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=86400" },
      customMetadata: { ownerUid: uid, originalName: file.name },
    });
    return json({ key });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/transfer-student-photo") {
    const body = await request.json().catch(() => null);
    const sourceOwnerUid = body?.sourceOwnerUid ?? "";
    const sourceKey = body?.sourceKey ?? "";
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(sourceOwnerUid) || !sourceKey.startsWith("users/" + sourceOwnerUid + "/students/")) return json({ error: "Sumber foto tidak valid" }, 400);
    const source = await env.SMARTATT_R2.get(sourceKey);
    if (!source) return json({ error: "Foto sumber tidak ditemukan" }, 404);
    const contentType = source.httpMetadata?.contentType ?? "";
    if (!contentType.startsWith("image/")) return json({ error: "File sumber bukan foto" }, 415);
    const extension = sourceKey.split(".").pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "jpg";
    const key = "users/" + uid + "/students/" + crypto.randomUUID() + "." + safeExtension;
    await env.SMARTATT_R2.put(key, source.body, {
      httpMetadata: { contentType, cacheControl: "private, max-age=3600" },
      customMetadata: { ownerUid: uid, importedFromUid: sourceOwnerUid, importedFromKey: sourceKey },
    });
    return json({ key });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/photos") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "File tidak ditemukan" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format foto tidak didukung" }, 415);
    if (file.size > 3 * 1024 * 1024) return json({ error: "Ukuran foto maksimal 3 MB" }, 413);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = "users/" + uid + "/students/" + crypto.randomUUID() + "." + extension;
    await env.SMARTATT_R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" },
      customMetadata: { ownerUid: uid, originalName: file.name },
    });
    return json({ key });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/profile-assets") {
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind") === "school-logo" ? "school-logo" : "profile";
    if (!(file instanceof File)) return json({ error: "Gambar tidak ditemukan" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format gambar tidak didukung" }, 415);
    if (file.size > 2 * 1024 * 1024) return json({ error: "Ukuran gambar maksimal 2 MB" }, 413);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = "users/" + uid + "/" + kind + "/" + crypto.randomUUID() + "." + extension;
    await env.SMARTATT_R2.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" }, customMetadata: { ownerUid: uid, kind, originalName: file.name } });
    return json({ key });
  }

  if ((request.method === "GET" || request.method === "DELETE") && url.pathname.startsWith("/api/storage/file/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/storage/file/".length));
    if (!key.startsWith("users/" + uid + "/")) return json({ error: "Forbidden" }, 403);
    if (request.method === "DELETE") {
      await env.SMARTATT_R2.delete(key);
      return json({ ok: true });
    }
    const object = await env.SMARTATT_R2.get(key);
    if (!object) return json({ error: "File tidak ditemukan" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    return new Response(object.body, { headers });
  }

  return json({ error: "Not found" }, 404);
}

function isSafeImageContentType(contentType) {
  if (!contentType) return false;
  return SAFE_IMAGE_CONTENT_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}

function parseImageParams(url) {
  const imageUrl = url.searchParams.get("url")?.replaceAll("\\", "/");
  const width = Number.parseInt(url.searchParams.get("w") || "0", 10);
  const quality = Number.parseInt(url.searchParams.get("q") || "75", 10);
  const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
  if (!imageUrl || !imageUrl.startsWith("/") || imageUrl.startsWith("//")) return null;
  if (Number.isNaN(width) || width < 0 || width > 3840 || (width !== 0 && !allowedWidths.includes(width))) return null;
  if (Number.isNaN(quality) || quality < 1 || quality > 100) return null;
  return { imageUrl, width, quality };
}

async function handleImageOptimization(request, env, url) {
  const params = parseImageParams(url);
  if (!params) return new Response("Bad Request", { status: 400 });
  const source = await env.ASSETS.fetch(new Request(new URL(params.imageUrl, request.url)));
  if (!source.ok || !source.body) return new Response("Image not found", { status: 404 });
  const sourceContentType = source.headers.get("content-type");
  if (!isSafeImageContentType(sourceContentType)) return new Response("The requested resource is not an allowed image type", { status: 400 });
  const format = request.headers.get("accept")?.includes("image/avif") ? "image/avif" : request.headers.get("accept")?.includes("image/webp") ? "image/webp" : "image/jpeg";
  const securityHeaders = {
    "cache-control": IMAGE_CACHE_CONTROL,
    "content-security-policy": "script-src 'none'; frame-src 'none'; sandbox;",
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    vary: "Accept",
  };
  if (!env.IMAGES) return new Response(source.body, { headers: { ...Object.fromEntries(source.headers), ...securityHeaders } });
  try {
    const result = await env.IMAGES.input(source.body).transform(params.width > 0 ? { width: params.width } : {}).output({ format, quality: params.quality });
    const transformed = result.response();
    const headers = new Headers(transformed.headers);
    for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
    if (!isSafeImageContentType(headers.get("content-type"))) headers.set("content-type", format);
    return new Response(transformed.body, { status: 200, headers });
  } catch (error) {
    console.error("[smart-att] Image optimization error:", error);
    return new Response(source.body, { headers: { ...Object.fromEntries(source.headers), ...securityHeaders } });
  }
}

async function resolveStaticAssetSignal(response, request, env) {
  const signal = response.headers.get(VINEXT_STATIC_FILE_HEADER);
  if (!signal || !env.ASSETS) return response;
  const assetPath = decodeURIComponent(signal);
  const extraHeaders = new Headers(response.headers);
  extraHeaders.delete(VINEXT_STATIC_FILE_HEADER);
  extraHeaders.delete("content-encoding");
  extraHeaders.delete("content-length");
  extraHeaders.delete("content-type");
  await response.body?.cancel?.().catch(() => {});
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  const headers = new Headers(assetResponse.headers);
  extraHeaders.forEach((value, key) => headers.set(key, value));
  return new Response(assetResponse.body, {
    status: assetResponse.ok && response.status !== 200 ? response.status : assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin/")) {
      const account = await authenticatedUser(request);
      if (!account) return json({ error: "Unauthorized" }, 401);
      const response = await handleAdminUserDeletion(request, env, url, account)
        ?? await handleAdminSchoolDeletion(request, env, url, account);
      if (response) return response;
    }
    if (url.pathname.startsWith("/api/storage/")) return handleStorage(request, env, url);
    if (url.pathname === "/_vinext/image") return handleImageOptimization(request, env, url);
    const response = await rscHandler(request, ctx);
    if (response instanceof Response) return resolveStaticAssetSignal(response, request, env);
    if (response == null) return new Response("Not found", { status: 404 });
    return new Response(String(response), { status: 200 });
  },
};
`;

await rm(pagesOutput, { recursive: true, force: true });
await mkdir(pagesOutput, { recursive: true });
await cp(distClient, pagesOutput, { recursive: true });
await cp(distServer, workerBundle, { recursive: true });
await cp(studentCardPdfHelper, resolve(pagesOutput, "student-card-pdf.js"));
await cp(adminDeleteHelper, resolve(pagesOutput, "admin-delete.js"));
await writeFile(
  resolve(pagesOutput, "_worker.js"),
  workerSource,
);
