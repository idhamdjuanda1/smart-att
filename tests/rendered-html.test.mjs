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

  const [articles, worker] = await Promise.all([
    readFile(new URL("../app/components/ArticleViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);  assert.match(app, /<ScannerViewPro/);
  assert.match(app, /<AttendanceViewPro/);
  assert.match(app, /<PublicQuizProfessional/);
  assert.match(operations, /Kamera siap untuk siswa berikutnya/);
  assert.match(operations, /Belum Absen/);
  assert.match(examPortal, /Ujian dimulai dalam/);
  assert.match(examPortal, /Top 5 Ranking/);
  assert.match(examPortal, /Review jawaban/);
  assert.match(admin, /Aktivasi token/);
  assert.match(admin, /Manajemen User/);
  assert.match(admin, /ditambahkan dan tersimpan permanen/);
  assert.match(app, /Masa aktif SMART-ATT berakhir/);
  assert.match(app, /Chat WhatsApp/);
  assert.match(operations, /importedFromUid/);
  assert.match(operations, /student\.guardian/);
  assert.match(app, /6285176932228/);
  assert.match(app, /Beli token SMART-ATT via WhatsApp/);
  assert.match(app, /Status akun belum terbaca/);
  assert.match(app, /setShowVerificationError\(true\), 6000/);
  assert.match(app, /accountGate\.verificationError && !showVerificationError/);
  assert.match(app, /accountGate\.expiryMs > 0/);
  assert.match(app, /accountExpiresAtMs/);
  assert.match(rules, /match \/activationTokens/);
  assert.match(rules, /match \/publicQuizDeviceLocks/);
  assert.match(examPortal, /sedang login di perangkat\/sesi lain/);
  assert.match(examPortal, /clientSessionId/);
  assert.match(examPortal, /randomSeed/);
  assert.match(rules, /data\.endAt <= request\.time/);
  assert.match(operations, /attendanceDate/);
  assert.match(operations, /record\?\.status\s*===\s*"present"/);
  assert.match(operations, /record\?\.status \?\? "alpha"/);
  assert.match(operations, /Hadir terlambat/);
  assert.match(operations, /Ringkasan bulanan/);
  assert.match(operations, /Ringkasan semester/);
  assert.match(operations, /Persentase kehadiran/);
  assert.match(operations, /Cari nama \/ NIS/);
  assert.match(operations, /bukan bagian dari Data Siswa Anda\. Absensi ditolak/);
  assert.doesNotMatch(operations, /setDoc\(crossRef/);
  assert.match(rules, /match \/studentDirectory/);
  assert.match(rules, /allow list: if false/);
  assert.match(rules, /match \/crossClassAttendance/);
  assert.match(rules, /match \/articles/);
  assert.match(articles, /Membangun Kebiasaan Hadir Tepat Waktu/);
  assert.match(articles, /ArticleManager/);
  assert.match(app, /LoginArticlePreview variant="light"/);
  assert.match(articles, /variant="dark"/);
  assert.match(worker, /api\/storage\/articles/);
  assert.match(worker, /api\/storage\/article/);
  assert.match(app, /Pindai siswa lama/);
  assert.match(app, /studentClassLinks/);
  assert.match(app, /menunggu persetujuan guru lama/);
  assert.match(rules, /match \/studentClassLinks/);
  assert.match(worker, /api\/storage\/transfer-student-photo/);
  assert.doesNotMatch(operations, /ownerUid !== user\.uid\) await setDoc\(doc\(db, "users"/);
  assert.doesNotMatch(`${app}\n${operations}\n${examPortal}\n${admin}`, /localStorage|sessionStorage/);
});
