"use client";

import React, { useState } from "react";
import { collection, doc, getDoc, serverTimestamp, writeBatch, WriteBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Building2, CheckCircle2, AlertCircle, Loader2, Sparkles, ShieldCheck, Users, School, BookOpen, Calendar, Clock, Award, LogIn, ExternalLink, KeyRound, Copy, Check } from "lucide-react";

export interface DemoGeneratorSummary {
  schoolName: string;
  teacherCount: number;
  studentCount: number;
  classCount: number;
  subjectCount: number;
  scheduleCount: number;
  attendanceSessionCount: number;
  gradeCount: number;
  totalAccountCount: number;
}

const DEMO_SCHOOL_ID = "school_demo_sma_1";

async function commitInChunks(operations: Array<(batch: WriteBatch) => void>) {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }
}

export function DemoGeneratorPanel({ onSelectDemoRole }: { onSelectDemoRole?: (role: "principal" | "administration" | "teacher") => void }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<DemoGeneratorSummary | null>(null);
  const [error, setError] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [copiedRole, setCopiedRole] = useState<string | null>(null);

  const teachersDef = [
    { key: "kepsek", name: "Dr. H. Ahmad Sudirman, M.Pd", nip: "197001011995011001", gender: "L", birthPlace: "Jakarta", birthDate: "1970-01-15", address: "Jl. Melati No. 1, Jakarta", phone: "081234567801", email: "kepsek.demo@smart-att.web.id", role: "principal", subjectName: "Manajemen Sekolah", subjectId: "" },
    { key: "wakasek", name: "Dra. Hj. Siti Rahmawati, M.Si", nip: "197203151997022002", gender: "P", birthPlace: "Bandung", birthDate: "1972-03-20", address: "Jl. Mawar No. 2, Jakarta", phone: "081234567802", email: "wakasek.demo@smart-att.web.id", role: "administration", subjectName: "Kurikulum", subjectId: "" },
    { key: "tu", name: "Budi Santoso, S.Kom", nip: "198506102008011003", gender: "L", birthPlace: "Semarang", birthDate: "1985-06-10", address: "Jl. Anggrek No. 3, Jakarta", phone: "081234567803", email: "tu.demo@smart-att.web.id", role: "administration", subjectName: "Tata Usaha", subjectId: "" },
    { key: "bk", name: "Rina Agustina, S.Psi", nip: "198808202012022004", gender: "P", birthPlace: "Surabaya", birthDate: "1988-08-20", address: "Jl. Dahlia No. 4, Jakarta", phone: "081234567804", email: "bk.demo@smart-att.web.id", role: "teacher", subjectName: "Bimbingan Konseling", subjectId: "subj_bk" },
    { key: "mtk", name: "Bambang Wijaya, S.Pd", nip: "198204122006041005", gender: "L", birthPlace: "Yogyakarta", birthDate: "1982-04-12", address: "Jl. Kenanga No. 5, Jakarta", phone: "081234567805", email: "guru.mtk@smart-att.web.id", role: "teacher", subjectName: "Matematika", subjectId: "subj_mtk", homeroomFor: "X-A" },
    { key: "bin", name: "Dewi Lestari, M.Pd", nip: "198409152009032006", gender: "P", birthPlace: "Solo", birthDate: "1984-09-15", address: "Jl. Kamboja No. 6, Jakarta", phone: "081234567806", email: "guru.bin@smart-att.web.id", role: "teacher", subjectName: "Bahasa Indonesia", subjectId: "subj_bin", homeroomFor: "X-B" },
    { key: "big", name: "John Smith, M.Ed", nip: "198611252010011007", gender: "L", birthPlace: "Medan", birthDate: "1986-11-25", address: "Jl. Cempaka No. 7, Jakarta", phone: "081234567807", email: "guru.big@smart-att.web.id", role: "teacher", subjectName: "Bahasa Inggris", subjectId: "subj_big", homeroomFor: "XII-A" },
    { key: "ipa", name: "Ir. Hendra Prasetyo, M.T", nip: "198005182005021008", gender: "L", birthPlace: "Malang", birthDate: "1980-05-18", address: "Jl. Flamboyan No. 8, Jakarta", phone: "081234567808", email: "guru.ipa@smart-att.web.id", role: "teacher", subjectName: "IPA", subjectId: "subj_ipa", homeroomFor: "XII-B" },
    { key: "ips", name: "Drs. Eko Wahyudi", nip: "197802282003121009", gender: "L", birthPlace: "Bogor", birthDate: "1978-02-28", address: "Jl. Teratai No. 9, Jakarta", phone: "081234567809", email: "guru.ips@smart-att.web.id", role: "teacher", subjectName: "IPS", subjectId: "subj_ips", homeroomFor: "XIII-A" },
    { key: "agama", name: "H. Muhammad Ridwan, S.Ag", nip: "198107142007011010", gender: "L", birthPlace: "Cirebon", birthDate: "1981-07-14", address: "Jl. Jasmine No. 10, Jakarta", phone: "081234567810", email: "guru.agama@smart-att.web.id", role: "teacher", subjectName: "Agama", subjectId: "subj_pabp", homeroomFor: "XIII-B" },
    { key: "inf", name: "Arief Hidayat, S.Kom", nip: "199003102015031011", gender: "L", birthPlace: "Bandung", birthDate: "1990-03-10", address: "Jl. Tulip No. 11, Jakarta", phone: "081234567811", email: "guru.inf@smart-att.web.id", role: "teacher", subjectName: "Informatika", subjectId: "subj_inf" },
    { key: "pjok", name: "Doni Kusuma, S.Pd", nip: "198912052014021012", gender: "L", birthPlace: "Palembang", birthDate: "1989-12-05", address: "Jl. Sakura No. 12, Jakarta", phone: "081234567812", email: "guru.pjok@smart-att.web.id", role: "teacher", subjectName: "PJOK", subjectId: "subj_pjok" },
    { key: "sbd", name: "Maya Putri, S.Sn", nip: "199201182018012013", gender: "P", birthPlace: "Bali", birthDate: "1992-01-18", address: "Jl. Palm No. 13, Jakarta", phone: "081234567813", email: "guru.sbd@smart-att.web.id", role: "teacher", subjectName: "Seni Budaya", subjectId: "subj_sbd" },
    { key: "eko", name: "Sri Wahyuni, S.E., M.M", nip: "198310082008022014", gender: "P", birthPlace: "Surakarta", birthDate: "1983-10-08", address: "Jl. Bougainville No. 14, Jakarta", phone: "081234567814", email: "guru.eko@smart-att.web.id", role: "teacher", subjectName: "Ekonomi", subjectId: "subj_eko" },
  ];

  function copyDirectLink(roleParam: string) {
    const url = `${window.location.origin}/?demoRole=${roleParam}`;
    void navigator.clipboard.writeText(url);
    setCopiedRole(roleParam);
    setTimeout(() => setCopiedRole(null), 3000);
  }

  async function handleGenerateDemoSchool() {
    setLoading(true);
    setError("");
    setSummary(null);
    setAlreadyExists(false);
    setProgress("Memeriksa status sekolah demo...");

    try {
      const schoolRef = doc(db, "schools", DEMO_SCHOOL_ID);
      const existingSnap = await getDoc(schoolRef);

      if (existingSnap.exists()) {
        setAlreadyExists(true);
        setLoading(false);
        return;
      }

      const operations: Array<(batch: WriteBatch) => void> = [];
      const nowMs = Date.now();

      // School Profile
      setProgress("Menyiapkan profil sekolah & pengaturan akademik...");
      const kepsekUid = "demo_user_kepsek";

      operations.push((batch) => {
        batch.set(schoolRef, {
          id: DEMO_SCHOOL_ID,
          name: "SMA Negeri Demo 1",
          schoolName: "SMA Negeri Demo 1",
          level: "SMA",
          npsn: "30198765",
          address: "Jl. Pendidikan Demo No. 1, Jakarta",
          phone: "021-5551234",
          email: "demo.sma1@smart-att.web.id",
          cardDeliveryEmail: "demo.sma1@smart-att.web.id",
          ownerUid: kepsekUid,
          status: "active",
          isDemo: true,
          createdAtMs: nowMs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      // Academic settings
      const academicRef = doc(db, "schools", DEMO_SCHOOL_ID, "settings", "academic");
      operations.push((batch) => {
        batch.set(academicRef, {
          academicYear: "2026/2027",
          semester: "Ganjil",
          entryTime: "07:00",
          kkm: 75,
          updatedAt: serverTimestamp(),
        });
      });

      // Teachers & Staff (14 Accounts)
      setProgress("Membuat data 14 guru & staf sekolah...");
      for (const t of teachersDef) {
        const uid = `demo_user_${t.key}`;
        operations.push((batch) => {
          batch.set(doc(db, "users", uid), {
            uid,
            name: t.name,
            email: t.email,
            phone: t.phone,
            nip: t.nip,
            gender: t.gender,
            birthPlace: t.birthPlace,
            birthDate: t.birthDate,
            address: t.address,
            schoolName: "SMA Negeri Demo 1",
            schoolId: DEMO_SCHOOL_ID,
            accountType: "school",
            schoolRole: t.role,
            role: "teacher",
            status: "active",
            disabled: false,
            defaultPassword: "demo123456",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        operations.push((batch) => {
          batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "members", uid), {
            uid,
            name: t.name,
            email: t.email,
            phone: t.phone,
            nip: t.nip,
            gender: t.gender,
            role: t.role,
            active: true,
            subjectIds: t.subjectId ? [t.subjectId] : [],
            primarySubjectIds: t.subjectId ? [t.subjectId] : [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      // Subjects (11 Subjects)
      setProgress("Membuat 11 mata pelajaran...");
      const subjectsList = [
        { id: "subj_mtk", name: "Matematika", code: "MTK", jp: 4 },
        { id: "subj_bin", name: "Bahasa Indonesia", code: "BIN", jp: 4 },
        { id: "subj_big", name: "Bahasa Inggris", code: "BIG", jp: 3 },
        { id: "subj_ipa", name: "IPA", code: "IPA", jp: 4 },
        { id: "subj_ips", name: "IPS", code: "IPS", jp: 4 },
        { id: "subj_inf", name: "Informatika", code: "INF", jp: 2 },
        { id: "subj_pabp", name: "Agama", code: "PABP", jp: 3 },
        { id: "subj_pjok", name: "PJOK", code: "PJOK", jp: 2 },
        { id: "subj_sbd", name: "Seni Budaya", code: "SBD", jp: 2 },
        { id: "subj_eko", name: "Ekonomi", code: "EKO", jp: 2 },
        { id: "subj_ppkn", name: "PPKn", code: "PPKN", jp: 2 },
      ];

      for (const subj of subjectsList) {
        operations.push((batch) => {
          batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "subjects", subj.id), {
            id: subj.id,
            name: subj.name,
            code: subj.code,
            defaultWeeklyPeriods: subj.jp,
            active: true,
            level: "SMA",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      // Classes (6 Classes)
      setProgress("Membuat 6 kelas & menghubungkan wali kelas...");
      const classesList = [
        { id: "class_x_a", name: "X-A", grade: "X", teacherKey: "mtk" },
        { id: "class_x_b", name: "X-B", grade: "X", teacherKey: "bin" },
        { id: "class_xii_a", name: "XII-A", grade: "XII", teacherKey: "big" },
        { id: "class_xii_b", name: "XII-B", grade: "XII", teacherKey: "ipa" },
        { id: "class_xiii_a", name: "XIII-A", grade: "XIII", teacherKey: "ips" },
        { id: "class_xiii_b", name: "XIII-B", grade: "XIII", teacherKey: "agama" },
      ];

      for (const c of classesList) {
        const teacherUid = `demo_user_${c.teacherKey}`;
        operations.push((batch) => {
          batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "classes", c.id), {
            id: c.id,
            name: c.name,
            grade: c.grade,
            homeroomTeacherUid: teacherUid,
            createdAtMs: nowMs,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      // Students (60 Students)
      setProgress("Membuat data 60 siswa (10 siswa per kelas)...");
      const firstNames = ["Aditya", "Bunga", "Cakra", "Diva", "Eko", "Fani", "Gilang", "Hana", "Indra", "Jihan", "Kiki", "Lestari", "Mahendra", "Nabila", "Oky", "Putri", "Qoni", "Rian", "Sari", "Taufik"];
      const lastNames = ["Pratama", "Wijaya", "Kusuma", "Santoso", "Saputra", "Lestari", "Nugroho", "Wahyudi", "Rahmawati", "Hidayat", "Utami", "Suryono", "Handayani", "Wibowo", "Permata"];
      const cities = ["Jakarta", "Bandung", "Surabaya", "Semarang", "Yogyakarta", "Medan"];
      const religions = ["Islam", "Islam", "Islam", "Kristen", "Katolik", "Hindu"];

      let studentCounter = 1;
      const allStudentDocs: Array<{ id: string; nis: string; name: string; className: string; classId: string }> = [];

      for (const c of classesList) {
        for (let i = 1; i <= 10; i++) {
          const nis = String(20261000 + studentCounter);
          const studentId = `demo_std_${studentCounter}`;
          const nisn = String(810000000 + studentCounter);
          const fn = firstNames[(studentCounter - 1) % firstNames.length];
          const ln = lastNames[(studentCounter - 1) % lastNames.length];
          const fullName = `${fn} ${ln}`;
          const gender = i % 2 === 1 ? "L" : "P";
          const birthCity = cities[(studentCounter - 1) % cities.length];
          const religion = religions[(studentCounter - 1) % religions.length];
          const phone = `081299${String(1000 + studentCounter).padStart(4, "0")}`;

          const studentData = {
            id: studentId,
            name: fullName,
            nis,
            nisn,
            gender,
            birthPlace: birthCity,
            birthDate: "2009-06-15",
            religion,
            address: `Jl. Melati Demo No. ${studentCounter}, Jakarta`,
            fatherName: `Bpk. ${ln}`,
            motherName: `Ibu ${fn}`,
            phone,
            email: `siswa.${nis}@smart-att.web.id`,
            defaultPassword: "siswa123456",
            status: "active",
            className: c.name,
            classId: c.id,
            academicYear: "2026/2027",
            attendanceNumber: String(i),
            createdAtMs: nowMs,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          allStudentDocs.push({ id: studentId, nis, name: fullName, className: c.name, classId: c.id });

          operations.push((batch) => {
            batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "students", studentId), studentData);
          });

          studentCounter++;
        }
      }

      // Teaching Assignments & Schedules
      setProgress("Menyusun penugasan mengajar & jadwal...");
      for (const c of classesList) {
        for (const subj of subjectsList) {
          const teacherDef = teachersDef.find((t) => t.subjectId === subj.id) || teachersDef[4];
          const teacherUid = `demo_user_${teacherDef.key}`;
          const assignId = `assign_${c.id}_${subj.id}`;
          operations.push((batch) => {
            batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "teachingAssignments", assignId), {
              id: assignId,
              schoolId: DEMO_SCHOOL_ID,
              teacherUid,
              subjectId: subj.id,
              classId: c.id,
              weeklyPeriods: subj.jp,
              status: "active",
              createdAt: serverTimestamp(),
            });
          });
        }
      }

      // Schedule grid creation
      const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
      const times = [
        { start: "07:00", end: "07:45" },
        { start: "07:45", end: "08:30" },
        { start: "08:30", end: "09:15" },
        { start: "09:30", end: "10:15" },
        { start: "10:15", end: "11:00" },
        { start: "11:00", end: "11:45" },
      ];

      let scheduleCount = 0;
      for (let dayIdx = 0; dayIdx < dayNames.length; dayIdx++) {
        const day = dayNames[dayIdx];
        for (let periodIdx = 0; periodIdx < times.length; periodIdx++) {
          const slotTime = times[periodIdx];

          for (let classIdx = 0; classIdx < classesList.length; classIdx++) {
            const c = classesList[classIdx];
            const subjIdx = (dayIdx * 6 + periodIdx + classIdx) % subjectsList.length;
            const subj = subjectsList[subjIdx];
            const teacherDef = teachersDef.find((t) => t.subjectId === subj.id) || teachersDef[4];
            const teacherUid = `demo_user_${teacherDef.key}`;
            const schedId = `sched_${c.id}_d${dayIdx}_p${periodIdx}`;

            operations.push((batch) => {
              batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "schedules", schedId), {
                id: schedId,
                day,
                classId: c.id,
                subjectId: subj.id,
                teacherUid,
                startTime: slotTime.start,
                endTime: slotTime.end,
                status: "published",
                createdAt: serverTimestamp(),
              });
            });

            scheduleCount++;
          }
        }
      }

      // Attendance Generation (30 Days)
      setProgress("Generating absensi 30 hari...");
      let attendanceSessionCount = 0;
      const today = new Date();

      for (let d = 29; d >= 0; d--) {
        const dateObj = new Date(today);
        dateObj.setDate(today.getDate() - d);
        if (dateObj.getDay() === 0) continue;

        const dateStr = dateObj.toISOString().slice(0, 10);
        const dayStartMs = dateObj.getTime();

        for (const c of classesList) {
          const classStudents = allStudentDocs.filter((s) => s.classId === c.id);
          const records: Record<string, any> = {};

          classStudents.forEach((student, idx) => {
            const roll = ((d * 60 + idx * 7 + 13) % 100) + 1;
            if (roll <= 92) {
              records[student.id] = {
                studentId: student.id,
                status: "present",
                source: "qr",
                recordedAtMs: dayStartMs + (7 * 3600 + idx * 45) * 1000,
                late: roll > 88,
              };
            } else if (roll <= 95) {
              records[student.id] = {
                studentId: student.id,
                status: "permission",
                source: "manual",
                reason: "Izin keperluan keluarga",
                recordedAtMs: dayStartMs + 7 * 3600 * 1000,
              };
            } else if (roll <= 98) {
              records[student.id] = {
                studentId: student.id,
                status: "sick",
                source: "manual",
                reason: "Sakit demam",
                recordedAtMs: dayStartMs + 7 * 3600 * 1000,
              };
            }
          });

          const sessionId = `att_${c.id}_${dateStr}`;
          operations.push((batch) => {
            batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "attendanceSessions", sessionId), {
              id: sessionId,
              className: c.name,
              schoolName: "SMA Negeri Demo 1",
              status: "closed",
              attendanceDate: dateStr,
              startedAtMs: dayStartMs + 7 * 3600 * 1000,
              closedAtMs: dayStartMs + 14 * 3600 * 1000,
              records,
              updatedAt: serverTimestamp(),
            });
          });

          attendanceSessionCount++;
        }
      }

      // Manual Grades
      setProgress("Generating nilai siswa...");
      let gradeCount = 0;
      const gradeCategories = [
        { key: "assignment", name: "Tugas 1 (Bab 1-2)", type: "Tugas" },
        { key: "quiz", name: "Kuis Harian 1", type: "Kuis" },
        { key: "midterm", name: "Ujian Tengah Semester (UTS)", type: "UTS" },
        { key: "final", name: "Ujian Akhir Semester (UAS)", type: "UAS" },
      ];

      for (const student of allStudentDocs) {
        for (const subj of subjectsList) {
          for (const cat of gradeCategories) {
            const score = 65 + Math.floor((student.nis.charCodeAt(7) * 11 + subj.id.length * 7 + cat.key.length * 5) % 36);
            const gradeId = `grade_${student.id}_${subj.id}_${cat.key}`;

            operations.push((batch) => {
              batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "manualGrades", gradeId), {
                id: gradeId,
                className: student.className,
                subject: subj.name,
                category: cat.key,
                assessmentType: cat.type,
                name: cat.name,
                studentId: student.id,
                studentName: student.name,
                nis: student.nis,
                score,
                notes: score >= 90 ? "Sangat Baik" : score >= 80 ? "Baik" : score >= 75 ? "Cukup" : "Perlu Bimbingan",
                createdAtMs: nowMs - 86400000 * 5,
                createdAt: serverTimestamp(),
              });
            });

            gradeCount++;
          }
        }
      }

      // Commit to Firestore
      setProgress("Menyimpan seluruh data ke Firestore Database...");
      await commitInChunks(operations);

      const totalAccounts = 1 + teachersDef.length + allStudentDocs.length;

      setSummary({
        schoolName: "SMA Negeri Demo 1",
        teacherCount: teachersDef.length,
        studentCount: allStudentDocs.length,
        classCount: classesList.length,
        subjectCount: subjectsList.length,
        scheduleCount,
        attendanceSessionCount,
        gradeCount,
        totalAccountCount: totalAccounts,
      });

      setLoading(false);
      setProgress("");
    } catch (err: any) {
      console.error("Error generating demo school:", err);
      setError(err?.message || "Terjadi kesalahan saat generate data demo sekolah.");
      setLoading(false);
      setProgress("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                <Sparkles size={18} />
              </span>
              <p className="text-xs font-black uppercase tracking-wider text-teal-600">Super Admin Tool</p>
            </div>
            <h2 className="mt-2 text-xl font-black">Generate Demo School — SMA Negeri Demo 1</h2>
            <p className="mt-1 text-sm text-slate-500">
              Buat 1 sekolah demo lengkap (6 kelas, 14 guru, 60 siswa, 11 mapel, jadwal 5 hari, absensi 30 hari, dan nilai) untuk pengujian menyeluruh SMART-ATT.
            </p>
          </div>
        </div>

        {alreadyExists && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-3 text-amber-800 font-extrabold text-sm">
              <CheckCircle2 size={20} className="text-amber-600 shrink-0" />
              <span>Data Sekolah Demo (SMA Negeri Demo 1) sudah aktif & siap diuji.</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-center gap-3 text-rose-800 font-extrabold text-sm">
              <AlertCircle size={20} className="text-rose-600 shrink-0" />
              <span>Gagal: {error}</span>
            </div>
          </div>
        )}

        {!summary && !alreadyExists && (
          <div className="mt-6">
            <button
              disabled={loading}
              onClick={handleGenerateDemoSchool}
              className="flex items-center gap-2 rounded-2xl bg-teal-600 px-6 py-3.5 text-sm font-black text-white shadow-lg transition hover:bg-teal-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {loading ? "Proses Generate Sedang Berjalan..." : "Mulai Generate Sekolah Demo"}
            </button>
            {loading && <p className="mt-3 text-xs font-bold text-teal-600 animate-pulse">{progress}</p>}
          </div>
        )}

        {summary && (
          <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6">
            <div className="flex items-center gap-3 text-emerald-800">
              <CheckCircle2 size={26} className="text-emerald-600 shrink-0" />
              <div>
                <h3 className="text-lg font-black">Sekolah Demo Berhasil Dibuat!</h3>
                <p className="text-xs text-emerald-700">Seluruh data relasional telah tersimpan ke Firestore tanpa error.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Jumlah Kelas", val: `${summary.classCount} Kelas (X-A, X-B, XII-A, XII-B, XIII-A, XIII-B)`, icon: School },
                { label: "Jumlah Guru / Staf", val: `${summary.teacherCount} Guru`, icon: Users },
                { label: "Jumlah Siswa", val: `${summary.studentCount} Siswa`, icon: Users },
                { label: "Jumlah Mata Pelajaran", val: `${summary.subjectCount} Mapel`, icon: BookOpen },
                { label: "Jumlah Sesi Jadwal", val: `${summary.scheduleCount} Jadwal`, icon: Calendar },
                { label: "Jumlah Sesi Absensi", val: `${summary.attendanceSessionCount} Sesi (30 Hari)`, icon: Clock },
                { label: "Jumlah Nilai Siswa", val: `${summary.gradeCount} Nilai`, icon: Award },
                { label: "Total Akun Login", val: `${summary.totalAccountCount} Akun`, icon: ShieldCheck },
              ].map(({ label, val, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <Icon size={16} />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">{label}</span>
                  </div>
                  <p className="mt-1 text-sm font-black text-slate-800">{val}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instant Workspace Preview & Shareable Links */}
        <div className="mt-6 rounded-3xl border border-teal-100 bg-slate-900 p-6 text-white shadow-xl">
          <div className="flex items-center gap-2 text-teal-400">
            <KeyRound size={20} />
            <h3 className="text-base font-black">Pratinjau Langsung & Link Akses Sekolah Demo</h3>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            Pilih role untuk membuka workspace SMA Negeri Demo 1 secara langsung, atau salin link publik untuk dibagikan ke siapa saja:
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {/* Kepsek */}
            <div className="rounded-2xl border border-teal-500/30 bg-teal-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-teal-500/20 px-2.5 py-1 text-[10px] font-black text-teal-300">KEPALA SEKOLAH</span>
                <button
                  onClick={() => copyDirectLink("kepsek")}
                  className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-white"
                >
                  {copiedRole === "kepsek" ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copiedRole === "kepsek" ? "Tersalin!" : "Salin Link"}
                </button>
              </div>
              <p className="mt-2 text-sm font-black text-white">Dr. H. Ahmad Sudirman, M.Pd</p>
              <p className="text-[10px] text-slate-400">kepsek.demo@smart-att.web.id</p>
              <button
                onClick={() => onSelectDemoRole?.("principal")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-xs font-black text-white transition hover:bg-teal-500"
              >
                <LogIn size={15} /> Buka Workspace Kepsek
              </button>
            </div>

            {/* TU */}
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-indigo-500/20 px-2.5 py-1 text-[10px] font-black text-indigo-300">TATA USAHA (TU)</span>
                <button
                  onClick={() => copyDirectLink("tu")}
                  className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-white"
                >
                  {copiedRole === "tu" ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copiedRole === "tu" ? "Tersalin!" : "Salin Link"}
                </button>
              </div>
              <p className="mt-2 text-sm font-black text-white">Budi Santoso, S.Kom</p>
              <p className="text-[10px] text-slate-400">tu.demo@smart-att.web.id</p>
              <button
                onClick={() => onSelectDemoRole?.("administration")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white transition hover:bg-indigo-500"
              >
                <LogIn size={15} /> Buka Workspace TU
              </button>
            </div>

            {/* Guru MTK */}
            <div className="rounded-2xl border border-sky-500/30 bg-sky-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-[10px] font-black text-sky-300">GURU & WALI KELAS X-A</span>
                <button
                  onClick={() => copyDirectLink("guru")}
                  className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-white"
                >
                  {copiedRole === "guru" ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copiedRole === "guru" ? "Tersalin!" : "Salin Link"}
                </button>
              </div>
              <p className="mt-2 text-sm font-black text-white">Bambang Wijaya, S.Pd</p>
              <p className="text-[10px] text-slate-400">guru.mtk@smart-att.web.id</p>
              <button
                onClick={() => onSelectDemoRole?.("teacher")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-xs font-black text-white transition hover:bg-sky-500"
              >
                <LogIn size={15} /> Buka Workspace Guru
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
