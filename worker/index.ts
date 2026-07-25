/// <reference types="@cloudflare/workers-types" />
/** Cloudflare Worker entry point for SMART-ATT. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  SMARTATT_R2: R2Bucket;
  BROWSER: Fetcher & { quickAction(action: string, options: Record<string, unknown>): Promise<Response> };
  RESEND_API_KEY?: string;
  PDF_EMAIL_FROM?: string;
  PDF_LINK_TTL_DAYS?: string;
  PUBLIC_APP_URL?: string;
  FIREBASE_ADMIN_SERVICE_ACCOUNT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const FIREBASE_API_KEY = "AIzaSyD2FV_FSGtqD-u7BQtxLpRfSZZqOTXJqcQ";
const FIREBASE_PROJECT_ID = "smart-att-90ef9";

async function authenticatedUser(request: Request): Promise<{ uid: string; email: string } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const idToken = authorization.slice(7);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { users?: Array<{ localId?: string; email?: string }> };
  const account = body.users?.[0];
  return account?.localId ? { uid: account.localId, email: account.email ?? "" } : null;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

type SavingsStudent = { id: string; nis: string; nisn: string; name: string; className: string };
type SavingsTransaction = { id: string; studentId: string; type: "deposit" | "withdrawal"; amount: number; transactionDate: string; note: string; officerName: string; status: "active" | "void"; createdAtMs: number };
type SavingsShare = { shareId: string; ownerUid: string; schoolName: string; students: SavingsStudent[]; transactions: SavingsTransaction[]; updatedAtMs: number };
type SavingsCredential = { ownerUid: string; studentId: string; passwordHash: string; createdAtMs: number };
type SavingsSession = { shareId: string; ownerUid: string; studentId: string; credentialCreatedAtMs: number; expiresAtMs: number };

const safePublicId = (value: string, min = 12) => new RegExp(`^[A-Za-z0-9_-]{${min},128}$`).test(value);
const savingsShareKey = (shareId: string) => `savings-shares/${shareId}.json`;
const savingsCredentialKey = (ownerUid: string, studentId: string) => `savings-credentials/${ownerUid}/${studentId}.json`;
const savingsSessionKey = (token: string) => `savings-sessions/${token}.json`;

async function readR2Json<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.SMARTATT_R2.get(key);
  if (!object) return null;
  try { return JSON.parse(await object.text()) as T; } catch { return null; }
}

async function putR2Json(env: Env, key: string, value: unknown, metadata: Record<string, string> = {}) {
  await env.SMARTATT_R2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
    customMetadata: metadata,
  });
}

function findSavingsStudent(share: SavingsShare, nis: string) {
  const normalized = nis.trim();
  return share.students.find((student) => student.nis.trim() === normalized) ?? null;
}

async function createSavingsSession(env: Env, share: SavingsShare, credential: SavingsCredential) {
  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const session: SavingsSession = { shareId: share.shareId, ownerUid: share.ownerUid, studentId: credential.studentId, credentialCreatedAtMs: credential.createdAtMs, expiresAtMs: Date.now() + 12 * 60 * 60 * 1000 };
  await putR2Json(env, savingsSessionKey(token), session, { ownerUid: share.ownerUid, studentId: credential.studentId });
  return token;
}

async function handleStorage(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname.startsWith("/api/storage/generated-pdf/")) {
    const { handleGeneratedPdfDownload } = await import("./student-card-pdf.js");
    const generatedPdfDownload = handleGeneratedPdfDownload(request, env, url);
    if (generatedPdfDownload) return await generatedPdfDownload;
  }
  if (request.method === "GET" && url.pathname === "/api/storage/public-savings/status") {
    const shareId = url.searchParams.get("share")?.trim() ?? ""; const nis = url.searchParams.get("nis")?.trim() ?? "";
    if (!safePublicId(shareId) || !nis || nis.length > 64) return json({ error: "Link atau NIS tidak valid" }, 400);
    const share = await readR2Json<SavingsShare>(env, savingsShareKey(shareId));
    if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis); if (!student) return json({ error: "NIS tidak ditemukan pada data guru" }, 404);
    const credential = await readR2Json<SavingsCredential>(env, savingsCredentialKey(share.ownerUid, student.id));
    return json({ studentName: student.name, needsPassword: !credential });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/public-savings/register") {
    const body = await request.json().catch(() => null) as { shareId?: string; nis?: string; password?: string; confirmation?: string } | null;
    const shareId = body?.shareId?.trim() ?? ""; const nis = body?.nis?.trim() ?? ""; const password = body?.password ?? "";
    if (!safePublicId(shareId) || !nis) return json({ error: "Link atau NIS tidak valid" }, 400);
    if (password.length < 6 || password.length > 72) return json({ error: "Password harus 6 sampai 72 karakter" }, 400);
    if (password !== body?.confirmation) return json({ error: "Konfirmasi password tidak sama" }, 400);
    const share = await readR2Json<SavingsShare>(env, savingsShareKey(shareId)); if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis); if (!student) return json({ error: "NIS tidak ditemukan pada data guru" }, 404);
    const credentialKey = savingsCredentialKey(share.ownerUid, student.id);
    if (await env.SMARTATT_R2.head(credentialKey)) return json({ error: "Password sudah dibuat. Silakan masuk." }, 409);
    const { default: bcrypt } = await import("bcryptjs");
    const credential: SavingsCredential = { ownerUid: share.ownerUid, studentId: student.id, passwordHash: await bcrypt.hash(password, 10), createdAtMs: Date.now() };
    await putR2Json(env, credentialKey, credential, { ownerUid: share.ownerUid, studentId: student.id });
    return json({ sessionToken: await createSavingsSession(env, share, credential) }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/storage/public-savings/login") {
    const body = await request.json().catch(() => null) as { shareId?: string; nis?: string; password?: string } | null;
    const shareId = body?.shareId?.trim() ?? ""; const nis = body?.nis?.trim() ?? ""; const password = body?.password ?? "";
    if (!safePublicId(shareId) || !nis || password.length > 72) return json({ error: "Data login tidak valid" }, 400);
    const share = await readR2Json<SavingsShare>(env, savingsShareKey(shareId)); if (!share) return json({ error: "Link Tabungan Siswa tidak tersedia" }, 404);
    const student = findSavingsStudent(share, nis); if (!student) return json({ error: "NIS atau password salah" }, 401);
    const credential = await readR2Json<SavingsCredential>(env, savingsCredentialKey(share.ownerUid, student.id));
    const { default: bcrypt } = await import("bcryptjs");
    if (!credential || !await bcrypt.compare(password, credential.passwordHash)) return json({ error: "NIS atau password salah" }, 401);
    return json({ sessionToken: await createSavingsSession(env, share, credential) });
  }

  if (request.method === "GET" && url.pathname === "/api/storage/public-savings/account") {
    const authorization = request.headers.get("authorization"); const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!safePublicId(token, 40)) return json({ error: "Sesi tidak valid" }, 401);
    const session = await readR2Json<SavingsSession>(env, savingsSessionKey(token));
    if (!session || session.expiresAtMs <= Date.now()) { if (session) await env.SMARTATT_R2.delete(savingsSessionKey(token)); return json({ error: "Sesi telah berakhir. Silakan masuk kembali." }, 401); }
    const [share, credential] = await Promise.all([readR2Json<SavingsShare>(env, savingsShareKey(session.shareId)), readR2Json<SavingsCredential>(env, savingsCredentialKey(session.ownerUid, session.studentId))]);
    if (!share || share.ownerUid !== session.ownerUid || !credential || credential.createdAtMs !== session.credentialCreatedAtMs) return json({ error: "Password telah di-reset. Silakan buat password baru." }, 401);
    const student = share.students.find((item) => item.id === session.studentId); if (!student) return json({ error: "Data siswa tidak lagi tersedia" }, 404);
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
    const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=86400");
    return new Response(object.body, { headers });
  }
  if (request.method === "POST" && url.pathname === "/api/storage/public-guardian-photo") {
    const form = await request.formData();
    const file = form.get("file"); const snapshotId = String(form.get("snapshotId") ?? ""); const studentId = String(form.get("studentId") ?? ""); const variant = form.get("variant") === "thumbnail" ? "thumbnail" : "photo";
    if (!(file instanceof File)) return json({ error: "Foto tidak ditemukan" }, 400);
    if (!/^[A-Za-z0-9_-]{1,250}$/.test(snapshotId) || !/^[A-Za-z0-9_-]{1,128}$/.test(studentId)) return json({ error: "Data pendataan tidak valid" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format foto tidak didukung" }, 415);
    if (file.size > 700 * 1024) return json({ error: "Ukuran foto maksimal 700 KB" }, 413);
    const snapshotResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/publicSnapshots/${encodeURIComponent(snapshotId)}?key=${FIREBASE_API_KEY}`);
    if (!snapshotResponse.ok) return json({ error: "Link pendataan tidak tersedia" }, 403);
    const snapshot = await snapshotResponse.json() as { fields?: Record<string, { stringValue?: string; booleanValue?: boolean; arrayValue?: { values?: Array<{ mapValue?: { fields?: Record<string, { stringValue?: string }> } }> } }> };
    const fields = snapshot.fields ?? {}; const ownerUid = fields.ownerUid?.stringValue ?? ""; const students = fields.students?.arrayValue?.values ?? [];
    const validStudent = fields.published?.booleanValue === true && fields.type?.stringValue === "guardian" && /^[A-Za-z0-9_-]{10,128}$/.test(ownerUid) && students.some((item) => item.mapValue?.fields?.id?.stringValue === studentId);
    if (!validStudent) return json({ error: "Siswa tidak terdaftar pada link ini" }, 403);
    const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    const key = `guardian-submissions/${ownerUid}/${studentId}/${variant}-${crypto.randomUUID()}.${extension}`;
    await env.SMARTATT_R2.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "private, no-store" }, customMetadata: { ownerUid, studentId, snapshotId, variant } });
    return json({ key });
  }
  const account = await authenticatedUser(request);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const uid = account.uid;

  if (request.method === "POST" && url.pathname === "/api/storage/generate-student-cards-pdf") {
    const { handleGenerateStudentCardsPdf } = await import("./student-card-pdf.js");
    const generatedStudentCards = handleGenerateStudentCardsPdf(request, env, url, account);
    if (generatedStudentCards) return generatedStudentCards;
  }

  if (request.method === "POST" && url.pathname === "/api/storage/savings-share") {
    const body = await request.json().catch(() => null) as { shareId?: string; schoolName?: string; students?: unknown[]; transactions?: unknown[] } | null;
    const shareId = body?.shareId?.trim() ?? ""; if (!safePublicId(shareId)) return json({ error: "ID link tidak valid" }, 400);
    const existing = await readR2Json<SavingsShare>(env, savingsShareKey(shareId)); if (existing && existing.ownerUid !== uid) return json({ error: "Link sudah digunakan akun lain" }, 409);
    const students: SavingsStudent[] = (Array.isArray(body?.students) ? body.students : []).slice(0, 3000).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return []; const row = raw as Record<string, unknown>; const id = String(row.id ?? "").trim(); const nis = String(row.nis ?? "").trim(); const name = String(row.name ?? "").trim();
      if (!safePublicId(id, 1) || !nis || !name) return [];
      return [{ id, nis: nis.slice(0, 64), nisn: String(row.nisn ?? "").slice(0, 64), name: name.slice(0, 180), className: String(row.className ?? "").slice(0, 100) }];
    });
    const studentIds = new Set(students.map((student) => student.id));
    const transactions: SavingsTransaction[] = (Array.isArray(body?.transactions) ? body.transactions : []).slice(0, 50000).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return []; const row = raw as Record<string, unknown>; const studentId = String(row.studentId ?? ""); const amount = Number(row.amount); const type = row.type === "withdrawal" ? "withdrawal" : row.type === "deposit" ? "deposit" : null;
      if (!studentIds.has(studentId) || !type || !Number.isFinite(amount) || amount <= 0) return [];
      return [{ id: String(row.id ?? crypto.randomUUID()).slice(0, 128), studentId, type, amount, transactionDate: String(row.transactionDate ?? "").slice(0, 20), note: String(row.note ?? "").slice(0, 500), officerName: String(row.officerName ?? "Petugas").slice(0, 150), status: row.status === "void" ? "void" : "active", createdAtMs: Number(row.createdAtMs) || 0 }];
    });
    const share: SavingsShare = { shareId, ownerUid: uid, schoolName: String(body?.schoolName ?? "Sekolah").slice(0, 200), students, transactions, updatedAtMs: Date.now() };
    await putR2Json(env, savingsShareKey(shareId), share, { ownerUid: uid });
    return json({ shareId, studentCount: students.length, transactionCount: transactions.length });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/savings-password-reset") {
    const body = await request.json().catch(() => null) as { studentId?: string } | null; const studentId = body?.studentId?.trim() ?? "";
    if (!safePublicId(studentId, 1)) return json({ error: "Siswa tidak valid" }, 400);
    await env.SMARTATT_R2.delete(savingsCredentialKey(uid, studentId));
    return json({ reset: true });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/accept-guardian-photo") {
    const body = await request.json().catch(() => null) as { sourceKey?: string; studentId?: string } | null;
    const sourceKey = body?.sourceKey ?? ""; const studentId = body?.studentId ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentId) || !sourceKey.startsWith(`guardian-submissions/${uid}/${studentId}/`)) return json({ error: "Sumber foto tidak valid" }, 400);
    const source = await env.SMARTATT_R2.get(sourceKey); if (!source) return json({ error: "Foto kiriman tidak ditemukan" }, 404);
    const contentType = source.httpMetadata?.contentType ?? "image/webp"; if (!contentType.startsWith("image/")) return json({ error: "File bukan foto" }, 415);
    const extension = sourceKey.split(".").pop()?.toLowerCase(); const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "webp";
    const key = `users/${uid}/students/${crypto.randomUUID()}.${safeExtension}`;
    await env.SMARTATT_R2.put(key, source.body, { httpMetadata: { contentType, cacheControl: "private, max-age=3600" }, customMetadata: { ownerUid: uid, studentId, importedFromGuardian: "true" } });
    return json({ key });
  }

  if (request.method === "POST" && url.pathname === "/api/storage/articles") {
    if (account.email.toLowerCase() !== "idhamdjuanda@gmail.com") return json({ error: "Forbidden" }, 403);
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "File tidak ditemukan" }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ error: "Format gambar tidak didukung" }, 415);
    if (file.size > 3 * 1024 * 1024) return json({ error: "Ukuran gambar maksimal 3 MB" }, 413);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `articles/${crypto.randomUUID()}.${extension}`;
    await env.SMARTATT_R2.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=86400" }, customMetadata: { ownerUid: uid, originalName: file.name } });
    return json({ key });
  }
  if (request.method === "POST" && url.pathname === "/api/storage/transfer-student-photo") {
    const body = await request.json().catch(() => null) as { sourceOwnerUid?: string; sourceKey?: string } | null;
    const sourceOwnerUid = body?.sourceOwnerUid ?? ""; const sourceKey = body?.sourceKey ?? "";
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(sourceOwnerUid) || !sourceKey.startsWith(`users/${sourceOwnerUid}/students/`)) return json({ error: "Sumber foto tidak valid" }, 400);
    const source = await env.SMARTATT_R2.get(sourceKey); if (!source) return json({ error: "Foto sumber tidak ditemukan" }, 404);
    const contentType = source.httpMetadata?.contentType ?? ""; if (!contentType.startsWith("image/")) return json({ error: "File sumber bukan foto" }, 415);
    const extension = sourceKey.split(".").pop()?.toLowerCase(); const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "jpg";
    const key = `users/${uid}/students/${crypto.randomUUID()}.${safeExtension}`;
    await env.SMARTATT_R2.put(key, source.body, { httpMetadata: { contentType, cacheControl: "private, max-age=3600" }, customMetadata: { ownerUid: uid, importedFromUid: sourceOwnerUid, importedFromKey: sourceKey } });
    return json({ key });
  }
  if (request.method === "POST" && url.pathname === "/api/storage/photos") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "File tidak ditemukan" }, 400);
    if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type))) return json({ error: "Format foto tidak didukung" }, 415);
    if (file.size > 3 * 1024 * 1024) return json({ error: "Ukuran foto maksimal 3 MB" }, 413);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `users/${uid}/students/${crypto.randomUUID()}.${extension}`;
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
    const key = `users/${uid}/${kind}/${crypto.randomUUID()}.${extension}`;
    await env.SMARTATT_R2.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" }, customMetadata: { ownerUid: uid, kind, originalName: file.name } });
    return json({ key });
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/storage/file/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/storage/file/".length));
    if (!key.startsWith(`users/${uid}/`)) return json({ error: "Forbidden" }, 403);
    const object = await env.SMARTATT_R2.get(key);
    if (!object) return json({ error: "File tidak ditemukan" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    return new Response(object.body, { headers });
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/storage/file/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/storage/file/".length));
    if (!key.startsWith(`users/${uid}/`)) return json({ error: "Forbidden" }, 403);
    await env.SMARTATT_R2.delete(key);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/admin/")) {
      const account = await authenticatedUser(request);
      if (!account) return json({ error: "Unauthorized" }, 401);
      const { handleAdminSchoolDeletion, handleAdminUserDeletion } = await import("./admin-delete.js");
      const response = await handleAdminUserDeletion(request, env, url, account)
        ?? await handleAdminSchoolDeletion(request, env, url, account);
      if (response) return response;
    }

    if (url.pathname.startsWith("/api/storage/")) {
      return handleStorage(request, env, url);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
