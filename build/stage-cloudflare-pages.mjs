import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const distClient = resolve(root, "dist", "client");
const distServer = resolve(root, "dist", "server");
const pagesOutput = resolve(root, ".pages-deploy");
const workerBundle = resolve(pagesOutput, "_worker");

const workerSource = String.raw`import rscHandler from "./_worker/index.js";

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

async function handleStorage(request, env, url) {
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
await writeFile(
  resolve(pagesOutput, "_worker.js"),
  workerSource,
);
