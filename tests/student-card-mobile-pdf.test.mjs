import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { handleGeneratedPdfDownload, handleGenerateStudentCardsPdf, splitPdfBatches } from "../worker/student-card-pdf.js";

function r2Mock() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) : new TextEncoder().encode(String(value));
      objects.set(key, { bytes, options, uploaded: new Date() });
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {
        body: new Response(item.bytes).body,
        httpMetadata: item.options.httpMetadata,
        arrayBuffer: async () => item.bytes.slice().buffer,
        json: async () => JSON.parse(new TextDecoder().decode(item.bytes)),
      };
    },
    async delete(keyOrKeys) {
      for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) objects.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, item]) => ({ key, uploaded: item.uploaded })) };
    },
  };
}

test("mobile PDF is generated, stored in R2, emailed, and downloadable", async () => {
  const r2 = r2Mock();
  let renderedHtml = "";
  let emailPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://api.resend.com/emails") {
      emailPayload = JSON.parse(String(init.body));
      return Response.json({ id: "email_test" });
    }
    return originalFetch(input, init);
  };
  try {
    await r2.put("users/teacher-1/photos/student.jpg", new Uint8Array(600_000).buffer, { httpMetadata: { contentType: "image/jpeg" } });
    const env = {
      SMARTATT_R2: r2,
      RESEND_API_KEY: "test-only-key",
      PDF_EMAIL_FROM: "SMART-ATT <noreply@smart-att.web.id>",
      PUBLIC_APP_URL: "https://smart-att.web.id",
      ASSETS: { fetch: async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) },
      BROWSER: { quickAction: async (action, options) => { assert.equal(action, "pdf"); renderedHtml = options.html; const document = await PDFDocument.create(); document.addPage([595, 842]); return new Response(await document.save(), { headers: { "content-type": "application/pdf" } }); } },
    };
    const request = new Request("https://smart-att.web.id/api/storage/generate-student-cards-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schoolName: "SD Uji", academicYear: "2026/2027", email: "kartu@sd-uji.sch.id", template: "photo", layout: "a4-8", orientation: "portrait", students: [{ id: "student-1", nis: "1001", nisn: "2001", name: "Siswa Uji", className: "V-A", photoKey: "users/teacher-1/photos/student.jpg" }] }) });
    const response = handleGenerateStudentCardsPdf(request, env, new URL(request.url), { uid: "teacher-1", email: "guru@example.com" });
    assert.ok(response);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, "complete");
    assert.equal(events.at(-1).percent, 100);
    assert.match(renderedHtml, /Siswa Uji/);
    assert.match(renderedHtml, /data:image\/jpeg;base64/);
    assert.equal(emailPayload.to[0], "kartu@sd-uji.sch.id");
    assert.equal([...r2.objects.keys()].filter((key) => key.endsWith(".pdf")).length, 1);
    const downloadUrl = emailPayload.html.match(/href="([^"]+)"/)[1];
    assert.match(downloadUrl, /\/api\/storage\/generated-pdf\/[a-f0-9]{64}$/);
    const download = await handleGeneratedPdfDownload(new Request(downloadUrl), env, new URL(downloadUrl));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.equal(new TextDecoder().decode((await download.arrayBuffer()).slice(0, 4)), "%PDF");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("large card sets are split only at page boundaries", () => {
  const photoData = `data:image/jpeg;base64,${"A".repeat(500_000)}`;
  const students = Array.from({ length: 16 }, (_, index) => ({ id: `student-${index}`, nis: String(index), nisn: "-", name: `Siswa ${index}`, className: "V-A", photoData, qrSvg: "<svg></svg>" }));
  const batches = splitPdfBatches(students, { schoolName: "SD Uji", academicYear: "2026/2027", template: "photo", layout: "a4-8", orientation: "portrait", appLogo: "data:image/png;base64,AA==", schoolLogo: null }, 5 * 1024 * 1024, 6 * 1024 * 1024);
  assert.deepEqual(batches.map((batch) => batch.length), [8, 8]);
});
