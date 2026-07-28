import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildQuizShortUrl,
  generateQuizAccessCode,
  normalizeQuizAccessCode,
  parseQuizLinkInput,
} from "../app/lib/publicLink.ts";

test("kode quiz dibuat dalam format 4 angka yang mudah diketik", () => {
  const code = generateQuizAccessCode(new Uint8Array([0, 1, 2, 3]));
  assert.match(code, /^\d{4}$/);
  assert.equal(code.length, 4);
  assert.equal(code, "0123");
});

test("portal menerima kode 4 angka, 10 karakter lama, alias route, dan link snapshot", () => {
  assert.deepEqual(parseQuizLinkInput("8492"), { kind: "accessCode", value: "8492" });
  assert.deepEqual(parseQuizLinkInput("hfujk-96354"), { kind: "accessCode", value: "HFUJK96354" });
  assert.deepEqual(parseQuizLinkInput("https://smart-att.web.id/soal/8492"), { kind: "accessCode", value: "8492" });
  assert.deepEqual(parseQuizLinkInput("https://smart-att.pages.dev/public/quiz/i7rz73Vinzg7Udeu7xfw"), { kind: "snapshotId", value: "i7rz73Vinzg7Udeu7xfw" });
  assert.equal(normalizeQuizAccessCode("kode tidak valid"), "");
});

test("link produksi selalu memakai domain resmi dan local tetap dapat diuji", () => {
  assert.equal(buildQuizShortUrl("8492", "https://smart-att.pages.dev"), "https://smart-att.web.id/link/8492");
  assert.equal(buildQuizShortUrl("8492", "http://127.0.0.1:3000"), "http://127.0.0.1:3000/link/8492");
});

test("source menyimpan pemetaan kode dan rules membatasi akses publik", async () => {
  const [app, rules, deletion] = await Promise.all([
    readFile(new URL("../app/components/SmartAttApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../worker/admin-delete.js", import.meta.url), "utf8"),
  ]);
  assert.match(app, /publicLinkCodes/);
  assert.match(app, /runTransaction/);
  assert.match(rules, /match \/publicLinkCodes\/\{linkCode\}/);
  assert.match(rules, /allow get: if resource\.data\.published == true \|\| signedIn\(\)/);
  assert.match(rules, /allow list: if false/);
  assert.match(deletion, /\["publicLinkCodes", "ownerUid"\]/);
});
