import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SMART-ATT application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SMART-ATT/i);
  assert.match(html, /Menyiapkan SMART-ATT/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("includes professional attendance, exam, token, and admin modules", async () => {
  const [app, operations, examPortal, admin, rules] = await Promise.all([
    readFile(new URL("../app/components/SmartAttApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/OperationalViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ExamPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AdminViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  ]);
  assert.match(app, /<ScannerViewPro/);
  assert.match(app, /<AttendanceViewPro/);
  assert.match(app, /<PublicQuizProfessional/);
  assert.match(operations, /Kamera siap untuk siswa berikutnya/);
  assert.match(operations, /Belum Absen/);
  assert.match(examPortal, /Ujian dimulai dalam/);
  assert.match(examPortal, /Top 5 Ranking/);
  assert.match(examPortal, /Review jawaban/);
  assert.match(admin, /Aktivasi token/);
  assert.match(admin, /Manajemen User/);
  assert.match(rules, /match \/activationTokens/);
  assert.match(rules, /match \/publicQuizDeviceLocks/);
  assert.match(examPortal, /sedang login di perangkat\/sesi lain/);
  assert.match(examPortal, /clientSessionId/);
  assert.match(examPortal, /randomSeed/);
  assert.match(rules, /data\.endAt <= request\.time/);
  assert.doesNotMatch(`${app}\n${operations}\n${examPortal}\n${admin}`, /localStorage|sessionStorage/);
});