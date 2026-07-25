import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findScheduleConflict,
  generateSchoolSchedule,
  getScheduleReadiness,
  scheduleBlockCrossesBreak,
  scheduleBreakTimes,
  scheduleTimes,
} from "../app/lib/schoolSchedule.ts";
import { normalizeClassKey, parseTeachersCsv } from "../app/lib/csv.ts";
import { distributeTeacherLoads, summarizeStaffingPlan } from "../app/lib/schoolStaffing.ts";

const config = { days: ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"], dayStartTime: "07:00", periodMinutes: 40, periodsPerDay: 8 };

test("validasi kebutuhan menandai kelas tanpa guru dan kelas tanpa penugasan", () => {
  const assignments = [{ id: "a1", teacherUid: "", subjectId: "math", classId: "7a", weeklyPeriods: 4 }];
  const result = getScheduleReadiness(assignments, ["7a", "7b"], ["math"], ["teacher-1"], 40);
  assert.equal(result.ready, false);
  assert.equal(result.missingTeacherAssignments[0].id, "a1");
  assert.deepEqual(result.classesWithoutAssignments, ["7b"]);
  assert.equal(result.totalRequiredPeriods, 4);
});

test("generator memenuhi JP dan tidak membuat guru atau kelas bentrok", () => {
  const assignments = [
    { id: "a1", teacherUid: "teacher-1", subjectId: "math", classId: "7a", weeklyPeriods: 4 },
    { id: "a2", teacherUid: "teacher-1", subjectId: "math", classId: "7b", weeklyPeriods: 4 },
    { id: "a3", teacherUid: "teacher-2", subjectId: "science", classId: "7a", weeklyPeriods: 3 },
  ];
  const result = generateSchoolSchedule(assignments, config);
  assert.deepEqual(result.failures, []);
  assert.equal(result.schedules.reduce((total, item) => total + item.periodCount, 0), 11);
  for (let index = 0; index < result.schedules.length; index += 1) {
    const current = result.schedules[index];
    assert.equal(findScheduleConflict(current, result.schedules, current.id), undefined);
  }
});

test("generator melaporkan JP yang tidak memperoleh slot", () => {
  const result = generateSchoolSchedule([
    { id: "a1", teacherUid: "teacher-1", subjectId: "math", classId: "7a", weeklyPeriods: 4 },
  ], { ...config, days: ["Senin"], periodsPerDay: 2 });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].missingPeriods, 2);
});

test("deteksi bentrok menolak guru atau kelas pada waktu yang sama", () => {
  const existing = [{ id: "s1", day: "Senin", startTime: "07:00", endTime: "08:20", teacherUid: "teacher-1", classId: "7a" }];
  assert.equal(findScheduleConflict({ id: "s2", day: "Senin", startTime: "07:40", endTime: "08:20", teacherUid: "teacher-1", classId: "7b" }, existing)?.id, "s1");
  assert.equal(findScheduleConflict({ id: "s3", day: "Senin", startTime: "07:40", endTime: "08:20", teacherUid: "teacher-2", classId: "7a" }, existing)?.id, "s1");
  assert.equal(findScheduleConflict({ id: "s4", day: "Selasa", startTime: "07:00", endTime: "08:20", teacherUid: "teacher-1", classId: "7a" }, existing), undefined);
});

test("jam pelajaran bergeser setelah istirahat dan blok tidak melintasi istirahat", () => {
  const configWithBreaks = {
    ...config,
    breaks: [
      { afterPeriod: 3, durationMinutes: 20, label: "Istirahat 1" },
      { afterPeriod: 6, durationMinutes: 20, label: "Istirahat 2" },
    ],
  };
  assert.deepEqual(scheduleBreakTimes(configWithBreaks, configWithBreaks.breaks[0]), { startTime: "09:00", endTime: "09:20" });
  assert.deepEqual(scheduleTimes(configWithBreaks, 3, 1), { startTime: "09:20", endTime: "10:00" });
  assert.deepEqual(scheduleTimes(configWithBreaks, 6, 1), { startTime: "11:40", endTime: "12:20" });
  assert.equal(scheduleBlockCrossesBreak(configWithBreaks, 2, 2), true);
  const result = generateSchoolSchedule([{ id: "break-safe", teacherUid: "teacher-1", subjectId: "math", classId: "7a", weeklyPeriods: 8 }], configWithBreaks);
  assert.ok(result.schedules.every((item) => !scheduleBlockCrossesBreak(configWithBreaks, item.periodStart, item.periodCount)));
});

test("import CSV mencocokkan kelas dengan spasi, minus, atau underscore", () => {
  assert.equal(normalizeClassKey("VII B"), normalizeClassKey("VII-B"));
  assert.equal(normalizeClassKey("VII B"), normalizeClassKey("vii_b"));
  assert.equal(normalizeClassKey("X IPA 1"), normalizeClassKey("X-IPA-1"));
});

test("import CSV guru menerima mapel utama, tambahan, dan kelas opsional", () => {
  const parsed = parseTeachersCsv("Nama,Email,Password,Mapel Utama,Mapel Tambahan,Kelas\nIbu Dijah,dijah@example.com,Rahasia123,Matematika,Informatika;Fisika,\nPak Budi,budi@example.com,Pass1234,Bahasa Indonesia,,VII A|VII B");
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.teachers.length, 2);
  assert.deepEqual(parsed.teachers[0].additionalSubjects, ["Informatika", "Fisika"]);
  assert.deepEqual(parsed.teachers[0].classNames, []);
  assert.deepEqual(parsed.teachers[1].classNames, ["VII A", "VII B"]);
});

test("perencanaan guru otomatis membagi beban merata tanpa melewati 40 JP", () => {
  const assignments = Array.from({ length: 9 }, (_, index) => ({ id: `math-${index}`, subjectId: "math", classId: `class-${index}`, weeklyPeriods: 5 }));
  const plan = distributeTeacherLoads(assignments, [
    { uid: "teacher-a", subjectIds: ["math"] },
    { uid: "teacher-b", subjectIds: ["math"] },
  ]);
  assert.equal(plan.unassigned.length, 0);
  assert.equal(plan.teacherLoads["teacher-a"] + plan.teacherLoads["teacher-b"], 45);
  assert.ok(plan.teacherLoads["teacher-a"] <= 40);
  assert.ok(plan.teacherLoads["teacher-b"] <= 40);
  assert.ok(Math.abs(plan.teacherLoads["teacher-a"] - plan.teacherLoads["teacher-b"]) <= 5);
});

test("perencanaan guru otomatis melaporkan JP yang melebihi kapasitas guru", () => {
  const assignments = Array.from({ length: 9 }, (_, index) => ({ id: `math-${index}`, subjectId: "math", classId: `class-${index}`, weeklyPeriods: 5 }));
  const plan = distributeTeacherLoads(assignments, [{ uid: "teacher-a", subjectIds: ["math"] }]);
  assert.equal(plan.teacherLoads["teacher-a"], 40);
  assert.equal(plan.unassigned.reduce((total, item) => total + item.weeklyPeriods, 0), 5);
});

test("guru sesuai bidang diprioritaskan sebelum guru lintas bidang", () => {
  const assignments = Array.from({ length: 9 }, (_, index) => ({ id: `science-${index}`, subjectId: "science", classId: `class-${index}`, weeklyPeriods: 5 }));
  const plan = distributeTeacherLoads(assignments, [
    { uid: "science-teacher", primarySubjectIds: ["science"], subjectIds: ["science"] },
    { uid: "social-teacher", primarySubjectIds: ["social"], additionalSubjectIds: ["science"], subjectIds: ["social", "science"] },
  ]);
  assert.equal(plan.teacherLoads["science-teacher"], 40);
  assert.equal(plan.teacherLoads["social-teacher"], 5);
  assert.equal(plan.assignments.filter((item) => item.assignmentType === "cross-field").length, 1);
  assert.equal(summarizeStaffingPlan(plan.assignments, [
    { uid: "science-teacher", primarySubjectIds: ["science"] },
    { uid: "social-teacher", primarySubjectIds: ["social"], additionalSubjectIds: ["science"] },
  ]).crossFieldPeriods, 5);
});

test("kesimpulan matematis menghitung rata-rata, kekurangan, dan surplus guru", () => {
  const assignments = [
    { id: "math-a", subjectId: "math", classId: "7a", weeklyPeriods: 5 },
    { id: "math-b", subjectId: "math", classId: "7b", weeklyPeriods: 5 },
    { id: "math-c", subjectId: "math", classId: "7c", weeklyPeriods: 5 },
    { id: "art-a", subjectId: "art", classId: "7a", weeklyPeriods: 3 },
    { id: "physics-a", subjectId: "physics", classId: "7a", weeklyPeriods: 3 },
    { id: "physics-b", subjectId: "physics", classId: "7b", weeklyPeriods: 3 },
  ];
  const teachers = [
    { uid: "math-teacher", subjectIds: ["math"] },
    { uid: "physics-1", subjectIds: ["physics"] },
    { uid: "physics-2", subjectIds: ["physics"] },
  ];
  const plan = distributeTeacherLoads(assignments, teachers);
  const summary = summarizeStaffingPlan(plan.assignments, teachers);
  assert.equal(summary.totalRequiredPeriods, 24);
  assert.equal(summary.missingPeriods, 3);
  assert.equal(summary.subjects.find((item) => item.subjectId === "art").shortageTeacherCount, 1);
  assert.equal(summary.subjects.find((item) => item.subjectId === "physics").surplusTeacherCount, 1);
  assert.equal(summary.teachers.find((item) => item.uid === "math-teacher").classCount, 3);
  assert.equal(summary.averagePeriodsPerTeacher, 7);
});

test("UI sekolah menyediakan penugasan JP, generator, drag-drop, dan Jadwal Saya", async () => {
  const source = await readFile(new URL("../app/components/SchoolWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /function TeachingAssignmentsPanel/);
  assert.match(source, /Generate Jadwal Otomatis/);
  assert.match(source, /draggable=\{editable\}/);
  assert.match(source, /label: "Jadwal Saya"/);
  assert.match(source, /Import CSV ke/);
  assert.match(source, /Import CSV Semua Kelas/);
  assert.match(source, /Unduh template CSV/);
  assert.match(source, /Kelas CSV tidak ditemukan/);
  assert.match(source, /Kelas \(sekaligus filter tabel\)/);
  assert.match(source, /Menampilkan siswa kelas/);
  assert.match(source, /No\. Urut/);
  assert.match(source, />\{index\+1\}<\/td>/);
  assert.doesNotMatch(source, /item\.attendanceNumber\|\|index\+1/);
  assert.match(source, /a\.name\.localeCompare\(b\.name,"id-ID",\{sensitivity:"base"\}\)/);
});

test("mapel umum Indonesia tersedia otomatis sesuai jenjang dan tetap dapat ditambah", async () => {
  const source = await readFile(new URL("../app/components/SchoolWorkspace.tsx", import.meta.url), "utf8");
  const registrationSource = await readFile(new URL("../app/components/PublicTeacherRegistration.tsx", import.meta.url), "utf8");
  assert.match(source, /DEFAULT_SUBJECTS_BY_LEVEL/);
  assert.match(source, /Ilmu Pengetahuan Alam dan Sosial/);
  assert.match(source, /Ilmu Pengetahuan Alam/);
  assert.match(source, /Biologi/);
  assert.match(source, /Projek Kreatif dan Kewirausahaan/);
  assert.match(source, /Lengkapi mapel & JP/);
  assert.match(source, /Tambah mapel lain/);
  assert.match(source, /Nama atau kode mata pelajaran sudah digunakan/);
  assert.match(source, /defaultWeeklyPeriods/);
  assert.match(source, /JP terisi otomatis dari master mata pelajaran/);
  assert.match(source, /Hitung & Bagi Guru Otomatis/);
  assert.match(source, /Analisis Kebutuhan Guru/);
  assert.match(source, /source:"automatic-staffing"/);
  assert.match(source, />Bidang utama:<\/span>/);
  assert.match(source, /Kesimpulan Matematis/);
  assert.match(source, /Tidak menggunakan AI/);
  assert.match(source, /kandidat redistribusi antarsekolah melalui Dinas/);
  assert.match(source, /Mapel tambahan yang diizinkan/);
  assert.match(source, /Edit guru/);
  assert.match(source, /Import CSV guru sekolah/);
  assert.match(source, /parseTeachersCsv/);
  assert.match(source, /Kolom Kelas boleh dikosongkan/);
  assert.match(source, /Guru sesuai bidang selalu diprioritaskan/);
  assert.match(source, /Penugasan lintas bidang aktif/);
  assert.match(source, /Mata Pelajaran/);
  assert.match(source, /CurriculumSetupPanel/);
  assert.match(source, /curriculumProfiles/);
  assert.match(source, /Program keahlian SMK/);
  assert.match(source, /Cakupan penerapan/);
  assert.match(source, /classIds/);
  assert.match(source, /programIds/);
  assert.match(source, /Nonaktifkan/);
  assert.match(source, /gradeNames/);
  assert.match(source, /Muatan Lokal/);
  assert.match(source, /Bahasa Jepang/);
  assert.match(source, /public\/teacher-register/);
  assert.match(registrationSource, /willingCrossSubject/);
  assert.match(source, /schoolLevel/);
});
