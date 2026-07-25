import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildQuizShortUrl,
  generateQuizAccessCode,
  normalizeQuizAccessCode,
  parseQuizLinkInput,
} from "../app/lib/publicLink.ts";

test("kode quiz dibuat dalam format 10 karakter yang mudah diketik", () => {
  const code = generateQuizAccessCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(code.length, 10);
});

test("portal menerima kode, alias route, dan link snapshot lama", () => {
  assert.deepEqual(parseQuizLinkInput("hfujk-96354"), { kind: "accessCode", value: "HFUJK96354" });
  assert.deepEqual(parseQuizLinkInput("https://smart-att.web.id/soal/HFUJK96354"), { kind: "accessCode", value: "HFUJK96354" });
  assert.deepEqual(parseQuizLinkInput("https://smart-att.pages.dev/public/quiz/i7rz73Vinzg7Udeu7xfw"), { kind: "snapshotId", value: "i7rz73Vinzg7Udeu7xfw" });
  assert.equal(normalizeQuizAccessCode("kode tidak valid"), "");
});

test("link produksi selalu memakai domain resmi dan local tetap dapat diuji", () => {
  assert.equal(buildQuizShortUrl("HFUJK96354", "https://smart-att.pages.dev"), "https://smart-att.web.id/link/HFUJK96354");
  assert.equal(buildQuizShortUrl("HFUJK96354", "http://127.0.0.1:3000"), "http://127.0.0.1:3000/link/HFUJK96354");
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
