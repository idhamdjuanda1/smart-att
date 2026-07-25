import assert from "node:assert/strict";
import test from "node:test";
import {
  deletionTargetEmail,
  handleAdminSchoolDeletion,
  handleAdminUserDeletion,
  schoolDeletionConfirmationMatches,
} from "../worker/admin-delete.js";

const endpoint = "https://smart-att.web.id/api/admin/users/test-user-123";

test("penghapusan permanen hanya dapat dipanggil superadmin", async () => {
  const request = new Request(endpoint, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", confirmation: "HAPUS PERMANEN" }),
  });
  const response = await handleAdminUserDeletion(request, {}, new URL(endpoint), { uid: "ordinary-user", email: "guru@example.com" });
  assert.equal(response.status, 403);
});

test("superadmin tidak dapat menghapus akunnya sendiri", async () => {
  const selfEndpoint = "https://smart-att.web.id/api/admin/users/super-user-123";
  const request = new Request(selfEndpoint, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "idhamdjuanda@gmail.com", confirmation: "HAPUS PERMANEN" }),
  });
  const response = await handleAdminUserDeletion(request, {}, new URL(selfEndpoint), { uid: "super-user-123", email: "idhamdjuanda@gmail.com" });
  assert.equal(response.status, 400);
});

test("server menolak penghapusan sampai kredensial Firebase Admin tersedia", async () => {
  const request = new Request(endpoint, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", confirmation: "HAPUS PERMANEN" }),
  });
  const response = await handleAdminUserDeletion(request, {}, new URL(endpoint), { uid: "super-user-123", email: "idhamdjuanda@gmail.com" });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.match(result.error, /belum dikonfigurasi/i);
});

test("akun tanpa Firebase Authentication tetap dapat memakai email profil Firestore", () => {
  const profile = { fields: { email: { stringValue: " Hanasyafa@Gmail.com " } } };
  assert.equal(deletionTargetEmail(null, profile), "hanasyafa@gmail.com");
});

test("email Firebase Authentication tetap menjadi sumber utama", () => {
  const profile = { fields: { email: { stringValue: "lama@example.com" } } };
  assert.equal(deletionTargetEmail({ email: "BARU@example.com" }, profile), "baru@example.com");
});

test("penghapusan sekolah hanya dapat dipanggil superadmin", async () => {
  const schoolEndpoint = "https://smart-att.web.id/api/admin/schools/school_test_123";
  const request = new Request(schoolEndpoint, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schoolName: "SMP Uji", confirmation: "HAPUS SEKOLAH PERMANEN" }),
  });
  const response = await handleAdminSchoolDeletion(request, {}, new URL(schoolEndpoint), { uid: "ordinary-user", email: "guru@example.com" });
  assert.equal(response.status, 403);
});

test("konfirmasi penghapusan sekolah mencocokkan nama dan frasa", () => {
  assert.equal(schoolDeletionConfirmationMatches("SMP Uji", " smp uji ", " hapus sekolah permanen "), true);
  assert.equal(schoolDeletionConfirmationMatches("SMP Uji", "SMP Lain", "HAPUS SEKOLAH PERMANEN"), false);
});

test("penghapusan sekolah memerlukan kredensial Firebase Admin", async () => {
  const schoolEndpoint = "https://smart-att.web.id/api/admin/schools/school_test_123";
  const request = new Request(schoolEndpoint, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schoolName: "SMP Uji", confirmation: "HAPUS SEKOLAH PERMANEN" }),
  });
  const response = await handleAdminSchoolDeletion(request, {}, new URL(schoolEndpoint), { uid: "super-user-123", email: "idhamdjuanda@gmail.com" });
  assert.equal(response.status, 503);
});
