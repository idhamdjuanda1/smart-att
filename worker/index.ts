/// <reference types="@cloudflare/workers-types" />
/** Cloudflare Worker entry point for SMART-ATT. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  SMARTATT_R2: R2Bucket;
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

async function handleStorage(request: Request, env: Env, url: URL): Promise<Response> {
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
