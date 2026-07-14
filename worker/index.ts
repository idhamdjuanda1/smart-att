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

async function authenticatedUid(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const idToken = authorization.slice(7);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { users?: Array<{ localId?: string }> };
  return body.users?.[0]?.localId ?? null;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function handleStorage(request: Request, env: Env, url: URL): Promise<Response> {
  const uid = await authenticatedUid(request);
  if (!uid) return json({ error: "Unauthorized" }, 401);

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
