import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasPermission, normalizeAccountAccess } from "../app/lib/access.ts";

test("akun lama tanpa accountType tetap individual dan mempertahankan hak penuh", () => {
  const profile = normalizeAccountAccess({ role: "teacher" });
  assert.equal(profile.accountType, "individual");
  assert.equal(hasPermission(profile, "students.manage"), true);
  assert.equal(hasPermission(profile, "classes.manage"), true);
  assert.equal(hasPermission(profile, "quiz.manage"), true);
});

test("akun sekolah yang belum onboarding tidak mendapat izin data", () => {
  const profile = normalizeAccountAccess({ accountType: "school", role: "teacher" });
  assert.equal(hasPermission(profile, "students.read"), false);
  assert.equal(hasPermission(profile, "settings.manage"), false);
});

test("guru sekolah hanya mendapat izin operasional pembelajaran", () => {
  const profile = normalizeAccountAccess({ accountType: "school", role: "teacher", schoolRole: "teacher", schoolId: "school_1" });
  assert.equal(hasPermission(profile, "attendance.manage"), true);
  assert.equal(hasPermission(profile, "quiz.manage"), true);
  assert.equal(hasPermission(profile, "grades.manage"), true);
  assert.equal(hasPermission(profile, "students.manage"), false);
  assert.equal(hasPermission(profile, "teachers.manage"), false);
  assert.equal(hasPermission(profile, "classes.manage"), false);
});

test("kepala sekolah penuh dan tata usaha tidak mengelola ujian", () => {
  const base = { accountType: "school", role: "teacher", schoolId: "school_1" };
  const principal = normalizeAccountAccess({ ...base, schoolRole: "principal" });
  const administration = normalizeAccountAccess({ ...base, schoolRole: "administration" });
  assert.equal(hasPermission(principal, "settings.manage"), true);
  assert.equal(hasPermission(principal, "quiz.manage"), true);
  assert.equal(hasPermission(administration, "teachers.manage"), true);
  assert.equal(hasPermission(administration, "schedule.manage"), true);
  assert.equal(hasPermission(administration, "quiz.manage"), false);
});

test("alias role TU lama tetap mendapat permission administrasi", () => {
  const profile = normalizeAccountAccess({ accountType: "school", schoolRole: "tu", schoolId: "school_1", role: "teacher" });
  assert.equal(profile.schoolRole, "administration");
  assert.equal(hasPermission(profile, "teachers.manage"), true);
  assert.equal(hasPermission(profile, "classes.manage"), true);
});

test("routing memisahkan dashboard sekolah dan dashboard individual", async () => {
  const source = await readFile(new URL("../app/components/SmartAttApp.tsx", import.meta.url), "utf8");
  assert.match(source, /accountAccess\.accountType === "school"/);
  assert.match(source, /<SchoolOnboarding/);
  assert.match(source, /<SchoolWorkspace/);
  assert.match(source, /return <><DashboardShell/);
});

test("workspace sekolah menghentikan status loading setelah profil sekolah terbaca", async () => {
  const source = await readFile(new URL("../app/components/SchoolWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(snapshot\.exists\(\)\) setSchool/);
  assert.match(source, /setLoading\(false\);/);
  assert.doesNotMatch(source, /return \(\) => stops\.forEach\(\(stop\) => stop\(\)\);\s*setLoading\(false\)/);
});

test("email kartu sekolah terpisah dari email login dan dipakai pada semua tampilan siswa", async () => {
  const source = await readFile(new URL("../app/components/SchoolWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /cardDeliveryEmail/);
  assert.match(source, /Email penerima kartu pelajar/);
  assert.match(source, /cardDeliveryEmail\|\|user\.email/);
  assert.doesNotMatch(source, /updateEmail\(/);
  assert.match(source, /<ClassDetailPanel user=\{user\}/);
});

test("pergantian tahun menyimpan arsip digital dan menyediakan cetak riwayat", async () => {
  const source = await readFile(new URL("../app/components/SchoolWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /workspaceDoc\(scope,"academicYears",fromId\)/);
  assert.match(source, /archiveStatus:"preparing"/);
  assert.match(source, /Cetak arsip tahun ini/);
  assert.match(source, /Riwayat Tahun Ajaran/);
  assert.match(source, /printYearArchive/);
});

test("rules menyimpan koleksi sekolah terpisah dan memeriksa penugasan kelas", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/schools\/\{schoolId\}/);
  assert.match(rules, /function hasAssignedClassId/);
  assert.match(rules, /function hasAssignedClassName/);
  assert.match(rules, /function isSchoolOnboardingAdminAfter/);
  assert.match(rules, /settingId == 'academic' && isSchoolOnboardingAdminAfter\(schoolId\)/);
  assert.match(rules, /match \/academicYears\/\{academicYearId\}/);
  assert.match(rules, /match \/teachingAssignments\/\{assignmentId\}/);
  assert.match(rules, /schoolOnboardingUpdate/);
  assert.match(rules, /request\.resource\.data\.schoolRole == 'teacher'/);
});
