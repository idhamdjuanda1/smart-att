"use client";

import React, { useState } from "react";
import { collection, doc, getDoc, serverTimestamp, setDoc, writeBatch, WriteBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Building2, CheckCircle2, AlertCircle, Loader2, Sparkles, ShieldCheck, Users, School, BookOpen, Calendar, Clock, Award, FileText } from "lucide-react";

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

// Helper function to split Firestore batch operations safely
async function commitInChunks(operations: Array<(batch: WriteBatch) => void>) {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }
}

export function DemoGeneratorPanel() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<DemoGeneratorSummary | null>(null);
  const [error, setError] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);

  async function handleGenerateDemoSchool() {
    setLoading(true);
    setError("");
    setSummary(null);
    setAlreadyExists(false);
    setProgress("Memeriksa status sekolah demo...");

    try {
      // 1. Check if demo school already exists
      const schoolRef = doc(db, "schools", DEMO_SCHOOL_ID);
      const existingSnap = await getDoc(schoolRef);

      if (existingSnap.exists()) {
        setAlreadyExists(true);
        setLoading(false);
        return;
      }

      const operations: Array<(batch: WriteBatch) => void> = [];
      const nowMs = Date.now();

      // 2. School Profile
      setProgress("Menyiapkan profil sekolah & pengaturan akademik...");
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
          ownerUid: "demo_user_kepsek",
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

      // 3. Teachers & Staff (14 Accounts)
      setProgress("Membuat data 14 guru & staf sekolah...");
      const teachersList = [
        { uid: "demo_user_kepsek", name: "Dr. H. Ahmad Sudirman, M.Pd", nip: "197001011995011001", gender: "L", birthPlace: "Jakarta", birthDate: "1970-01-15", address: "Jl. Melati No. 1, Jakarta", phone: "081234567801", email: "kepsek.demo@smart-att.web.id", role: "principal", subjectName: "Manajemen Sekolah", subjectId: "" },
        { uid: "demo_user_wakasek", name: "Dra. Hj. Siti Rahmawati, M.Si", nip: "197203151997022002", gender: "P", birthPlace: "Bandung", birthDate: "1972-03-20", address: "Jl. Mawar No. 2, Jakarta", phone: "081234567802", email: "wakasek.demo@smart-att.web.id", role: "administration", subjectName: "Kurikulum", subjectId: "" },
        { uid: "demo_user_tu", name: "Budi Santoso, S.Kom", nip: "198506102008011003", gender: "L", birthPlace: "Semarang", birthDate: "1985-06-10", address: "Jl. Anggrek No. 3, Jakarta", phone: "081234567803", email: "tu.demo@smart-att.web.id", role: "administration", subjectName: "Tata Usaha", subjectId: "" },
        { uid: "demo_user_bk", name: "Rina Agustina, S.Psi", nip: "198808202012022004", gender: "P", birthPlace: "Surabaya", birthDate: "1988-08-20", address: "Jl. Dahlia No. 4, Jakarta", phone: "081234567804", email: "bk.demo@smart-att.web.id", role: "teacher", subjectName: "Bimbingan Konseling", subjectId: "subj_bk" },
        { uid: "demo_user_mtk", name: "Bambang Wijaya, S.Pd", nip: "198204122006041005", gender: "L", birthPlace: "Yogyakarta", birthDate: "1982-04-12", address: "Jl. Kenanga No. 5, Jakarta", phone: "081234567805", email: "guru.mtk@smart-att.web.id", role: "teacher", subjectName: "Matematika", subjectId: "subj_mtk", homeroomFor: "X-A" },
        { uid: "demo_user_bin", name: "Dewi Lestari, M.Pd", nip: "198409152009032006", gender: "P", birthPlace: "Solo", birthDate: "1984-09-15", address: "Jl. Kamboja No. 6, Jakarta", phone: "081234567806", email: "guru.bin@smart-att.web.id", role: "teacher", subjectName: "Bahasa Indonesia", subjectId: "subj_bin", homeroomFor: "X-B" },
        { uid: "demo_user_big", name: "John Smith, M.Ed", nip: "198611252010011007", gender: "L", birthPlace: "Medan", birthDate: "1986-11-25", address: "Jl. Cempaka No. 7, Jakarta", phone: "081234567807", email: "guru.big@smart-att.web.id", role: "teacher", subjectName: "Bahasa Inggris", subjectId: "subj_big", homeroomFor: "XII-A" },
        { uid: "demo_user_ipa", name: "Ir. Hendra Prasetyo, M.T", nip: "198005182005021008", gender: "L", birthPlace: "Malang", birthDate: "1980-05-18", address: "Jl. Flamboyan No. 8, Jakarta", phone: "081234567808", email: "guru.ipa@smart-att.web.id", role: "teacher", subjectName: "IPA", subjectId: "subj_ipa", homeroomFor: "XII-B" },
        { uid: "demo_user_ips", name: "Drs. Eko Wahyudi", nip: "197802282003121009", gender: "L", birthPlace: "Bogor", birthDate: "1978-02-28", address: "Jl. Teratai No. 9, Jakarta", phone: "081234567809", email: "guru.ips@smart-att.web.id", role: "teacher", subjectName: "IPS", subjectId: "subj_ips", homeroomFor: "XIII-A" },
        { uid: "demo_user_agama", name: "H. Muhammad Ridwan, S.Ag", nip: "198107142007011010", gender: "L", birthPlace: "Cirebon", birthDate: "1981-07-14", address: "Jl. Jasmine No. 10, Jakarta", phone: "081234567810", email: "guru.agama@smart-att.web.id", role: "teacher", subjectName: "Agama", subjectId: "subj_pabp", homeroomFor: "XIII-B" },
        { uid: "demo_user_inf", name: "Arief Hidayat, S.Kom", nip: "199003102015031011", gender: "L", birthPlace: "Bandung", birthDate: "1990-03-10", address: "Jl. Tulip No. 11, Jakarta", phone: "081234567811", email: "guru.inf@smart-att.web.id", role: "teacher", subjectName: "Informatika", subjectId: "subj_inf" },
        { uid: "demo_user_pjok", name: "Doni Kusuma, S.Pd", nip: "198912052014021012", gender: "L", birthPlace: "Palembang", birthDate: "1989-12-05", address: "Jl. Sakura No. 12, Jakarta", phone: "081234567812", email: "guru.pjok@smart-att.web.id", role: "teacher", subjectName: "PJOK", subjectId: "subj_pjok" },
        { uid: "demo_user_sbd", name: "Maya Putri, S.Sn", nip: "199201182018012013", gender: "P", birthPlace: "Bali", birthDate: "1992-01-18", address: "Jl. Palm No. 13, Jakarta", phone: "081234567813", email: "guru.sbd@smart-att.web.id", role: "teacher", subjectName: "Seni Budaya", subjectId: "subj_sbd" },
        { uid: "demo_user_eko", name: "Sri Wahyuni, S.E., M.M", nip: "198310082008022014", gender: "P", birthPlace: "Surakarta", birthDate: "1983-10-08", address: "Jl. Bougainville No. 14, Jakarta", phone: "081234567814", email: "guru.eko@smart-att.web.id", role: "teacher", subjectName: "Ekonomi", subjectId: "subj_eko" },
      ];

      for (const t of teachersList) {
        // user doc
        operations.push((batch) => {
          batch.set(doc(db, "users", t.uid), {
            uid: t.uid,
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
        // member doc
        operations.push((batch) => {
          batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "members", t.uid), {
            uid: t.uid,
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

      // 4. Subjects (11 Subjects)
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

      // 5. Classes (6 Classes)
      setProgress("Membuat 6 kelas & menghubungkan wali kelas...");
      const classesList = [
        { id: "class_x_a", name: "X-A", grade: "X", teacherUid: "demo_user_mtk" },
        { id: "class_x_b", name: "X-B", grade: "X", teacherUid: "demo_user_bin" },
        { id: "class_xii_a", name: "XII-A", grade: "XII", teacherUid: "demo_user_big" },
        { id: "class_xii_b", name: "XII-B", grade: "XII", teacherUid: "demo_user_ipa" },
        { id: "class_xiii_a", name: "XIII-A", grade: "XIII", teacherUid: "demo_user_ips" },
        { id: "class_xiii_b", name: "XIII-B", grade: "XIII", teacherUid: "demo_user_agama" },
      ];

      for (const c of classesList) {
        operations.push((batch) => {
          batch.set(doc(db, "schools", DEMO_SCHOOL_ID, "classes", c.id), {
            id: c.id,
            name: c.name,
            grade: c.grade,
            homeroomTeacherUid: c.teacherUid,
            createdAtMs: nowMs,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      // 6. Students (60 Students)
      setProgress("Membuat data 60 siswa (10 siswa per kelas)...");
      const firstNames = ["Aditya", "Bunga", "Cakra", "Diva", "Eko", "Fani", "Gilang", "Hana", "Indra", "Jihan", "Kiki", "Lestari", "Mahendra", "Nabila", "Oky", "Putri", "Qoni", "Rian", "Sari", "Taufik"];
      const lastNames = ["Pratama", "Wijaya", "Kusuma", "Santoso", "Saputra", "Lestari", "Nugroho", "Wahyudi", "Rahmawati", "Hidayat", "Utami", "Suryono", "Handayani", "Wibowo", "Permata"];
      const cities = ["Jakarta", "Bandung", "Surabaya", "Semarang", "Yogyakarta", "Medan"];
      const religions = ["Islam", "Islam", "Islam", "Kristen", "Katolik", "Hindu"];

      let studentCounter = 1;
      const allStudentDocs: Array<{ id: string; nis: string; name: string; className: string; classId: string }> = [];

      for (const c of classesList) {
        for (let i = 1; i <= 10; i++) {
          const studentId = `demo_std_${studentCounter}`;
          const nis = String(20261000 + studentCounter);
          const nisn = String(810000000 + studentCounter);
          const fn = firstNames[(studentCounter - 1) % firstNames.length];
          const ln = lastNames[(studentCounter - 1) % lastNames.length];
          const fullName = `${fn} ${ln}`;
          const gender = i % 2 === 1 ? "L" : "P";
          const birthCity = cities[(studentCounter - 1) % cities.length];
          const religion = religions[(studentCounter - 1) % religions.length];
          const phone = `081299${String(1000 + studentCounter).padStart(4, "0")}`;
          const email = `siswa.${nis}@smart-att.web.id`;

          const studentData = {
            id: studentId,
            name: fullName,
            nis: nis,
            nisn: nisn,
            gender,
            birthPlace: birthCity,
            birthDate: "2009-06-15",
            religion,
            address: `Jl. Melati Demo No. ${studentCounter}, Jakarta`,
            fatherName: `Bpk. ${ln}`,
            motherName: `Ibu ${fn}`,
            phone,
            email,
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

      // 7. Teaching Assignments & Schedules
      setProgress("Menyusun penugasan mengajar & jadwal bebas bentrok...");
      const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
      const times = [
        { start: "07:00", end: "07:45" },
        { start: "07:45", end: "08:30" },
        { start: "08:30", end: "09:15" },
        { start: "09:30", end: "10:15" },
        { start: "10:15", end: "11:00" },
        { start: "11:00", end: "11:45" },
      ];

      // Assign subjects to teachers
      const teacherSubjectMap: Record<string, string> = {
        subj_mtk: "demo_user_mtk",
        subj_bin: "demo_user_bin",
        subj_big: "demo_user_big",
        subj_ipa: "demo_user_ipa",
        subj_ips: "demo_user_ips",
        subj_inf: "demo_user_inf",
        subj_pabp: "demo_user_agama",
        subj_pjok: "demo_user_pjok",
        subj_sbd: "demo_user_sbd",
        subj_eko: "demo_user_eko",
        subj_ppkn: "demo_user_bk",
      };

      // Create teaching assignments
      let assignmentIndex = 1;
      for (const c of classesList) {
        for (const subj of subjectsList) {
          const teacherUid = teacherSubjectMap[subj.id] || "demo_user_mtk";
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
          assignmentIndex++;
        }
      }

      // Schedule grid creation without conflicts
      let scheduleCount = 0;
      for (let dayIdx = 0; dayIdx < dayNames.length; dayIdx++) {
        const day = dayNames[dayIdx];
        for (let periodIdx = 0; periodIdx < times.length; periodIdx++) {
          const slotTime = times[periodIdx];

          for (let classIdx = 0; classIdx < classesList.length; classIdx++) {
            const c = classesList[classIdx];
            // Rotate subject per class and period deterministically to prevent teacher/class overlap
            const subjIdx = (dayIdx * 6 + periodIdx + classIdx) % subjectsList.length;
            const subj = subjectsList[subjIdx];
            const teacherUid = teacherSubjectMap[subj.id] || "demo_user_mtk";
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

      // 8. Attendance Generation (30 Days)
      setProgress("Generating absensi 30 hari (92% Hadir, 3% Izin, 3% Sakit, 2% Alpha)...");
      let attendanceSessionCount = 0;
      const today = new Date();

      for (let d = 29; d >= 0; d--) {
        const dateObj = new Date(today);
        dateObj.setDate(today.getDate() - d);
        // Skip Sundays
        if (dateObj.getDay() === 0) continue;

        const dateStr = dateObj.toISOString().slice(0, 10);
        const dayStartMs = dateObj.getTime();

        for (const c of classesList) {
          const classStudents = allStudentDocs.filter((s) => s.classId === c.id);
          const records: Record<string, any> = {};

          classStudents.forEach((student, idx) => {
            // Roll percentage: 1..100
            // 1..92 => present (92%)
            // 93..95 => permission (3%)
            // 96..98 => sick (3%)
            // 99..100 => alpha (2%)
            const roll = ((d * 60 + idx * 7 + 13) % 100) + 1;

            if (roll <= 92) {
              records[student.id] = {
                studentId: student.id,
                status: "present",
                source: "qr",
                recordedAtMs: dayStartMs + (7 * 3600 + idx * 45) * 1000,
                late: roll > 88, // slight late
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
            // 99..100 => alpha (no record entry)
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

      // 9. Manual Grades (Tugas, Kuis, UTS, UAS)
      setProgress("Generating nilai siswa (Tugas, Kuis, UTS, UAS)...");
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
            // Seed score between 65 and 100 deterministically
            const score = 65 + Math.floor(((student.nis.charCodeAt(7) * 11 + subj.id.length * 7 + cat.key.length * 5) % 36));
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

      // 10. Commit all operations to Firestore in chunks
      setProgress("Menyimpan seluruh data ke Firestore Database...");
      await commitInChunks(operations);

      const totalAccounts = 1 + teachersList.length + allStudentDocs.length; // 1 SuperAdmin + 14 staff + 60 students

      setSummary({
        schoolName: "SMA Negeri Demo 1",
        teacherCount: teachersList.length,
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
              <AlertCircle size={20} className="text-amber-600 shrink-0" />
              <span>Data Sekolah Demo (SMA Negeri Demo 1) sudah pernah dibuat! Proses dibatalkan untuk mencegah duplikasi.</span>
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

            <div className="mt-6 rounded-2xl bg-white p-4 border border-emerald-200">
              <p className="text-xs font-black text-slate-800">🔑 Informasi Akun Login Demo:</p>
              <div className="mt-2 text-xs text-slate-600 space-y-1">
                <p>• <b>Kepala Sekolah:</b> <code>kepsek.demo@smart-att.web.id</code> (Pass: <code>demo123456</code>)</p>
                <p>• <b>Wakil Kepala Sekolah:</b> <code>wakasek.demo@smart-att.web.id</code> (Pass: <code>demo123456</code>)</p>
                <p>• <b>Tata Usaha:</b> <code>tu.demo@smart-att.web.id</code> (Pass: <code>demo123456</code>)</p>
                <p>• <b>Guru Mapel (misal MTK):</b> <code>guru.mtk@smart-att.web.id</code> (Pass: <code>demo123456</code>)</p>
                <p>• <b>Siswa (NIS 20261001):</b> <code>siswa.20261001@smart-att.web.id</code> (Pass: <code>siswa123456</code>)</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
