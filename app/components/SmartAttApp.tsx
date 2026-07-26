"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity, AlarmClock, ArrowLeft, ArrowRightLeft, BarChart3, Banknote, Bell, BookOpen, Bot, CalendarDays,
  Camera, Check, CheckCircle2, ChevronDown, ChevronRight, CircleUserRound, ClipboardCheck,
  Clock3, Copy, Download, FileDown, FileText, GraduationCap, HelpCircle, Home, ImagePlus, KeyRound,
  LayoutDashboard, Link2, ListChecks, Loader2, LockKeyhole, LogOut, Menu, MessageCircle,
  MoreHorizontal, PencilLine, Plus, Printer, QrCode, RefreshCcw, ScanLine, School,
  Search, Send, Settings, ShieldAlert, ShieldCheck, Sparkles, Timer, Trash2, Upload, UserCheck,
  UserPlus, Users, Wallet, X, XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, type User,
} from "firebase/auth";
import {
  addDoc, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp,
  runTransaction, setDoc, updateDoc, where, writeBatch, type DocumentData, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { parseStudentsCsv } from "../lib/csv";
import { parseAiQuizText, type QuizQuestion } from "../lib/quiz";
import { createRandomizedQuiz, escapeHtml, formatCountdown, type RandomizedQuestion } from "../lib/quizRuntime";
import { createStudentThumbnail, drawStudentCrop, loadPhoto, resizeStudentPhoto, type PhotoAspect } from "../lib/studentPhoto";
import { findStudentByQrOrNis } from "../lib/attendance";
import { AcademicView, ScoresView } from "./GradeViews";
import { AttendanceViewPro, ScannerViewPro } from "./OperationalViews";
import { PublicSubjectElection, PublicElectionStatus } from "./SubjectElectionViews";
import { PublicQuizProfessional } from "./ExamPortal";
import { ProfileProfessional, SuperAdminProfessional } from "./AdminViews";
import { LoginArticlePreview, PublicArticles } from "./ArticleViews";
import { TeacherCalendarView, TeachingScheduleView } from "./TeacherScheduleViews";
import { PublicSavingsPortal } from "./PublicSavingsPortal";
import { PublicTeacherRegistration } from "./PublicTeacherRegistration";
import { PublicLinkPortal } from "./PublicLinkPortal";
import { workspaceCollection, workspaceDoc, type WorkspaceScope } from "../lib/workspace";
import { normalizeAccountAccess, type AccountAccessProfile } from "../lib/access";
import { SchoolOnboarding, SchoolWorkspace } from "./SchoolWorkspace";
import { tokenAccountTypeLabel, tokenMatchesAccountType, type TokenAccountType } from "../lib/tokenAccess";
import { buildQuizShortUrl, generateQuizAccessCode, normalizeQuizAccessCode } from "../lib/publicLink";

type Student = {
  id: string;
  attendanceNumber?: string;
  nis: string;
  nisn?: string;
  name: string;
  className: string;
  guardian?: string;
  phone?: string;
  photoKey?: string;
  photoThumbnailKey?: string;
  photoAspect?: PhotoAspect;
};

type AbsensiStatus = "present" | "sick" | "permission";

type AbsensiRecord = {
  studentId: string;
  status: AbsensiStatus;
  recordedAtMs: number;
  source: "qr" | "manual" | "guardian";
  reason?: string;
};

type AbsensiSession = {
  id: string;
  className: string;
  schoolName: string;
  status: "open" | "closed";
  startedAtMs: number;
  closedAtMs?: number;
  records: Record<string, AbsensiRecord>;
};

type AbsenceSnapshot = {
  type: "absence";
  ownerUid: string;
  schoolId?: string;
  sessionId: string;
  published: boolean;
  schoolName: string;
  dateLabel: string;
  student: Pick<Student, "id" | "nis" | "nisn" | "name" | "className">;
};

type TaskRecord = {
  id: string;
  subject: string;
  className: string;
  title: string;
  description: string;
  deadline: string;
  published: boolean;
  snapshotId?: string;
  teacherName?: string;
  createdAt?: { toMillis?: () => number } | null;
};

type TaskForm = Omit<TaskRecord, "id" | "snapshotId" | "teacherName" | "createdAt">;

type ExamRecord = {
  id: string;
  title: string;
  subjectId?: string;
  subject: string;
  className: string;
  chapter?: string;
  questions: QuizQuestion[];
  status: "draft" | "scheduled" | "published" | "finished";
  source?: "ai" | "manual";
  gradeCategory?: GradeCategory;
  assessmentType?: "daily_test" | "quiz" | "pts_sts" | "pas_sas";
  snapshotId?: string;
  accessCode?: string;
durationMinutes?: number;
  startAtMs?: number;
  endAtMs?: number;
  targetStudentCount?: number;
  endedAtMs?: number;
  endedManually?: boolean;
  createdAt?: { toMillis?: () => number; toDate?: () => Date } | null;
};

type SubjectRecord = {
  id: string;
  name: string;
  category: "mandatory" | "optional";
  icon: string;
  color: string;
  protected?: boolean;
  createdAt?: { toMillis?: () => number } | null;
};

type LearningNote = {
  id: string;
  subjectId: string;
  subjectName: string;
  className: string;
  date?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  content: string;
  followUp?: string;
  createdAtMs?: number;
  updatedAtMs: number;
};

type ActiveTeachingSession = {
  subjectId: string;
  subjectName: string;
  className: string;
  startTime: string;
  endTime: string;
};

function learningDateKey(value: Date | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function learningNoteSessionId(session: ActiveTeachingSession, date: string) {
  return `session-${date}-${session.subjectId}-${session.className}-${session.startTime}-${session.endTime}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type QuizAttempt = {
  id: string;
  snapshotId: string;
  examId: string;
  ownerUid: string;
  studentId: string;
  nis: string;
  studentName: string;
  className: string;
  status: "active" | "finished";
  answers?: Record<string, number>;
  score?: number;
  correctCount?: number;
  durationSeconds?: number;
  violations?: { type: string; atMs: number }[];
  startedAtMs?: number;
  deadlineMs?: number;
  reloginCount?: number;
  loginEvents?: { type: string; atMs: number }[];
  randomSeed?: string;
  finishReason?: "waktu_habis" | "dikirim_siswa" | "ditutup_guru";
};

type GradeCategory = "task" | "quiz" | "summative" | "midterm" | "final" | "practice" | "project" | "attitude";
type GradeWeights = Record<GradeCategory, { enabled: boolean; weight: number }>;
type ManualGradeRecord = {
  id: string;
  className: string;
  category: GradeCategory;
  assessmentType: string;
  name: string;
  studentId: string;
  studentName: string;
  nis: string;
  score: number;
  notes?: string;
  createdAtMs: number;
};
type AcademicSettings = {
  schoolName: string;
  academicYear: string;
  semester: "Ganjil" | "Genap";
  classNames: string[];
  entryTime: string;
  kkm: number;
};

type SavingsTransaction = {
  id: string;
  ownerUid: string;
  studentId: string;
  studentName: string;
  nis: string;
  nisn?: string;
  className: string;
  type: "deposit" | "withdrawal";
  amount: number;
  transactionDate: string;
  note: string;
  officerName: string;
  status: "active" | "void";
  createdAtMs: number;
  updatedAtMs?: number;
  voidReason?: string;
};

type PublicQuizSnapshot = {
  ownerUid: string;
  examId: string;
  published: boolean;
  type: "quiz";
  title: string;
  subject: string;
  className: string;
  chapter?: string;
  questions: QuizQuestion[];
durationMinutes: number;
  startAtMs?: number;
  endAtMs?: number;
  students: Pick<Student, "id" | "nis" | "nisn" | "name" | "className">[];
};

type NavKey = "dashboard" | "students" | "scan" | "attendance" | "savings" | "schedule" | "calendar" | "subjects" | "tasks" | "exams" | "ai" | "scores" | "profile" | "academic";
type Toast = { message: string; tone: "success" | "error" } | null;

const SUPERADMIN_EMAIL = (process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL ?? "idhamdjuanda@gmail.com").toLowerCase();

const GRADE_CATEGORIES: { key: GradeCategory; label: string; description: string }[] = [
  { key: "task", label: "Tugas", description: "Tugas aplikasi dan tugas offline" },
  { key: "quiz", label: "Kuis", description: "Kuis singkat dan evaluasi formatif" },
  { key: "summative", label: "Ulangan Harian / Sumatif", description: "Soal & Ulangan reguler" },
  { key: "midterm", label: "PTS / STS", description: "Penilaian tengah semester" },
  { key: "final", label: "PAS / SAS", description: "Penilaian akhir semester" },
  { key: "practice", label: "Praktik", description: "Praktik, lisan, hafalan, dan presentasi" },
  { key: "project", label: "Proyek", description: "Proyek individu atau kelompok" },
  { key: "attitude", label: "Sikap", description: "Observasi dan penilaian sikap" },
];

const DEFAULT_GRADE_WEIGHTS: GradeWeights = {
  task: { enabled: true, weight: 15 },
  quiz: { enabled: true, weight: 15 },
  summative: { enabled: true, weight: 25 },
  midterm: { enabled: true, weight: 20 },
  final: { enabled: true, weight: 25 },
  practice: { enabled: false, weight: 0 },
  project: { enabled: false, weight: 0 },
  attitude: { enabled: false, weight: 0 },
};

const MANUAL_ASSESSMENT_TYPES: { value: string; label: string; category: GradeCategory }[] = [
  { value: "task_offline", label: "Tugas offline", category: "task" },
  { value: "quiz", label: "Kuis", category: "quiz" },
  { value: "daily_test", label: "Soal & Ulangan", category: "summative" },
  { value: "pts_sts", label: "PTS / STS", category: "midterm" },
  { value: "pas_sas", label: "PAS / SAS", category: "final" },
  { value: "practice", label: "Praktik", category: "practice" },
  { value: "oral", label: "Lisan", category: "practice" },
  { value: "memorization", label: "Hafalan", category: "practice" },
  { value: "presentation", label: "Presentasi", category: "practice" },
  { value: "project", label: "Proyek", category: "project" },
  { value: "attitude", label: "Sikap", category: "attitude" },
];

const DEFAULT_ACADEMIC_SETTINGS: AcademicSettings = {
  schoolName: "SDN Papandayan 1",
  academicYear: "2026/2027",
  semester: "Ganjil",
  classNames: ["V-A", "V-B"],
  entryTime: "07:00",
  kkm: 75,
};

const MANDATORY_SUBJECTS: SubjectRecord[] = [
  { id: "mandatory-pancasila", name: "Pendidikan Pancasila", category: "mandatory", icon: "BookOpen", color: "#0f766e", protected: true },
  { id: "mandatory-religion", name: "Pendidikan Agama", category: "mandatory", icon: "BookOpen", color: "#047857", protected: true },
  { id: "mandatory-indonesian", name: "Bahasa Indonesia", category: "mandatory", icon: "BookOpen", color: "#2563eb", protected: true },
  { id: "mandatory-mathematics", name: "Matematika", category: "mandatory", icon: "Calculator", color: "#7c3aed", protected: true },
  { id: "mandatory-science", name: "IPA", category: "mandatory", icon: "Flask", color: "#0891b2", protected: true },
  { id: "mandatory-social-science", name: "IPS", category: "mandatory", icon: "Globe", color: "#d97706", protected: true },
  { id: "mandatory-english", name: "Bahasa Inggris", category: "mandatory", icon: "Languages", color: "#db2777", protected: true },
  { id: "mandatory-art", name: "Seni Budaya", category: "mandatory", icon: "BookOpen", color: "#9333ea", protected: true },
  { id: "mandatory-sport", name: "PJOK", category: "mandatory", icon: "Activity", color: "#16a34a", protected: true },
  { id: "mandatory-informatics", name: "Informatika", category: "mandatory", icon: "Bot", color: "#475569", protected: true },
];

const DEFAULT_ACTIVE_SESSION: ActiveTeachingSession = { subjectId: "mandatory-mathematics", subjectName: "Matematika", className: "V-A", startTime: "08:00", endTime: "09:30" };

const demoStudents: Student[] = [
  { id: "SMART-ATT-001", attendanceNumber: "1", nis: "24001", nisn: "3123456789", name: "Alya Putri Ramadhani", className: "V-A", guardian: "Dian Ramadhani", phone: "628123456781" },
  { id: "SMART-ATT-002", attendanceNumber: "2", nis: "24002", nisn: "3123456790", name: "Bima Arya Pratama", className: "V-A", guardian: "Rudi Pratama", phone: "628123456782" },
  { id: "SMART-ATT-003", attendanceNumber: "3", nis: "24003", nisn: "3123456791", name: "Citra Lestari", className: "V-A", guardian: "Siti Lestari", phone: "628123456783" },
  { id: "SMART-ATT-004", attendanceNumber: "1", nis: "24004", nisn: "3123456792", name: "Daffa Maulana", className: "V-B", guardian: "Hendra Maulana", phone: "628123456784" },
  { id: "SMART-ATT-005", attendanceNumber: "2", nis: "24005", nisn: "3123456793", name: "Eka Nuraini", className: "V-B", guardian: "Nur Hasanah", phone: "628123456785" },
];

const demoTasks: TaskRecord[] = [
  { id: "demo-task-1", subject: "Matematika", className: "V-A", title: "Persamaan Linear Satu Variabel", description: "Kerjakan soal latihan pada buku paket halaman 42 nomor 1–10. Tuliskan cara penyelesaian dengan lengkap di buku tugas.", deadline: "2026-07-15T23:59", published: true, snapshotId: "demo", teacherName: "Tomi Guru" },
  { id: "demo-task-2", subject: "Bahasa Indonesia", className: "V-B", title: "Meringkas Teks Eksplanasi", description: "Baca teks eksplanasi yang dibagikan, lalu buat ringkasan sebanyak tiga paragraf menggunakan bahasa sendiri.", deadline: "2026-07-18T20:00", published: true, snapshotId: "demo-2", teacherName: "Tomi Guru" },
  { id: "demo-task-3", subject: "IPA", className: "V-A", title: "Pengamatan Ekosistem Sekolah", description: "Catat lima komponen biotik dan abiotik yang ditemukan di lingkungan sekolah.", deadline: "2026-07-10T15:00", published: false, teacherName: "Tomi Guru" },
];

const navGroups: { label: string; items: { key: NavKey; label: string; icon: typeof Home }[] }[] = [
  { label: "UTAMA", items: [
    { key: "dashboard", label: "Ringkasan", icon: LayoutDashboard },
    { key: "students", label: "Data Siswa", icon: Users },
    { key: "scan", label: "Scan Absensi", icon: ScanLine },
    { key: "attendance", label: "Rekap Absensi", icon: BarChart3 },
    { key: "savings", label: "Tabungan Siswa", icon: Wallet },
  ] },
  { label: "PEMBELAJARAN", items: [
    { key: "schedule", label: "Jadwal Pelajaran", icon: AlarmClock },
    { key: "calendar", label: "Kalender Guru", icon: CalendarDays },
    { key: "subjects", label: "Mata Pelajaran", icon: BookOpen },
    { key: "tasks", label: "Tugas & PR", icon: BookOpen },
    { key: "exams", label: "Soal & Ulangan", icon: ClipboardCheck },
    { key: "ai", label: "Generator Soal AI", icon: Sparkles },
    { key: "scores", label: "Rekap Nilai", icon: ListChecks },
  ] },
  { label: "PENGATURAN", items: [
    { key: "academic", label: "Data Akademik", icon: School },
    { key: "profile", label: "Profil & Akun", icon: CircleUserRound },
  ] },
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo.png" alt="Logo SMART-ATT" className={`${compact ? "h-10 w-10" : "h-12 w-12"} rounded-2xl object-cover shadow-lg shadow-teal-950/20`} />
      <div className={compact ? "hidden lg:block" : ""}>
        <p className="text-lg font-black tracking-tight text-slate-950">SMART-ATT</p>
        <p className="text-[11px] font-medium text-slate-500">Absensi QR & Kuis Cerdas</p>
      </div>
    </div>
  );
}

function ToastMessage({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed left-3 right-3 top-3 z-[100] flex items-center sm:left-auto sm:right-5 sm:top-5 sm:max-w-sm gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-2xl ${toast.tone === "success" ? "bg-emerald-600" : "bg-rose-600"}`}>
      {toast.tone === "success" ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
      {toast.message}
    </div>
  );
}

function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<"SD" | "SMP" | "SMA" | "SMK">("SMP");
  const [accountType, setAccountType] = useState<"individual" | "school">("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const isSuperAdmin = normalizedEmail === SUPERADMIN_EMAIL;
      if (mode === "register") {
        const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        const trialEndsAt = new Date(Date.now() + 14 * 86400000);
        await setDoc(doc(db, "users", result.user.uid), {
          email: normalizedEmail, name, schoolName,
          role: isSuperAdmin ? "superadmin" : "teacher",
          accountType: isSuperAdmin ? "individual" : accountType,
          ...(!isSuperAdmin && accountType === "school" ? { schoolOnboardingStatus: "choose_admin_role", schoolLevel } : {}),
          status: isSuperAdmin ? "active" : "trial",
          createdAt: serverTimestamp(),
          ...(isSuperAdmin ? {} : { trialEndsAt }),
        });
        if (isSuperAdmin) window.location.assign("/superadmin");
      } else {
        const result = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        if (isSuperAdmin) {
          await setDoc(doc(db, "users", result.user.uid), {
            email: normalizedEmail,
            role: "superadmin",
            status: "active",
            updatedAt: serverTimestamp(),
          }, { merge: true });
          window.location.assign("/superadmin");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Autentikasi gagal.";
      setError(message.replace("Firebase: ", "").replace(/\(auth\/.+\)\.?/, ""));
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!email) { setError("Masukkan email terlebih dahulu."); return; }
    setBusy(true); setError("");
    try { await sendPasswordResetEmail(auth, email); setNotice("Tautan reset password sudah dikirim ke email Anda."); }
    catch { setError("Email belum terdaftar atau tidak valid."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#f5f8fb] lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#062f35] px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-40 -top-32 h-96 w-96 rounded-full border border-white/10" />
        <div className="absolute -bottom-40 -left-24 h-[32rem] w-[32rem] rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt="Logo SMART-ATT" className="h-12 w-12 rounded-2xl object-cover" />
          <span className="text-lg font-black tracking-wide">SMART-ATT</span>
        </div>
        <div className="relative max-w-xl pb-12">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-xs font-bold text-teal-100"><ShieldCheck size={15} /> Platform sekolah terintegrasi</div>
          <h1 className="text-5xl font-black leading-[1.08] tracking-tight">Kehadiran tertib.<br /><span className="text-teal-300">Belajar lebih cerdas.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">Kelola absensi QR, data siswa, tugas, dan ujian online dalam satu ruang kerja yang ringan untuk guru.</p>
          <LoginArticlePreview />
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[['< 3 dtk', 'Scan QR'], ['24/7', 'Akses data'], ['1 aplikasi', 'Semua kelas']].map(([value, label]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><p className="text-xl font-black text-white">{value}</p><p className="mt-1 text-xs text-slate-400">{label}</p></div>)}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">© 2026 SMART-ATT · Dibuat untuk sekolah Indonesia</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center justify-between lg:hidden"><Logo /><span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">Trial 14 hari</span></div>
          <div className="mb-8">
            <p className="mb-2 text-sm font-extrabold uppercase tracking-[.18em] text-teal-600">Selamat datang</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-950">{mode === "login" ? "Masuk ke akun Anda" : "Mulai gratis 14 hari"}</h2>
            <p className="mt-2 text-sm text-slate-500">{mode === "login" ? "Gunakan email sekolah yang telah terdaftar." : "Siapkan ruang kerja sekolah Anda dalam beberapa langkah."}</p>
          </div>
          <div className="mb-6 lg:hidden"><LoginArticlePreview variant="light" /></div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && <>
              <fieldset><legend className="mb-2 text-xs font-extrabold text-slate-700">Jenis akun</legend><div className="grid grid-cols-2 gap-3">{([['individual','Guru SD Perorangan','Flow lama'],['school','Per Sekolah','SD / SMP / SMA / SMK']] as const).map(([key,label,note])=><button type="button" key={key} onClick={()=>setAccountType(key)} className={`rounded-xl border-2 p-3 text-left transition ${accountType===key?'border-teal-600 bg-teal-50':'border-slate-200 bg-white'}`}><span className="block text-xs font-black text-slate-800">{label}</span><span className="mt-1 block text-[10px] text-slate-400">{note}</span></button>)}</div></fieldset>
              <Field label="Nama lengkap" value={name} onChange={setName} placeholder="Nama guru" required />
              <Field label="Nama sekolah" value={schoolName} onChange={setSchoolName} placeholder="SMP Harapan Bangsa" required />
              {accountType === "school" && <label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Jenjang sekolah</span><select value={schoolLevel} onChange={(event)=>setSchoolLevel(event.target.value as "SD" | "SMP" | "SMA" | "SMK")} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold"><option value="SD">SD</option><option value="SMP">SMP</option><option value="SMA">SMA</option><option value="SMK">SMK</option></select><span className="mt-1 block text-[10px] text-slate-400">Kurikulum default 2026 dan alur penugasan akan disesuaikan dengan jenjang ini.</span></label>}
            </>}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="guru@sekolah.id" required />
            <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Minimal 6 karakter" required />
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
            {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{notice}</p>}
            <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-extrabold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 disabled:opacity-60">{busy && <Loader2 className="animate-spin" size={18} />}{mode === "login" ? "Masuk" : "Daftar & mulai trial"}</button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" onClick={resetPassword} className="font-bold text-teal-700 hover:underline">Lupa password?</button>
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="font-bold text-slate-700 hover:text-teal-700">{mode === "login" ? "Daftar akun" : "Sudah punya akun"}</button>
          </div>
          <div className="my-7 flex items-center gap-3 text-xs font-bold text-slate-400"><span className="h-px flex-1 bg-slate-200" />ATAU<span className="h-px flex-1 bg-slate-200" /></div>
          <button
            onClick={async () => {
              try {
                await signInWithEmailAndPassword(auth, "kepsek.demo@smart-att.web.id", "demo123456");
              } catch {
                onDemo();
              }
            }}
            className="h-12 w-full rounded-xl bg-teal-600 text-sm font-extrabold text-white shadow-md transition hover:bg-teal-700"
          >
            🏫 Pratinjau Demo School (SMA Negeri Demo 1)
          </button>
          <button onClick={onDemo} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white text-xs font-extrabold text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-700">Lihat demo dasbor guru SD</button>
          <div className="mt-8 space-y-3 text-center"><p className="text-xs leading-5 text-slate-400">Dengan masuk, Anda menyetujui ketentuan layanan SMART-ATT.</p><PublicInfoLinks className="text-slate-500" /></div>
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">{label}</span><input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" /></label>;
}

type PublicInfoKind = "faq" | "terms" | "refund" | "contact";

const PUBLIC_INFO: Record<Exclude<PublicInfoKind, "contact">, { label: string; title: string; lead: string; entries: { title: string; body: string }[] }> = {
  faq: {
    label: "PUSAT BANTUAN", title: "Pertanyaan yang sering ditanyakan", lead: "Panduan terbaru penggunaan SMART-ATT untuk Guru SD perorangan dan pengelolaan sekolah SD, SMP, SMA, serta SMK.",
    entries: [
      { title: "Apa itu SMART-ATT?", body: "SMART-ATT adalah platform berbasis web untuk absensi QR, data siswa, komunikasi wali, tabungan kelas, tugas/PR, soal dan ulangan, nilai, laporan, kartu pelajar, manajemen guru, penugasan mengajar, serta penyusunan jadwal sekolah." },
      { title: "Apa perbedaan akun Individual dan School?", body: "Individual mempertahankan flow lama Guru SD yang mengelola kelasnya sendiri. School memakai workspace bersama dengan role Kepala Sekolah, Tata Usaha, dan Guru. Akun lama tanpa accountType tetap dianggap Individual sehingga tidak membutuhkan migrasi manual." },
      { title: "Jenjang apa saja yang didukung?", body: "Mode School mendukung SD, SMP, SMA, dan SMK. Template mata pelajaran 2026 disesuaikan menurut jenjang dan tetap dapat ditambah, diubah, dinonaktifkan, atau disesuaikan oleh administrator sekolah." },
      { title: "Siapa yang boleh mengubah data sekolah?", body: "Kepala Sekolah memiliki akses penuh. Tata Usaha mengelola administrasi seperti guru, siswa, kelas, mata pelajaran, penugasan, dan jadwal. Guru hanya melihat kelas/mapel yang ditugaskan serta fitur pembelajaran yang diizinkan; menu tanpa izin tidak ditampilkan." },
      { title: "Bagaimana menambahkan guru dan siswa dalam jumlah banyak?", body: "Administrator dapat memakai import CSV untuk guru maupun siswa. Guru juga dapat mendaftar melalui link resmi sekolah. Nama kelas dan mata pelajaran pada CSV harus cocok dengan data aktif di workspace sekolah; kelas guru boleh dikosongkan untuk ditugaskan kemudian." },
      { title: "Bagaimana absensi mode sekolah bekerja?", body: "Sekolah menyediakan HP, tablet, atau laptop sebagai scanner kedatangan. Siswa scan satu kali saat datang; hasil dapat dilihat TU, guru terkait, dan wali kelas. Wali dapat menerima tautan WhatsApp dan mengirim konfirmasi sakit/izin. Mode Individual tetap memakai flow absensi Guru SD yang lama." },
      { title: "Bagaimana jadwal otomatis dibuat?", body: "Admin mengisi kelas, mapel aktif, guru, kemampuan lintas bidang, JP per minggu, jam belajar, dan waktu istirahat. Generator membuat draft tanpa bentrok guru/kelas dan melaporkan kekurangan guru atau slot. Draft tetap harus ditinjau sebelum diterapkan." },
      { title: "Apakah guru dapat membuat soal dengan AI?", body: "Ya. Guru sekolah dapat membuat draf soal/ulangan sesuai kelas dan mata pelajaran yang menjadi tugasnya. Hasil generator merupakan bahan bantu; guru wajib meninjau isi, jawaban, tingkat kesulitan, jadwal, dan peserta sebelum memublikasikan." },
      { title: "Apa yang terjadi saat pergantian tahun ajaran?", body: "Admin dapat mencetak arsip lengkap, melihat preview kenaikan, lalu memproses siswa ke kelas berikutnya. Tingkat akhir menjadi alumni tanpa dihapus. Salinan digital data kelas, siswa, guru, mapel, penugasan, jadwal, dan rencana kenaikan tersimpan sebagai riwayat baca-saja." },
      { title: "Di mana data dan gambar disimpan?", body: "Autentikasi dan data aplikasi menggunakan Firebase/Cloud Firestore. File seperti foto siswa, sampul artikel, serta PDF tertentu memakai Cloudflare R2 dan layanan Cloudflare Pages. Hak akses dipisahkan berdasarkan pemilik akun, workspace sekolah, role, dan penugasan kelas." },
      { title: "Apakah tersedia masa percobaan dan bagaimana memperpanjangnya?", body: "Akun yang memenuhi ketentuan pendaftaran dapat memperoleh trial sesuai durasi yang tampil. Setelah berakhir, hubungi admin untuk token yang sesuai jenis akun. Token Individual SATT-I tidak dapat dipakai akun School dan token School SATT-S tidak dapat dipakai akun Individual." },
      { title: "Bagaimana jika QR, kamera, suara, PDF, atau login bermasalah?", body: "Refresh halaman, periksa izin kamera dan pop-up, pastikan koneksi stabil, lalu coba kembali. Untuk QR gunakan pencahayaan cukup dan kartu yang tidak rusak. Jika masih gagal, hubungi dukungan dengan email akun, nama sekolah, perangkat/browser, waktu kejadian, dan tangkapan layar tanpa password/token." }
    ]
  },
  terms: {
    label: "DOKUMEN LAYANAN", title: "Syarat & Ketentuan", lead: "Berlaku efektif dan terakhir diperbarui 22 Juli 2026 untuk seluruh pengguna SMART-ATT.",
    entries: [
      { title: "1. Persetujuan dan ruang lingkup", body: "Dengan mendaftar, login, mengaktifkan token, atau memakai SMART-ATT, pengguna menyetujui ketentuan ini. Layanan ditujukan untuk administrasi dan pembelajaran sekolah yang sah melalui browser pada HP, tablet, atau komputer." },
      { title: "2. Jenis akun dan kompatibilitas", body: "SMART-ATT menyediakan akun Individual untuk flow Guru SD perorangan dan akun School untuk workspace SD/SMP/SMA/SMK. Akun lama tanpa accountType diperlakukan sebagai Individual. Pengguna tidak boleh memaksa pemindahan tipe akun atau data dengan cara yang melewati prosedur resmi." },
      { title: "3. Role dan kewenangan sekolah", body: "Pada mode School, Kepala Sekolah dan Tata Usaha bertindak sebagai administrator sesuai permission yang tersedia. Mereka bertanggung jawab membuat serta menonaktifkan akun guru, menetapkan kelas/mapel, mengatur jadwal, dan memastikan hak akses diberikan hanya kepada personel berwenang. Guru wajib mematuhi pembatasan kelas dan mapel yang ditetapkan." },
      { title: "4. Akun, password, token, dan perangkat", body: "Pemilik akun bertanggung jawab menjaga email, password, token aktivasi, link publik, serta perangkat scanner. Password dan token tidak boleh dibagikan. Aktivitas yang memakai kredensial sah dianggap berasal dari akun tersebut sampai pengguna melaporkan dugaan penyalahgunaan." },
      { title: "5. Data siswa, wali, dan sekolah", body: "Sekolah/pengguna menjamin memiliki kewenangan dan dasar yang sesuai untuk memasukkan serta memakai data siswa, foto, identitas wali, kehadiran, nilai, tabungan, dan data pembelajaran. Data hanya boleh digunakan untuk kepentingan pendidikan dan administrasi yang sah, dengan memperhatikan ketentuan pelindungan data yang berlaku." },
      { title: "6. Penyimpanan dan link publik", body: "Data aplikasi dapat diproses melalui Firebase/Cloud Firestore; file tertentu melalui Cloudflare R2/Pages. Link publik untuk pendataan wali, konfirmasi absensi, tugas, ujian, atau tabungan harus dibagikan secara terbatas. Pengguna bertanggung jawab menonaktifkan link yang tidak lagi dibutuhkan dan tidak menyebarkan data hasilnya secara sembarangan." },
      { title: "7. Trial, masa aktif, dan token", body: "Trial dan masa aktif mengikuti informasi yang tampil pada akun. Setelah berakhir, akses dapat dikunci sampai token sah diaktifkan. Token bersifat digital, sekali pakai, memiliki masa berlaku/durasi, dan terikat jenis akun: SATT-I untuk Individual serta SATT-S untuk School." },
      { title: "8. Konten, soal AI, jadwal, dan keputusan sekolah", body: "Generator soal, pembagian guru, rekomendasi kebutuhan guru, serta jadwal otomatis adalah alat bantu berbasis input pengguna dan perhitungan sistem. Sekolah/guru tetap wajib meninjau kebenaran soal, kunci jawaban, beban JP, bentrok, peserta, nilai, laporan, dan keputusan akhir sebelum digunakan." },
      { title: "9. Absensi, QR, dan sarana operasional", body: "Sekolah bertanggung jawab menyediakan perangkat, koneksi, pencahayaan, kartu QR, pengawasan scanner, dan prosedur cadangan bila perangkat bermasalah. Pengguna wajib memeriksa tanggal, kelas, serta sesi sebelum menyimpan atau menghapus absensi." },
      { title: "10. Arsip, ekspor, dan cadangan", body: "SMART-ATT menyediakan sejumlah fitur cetak, PDF, CSV, serta arsip tahun ajaran. Pengguna tetap dianjurkan menyimpan salinan resmi secara berkala. Arsip digital bersifat bantuan administrasi dan bukan pengganti kewajiban penyimpanan dokumen sekolah menurut kebijakan instansi." },
      { title: "11. Larangan penggunaan", body: "Dilarang mengakses workspace tanpa izin, memalsukan kehadiran/nilai, menyalahgunakan data anak atau wali, mengunggah konten melanggar hukum, menyerang atau membebani sistem, membagikan token secara ilegal, membongkar pengamanan, atau merugikan pengguna lain." },
      { title: "12. Ketersediaan dan pemeliharaan", body: "Layanan dapat mengalami pemeliharaan, pembaruan, gangguan koneksi, atau ketergantungan pada penyedia pihak ketiga. SMART-ATT akan melakukan upaya yang wajar untuk menjaga layanan, tetapi pengguna harus menyiapkan prosedur operasional cadangan untuk kegiatan sekolah yang tidak boleh terhenti." },
      { title: "13. Penangguhan dan penghentian akses", body: "Akses dapat dibatasi atau dinonaktifkan bila masa aktif berakhir, terdapat dugaan pelanggaran, risiko keamanan, kewajiban hukum, atau permintaan administrator sekolah yang berwenang. Pengguna dapat menghubungi dukungan untuk klarifikasi dan penanganan akun." },
      { title: "14. Perubahan ketentuan dan kontak", body: "Fitur, biaya, keamanan, serta ketentuan dapat diperbarui mengikuti perkembangan layanan dan peraturan. Versi terbaru ditampilkan pada halaman ini. Pertanyaan atau keberatan dapat disampaikan melalui kanal resmi pada halaman Kontak." }
    ]
  },
  refund: {
    label: "KEBIJAKAN PEMBAYARAN", title: "Kebijakan Pengembalian Dana", lead: "Berlaku untuk pembelian token SMART-ATT melalui kanal resmi; terakhir diperbarui 22 Juli 2026.",
    entries: [
      { title: "Ruang lingkup", body: "Kebijakan ini berlaku untuk token Individual (SATT-I) dan School (SATT-S) yang dibeli langsung melalui kanal resmi SMART-ATT. Pembayaran kepada pihak lain harus diselesaikan dengan pihak penerima pembayaran tersebut." },
      { title: "Karakter token digital", body: "Token bersifat digital, sekali pakai, mempunyai jenis akun, batas aktivasi, dan durasi layanan. Pengguna wajib memeriksa email akun, pilihan Individual/School, harga, serta durasi sebelum membayar atau mengaktifkan token." },
      { title: "Kondisi yang dapat ditinjau", body: "Permohonan dapat ditinjau bila terjadi pembayaran ganda untuk transaksi yang sama, pembayaran terverifikasi tetapi token tidak dikirim, token yang diberikan admin resmi tidak sesuai jenis akun yang telah dipesan, atau token valid gagal digunakan karena kesalahan sistem SMART-ATT." },
      { title: "Penyelesaian awal", body: "Sebelum refund, admin dapat menawarkan koreksi token, penggantian token, perbaikan aktivasi, atau penyesuaian masa aktif. Solusi dipilih setelah transaksi, status token, jenis akun, dan log aktivasi diverifikasi." },
      { title: "Kondisi yang umumnya tidak dapat dikembalikan", body: "Token yang sudah berhasil dipakai dan menambah masa aktif umumnya tidak dapat direfund. Refund juga tidak berlaku untuk lupa password, salah memasukkan data oleh pengguna, perubahan kebutuhan setelah aktivasi, perangkat/koneksi pengguna, pelanggaran ketentuan, atau token yang dibiarkan melewati batas aktivasi." },
      { title: "Batas pengajuan", body: "Ajukan melalui WhatsApp atau email resmi secepatnya dan paling lambat 7 hari kalender sejak pembayaran. Jangan mengaktifkan token yang dipersoalkan selama pemeriksaan, kecuali diarahkan admin." },
      { title: "Bukti yang diperlukan", body: "Sertakan nama pembeli/sekolah, email akun, jenis akun, tanggal dan nominal pembayaran, bukti transaksi, kode token bila sudah diterima, kronologi, serta tangkapan layar pesan kesalahan. Jangan pernah mengirim password akun." },
      { title: "Verifikasi dan hasil", body: "Admin memeriksa kecocokan pembayaran, penerbitan token, status penggunaan, dan gangguan layanan. Keputusan disampaikan melalui kanal resmi. Bila disetujui, metode serta waktu pengembalian dikonfirmasi kepada pemohon berdasarkan sarana pembayaran yang tersedia." },
      { title: "Hak berdasarkan peraturan", body: "Kebijakan ini tidak dimaksudkan mengurangi hak pengguna yang wajib diberikan berdasarkan peraturan perundang-undangan Indonesia. Sengketa diupayakan terlebih dahulu melalui komunikasi dan penyelesaian yang wajar." }
    ]
  }
};

function PublicInfoLinks({ className = "" }: { className?: string }) {
  return <nav aria-label="Informasi SMART-ATT" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold ${className}`}><a href="/faq" className="hover:text-teal-600 hover:underline">FAQ</a><a href="/syarat-ketentuan" className="hover:text-teal-600 hover:underline">Syarat & Ketentuan</a><a href="/refund-policy" className="hover:text-teal-600 hover:underline">Kebijakan Pengembalian Dana</a><a href="/kontak" className="hover:text-teal-600 hover:underline">Kontak</a></nav>;
}

function PublicInfoPage({ kind }: { kind: PublicInfoKind }) {
  const isContact = kind === "contact";
  const content = isContact ? null : PUBLIC_INFO[kind];
  const title = isContact ? "Hubungi SMART-ATT" : content!.title;
  const lead = isContact ? "Dukungan resmi untuk akun Individual/School, token, onboarding sekolah, import data, absensi, jadwal, ujian, laporan, dan kendala teknis." : content!.lead;
  useEffect(() => {
    document.title = `${title} | SMART-ATT`;
    let description = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!description) { description = document.createElement("meta"); description.name = "description"; document.head.appendChild(description); }
    description.content = lead;
  }, [title, lead]);
  const whatsappText = "Halo Admin SMART-ATT, saya membutuhkan bantuan. Nama sekolah: ... Email akun: ... Jenis akun (Individual/School): ... Kendala: ...";
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dff9f3,transparent_34%),linear-gradient(135deg,#f7fbff,#fffaf0)] text-slate-900">
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8"><a href="/" className="flex items-center gap-3"><img src="/logo.png" alt="SMART-ATT" className="h-10 w-10 rounded-xl object-cover shadow-sm"/><span><strong className="block text-sm font-black tracking-wide">SMART-ATT</strong><span className="block text-[10px] font-bold text-slate-500">School ERP · Absensi QR · Smart Quiz</span></span></a><a href="/" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:border-teal-300 hover:text-teal-700"><ArrowLeft size={15}/>Kembali</a></header>
    <section className="mx-auto w-full max-w-4xl px-5 pb-14 pt-6 sm:px-8 sm:pt-12"><div className="rounded-3xl border border-teal-100 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-10"><p className="text-[11px] font-black tracking-[.18em] text-teal-600">{isContact ? "KONTAK RESMI" : content!.label}</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base">{lead}</p>
      {isContact ? <div className="mt-8"><div className="grid gap-4 sm:grid-cols-2"><a href={`https://wa.me/6285176932228?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 transition hover:-translate-y-0.5 hover:shadow-md"><MessageCircle className="text-emerald-600" size={24}/><h2 className="mt-4 font-black">WhatsApp Admin</h2><p className="mt-1 text-sm text-slate-600">0851-7693-2228</p><p className="mt-3 text-xs font-bold text-emerald-700">Token, aktivasi, dan bantuan cepat →</p></a><a href="mailto:idhamdjuanda@gmail.com?subject=Bantuan%20SMART-ATT" className="rounded-2xl border border-sky-100 bg-sky-50 p-5 transition hover:-translate-y-0.5 hover:shadow-md"><Send className="text-sky-600" size={24}/><h2 className="mt-4 font-black">Email Dukungan</h2><p className="mt-1 break-all text-sm text-slate-600">idhamdjuanda@gmail.com</p><p className="mt-3 text-xs font-bold text-sky-700">Kendala rinci dan lampiran screenshot →</p></a></div><div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><h2 className="text-sm font-black">Agar lebih cepat ditangani</h2><ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600"><li>• Sertakan nama sekolah dan email akun.</li><li>• Tulis jenis akun: Individual atau School, beserta role jika School.</li><li>• Jelaskan menu, waktu kejadian, perangkat, dan browser yang digunakan.</li><li>• Lampirkan screenshot pesan error dan langkah sebelum kendala muncul.</li><li>• Untuk pembayaran, sertakan tanggal, nominal, dan bukti transaksi.</li></ul></section><section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><ShieldCheck className="text-amber-700" size={22}/><h2 className="mt-3 text-sm font-black text-amber-950">Jaga keamanan akun</h2><p className="mt-2 text-xs leading-5 text-amber-800">Admin tidak meminta password. Jangan mengirim password, token yang masih aktif, data sensitif siswa, atau link ujian publik melalui grup/kanal tidak resmi.</p><p className="mt-3 text-[10px] font-black text-amber-700">DOMAIN RESMI · smart-att.web.id</p></section></div></div> : <div className="mt-8 space-y-3">{content!.entries.map((entry) => <article key={entry.title} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-5"><h2 className="text-sm font-black text-slate-900">{entry.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{entry.body}</p></article>)}</div>}
      <div className="mt-10 border-t border-slate-100 pt-6"><PublicInfoLinks className="text-slate-500"/><p className="mt-5 text-center text-[11px] font-medium text-slate-400">© 2026 SMART-ATT · Platform sekolah untuk Indonesia</p></div></div></section>
  </main>;
}
const SMARTATT_ADMIN_WHATSAPP = "6285176932228";

function AccountLockedScreen({ user, disabled, accountType, onLogout }: { user: User; disabled: boolean; accountType: TokenAccountType; onLogout: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const whatsappMessage = `Halo Admin SMART-ATT, saya ingin membeli token ${tokenAccountTypeLabel(accountType)} atau memperpanjang masa aktif SMART-ATT. Email akun saya: ${user.email ?? "-"}. Mohon informasi pembelian tokennya.`;
  const whatsappUrl = `https://wa.me/${SMARTATT_ADMIN_WHATSAPP}?text=${encodeURIComponent(whatsappMessage)}`;

  async function activateToken() {
    const code = token.trim().toUpperCase();
    if (!code) { setError("Masukkan token aktivasi yang diberikan admin."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await runTransaction(db, async (transaction) => {
        const tokenRef = doc(db, "activationTokens", code);
        const userRef = doc(db, "users", user.uid);
        const [tokenSnapshot, userSnapshot] = await Promise.all([transaction.get(tokenRef), transaction.get(userRef)]);
        if (!tokenSnapshot.exists()) throw new Error("Token tidak ditemukan.");
        const tokenData = tokenSnapshot.data() as { status?: string; tokenExpiresAtMs?: number; durationDays?: number; accountType?: TokenAccountType };
        const now = Date.now();
        if (tokenData.status !== "active") throw new Error(tokenData.status === "used" ? "Token sudah digunakan." : "Token tidak aktif.");
        if (!tokenData.tokenExpiresAtMs || tokenData.tokenExpiresAtMs <= now) throw new Error("Token sudah kedaluwarsa.");
        if (!tokenData.durationDays) throw new Error("Durasi token tidak valid.");
        const userData = userSnapshot.data() as { accountType?: TokenAccountType; activeUntilMs?: number; trialEndsAt?: { toMillis?: () => number } } | undefined;
        if (!tokenMatchesAccountType(tokenData.accountType, userData?.accountType)) {
          throw new Error(accountType === "school" ? "Token Guru SD tidak dapat dipakai untuk akun sekolah." : "Token sekolah tidak dapat dipakai untuk akun Guru SD perorangan.");
        }
        const base = Math.max(now, userData?.activeUntilMs ?? userData?.trialEndsAt?.toMillis?.() ?? 0);
        const activeUntilMs = base + tokenData.durationDays * 86400000;
        transaction.update(tokenRef, { status: "used", usedBy: user.uid, usedByEmail: user.email ?? "", usedAtMs: now, accountExpiresAtMs: activeUntilMs, usedAt: serverTimestamp() });
        transaction.update(userRef, { status: "active", disabled: false, activeTokenId: code, tokenActivatedAtMs: now, activeUntilMs, updatedAt: serverTimestamp() });
      });
      setToken(""); setMessage("Token berhasil diaktifkan. SMART-ATT sedang membuka kembali akun Anda.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Token gagal diaktifkan."); }
    finally { setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#e7faf6,transparent_35%),linear-gradient(135deg,#f8fbff,#fff9ed)] p-5"><section className="w-full max-w-md rounded-3xl border border-rose-100 bg-white p-7 text-center shadow-xl sm:p-8"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-600"><LockKeyhole size={32}/></div><h1 className="mt-5 text-2xl font-black">{disabled ? "Akun dinonaktifkan" : "Masa aktif SMART-ATT berakhir"}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{disabled ? "Akun ini dinonaktifkan oleh administrator. Hubungi admin SMART-ATT untuk bantuan." : "Trial atau token akun Anda sudah habis. Seluruh fitur dikunci sampai masa aktif diperpanjang."}</p>{!disabled&&<div className="mt-6 rounded-2xl bg-slate-50 p-4 text-left"><p className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-[10px] font-black text-teal-700">AKUN {tokenAccountTypeLabel(accountType).toUpperCase()} · gunakan token {accountType==='school'?'SATT-S':'SATT-I'}</p><label><span className="mb-2 block text-xs font-extrabold">Sudah punya token?</span><input value={token} onChange={(event) => { setToken(event.target.value.toUpperCase()); setError(""); }} placeholder={accountType==='school'?"SATT-S-XXXXXXXXXXXX":"SATT-I-XXXXXXXXXXXX"} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm uppercase outline-none focus:border-teal-500"/></label><button disabled={busy || !token.trim()} onClick={() => void activateToken()} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-extrabold text-white disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={17}/> : <ShieldCheck size={17}/>}Aktifkan token</button></div>}{error&&<p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}{message&&<p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{message}</p>}<a href={whatsappUrl} target="_blank" rel="noreferrer" className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-extrabold text-white"><MessageCircle size={18}/>Beli token SMART-ATT via WhatsApp</a><p className="mt-2 text-xs font-bold text-slate-500">Admin: 0851-7693-2228</p><button onClick={() => void onLogout()} className="mt-5 text-xs font-black text-slate-500 hover:text-slate-900">Keluar dari akun</button></section></main>;
}

function SmartAttApp() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<NavKey>("dashboard");
  const [students, setStudents] = useState<Student[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveTeachingSession>(DEFAULT_ACTIVE_SESSION);
  const [toast, setToast] = useState<Toast>(null);
  const [accountGate, setAccountGate] = useState({ loaded: false, disabled: false, expiryMs: 0, verificationError: false });
  const [accountAccess, setAccountAccess] = useState<AccountAccessProfile>(() => normalizeAccountAccess(undefined));
  const [accountProfile, setAccountProfile] = useState({ name: "", schoolName: "", schoolLevel: "SMP" as "SD" | "SMP" | "SMA" | "SMK" });
  const [accountClock, setAccountClock] = useState(Date.now());
  const [showVerificationError, setShowVerificationError] = useState(false);
  const processingGuardianResponsesRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let authSettled = false;
    const finishAuth = (nextUser: User | null) => {
      authSettled = true;
      setAccountGate({ loaded: !nextUser, disabled: false, expiryMs: 0, verificationError: false });
      setUser(nextUser);
      if (!nextUser) { setAccountAccess(normalizeAccountAccess(undefined)); setAccountProfile({ name: "", schoolName: "", schoolLevel: "SMP" }); }
      setAuthReady(true);
    };
    const unsubscribe = onAuthStateChanged(auth, finishAuth, () => finishAuth(auth.currentUser));
    const watchdog = window.setTimeout(() => {
      if (!authSettled) finishAuth(auth.currentUser);
    }, 6000);
    return () => { window.clearTimeout(watchdog); unsubscribe(); };
  }, []);
  useEffect(() => { const interval = setInterval(() => setAccountClock(Date.now()), 60000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    if (!accountGate.verificationError) { setShowVerificationError(false); return; }
    const timer = setTimeout(() => setShowVerificationError(true), 6000);
    return () => clearTimeout(timer);
  }, [accountGate.verificationError]);
  useEffect(() => {
    if (!user) { setAccountGate({ loaded: true, disabled: false, expiryMs: 0, verificationError: false }); return; }
    const userRef = doc(db, "users", user.uid);
    const markOnline = (login = false) => setDoc(userRef, {
      email: user.email?.toLowerCase() ?? "",
      lastSeenAtMs: Date.now(),
      online: true,
      ...(login ? { lastLoginAtMs: Date.now(), lastLoginAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    void markOnline(true);
    const heartbeat = setInterval(() => void markOnline(false), 60000);
    const visibility = () => { if (document.visibilityState === "visible") void markOnline(false); };
    document.addEventListener("visibilitychange", visibility);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      void (async () => {
        if (!snapshot.exists()) { setAccountGate({ loaded: true, disabled: false, expiryMs: 0, verificationError: true }); return; }
        const data = snapshot.data();
        setAccountAccess(normalizeAccountAccess(data));
        const schoolLevel = data.schoolLevel === "SD" || data.schoolLevel === "SMP" || data.schoolLevel === "SMA" || data.schoolLevel === "SMK" ? data.schoolLevel : "SMP";
        setAccountProfile({ name: typeof data.name === "string" ? data.name : "", schoolName: typeof data.schoolName === "string" ? data.schoolName : "", schoolLevel });
        const toMillis = (value: unknown) => {
          if (typeof value === "number" && Number.isFinite(value)) return value;
          if (typeof value === "string") { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
          if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
          return 0;
        };
        let expiryMs = toMillis(data.activeUntilMs) || toMillis(data.activeUntil) || toMillis(data.trialEndsAt);
        if (!expiryMs && typeof data.activeTokenId === "string" && data.activeTokenId) {
          try {
            const tokenSnapshot = await getDoc(doc(db, "activationTokens", data.activeTokenId));
            const tokenData = tokenSnapshot.data();
            if (tokenSnapshot.exists() && tokenData?.usedBy === user.uid) expiryMs = toMillis(tokenData.accountExpiresAtMs) || toMillis(tokenData.accountExpiresAt);
          } catch { /* Verifikasi error ditangani di bawah. */ }
        }
        setAccountGate({
          loaded: true,
          disabled: data.disabled === true || data.status === "disabled",
          expiryMs,
          verificationError: !expiryMs && data.status !== "disabled" && !(data.accountType === "school" && data.schoolRole === "teacher"),
        });
      })();
    }, () => setAccountGate({ loaded: true, disabled: false, expiryMs: 0, verificationError: true }));
    return () => {
      clearInterval(heartbeat); document.removeEventListener("visibilitychange", visibility); unsubscribe();
      void updateDoc(userRef, { online: false, lastSeenAtMs: Date.now(), updatedAt: serverTimestamp() }).catch(() => undefined);
    };
  }, [user]);
  useEffect(() => {
    if (!user) { setStudents(demoStudents); return; }
    if (accountAccess.accountType === "school") { setStudents([]); return; }
    setStudents([]);
    const q = query(collection(db, "users", user.uid, "students"), orderBy("name"));
    return onSnapshot(q, (snap) => setStudents(snap.docs.map((item) => ({ id: item.id, ...item.data() } as Student))), () => setToast({ message: "Firestore belum siap. Periksa rules dan konfigurasi proyek.", tone: "error" }));
  }, [user, demo, accountAccess.accountType]);
  useEffect(() => {
    if (demo) { setActiveSession(DEFAULT_ACTIVE_SESSION); return; }
    if (!user) return;
    if (accountAccess.accountType === "school") return;
    return onSnapshot(doc(db, "users", user.uid, "settings", "activeTeachingSession"), (snapshot) => {
      const data = snapshot.data() as Partial<ActiveTeachingSession> | undefined;
      if (!data) return;
      setActiveSession({
        subjectId: typeof data.subjectId === "string" ? data.subjectId : DEFAULT_ACTIVE_SESSION.subjectId,
        subjectName: typeof data.subjectName === "string" ? data.subjectName : DEFAULT_ACTIVE_SESSION.subjectName,
        className: typeof data.className === "string" ? data.className : DEFAULT_ACTIVE_SESSION.className,
        startTime: typeof data.startTime === "string" ? data.startTime : DEFAULT_ACTIVE_SESSION.startTime,
        endTime: typeof data.endTime === "string" ? data.endTime : DEFAULT_ACTIVE_SESSION.endTime,
      });
    });
  }, [user, demo, accountAccess.accountType]);
  useEffect(() => {
    if (!user) return;
    if (accountAccess.accountType === "school") return;
    const responsesQuery = query(collection(db, "publicResponses"), where("ownerUid", "==", user.uid));
    return onSnapshot(responsesQuery, (snapshot) => {
      for (const response of snapshot.docs) {
        const data = response.data() as { studentId?: string; guardian?: string; phone?: string; photoKey?: string; photoThumbnailKey?: string; photoAspect?: PhotoAspect; status?: string };
        if (data.status !== "pending" || !data.studentId || !data.guardian || !data.phone) continue;
        const studentId = data.studentId;
        if (processingGuardianResponsesRef.current[response.id]) continue;
        processingGuardianResponsesRef.current[response.id] = true;
        void (async () => {
          try {
            const photoUpdates: Record<string, string> = {};
            if (data.photoKey && data.photoThumbnailKey) {
              const token = await user.getIdToken();
              const acceptPhoto = async (sourceKey: string) => {
                const result = await fetch("/api/storage/accept-guardian-photo", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey, studentId }) });
                if (!result.ok) throw new Error("Foto kiriman wali belum dapat dipindahkan ke data siswa.");
                return (await result.json() as { key: string }).key;
              };
              const [photoKey, photoThumbnailKey] = await Promise.all([acceptPhoto(data.photoKey), acceptPhoto(data.photoThumbnailKey)]);
              photoUpdates.photoKey = photoKey;
              photoUpdates.photoThumbnailKey = photoThumbnailKey;
              photoUpdates.photoAspect = data.photoAspect === "4:3" ? "4:3" : "3:4";
            }
            const updates = { guardian: data.guardian, phone: data.phone, ...photoUpdates, guardianUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() };
            const batch = writeBatch(db);
            batch.update(doc(db, "users", user.uid, "students", studentId), updates);
            batch.set(doc(db, "studentDirectory", `${user.uid}__${studentId}`), { ownerUid: user.uid, studentId, ...updates }, { merge: true });
            batch.set(doc(db, "studentDirectory", studentId), { ownerUid: user.uid, studentId, ...updates }, { merge: true });
            batch.update(response.ref, { status: "applied", appliedAt: serverTimestamp() });
            await batch.commit();
          } catch { setToast({ message: "Kiriman wali diterima, tetapi belum dapat disinkronkan.", tone: "error" }); }
          finally { delete processingGuardianResponsesRef.current[response.id]; }
        })();
      }
    }, () => setToast({ message: "Kiriman data wali belum dapat dibaca.", tone: "error" }));
  }, [user, accountAccess.accountType]);
  useEffect(() => {
    if (!user) return;
    const schoolId = accountAccess.accountType === "school" ? accountAccess.schoolId : undefined;
    const responsesQuery = schoolId
      ? query(collection(db, "publicAbsenceResponses"), where("schoolId", "==", schoolId))
      : query(collection(db, "publicAbsenceResponses"), where("ownerUid", "==", user.uid));
    return onSnapshot(responsesQuery, (snapshot) => {
      for (const response of snapshot.docs) {
        const data = response.data() as { snapshotId?: string; schoolId?: string; sessionId?: string; studentId?: string; attendanceStatus?: AbsensiStatus; reason?: string; status?: string };
        if (data.status !== "pending" || !data.snapshotId || !data.sessionId || !data.studentId || !data.attendanceStatus || !data.reason) continue;
        const batch = writeBatch(db);
        const sessionRef = schoolId && data.schoolId === schoolId
          ? doc(db, "schools", schoolId, "attendanceSessions", data.sessionId)
          : doc(db, "users", user.uid, "attendanceSessions", data.sessionId);
        batch.update(sessionRef, {
          [`records.${data.studentId}`]: {
            studentId: data.studentId,
            status: data.attendanceStatus,
            reason: data.reason,
            source: "guardian",
            recordedAtMs: Date.now(),
          },
          updatedAt: serverTimestamp(),
        });
        batch.update(response.ref, { status: "applied", appliedAt: serverTimestamp() });
        batch.update(doc(db, "publicSnapshots", data.snapshotId), { published: false, updatedAt: serverTimestamp() });
        void batch.commit().catch(() => setToast({ message: "Konfirmasi sakit/izin diterima tetapi belum dapat diterapkan.", tone: "error" }));
      }
    }, () => setToast({ message: "Konfirmasi ketidakhadiran belum dapat dibaca.", tone: "error" }));
  }, [user, accountAccess.accountType, accountAccess.schoolId]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);

  if (pathname === "/faq") return <PublicInfoPage kind="faq"/>;
  if (pathname === "/syarat-ketentuan") return <PublicInfoPage kind="terms"/>;
  if (pathname === "/refund-policy") return <PublicInfoPage kind="refund"/>;
  if (pathname === "/kontak") return <PublicInfoPage kind="contact"/>;
  if (pathname.startsWith("/articles")) { const slug=pathname.split("/").filter(Boolean)[1]; return <PublicArticles slug={slug}/>; }
  if (["/link","/quiz","/soal"].some((route)=>pathname===route||pathname.startsWith(`${route}/`))) return <PublicLinkPortal/>;
  if (pathname.startsWith("/public/quiz")) return <PublicQuizProfessional />;
  if (pathname.startsWith("/public/task")) return <PublicTask />;
  if (pathname.startsWith("/public/absence")) return <AbsenceConfirmationForm />;
  if (pathname.startsWith("/public/pilih-mapel")) return <PublicSubjectElection />;
  if (pathname.startsWith("/public/status-mapel")) return <PublicElectionStatus />;
  if (pathname.startsWith("/public/guardian-data")) return <GuardianDataForm />;
  if (pathname.startsWith("/public/guardian")) return <GuardianDataForm />;
  if (pathname.startsWith("/public/teacher-register")) return <PublicTeacherRegistration />;
  if (!authReady) return <div className="grid min-h-screen place-items-center bg-slate-50"><div className="text-center"><img src="/logo.png" alt="SMART-ATT" className="mx-auto h-20 w-20 animate-pulse rounded-3xl object-cover" /><p className="mt-4 text-sm font-bold text-slate-500">Menyiapkan SMART-ATT...</p></div></div>;
  if (!user && !demo) return <AuthScreen onDemo={() => setDemo(true)} />;
  const isSuperAdmin = user?.email?.toLowerCase() === SUPERADMIN_EMAIL;
  if (isSuperAdmin && (pathname === "/" || pathname.startsWith("/superadmin"))) return <SuperAdminProfessional user={user!} onLogout={async () => { if (user) await signOut(auth); setDemo(false); window.location.assign("/"); }} />;
  if (pathname.startsWith("/superadmin")) return <SuperAdminDenied onLogout={async () => { if (user) await signOut(auth); setDemo(false); window.location.assign("/"); }} />;
  if (user && !demo && (!accountGate.loaded || (accountGate.verificationError && !showVerificationError))) return <div className="grid min-h-screen place-items-center bg-slate-50"><div className="text-center"><Loader2 className="mx-auto animate-spin text-teal-600" size={34}/><p className="mt-3 text-sm font-bold text-slate-500">Menyiapkan akun...</p></div></div>;
  if (user && !demo && accountGate.verificationError && showVerificationError) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl border border-amber-100 bg-white p-8 text-center shadow-xl"><RefreshCcw className="mx-auto text-amber-600" size={40}/><h1 className="mt-5 text-2xl font-black">Status akun belum terbaca</h1><p className="mt-3 text-sm leading-6 text-slate-500">Koneksi ke data masa aktif sedang terganggu. Akun tidak dianggap expired dan Anda tidak perlu membeli token lagi.</p><button onClick={() => window.location.reload()} className="mt-6 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white">Coba verifikasi lagi</button><button onClick={() => void signOut(auth)} className="mt-4 text-xs font-black text-slate-500">Keluar dari akun</button></section></main>;
  if (user && !demo && accountGate.disabled) return <AccountLockedScreen user={user} disabled accountType={accountAccess.accountType} onLogout={async () => { await signOut(auth); }} />;
  if (user && !demo && accountGate.expiryMs > 0 && accountGate.expiryMs <= accountClock) return <AccountLockedScreen user={user} disabled={false} accountType={accountAccess.accountType} onLogout={async () => { await signOut(auth); }} />;

  if (user && !demo && accountAccess.accountType === "school" && accountAccess.pendingApproval) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-8 text-center shadow-xl"><RefreshCcw className="mx-auto text-sky-600" size={42}/><h1 className="mt-5 text-2xl font-black">Menunggu persetujuan sekolah</h1><p className="mt-3 text-sm leading-6 text-slate-500">Pendaftaran guru sudah diterima. Kepala Sekolah/TU perlu mengaktifkan akun dan menetapkan kelas sebelum Anda dapat masuk ke menu guru.</p><button onClick={() => void signOut(auth)} className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-xs font-black text-white">Keluar</button></section></main>;

  if (user && !demo && accountAccess.accountType === "school" && (!accountAccess.schoolRole || !accountAccess.schoolId)) return <><SchoolOnboarding user={user} schoolName={accountProfile.schoolName} initialLevel={accountProfile.schoolLevel} onLogout={async()=>{await signOut(auth)}} setToast={setToast}/><ToastMessage toast={toast}/></>;
  if (user && !demo && accountAccess.accountType === "school" && accountAccess.schoolRole && accountAccess.schoolId) return <><SchoolWorkspace user={user} access={accountAccess} initialName={accountProfile.name} onLogout={async()=>{await signOut(auth)}} setToast={setToast} QuizComponent={ExamsViewWithManual}/><ToastMessage toast={toast}/></>;

  return <><DashboardShell user={user} demo={demo} view={view} onView={setView} onLogout={async () => { if (user) await signOut(auth); setDemo(false); }} students={students} setStudents={setStudents} setToast={setToast} activeSession={activeSession} setActiveSession={setActiveSession} /><ToastMessage toast={toast} /></>;
}

function SuperAdminDenied({ onLogout }: { onLogout: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-600"><LockKeyhole size={30}/></div><h1 className="mt-5 text-2xl font-black">Akses ditolak</h1><p className="mt-2 text-sm leading-6 text-slate-500">Akun ini bukan superadmin SMART-ATT. Keluar lalu masuk menggunakan email superadmin yang terdaftar.</p><button onClick={onLogout} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white"><LogOut size={17}/>Keluar dari akun</button></section></main>;
}

function SuperAdmin({ onLogout }: { onLogout: () => void }) {
  const [tokenDuration, setTokenDuration] = useState("14 hari");
  const [generatedToken, setGeneratedToken] = useState("");
  const accounts = [
    { name: "Tomi Guru", email: "tolimur@gmail.com", school: "SMP Harapan Bangsa", status: "Aktif", remaining: "23 hari" },
    { name: "Siti Rahma", email: "siti@smknusantara.sch.id", school: "SMK Nusantara", status: "Trial", remaining: "9 hari" },
    { name: "Arif Nugroho", email: "arif@smpmerdeka.sch.id", school: "SMP Merdeka", status: "Berakhir", remaining: "0 hari" },
  ];
  function generateToken() {
    const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    setGeneratedToken(`SATT-${random}`);
  }
  return <main className="min-h-screen bg-[#f4f7f9]">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5"><Logo/><div className="flex items-center gap-3"><span className="rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black text-white">ADMIN UTAMA</span><button onClick={onLogout} className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><LogOut size={18}/></button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 sm:p-8"><SectionHeading eyebrow="Pusat Kendali" title="Panel superadmin" description="Kelola aktivasi, trial, dan akun sekolah SMART-ATT."/>
      <div className="grid gap-4 sm:grid-cols-3"><StatCard label="Total akun guru" value="128" note="12 pendaftar bulan ini" icon={Users} tone="bg-sky-50 text-sky-600"/><StatCard label="Akun aktif" value="104" note="81,2% dari total akun" icon={UserCheck} tone="bg-emerald-50 text-emerald-600"/><StatCard label="Trial berjalan" value="17" note="5 berakhir minggu ini" icon={Clock3} tone="bg-amber-50 text-amber-600"/></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[.65fr_1.35fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-3 text-teal-700"><KeyRound size={21}/></div><div><h3 className="font-black">Token aktivasi</h3><p className="text-xs text-slate-400">Buat token sekali pakai.</p></div></div><label className="block"><span className="mb-2 block text-xs font-extrabold">Masa aktif</span><select value={tokenDuration} onChange={(e)=>setTokenDuration(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"><option>1 hari</option><option>14 hari</option><option>1 bulan</option></select></label><button onClick={generateToken} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white"><RefreshCcw size={16}/>Buat token</button>{generatedToken&&<div className="mt-4 rounded-xl bg-slate-950 p-4 text-center"><p className="text-[10px] font-bold text-slate-400">TOKEN · {tokenDuration.toUpperCase()}</p><p className="mt-2 font-mono text-lg font-black tracking-wider text-teal-300">{generatedToken}</p></div>}</section>
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h3 className="font-black">Akun sekolah</h3><p className="mt-1 text-xs text-slate-400">Status langganan dan masa berlaku.</p></div><div className="relative hidden sm:block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15}/><input placeholder="Cari akun..." className="h-10 rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none"/></div></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Guru</th><th className="px-4 py-3">Sekolah</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sisa aktif</th><th className="px-5 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{accounts.map((account)=><tr key={account.email}><td className="px-5 py-4"><p className="text-sm font-extrabold">{account.name}</p><p className="text-[10px] text-slate-400">{account.email}</p></td><td className="px-4 py-4 text-xs font-bold text-slate-600">{account.school}</td><td className="px-4 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${account.status==='Aktif'?'bg-emerald-50 text-emerald-700':account.status==='Trial'?'bg-amber-50 text-amber-700':'bg-rose-50 text-rose-700'}`}>{account.status}</span></td><td className="px-4 py-4 text-xs font-bold">{account.remaining}</td><td className="px-5 py-4 text-right"><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section></div>
    </div>
  </main>;
}

type HelpGuide = {
  id: string;
  title: string;
  summary: string;
  menu: string;
  keywords: string[];
  icon: typeof HelpCircle;
  steps: string[];
  tips?: string[];
  nav?: NavKey;
};

const HELP_GUIDES: HelpGuide[] = [
  { id: "mulai", title: "Mulai menggunakan SMART-ATT", summary: "Urutan paling aman untuk menyiapkan aplikasi sebelum dipakai di kelas.", menu: "Mulai cepat", keywords: ["mulai", "setup", "panduan", "pertama"], icon: HelpCircle, steps: ["Masuk menggunakan email dan password guru. Jika belum memiliki akun, pilih Daftar dan lengkapi profil sekolah.", "Buka Data Akademik untuk mengisi nama sekolah, tahun ajaran, semester, daftar kelas, jam masuk, dan KKM.", "Buka Data Siswa untuk menambahkan siswa manual atau mengimpor CSV.", "Periksa profil guru dan pastikan nomor WhatsApp sekolah sudah benar.", "Siapkan sesi pada Mata Pelajaran, lalu gunakan Scan Absensi saat kelas dimulai."], tips: ["Gunakan tombol bantuan ini kapan saja. Panduan dapat dicari dengan kata seperti ‘UAS’, ‘NIS’, ‘CSV’, atau ‘QR’." ] },
  { id: "dashboard", title: "Memahami Ringkasan Dashboard", summary: "Membaca kondisi kelas dan menemukan pintasan kerja dari halaman Ringkasan.", menu: "Ringkasan", keywords: ["dashboard", "ringkasan", "beranda", "statistik", "pintasan"], icon: LayoutDashboard, nav: "dashboard", steps: ["Buka Ringkasan dari sidebar atau tombol Beranda di HP.", "Pilih kelas dan periode jika tersedia agar angka yang ditampilkan sesuai konteks.", "Baca kartu statistik untuk melihat jumlah siswa, kehadiran, tugas, dan aktivitas terbaru.", "Gunakan pintasan pada kartu untuk langsung membuka Data Siswa, Scan Absensi, Rekap Absensi, atau Rekap Nilai.", "Jika data baru saja disimpan tetapi belum tampak, tunggu indikator sinkronisasi selesai lalu muat ulang halaman."], tips: ["Dashboard adalah ringkasan; perubahan data tetap dilakukan di menu modul masing-masing."] },
  { id: "navigasi", title: "Cara berpindah menu", summary: "Membuka menu lain tanpa kehilangan data yang sudah tersimpan.", menu: "Navigasi", keywords: ["pindah", "menu", "sidebar", "mobile", "navigasi"], icon: Menu, steps: ["Di laptop/desktop, gunakan menu di sidebar kiri: Ringkasan, Data Siswa, Scan Absensi, dan menu lainnya.", "Di HP, tekan ikon menu ☰ di kiri atas untuk membuka sidebar. Pilih menu, lalu sidebar akan tertutup otomatis.", "Empat shortcut di bagian bawah HP adalah Beranda, Siswa, Scan, dan Tabungan.", "Jika ingin kembali ke modul sebelumnya, buka bantuan ini lagi atau gunakan menu sidebar. Data yang sudah disimpan di Firestore tetap tersedia setelah berpindah menu."], tips: ["Perpindahan menu hanya mengubah tampilan; proses kamera akan dihentikan ketika Anda meninggalkan Scan Absensi."] },
  { id: "siswa-tambah", title: "Menambahkan data siswa", summary: "Cara mengisi siswa satu per satu, termasuk NIS, kelas, wali, dan foto.", menu: "Data Siswa", keywords: ["siswa", "tambah", "nis", "nisn", "foto", "wali", "edit", "hapus"], icon: UserPlus, nav: "students", steps: ["Buka menu Data Siswa, lalu tekan Tambah Siswa.", "Isi NIS, NISN, nama lengkap, dan pilih kelas. NIS, NISN, dan nama wajib diisi.", "Isi nama wali dan nomor WhatsApp jika sudah tersedia agar dapat digunakan untuk konfirmasi absensi.", "Pilih foto siswa. Atur crop dan rasio foto, lalu tekan Gunakan hasil crop.", "Tekan Simpan Siswa. Data siswa dan foto akan disimpan ke akun guru yang sedang login.", "Untuk memperbaiki data, pilih siswa lalu tekan Edit, ubah field yang diperlukan, dan simpan kembali.", "Untuk menghapus siswa, gunakan Hapus pada baris siswa dan konfirmasi setelah memastikan siswa yang dipilih benar."], tips: ["Pastikan NIS dan NISN tidak sama dengan siswa lain. Foto sebaiknya jelas, tegak, dan berformat JPG/PNG/WebP.", "Hapus hanya data yang memang tidak diperlukan karena riwayat absensi dan nilai dapat ikut tidak tampil pada daftar aktif."] },
  { id: "siswa-csv", title: "Import siswa dari CSV", summary: "Memasukkan banyak siswa sekaligus dari Excel/CSV.", menu: "Data Siswa", keywords: ["import", "csv", "excel", "bulk", "banyak siswa", "nis"], icon: Upload, nav: "students", steps: ["Buka Data Siswa dan pilih Import CSV.", "Siapkan file dengan header wajib: NIS, NISN, dan Nama Siswa. Header Kelas, Wali, Nomor WhatsApp, dan Nomor Absen bersifat tambahan.", "Pilih file CSV. Sistem mendeteksi pemisah koma, titik koma, atau tab.", "Periksa jumlah siswa yang terbaca dan jumlah baris yang dilewati. Baris tanpa NIS/NISN/nama atau duplikat akan dilewati.", "Pilih proses simpan/import, lalu tunggu notifikasi selesai sebelum berpindah menu."], tips: ["Simpan file sebagai UTF-8 CSV. Jangan memakai NIS atau NISN yang sama untuk dua siswa."] },
  { id: "siswa-kartu", title: "Membuat dan mencetak kartu siswa", summary: "Membuat Student ID berisi logo, foto, identitas, dan QR absensi.", menu: "Data Siswa", keywords: ["kartu", "student id", "cetak", "print", "pdf", "barcode", "qr"], icon: Printer, nav: "students", steps: ["Pada Data Siswa, pilih siswa lalu buka Print Preview Student ID. Untuk banyak siswa, gunakan cetak batch.", "Pilih Card with Student Photo atau Card without Student Photo.", "Pilih Single Card atau layout A4 8/10 kartu. Layout 10 kartu menggunakan orientasi portrait agar kartu tidak terpotong.", "Periksa preview: foto berada di kiri, identitas di tengah, dan QR berada di kolom kanan.", "Tekan Print Kartu atau Print Semua Kartu. Pada dialog printer gunakan ukuran asli/100%, kertas A4, margin tidak ada, dan aktifkan Background graphics agar desain ikut tercetak."], tips: ["QR harus tetap utuh dan tidak tertutup tulisan. Potong mengikuti tepi kartu yang siku."] },
  { id: "siswa-wali", title: "Membuat link data wali", summary: "Mengumpulkan nama wali dan nomor WhatsApp tanpa mengetik satu per satu.", menu: "Data Siswa", keywords: ["wali", "orang tua", "guardian", "link", "whatsapp"], icon: Link2, nav: "students", steps: ["Buka Data Siswa lalu pilih Pendataan Wali Murid.", "Pilih kelas yang ingin dikirimi link, lalu tekan Buat link kelas.", "Salin atau bagikan link tersebut kepada wali melalui WhatsApp.", "Wali memasukkan NIS, memeriksa nama siswa, lalu mengisi nama wali dan nomor WhatsApp.", "Saat guru membuka aplikasi, respons pending akan disinkronkan ke data siswa dan statusnya berubah menjadi diterapkan."], tips: ["Link wali bersifat untuk kelas yang dipilih. Jangan membagikannya di tempat publik jika daftar siswa tidak seharusnya diketahui umum."] },
  { id: "siswa-pindah", title: "Memindahkan siswa antar kelas/guru", summary: "Alur transfer siswa lama ke kelas atau akun guru tujuan menggunakan QR kartu siswa.", menu: "Data Siswa", keywords: ["pindah siswa", "transfer", "siswa lama", "kelas baru", "guru baru"], icon: ArrowRightLeft, nav: "students", steps: ["Pada akun guru tujuan, buka Data Siswa lalu pilih Pindai siswa lama.", "Minta kartu siswa yang sudah memiliki QR, lalu arahkan kamera ke QR tersebut.", "Periksa identitas siswa yang terbaca dan pilih kelas tujuan.", "Kirim permintaan transfer. Sistem membuat permintaan pending ke akun guru asal.", "Guru asal membuka notifikasi/permintaan transfer dan menyetujui permintaan tersebut.", "Setelah disetujui, data siswa beserta foto dan identitasnya tersedia pada kelas tujuan. Periksa kembali sebelum siswa mengikuti absensi."], tips: ["Jangan membuat siswa baru dengan NIS yang sama sebelum permintaan transfer selesai karena dapat menimbulkan duplikasi.", "Pastikan guru asal dan guru tujuan menggunakan akun sekolah yang benar saat menyetujui transfer."] },
  { id: "scan", title: "Cara scan QR dan mencatat kehadiran", summary: "Menyiapkan sesi, memindai kartu, memeriksa identitas, lalu menyimpan hadir/terlambat.", menu: "Scan Absensi", keywords: ["scan", "qr", "absen", "hadir", "terlambat", "kamera", "nis"], icon: ScanLine, nav: "scan", steps: ["Buka Scan Absensi, pilih tanggal, jam mulai scan, dan kelas.", "Tekan Siapkan Absensi. Izinkan akses kamera ketika browser meminta izin.", "Arahkan kamera ke QR pada kartu siswa. Jika kamera tidak tersedia, masukkan NIS secara manual.", "Periksa modal hasil scan: nama, NIS, kelas asal, foto, dan status yang akan dicatat.", "Tekan OK untuk menyimpan. Siswa dalam kelas akan masuk ke sesi attendanceSessions akun guru; siswa lintas kelas dicatat sebagai absensi lintas kelas.", "Scan berikutnya dapat dilakukan setelah modal tertutup. Siswa yang sudah tercatat tidak disimpan dua kali."], tips: ["Jika foto tidak muncul, pastikan foto siswa sudah tersimpan di Data Siswa. Jika kamera gagal, gunakan input NIS manual.", "Scan setelah sesi ditutup tetap dapat dilakukan dan akan ditandai terlambat."] },
  { id: "rekap-absen", title: "Membaca rekap absensi", summary: "Melihat hadir, terlambat, sakit, izin, alpha, dan mengirim konfirmasi wali.", menu: "Rekap Absensi", keywords: ["rekap", "absensi", "hadir", "sakit", "izin", "alpha", "bulanan", "semester"], icon: BarChart3, nav: "attendance", steps: ["Buka Rekap Absensi dan pilih kelas/periode yang ingin dilihat.", "Gunakan pencarian nama atau NIS untuk menemukan siswa tertentu.", "Baca kartu ringkasan untuk jumlah Hadir, Terlambat, Sakit, Izin, dan Belum Absen/Alpha.", "Pada daftar siswa yang belum hadir, tekan Kirim konfirmasi WA jika nomor wali tersedia.", "Wali memilih Sakit atau Izin dan mengisi alasan. Respons akan masuk ke rekap setelah guru membuka aplikasi dan sinkronisasi selesai.", "Gunakan tombol ekspor atau cetak jika ingin membagikan laporan."], tips: ["Alpha berarti belum memiliki status. Setelah wali mengirim alasan, periksa kembali rekap agar status berubah."] },
  { id: "tabungan", title: "Mencatat Tabungan Siswa", summary: "Menyimpan setoran, penarikan, saldo, dan pembatalan transaksi.", menu: "Tabungan Siswa", keywords: ["tabungan", "setoran", "penarikan", "saldo", "transaksi"], icon: Wallet, nav: "savings", steps: ["Buka Tabungan Siswa dan pilih Setoran atau Penarikan.", "Pilih siswa, masukkan nominal, tanggal, petugas, dan keterangan.", "Untuk penarikan, sistem memeriksa agar nominal tidak melebihi saldo aktif.", "Tekan Simpan transaksi. Data tersimpan sebagai ledger dan saldo dihitung dari transaksi aktif.", "Jika salah, gunakan Batalkan dan isi alasan. Transaksi tidak dihapus permanen; statusnya menjadi void.", "Gunakan Export Excel atau Export PDF untuk laporan."], tips: ["Periksa nama siswa dan nominal sebelum menyimpan. Pembatalan memerlukan alasan minimal tiga karakter."] },
  { id: "mapel", title: "Mengatur Mata Pelajaran dan sesi", summary: "Menentukan mapel, kelas, dan jam yang sedang diajar.", menu: "Mata Pelajaran", keywords: ["mapel", "mata pelajaran", "kelas", "sesi", "jam"], icon: BookOpen, nav: "subjects", steps: ["Buka Mata Pelajaran.", "Pilih mata pelajaran dan kelas yang sedang diajar.", "Atur jam mulai dan jam selesai sesi.", "Simpan sesi aktif. Sesi ini dipakai sebagai konteks saat membuat tugas dan soal AI.", "Jika pindah mengajar ke kelas/mapel lain, ubah sesi sebelum membuat tugas atau soal baru."], tips: ["Sesi aktif bukan jadwal permanen; ini konteks kerja saat ini. Pengaturan sekolah dan kelas permanen ada di Data Akademik."] },
  { id: "jadwal-pelajaran", title: "Mengatur Jadwal Pelajaran", summary: "Membuat jadwal mengajar mingguan dan menjadikannya acuan modul pembelajaran.", menu: "Jadwal Pelajaran", keywords: ["jadwal", "hari", "jam mengajar", "mingguan", "kelas", "mapel"], icon: AlarmClock, nav: "schedule", steps: ["Buka Jadwal Pelajaran.", "Pilih hari, jam mulai, jam selesai, mata pelajaran, dan kelas.", "Tekan Simpan. Jadwal akan berulang setiap minggu.", "Klik kartu jadwal untuk menjadikannya Sesi Pembelajaran Aktif.", "Saat jadwal sedang berlangsung, gunakan tombol Buka Absensi atau Catatan Pembelajaran."], tips: ["Sistem menolak jadwal yang waktunya bertabrakan pada hari yang sama."] },
  { id: "kalender-guru", title: "Menggunakan Kalender Guru", summary: "Melihat tanggal merah, mencatat agenda sekolah, dan menyimpan catatan pribadi per tanggal.", menu: "Kalender Guru", keywords: ["kalender", "agenda", "rapat", "workshop", "libur", "tanggal merah", "catatan guru"], icon: CalendarDays, nav: "calendar", steps: ["Buka Kalender Guru dan pilih tanggal.", "Tanggal merah nasional ditandai merah dan cuti bersama ditandai kuning.", "Isi nama, jenis, waktu, lokasi, dan keterangan agenda lalu simpan.", "Agenda pada tanggal terpilih tampil di samping kalender dan dapat diedit atau dihapus.", "Gunakan Catatan Guru di bagian bawah untuk pengingat pribadi pada tanggal tersebut."], tips: ["Catatan Guru tersimpan di akun Anda dan tidak dapat dibaca guru lain."] },
  { id: "catatan-pembelajaran", title: "Membuat Catatan Pembelajaran", summary: "Menyimpan catatan setiap selesai satu sesi mata pelajaran tanpa menimpa pertemuan sebelumnya.", menu: "Mata Pelajaran", keywords: ["catatan", "catatan pembelajaran", "ringkasan materi", "jam mengajar", "tindak lanjut", "histori"], icon: FileText, nav: "subjects", steps: ["Buka Mata Pelajaran dan pilih mata pelajaran serta kelas pada Sesi Pembelajaran Aktif.", "Atur jam mulai dan selesai sesuai sesi mengajar, lalu simpan sesi aktif.", "Setelah jam mengajar selesai, tekan Isi catatan sekarang atau Catatan Pembelajaran pada kartu mata pelajaran.", "Isi judul atau materi, catatan pembelajaran, serta tindak lanjut jika diperlukan.", "Tekan Simpan catatan sesi. Catatan disimpan berdasarkan tanggal, mapel, kelas, dan jam mengajar.", "Buka Catatan Pembelajaran kembali untuk melihat histori; pilih salah satu catatan jika perlu memperbaruinya."], tips: ["Setiap tanggal dan jam mengajar mempunyai catatan sendiri, jadi catatan lama tidak tertimpa.", "Periksa mapel, kelas, dan jam aktif sebelum menyimpan."] },
  { id: "akademik", title: "Mengatur data akademik", summary: "Mengisi sekolah, tahun ajaran, semester, kelas, jam masuk, dan KKM.", menu: "Data Akademik", keywords: ["akademik", "sekolah", "tahun ajaran", "semester", "kkm", "jam masuk"], icon: School, nav: "academic", steps: ["Buka Data Akademik.", "Isi nama sekolah dan tahun ajaran, misalnya 2026/2027.", "Pilih semester Ganjil atau Genap.", "Masukkan daftar kelas dipisahkan koma, misalnya VII A, VII B.", "Atur jam masuk untuk menentukan batas hadir dan terlambat.", "Atur KKM untuk digunakan pada rekap nilai.", "Tekan Simpan data akademik dan tunggu notifikasi berhasil."], tips: ["Kelas di sini menjadi pilihan pada Data Siswa dan Scan Absensi. Gunakan penulisan kelas yang konsisten."] },
  { id: "tugas", title: "Membuat dan membagikan tugas", summary: "Membuat PR, menyimpan draft, menerbitkan link, dan menonaktifkannya.", menu: "Tugas & PR", keywords: ["tugas", "pr", "deadline", "publish", "link"], icon: FileText, nav: "tasks", steps: ["Pastikan sesi mapel/kelas aktif pada Mata Pelajaran.", "Buka Tugas & PR lalu tekan Tugas Baru.", "Isi mata pelajaran, judul, instruksi/deskripsi, dan deadline.", "Simpan sebagai draft jika belum siap dibagikan.", "Aktifkan Publish untuk membuat public link. Salin link dan kirim kepada siswa.", "Gunakan Unpublish jika link tidak boleh diakses lagi. Perubahan tugas akan memperbarui snapshot publik."], tips: ["Tulis deadline dengan tanggal dan jam yang jelas. Link publik hanya menampilkan instruksi tugas, bukan data privat guru."] },
  { id: "ujian-manual", title: "Membuat soal dan ulangan manual", summary: "Membuat bank soal, mengatur jadwal, durasi, dan menerbitkan ujian.", menu: "Soal & Ulangan", keywords: ["ujian", "ulangan", "soal", "pilihan ganda", "durasi", "jadwal", "uas"], icon: ClipboardCheck, nav: "exams", steps: ["Buka Soal & Ulangan lalu pilih membuat ulangan/soal manual.", "Isi judul, mata pelajaran, bab, kelas, dan durasi.", "Tambahkan pertanyaan, minimal dua pilihan jawaban, pilih kunci jawaban, dan isi pembahasan jika diperlukan.", "Simpan sebagai draft dan periksa kembali setiap kunci jawaban.", "Atur tanggal/jam mulai dan selesai, lalu Publish.", "Bagikan link ujian. Siswa membuka link, memasukkan NIS, dan mengikuti ujian fullscreen.", "Setelah selesai, buka monitoring untuk melihat attempt, skor, aktivitas, dan reset device lock bila diperlukan."], tips: ["Untuk UAS, gunakan judul yang jelas, atur jadwal yang benar, dan lakukan satu kali uji coba melalui link publik sebelum dibagikan."] },
  { id: "ujian-ai", title: "Membuat soal dengan bantuan AI", summary: "Membuat prompt, menempel hasil AI, memeriksa kunci, dan menyimpan draft.", menu: "Generator AI", keywords: ["ai", "chatgpt", "gemini", "prompt", "soal", "json", "uas"], icon: Sparkles, nav: "ai", steps: ["Buka Generator AI.", "Pilih mata pelajaran, kelas, bab, jumlah soal, dan jumlah pilihan.", "Tekan Salin prompt, lalu tempel prompt ke ChatGPT, Gemini, atau AI lain.", "Minta output dalam JSON atau format bernomor dengan pilihan A/B/C/D dan Kunci.", "Tempel hasil AI atau pilih file JSON/TXT. Sistem mendukung JSON, blok Markdown, dan teks soal biasa.", "Tekan Baca hasil & simpan. Periksa kunci jawaban dan pembahasan sebelum memakai soal.", "Soal tersimpan sebagai draft di Soal & Ulangan untuk dijadwalkan kemudian."], tips: ["AI dapat keliru. Guru tetap wajib memeriksa fakta, tingkat kesulitan, pilihan jawaban, dan kunci sebelum Publish."] },
  { id: "nilai", title: "Memasukkan nilai UAS dan nilai manual", summary: "Panduan lengkap untuk nilai UAS/ulangan, tugas, praktik, dan rata-rata.", menu: "Rekap Nilai", keywords: ["nilai", "uas", "uts", "ulangan", "manual", "input", "rata-rata", "kkm"], icon: GraduationCap, nav: "scores", steps: ["Buka Rekap Nilai. Pastikan siswa dan kelas sudah tersedia di Data Siswa.", "Untuk nilai UAS/ulangan, selesaikan dan sinkronkan ujian dari menu Soal & Ulangan. Attempt yang selesai akan masuk otomatis ke rekap.", "Untuk nilai manual seperti tugas, praktik, proyek, sikap, atau UAS yang dikerjakan di luar aplikasi, buka tab Input Nilai.", "Pilih kelas, mata pelajaran, jenis nilai, nama penilaian, siswa, nilai 0–100, dan keterangan opsional.", "Tekan Simpan nilai manual. Nilai akan tampil pada daftar nilai dan perhitungan rata-rata.", "Buka tab Bobot untuk mengaktifkan kategori dan mengatur total bobot tepat 100%.", "Gunakan tab Per Siswa atau Per Mata Pelajaran untuk memeriksa hasil. Gunakan Ekspor Excel atau Cetak PDF bila diperlukan."], tips: ["Jika nilai UAS tidak muncul, pastikan attempt berstatus selesai dan kelas/mata pelajarannya sama dengan filter rekap.", "KKM diambil dari Data Akademik dan menentukan label tuntas/remedial."] },
  { id: "profil", title: "Mengatur profil dan masa aktif akun", summary: "Memperbarui nama guru, sekolah, WhatsApp, dan mengaktifkan token.", menu: "Profil Guru", keywords: ["profil", "akun", "token", "trial", "masa aktif", "password"], icon: Users, nav: "profile", steps: ["Buka Profil Guru untuk melihat email login dan status paket.", "Perbarui nama guru, nomor WhatsApp, dan sekolah, lalu tekan Simpan profil.", "Jika trial/token habis, masukkan token aktivasi pada area masa aktif akun.", "Token dibuat superadmin dan hanya dapat digunakan sekali sesuai masa berlakunya.", "Untuk lupa password, keluar ke halaman login dan gunakan Lupa password."], tips: ["Jangan membagikan token aktivasi kepada akun lain. Jika status akun belum terbaca, periksa koneksi lalu muat ulang."] },
];

function HelpCenter({ currentView, onView, onClose }: { currentView: NavKey; onView: (view: NavKey) => void; onClose: () => void }) {
  const initial = HELP_GUIDES.find((guide) => guide.nav === currentView) ?? HELP_GUIDES[0];
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initial.id);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return HELP_GUIDES;
    return HELP_GUIDES.filter((guide) => [guide.title, guide.summary, guide.menu, ...guide.keywords, ...guide.steps].join(" ").toLowerCase().includes(needle));
  }, [search]);
  const selected = filtered.find((guide) => guide.id === selectedId) ?? filtered[0] ?? null;
  const selectedIndex = selected ? filtered.findIndex((guide) => guide.id === selected.id) : -1;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  function selectGuide(guide: HelpGuide) { setSelectedId(guide.id); }
  function move(delta: number) { const next = filtered[selectedIndex + delta]; if (next) setSelectedId(next.id); }
  return <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Pusat bantuan SMART-ATT">
    <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[88vh] sm:rounded-3xl">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-4 text-white sm:px-6"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-400/15 text-teal-300"><HelpCircle size={21}/></div><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-teal-300">Pusat Bantuan</p><h2 className="mt-0.5 text-lg font-black">Cara menggunakan SMART-ATT</h2></div><button onClick={onClose} aria-label="Tutup bantuan" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20"><X size={19}/></button><label className="order-5 flex h-11 w-full items-center gap-2 rounded-xl bg-white px-3 text-slate-500 sm:order-none sm:w-72"><Search size={17}/><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari: UAS, CSV, scan..." className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"/></label></header>
      <div className="grid min-h-0 flex-1 md:grid-cols-[270px_1fr]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 md:block">{filtered.map((guide) => { const Icon = guide.icon; return <button key={guide.id} onClick={() => selectGuide(guide)} className={`mb-1 flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left ${selected?.id === guide.id ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-white"}`}><Icon size={16} className="mt-0.5 shrink-0"/><span className="min-w-0"><span className="block text-xs font-black">{guide.title}</span><span className={`mt-0.5 block text-[10px] leading-4 ${selected?.id === guide.id ? "text-teal-100" : "text-slate-400"}`}>{guide.menu}</span></span></button>; })}{!filtered.length&&<p className="p-4 text-center text-xs font-bold text-slate-400">Panduan tidak ditemukan.</p>}</aside>
        <main className="min-h-0 overflow-y-auto p-4 sm:p-7">{selected ? <><div className="mb-5 md:hidden"><label className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-400">Pilih panduan</label><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">{filtered.map((guide) => <option key={guide.id} value={guide.id}>{guide.menu} · {guide.title}</option>)}</select></div><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded-full bg-teal-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-teal-700">{selected.menu}</span><h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{selected.title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{selected.summary}</p></div>{selected.nav&&<button onClick={() => { if (selected.nav) onView(selected.nav); }} className="flex items-center gap-2 rounded-xl bg-teal-600 px-3.5 py-2.5 text-xs font-black text-white"><selected.icon size={15}/>Buka menu ini</button>}</div><ol className="mt-6 space-y-3">{selected.steps.map((step, index) => <li key={`${selected.id}-${index}`} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{index + 1}</span><p className="text-sm leading-6 text-slate-600">{step}</p></li>)}</ol>{selected.tips?.length&&<section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Catatan penting</p><ul className="mt-2 space-y-2">{selected.tips.map((tip) => <li key={tip} className="text-xs leading-5 text-amber-900">• {tip}</li>)}</ul></section>}{filtered.length>1&&<footer className="mt-7 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><button disabled={selectedIndex<=0} onClick={() => move(-1)} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600 disabled:opacity-30"><ArrowLeft size={15}/>Kembali</button><span className="text-[10px] font-black text-slate-400">{selectedIndex + 1} / {filtered.length}</span><button disabled={selectedIndex<0||selectedIndex>=filtered.length-1} onClick={() => move(1)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-30">Berikutnya<ChevronRight size={15}/></button></footer>}</> : <div className="grid min-h-64 place-items-center text-center"><Search className="text-slate-300" size={36}/><p className="mt-3 text-sm font-black text-slate-500">Panduan tidak ditemukan</p><button onClick={() => setSearch("")} className="mt-3 text-xs font-black text-teal-700">Hapus pencarian</button></div>}</main>
      </div>
    </div>
  </div>;
}

function DashboardShell({ user, demo, view, onView, onLogout, students, setStudents, setToast, activeSession, setActiveSession }: { user: User | null; demo: boolean; view: NavKey; onView: (v: NavKey) => void; onLogout: () => void; students: Student[]; setStudents: React.Dispatch<React.SetStateAction<Student[]>>; setToast: (t: Toast) => void; activeSession: ActiveTeachingSession; setActiveSession: React.Dispatch<React.SetStateAction<ActiveTeachingSession>> }) {
  const [mobileNav, setMobileNav] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileHeader, setProfileHeader] = useState({ name: demo ? "Tomi Guru" : "Guru", teacherRole: demo ? "Guru Kelas V-A" : "Guru Kelas", profilePhotoKey: "" });
  const [systemNotifications, setSystemNotifications] = useState<Array<{ id: string; source: "task" | "exam" | "agenda"; title: string; detail: string; view: NavKey; tone: string }>>([]);
  const [academicHeader, setAcademicHeader] = useState(DEFAULT_ACADEMIC_SETTINGS);
  const title = navGroups.flatMap((group) => group.items).find((item) => item.key === view)?.label ?? "Ringkasan";
  useEffect(() => {
    if (demo) { setAcademicHeader(DEFAULT_ACADEMIC_SETTINGS); return; }
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid, "settings", "academic"), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as Partial<AcademicSettings>;
      setAcademicHeader({
        schoolName: typeof data.schoolName === "string" ? data.schoolName : DEFAULT_ACADEMIC_SETTINGS.schoolName,
        academicYear: typeof data.academicYear === "string" ? data.academicYear : DEFAULT_ACADEMIC_SETTINGS.academicYear,
        semester: data.semester === "Genap" ? "Genap" : "Ganjil",
        classNames: Array.isArray(data.classNames) ? data.classNames.filter((item): item is string => typeof item === "string") : DEFAULT_ACADEMIC_SETTINGS.classNames,
        entryTime: typeof data.entryTime === "string" ? data.entryTime : DEFAULT_ACADEMIC_SETTINGS.entryTime,
        kkm: typeof data.kkm === "number" ? data.kkm : DEFAULT_ACADEMIC_SETTINGS.kkm,
      });
    });
  }, [user, demo]);
  useEffect(() => {
    if (demo || !user) return;
    return onSnapshot(doc(db, "users", user.uid), (snapshot) => { const data = snapshot.data(); setProfileHeader({ name: typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Guru", teacherRole: typeof data?.teacherRole === "string" && data.teacherRole.trim() ? data.teacherRole.trim() : "Guru Kelas", profilePhotoKey: typeof data?.profilePhotoKey === "string" ? data.profilePhotoKey : "" }); });
  }, [demo, user]);
  useEffect(() => {
    if (demo || !user) return;
    const replaceSource = (source: "task" | "exam" | "agenda", next: Array<{ id: string; source: "task" | "exam" | "agenda"; title: string; detail: string; view: NavKey; tone: string }>) => setSystemNotifications((current) => [...current.filter((item) => item.source !== source), ...next]);
    const now = Date.now(); const today = learningDateKey(now); const tomorrow = learningDateKey(now + 86400000);
    const stops = [
      onSnapshot(collection(db, "users", user.uid, "tasks"), (snapshot) => { const next = snapshot.docs.flatMap((item) => { const data = item.data() as Partial<TaskRecord>; const deadline = new Date(String(data.deadline || "")).getTime(); if (!data.published || !Number.isFinite(deadline) || deadline < now || deadline > now + 48 * 3600000) return []; return [{ id: `task-${item.id}`, source: "task" as const, title: `Tenggat tugas: ${data.title || "Tugas"}`, detail: `${data.className || "Kelas"} · ${new Date(deadline).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`, view: "tasks" as NavKey, tone: "bg-amber-50 text-amber-700" }]; }); replaceSource("task", next); }),
      onSnapshot(query(collection(db, "publicQuizAttempts"), where("ownerUid", "==", user.uid)), (snapshot) => { const violations = snapshot.docs.filter((item) => Array.isArray(item.data().violations) && item.data().violations.length > 0).slice(0, 8).map((item) => ({ id: `exam-${item.id}`, source: "exam" as const, title: `Pelanggaran ujian: ${String(item.data().studentName || "Siswa")}`, detail: `${item.data().violations.length} aktivitas perlu diperiksa`, view: "exams" as NavKey, tone: "bg-rose-50 text-rose-700" })); replaceSource("exam", violations); }),
      onSnapshot(collection(db, "users", user.uid, "teacherAgendas"), (snapshot) => { const next = snapshot.docs.flatMap((item) => { const data = item.data(); if (data.date !== today && data.date !== tomorrow) return []; return [{ id: `agenda-${item.id}`, source: "agenda" as const, title: String(data.title || "Agenda guru"), detail: `${data.date === today ? "Hari ini" : "Besok"} · ${String(data.startTime || "")}`, view: "calendar" as NavKey, tone: "bg-violet-50 text-violet-700" }]; }); replaceSource("agenda", next); }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [demo, user]);
  return (
    <div className="min-h-screen bg-[#f4f7f9] text-slate-900">
      {mobileNav && <button aria-label="Tutup menu" className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(86vw,300px)] flex-col border-r border-slate-200 bg-white px-4 pb-5 pt-6 transition-transform duration-300 sm:w-[270px] lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-7 flex items-center justify-between px-2"><Logo /><button onClick={() => setMobileNav(false)} className="rounded-lg p-2 text-slate-500 lg:hidden"><X size={20} /></button></div>
        <nav className="scrollbar-none flex-1 overflow-y-auto">
          {navGroups.map((group) => <div key={group.label} className="mb-5"><p className="mb-2 px-3 text-[10px] font-black tracking-[.16em] text-slate-400">{group.label}</p>{group.items.map((item) => { const Icon = item.icon; const active = view === item.key; return <button key={item.key} onClick={() => { onView(item.key); setMobileNav(false); }} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${active ? "bg-teal-600 text-white shadow-md shadow-teal-600/15" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon size={18} strokeWidth={active ? 2.4 : 1.8} /><span className="flex-1">{item.label}</span>{active && <ChevronRight size={15} />}</button>; })}</div>)}
        </nav>
        <button onClick={() => setHelpOpen(true)} className="flex w-full items-center gap-3 rounded-xl bg-slate-950 px-3 py-2.5 text-left text-white transition hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-teal-500/20" aria-label="Buka pusat bantuan"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-400/15 text-teal-300"><HelpCircle size={18}/></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-xs font-extrabold">Butuh bantuan?</span><span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[8px] font-black text-emerald-300">AKTIF</span></span><span className="mt-0.5 block truncate text-[9px] text-slate-400">Cari panduan semua modul</span></span><ChevronRight size={15} className="shrink-0 text-teal-300"/></button>
      </aside>
      <div className="min-w-0 max-w-full overflow-x-clip lg:pl-[270px]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 sm:h-[74px] sm:px-7 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 lg:hidden"><Menu size={20} /></button><div><p className="text-[11px] font-bold text-slate-400">Tahun Ajaran {academicHeader.academicYear} · {academicHeader.semester}</p><h1 className="text-lg font-black tracking-tight sm:text-xl">{title}</h1></div></div>
          <div className="flex items-center gap-2 sm:gap-3"><div className="relative hidden sm:block"><button onClick={() => setNotificationsOpen((value) => !value)} aria-label="Notifikasi" className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600"><Bell size={18}/>{systemNotifications.length > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full border-2 border-white bg-rose-500 px-0.5 text-[7px] font-black text-white">{Math.min(9, systemNotifications.length)}</span>}</button>{notificationsOpen && <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><div className="border-b border-slate-100 p-4"><p className="text-sm font-black">Notifikasi sistem</p><p className="mt-1 text-[10px] text-slate-400">Tugas, agenda, dan pengawasan ujian</p></div><div className="max-h-96 overflow-y-auto p-2">{systemNotifications.map((item) => <button key={item.id} onClick={() => { onView(item.view); setNotificationsOpen(false); }} className="flex w-full gap-3 rounded-xl p-3 text-left hover:bg-slate-50"><span className={`mt-0.5 h-9 w-9 shrink-0 rounded-xl ${item.tone}`}/><span className="min-w-0"><span className="block text-xs font-black">{item.title}</span><span className="mt-1 block text-[10px] leading-4 text-slate-400">{item.detail}</span></span></button>)}{!systemNotifications.length && <div className="px-4 py-10 text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={28}/><p className="mt-3 text-xs font-black text-slate-600">Tidak ada notifikasi baru</p></div>}</div></div>}</div><div className="hidden h-9 w-px bg-slate-200 sm:block"/><button onClick={() => onView("profile")} className="hidden items-center gap-3 rounded-xl px-1.5 py-1 transition hover:bg-slate-50 sm:flex"><PrivateStudentPhoto user={user} photoKey={profileHeader.profilePhotoKey} alt={`Foto ${profileHeader.name}`} className="h-9 w-9 rounded-xl object-cover" fallback={<div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-100 text-sm font-black text-teal-700">{profileHeader.name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "GR"}</div>}/><div className="hidden max-w-40 text-left md:block"><p className="truncate text-xs font-extrabold">{profileHeader.name}</p><p className="truncate text-[10px] text-slate-400">{profileHeader.teacherRole}</p></div><ChevronDown className="hidden text-slate-400 md:block" size={15}/></button><button onClick={onLogout} title="Keluar" className="rounded-xl p-2.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><LogOut size={18}/></button></div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-clip p-3 pb-28 sm:p-7 lg:pb-7">
          {view === "dashboard" && <Overview user={user} demo={demo} students={students} onView={onView} setToast={setToast} />}
          {view === "students" && <StudentsView user={user} demo={demo} students={students} configuredClasses={academicHeader.classNames} setStudents={setStudents} setToast={setToast} />}
          {view === "scan" && <ScannerViewPro user={user} demo={demo} students={students} configuredClasses={academicHeader.classNames} schoolName={academicHeader.schoolName} initialClassName={activeSession.className} initialStartTime={activeSession.startTime} setToast={setToast} />}
          {view === "attendance" && <AttendanceViewPro user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "savings" && <><SavingsShareManager user={user} demo={demo} students={students} setToast={setToast} /><SavingsView user={user} demo={demo} students={students} setToast={setToast} /></>}
          {view === "schedule" && <TeachingScheduleView user={user} demo={demo} classes={academicHeader.classNames} setActiveSession={setActiveSession} setToast={setToast} onView={onView} />}
          {view === "calendar" && <TeacherCalendarView user={user} demo={demo} setToast={setToast} />}
          {view === "subjects" && <SubjectsView user={user} demo={demo} students={students} configuredClasses={academicHeader.classNames} activeSession={activeSession} setActiveSession={setActiveSession} setToast={setToast} onView={onView} />}
          {view === "tasks" && <TasksView user={user} demo={demo} students={students} activeSession={activeSession} setToast={setToast} />}
          {view === "exams" && <ExamsViewWithManual user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "ai" && <AiGeneratorConnected user={user} demo={demo} activeSession={activeSession} setToast={setToast} />}
          {view === "scores" && <ScoresView user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "academic" && <AcademicView user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "profile" && <ProfileProfessional user={user} demo={demo} students={students} setToast={setToast} />}
        </main>
      </div>
      <nav aria-label="Navigasi cepat mobile" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,.08)] backdrop-blur-xl lg:hidden">
        {[{key:"dashboard" as NavKey,label:"Beranda",icon:Home},{key:"students" as NavKey,label:"Siswa",icon:Users},{key:"scan" as NavKey,label:"Scan",icon:ScanLine},{key:"savings" as NavKey,label:"Tabungan",icon:Wallet}].map((item)=>{const Icon=item.icon;const active=view===item.key;return <button key={item.key} onClick={()=>onView(item.key)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-extrabold transition ${active?"bg-teal-50 text-teal-700":"text-slate-400"}`}><Icon size={20} strokeWidth={active?2.5:1.8}/><span>{item.label}</span></button>})}
      </nav>
      {helpOpen && <HelpCenter currentView={view} onView={onView} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0">{eyebrow && <p className="mb-1 text-[10px] font-black uppercase tracking-[.16em] text-teal-600 sm:text-[11px]">{eyebrow}</p>}<h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></div>{action&&<div className="section-action w-full sm:w-auto">{action}</div>}</div>;
}

function SubjectsView({ user, demo, students, configuredClasses, activeSession, setActiveSession, setToast, onView }: { user: User | null; demo: boolean; students: Student[]; configuredClasses: string[]; activeSession: ActiveTeachingSession; setActiveSession: React.Dispatch<React.SetStateAction<ActiveTeachingSession>>; setToast: (toast: Toast) => void; onView: (view: NavKey) => void }) {
  const [optionalSubjects, setOptionalSubjects] = useState<SubjectRecord[]>(demo ? [
    { id: "demo-robotics", name: "Robotika", category: "optional", icon: "Bot", color: "#0891b2" },
    { id: "demo-programming", name: "Pemrograman", category: "optional", icon: "Code", color: "#16a34a" },
    { id: "demo-photography", name: "Fotografi", category: "optional", icon: "Camera", color: "#db2777" },
  ] : []);
  const [draft, setDraft] = useState({ name: "", icon: "BookOpen", color: "#0f766e" });
  const [editing, setEditing] = useState<SubjectRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [learningNotes, setLearningNotes] = useState<LearningNote[]>(() => {
    if (!demo) return [];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = learningDateKey(yesterday);
    return [{ id: learningNoteSessionId(DEFAULT_ACTIVE_SESSION, date), subjectId: DEFAULT_ACTIVE_SESSION.subjectId, subjectName: DEFAULT_ACTIVE_SESSION.subjectName, className: DEFAULT_ACTIVE_SESSION.className, date, day: new Intl.DateTimeFormat("id-ID", { weekday: "long" }).format(yesterday), startTime: DEFAULT_ACTIVE_SESSION.startTime, endTime: DEFAULT_ACTIVE_SESSION.endTime, title: "Penjumlahan pecahan", content: "Sebagian besar siswa memahami materi. Beberapa siswa masih perlu latihan menyamakan penyebut.", followUp: "Latihan tambahan pada pertemuan berikutnya.", createdAtMs: yesterday.getTime(), updatedAtMs: yesterday.getTime() }];
  });
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteClock, setNoteClock] = useState(() => Date.now());
  const [noteDraft, setNoteDraft] = useState({ id: "", date: "", day: "", subjectId: "", subjectName: "", className: "", startTime: "", endTime: "", title: "", content: "", followUp: "" });
  const classOptions = useMemo(() => Array.from(new Set([...configuredClasses, ...students.map((student) => student.className)].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), [configuredClasses, students]);
  const subjects = useMemo(() => [...MANDATORY_SUBJECTS, ...optionalSubjects].sort((a, b) => a.category === b.category ? a.name.localeCompare(b.name, "id-ID") : a.category === "mandatory" ? -1 : 1), [optionalSubjects]);
  const selectedSubject = subjects.find((subject) => subject.id === activeSession.subjectId) ?? subjects[0];
  const todayNoteDate = learningDateKey(noteClock);
  const activeNoteId = learningNoteSessionId(activeSession, todayNoteDate);
  const activeNote = learningNotes.find((note) => note.id === activeNoteId);
  const noteNow = new Date(noteClock);
  const currentTime = `${String(noteNow.getHours()).padStart(2, "0")}:${String(noteNow.getMinutes()).padStart(2, "0")}`;
  const sessionHasEnded = Boolean(activeSession.endTime && currentTime >= activeSession.endTime);
  const visibleNoteHistory = learningNotes
    .filter((note) => note.subjectId === activeSession.subjectId && note.className === activeSession.className)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.updatedAtMs - a.updatedAtMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNoteClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (demo) return;
    if (!user) { setOptionalSubjects([]); return; }
    return onSnapshot(collection(db, "users", user.uid, "subjects"), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), category: "optional" } as SubjectRecord));
      next.sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
      setOptionalSubjects(next);
    }, () => setToast({ message: "Data mata pelajaran belum dapat dibaca.", tone: "error" }));
  }, [demo, user, setToast]);

  useEffect(() => {
    if (demo) return;
    if (!user) return;
    return onSnapshot(collection(db, "users", user.uid, "learningNotes"), (snapshot) => {
      setLearningNotes(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LearningNote)));
    }, () => setToast({ message: "Catatan pembelajaran belum dapat dibaca.", tone: "error" }));
  }, [demo, user, setToast]);

  useEffect(() => {
    if (!selectedSubject) return;
    setActiveSession((current) => ({ ...current, subjectId: selectedSubject.id, subjectName: selectedSubject.name, className: current.className || classOptions[0] || DEFAULT_ACTIVE_SESSION.className }));
  }, [selectedSubject?.id, selectedSubject?.name, classOptions.join("\u0001"), setActiveSession]);

  function resetDraft() { setDraft({ name: "", icon: "BookOpen", color: "#0f766e" }); setEditing(null); }

  async function saveSubject(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.name.trim().replace(/\s+/g, " ");
    if (!name) { setToast({ message: "Nama mata pelajaran wajib diisi.", tone: "error" }); return; }
    if (MANDATORY_SUBJECTS.some((subject) => subject.name.toLocaleLowerCase("id-ID") === name.toLocaleLowerCase("id-ID") && subject.id !== editing?.id) || optionalSubjects.some((subject) => subject.name.toLocaleLowerCase("id-ID") === name.toLocaleLowerCase("id-ID") && subject.id !== editing?.id)) {
      setToast({ message: `${name} sudah ada di daftar mata pelajaran.`, tone: "error" }); return;
    }
    setSaving(true);
    try {
      const payload = { name, icon: draft.icon.trim() || "BookOpen", color: draft.color || "#0f766e", category: "optional", protected: false, updatedAt: serverTimestamp() };
      if (demo || !user) {
        if (editing) setOptionalSubjects((items) => items.map((item) => item.id === editing.id ? { ...item, ...payload } as SubjectRecord : item));
        else setOptionalSubjects((items) => [{ id: crypto.randomUUID(), ...payload } as SubjectRecord, ...items]);
      } else {
        const reference = editing ? doc(db, "users", user.uid, "subjects", editing.id) : doc(collection(db, "users", user.uid, "subjects"));
        await setDoc(reference, { ...payload, ...(!editing ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
      }
      resetDraft();
      setToast({ message: editing ? "Mata pelajaran pilihan diperbarui." : "Mata pelajaran pilihan ditambahkan.", tone: "success" });
    } catch { setToast({ message: "Mata pelajaran gagal disimpan.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function removeSubject(subject: SubjectRecord) {
    if (subject.category === "mandatory" || subject.protected) { setToast({ message: "Mata pelajaran wajib tidak dapat dihapus.", tone: "error" }); return; }
    if (!window.confirm(`Hapus subject ${subject.name}?`)) return;
    try {
      if (demo || !user) setOptionalSubjects((items) => items.filter((item) => item.id !== subject.id));
      else await deleteDoc(doc(db, "users", user.uid, "subjects", subject.id));
      setToast({ message: "Mata pelajaran pilihan dihapus.", tone: "success" });
    } catch { setToast({ message: "Mata pelajaran gagal dihapus.", tone: "error" }); }
  }

  async function saveActiveSession(next: ActiveTeachingSession) {
    setActiveSession(next);
    try {
      if (!demo && user) await setDoc(doc(db, "users", user.uid, "settings", "activeTeachingSession"), { ...next, updatedAt: serverTimestamp() }, { merge: true });
      setToast({ message: `Sesi Pembelajaran Aktif disetel ke ${next.subjectName} - ${next.className}.`, tone: "success" });
    } catch { setToast({ message: "Sesi aktif belum dapat disimpan.", tone: "error" }); }
  }

  function editSubject(subject: SubjectRecord) { if (subject.category === "mandatory") return; setEditing(subject); setDraft({ name: subject.name, icon: subject.icon, color: subject.color }); }

  function openLearningNotes(session = activeSession, selectedNote?: LearningNote) {
    const now = new Date();
    const date = selectedNote?.date || learningDateKey(now);
    const noteSession: ActiveTeachingSession = {
      subjectId: selectedNote?.subjectId || session.subjectId,
      subjectName: selectedNote?.subjectName || session.subjectName,
      className: selectedNote?.className || session.className,
      startTime: selectedNote?.startTime || session.startTime,
      endTime: selectedNote?.endTime || session.endTime,
    };
    const id = selectedNote?.date ? selectedNote.id : learningNoteSessionId(noteSession, date);
    const current = selectedNote?.date ? selectedNote : learningNotes.find((note) => note.id === id);
    setNoteDraft({
      id,
      date,
      day: current?.day || new Intl.DateTimeFormat("id-ID", { weekday: "long" }).format(new Date(`${date}T12:00:00`)),
      ...noteSession,
      title: current?.title ?? selectedNote?.title ?? "",
      content: current?.content ?? selectedNote?.content ?? "",
      followUp: current?.followUp ?? selectedNote?.followUp ?? "",
    });
    setNotesOpen(true);
  }

  async function openSubjectModule(subject: SubjectRecord, item: { label: string; view: NavKey }) {
    const nextSession = { ...activeSession, subjectId: subject.id, subjectName: subject.name };
    await saveActiveSession(nextSession);
    if (item.label === "Catatan Pembelajaran") openLearningNotes(nextSession);
    else onView(item.view);
  }

  async function saveLearningNote(event: React.FormEvent) {
    event.preventDefault();
    const title = noteDraft.title.trim();
    const content = noteDraft.content.trim();
    if (!title || !content) { setToast({ message: "Judul dan isi catatan wajib diisi.", tone: "error" }); return; }
    if (!noteDraft.subjectId || !noteDraft.className || !noteDraft.date || !noteDraft.startTime || !noteDraft.endTime) { setToast({ message: "Lengkapi mata pelajaran, kelas, dan jam sesi terlebih dahulu.", tone: "error" }); return; }
    const existing = learningNotes.find((note) => note.id === noteDraft.id);
    const now = Date.now();
    const payload: LearningNote = { id: noteDraft.id, subjectId: noteDraft.subjectId, subjectName: noteDraft.subjectName, className: noteDraft.className, date: noteDraft.date, day: noteDraft.day, startTime: noteDraft.startTime, endTime: noteDraft.endTime, title, content, followUp: noteDraft.followUp.trim(), createdAtMs: existing?.createdAtMs ?? now, updatedAtMs: now };
    try {
      if (demo || !user) setLearningNotes((items) => [payload, ...items.filter((item) => item.id !== payload.id)]);
      else await setDoc(doc(db, "users", user.uid, "learningNotes", payload.id), { ...payload, updatedAt: serverTimestamp(), ...(!existing ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
      setNotesOpen(false);
      setToast({ message: "Catatan sesi pembelajaran tersimpan.", tone: "success" });
    } catch { setToast({ message: "Catatan pembelajaran gagal disimpan.", tone: "error" }); }
  }

  const learningItems = [
    { label: "Kuis / Ujian", icon: ClipboardCheck, view: "exams" as NavKey, available: true },
    { label: "Generator Soal AI", icon: Sparkles, view: "ai" as NavKey, available: true },
    { label: "Bank Soal", icon: ListChecks, view: "exams" as NavKey, available: true },
    { label: "Catatan Pembelajaran", icon: FileText, view: "subjects" as NavKey, available: true },
    { label: "Materi Pembelajaran", icon: BookOpen, view: "subjects" as NavKey, available: false },
    { label: "Tugas", icon: PencilLine, view: "tasks" as NavKey, available: true },
    { label: "Nilai Siswa", icon: BarChart3, view: "scores" as NavKey, available: true },
  ];

  return <>
    <SectionHeading eyebrow="Kelas Digital" title="Mata Pelajaran" description="Mata pelajaran menjadi pusat kuis, generator soal AI, catatan pembelajaran, tugas, dan rekap nilai." action={<button onClick={() => void saveActiveSession({ ...activeSession, subjectId: selectedSubject?.id ?? activeSession.subjectId, subjectName: selectedSubject?.name ?? activeSession.subjectName })} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><CheckCircle2 size={16}/>Simpan Sesi Pembelajaran Aktif</button>} />
    <section className={`mb-6 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${activeNote ? "border-emerald-200 bg-emerald-50" : sessionHasEnded ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start gap-3"><div className={`rounded-xl p-2.5 ${activeNote ? "bg-emerald-100 text-emerald-700" : sessionHasEnded ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}><FileText size={18}/></div><div><p className="text-sm font-black">{activeNote ? "Catatan sesi hari ini sudah tersimpan" : sessionHasEnded ? "Jam mengajar selesai, catatan belum dibuat" : "Catatan dapat diisi setelah jam mengajar"}</p><p className="mt-1 text-xs text-slate-500">{activeSession.subjectName} · {activeSession.className} · {activeSession.startTime}–{activeSession.endTime}</p></div></div>
      <button onClick={() => openLearningNotes()} className={`h-10 shrink-0 rounded-xl px-4 text-xs font-extrabold text-white ${activeNote ? "bg-emerald-600" : sessionHasEnded ? "bg-amber-600" : "bg-slate-950"}`}>{activeNote ? "Lihat catatan" : "Isi catatan sekarang"}</button>
    </section>
    <section className="mb-6 overflow-hidden rounded-3xl bg-[#07363b] text-white shadow-xl"><div className="grid gap-5 p-5 lg:grid-cols-[1fr_.85fr] lg:p-6"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-teal-300">Sesi Pembelajaran Aktif</p><h3 className="mt-2 text-2xl font-black">{activeSession.subjectName}</h3><p className="mt-2 text-sm font-bold text-slate-200">{activeSession.className} · {activeSession.startTime} - {activeSession.endTime}</p><p className="mt-3 max-w-xl text-xs leading-5 text-slate-300">Sesi ini menjadi default saat membuat kuis, generator soal AI, catatan pembelajaran, tugas, dan rekap nilai mata pelajaran.</p></div><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-[10px] font-black uppercase text-teal-200">Mata Pelajaran</span><select value={activeSession.subjectId} onChange={(event) => { const subject = subjects.find((item) => item.id === event.target.value); if (subject) void saveActiveSession({ ...activeSession, subjectId: subject.id, subjectName: subject.name }); }} className="h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-black text-white outline-none"><option className="text-slate-950" value="">Pilih mata pelajaran</option>{subjects.map((subject) => <option className="text-slate-950" key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label><span className="mb-1.5 block text-[10px] font-black uppercase text-teal-200">Kelas</span><select value={activeSession.className} onChange={(event) => void saveActiveSession({ ...activeSession, className: event.target.value })} className="h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-black text-white outline-none">{(classOptions.length ? classOptions : [activeSession.className]).map((item) => <option className="text-slate-950" key={item}>{item}</option>)}</select></label><Field label="Mulai" type="time" value={activeSession.startTime} onChange={(value) => setActiveSession({ ...activeSession, startTime: value })}/><Field label="Selesai" type="time" value={activeSession.endTime} onChange={(value) => setActiveSession({ ...activeSession, endTime: value })}/></div></div></section>
    <div className="grid gap-6 xl:grid-cols-[1fr_.8fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-black">Daftar mata pelajaran</h3><p className="mt-1 text-xs text-slate-500">Mata pelajaran wajib dikunci; mata pelajaran pilihan dapat diatur guru.</p></div><span className="rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-700">{subjects.length} mata pelajaran</span></div><div className="grid gap-3 md:grid-cols-2">{subjects.map((subject) => <article key={subject.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ backgroundColor: subject.color }}><BookOpen size={19}/></div><div><p className="font-black">{subject.name}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{subject.category === "mandatory" ? "Mata Pelajaran Wajib" : "Mata Pelajaran Pilihan"}</p></div></div><div className="flex gap-1">{subject.category === "optional" && <><button onClick={() => editSubject(subject)} className="rounded-lg bg-sky-50 p-2 text-sky-700"><PencilLine size={14}/></button><button onClick={() => void removeSubject(subject)} className="rounded-lg bg-rose-50 p-2 text-rose-700"><Trash2 size={14}/></button></>}</div></div><div className="mt-4 grid grid-cols-2 gap-2">{learningItems.slice(0, 4).map((item) => { const Icon = item.icon; return <button key={item.label} onClick={() => void openSubjectModule(subject, item)} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-left text-[10px] font-black text-slate-600"><Icon size={14}/>{item.label}</button>; })}</div></article>)}</div></section><section className="space-y-5"><form onSubmit={saveSubject} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">{editing ? "Edit mata pelajaran pilihan" : "Mata pelajaran pilihan baru"}</h3><div className="mt-4 space-y-3"><Field label="Nama mata pelajaran" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} placeholder="Robotika, Pemrograman, Bahasa Jepang"/><div className="grid grid-cols-[1fr_88px] gap-3"><Field label="Label ikon" value={draft.icon} onChange={(value) => setDraft({ ...draft, icon: value })}/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Warna</span><input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white p-1"/></label></div><div className="flex gap-2"><button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white disabled:opacity-60">{saving ? <Loader2 className="animate-spin" size={15}/> : <Plus size={15}/>}Simpan mata pelajaran</button>{editing && <button type="button" onClick={resetDraft} className="rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-600">Batal</button>}</div></div></form><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Struktur pembelajaran</h3><div className="mt-4 grid gap-2">{learningItems.map((item) => { const Icon = item.icon; return <button key={item.label} onClick={() => item.label === "Catatan Pembelajaran" ? openLearningNotes() : item.available && onView(item.view)} disabled={!item.available} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-3 text-left text-xs font-black text-slate-700 disabled:opacity-45"><span className="flex items-center gap-2"><Icon size={15} className="text-teal-600"/>{item.label}</span><ChevronRight size={14}/></button>; })}</div></section></section></div>
    {notesOpen && <Modal title="Catatan Pembelajaran" subtitle={`${noteDraft.subjectName} · ${noteDraft.className}`} onClose={() => setNotesOpen(false)}>
      <div className="grid gap-5 lg:grid-cols-[1fr_.72fr]">
        <form onSubmit={saveLearningNote} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-teal-50 p-3 text-xs text-teal-900 sm:grid-cols-4"><div><p className="text-[9px] font-black uppercase text-teal-600">Tanggal</p><p className="mt-1 font-extrabold">{new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${noteDraft.date}T12:00:00`))}</p></div><div><p className="text-[9px] font-black uppercase text-teal-600">Hari</p><p className="mt-1 font-extrabold">{noteDraft.day}</p></div><div><p className="text-[9px] font-black uppercase text-teal-600">Mata Pelajaran</p><p className="mt-1 truncate font-extrabold">{noteDraft.subjectName}</p></div><div><p className="text-[9px] font-black uppercase text-teal-600">Jam</p><p className="mt-1 font-extrabold">{noteDraft.startTime}–{noteDraft.endTime}</p></div></div>
          <Field label="Judul / materi pembelajaran" value={noteDraft.title} onChange={(value) => setNoteDraft((current) => ({ ...current, title: value }))} placeholder="Contoh: Penjumlahan Pecahan Campuran" required/>
          <label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Catatan pembelajaran</span><textarea value={noteDraft.content} onChange={(event) => setNoteDraft((current) => ({ ...current, content: event.target.value }))} placeholder="Tuliskan jalannya pembelajaran, pemahaman siswa, kendala, atau tugas yang diberikan..." className="min-h-40 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-teal-500" required/></label>
          <label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Tindak lanjut <span className="font-medium text-slate-400">(opsional)</span></span><textarea value={noteDraft.followUp} onChange={(event) => setNoteDraft((current) => ({ ...current, followUp: event.target.value }))} placeholder="Contoh: Remedial hari Rabu atau latihan tambahan." className="min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-teal-500"/></label>
          <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Satu tanggal dan jam mengajar tersimpan sebagai satu catatan sesi.</span><button type="submit" className="shrink-0 rounded-xl bg-teal-600 px-4 py-3 text-xs font-extrabold text-white"><Check size={15} className="mr-1 inline"/>Simpan catatan sesi</button></div>
        </form>
        <aside className="min-h-0 rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-xs font-black">Histori sesi</p><p className="mt-0.5 text-[10px] text-slate-400">{activeSession.subjectName} · {activeSession.className}</p></div><span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-slate-500">{visibleNoteHistory.length}</span></div><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{visibleNoteHistory.map((note) => <button type="button" key={note.id} onClick={() => openLearningNotes(activeSession, note)} className={`w-full rounded-xl border p-3 text-left ${noteDraft.id === note.id ? "border-teal-500 bg-white shadow-sm" : "border-slate-200 bg-white/70"}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-xs font-black text-slate-800">{note.title}</p><ChevronRight size={14} className="shrink-0 text-slate-400"/></div><p className="mt-2 text-[10px] font-bold text-teal-700">{note.date ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${note.date}T12:00:00`)) : "Catatan lama"}{note.startTime ? ` · ${note.startTime}–${note.endTime}` : ""}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{note.content}</p></button>)}{!visibleNoteHistory.length && <div className="rounded-xl border border-dashed border-slate-300 px-3 py-8 text-center text-xs text-slate-400">Belum ada histori catatan untuk mapel dan kelas ini.</div>}</div></aside>
      </div>
    </Modal>}
  </>;
}

function StatCard({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Users; tone: string }) {
  return <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p></div><div className={`rounded-2xl p-3 ${tone}`}><Icon size={21} /></div></div><p className="mt-4 flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Activity size={13} className="text-emerald-500" />{note}</p></div>;
}

function Overview({user,demo,students,onView,setToast}:{user:User|null;demo:boolean;students:Student[];onView:(view:NavKey)=>void;setToast:(toast:Toast)=>void}){
  const [sessions,setSessions]=useState<AbsensiSession[]>([]);
  const [tasks,setTasks]=useState<TaskRecord[]>(demo?demoTasks:[]);
  const [exams,setExams]=useState<ExamRecord[]>([]);
  const [academic,setAcademic]=useState<AcademicSettings>(DEFAULT_ACADEMIC_SETTINGS);
  const [teacherName,setTeacherName]=useState(demo?"Tomi Guru":user?.email?.split("@")[0]??"Guru");
  const now=new Date();
  const today=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now);
  const dateKey=(value:number|Date)=>{const date=value instanceof Date?value:new Date(value);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-")};

  useEffect(()=>{
    if(demo){
      const demoRecords:Record<string,AbsensiRecord>={
        "1":{studentId:"1",status:"present",recordedAtMs:Date.now(),source:"manual"},
        "2":{studentId:"2",status:"present",recordedAtMs:Date.now(),source:"qr"},
        "3":{studentId:"3",status:"sick",recordedAtMs:Date.now(),source:"guardian",reason:"Demam"},
      };
      setSessions([{id:"demo-today",className:"V-A",schoolName:"SMP Harapan Bangsa",status:"open",startedAtMs:Date.now(),records:demoRecords}]);
      setTasks(demoTasks);setExams([]);setAcademic(DEFAULT_ACADEMIC_SETTINGS);setTeacherName("Tomi Guru");return;
    }
    if(!user)return;
    const fail=()=>setToast({message:"Sebagian data Ringkasan belum dapat disinkronkan.",tone:"error"});
    const stops=[
      onSnapshot(collection(db,"users",user.uid,"attendanceSessions"),(snapshot)=>setSessions(snapshot.docs.filter((item)=>item.data().deleted!==true).map((item)=>{const data=item.data() as Omit<AbsensiSession,"id">;return{id:item.id,...data,records:data.records??{}}}).sort((a,b)=>b.startedAtMs-a.startedAtMs)),fail),
      onSnapshot(collection(db,"users",user.uid,"tasks"),(snapshot)=>setTasks(snapshot.docs.map((item)=>({id:item.id,...item.data()} as TaskRecord))),fail),
      onSnapshot(collection(db,"users",user.uid,"exams"),(snapshot)=>setExams(snapshot.docs.map((item)=>({id:item.id,...item.data()} as ExamRecord))),fail),
      onSnapshot(doc(db,"users",user.uid,"settings","academic"),(snapshot)=>{if(snapshot.exists()){const data=snapshot.data() as Partial<AcademicSettings>;setAcademic({schoolName:typeof data.schoolName==="string"?data.schoolName:DEFAULT_ACADEMIC_SETTINGS.schoolName,academicYear:typeof data.academicYear==="string"?data.academicYear:DEFAULT_ACADEMIC_SETTINGS.academicYear,semester:data.semester==="Genap"?"Genap":"Ganjil",classNames:Array.isArray(data.classNames)?data.classNames:DEFAULT_ACADEMIC_SETTINGS.classNames,entryTime:typeof data.entryTime==="string"?data.entryTime:DEFAULT_ACADEMIC_SETTINGS.entryTime,kkm:typeof data.kkm==="number"?data.kkm:DEFAULT_ACADEMIC_SETTINGS.kkm})}},fail),
      onSnapshot(doc(db,"users",user.uid),(snapshot)=>{const name=snapshot.data()?.name;if(typeof name==="string"&&name.trim())setTeacherName(name.trim())},fail),
    ];
    return()=>stops.forEach((stop)=>stop());
  },[user,demo,setToast]);

  const todaySessions=sessions.filter((session)=>dateKey(session.startedAtMs)===dateKey(now));
  const todaySession=todaySessions[0]??null;
  const sessionStudents=todaySession?students.filter((student)=>student.className===todaySession.className):students;
  const todayRecords=todaySession?Object.values(todaySession.records??{}):[];
  const present=todayRecords.filter((record)=>record.status==="present").length;
  const sick=todayRecords.filter((record)=>record.status==="sick").length;
  const permission=todayRecords.filter((record)=>record.status==="permission").length;
  const unrecorded=Math.max(0,sessionStudents.length-todayRecords.length);
  const greeting=now.getHours()<11?"Selamat pagi":now.getHours()<15?"Selamat siang":now.getHours()<18?"Selamat sore":"Selamat malam";

  const weekly=Array.from({length:6},(_,offset)=>{
    const date=new Date(now);date.setDate(now.getDate()-(5-offset));date.setHours(0,0,0,0);
    const latestByClass=new Map<string,AbsensiSession>();
    sessions.filter((session)=>dateKey(session.startedAtMs)===dateKey(date)).forEach((session)=>{if(!latestByClass.has(session.className))latestByClass.set(session.className,session)});
    const daySessions=Array.from(latestByClass.values());
    const total=daySessions.reduce((sum,session)=>sum+students.filter((student)=>student.className===session.className).length,0);
    const attended=daySessions.reduce((sum,session)=>sum+Object.values(session.records??{}).filter((record)=>record.status==="present").length,0);
    return{label:new Intl.DateTimeFormat("id-ID",{weekday:"short"}).format(date).replace(".",""),value:total?Math.round(attended/total*100):null};
  });

  const upcomingTasks=tasks.filter((task)=>{const time=new Date(task.deadline).getTime();return Number.isFinite(time)&&time>=Date.now()-86400000}).sort((a,b)=>new Date(a.deadline).getTime()-new Date(b.deadline).getTime()).slice(0,3);
  const activeExams=exams.filter((exam)=>exam.status==="published"||exam.status==="scheduled").slice(0,Math.max(0,3-upcomingTasks.length));
  const agenda=[
    ...upcomingTasks.map((task)=>({id:"task-"+task.id,title:task.title,meta:task.className+" · "+new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(task.deadline)),day:String(new Date(task.deadline).getDate()).padStart(2,"0"),month:new Intl.DateTimeFormat("id-ID",{month:"short"}).format(new Date(task.deadline)).slice(0,3).toUpperCase(),tone:"bg-violet-50 text-violet-700"})),
    ...activeExams.map((exam)=>({id:"exam-"+exam.id,title:exam.title,meta:exam.className+" · "+(exam.status==="published"?"Online":"Terjadwal"),day:"QR",month:"UJIAN",tone:"bg-sky-50 text-sky-700"})),
  ].slice(0,3);

  return <>
    <SectionHeading eyebrow="Dasbor Guru" title={greeting+", "+teacherName} description={today+" · "+academic.schoolName} action={<button onClick={()=>onView("scan")} className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/20 hover:bg-teal-700"><ScanLine size={18}/>Mulai absensi</button>}/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total siswa" value={String(students.length)} note={new Set(students.map((student)=>student.className)).size+" kelas terdaftar"} icon={Users} tone="bg-sky-50 text-sky-600"/>
      <StatCard label="Hadir hari ini" value={String(present)} note={todaySession?(sessionStudents.length?Math.round(present/sessionStudents.length*100)+"% kelas "+todaySession.className:"Kelas belum memiliki siswa"):"Belum ada sesi absensi"} icon={UserCheck} tone="bg-emerald-50 text-emerald-600"/>
      <StatCard label="Sakit / izin" value={String(sick+permission)} note={sick+" sakit · "+permission+" izin"} icon={MessageCircle} tone="bg-amber-50 text-amber-600"/>
      <StatCard label="Belum absen" value={String(todaySession?unrecorded:students.length)} note={todaySession?"Perlu konfirmasi wali":"Mulai sesi untuk mencatat"} icon={Clock3} tone="bg-rose-50 text-rose-600"/>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_.85fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3"><div><h3 className="font-black">Kehadiran 6 hari terakhir</h3><p className="mt-1 text-xs text-slate-400">Persentase hadir dari sesi tersimpan</p></div><span className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-black text-slate-500">REAL-TIME</span></div>
        <div className="flex h-56 items-end justify-between gap-2 border-b border-slate-100 px-1">{weekly.map((item)=><div key={item.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[9px] font-bold text-slate-400">{item.value===null?"—":item.value+"%"}</span><div className="relative w-full max-w-12 overflow-hidden rounded-t-lg bg-slate-100" style={{height:(item.value===null?8:Math.max(item.value*1.55,12))+"px"}}>{item.value!==null&&<div className="absolute inset-0 bg-gradient-to-t from-teal-600 to-teal-400"/>}</div><span className="pb-3 text-[11px] font-bold text-slate-500">{item.label}</span></div>)}</div>
      </section>
      <section className="rounded-2xl bg-[#07363b] p-5 text-white shadow-lg sm:p-6">
        <div className="flex items-start justify-between"><div><p className="text-xs font-bold text-teal-200">ABSENSI HARI INI</p><h3 className="mt-2 text-2xl font-black">{todaySession?todaySession.className:"Belum dimulai"}</h3><p className="mt-1 text-xs text-slate-300">{todaySession?sessionStudents.length+" siswa · Mulai "+new Date(todaySession.startedAtMs).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}):"Jam masuk "+academic.entryTime+" WIB"}</p></div><div className="rounded-2xl bg-white/10 p-3"><QrCode size={25} className="text-teal-300"/></div></div>
        <div className="my-5 h-px bg-white/10"/><div className="space-y-3">{[["Hadir",present,"bg-emerald-400"],["Sakit / izin",sick+permission,"bg-amber-400"],["Belum absen",todaySession?unrecorded:students.length,"bg-rose-400"]].map(([label,value,color])=><div key={String(label)} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-slate-300"><span className={"h-2 w-2 rounded-full "+color}/>{label}</span><strong>{value}</strong></div>)}</div>
        <button onClick={()=>onView(todaySession?"attendance":"scan")} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950">{todaySession?"Lihat rekap lengkap":"Mulai absensi"}<ChevronRight size={16}/></button>
      </section>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">Agenda terdekat</h3><p className="mt-1 text-xs text-slate-400">Tugas dan ujian yang perlu diperhatikan</p></div><button onClick={()=>onView("tasks")} className="text-xs font-bold text-teal-700">Lihat semua</button></div>
        {agenda.length?<div className="space-y-3">{agenda.map((item)=><div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><div className={"grid h-12 w-12 shrink-0 place-items-center rounded-xl "+item.tone}><div className="text-center"><p className="text-sm font-black leading-4">{item.day}</p><p className="text-[7px] font-black">{item.month}</p></div></div><div className="min-w-0"><p className="truncate text-sm font-extrabold">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.meta}</p></div></div>)}</div>:<div className="rounded-xl bg-slate-50 px-4 py-10 text-center"><CalendarDays className="mx-auto text-slate-300" size={28}/><p className="mt-3 text-sm font-bold text-slate-500">Belum ada agenda terdekat</p></div>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 font-black">Aksi cepat</h3><div className="grid grid-cols-2 gap-3">{[{label:"Tambah siswa",icon:UserPlus,key:"students"},{label:"Buat tugas",icon:PencilLine,key:"tasks"},{label:"Buat ulangan",icon:ClipboardCheck,key:"exams"},{label:"Buat soal AI",icon:Bot,key:"ai"}].map((item)=>{const Icon=item.icon;return <button key={item.label} onClick={()=>onView(item.key as NavKey)} className="group min-h-28 rounded-xl border border-slate-200 p-4 text-left transition hover:border-teal-300 hover:bg-teal-50/40"><Icon size={21} className="mb-3 text-teal-600"/><p className="text-sm font-extrabold">{item.label}</p><p className="mt-1 text-[10px] text-slate-400">Buka modul <ChevronRight className="inline" size={11}/></p></button>})}</div></section>
    </div>
  </>;
}
function PrivateStudentPhoto({user,photoKey,alt,className,fallback}:{user:User|null;photoKey?:string;alt:string;className:string;fallback:React.ReactNode}){
  const [url,setUrl]=useState("");
  useEffect(()=>{
    if(!user||!photoKey){setUrl("");return;}
    let active=true;let objectUrl="";
    void user.getIdToken().then((token)=>fetch(`/api/storage/file/${encodeURIComponent(photoKey)}`,{headers:{Authorization:`Bearer ${token}`}})).then((response)=>{if(!response.ok)throw new Error();return response.blob()}).then((blob)=>{if(!active)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(()=>{if(active)setUrl("")});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[user,photoKey]);
  return url?<img src={url} alt={alt} className={className}/>:<>{fallback}</>;
}

function StudentPhotoCropper({file,onApply,setToast}:{file:File;onApply:(thumbnail:File,aspect:PhotoAspect)=>void;setToast:(toast:Toast)=>void}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const [image,setImage]=useState<HTMLImageElement|null>(null);
  const [aspect,setAspect]=useState<PhotoAspect>("3:4");
  const [zoom,setZoom]=useState(1);
  const [positionX,setPositionX]=useState(0);
  const [positionY,setPositionY]=useState(0);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;void loadPhoto(file).then((loaded)=>{if(active)setImage(loaded)}).catch(()=>setToast({message:"Foto tidak dapat dibuka.",tone:"error"}));return()=>{active=false}},[file,setToast]);
  useEffect(()=>{if(image&&canvasRef.current)drawStudentCrop(canvasRef.current,image,aspect,zoom,positionX,positionY)},[image,aspect,zoom,positionX,positionY]);
  async function apply(){setBusy(true);try{const thumbnail=await createStudentThumbnail(file,aspect,zoom,positionX,positionY);onApply(thumbnail,aspect);setToast({message:`Crop ${aspect} diterapkan · ${Math.ceil(thumbnail.size/1024)} KB.`,tone:"success"});}catch{setToast({message:"Thumbnail gagal dibuat.",tone:"error"});}finally{setBusy(false)}}
  return <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4"><div className="flex flex-col gap-4 sm:flex-row"><div className="mx-auto w-40 shrink-0"><canvas ref={canvasRef} className={`w-full rounded-xl bg-slate-200 object-cover shadow-sm ${aspect==="3:4"?"aspect-[3/4]":"aspect-[4/3]"}`}/><p className="mt-2 text-center text-[10px] font-bold text-teal-700">Pratinjau thumbnail {aspect}</p></div><div className="min-w-0 flex-1 space-y-3"><label className="block"><span className="mb-1.5 block text-xs font-extrabold">Rasio crop</span><select value={aspect} onChange={(event)=>setAspect(event.target.value as PhotoAspect)} className="h-10 w-full rounded-xl border border-teal-200 bg-white px-3 text-xs font-bold"><option value="3:4">3:4 · Potret</option><option value="4:3">4:3 · Mendatar</option></select></label><label className="block"><span className="flex justify-between text-[10px] font-bold"><span>Zoom</span><span>{zoom.toFixed(1)}×</span></span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event)=>setZoom(Number(event.target.value))} className="w-full accent-teal-600"/></label><label className="block"><span className="flex justify-between text-[10px] font-bold"><span>Geser horizontal</span><span>{positionX}</span></span><input type="range" min="-100" max="100" value={positionX} onChange={(event)=>setPositionX(Number(event.target.value))} className="w-full accent-teal-600"/></label><label className="block"><span className="flex justify-between text-[10px] font-bold"><span>Geser vertikal</span><span>{positionY}</span></span><input type="range" min="-100" max="100" value={positionY} onChange={(event)=>setPositionY(Number(event.target.value))} className="w-full accent-teal-600"/></label><button type="button" disabled={busy||!image} onClick={()=>void apply()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={15}/>:<Check size={15}/>}Gunakan hasil crop</button></div></div></div>;
}

function studentQrPayload(student: Student) {
  return student.id;
}

function StudentQrCard({student,schoolName,academicYear,user,schoolLogoKey="",template="photo",photoSrc,schoolLogoSrc,appLogoSrc}:{student:Student;schoolName:string;academicYear:string;user?:User|null;schoolLogoKey?:string;template?:"photo"|"no-photo";photoSrc?:string|null;schoolLogoSrc?:string|null;appLogoSrc?:string}){
  const initials=student.name.split(" ").filter(Boolean).slice(0,2).map((part)=>part[0]).join("").toUpperCase();
  const withPhoto=template==="photo";
  const photoFallback=<div className="grid h-full min-h-[108px] w-full place-items-center rounded-none bg-gradient-to-br from-sky-100 to-white text-base font-black text-sky-800">{initials||"ID"}</div>;
  return <article className="student-qr-card relative mx-auto h-[54mm] w-[85.6mm] shrink-0 overflow-hidden rounded-none border border-sky-300 bg-white text-slate-950 shadow-[0_18px_45px_rgba(14,116,144,0.18)]">
    <header className="relative flex h-[52px] items-center gap-2.5 overflow-hidden bg-sky-300 px-3.5 text-sky-950">
      <div className="absolute -left-10 -top-14 h-24 w-64 rotate-[8deg] rounded-[50%]" style={{backgroundColor:"rgba(186,230,253,0.8)"}}/>
      <div className="absolute -right-16 -top-8 h-20 w-56 -rotate-[10deg] rounded-[50%]" style={{backgroundColor:"rgba(56,189,248,0.45)"}}/>
      <img src={appLogoSrc||"/logo.png"} loading="eager" decoding="sync" alt="Logo SMART-ATT" className="student-qr-logo relative h-8 w-8 shrink-0 rounded-lg bg-white object-cover p-0.5 shadow-sm"/>
      <div className="relative min-w-0 flex-1"><p className="truncate text-[9px] font-black uppercase leading-[1.4] tracking-[0.12em]">{schoolName}</p><p className="mt-0.5 text-[6.5px] font-extrabold uppercase leading-[1.35] tracking-[0.18em] text-sky-800">SMART-ATT · Kartu Identitas Siswa</p></div>
      {schoolLogoSrc!==undefined?(schoolLogoSrc?<img src={schoolLogoSrc} loading="eager" decoding="sync" alt={`Logo ${schoolName}`} className="student-school-logo relative h-9 w-9 shrink-0 rounded-none object-contain"/>:<School size={22} className="relative shrink-0 text-sky-900"/>):schoolLogoKey?<PrivateStudentPhoto user={user ?? null} photoKey={schoolLogoKey} alt={`Logo ${schoolName}`} className="student-school-logo relative h-9 w-9 shrink-0 rounded-none object-contain" fallback={<School size={22} className="relative text-sky-900"/>}/>:<School size={22} className="relative shrink-0 text-sky-900"/>}
    </header>
    <div className={`grid h-[calc(100%_-_52px)] min-h-0 items-stretch gap-2.5 bg-[linear-gradient(135deg,#ffffff_0%,#f0f9ff_100%)] p-3 ${withPhoto?"grid-cols-[29%_1fr_26%]":"grid-cols-[1fr_27%]"}`}>
      {withPhoto&&<div className="min-w-0 rounded-none border-2 border-sky-300 bg-sky-50 p-1 shadow-sm">{photoSrc!==undefined?(photoSrc?<img src={photoSrc} loading="eager" decoding="sync" alt={"Foto "+student.name} className="h-full min-h-0 w-full rounded-none object-cover"/>:photoFallback):<PrivateStudentPhoto user={user??null} photoKey={student.photoThumbnailKey??student.photoKey} alt={"Foto "+student.name} className="h-full min-h-0 w-full rounded-none object-cover" fallback={photoFallback}/>}</div>}
      <section className="min-w-0 overflow-hidden py-0.5 text-left">
        <p className="text-[7px] font-black uppercase leading-[1.3] tracking-[0.16em] text-sky-700">Kartu Pelajar</p>
        <h3 className={`mt-0.5 overflow-hidden break-words font-black leading-[1.2] text-slate-950 ${withPhoto?"max-h-[27px] text-[11px]":"max-h-[38px] text-[15px]"}`}>{student.name}</h3>
        <dl className={`mt-1.5 grid grid-cols-[32px_1fr] gap-x-1.5 gap-y-0.5 font-bold leading-[1.25] ${withPhoto?"text-[7px]":"text-[8.5px]"}`}><dt className="uppercase tracking-[0.12em] text-sky-700">NIS</dt><dd className="truncate text-slate-900">{student.nis}</dd><dt className="uppercase tracking-[0.12em] text-sky-700">NISN</dt><dd className="truncate text-slate-900">{student.nisn||"-"}</dd><dt className="uppercase tracking-[0.12em] text-sky-700">Kelas</dt><dd className="truncate text-slate-900">{student.className}</dd></dl>
        <p className="mt-1.5 truncate text-[5.5px] font-extrabold uppercase leading-[1.3] tracking-[0.12em] text-slate-400">Tahun Ajaran {academicYear}</p>
      </section>
      <aside className="flex min-w-0 flex-col items-center justify-center rounded-none border border-sky-200 bg-white p-1.5 shadow-sm">
        <QRCodeSVG value={studentQrPayload(student)} size={68} level="M" includeMargin={false} className="student-qr-code h-[68px] w-[68px] max-w-full shrink-0"/>
        <p className="mt-1 text-center text-[5.5px] font-black uppercase tracking-[0.12em] text-sky-800">Scan Absensi</p>
      </aside>
    </div>
  </article>;
}
type TransferDirectoryStudent={ownerUid:string;studentId:string;nis:string;nisn?:string;name:string;className:string;schoolName:string;guardian?:string;phone?:string;photoKey?:string;photoThumbnailKey?:string;photoAspect?:PhotoAspect};
function parseTransferStudentQr(raw:string){const text=raw.trim().replace(/^\uFEFF/,"");if(!text)return null;try{const parsed=JSON.parse(text) as {app?:unknown;ownerUid?:unknown;uid?:unknown;teacherUid?:unknown;studentId?:unknown;id?:unknown};const ownerUid=String(parsed.ownerUid??parsed.uid??parsed.teacherUid??"").trim();const studentId=String(parsed.studentId??parsed.id??"").trim();const app=String(parsed.app??"").trim().toUpperCase();if(!studentId||(app&&app!=="SMART-ATT"))return null;return{ownerUid,studentId};}catch{return{ownerUid:"",studentId:text};}}function TransferStudentModal({user,classes,schoolName,students,onClose,setToast}:{user:User;classes:string[];schoolName:string;students:Student[];onClose:()=>void;setToast:(toast:Toast)=>void}){
  const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const [targetClass,setTargetClass]=useState(classes[0]??"");const [found,setFound]=useState<TransferDirectoryStudent|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const scanningRef=useRef(false);
  function stop(){streamRef.current?.getTracks().forEach((track)=>track.stop());streamRef.current=null;if(timerRef.current)clearInterval(timerRef.current);timerRef.current=null;}
  async function readQr(raw:string){if(scanningRef.current)return;scanningRef.current=true;try{const identity=parseTransferStudentQr(raw);if(!identity)throw new Error("QR bukan kartu SMART-ATT terbaru. Arahkan kamera ke QR siswa yang besar, bukan logo.");const {ownerUid,studentId}=identity;if(ownerUid&&ownerUid===user.uid)throw new Error("Siswa sudah berada di akun ini. Gunakan Edit Siswa untuk mengganti kelas.");let snapshot=await getDoc(doc(db,"studentDirectory",studentId));if(!snapshot.exists()&&ownerUid)snapshot=await getDoc(doc(db,"studentDirectory",`${ownerUid}__${studentId}`));if(!snapshot.exists())throw new Error("Data asal belum tersedia. Guru lama perlu membuka Data Siswa terlebih dahulu.");const data=snapshot.data();const sourceOwnerUid=String(data.ownerUid||ownerUid);if(sourceOwnerUid===user.uid)throw new Error("Siswa sudah berada di akun ini. Gunakan Edit Siswa untuk mengganti kelas.");const student:TransferDirectoryStudent={ownerUid:sourceOwnerUid,studentId:String(data.studentId||studentId),nis:String(data.nis),nisn:typeof data.nisn==="string"?data.nisn:"",name:String(data.name),className:String(data.className),schoolName:String(data.schoolName||"Sekolah"),guardian:typeof data.guardian==="string"?data.guardian:"",phone:typeof data.phone==="string"?data.phone:"",photoKey:typeof data.photoKey==="string"?data.photoKey:"",photoThumbnailKey:typeof data.photoThumbnailKey==="string"?data.photoThumbnailKey:"",photoAspect:data.photoAspect==="4:3"?"4:3":"3:4"};if(students.some((item)=>item.nis===student.nis||Boolean(student.nisn&&item.nisn===student.nisn)))throw new Error(`NIS/NISN ${student.nis} sudah ada di Data Siswa akun ini.`);setFound(student);setError("");stop();}catch(value){setError(value instanceof Error?value.message:"QR tidak dapat dibaca.");setTimeout(()=>{scanningRef.current=false},1200);}}
  async function start(){try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}const Detector=(window as unknown as {BarcodeDetector?:new(options:{formats:string[]})=>{detect(source:HTMLVideoElement):Promise<{rawValue:string}[]>}}).BarcodeDetector;if(!Detector){setError("Browser belum mendukung pemindai QR. Gunakan Chrome terbaru di HP.");return;}const detector=new Detector({formats:["qr_code"]});timerRef.current=setInterval(async()=>{if(!videoRef.current||scanningRef.current||videoRef.current.readyState<2)return;const codes=await detector.detect(videoRef.current).catch(()=>[]);const valid=codes.find((code)=>code.rawValue&&parseTransferStudentQr(code.rawValue));if(valid?.rawValue){void readQr(valid.rawValue);return;}if(codes.length>0)setError("QR pada logo atau objek lain terbaca. Arahkan kamera ke QR siswa yang besar.");},450);}catch{setError("Kamera tidak dapat dibuka. Izinkan akses kamera pada browser.");}}
  useEffect(()=>{void start();return()=>stop()},[]);
  async function transfer(){
    if(!found||!targetClass||busy)return;
    setBusy(true);
    try{
      const linkId=`${found.ownerUid}__${found.studentId}__${user.uid}`;
      await setDoc(doc(db,"studentClassLinks",linkId),{sourceOwnerUid:found.ownerUid,sourceStudentId:found.studentId,targetOwnerUid:user.uid,targetStudentId:`${found.ownerUid}__${found.studentId}`,nis:found.nis,studentName:found.name,sourceClassName:found.className,sourceSchoolName:found.schoolName,targetClassName:targetClass,targetSchoolName:schoolName,status:"pending",active:false,requestedAt:serverTimestamp(),requestedBy:user.uid,updatedAt:serverTimestamp()},{merge:true});
      setToast({message:`Permintaan ${found.name} ke ${targetClass} dikirim. Menunggu persetujuan guru lama.`,tone:"success"});
      onClose();
    }catch(value){setError(value instanceof Error?value.message:"Permintaan pendaftaran siswa gagal.");}
    finally{setBusy(false)}
  }
  return <Modal title="Pindai siswa yang sudah terdaftar" subtitle="Scan kartu QR lama, pilih kelas baru, lalu minta persetujuan guru lama." onClose={onClose}><div className="space-y-4">{!found?<div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950"><video ref={videoRef} muted playsInline className="h-full w-full object-cover"/><div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-dashed border-teal-300"/><p className="absolute inset-x-3 bottom-3 rounded-xl bg-slate-950/70 px-3 py-2 text-center text-xs font-bold text-white">Arahkan kamera ke kartu QR siswa</p></div>:<div className="rounded-2xl border border-teal-200 bg-teal-50 p-4"><p className="text-[10px] font-black uppercase text-teal-600">Data siswa ditemukan</p><h3 className="mt-1 text-lg font-black">{found.name}</h3><p className="mt-1 text-xs text-teal-800">NIS {found.nis} · {found.className} · {found.schoolName}</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-white p-3"><span className="text-slate-400">Wali</span><p className="mt-1 font-black">{found.guardian||"Belum diisi"}</p></div><div className="rounded-xl bg-white p-3"><span className="text-slate-400">WhatsApp</span><p className="mt-1 font-black">{found.phone||"Belum diisi"}</p></div></div></div>}{error&&<p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}<label className="block"><span className="mb-2 block text-xs font-black">Masukkan ke kelas</span><select value={targetClass} onChange={(event)=>setTargetClass(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Pilih kelas tujuan</option>{classes.map((item)=><option key={item}>{item}</option>)}</select></label>{found&&<div className="grid grid-cols-2 gap-3"><button onClick={()=>{setFound(null);scanningRef.current=false;void start()}} className="h-12 rounded-xl border border-slate-200 text-xs font-black">Scan ulang</button><button disabled={busy||!targetClass} onClick={()=>void transfer()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-600 text-xs font-black text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Kirim permintaan</button></div>}</div></Modal>
}
function whatsappHref(phone:string){const normalized=phone.replace(/\D/g,"").replace(/^0/,"62");return normalized.length>=10?`https://wa.me/${normalized}`:"";}
function StudentsView({ user, demo, students, configuredClasses, setStudents, setToast }: { user: User | null; demo: boolean; students: Student[]; configuredClasses: string[]; setStudents: React.Dispatch<React.SetStateAction<Student[]>>; setToast: (t: Toast) => void }) {
  const classOptions = Array.from(new Set([...configuredClasses, ...students.map((student) => student.className)].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
  const defaultClass = classOptions[0] ?? "V-A";
  const emptyForm = { nis: "", nisn: "", name: "", className: defaultClass, guardian: "", phone: "" };
  const [search, setSearch] = useState(""); const [classFilter, setClassFilter] = useState("Semua kelas"); const [modal, setModal] = useState(false); const [transferModal,setTransferModal]=useState(false); const [qrStudent, setQrStudent] = useState<Student | null>(null); const [qrBatch, setQrBatch] = useState(false); const [cardTemplate,setCardTemplate]=useState<"photo"|"no-photo">("photo"); const [printLayout,setPrintLayout]=useState<"single"|"a4-8"|"a4-10"|"a4-12">("a4-8"); const [printOrientation,setPrintOrientation]=useState<"portrait"|"landscape">("portrait"); const [isMobilePdf,setIsMobilePdf]=useState(false); const [mobilePdfGenerating,setMobilePdfGenerating]=useState(false); const [mobilePdfProgress,setMobilePdfProgress]=useState(0); const [mobilePdfMessage,setMobilePdfMessage]=useState(""); const [mobilePdfError,setMobilePdfError]=useState(""); const [mobilePdfEmail,setMobilePdfEmail]=useState(""); const [mobilePdfDownloadUrl,setMobilePdfDownloadUrl]=useState(""); const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm); const [photo, setPhoto] = useState<File | null>(null); const [thumbnail, setThumbnail] = useState<File | null>(null); const [photoAspect,setPhotoAspect]=useState<PhotoAspect>("3:4"); const [photoProcessing,setPhotoProcessing]=useState(false); const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [guardianModal, setGuardianModal] = useState(false); const [guardianClass, setGuardianClass] = useState(defaultClass); const [guardianLink, setGuardianLink] = useState(""); const [publishingLink, setPublishingLink] = useState(false);
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  const [academicYear,setAcademicYear]=useState("2026/2027");
  const [schoolLogoKey,setSchoolLogoKey]=useState("");
  const [crossLocations,setCrossLocations]=useState<Record<string,{scannedClassName:string;scannedSchoolName:string;dateKey:string}>>({});
  const [sharedClassLocations,setSharedClassLocations]=useState<Record<string,{scannedClassName:string;scannedSchoolName:string;dateKey:string}>>({});
  const [pendingClassRequests,setPendingClassRequests]=useState<Array<{id:string;studentName:string;nis:string;sourceClassName:string;targetClassName:string;targetSchoolName:string}>>([]);
  const processingTransferRef=useRef<Record<string,boolean>>({});
  const directorySyncedRef=useRef(false);
  // Device detection is intentionally client-only because the desktop print flow must remain unchanged.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{const userAgent=navigator.userAgent;setIsMobilePdf(/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)||(/Macintosh/i.test(userAgent)&&navigator.maxTouchPoints>1))},[]);
  useEffect(()=>{if(demo){setSchoolName("SMP Harapan Bangsa");setAcademicYear("2026/2027");setSchoolLogoKey("");return;}if(!user)return;void Promise.all([getDoc(doc(db,"users",user.uid)),getDoc(doc(db,"users",user.uid,"settings","academic"))]).then(([profile,academic])=>{const profileData=profile.data();const profileSchool=profileData?.schoolName;const academicData=academic.data();const academicSchool=academicData?.schoolName;if(typeof academicSchool==="string"&&academicSchool.trim())setSchoolName(academicSchool.trim());else if(typeof profileSchool==="string"&&profileSchool.trim())setSchoolName(profileSchool.trim());if(typeof academicData?.academicYear==="string"&&academicData.academicYear.trim())setAcademicYear(academicData.academicYear.trim());const logo=typeof academicData?.schoolLogoKey==="string"?academicData.schoolLogoKey:typeof profileData?.schoolLogoKey==="string"?profileData.schoolLogoKey:"";setSchoolLogoKey(logo);});},[demo,user]);
  useEffect(() => { if (classOptions.length && !classOptions.includes(guardianClass)) setGuardianClass(classOptions[0]); }, [classOptions.join("\u0001"), guardianClass]);
  useEffect(() => {
    if (!user || demo || !students.length || directorySyncedRef.current || schoolName === "Sekolah") return;
    directorySyncedRef.current = true;
    void (async()=>{try{for(let offset=0;offset<students.length;offset+=400){const batch=writeBatch(db);students.slice(offset,offset+400).forEach((student)=>{const directoryPayload={ownerUid:user.uid,studentId:student.id,nis:student.nis,nisn:student.nisn??"",name:student.name,className:student.className,schoolName,guardian:student.guardian??"",phone:student.phone??"",photoKey:student.photoKey??"",photoThumbnailKey:student.photoThumbnailKey??"",photoAspect:student.photoAspect??"3:4",active:true,updatedAt:serverTimestamp()};batch.set(doc(db,"studentDirectory",`${user.uid}__${student.id}`),directoryPayload,{merge:true});batch.set(doc(db,"studentDirectory",student.id),directoryPayload,{merge:true});});await batch.commit();}}catch{directorySyncedRef.current=false;}})();
  }, [user, demo, students, schoolName]);
  useEffect(() => {
    if (!user || demo) { setCrossLocations({}); return; }
    return onSnapshot(query(collection(db, "crossClassAbsensi"), where("ownerUid", "==", user.uid)), (snapshot) => {
      const next: Record<string,{scannedClassName:string;scannedSchoolName:string;dateKey:string}> = {};
      snapshot.docs.sort((a,b)=>Number(b.data().recordedAtMs||0)-Number(a.data().recordedAtMs||0)).forEach((item)=>{const data=item.data();if(!next[String(data.studentId)])next[String(data.studentId)]={scannedClassName:String(data.scannedClassName||"Kelas lain"),scannedSchoolName:String(data.scannedSchoolName||"Sekolah lain"),dateKey:String(data.dateKey||"")};});
      setCrossLocations(next);
    });
  }, [user, demo]);
  useEffect(() => {
    if (!user || demo) { setSharedClassLocations({}); setPendingClassRequests([]); return; }
    return onSnapshot(query(collection(db,"studentClassLinks"),where("sourceOwnerUid","==",user.uid)),(snapshot)=>{
      const next: Record<string,{scannedClassName:string;scannedSchoolName:string;dateKey:string}> = {};
      const pending:Array<{id:string;studentName:string;nis:string;sourceClassName:string;targetClassName:string;targetSchoolName:string}> = [];
      snapshot.docs.forEach((item)=>{const data=item.data();const status=String(data.status||"completed");if(status==="pending"){pending.push({id:item.id,studentName:String(data.studentName||"Siswa"),nis:String(data.nis||"-"),sourceClassName:String(data.sourceClassName||"Kelas ini"),targetClassName:String(data.targetClassName||"Kelas lain"),targetSchoolName:String(data.targetSchoolName||"Sekolah lain")});}if(status==="approved"||status==="completed")next[String(data.sourceStudentId)]={scannedClassName:String(data.targetClassName||"Kelas lain"),scannedSchoolName:String(data.targetSchoolName||"Sekolah lain"),dateKey:""};});
      setPendingClassRequests(pending);setSharedClassLocations(next);
    });
  }, [user, demo]);
  useEffect(()=>{
    if(!user||demo)return;
    return onSnapshot(query(collection(db,"studentClassLinks"),where("targetOwnerUid","==",user.uid)),(snapshot)=>{
      snapshot.docs.filter((item)=>String(item.data().status||"")==="approved").forEach((item)=>{
        const link=item.data();if(processingTransferRef.current[item.id])return;processingTransferRef.current[item.id]=true;
        void (async()=>{try{
          const targetId=String(link.targetStudentId||`${link.sourceOwnerUid}__${link.sourceStudentId}`);const targetRef=doc(db,"users",user.uid,"students",targetId);const target=await getDoc(targetRef);if(target.exists()){await updateDoc(doc(db,"studentClassLinks",item.id),{status:"completed",active:true,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});return;}
          const source=await getDoc(doc(db,"studentDirectory",`${link.sourceOwnerUid}__${link.sourceStudentId}`));if(!source.exists())throw new Error("Direktori siswa asal tidak ditemukan.");const data=source.data();const token=await user.getIdToken();
          async function copyPhoto(sourceKey:string){if(!sourceKey)return "";const response=await fetch("/api/storage/transfer-student-photo",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({sourceOwnerUid:String(link.sourceOwnerUid),sourceKey})});if(!response.ok)throw new Error("Foto siswa gagal disalin dari R2.");return (await response.json() as {key:string}).key;}
          const [photoKey,photoThumbnailKey]=await Promise.all([copyPhoto(typeof data.photoKey==="string"?data.photoKey:""),copyPhoto(typeof data.photoThumbnailKey==="string"?data.photoThumbnailKey:"")]);const batch=writeBatch(db);const nisn=typeof data.nisn==="string"?data.nisn:"";batch.set(targetRef,{nis:String(data.nis),nisn,name:String(data.name),className:String(link.targetClassName),guardian:typeof data.guardian==="string"?data.guardian:"",phone:typeof data.phone==="string"?data.phone:"",photoKey,photoThumbnailKey,photoAspect:data.photoAspect==="4:3"?"4:3":"3:4",importedFromUid:String(link.sourceOwnerUid),importedFromStudentId:String(link.sourceStudentId),importedFromClassName:String(data.className),importedFromSchoolName:String(data.schoolName||"Sekolah"),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});const directoryPayload={ownerUid:user.uid,studentId:targetId,nis:String(data.nis),nisn,name:String(data.name),className:String(link.targetClassName),schoolName,guardian:typeof data.guardian==="string"?data.guardian:"",phone:typeof data.phone==="string"?data.phone:"",photoKey,photoThumbnailKey,photoAspect:data.photoAspect==="4:3"?"4:3":"3:4",active:true,updatedAt:serverTimestamp()};batch.set(doc(db,"studentDirectory",`${user.uid}__${targetId}`),directoryPayload,{merge:true});batch.set(doc(db,"studentDirectory",targetId),directoryPayload,{merge:true});batch.update(doc(db,"studentClassLinks",item.id),{status:"completed",active:true,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();setToast({message:`${String(data.name)} disalin ke ${String(link.targetClassName)} setelah disetujui guru lama.`,tone:"success"});
        }catch(error){setToast({message:error instanceof Error?error.message:"Permintaan siswa belum dapat diselesaikan.",tone:"error"});}finally{delete processingTransferRef.current[item.id];}})();
      });
    });
  },[user,demo,schoolName,setToast]);
  const otherLocations={...crossLocations,...sharedClassLocations};
  const visible = students.filter((s) => (classFilter === "Semua kelas" || s.className === classFilter) && `${s.name} ${s.id} ${s.nis} ${s.nisn ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const printStudents=qrStudent?[qrStudent]:qrBatch?visible:[];
  async function respondToClassRequest(requestId:string,approved:boolean){
    if(!user)return;
    try{await updateDoc(doc(db,"studentClassLinks",requestId),approved?{status:"approved",active:true,approvedBy:user.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()}:{status:"rejected",active:false,rejectedBy:user.uid,rejectedAt:serverTimestamp(),updatedAt:serverTimestamp()});setToast({message:approved?"Permintaan disetujui. Guru baru akan menerima biodata dan foto siswa.":"Permintaan pendaftaran ditolak.",tone:approved?"success":"error"});}catch{setToast({message:"Respons permintaan belum dapat disimpan.",tone:"error"});}
  }  function openAddStudent() { setEditingStudent(null); setForm(emptyForm); setPhoto(null); setThumbnail(null); setPhotoAspect("3:4"); setModal(true); }
  function openEditStudent(student: Student) { setEditingStudent(student); setForm({ nis: student.nis, nisn: student.nisn ?? "", name: student.name, className: student.className, guardian: student.guardian ?? "", phone: student.phone ?? "" }); setPhoto(null); setThumbnail(null); setPhotoAspect(student.photoAspect??"3:4"); setModal(true); }
  function closeStudentModal() { setModal(false); setEditingStudent(null); setForm(emptyForm); setPhoto(null); setThumbnail(null); setPhotoProcessing(false); }
  async function choosePhoto(file:File|null){if(!file)return;const supportedType=["image/jpeg","image/png","image/webp"].includes(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);if(!supportedType){setToast({message:"Gunakan foto JPG, PNG, atau WebP. Kamera HP biasanya menghasilkan JPG.",tone:"error"});return;}if(file.size>15*1024*1024){setToast({message:"Foto awal maksimal 15 MB.",tone:"error"});return;}setPhotoProcessing(true);try{const resized=await resizeStudentPhoto(file);setPhoto(resized);setThumbnail(null);setToast({message:`Foto di-resize menjadi ${Math.ceil(resized.size/1024)} KB. Atur crop thumbnail.`,tone:"success"});}catch(error){setToast({message:error instanceof Error?error.message:"Foto gagal diproses.",tone:"error"});}finally{setPhotoProcessing(false);}}
  async function uploadStudentPhoto(file:File,token:string){const data=new FormData();data.append("file",file);const response=await fetch("/api/storage/photos",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:data});if(!response.ok)throw new Error("Upload foto ke R2 gagal");return (await response.json() as {key:string}).key;}
  async function saveStudent(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      if(!form.nis.trim()||!form.nisn.trim()||!form.name.trim())throw new Error("Student ID dibuat otomatis. Lengkapi NIS, NISN, dan nama siswa.");
      let photoKey = editingStudent?.photoKey ?? ""; let photoThumbnailKey=editingStudent?.photoThumbnailKey??"";
      if(photo&&!thumbnail)throw new Error("Terapkan crop thumbnail sebelum menyimpan.");
      if (photo && thumbnail && user) {const token=await user.getIdToken();[photoKey,photoThumbnailKey]=await Promise.all([uploadStudentPhoto(photo,token),uploadStudentPhoto(thumbnail,token)]);}
      const payload = { ...form, photoKey, photoThumbnailKey, photoAspect, updatedAt: serverTimestamp() };
      if (user) {
        const studentRef = editingStudent ? doc(db, "users", user.uid, "students", editingStudent.id) : doc(collection(db, "users", user.uid, "students"));
        const batch = writeBatch(db);
        batch.set(studentRef, { ...payload, nis: form.nis.trim(), nisn: form.nisn.trim(), name: form.name.trim(), className: form.className.trim(), ...(!editingStudent ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
        const directoryPayload = { ownerUid: user.uid, studentId: studentRef.id, nis: form.nis.trim(), nisn: form.nisn.trim(), name: form.name.trim(), className: form.className.trim(), schoolName, guardian: form.guardian.trim(), phone: form.phone.trim(), photoKey, photoThumbnailKey, photoAspect, active: true, updatedAt: serverTimestamp() };
        batch.set(doc(db, "studentDirectory", `${user.uid}__${studentRef.id}`), directoryPayload, { merge: true });
        batch.set(doc(db, "studentDirectory", studentRef.id), directoryPayload, { merge: true });
        await batch.commit();
      } else if (editingStudent) setStudents((items) => items.map((student) => student.id === editingStudent.id ? { ...student, ...form, photoKey, photoThumbnailKey, photoAspect } : student));
      else setStudents((items) => [...items, { ...form, photoKey, photoThumbnailKey, photoAspect, id: crypto.randomUUID() }].sort((a, b) => a.name.localeCompare(b.name)));
      closeStudentModal();
      setToast({ message: editingStudent ? "Data siswa dan direktori QR berhasil diperbarui." : demo ? "Siswa ditambahkan dalam mode demo." : "Data siswa tersimpan dan siap dipindai lintas guru.", tone: "success" });
    } catch (err) { setToast({ message: err instanceof Error ? err.message : "Gagal menyimpan siswa.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function publishGuardianLink() {
    const classStudents = students.filter((student) => student.className === guardianClass);
    if (!classStudents.length) { setToast({ message: `Belum ada siswa di kelas ${guardianClass}.`, tone: "error" }); return; }
    setPublishingLink(true);
    try {
      if (!user) {
        setGuardianLink(`${window.location.origin}/public/guardian-data/demo`);
      } else {
        const safeClass = guardianClass.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const snapshotId = `guardian-data-${user.uid}-${safeClass}`;
        await setDoc(doc(db, "publicSnapshots", snapshotId), {
          type: "guardian",
          ownerUid: user.uid,
          schoolName,
          academicYear,
          className: guardianClass,
          published: true,
          students: classStudents.map((student) => ({ id: student.id, attendanceNumber: student.attendanceNumber ?? "", nis: student.nis, nisn: student.nisn ?? "", name: student.name, className: student.className })),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        setGuardianLink(`${window.location.origin}/public/guardian-data/${snapshotId}`);
      }
      setToast({ message: `Link data wali kelas ${guardianClass} siap dibagikan.`, tone: "success" });
    } catch (error) { setToast({ message: error instanceof Error ? error.message : "Gagal membuat link wali murid.", tone: "error" }); }
    finally { setPublishingLink(false); }
  }
  async function removeStudent(student: Student) { if (!confirm(`Hapus data ${student.name}?`)) return; if (user) { const batch=writeBatch(db); batch.delete(doc(db,"users",user.uid,"students",student.id)); batch.delete(doc(db,"studentDirectory",`${user.uid}__${student.id}`)); batch.delete(doc(db,"studentDirectory",student.id)); await batch.commit(); } else setStudents((items)=>items.filter((s)=>s.id!==student.id)); setToast({message:"Data siswa dihapus.",tone:"success"}); }
  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseStudentsCsv(await file.text());
      if (parsed.error) throw new Error(parsed.error);

      const existingByNis = new Map(students.map((student) => [student.nis, student]));
      const existingByNisn = new Map(students.filter((student)=>student.nisn).map((student) => [student.nisn!, student]));
      const nisnConflict = parsed.students.find((student) => existingByNisn.has(student.nisn) && existingByNisn.get(student.nisn)?.nis !== student.nis);
      if (nisnConflict) throw new Error(`NISN ${nisnConflict.nisn} sudah digunakan siswa lain.`);
      const newStudents = parsed.students.filter((student) => !existingByNis.has(student.nis));
      const existingUpdates = parsed.students.filter((student) => existingByNis.has(student.nis));
      if (!newStudents.length && !existingUpdates.length) throw new Error("Tidak ada data siswa yang dapat diproses.");

      if (user) {
        const operations = [
          ...newStudents.map((student) => ({ type: "create" as const, student })),
          ...existingUpdates.map((student) => ({ type: "update" as const, student })),
        ];
        for (let offset = 0; offset < operations.length; offset += 400) {
          const batch = writeBatch(db);
          for (const operation of operations.slice(offset, offset + 400)) {
            if (operation.type === "create") {
              const reference = doc(collection(db, "users", user.uid, "students"));
              batch.set(reference, { ...operation.student, createdAt: serverTimestamp() });
              const directoryPayload = { ownerUid: user.uid, studentId: reference.id, nis: operation.student.nis, nisn: operation.student.nisn, name: operation.student.name, className: operation.student.className, schoolName, guardian: operation.student.guardian ?? "", phone: operation.student.phone ?? "", photoKey: "", photoThumbnailKey: "", photoAspect: "3:4", active: true, updatedAt: serverTimestamp() };
              batch.set(doc(db, "studentDirectory", `${user.uid}__${reference.id}`), directoryPayload);
              batch.set(doc(db, "studentDirectory", reference.id), directoryPayload);
            } else {
              const current = existingByNis.get(operation.student.nis)!;
              batch.set(doc(db, "users", user.uid, "students", current.id), {
                attendanceNumber: operation.student.attendanceNumber,
                nisn: operation.student.nisn,
                name: operation.student.name,
                className: operation.student.className,
                ...(operation.student.guardian ? { guardian: operation.student.guardian } : {}),
                ...(operation.student.phone ? { phone: operation.student.phone } : {}),
                updatedAt: serverTimestamp(),
              }, { merge: true });
              const directoryPayload = { ownerUid: user.uid, studentId: current.id, nis: operation.student.nis, nisn: operation.student.nisn, name: operation.student.name, className: operation.student.className, schoolName, guardian: operation.student.guardian ?? "", phone: operation.student.phone ?? "", photoKey: "", photoThumbnailKey: "", photoAspect: "3:4", active: true, updatedAt: serverTimestamp() };
              batch.set(doc(db, "studentDirectory", `${user.uid}__${current.id}`), directoryPayload, { merge: true });
              batch.set(doc(db, "studentDirectory", current.id), directoryPayload, { merge: true });
            }
          }
          await batch.commit();
        }
      } else {
        const demoRows = newStudents.map((student) => ({ ...student, id: crypto.randomUUID() }));
        setStudents((items) => [...items.map((item) => {
          const update = existingUpdates.find((student) => student.nis === item.nis);
          return update ? { ...item, attendanceNumber: update.attendanceNumber, nisn: update.nisn, name: update.name, className: update.className, ...(update.guardian ? { guardian: update.guardian } : {}), ...(update.phone ? { phone: update.phone } : {}) } : item;
        }), ...demoRows].sort((a, b) => a.name.localeCompare(b.name)));
      }

      setToast({
        message: `${newStudents.length} siswa ditambahkan, ${existingUpdates.length} siswa diperbarui${parsed.skippedRows ? `, ${parsed.skippedRows} baris dilewati` : ""}.`,
        tone: "success",
      });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "CSV gagal diproses.", tone: "error" });
    } finally {
      input.value = "";
    }
  }
  function resetMobilePdfState(){setMobilePdfGenerating(false);setMobilePdfProgress(0);setMobilePdfMessage("");setMobilePdfError("");setMobilePdfEmail("");setMobilePdfDownloadUrl("");}
  async function generateMobilePdf(targetStudents:Student[]){
    if(!user||demo){setMobilePdfError("Generate PDF melalui email hanya tersedia untuk akun guru yang sudah login.");return;}
    if(!targetStudents.length||targetStudents.length>120){setMobilePdfError("Pilih 1 sampai 120 siswa untuk dibuatkan PDF.");return;}
    setMobilePdfGenerating(true);setMobilePdfProgress(1);setMobilePdfMessage("Menghubungkan ke layanan PDF...");setMobilePdfError("");setMobilePdfEmail("");setMobilePdfDownloadUrl("");
    try{
      const token=await user.getIdToken();
      const targetEmail=(user.email||"").trim();
      const response=await fetch("/api/storage/generate-student-cards-pdf",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({students:targetStudents.map((student)=>({id:student.id,nis:student.nis,nisn:student.nisn??"",name:student.name,className:student.className,photoKey:student.photoKey??"",photoThumbnailKey:student.photoThumbnailKey??""})),schoolName,academicYear,schoolLogoKey,template:cardTemplate,layout:printLayout,orientation:printOrientation,email:targetEmail})});
      if(!response.ok){const failure=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(failure?.error||`Server PDF gagal merespons (${response.status}).`)}
      if(!response.body)throw new Error("Browser tidak dapat membaca progress pembuatan PDF.");
      const reader=response.body.getReader();const decoder=new TextDecoder();let pending="";let completed=false;
      const processLine=(line:string)=>{if(!line.trim())return;const event=JSON.parse(line) as {type?:string;percent?:number;message?:string;email?:string;downloadUrl?:string};if(event.type==="error")throw new Error(event.message||"PDF gagal dibuat.");if(typeof event.percent==="number")setMobilePdfProgress(Math.min(100,Math.max(0,event.percent)));if(event.message)setMobilePdfMessage(event.message);if(event.downloadUrl)setMobilePdfDownloadUrl(event.downloadUrl);if(event.type==="complete"){completed=true;setMobilePdfEmail(event.email||targetEmail||"");setToast({message:event.message||"PDF berhasil dibuat. Silakan cek email Anda atau unduh langsung.",tone:"success"})}};
      while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});const lines=pending.split("\n");pending=lines.pop()??"";for(const line of lines)processLine(line);if(done)break}
      if(pending.trim())processLine(pending);
      if(!completed)throw new Error("Proses PDF berhenti sebelum file selesai dibuat.");
    }catch(error){const message=error instanceof Error?error.message:"PDF gagal dibuat. Silakan coba kembali.";setMobilePdfError(message);setMobilePdfMessage("");setToast({message,tone:"error"});}
    finally{setMobilePdfGenerating(false)}
  }
  function printQrCards(){
    const printRoot=document.querySelector<HTMLElement>(".qr-print-root");
    if(!printRoot){setToast({message:"Pratinjau kartu belum siap dicetak.",tone:"error"});return;}
    const printWindow=window.open("","_blank");
    if(!printWindow){setToast({message:"Izinkan pop-up browser untuk mencetak kartu.",tone:"error"});return;}
    const styles=Array.from(document.querySelectorAll<HTMLLinkElement|HTMLStyleElement>('link[rel="stylesheet"],style')).map((element)=>element.outerHTML).join("\n");
    const effectiveOrientation=printLayout==="a4-10"?"portrait":printOrientation;
    const pageSize=printLayout==="single"?"85.6mm 54mm":`A4 ${effectiveOrientation}`;
    printWindow.opener=null;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>Cetak Student ID SMART-ATT</title>${styles}<style>@page{size:${pageSize};margin:0}html,body{margin:0!important;background:#fff!important}.qr-print-root{position:static!important}.student-qr-card,.student-qr-card *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style></head><body>${printRoot.outerHTML}<script>(async()=>{const links=Array.from(document.querySelectorAll('link[rel="stylesheet"]'));await Promise.all(links.map((link)=>link.sheet?Promise.resolve():new Promise((resolve)=>{link.addEventListener('load',resolve,{once:true});link.addEventListener('error',resolve,{once:true})})));const images=Array.from(document.images);await Promise.all(images.map(async(image)=>{if(!image.complete)await new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',()=>reject(new Error('Gambar cetak gagal dimuat')),{once:true})});if(image.decode)await image.decode()}));if(document.fonts?.ready)await document.fonts.ready;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.onafterprint=()=>window.close();window.focus();window.print()}))})().catch((error)=>{document.body.innerHTML='<p style="font:16px sans-serif;padding:24px">'+error.message+'. Tutup halaman ini lalu coba kembali.</p>'})();<\/script></body></html>`);
    printWindow.document.close();
  }
  return <>
<SectionHeading eyebrow="Master Data" title="Data siswa" description="Kelola identitas, wali murid, foto, dan kartu QR siswa." action={<div className="flex flex-wrap gap-2">
<button onClick={()=>{setGuardianLink("");setGuardianModal(true)}} className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-extrabold text-teal-700">
<MessageCircle size={16}/>Link data wali</button>
<button disabled={!visible.length} onClick={()=>{resetMobilePdfState();setQrBatch(true)}} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-700 shadow-sm disabled:opacity-40">
{isMobilePdf?<FileDown size={16}/>:<Printer size={16}/>} {isMobilePdf?"Generate PDF":"Cetak Student ID"} ({visible.length})</button>
<label title="Mendukung pemisah koma atau titik koma. Header wajib: NIS dan Nama Siswa." className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-700 shadow-sm">
<Upload size={16}/>Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv}/>
</label>
<button disabled={!user||demo} onClick={()=>setTransferModal(true)} className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs font-extrabold text-violet-700 disabled:opacity-40"><ScanLine size={17}/>Pindai siswa lama</button>
<button onClick={openAddStudent} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-teal-600/20">
<Plus size={17}/>Tambah siswa</button>
</div>} />
  {pendingClassRequests.length>0&&<section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-200 text-amber-800"><ShieldAlert size={19}/></div><div className="min-w-0 flex-1"><h3 className="font-black text-amber-950">Permintaan pendaftaran siswa</h3><p className="mt-1 text-xs leading-5 text-amber-800">Guru lain meminta mendaftarkan siswa dari kelas Anda. Siswa tetap tersimpan di kelas ini.</p><div className="mt-3 space-y-2">{pendingClassRequests.map((request)=><div key={request.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-black text-slate-900">{request.studentName} <span className="text-xs font-bold text-slate-400">· NIS {request.nis}</span></p><p className="mt-1 text-[11px] text-slate-500">{request.sourceClassName} → {request.targetClassName} · {request.targetSchoolName}</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>void respondToClassRequest(request.id,false)} className="rounded-lg border border-rose-200 px-3 py-2 text-[11px] font-black text-rose-700">Tolak</button><button onClick={()=>void respondToClassRequest(request.id,true)} className="rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-black text-white">Setujui</button></div></div>)}</div></div></div></section>}  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
<div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
<div className="relative w-full max-w-md">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/>
<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Cari nama, Student ID, NIS, atau NISN..." className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm outline-none focus:border-teal-500"/>
</div>
<div className="flex items-center gap-2">
<select value={classFilter} onChange={(e)=>setClassFilter(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none">
<option>Semua kelas</option>{classOptions.map((className)=>
<option key={className}>{className}</option>)}</select>
<span className="rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-500">{visible.length} siswa</span>
</div>
</div>
<div className="divide-y divide-slate-100 lg:hidden">
  {visible.map((student)=><article key={student.id} className="p-4">
    <div className="flex items-start gap-3">
      <PrivateStudentPhoto user={user} photoKey={student.photoThumbnailKey??student.photoKey} alt={"Foto "+student.name} className="h-14 w-14 shrink-0 rounded-2xl object-cover shadow-sm" fallback={<div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-100 to-sky-100 text-sm font-black text-teal-700">{student.name.split(" ").slice(0,2).map((part)=>part[0]).join("")}</div>}/>
      <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-black text-slate-900">{student.name}</h3><p className="mt-1 text-xs font-bold text-slate-500">NIS {student.nis}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-lg bg-sky-50 px-2.5 py-1 text-[10px] font-extrabold text-sky-700">{student.className}</span><span className={"rounded-lg px-2.5 py-1 text-[10px] font-extrabold "+(student.guardian?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700")}>{student.guardian?"Data lengkap":"Wali belum lengkap"}</span>{otherLocations[student.id]&&<span className="rounded-lg bg-violet-50 px-2.5 py-1 text-[10px] font-extrabold text-violet-700">Tercatat juga: {otherLocations[student.id].scannedClassName} · {otherLocations[student.id].scannedSchoolName}</span>}</div></div>
    </div>
    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Orang tua / wali</p><p className="mt-1 text-xs font-bold text-slate-700">{student.guardian||"Belum diisi"} <span className="font-normal text-slate-400">· {student.phone ? (whatsappHref(student.phone) ? <a href={whatsappHref(student.phone)} target="_blank" rel="noreferrer" className="font-black text-emerald-700 underline">WhatsApp</a> : "WhatsApp tidak valid") : "WhatsApp belum ada"}</span></p></div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <button onClick={()=>{resetMobilePdfState();setQrStudent(student)}} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-teal-50 text-xs font-extrabold text-teal-700"><QrCode size={16}/>QR</button>
      <button onClick={()=>openEditStudent(student)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-50 text-xs font-extrabold text-sky-700"><PencilLine size={16}/>Edit</button>
      <button onClick={()=>void removeStudent(student)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-rose-50 text-xs font-extrabold text-rose-700"><Trash2 size={16}/>Hapus</button>
    </div>
  </article>)}
</div>
<div className="hidden overflow-x-auto lg:block">
<table className="w-full min-w-[820px] text-left">
<thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
<tr>
<th className="px-5 py-3">Siswa</th>
<th className="px-4 py-3">Identitas</th>
<th className="px-4 py-3">Kelas</th>
<th className="px-4 py-3">Wali murid</th>
<th className="px-4 py-3">Status data</th>
<th className="px-5 py-3 text-right">Aksi</th>
</tr>
</thead>
<tbody className="divide-y divide-slate-100">{visible.map((student)=>
<tr key={student.id} className="group hover:bg-slate-50/70">
<td className="px-5 py-4">
<div className="flex items-center gap-3">
<PrivateStudentPhoto
  user={user}
  photoKey={student.photoThumbnailKey??student.photoKey}
  alt={`Foto ${student.name}`}
  className="h-11 w-11 shrink-0 rounded-xl object-cover shadow-sm"
  fallback={<div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-100 to-sky-100 text-xs font-black text-teal-700">{student.name.split(" ").slice(0,2).map(v=>v[0]).join("")}</div>}
/>
<div>
<p className="text-sm font-extrabold text-slate-800">{student.name}</p>
<p className="mt-0.5 text-[10px] text-slate-400">Terdaftar · 2026</p>
</div>
</div>
</td>
<td className="px-4 py-4"><p className="text-xs font-black text-slate-800">NIS {student.nis}</p><p className="mt-1 text-[10px] font-bold text-slate-500">NISN {student.nisn||"-"}</p></td>
<td className="px-4 py-4">
<span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-extrabold text-sky-700">{student.className}</span>
</td>
<td className="px-4 py-4">
<p className="text-xs font-bold text-slate-700">{student.guardian||"Belum diisi"}</p>
<p className="mt-1 text-[10px] text-slate-400">{student.phone ? (whatsappHref(student.phone) ? <a href={whatsappHref(student.phone)} target="_blank" rel="noreferrer" className="font-black text-emerald-700 underline">WhatsApp</a> : "WhatsApp tidak valid") : "WhatsApp belum ada"}</p>
</td>
<td className="px-4 py-4">
{otherLocations[student.id]&&<p className="mb-1.5 rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-extrabold text-violet-700">Terdaftar juga: {otherLocations[student.id].scannedClassName} · {otherLocations[student.id].scannedSchoolName}</p>}
<span className={`inline-flex items-center gap-1.5 text-xs font-bold ${student.guardian?"text-emerald-600":"text-amber-600"}`}>
<span className={`h-1.5 w-1.5 rounded-full ${student.guardian?"bg-emerald-500":"bg-amber-500"}`}/>{student.guardian?"Lengkap":"Perlu dilengkapi"}</span>
</td>
<td className="px-5 py-4">
<div className="flex justify-end gap-1">
<button onClick={()=>{resetMobilePdfState();setQrStudent(student)}} title="Kartu QR" className="rounded-lg p-2 text-slate-400 hover:bg-teal-50 hover:text-teal-700">
<QrCode size={17}/>
</button>
<button onClick={()=>openEditStudent(student)} title="Edit" className="rounded-lg p-2 text-slate-400 hover:bg-sky-50 hover:text-sky-700">
<PencilLine size={17}/>
</button>
<button onClick={()=>removeStudent(student)} title="Hapus" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
<Trash2 size={17}/>
</button>
</div>
</td>
</tr>)}</tbody>
</table>
</div>{!visible.length&&<div className="py-16 text-center">
<Users className="mx-auto text-slate-300" size={36}/>
<p className="mt-3 text-sm font-bold text-slate-500">Siswa tidak ditemukan</p>
</div>}</section>
  {transferModal&&user&&<TransferStudentModal user={user} classes={classOptions} schoolName={schoolName} students={students} onClose={()=>setTransferModal(false)} setToast={setToast}/>}
  {modal&&<Modal title={editingStudent?"Edit data siswa":"Tambah siswa baru"} subtitle="Lengkapi identitas siswa dan data wali murid." onClose={closeStudentModal}>
<form onSubmit={saveStudent} className="space-y-4">
<div className="rounded-xl bg-slate-50 p-3 text-[11px] font-bold text-slate-500">Student ID dibuat otomatis oleh SMART-ATT dan menjadi isi QR Code.</div>
<div className="grid gap-4 sm:grid-cols-2"><Field label="NIS" value={form.nis} onChange={(v)=>setForm({...form,nis:v})} placeholder="Contoh: 20260101" required/><Field label="NISN" value={form.nisn} onChange={(v)=>setForm({...form,nisn:v})} placeholder="Nomor induk nasional" required/></div>
<Field label="Nama lengkap siswa" value={form.name} onChange={(v)=>setForm({...form,name:v})} placeholder="Nama siswa" required/>
<label className="block">
<span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>
<select value={form.className} onChange={(e)=>setForm({...form,className:e.target.value})} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none">{classOptions.length?classOptions.map((className)=>
<option key={className}>{className}</option>):<>
<option>V-A</option>
<option>V-B</option>
</>}</select>
</label>
<div className="grid gap-4 sm:grid-cols-2">
<Field label="Nama orang tua / wali" value={form.guardian} onChange={(v)=>setForm({...form,guardian:v})} placeholder="Nama orang tua"/>
<Field label="Nomor WhatsApp wali" value={form.phone} onChange={(v)=>setForm({...form,phone:v})} placeholder="62812..."/>
</div>
{editingStudent?.photoKey&&!photo&&<div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
  <PrivateStudentPhoto user={user} photoKey={editingStudent.photoThumbnailKey??editingStudent.photoKey} alt={`Foto ${editingStudent.name}`} className="h-16 w-14 shrink-0 rounded-xl object-cover shadow-sm" fallback={<div className="grid h-16 w-14 shrink-0 place-items-center rounded-xl bg-white text-slate-400"><Camera size={20}/></div>}/>
  <div><p className="text-xs font-extrabold">Foto siswa saat ini</p><p className="mt-1 text-[10px] text-slate-400">Pilih foto baru di bawah untuk mengganti foto.</p></div>
</div>}
<div>
  <p className="mb-2 text-xs font-extrabold text-slate-700">Foto siswa</p>
  <div className="grid grid-cols-2 gap-2 sm:gap-3">
    <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-center transition hover:border-teal-400 hover:bg-teal-50">
      <Upload size={21} className="text-teal-600"/>
      <span className="text-xs font-extrabold text-slate-800">Pilih dari galeri</span>
      <span className="text-[9px] leading-4 text-slate-400">HP atau komputer</span>
      <input disabled={photoProcessing} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event)=>{const selected=event.currentTarget.files?.[0]??null;event.currentTarget.value="";void choosePhoto(selected)}}/>
    </label>
    <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-teal-300 bg-teal-50 p-3 text-center transition hover:bg-teal-100">
      <Camera size={21} className="text-teal-700"/>
      <span className="text-xs font-extrabold text-teal-900">Ambil foto dari HP</span>
      <span className="text-[9px] leading-4 text-teal-700">Membuka kamera belakang</span>
      <input disabled={photoProcessing} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event)=>{const selected=event.currentTarget.files?.[0]??null;event.currentTarget.value="";void choosePhoto(selected)}}/>
    </label>
  </div>
  <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-500">{photoProcessing?<><Loader2 className="shrink-0 animate-spin text-teal-600" size={15}/>Memproses dan mengecilkan foto...</>:<><Camera className="shrink-0 text-teal-600" size={15}/>{photo?`${photo.name} siap di-crop.`:"JPG/PNG/WebP maks. 15 MB; otomatis resize dan tersimpan privat di R2."}</>}</div>
</div>
{photo&&<StudentPhotoCropper file={photo} onApply={(cropped,aspect)=>{setThumbnail(cropped);setPhotoAspect(aspect)}} setToast={setToast}/>} 
{thumbnail&&<p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700"><CheckCircle2 size={15}/>Thumbnail {photoAspect} siap disimpan · {Math.ceil(thumbnail.size/1024)} KB</p>}
<div className="flex justify-end gap-2 pt-2">
<button type="button" onClick={closeStudentModal} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-extrabold text-slate-600">Batal</button>
<button disabled={saving||photoProcessing} className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white disabled:opacity-60">{saving&&<Loader2 size={16} className="animate-spin"/>}{editingStudent?"Simpan perubahan":"Simpan siswa"}</button>
</div>
</form>
</Modal>}
  {guardianModal&&<Modal title="Link pendataan wali murid" subtitle="Satu link dapat dibagikan ke grup kelas." onClose={()=>setGuardianModal(false)}>
<div className="space-y-4">
<label className="block">
<span className="mb-2 block text-xs font-extrabold text-slate-700">Pilih kelas</span>
<select value={guardianClass} onChange={(e)=>{setGuardianClass(e.target.value);setGuardianLink("")}} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none">{classOptions.length?classOptions.map((className)=>
<option key={className}>{className}</option>):<option>V-A</option>}</select>
</label>
<div className="rounded-xl bg-teal-50 p-4 text-xs leading-5 text-teal-800">
<MessageCircle className="mr-1 inline" size={15}/>Wali memasukkan NIS. Setelah data cocok, wali mengisi nama serta nomor WhatsApp. Hasilnya otomatis masuk ke data siswa.</div>{guardianLink?<>
<label className="block">
<span className="mb-2 block text-xs font-extrabold text-slate-700">Link kelas {guardianClass}</span>
<div className="flex gap-2">
<input readOnly value={guardianLink} className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs"/>
<button onClick={()=>{void navigator.clipboard.writeText(guardianLink);setToast({message:"Link wali murid disalin.",tone:"success"})}} className="rounded-xl bg-slate-950 px-4 text-white">
<Copy size={17}/>
</button>
</div>
</label>
<a href={`https://wa.me/?text=${encodeURIComponent(`Mohon lengkapi data wali murid kelas ${guardianClass} melalui link SMART-ATT berikut: ${guardianLink}`)}`} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white">
<Send size={16}/>Bagikan ke WhatsApp</a>
</>:<button onClick={publishGuardianLink} disabled={publishingLink} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{publishingLink?<Loader2 className="animate-spin" size={17}/>:<Link2 size={17}/>}Buat link kelas</button>}</div>
</Modal>}
  {qrStudent&&<Modal title={isMobilePdf?"Generate PDF Student ID":"Print Preview Student ID"} subtitle={isMobilePdf?"PDF dibuat di server lalu link unduhan dikirim ke email akun guru.":"Pilih template, layout kertas, dan orientasi sebelum export PDF."} onClose={()=>{setQrStudent(null);resetMobilePdfState()}}>
    <PrintOptions cardTemplate={cardTemplate} setCardTemplate={setCardTemplate} printLayout={printLayout} setPrintLayout={setPrintLayout} printOrientation={printOrientation} setPrintOrientation={setPrintOrientation} selectedCount={1}/>
    {isMobilePdf?<div className="overflow-x-auto rounded-2xl bg-slate-100 p-4"><StudentQrCard student={qrStudent} schoolName={schoolName} academicYear={academicYear} user={user} schoolLogoKey={schoolLogoKey} template={cardTemplate}/></div>:<div className="qr-print-root"><div className={`qr-print-page qr-print-${printLayout} qr-print-${printOrientation} rounded-2xl bg-slate-100 p-4`}><StudentQrCard student={qrStudent} schoolName={schoolName} academicYear={academicYear} user={user} schoolLogoKey={schoolLogoKey} template={cardTemplate}/></div></div>}
    <div className="mt-4 rounded-xl bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-800">{isMobilePdf?<>Foto, logo, QR Code, dan data siswa akan di-embed di server. Link PDF dikirim ke <strong>{user?.email||"email akun guru"}</strong>.</>:<>Pratinjau sudah memakai ukuran dan desain kartu. Tekan Print untuk mencetak atau memilih Save as PDF.</>}</div>
    {isMobilePdf&&<MobilePdfProgress progress={mobilePdfProgress} message={mobilePdfMessage} error={mobilePdfError} generating={mobilePdfGenerating} email={mobilePdfEmail} downloadUrl={mobilePdfDownloadUrl}/>}
    <div className="mt-4">{isMobilePdf?<button disabled={mobilePdfGenerating||!user||demo} onClick={()=>void generateMobilePdf([qrStudent])} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{mobilePdfGenerating?<Loader2 className="animate-spin" size={17}/>:<FileDown size={17}/>} {mobilePdfError?"Coba Lagi":"Generate PDF"}</button>:<button onClick={printQrCards} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white"><Printer size={17}/> Print Kartu</button>}</div>
  </Modal>}
  {qrBatch&&<Modal title={isMobilePdf?"Generate PDF Student ID":"Print Preview Student ID"} subtitle={`${visible.length} siswa - ${Math.ceil(visible.length/(printLayout==="a4-12"?12:printLayout==="a4-10"?10:8))} halaman.`} onClose={()=>{setQrBatch(false);resetMobilePdfState()}}>
    <PrintOptions cardTemplate={cardTemplate} setCardTemplate={setCardTemplate} printLayout={printLayout} setPrintLayout={setPrintLayout} printOrientation={printOrientation} setPrintOrientation={setPrintOrientation} selectedCount={visible.length}/>
    <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">{isMobilePdf?<>Mode HP tidak memakai Android/iOS Print Service. PDF dibuat di server dan link unduhan dikirim ke <strong>{user?.email||"email akun guru"}</strong>.</>:<>Daftar mengikuti pencarian dan filter kelas yang sedang aktif. Tekan Print, lalu pilih printer atau <strong>Save as PDF</strong>. Aktifkan <strong>Background graphics</strong> agar warna desain ikut tersimpan.</>}</div>
    {isMobilePdf?<div className="overflow-x-auto rounded-2xl bg-slate-100 p-4"><StudentQrCard student={visible[0]} schoolName={schoolName} academicYear={academicYear} user={user} schoolLogoKey={schoolLogoKey} template={cardTemplate}/>{visible.length>1&&<p className="mt-3 text-center text-xs font-bold text-slate-500">Pratinjau kartu pertama · {visible.length-1} kartu lainnya dibuat di server</p>}</div>:<div className="qr-print-root max-h-[55vh] space-y-4 overflow-y-auto rounded-2xl bg-slate-100 p-4">
      {Array.from({length:Math.ceil(visible.length/(printLayout==="a4-12"?12:printLayout==="a4-10"?10:8))},(_,pageIndex)=>{const perPage=printLayout==="a4-12"?12:printLayout==="a4-10"?10:8;return <section key={pageIndex} className={`qr-print-page qr-print-${printLayout} qr-print-${printOrientation} grid gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-3`}>
        {visible.slice(pageIndex*perPage,pageIndex*perPage+perPage).map((student)=><StudentQrCard key={student.id} student={student} schoolName={schoolName} academicYear={academicYear} user={user} schoolLogoKey={schoolLogoKey} template={cardTemplate}/>)}</section>})}
    </div>}
    {isMobilePdf&&<MobilePdfProgress progress={mobilePdfProgress} message={mobilePdfMessage} error={mobilePdfError} generating={mobilePdfGenerating} email={mobilePdfEmail} downloadUrl={mobilePdfDownloadUrl}/>}
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {isMobilePdf?<button disabled={mobilePdfGenerating||!user||demo||!visible.length} onClick={()=>void generateMobilePdf(printStudents)} className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2">{mobilePdfGenerating?<Loader2 className="animate-spin" size={17}/>:<FileDown size={17}/>} {mobilePdfError?"Coba Lagi":`Generate PDF (${visible.length} Kartu)`}</button>:<button onClick={printQrCards} className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white sm:col-span-2"><Printer size={17}/> Print Semua Kartu</button>}
    </div>
  </Modal>}</>;
}
function Modal({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:React.ReactNode}) { return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"><div className="mobile-modal-panel max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6"><div className="mb-5 flex items-start justify-between gap-4 sm:mb-6"><div className="min-w-0"><h3 className="text-lg font-black sm:text-xl">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p></div><button onClick={onClose} aria-label="Tutup" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><X size={18}/></button></div>{children}</div></div> }

function MobilePdfProgress({progress,message,error,generating,email,downloadUrl}:{progress:number;message:string;error:string;generating:boolean;email:string;downloadUrl?:string}){
  if(!generating&&!message&&!error&&!email)return null;
  const complete=!generating&&!error&&progress>=100;
  return <div className={`mt-4 rounded-2xl border p-4 ${error?"border-rose-200 bg-rose-50":complete?"border-emerald-200 bg-emerald-50":"border-teal-200 bg-teal-50"}`}><div className="flex items-start gap-3">{generating?<Loader2 className="mt-0.5 shrink-0 animate-spin text-teal-600" size={20}/>:error?<XCircle className="mt-0.5 shrink-0 text-rose-600" size={20}/>:<CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20}/>}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className={`text-sm font-black ${error?"text-rose-900":complete?"text-emerald-900":"text-teal-900"}`}>{error||message}</p>{!error&&<span className="shrink-0 text-xs font-black text-teal-700">{progress}%</span>}</div>{email&&<p className="mt-1 break-all text-xs leading-5 text-emerald-700">Link unduhan dikirim ke <strong>{email}</strong> (cek Inbox & Spam).</p>}{complete&&downloadUrl&&<div className="mt-3"><a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-700"><Download size={15}/>Unduh PDF Kartu Pelajar Langsung</a></div>}{!error&&<div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full transition-all ${complete?"bg-emerald-600":"bg-teal-600"}`} style={{width:`${progress}%`}}/></div>}</div></div></div>;
}

function PrintOptions({ cardTemplate, setCardTemplate, printLayout, setPrintLayout, printOrientation, setPrintOrientation, selectedCount }: { cardTemplate: "photo" | "no-photo"; setCardTemplate: (value: "photo" | "no-photo") => void; printLayout: "single" | "a4-8" | "a4-10" | "a4-12"; setPrintLayout: (value: "single" | "a4-8" | "a4-10" | "a4-12") => void; printOrientation: "portrait" | "landscape"; setPrintOrientation: (value: "portrait" | "landscape") => void; selectedCount: number }) {
  const cardsPerPage = printLayout === "single" ? 1 : printLayout === "a4-12" ? 12 : printLayout === "a4-10" ? 10 : 8;
  return <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
    <label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">Template</span><select value={cardTemplate} onChange={(event)=>setCardTemplate(event.target.value as "photo"|"no-photo")} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><option value="photo">Card with Student Photo</option><option value="no-photo">Card without Student Photo</option></select></label>
    <label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">Paper layout</span><select value={printLayout} onChange={(event)=>{const value=event.target.value as "single"|"a4-8"|"a4-10";setPrintLayout(value);if(value==="a4-10")setPrintOrientation("portrait")}} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><option value="single">Single Card</option><option value="a4-8">A4 (8 cards)</option><option value="a4-10">A4 (10 cards)</option></select></label>
    <label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">Orientation</span><select value={printOrientation} onChange={(event)=>setPrintOrientation(event.target.value as "portrait"|"landscape")} disabled={printLayout==="a4-10"} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Total page</p><p className="mt-1 text-sm font-black text-slate-950">{Math.max(1, Math.ceil(selectedCount / cardsPerPage))} halaman</p></div>
  </div>;
}

function rupiah(value:number){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value||0)}
function todayKey(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}

function SavingsShareManager({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(toast:Toast)=>void}) {
  const [transactions,setTransactions]=useState<SavingsTransaction[]>([]);
  const [shareId,setShareId]=useState("");
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [resetStudentId,setResetStudentId]=useState("");

  useEffect(()=>{
    if(demo||!user)return;
    return onSnapshot(query(collection(db,"savingsTransactions"),where("ownerUid","==",user.uid)),(snapshot)=>{
      setTransactions(snapshot.docs.map((item)=>({id:item.id,...item.data()} as SavingsTransaction)));
    });
  },[demo,user]);

  useEffect(()=>{
    if(demo||!user)return;
    void Promise.all([getDoc(doc(db,"users",user.uid)),getDoc(doc(db,"users",user.uid,"settings","savingsShare"))]).then(([profile,settings])=>{
      const savedSchool=profile.data()?.schoolName;
      if(typeof savedSchool==="string"&&savedSchool.trim())setSchoolName(savedSchool.trim());
      const savedShare=settings.data()?.shareId;
      if(typeof savedShare==="string")setShareId(savedShare);
    }).catch(()=>undefined);
  },[demo,user]);

  const syncShare=useCallback(async(id:string) => {
    if(demo||!user)return;
    const token=await user.getIdToken();
    const response=await fetch("/api/storage/savings-share",{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        shareId:id,
        schoolName,
        students:students.map(({id:studentId,nis,nisn,name,className})=>({id:studentId,nis,nisn:nisn??"",name,className})),
        transactions:transactions.map(({id:transactionId,studentId,type,amount,transactionDate,note,officerName,status,createdAtMs})=>({id:transactionId,studentId,type,amount,transactionDate,note,officerName,status,createdAtMs})),
      }),
    });
    const body=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok)throw new Error(body.error||"Link belum dapat diperbarui");
  },[demo,user,schoolName,students,transactions]);

  useEffect(()=>{
    if(demo||!user||!shareId)return;
    const timer=setTimeout(()=>void syncShare(shareId).catch(()=>undefined),900);
    return()=>clearTimeout(timer);
  },[demo,user,shareId,syncShare]);

  async function publish() {
    if(demo){setShareId("demo-tabungan-siswa");setOpen(true);return;}
    if(!user)return;
    setBusy(true);
    try{
      const id=shareId||`tabungan-${crypto.randomUUID().replaceAll("-","").slice(0,24)}`;
      await syncShare(id);
      await setDoc(doc(db,"users",user.uid,"settings","savingsShare"),{shareId:id,published:true,updatedAt:serverTimestamp()},{merge:true});
      setShareId(id);setOpen(true);
      setToast({message:"Link Tabungan Siswa siap dibagikan.",tone:"success"});
    }catch(reason){setToast({message:reason instanceof Error?reason.message:"Link belum dapat dibuat.",tone:"error"});}
    finally{setBusy(false);}
  }

  async function resetPassword() {
    if(!resetStudentId||demo||!user)return;
    const student=students.find((item)=>item.id===resetStudentId);
    if(!confirm(`Reset password tabungan ${student?.name??"siswa"}? Sesi login lama akan langsung tidak berlaku.`))return;
    setBusy(true);
    try{
      const token=await user.getIdToken();
      const response=await fetch("/api/storage/savings-password-reset",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({studentId:resetStudentId})});
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(body.error||"Reset password gagal");
      setToast({message:`Password ${student?.name??"siswa"} berhasil di-reset.`,tone:"success"});setResetStudentId("");
    }catch(reason){setToast({message:reason instanceof Error?reason.message:"Reset password gagal.",tone:"error"});}
    finally{setBusy(false);}
  }

  const publicLink=typeof window==="undefined"?"":`${window.location.origin}/public/savings?share=${shareId}`;
  return <>
    <section className="mb-5 flex flex-col gap-4 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-sky-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-600 text-white"><Link2 size={19}/></div><div><p className="text-sm font-black">Link Tabungan Siswa</p><p className="mt-1 text-[11px] leading-4 text-slate-500">Orang tua melihat saldo dan transaksi melalui login NIS yang aman.</p></div></div>
      <button disabled={busy} onClick={()=>void publish()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={16}/>:<Link2 size={16}/>} {shareId?"Kelola link":"Buat link"}</button>
    </section>
    {open&&<div className="fixed inset-0 z-[80] grid place-items-end bg-slate-950/45 sm:place-items-center sm:p-5"><section className="w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Akses orang tua / siswa</p><h3 className="mt-1 text-xl font-black">Link Tabungan Siswa</h3><p className="mt-2 text-xs leading-5 text-slate-500">Pengguna masuk dengan NIS, lalu membuat password sendiri pada akses pertama.</p></div><button onClick={()=>setOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-500"><X size={17}/></button></div><div className="mt-5 flex gap-2"><input readOnly value={publicLink} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs"/><button onClick={()=>void navigator.clipboard.writeText(publicLink).then(()=>setToast({message:"Link disalin.",tone:"success"}))} className="rounded-xl bg-slate-950 px-4 text-white"><Copy size={16}/></button></div><a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Cek Tabungan Siswa SMART-ATT: ${publicLink}`)}`} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-black text-white"><MessageCircle size={16}/>Bagikan lewat WhatsApp</a><div className="mt-6 border-t border-slate-100 pt-5"><p className="text-xs font-black">Reset password siswa</p><p className="mt-1 text-[10px] leading-4 text-slate-400">Guru tidak dapat melihat password. Reset membuat pengguna harus membuat password baru.</p><div className="mt-3 flex gap-2"><select value={resetStudentId} onChange={(event)=>setResetStudentId(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><option value="">Pilih siswa</option>{students.map((student)=><option key={student.id} value={student.id}>{student.name} · {student.nis}</option>)}</select><button disabled={!resetStudentId||busy||demo} onClick={()=>void resetPassword()} className="rounded-xl border border-rose-200 px-4 text-xs font-black text-rose-700 disabled:opacity-40">Reset</button></div></div></section></div>}
  </>;
}

function SavingsView({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(toast:Toast)=>void}){
  const [transactions,setTransactions]=useState<SavingsTransaction[]>(demo?[{id:"demo-save-1",ownerUid:"demo",studentId:demoStudents[0].id,studentName:demoStudents[0].name,nis:demoStudents[0].nis,nisn:demoStudents[0].nisn,className:demoStudents[0].className,type:"deposit",amount:75000,transactionDate:todayKey(),note:"Setoran awal",officerName:"Admin Demo",status:"active",createdAtMs:Date.now()-3600000},{id:"demo-save-2",ownerUid:"demo",studentId:demoStudents[1].id,studentName:demoStudents[1].name,nis:demoStudents[1].nis,nisn:demoStudents[1].nisn,className:demoStudents[1].className,type:"withdrawal",amount:15000,transactionDate:todayKey(),note:"Ambil uang kegiatan",officerName:"Admin Demo",status:"active",createdAtMs:Date.now()-1800000}]:[]);
  const [form,setForm]=useState({type:"deposit" as "deposit"|"withdrawal",studentId:students[0]?.id??"",amount:"",transactionDate:todayKey(),note:"",officerName:user?.email??"Petugas"});
  const [filters,setFilters]=useState({studentId:"",from:"",to:""});
  const [saving,setSaving]=useState(false);
  const activeTransactions=transactions.filter((item)=>item.status!=="void");
  const balances=useMemo(()=>activeTransactions.reduce<Record<string,{balance:number;deposit:number;withdrawal:number}>>((result,item)=>{const row=result[item.studentId]??{balance:0,deposit:0,withdrawal:0};if(item.type==="deposit"){row.balance+=item.amount;row.deposit+=item.amount}else{row.balance-=item.amount;row.withdrawal+=item.amount}result[item.studentId]=row;return result},{}),[activeTransactions]);
  const selectedStudent=students.find((item)=>item.id===form.studentId);
  const visible=transactions.filter((item)=>(!filters.studentId||item.studentId===filters.studentId)&&(!filters.from||item.transactionDate>=filters.from)&&(!filters.to||item.transactionDate<=filters.to)).sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate)||b.createdAtMs-a.createdAtMs);
  const today=todayKey();
  const totalBalance=Object.values(balances).reduce((sum,item)=>sum+item.balance,0);
  const todayDeposit=activeTransactions.filter((item)=>item.transactionDate===today&&item.type==="deposit").reduce((sum,item)=>sum+item.amount,0);
  const todayWithdrawal=activeTransactions.filter((item)=>item.transactionDate===today&&item.type==="withdrawal").reduce((sum,item)=>sum+item.amount,0);
  const chartRows=Array.from(new Set(activeTransactions.map((item)=>item.transactionDate))).sort().slice(-7).map((date)=>({date,deposit:activeTransactions.filter((item)=>item.transactionDate===date&&item.type==="deposit").reduce((sum,item)=>sum+item.amount,0),withdrawal:activeTransactions.filter((item)=>item.transactionDate===date&&item.type==="withdrawal").reduce((sum,item)=>sum+item.amount,0)}));
  const maxChart=Math.max(1,...chartRows.flatMap((item)=>[item.deposit,item.withdrawal]));
  useEffect(()=>{setForm((current)=>students.some((student)=>student.id===current.studentId)?current:{...current,studentId:students[0]?.id??""})},[students]);
  useEffect(()=>{if(demo||!user)return;return onSnapshot(query(collection(db,"savingsTransactions"),where("ownerUid","==",user.uid)),(snapshot)=>setTransactions(snapshot.docs.map((item)=>({id:item.id,...item.data()} as SavingsTransaction)).sort((a,b)=>b.createdAtMs-a.createdAtMs)),()=>setToast({message:"Data tabungan belum dapat dimuat.",tone:"error"}))},[demo,user,setToast]);
  async function submit(event:React.FormEvent){event.preventDefault();if(!selectedStudent)return;const amount=Number(form.amount);if(!Number.isFinite(amount)||amount<=0){setToast({message:"Nominal harus lebih dari 0.",tone:"error"});return;}const currentBalance=balances[selectedStudent.id]?.balance??0;if(form.type==="withdrawal"&&amount>currentBalance){setToast({message:"Penarikan ditolak karena saldo tidak cukup.",tone:"error"});return;}setSaving(true);try{const payload:Omit<SavingsTransaction,"id">={ownerUid:user?.uid??"demo",studentId:selectedStudent.id,studentName:selectedStudent.name,nis:selectedStudent.nis,nisn:selectedStudent.nisn??"",className:selectedStudent.className,type:form.type,amount,transactionDate:form.transactionDate,note:form.note.trim(),officerName:form.officerName.trim()||user?.email||"Petugas",status:"active",createdAtMs:Date.now(),updatedAtMs:Date.now()};if(demo||!user)setTransactions((items)=>[{...payload,id:crypto.randomUUID()},...items]);else await addDoc(collection(db,"savingsTransactions"),{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});setForm((current)=>({...current,amount:"",note:""}));setToast({message:form.type==="deposit"?"Setoran tabungan tersimpan.":"Penarikan tabungan tersimpan.",tone:"success"});}catch(error){setToast({message:error instanceof Error?error.message:"Transaksi tabungan gagal disimpan.",tone:"error"});}finally{setSaving(false)}}
  async function voidTransaction(item:SavingsTransaction){const reason=prompt("Alasan pembatalan transaksi:");if(!reason?.trim())return;try{if(demo)setTransactions((rows)=>rows.map((row)=>row.id===item.id?{...row,status:"void",voidReason:reason.trim(),updatedAtMs:Date.now()}:row));else await updateDoc(doc(db,"savingsTransactions",item.id),{status:"void",voidReason:reason.trim(),updatedAtMs:Date.now(),updatedAt:serverTimestamp(),voidedBy:user?.uid??""});setToast({message:"Transaksi dibatalkan tanpa dihapus permanen.",tone:"success"});}catch{setToast({message:"Transaksi belum dapat dibatalkan.",tone:"error"});}}
  function exportExcel(){const rows=[["Tanggal","Siswa","Student ID","NIS","NISN","Kelas","Jenis","Nominal","Status","Petugas","Keterangan"],...visible.map((item)=>[item.transactionDate,item.studentName,item.studentId,item.nis,item.nisn??"",item.className,item.type==="deposit"?"Setoran":"Penarikan",String(item.amount),item.status,item.officerName,item.note])];const csv=rows.map((row)=>row.map((cell)=>`"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="riwayat-tabungan-smart-att.csv";link.click();URL.revokeObjectURL(url)}
  async function exportPdf(){const {jsPDF}=await import("jspdf");const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});pdf.setFont("helvetica","bold");pdf.setFontSize(14);pdf.text("Riwayat Tabungan Siswa",12,14);pdf.setFontSize(9);pdf.setFont("helvetica","normal");pdf.text(`Total saldo: ${rupiah(totalBalance)}`,12,21);let y=30;pdf.setFont("helvetica","bold");["Tanggal","Siswa","Jenis","Nominal","Status","Petugas"].forEach((head,index)=>pdf.text(head,[12,42,102,130,158,184][index],y));pdf.setFont("helvetica","normal");visible.slice(0,32).forEach((item)=>{y+=7;if(y>190){pdf.addPage("a4","landscape");y=18;}pdf.text(item.transactionDate,12,y);pdf.text(String((pdf.splitTextToSize(item.studentName,55) as string[])[0]??""),42,y);pdf.text(item.type==="deposit"?"Setoran":"Penarikan",102,y);pdf.text(rupiah(item.amount),130,y);pdf.text(item.status,158,y);pdf.text(String((pdf.splitTextToSize(item.officerName,45) as string[])[0]??""),184,y);});pdf.save("riwayat-tabungan-smart-att.pdf");}
  return <><SectionHeading eyebrow="Administrasi" title="Tabungan siswa" description="Catat setoran, penarikan, saldo, dan audit transaksi tanpa penghapusan permanen." action={<div className="flex flex-wrap gap-2"><button onClick={exportExcel} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-700"><FileDown size={16}/>Export Excel</button><button onClick={()=>void exportPdf()} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><Download size={16}/>Export PDF</button></div>}/><div className="mb-5 grid gap-4 md:grid-cols-3"><StatCard label="Total saldo siswa" value={rupiah(totalBalance)} note={`${students.length} siswa terdaftar`} icon={Wallet} tone="bg-teal-50 text-teal-600"/><StatCard label="Setoran hari ini" value={rupiah(todayDeposit)} note={today} icon={Banknote} tone="bg-emerald-50 text-emerald-600"/><StatCard label="Penarikan hari ini" value={rupiah(todayWithdrawal)} note={today} icon={Download} tone="bg-amber-50 text-amber-600"/></div><div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Input transaksi</h3><form onSubmit={submit} className="mt-4 space-y-4"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>setForm({...form,type:"deposit"})} className={`rounded-xl px-4 py-3 text-xs font-black ${form.type==="deposit"?"bg-emerald-600 text-white":"bg-slate-100 text-slate-600"}`}>Setoran</button><button type="button" onClick={()=>setForm({...form,type:"withdrawal"})} className={`rounded-xl px-4 py-3 text-xs font-black ${form.type==="withdrawal"?"bg-amber-600 text-white":"bg-slate-100 text-slate-600"}`}>Penarikan</button></div><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Siswa</span><select value={form.studentId} onChange={(event)=>setForm({...form,studentId:event.target.value})} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Pilih siswa</option>{students.map((student)=><option key={student.id} value={student.id}>{student.name} - {student.nis}</option>)}</select></label>{selectedStudent&&<div className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">Saldo {selectedStudent.name}: <span className="text-slate-950">{rupiah(balances[selectedStudent.id]?.balance??0)}</span></div>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Nominal" type="number" value={form.amount} onChange={(value)=>setForm({...form,amount:value})} placeholder="50000" required/><Field label="Tanggal" type="date" value={form.transactionDate} onChange={(value)=>setForm({...form,transactionDate:value})} required/></div><Field label="Petugas" value={form.officerName} onChange={(value)=>setForm({...form,officerName:value})} required/><Field label="Keterangan" value={form.note} onChange={(value)=>setForm({...form,note:value})} placeholder="Contoh: setoran mingguan"/><button disabled={saving||!selectedStudent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{saving&&<Loader2 className="animate-spin" size={17}/>}Simpan transaksi</button></form></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Grafik transaksi</h3><div className="mt-5 space-y-3">{chartRows.length?chartRows.map((row)=><div key={row.date}><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-400"><span>{row.date}</span><span>{rupiah(row.deposit-row.withdrawal)}</span></div><div className="grid grid-cols-2 gap-2"><div className="h-3 overflow-hidden rounded-full bg-emerald-50"><div className="h-full rounded-full bg-emerald-500" style={{width:`${Math.max(4,row.deposit/maxChart*100)}%`}}/></div><div className="h-3 overflow-hidden rounded-full bg-amber-50"><div className="h-full rounded-full bg-amber-500" style={{width:`${Math.max(4,row.withdrawal/maxChart*100)}%`}}/></div></div></div>):<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada transaksi.</p>}</div></section></div><section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-3"><select value={filters.studentId} onChange={(event)=>setFilters({...filters,studentId:event.target.value})} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><option value="">Semua siswa</option>{students.map((student)=><option key={student.id} value={student.id}>{student.name}</option>)}</select><input type="date" value={filters.from} onChange={(event)=>setFilters({...filters,from:event.target.value})} className="h-11 rounded-xl border border-slate-200 px-3 text-xs font-bold"/><input type="date" value={filters.to} onChange={(event)=>setFilters({...filters,to:event.target.value})} className="h-11 rounded-xl border border-slate-200 px-3 text-xs font-bold"/></div><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Tanggal</th><th className="px-4 py-3">Siswa</th><th className="px-4 py-3">Jenis</th><th className="px-4 py-3">Nominal</th><th className="px-4 py-3">Petugas</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Audit</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((item)=><tr key={item.id}><td className="px-5 py-4 text-xs font-bold">{item.transactionDate}</td><td className="px-4 py-4"><p className="text-sm font-black">{item.studentName}</p><p className="text-[10px] text-slate-400"> · NIS {item.nis} · NISN {item.nisn||"-"}</p></td><td className="px-4 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${item.type==="deposit"?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700"}`}>{item.type==="deposit"?"Setoran":"Penarikan"}</span></td><td className="px-4 py-4 text-sm font-black">{rupiah(item.amount)}</td><td className="px-4 py-4 text-xs font-bold text-slate-600">{item.officerName}</td><td className="px-4 py-4 text-xs font-black">{item.status==="void"?"Dibatalkan":"Aktif"}</td><td className="px-5 py-4 text-right">{item.status==="active"?<button onClick={()=>void voidTransaction(item)} className="rounded-lg border border-amber-200 px-3 py-2 text-[11px] font-black text-amber-700">Batalkan</button>:<span className="text-[10px] font-bold text-slate-400">{item.voidReason||"Audit tersimpan"}</span>}</td></tr>)}</tbody></table></div>{!visible.length&&<div className="py-12 text-center text-sm font-bold text-slate-400">Belum ada transaksi sesuai filter.</div>}</section></>;
}

function LegacyScannerView({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void}) {
  const videoRef=useRef<HTMLVideoElement>(null); const streamRef=useRef<MediaStream|null>(null); const timerRef=useRef<ReturnType<typeof setInterval>|null>(null); const [active,setActive]=useState(false); const [manual,setManual]=useState(""); const [last,setLast]=useState<Student|null>(null);
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  useEffect(()=>{if(demo||!user)return;void getDoc(doc(db,"users",user.uid)).then((snapshot)=>{const value=snapshot.data()?.schoolName;if(typeof value==="string"&&value.trim())setSchoolName(value.trim())});},[demo,user]);
  function record(student:Student){setLast(student);setToast({message:`${student.name} tercatat hadir pukul ${new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}.`,tone:"success"});}
  function processValue(raw:string){try{const parsed=JSON.parse(raw);const found=students.find(s=>s.id===parsed.studentId||s.nis===parsed.nis);if(found)record(found);else throw new Error();}catch{const found=students.find(s=>s.nis===raw.trim());if(found)record(found);else setToast({message:"QR/NIS siswa tidak ditemukan.",tone:"error"});}}
  async function start(){try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}setActive(true);const Detector=(window as unknown as {BarcodeDetector?:new(o:{formats:string[]})=>{detect:(source:HTMLVideoElement)=>Promise<{rawValue:string}[]>}}).BarcodeDetector;if(Detector){const detector=new Detector({formats:["qr_code"]});timerRef.current=setInterval(async()=>{if(!videoRef.current)return;const codes=await detector.detect(videoRef.current).catch(()=>[]);if(codes[0]?.rawValue){processValue(codes[0].rawValue);stop();}},700);}}catch{setToast({message:"Kamera tidak dapat dibuka. Izinkan akses kamera atau gunakan input NIS.",tone:"error"});}}
  function stop(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;if(timerRef.current)clearInterval(timerRef.current);setActive(false);}
  useEffect(()=>stop,[]);
  return <>
<SectionHeading eyebrow="Absensi QR" title="Scan kehadiran siswa" description="Arahkan kamera ke kartu QR. Status hadir/terlambat dihitung dari jam masuk 07:00."/>
<div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
<section className="overflow-hidden rounded-3xl bg-slate-950 p-4 shadow-xl sm:p-6">
<div className="relative aspect-video overflow-hidden rounded-2xl bg-[#071d21]">
<video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${active?"block":"hidden"}`}/>{!active&&<div className="absolute inset-0 grid place-items-center text-center">
<div>
<div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-teal-300/20 bg-teal-300/10 text-teal-300">
<ScanLine size={38}/>
</div>
<p className="mt-5 text-lg font-black text-white">Kamera belum aktif</p>
<p className="mt-2 text-xs text-slate-400">Pastikan pencahayaan cukup dan QR terlihat utuh.</p>
</div>
</div>}<div className="pointer-events-none absolute inset-8 rounded-3xl border border-dashed border-white/25">
<span className="absolute -left-px -top-px h-10 w-10 rounded-tl-2xl border-l-4 border-t-4 border-teal-400"/>
<span className="absolute -right-px -top-px h-10 w-10 rounded-tr-2xl border-r-4 border-t-4 border-teal-400"/>
<span className="absolute -bottom-px -left-px h-10 w-10 rounded-bl-2xl border-b-4 border-l-4 border-teal-400"/>
<span className="absolute -bottom-px -right-px h-10 w-10 rounded-br-2xl border-b-4 border-r-4 border-teal-400"/>
</div>
</div>
<button onClick={active?stop:start} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold ${active?"bg-rose-500 text-white":"bg-teal-400 text-slate-950"}`}>{active?<>
<X size={18}/>Matikan kamera</>:<>
<Camera size={18}/>Aktifkan kamera</>}</button>
</section>
<div className="space-y-5">
<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
<h3 className="font-black">Input NIS manual</h3>
<p className="mt-1 text-xs text-slate-400">Gunakan jika QR rusak atau kamera tidak tersedia.</p>
<div className="mt-4 flex gap-2">
<input value={manual} onChange={(e)=>setManual(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')processValue(manual)}} placeholder="Masukkan NIS" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
<button onClick={()=>processValue(manual)} className="rounded-xl bg-slate-950 px-4 text-xs font-extrabold text-white">Catat</button>
</div>
</section>{last?<><section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
  <div className="flex items-center gap-3 bg-[#07363b] px-4 py-3 text-white">
    <img src="/logo.png" alt="Logo SMART-ATT" className="h-11 w-11 rounded-xl object-cover"/>
    <div><p className="text-sm font-black">SMART-ATT</p><p className="text-[10px] text-teal-100">Tahun Ajaran 2026/2027</p></div>
  </div>
  <div className="p-4">
    <PrivateStudentPhoto user={user} photoKey={last.photoKey} alt={`Foto asli ${last.name}`} className="mx-auto aspect-[3/4] max-h-72 w-full rounded-2xl object-contain" fallback={<div className="mx-auto grid aspect-[3/4] max-h-72 w-full place-items-center rounded-2xl bg-slate-100 text-slate-400"><CircleUserRound size={58}/></div>}/>
    <div className="mt-4 text-center"><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">{schoolName}</p><h3 className="mt-1 text-lg font-black text-slate-950">{last.name}</h3><p className="mt-1 text-xs font-bold text-slate-500">Kelas {last.className}</p></div>
  </div>
</section><section className="hidden">
<div className="flex items-center gap-3">
<div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-600 text-white">
<Check size={24}/>
</div>
<div>
<p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Berhasil tercatat</p>
<h3 className="font-black text-emerald-950">{last.name}</h3>
<p className="text-xs text-emerald-700">{last.nis} · {last.className} · Hadir</p>
</div>
</div>
</section></>:<section className="rounded-2xl border border-slate-200 bg-white p-5">
<p className="text-sm font-bold text-slate-500">Hasil scan terakhir akan muncul di sini.</p>
</section>}<section className="rounded-2xl border border-slate-200 bg-white p-5">
<div className="flex justify-between">
<span className="text-xs font-bold text-slate-500">Ter-scan hari ini</span>
<strong>28 / 32</strong>
</div>
<div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
<div className="h-full w-[87.5%] rounded-full bg-teal-500"/>
</div>
</section>
</div>
</div>
</>;
}

function ScannerView({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void}) {
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const sessionRef=useRef<AbsensiSession|null>(null);
  const studentsRef=useRef(students);
  const classes=useMemo(()=>Array.from(new Set(students.map((student)=>student.className).filter(Boolean))).sort(),[students]);
  const [selectedClass,setSelectedClass]=useState(classes[0]??"");
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  const [session,setSession]=useState<AbsensiSession|null>(null);
  const [active,setActive]=useState(false);
  const [manual,setManual]=useState("");
  const [last,setLast]=useState<Student|null>(null);
  const [starting,setStarting]=useState(false);
  const [closing,setClosing]=useState(false);
  const [sharingId,setSharingId]=useState("");

  useEffect(()=>{studentsRef.current=students},[students]);
  useEffect(()=>{sessionRef.current=session},[session]);
  useEffect(()=>{if(!selectedClass&&classes[0])setSelectedClass(classes[0])},[classes,selectedClass]);
  useEffect(()=>{if(demo||!user)return;void getDoc(doc(db,"users",user.uid)).then((snapshot)=>{const value=snapshot.data()?.schoolName;if(typeof value==="string"&&value.trim())setSchoolName(value.trim())});},[demo,user]);
  useEffect(()=>{
    if(demo||!user)return;
    return onSnapshot(collection(db,"users",user.uid,"attendanceSessions"),(snapshot)=>{
      const sessions=snapshot.docs.filter((item)=>item.data().deleted!==true).map((item)=>({id:item.id,...item.data(),records:item.data().records??{}} as AbsensiSession)).sort((a,b)=>b.startedAtMs-a.startedAtMs);
      const latest=sessions.find((item)=>item.status==="open")??sessions[0]??null;
      setSession(latest);
      if(latest?.className)setSelectedClass(latest.className);
    },()=>setToast({message:"Sesi absensi belum dapat dimuat.",tone:"error"}));
  },[demo,user,setToast]);

  function stopCamera(){streamRef.current?.getTracks().forEach((track)=>track.stop());streamRef.current=null;if(timerRef.current)clearInterval(timerRef.current);timerRef.current=null;setActive(false)}
  useEffect(()=>()=>stopCamera(),[]);

  async function record(student:Student,source:"qr"|"manual"){
    const current=sessionRef.current;
    if(!current||current.status!=="open"){setToast({message:"Klik Mulai Absen terlebih dahulu.",tone:"error"});return;}
    if(student.className!==current.className){setToast({message:`${student.name} terdaftar di kelas ${student.className}, bukan ${current.className}.`,tone:"error"});return;}
    if(current.records[student.id]?.status==="present"){setLast(student);setToast({message:`${student.name} sudah tercatat hadir.`,tone:"error"});return;}
    const attendanceRecord:AbsensiRecord={studentId:student.id,status:"present",source,recordedAtMs:Date.now()};
    const nextSession={...current,records:{...current.records,[student.id]:attendanceRecord}};
    setSession(nextSession);sessionRef.current=nextSession;setLast(student);setManual("");
    try{
      if(!demo&&user)await updateDoc(doc(db,"users",user.uid,"attendanceSessions",current.id),{[`records.${student.id}`]:attendanceRecord,updatedAt:serverTimestamp()});
      setToast({message:`${student.name} tercatat hadir pukul ${new Date(attendanceRecord.recordedAtMs).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}.`,tone:"success"});
    }catch{setToast({message:"Kehadiran belum dapat disimpan. Periksa koneksi.",tone:"error"});}
  }

  async function processValue(raw:string,source:"qr"|"manual"){
    const input=raw.trim();
    if(!input){setToast({message:"Masukkan NIS terlebih dahulu.",tone:"error"});return;}
    if(!studentsRef.current.length){setToast({message:"Data siswa Firestore masih dimuat. Tunggu sebentar lalu coba lagi.",tone:"error"});return;}
    const found=findStudentByQrOrNis(studentsRef.current,input);
    if(!found){setToast({message:`NIS ${input} tidak ditemukan pada ${studentsRef.current.length} data siswa Firestore.`,tone:"error"});return;}
    await record(found,source);
  }

  async function startCamera(){
    if(sessionRef.current?.status!=="open"){setToast({message:"Klik Mulai Absen sebelum membuka kamera.",tone:"error"});return;}
    try{
      stopCamera();
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}
      setActive(true);
      const Detector=(window as unknown as {BarcodeDetector?:new(options:{formats:string[]})=>{detect:(source:HTMLVideoElement)=>Promise<{rawValue:string}[]>}}).BarcodeDetector;
      if(Detector){
        const detector=new Detector({formats:["qr_code"]});
        timerRef.current=setInterval(async()=>{if(!videoRef.current)return;const codes=await detector.detect(videoRef.current).catch(()=>[]);if(codes[0]?.rawValue){await processValue(codes[0].rawValue,"qr");stopCamera()}},700);
      }
    }catch{setToast({message:"Kamera tidak dapat dibuka. Izinkan kamera atau gunakan input NIS manual.",tone:"error"});}
  }

  async function beginSession(){
    if(!selectedClass){setToast({message:"Pilih kelas terlebih dahulu.",tone:"error"});return;}
    if(session?.status==="open"){setToast({message:"Masih ada sesi absensi yang aktif.",tone:"error"});return;}
    setStarting(true);
    try{
      const startedAtMs=Date.now();
      const payload={className:selectedClass,schoolName,status:"open" as const,startedAtMs,records:{},createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
      let id=crypto.randomUUID();
      if(!demo&&user){const reference=await addDoc(collection(db,"users",user.uid,"attendanceSessions"),payload);id=reference.id}
      const nextSession:AbsensiSession={id,className:selectedClass,schoolName,status:"open",startedAtMs,records:{}};
      setSession(nextSession);sessionRef.current=nextSession;setLast(null);
      setToast({message:`Absensi ${selectedClass} dimulai pukul ${new Date(startedAtMs).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}.`,tone:"success"});
      await startCamera();
    }catch{setToast({message:"Sesi absensi belum dapat dimulai.",tone:"error"});}
    finally{setStarting(false)}
  }

  async function closeSession(){
    const current=sessionRef.current;
    if(!current||current.status!=="open")return;
    if(!confirm(`Tutup absensi kelas ${current.className}? Siswa yang belum tercatat akan tetap masuk daftar belum absen.`))return;
    setClosing(true);stopCamera();
    try{
      const closedAtMs=Date.now();
      if(!demo&&user)await updateDoc(doc(db,"users",user.uid,"attendanceSessions",current.id),{status:"closed",closedAtMs,closedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      const next={...current,status:"closed" as const,closedAtMs};setSession(next);sessionRef.current=next;
      setToast({message:`Absensi ${current.className} ditutup.`,tone:"success"});
    }catch{setToast({message:"Sesi absensi belum dapat ditutup.",tone:"error"});}
    finally{setClosing(false)}
  }

  async function sendAbsenceWhatsapp(student:Student){
    const current=sessionRef.current;
    if(!current){setToast({message:"Belum ada sesi absensi.",tone:"error"});return;}
    const phone=(student.phone??"").replace(/\D/g,"").replace(/^0/,"62");
    if(phone.length<10){setToast({message:`Nomor WhatsApp wali ${student.name} belum lengkap.`,tone:"error"});return;}
    setSharingId(student.id);
    const popup=window.open("about:blank","_blank");
    try{
      const snapshotId=demo?`demo-${student.id}`:`absence-${user?.uid}-${current.id}-${student.id}`;
      const dateLabel=new Intl.DateTimeFormat("id-ID",{dateStyle:"full"}).format(new Date(current.startedAtMs));
      if(!demo&&user)await setDoc(doc(db,"publicSnapshots",snapshotId),{type:"absence",ownerUid:user.uid,sessionId:current.id,published:true,schoolName,dateLabel,student:{id:student.id,nis:student.nis,name:student.name,className:student.className},updatedAt:serverTimestamp()},{merge:true});
      const confirmationLink=`${window.location.origin}/public/absence/${encodeURIComponent(snapshotId)}`;
      const message=`Yth. Bapak/Ibu ${student.guardian||"wali murid"}, ${student.name} belum tercatat hadir pada absensi ${dateLabel}. Mohon konfirmasi apakah Sakit atau Izin beserta keterangannya melalui link SMART-ATT berikut: ${confirmationLink}`;
      const whatsappUrl=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if(popup){popup.opener=null;popup.location.href=whatsappUrl}else window.location.assign(whatsappUrl);
      setToast({message:`Link konfirmasi untuk ${student.name} dibuka di WhatsApp.`,tone:"success"});
    }catch{popup?.close();setToast({message:"Link konfirmasi belum dapat dibuat.",tone:"error"});}
    finally{setSharingId("")}
  }

  const sessionStudents=students.filter((student)=>student.className===(session?.className??selectedClass));
  const records=session?.records??{};
  const presentCount=sessionStudents.filter((student)=>records[student.id]?.status==="present").length;
  const sickCount=sessionStudents.filter((student)=>records[student.id]?.status==="sick").length;
  const permissionCount=sessionStudents.filter((student)=>records[student.id]?.status==="permission").length;
  const absentStudents=sessionStudents.filter((student)=>!records[student.id]);
  const sessionTime=session?new Date(session.startedAtMs).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}):"—";

  return <>
    <SectionHeading eyebrow="Absensi QR" title="Scan kehadiran siswa" description="Mulai satu sesi, scan QR atau masukkan NIS, tindak lanjuti siswa yang belum hadir, lalu tutup absensi."/>
    <section className="mb-6 rounded-3xl bg-[#07363b] p-5 text-white shadow-xl sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-teal-300">Sesi absensi</p><h3 className="mt-2 text-2xl font-black">{session?.status==="open"?`Sedang berlangsung · ${session.className}`:session?`Terakhir · ${session.className}`:"Belum dimulai"}</h3><p className="mt-2 text-xs text-slate-300">{session?`Mulai pukul ${sessionTime} · ${session.status==="open"?"Tidak ada jam pulang":"Sesi sudah ditutup"}`:"Pilih kelas, lalu waktu mulai akan dicatat otomatis."}</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select disabled={session?.status==="open"} value={selectedClass} onChange={(event)=>setSelectedClass(event.target.value)} className="h-12 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-bold text-white outline-none disabled:opacity-60">{classes.map((className)=><option key={className} value={className} className="text-slate-950">{className}</option>)}</select>
          {session?.status==="open"?<button disabled={closing} onClick={()=>void closeSession()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-rose-500 px-5 text-sm font-extrabold text-white disabled:opacity-60">{closing?<Loader2 className="animate-spin" size={17}/>:<LockKeyhole size={17}/>}Tutup absen</button>:<button disabled={starting||!selectedClass} onClick={()=>void beginSession()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-300 px-5 text-sm font-extrabold text-slate-950 disabled:opacity-60">{starting?<Loader2 className="animate-spin" size={17}/>:<ScanLine size={17}/>}Mulai absen</button>}
        </div>
      </div>
    </section>

    {session&&<div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Hadir",presentCount,"bg-emerald-50 text-emerald-700"],["Sakit",sickCount,"bg-sky-50 text-sky-700"],["Izin",permissionCount,"bg-violet-50 text-violet-700"],["Belum absen",absentStudents.length,"bg-rose-50 text-rose-700"]].map(([label,value,tone])=><div key={String(label)} className={`rounded-2xl p-4 ${tone}`}><p className="text-[10px] font-black uppercase tracking-wider">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>)}</div>}

    {session?.status==="open"&&<div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-4 shadow-xl sm:p-6">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#071d21]"><video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${active?"block":"hidden"}`}/>{!active&&<div className="absolute inset-0 grid place-items-center text-center"><div><Camera className="mx-auto text-teal-300" size={42}/><p className="mt-4 font-black text-white">Kamera siap dibuka</p><p className="mt-2 text-xs text-slate-400">Gunakan kamera belakang HP untuk memindai QR.</p></div></div>}<div className="pointer-events-none absolute inset-8 rounded-3xl border border-dashed border-white/25"/></div>
        <button onClick={active?stopCamera:()=>void startCamera()} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold ${active?"bg-rose-500 text-white":"bg-teal-300 text-slate-950"}`}>{active?<><X size={17}/>Matikan kamera</>:<><Camera size={17}/>Buka kamera</>}</button>
      </section>
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Input NIS manual</h3><p className="mt-1 text-xs text-slate-400">Dipakai jika kartu QR rusak atau kamera tidak tersedia.</p><div className="mt-4 flex gap-2"><input value={manual} onChange={(event)=>setManual(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void processValue(manual,"manual")}} placeholder="Masukkan NIS" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/><button disabled={!manual.trim()} onClick={()=>void processValue(manual,"manual")} className="rounded-xl bg-slate-950 px-4 text-xs font-extrabold text-white disabled:opacity-40">Catat</button></div></section>
        {last?<section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm"><div className="flex items-center gap-3 bg-[#07363b] px-4 py-3 text-white"><img src="/logo.png" alt="Logo SMART-ATT" className="h-11 w-11 rounded-xl object-cover"/><div><p className="text-sm font-black">SMART-ATT</p><p className="text-[10px] text-teal-100">Tahun Ajaran 2026/2027</p></div></div><div className="p-4"><PrivateStudentPhoto user={user} photoKey={last.photoKey} alt={`Foto asli ${last.name}`} className="mx-auto aspect-[3/4] max-h-64 w-full rounded-2xl object-contain" fallback={<div className="mx-auto grid aspect-[3/4] max-h-64 w-full place-items-center rounded-2xl bg-slate-100 text-slate-400"><CircleUserRound size={58}/></div>}/><div className="mt-4 text-center"><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">{schoolName}</p><h3 className="mt-1 text-lg font-black">{last.name}</h3><p className="mt-1 text-xs font-bold text-slate-500">Kelas {last.className}</p><button onClick={()=>{setLast(null);void startCamera()}} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white">OK, lanjut scan</button></div></div></section>:<section className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-bold text-slate-500">Foto dan identitas siswa akan tampil setelah QR/NIS berhasil dicatat.</p></section>}
      </div>
    </div>}

    {session&&<section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h3 className="font-black">Siswa belum absen</h3><p className="mt-1 text-xs text-slate-400">Kirim link ke wali agar memilih Sakit atau Izin dan menuliskan alasannya.</p></div><span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">{absentStudents.length} siswa</span></div>
      <div className="divide-y divide-slate-100">{absentStudents.map((student)=><div key={student.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><PrivateStudentPhoto user={user} photoKey={student.photoThumbnailKey??student.photoKey} alt={`Foto ${student.name}`} className="h-11 w-11 rounded-xl object-cover" fallback={<div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-xs font-black text-slate-500">{student.name.split(" ").slice(0,2).map((part)=>part[0]).join("")}</div>}/><div><p className="text-sm font-extrabold">{student.name}</p><p className="mt-1 text-[10px] text-slate-400">NIS {student.nis} · Wali: {student.guardian||"belum diisi"}</p></div></div><button disabled={sharingId===student.id||!student.phone} onClick={()=>void sendAbsenceWhatsapp(student)} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-500">{sharingId===student.id?<Loader2 className="animate-spin" size={15}/>:<MessageCircle size={15}/>} {student.phone?"Kirim konfirmasi WA":"No. WA belum ada"}</button></div>)}{!absentStudents.length&&<div className="py-12 text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={38}/><p className="mt-3 text-sm font-black text-emerald-700">Semua siswa sudah memiliki status kehadiran.</p></div>}</div>
    </section>}
  </>;
}

function AbsensiView({students}:{students:Student[]}){return <><SectionHeading eyebrow="Laporan" title="Rekap absensi" description="Pantau kehadiran per hari, minggu, semester, atau tahun." action={<button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold"><FileDown size={16}/>Ekspor Excel</button>}/><div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Hadir','28','text-emerald-600'],['Terlambat','2','text-amber-600'],['Sakit','1','text-sky-600'],['Izin','0','text-violet-600'],['Tanpa keterangan','1','text-rose-600']].map(([label,value,color])=><div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p></div>)}</div><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="flex gap-2"><button className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white">Harian</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Mingguan</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">6 Bulan</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Tahunan</button></div><button className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><CalendarDays size={15}/>13 Juli 2026</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Kelas</th><th className="px-4 py-3">Jam scan</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Keterangan</th></tr></thead><tbody className="divide-y divide-slate-100">{students.slice(0,5).map((s,i)=><tr key={s.id}><td className="px-5 py-4 text-sm font-extrabold">{s.name}<p className="text-[10px] font-normal text-slate-400">NIS {s.nis}</p></td><td className="px-4 py-4 text-xs font-bold">{s.className}</td><td className="px-4 py-4 text-xs text-slate-500">{i===4?'—':`06:${47+i*4}`}</td><td className="px-4 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${i===3?'bg-amber-50 text-amber-700':i===4?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700'}`}>{i===3?'Terlambat':i===4?'Belum hadir':'Hadir'}</span></td><td className="px-5 py-4 text-xs text-slate-400">{i===3?'Terlambat 3 menit':i===4?<a className="font-bold text-teal-700" href={`https://wa.me/${s.phone}?text=${encodeURIComponent('Mohon konfirmasi ketidakhadiran melalui tautan SMART-ATT.')}`}>Kirim konfirmasi WA</a>:'—'}</td></tr>)}</tbody></table></div></section></>}

function taskDeadlineLabel(deadline: string) {
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "Tenggat belum diatur";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function taskVisualStatus(task: TaskRecord): { key: "active" | "draft" | "expired"; label: string; tone: string } {
  if (!task.published) return { key: "draft", label: "Draf", tone: "bg-slate-100 text-slate-600" };
  if (new Date(task.deadline).getTime() < Date.now()) return { key: "expired", label: "Lewat tenggat", tone: "bg-rose-50 text-rose-700" };
  return { key: "active", label: "Aktif", tone: "bg-emerald-50 text-emerald-700" };
}

function TasksView({ user, demo, students, activeSession, setToast }: { user: User | null; demo: boolean; students: Student[]; activeSession: ActiveTeachingSession; setToast: (t: Toast) => void }) {
  const classes = useMemo(() => Array.from(new Set(students.map((student) => student.className).filter(Boolean))).sort(), [students]);
  const blankForm = (): TaskForm => ({ subject: activeSession.subjectName || "", className: activeSession.className || classes[0] || "", title: "", description: "", deadline: "", published: true });
  const [tasks, setTasks] = useState<TaskRecord[]>(demo ? demoTasks : []);
  const [form, setForm] = useState<TaskForm>(blankForm);
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "draft" | "expired">("all");
  const [loading, setLoading] = useState(!demo);
  const [saving, setSaving] = useState(false);
  const [teacherName, setTeacherName] = useState(demo ? "Tomi Guru" : "Guru");
  const teacherSyncRef = useRef("");

  useEffect(() => {
    if (demo) { setTeacherName("Tomi Guru"); return; }
    if (!user) { setTeacherName("Guru"); return; }
    void getDoc(doc(db, "users", user.uid)).then((profile) => {
      const savedName = profile.exists() && typeof profile.data().name === "string" ? profile.data().name.trim() : "";
      setTeacherName(savedName || user.displayName?.trim() || "Guru");
    }).catch(() => setTeacherName(user.displayName?.trim() || "Guru"));
  }, [user, demo]);

  useEffect(() => {
    if (demo) { setTasks(demoTasks); setLoading(false); return; }
    if (!user) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    return onSnapshot(collection(db, "users", user.uid, "tasks"), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as TaskRecord));
      next.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setTasks(next);
      setLoading(false);
    }, () => { setLoading(false); setToast({ message: "Data tugas belum dapat dibaca.", tone: "error" }); });
  }, [user, demo, setToast]);

  useEffect(() => {
    if (demo || !user || teacherName === "Guru" || tasks.length === 0) return;
    const syncKey = `${user.uid}:${teacherName}`;
    if (teacherSyncRef.current === syncKey) return;
    teacherSyncRef.current = syncKey;
    const batch = writeBatch(db);
    for (const task of tasks.slice(0, 200)) {
      batch.update(doc(db, "users", user.uid, "tasks", task.id), { teacherName, updatedAt: serverTimestamp() });
      if (task.snapshotId) batch.update(doc(db, "publicSnapshots", task.snapshotId), { teacherName, updatedAt: serverTimestamp() });
    }
    void batch.commit().catch(() => { teacherSyncRef.current = ""; });
  }, [tasks, teacherName, user, demo]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm());
    setOpen(true);
  }

  function openEdit(task: TaskRecord) {
    setEditing(task);
    setForm({ subject: task.subject, className: task.className, title: task.title, description: task.description, deadline: task.deadline.slice(0, 16), published: task.published });
    setOpen(true);
  }

  function snapshotPayload(taskId: string, value: TaskForm) {
    return {
      type: "task",
      ownerUid: user?.uid ?? "demo",
      taskId,
      published: value.published,
      subject: value.subject.trim(),
      className: value.className.trim(),
      title: value.title.trim(),
      description: value.description.trim(),
      deadline: value.deadline,
      teacherName,
      updatedAt: serverTimestamp(),
    };
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    const clean: TaskForm = { ...form, subject: form.subject.trim(), className: form.className.trim(), title: form.title.trim(), description: form.description.trim() };
    if (!clean.subject || !clean.className || !clean.title || !clean.description || !clean.deadline) { setToast({ message: "Lengkapi semua informasi tugas.", tone: "error" }); return; }
    if (Number.isNaN(new Date(clean.deadline).getTime())) { setToast({ message: "Tenggat waktu tidak valid.", tone: "error" }); return; }
    setSaving(true);
    try {
      if (demo || !user) {
        if (editing) setTasks((current) => current.map((item) => item.id === editing.id ? { ...item, ...clean, snapshotId: clean.published ? (item.snapshotId ?? `demo-${item.id}`) : item.snapshotId } : item));
        else setTasks((current) => [{ id: crypto.randomUUID(), ...clean, snapshotId: clean.published ? `demo-${crypto.randomUUID()}` : undefined, teacherName: "Tomi Guru" }, ...current]);
      } else {
        const batch = writeBatch(db);
        const taskRef = editing ? doc(db, "users", user.uid, "tasks", editing.id) : doc(collection(db, "users", user.uid, "tasks"));
        const snapshotRef = clean.published ? (editing?.snapshotId ? doc(db, "publicSnapshots", editing.snapshotId) : doc(collection(db, "publicSnapshots"))) : null;
        const data = { ...clean, ownerUid: user.uid, teacherName, updatedAt: serverTimestamp() };
        if (editing) batch.update(taskRef, { ...data, ...(snapshotRef ? { snapshotId: snapshotRef.id } : {}) });
        else batch.set(taskRef, { ...data, ...(snapshotRef ? { snapshotId: snapshotRef.id } : {}), createdAt: serverTimestamp() });
        if (snapshotRef) batch.set(snapshotRef, snapshotPayload(taskRef.id, clean), { merge: true });
        if (!clean.published && editing?.snapshotId) batch.update(doc(db, "publicSnapshots", editing.snapshotId), { published: false, updatedAt: serverTimestamp() });
        await batch.commit();
      }
      setOpen(false);
      setToast({ message: editing ? "Tugas berhasil diperbarui." : (clean.published ? "Tugas disimpan dan dipublikasikan." : "Draf tugas berhasil disimpan."), tone: "success" });
    } catch { setToast({ message: "Tugas gagal disimpan. Silakan coba lagi.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function togglePublish(task: TaskRecord) {
    const nextPublished = !task.published;
    try {
      if (demo || !user) {
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, published: nextPublished, snapshotId: nextPublished ? (item.snapshotId ?? `demo-${item.id}`) : item.snapshotId } : item));
      } else {
        const batch = writeBatch(db);
        const taskRef = doc(db, "users", user.uid, "tasks", task.id);
        const snapshotRef = task.snapshotId ? doc(db, "publicSnapshots", task.snapshotId) : (nextPublished ? doc(collection(db, "publicSnapshots")) : null);
        batch.update(taskRef, { published: nextPublished, ...(snapshotRef ? { snapshotId: snapshotRef.id } : {}), updatedAt: serverTimestamp() });
        if (nextPublished && snapshotRef) batch.set(snapshotRef, snapshotPayload(task.id, { subject: task.subject, className: task.className, title: task.title, description: task.description, deadline: task.deadline, published: true }), { merge: true });
        else if (snapshotRef) batch.update(snapshotRef, { published: false, updatedAt: serverTimestamp() });
        await batch.commit();
      }
      setToast({ message: nextPublished ? "Tugas dipublikasikan." : "Publikasi tugas dinonaktifkan.", tone: "success" });
    } catch { setToast({ message: "Status publikasi gagal diubah.", tone: "error" }); }
  }

  async function removeTask(task: TaskRecord) {
    if (!window.confirm(`Hapus tugas “${task.title}”? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      if (demo || !user) setTasks((current) => current.filter((item) => item.id !== task.id));
      else {
        const batch = writeBatch(db);
        batch.delete(doc(db, "users", user.uid, "tasks", task.id));
        if (task.snapshotId) batch.delete(doc(db, "publicSnapshots", task.snapshotId));
        await batch.commit();
      }
      setToast({ message: "Tugas berhasil dihapus.", tone: "success" });
    } catch { setToast({ message: "Tugas gagal dihapus.", tone: "error" }); }
  }

  async function copyLink(task: TaskRecord) {
    if (!task.published || !task.snapshotId) { setToast({ message: "Publikasikan tugas sebelum menyalin link.", tone: "error" }); return; }
    try { await navigator.clipboard.writeText(`${location.origin}/public/task/${encodeURIComponent(task.snapshotId)}`); setToast({ message: "Link tugas berhasil disalin.", tone: "success" }); }
    catch { setToast({ message: "Link tidak dapat disalin otomatis.", tone: "error" }); }
  }

  const counts = tasks.reduce((result, task) => { result[taskVisualStatus(task).key] += 1; return result; }, { active: 0, draft: 0, expired: 0 } as Record<"active" | "draft" | "expired", number>);
  const visibleTasks = tasks.filter((task) => filter === "all" || taskVisualStatus(task).key === filter);

  return <>
    <SectionHeading eyebrow="Pembelajaran" title="Tugas & PR" description="Buat, publikasikan, dan kelola tugas kelas melalui satu link publik." action={<button onClick={openCreate} className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><Plus size={17}/>Buat tugas</button>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><StatCard label="Tugas aktif" value={String(counts.active)} note="Dapat dibuka siswa" icon={Send} tone="bg-emerald-50 text-emerald-600"/><StatCard label="Draf" value={String(counts.draft)} note="Belum dipublikasikan" icon={FileText} tone="bg-slate-100 text-slate-600"/><StatCard label="Lewat tenggat" value={String(counts.expired)} note="Link masih tersimpan" icon={Clock3} tone="bg-rose-50 text-rose-600"/></div>
    <div className="mb-5 flex flex-wrap gap-2">{([['all','Semua'],['active','Aktif'],['draft','Draf'],['expired','Lewat tenggat']] as const).map(([key,label])=><button key={key} onClick={()=>setFilter(key)} className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${filter===key?'bg-slate-950 text-white':'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{label}</button>)}</div>
    {loading ? <div className="grid min-h-52 place-items-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={30}/></div> : visibleTasks.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700"><BookOpen size={25}/></div><h3 className="mt-4 font-black">Belum ada tugas pada kategori ini</h3><p className="mt-1 text-sm text-slate-500">Buat tugas pertama lalu bagikan link kepada siswa.</p><button onClick={openCreate} className="mt-5 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white">Buat tugas</button></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleTasks.map((task)=>{const status=taskVisualStatus(task);return <article key={task.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><span className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[10px] font-black text-violet-700">{task.subject}</span><span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${status.tone}`}>{status.label}</span></div><h3 className="mt-5 text-lg font-black leading-snug">{task.title}</h3><p className="mt-3 line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-slate-500">{task.description}</p><div className="my-5 h-px bg-slate-100"/><div className="flex items-center justify-between gap-3 text-xs"><span className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold text-slate-600">{task.className}</span><span className="flex items-center gap-1 text-right text-slate-400"><Clock3 size={13}/>{taskDeadlineLabel(task.deadline)}</span></div><div className="mt-auto flex flex-wrap gap-2 pt-5">{task.published?<button onClick={()=>void copyLink(task)} className="flex min-w-[8rem] flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-xs font-extrabold text-white"><Link2 size={14}/>Salin link</button>:<button onClick={()=>void togglePublish(task)} className="flex min-w-[8rem] flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 py-2.5 text-xs font-extrabold text-white"><Send size={14}/>Publikasikan</button>}<button onClick={()=>openEdit(task)} title="Edit tugas" className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"><PencilLine size={15}/></button><button onClick={()=>void togglePublish(task)} title={task.published?'Nonaktifkan link':'Publikasikan'} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50">{task.published?<XCircle size={15}/>:<CheckCircle2 size={15}/>}</button><button onClick={()=>void removeTask(task)} title="Hapus tugas" className="rounded-xl border border-rose-100 p-2.5 text-rose-500 hover:bg-rose-50"><Trash2 size={15}/></button></div></article>})}</div>}
    {open&&<Modal title={editing?"Edit tugas":"Buat tugas baru"} subtitle="Simpan sebagai draf atau publikasikan agar dapat dibuka siswa." onClose={()=>!saving&&setOpen(false)}><form onSubmit={saveTask} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Mata pelajaran" value={form.subject} onChange={(subject)=>setForm((current)=>({...current,subject}))} placeholder="Contoh: Matematika" required/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>{classes.length?<select required value={form.className} onChange={(event)=>setForm((current)=>({...current,className:event.target.value}))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-teal-500">{classes.map((className)=><option key={className}>{className}</option>)}</select>:<input required value={form.className} onChange={(event)=>setForm((current)=>({...current,className:event.target.value}))} placeholder="Contoh: V-A" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/>}</label></div><Field label="Judul tugas" value={form.title} onChange={(title)=>setForm((current)=>({...current,title}))} placeholder="Contoh: Latihan aljabar" required/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Deskripsi / instruksi</span><textarea required value={form.description} onChange={(event)=>setForm((current)=>({...current,description:event.target.value}))} className="min-h-32 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" placeholder="Tuliskan materi, nomor soal, dan petunjuk pengerjaan..."/></label><Field label="Tenggat waktu" type="datetime-local" value={form.deadline} onChange={(deadline)=>setForm((current)=>({...current,deadline}))} required/><label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><input type="checkbox" checked={form.published} onChange={(event)=>setForm((current)=>({...current,published:event.target.checked}))} className="mt-0.5 h-4 w-4 accent-teal-600"/><span><span className="block text-sm font-extrabold">Publikasikan sekarang</span><span className="mt-1 block text-xs leading-5 text-slate-500">Siswa dapat membuka tugas tanpa login melalui link publik.</span></span></label><div className="flex gap-3"><button type="button" disabled={saving} onClick={()=>setOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-extrabold text-slate-600">Batal</button><button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{saving&&<Loader2 className="animate-spin" size={17}/>}Simpan tugas</button></div></form></Modal>}
  </>;
}

export function ExamsViewWithManual({user,demo,students,setToast,scope,allowedClassNames,allowedSubjectNames}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void;scope?:WorkspaceScope;allowedClassNames?:string[];allowedSubjectNames?:string[]}){
  const [manualOpen,setManualOpen]=useState(false); const [aiOpen,setAiOpen]=useState(false);
  return <><div className="mb-4 flex flex-wrap justify-end gap-2"><button onClick={()=>setAiOpen((value)=>!value)} className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-extrabold text-violet-700"><Sparkles size={16}/>{aiOpen?"Tutup Generator AI":"Buat soal dengan AI"}</button><button onClick={()=>setManualOpen(true)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-xs font-extrabold text-white shadow-lg shadow-teal-600/15"><PencilLine size={16}/>Buat soal manual</button></div>{aiOpen&&<section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-3"><AiGenerator user={user} demo={demo} setToast={setToast} scope={scope} allowedClassNames={allowedClassNames} allowedSubjectNames={allowedSubjectNames}/></section>}<ExamsViewAdvanced user={user} demo={demo} students={students} setToast={setToast} scope={scope} allowedClassNames={allowedClassNames}/>{manualOpen&&<ManualExamModal user={user} demo={demo} students={students} setToast={setToast} scope={scope} onClose={()=>setManualOpen(false)}/>}</>;
}

function ManualExamModal({user,demo,students,setToast,scope,onClose}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void;scope?:WorkspaceScope;onClose:()=>void}){
  const dataScope:WorkspaceScope|null=scope??(user?{root:"users",id:user.uid}:null);
  const classes=useMemo(()=>Array.from(new Set(students.map((student)=>student.className).filter(Boolean))).sort(),[students]);
  const emptyQuestion=():QuizQuestion=>({question:"",choices:["","","",""],answerIndex:0,explanation:""});
  const [title,setTitle]=useState("");
  const [subject,setSubject]=useState("");
  const [className,setClassName]=useState(classes[0]??"");
  const [chapter,setChapter]=useState("");
  const [duration,setDuration]=useState("60");
  const [questions,setQuestions]=useState<QuizQuestion[]>([]);
  const [draft,setDraft]=useState<QuizQuestion>(emptyQuestion);
  const [editingIndex,setEditingIndex]=useState<number|null>(null);
  const [saving,setSaving]=useState(false);

  function updateChoice(index:number,value:string){setDraft((current)=>({...current,choices:current.choices.map((choice,choiceIndex)=>choiceIndex===index?value:choice)}));}

  function saveQuestion(){
    const clean:QuizQuestion={question:draft.question.trim(),choices:draft.choices.map((choice)=>choice.trim()),answerIndex:draft.answerIndex,explanation:draft.explanation.trim()};
    if(!clean.question||clean.choices.some((choice)=>!choice)){setToast({message:"Lengkapi pertanyaan dan seluruh pilihan jawaban.",tone:"error"});return;}
    if(new Set(clean.choices.map((choice)=>choice.toLowerCase())).size!==clean.choices.length){setToast({message:"Setiap pilihan jawaban harus berbeda.",tone:"error"});return;}
    if(editingIndex===null)setQuestions((current)=>[...current,clean]);
    else setQuestions((current)=>current.map((question,index)=>index===editingIndex?clean:question));
    setDraft(emptyQuestion());setEditingIndex(null);setToast({message:editingIndex===null?"Butir soal ditambahkan.":"Butir soal diperbarui.",tone:"success"});
  }

  function editQuestion(index:number){setDraft({...questions[index],choices:[...questions[index].choices]});setEditingIndex(index);}
  function removeQuestion(index:number){setQuestions((current)=>current.filter((_,questionIndex)=>questionIndex!==index));if(editingIndex===index){setDraft(emptyQuestion());setEditingIndex(null);}}

  async function saveExam(){
    if(!title.trim()||!subject.trim()||!className.trim()){setToast({message:"Lengkapi judul, mata pelajaran, dan kelas.",tone:"error"});return;}
    if(!questions.length){setToast({message:"Tambahkan minimal satu butir soal.",tone:"error"});return;}
    setSaving(true);
    try{
      if(!demo&&user&&dataScope)await addDoc(workspaceCollection(dataScope,"exams"),{title:title.trim(),subject:subject.trim(),className:className.trim(),chapter:chapter.trim(),durationMinutes:Math.max(1,Math.min(300,Number(duration)||60)),questions,status:"draft",source:"manual",createdByUid:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      else if(!demo)throw new Error("Sesi login tidak tersedia");
      setToast({message:`Draf manual dengan ${questions.length} soal berhasil disimpan.`,tone:"success"});onClose();
    }catch{setToast({message:"Draf soal manual gagal disimpan.",tone:"error"});}
    finally{setSaving(false);}
  }

  return <Modal title="Buat soal manual" subtitle="Tambahkan soal satu per satu, tentukan kunci, lalu simpan sebagai draf." onClose={onClose}><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Judul ulangan" value={title} onChange={setTitle} placeholder="Contoh: Ulangan Harian Bab 1" required/><Field label="Mata pelajaran" value={subject} onChange={setSubject} placeholder="Matematika" required/></div><div className="grid gap-4 sm:grid-cols-3"><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>{classes.length?<select value={className} onChange={(event)=>setClassName(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500">{classes.map((item)=><option key={item}>{item}</option>)}</select>:<input value={className} onChange={(event)=>setClassName(event.target.value)} placeholder="V-A" className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>}</label><Field label="Bab / materi" value={chapter} onChange={setChapter} placeholder="Materi ujian"/><Field label="Durasi (menit)" type="number" value={duration} onChange={setDuration}/></div><div className="my-5 border-t border-slate-100"/><div className="rounded-2xl bg-slate-50 p-4"><div className="mb-4 flex items-center justify-between"><div><h4 className="text-sm font-black">{editingIndex===null?`Soal ${questions.length+1}`:`Edit soal ${editingIndex+1}`}</h4><p className="mt-1 text-[10px] text-slate-400">Pilih satu jawaban yang benar.</p></div>{editingIndex!==null&&<button onClick={()=>{setDraft(emptyQuestion());setEditingIndex(null)}} className="text-xs font-bold text-slate-500">Batal edit</button>}</div><label className="block"><span className="mb-2 block text-xs font-extrabold">Pertanyaan</span><textarea value={draft.question} onChange={(event)=>setDraft((current)=>({...current,question:event.target.value}))} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-500" placeholder="Tuliskan pertanyaan..."/></label><div className="mt-4 grid gap-3 sm:grid-cols-2">{draft.choices.map((choice,index)=><label key={index} className={`flex items-center gap-2 rounded-xl border p-2 ${draft.answerIndex===index?'border-emerald-300 bg-emerald-50':'border-slate-200 bg-white'}`}><input type="radio" name="correct-answer" checked={draft.answerIndex===index} onChange={()=>setDraft((current)=>({...current,answerIndex:index}))} className="accent-emerald-600"/><span className="text-xs font-black text-slate-500">{String.fromCharCode(65+index)}</span><input value={choice} onChange={(event)=>updateChoice(index,event.target.value)} placeholder={`Pilihan ${String.fromCharCode(65+index)}`} className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"/></label>)}</div><label className="mt-4 block"><span className="mb-2 block text-xs font-extrabold">Pembahasan (opsional)</span><textarea value={draft.explanation} onChange={(event)=>setDraft((current)=>({...current,explanation:event.target.value}))} className="min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-500" placeholder="Jelaskan alasan jawaban yang benar..."/></label><button type="button" onClick={saveQuestion} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-xs font-extrabold text-white"><Plus size={15}/>{editingIndex===null?'Tambahkan soal':'Simpan perubahan soal'}</button></div>{questions.length>0&&<div><h4 className="mb-3 text-sm font-black">Daftar soal · {questions.length} butir</h4><div className="max-h-56 space-y-2 overflow-y-auto pr-1">{questions.map((question,index)=><div key={`${index}-${question.question}`} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-50 text-xs font-black text-teal-700">{index+1}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-bold leading-5">{question.question}</p><p className="mt-1 text-[10px] text-emerald-600">Kunci {String.fromCharCode(65+question.answerIndex)} · {question.choices[question.answerIndex]}</p></div><button onClick={()=>editQuestion(index)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><PencilLine size={14}/></button><button onClick={()=>removeQuestion(index)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={14}/></button></div>)}</div></div>}<div className="flex gap-3 border-t border-slate-100 pt-4"><button disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-extrabold text-slate-600">Batal</button><button disabled={saving||!questions.length} onClick={()=>void saveExam()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white disabled:opacity-40">{saving?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Simpan sebagai draf</button></div></div></Modal>;
}

function ExamsViewAdvanced({user,demo,students,setToast,scope,allowedClassNames}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void;scope?:WorkspaceScope;allowedClassNames?:string[]}){
  const dataScope:WorkspaceScope|null=scope??(user?{root:"users",id:user.uid}:null);
  const sampleExam:ExamRecord={id:"demo-exam",title:"Kuis Matematika — Persamaan Linear",subject:"Matematika",className:"V-A",chapter:"Persamaan linear",status:"draft",source:"ai",durationMinutes:60,questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}]};
  const [exams,setExams]=useState<ExamRecord[]>(demo?[sampleExam]:[]);
  const [attempts,setAttempts]=useState<QuizAttempt[]>([]);
  const [loading,setLoading]=useState(!demo);
  const [review,setReview]=useState<ExamRecord|null>(null);
  const [monitor,setMonitor]=useState<ExamRecord|null>(null);
const [durationMinutes,setDurationMinutes]=useState("60");
  const [scheduleDate,setScheduleDate]=useState(()=>{const date=new Date(Date.now()+300000);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`});
  const [scheduleTime,setScheduleTime]=useState(()=>new Date(Date.now()+300000).toTimeString().slice(0,5));
  const [busyId,setBusyId]=useState("");
  const reloginSeenRef=useRef<Record<string,number>>({});

  useEffect(()=>{
    if(demo){setExams([sampleExam]);setLoading(false);return;}
    if(!user||!dataScope){setExams([]);setLoading(false);return;}
    setLoading(true);
    const applyDocuments=(documents:QueryDocumentSnapshot<DocumentData>[])=>{
      const next=documents.map((item)=>({id:item.id,...item.data()} as ExamRecord));
      next.sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
      setExams(next);setLoading(false);
    };
    const fail=()=>{setLoading(false);setToast({message:"Data ulangan belum dapat dibaca.",tone:"error"});};
    if(dataScope.root!=="schools"||!allowedClassNames)return onSnapshot(workspaceCollection(dataScope,"exams"),(snapshot)=>applyDocuments(snapshot.docs),fail);
    if(!allowedClassNames.length){applyDocuments([]);return;}
    const groups=new Map<string,QueryDocumentSnapshot<DocumentData>[]>();
    const stops=allowedClassNames.map((className)=>onSnapshot(query(workspaceCollection(dataScope,"exams"),where("className","==",className)),(snapshot)=>{groups.set(className,snapshot.docs);applyDocuments(Array.from(groups.values()).flat())},fail));
    return()=>stops.forEach((stop)=>stop());
  },[user,demo,setToast,dataScope?.root,dataScope?.id,allowedClassNames?.join("\u0001")]);

  useEffect(()=>{
    if(demo||!user){setAttempts([]);return;}
    const attemptsQuery=query(collection(db,"publicQuizAttempts"),where(dataScope?.root==="schools"&&!allowedClassNames?"schoolId":"ownerUid","==",dataScope?.root==="schools"&&!allowedClassNames?dataScope.id:user.uid));
    return onSnapshot(attemptsQuery,(snapshot)=>{
      const next=snapshot.docs.map((item)=>({id:item.id,...item.data()} as QuizAttempt));
      const hadPrevious=Object.keys(reloginSeenRef.current).length>0;
      for(const attempt of next){
        const count=attempt.reloginCount??0;
        if(hadPrevious&&count>(reloginSeenRef.current[attempt.id]??0))setToast({message:`${attempt.studentName} login ulang dan melanjutkan ujian.`,tone:"success"});
      }
      reloginSeenRef.current=Object.fromEntries(next.map((attempt)=>[attempt.id,attempt.reloginCount??0]));
      setAttempts(next);
    },()=>setToast({message:"Monitoring ujian belum dapat dibaca.",tone:"error"}));
  },[user,demo,setToast,dataScope?.root,dataScope?.id]);

  function targetStudents(exam:ExamRecord){
    if(exam.status!=="published"&&exam.status!=="finished")return students.filter((student)=>student.className===exam.className);
    const participantIds=new Set(attempts.filter((attempt)=>attempt.examId===exam.id).map((attempt)=>attempt.studentId));
    return students.filter((student)=>participantIds.has(student.id));
  }

  async function existingQuizAccessCode(exam:ExamRecord){
    const fromExam=normalizeQuizAccessCode(exam.accessCode);
    if(fromExam)return fromExam;
    if(!exam.snapshotId)return "";
    try{
      const snapshot=await getDoc(doc(db,"publicSnapshots",exam.snapshotId));
      return normalizeQuizAccessCode(snapshot.data()?.accessCode);
    }catch{return "";}
  }

  async function ensureQuizAccessCode(exam:ExamRecord){
    if(demo)return "DEMO";
    if(!user||!dataScope||!exam.snapshotId)throw new Error("quiz-snapshot-unavailable");
    const snapshotRef=doc(db,"publicSnapshots",exam.snapshotId);
    let preferred=await existingQuizAccessCode(exam);
    for(let attempt=0;attempt<8;attempt+=1){
      const candidate=preferred||generateQuizAccessCode();
      const codeRef=doc(db,"publicLinkCodes",candidate);
      try{
        await runTransaction(db,async(transaction)=>{
          const codeDocument=await transaction.get(codeRef);
          if(codeDocument.exists()&&codeDocument.data().snapshotId!==snapshotRef.id)throw new Error("quiz-access-code-collision");
          transaction.update(workspaceDoc(dataScope,"exams",exam.id),{accessCode:candidate,updatedAt:serverTimestamp()});
          transaction.update(snapshotRef,{accessCode:candidate,updatedAt:serverTimestamp()});
          transaction.set(codeRef,{code:candidate,type:"quiz",snapshotId:snapshotRef.id,ownerUid:user.uid,...(dataScope.root==="schools"?{schoolId:dataScope.id}:{}),published:true,updatedAt:serverTimestamp()},{merge:true});
        });
        setExams((current)=>current.map((item)=>item.id===exam.id?{...item,accessCode:candidate}:item));
        return candidate;
      }catch(reason){
        if(reason instanceof Error&&reason.message==="quiz-access-code-collision"){preferred="";continue;}
        throw reason;
      }
    }
    throw new Error("quiz-access-code-exhausted");
  }

  async function publishExam(exam:ExamRecord){
    if(!exam.questions?.length){setToast({message:"Ulangan belum memiliki soal.",tone:"error"});return;}
    const duration=Math.max(1,Math.min(300,Number(durationMinutes)||60));
    const startAtMs=new Date(`${scheduleDate}T${scheduleTime}:00`).getTime();
    if(!Number.isFinite(startAtMs)){setToast({message:"Tanggal atau jam ujian tidak valid.",tone:"error"});return;}
    const endAtMs=startAtMs+duration*60000;
    const status:ExamRecord["status"]=startAtMs>Date.now()?"scheduled":"published";
    const participants=students.filter((student)=>student.className===exam.className);
    setBusyId(exam.id);
    try{
      if(demo||!user||!dataScope){setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status,snapshotId:"demo",accessCode:"DEMO",durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:undefined}:item));setReview(null);setToast({message:status==="scheduled"?"Ulangan demo berhasil dijadwalkan.":"Ulangan demo sudah online.",tone:"success"});return;}
      const snapshotRef=exam.snapshotId?doc(db,"publicSnapshots",exam.snapshotId):doc(collection(db,"publicSnapshots"));
      let preferred=await existingQuizAccessCode(exam);
      let accessCode="";
      for(let attempt=0;attempt<8;attempt+=1){
        const candidate=preferred||generateQuizAccessCode();
        const codeRef=doc(db,"publicLinkCodes",candidate);
        try{
          await runTransaction(db,async(transaction)=>{
            const codeDocument=await transaction.get(codeRef);
            if(codeDocument.exists()&&codeDocument.data().snapshotId!==snapshotRef.id)throw new Error("quiz-access-code-collision");
            const publicQuestions = (exam.questions ?? []).map(({ answerIndex: _a, explanation: _e, ...q }) => q);
            transaction.update(workspaceDoc(dataScope,"exams",exam.id),{status,snapshotId:snapshotRef.id,accessCode:candidate,durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:deleteField(),updatedAt:serverTimestamp()});
            transaction.set(snapshotRef,{type:"quiz",ownerUid:user.uid,...(dataScope.root==="schools"?{schoolId:dataScope.id}:{ }),examId:exam.id,accessCode:candidate,published:true,title:exam.title,subjectId:exam.subjectId??"",subject:exam.subject,className:exam.className,chapter:exam.chapter??"",gradeCategory:exam.gradeCategory??"summative",assessmentType:exam.assessmentType??"daily_test",questions:publicQuestions,durationMinutes:duration,startAtMs,endAtMs,startAt:new Date(startAtMs),endAt:new Date(endAtMs),students:participants.map(({id,nis,name,className})=>({id,nis,name,className})),updatedAt:serverTimestamp()},{merge:true});
            transaction.set(codeRef,{code:candidate,type:"quiz",snapshotId:snapshotRef.id,ownerUid:user.uid,...(dataScope.root==="schools"?{schoolId:dataScope.id}:{}),published:true,updatedAt:serverTimestamp()},{merge:true});
          });
          accessCode=candidate;break;
        }catch(reason){
          if(reason instanceof Error&&reason.message==="quiz-access-code-collision"){preferred="";continue;}
          throw reason;
        }
      }
      if(!accessCode)throw new Error("quiz-access-code-exhausted");
      setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status,snapshotId:snapshotRef.id,accessCode,durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:undefined}:item));setReview(null);setToast({message:status==="scheduled"?`Ulangan dijadwalkan. Kode siswa: ${accessCode}`:`Ulangan online. Kode siswa: ${accessCode}`,tone:"success"});
    }catch{setToast({message:"Ulangan gagal dipublikasikan.",tone:"error"});}
    finally{setBusyId("");}
  }
  async function unpublishExam(exam:ExamRecord){
    if(!exam.snapshotId){return;}
    setBusyId(exam.id);
    try{
      if(demo||!user)setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status:"draft"}:item));
      else if(dataScope){const accessCode=await existingQuizAccessCode(exam);const batch=writeBatch(db);batch.update(workspaceDoc(dataScope,"exams",exam.id),{status:"draft",updatedAt:serverTimestamp()});batch.update(doc(db,"publicSnapshots",exam.snapshotId),{published:false,updatedAt:serverTimestamp()});if(accessCode)batch.update(doc(db,"publicLinkCodes",accessCode),{published:false,updatedAt:serverTimestamp()});await batch.commit();}
      setToast({message:"Ulangan dinonaktifkan dan link siswa ditutup.",tone:"success"});
    }catch{setToast({message:"Ulangan gagal dinonaktifkan.",tone:"error"});}
    finally{setBusyId("");}
  }

  async function finishExamNow(exam:ExamRecord){
    if(!exam.snapshotId)return;
    const related=examAttempts(exam);
    const active=related.filter((attempt)=>attempt.status==="active");
    const registered=students.filter((student)=>student.className===exam.className).length;
    const absent=Math.max(0,registered-related.length);
    if(!window.confirm(`Matikan ulangan “${exam.title}” sekarang? ${active.length} siswa yang masih mengerjakan akan dinilai dari jawaban terakhir. ${absent} siswa yang belum ikut tidak dihitung. Hasil langsung dapat dilihat siswa.`))return;
    const endedAtMs=Date.now();
    setBusyId(exam.id);
    try{
      if(demo||!user){
        setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status:"finished",endAtMs:endedAtMs,endedAtMs,endedManually:true,targetStudentCount:related.length}:item));
        setAttempts((current)=>current.map((attempt)=>attempt.examId===exam.id&&attempt.status==="active"?{...attempt,status:"finished",finishReason:"ditutup_guru"}:attempt));
      }else{
        const batch=writeBatch(db);
        batch.update(workspaceDoc(dataScope!,"exams",exam.id),{status:"finished",endAtMs:endedAtMs,endedAtMs,endedAt:serverTimestamp(),endedManually:true,targetStudentCount:related.length,updatedAt:serverTimestamp()});
        batch.update(doc(db,"publicSnapshots",exam.snapshotId),{published:true,questions:exam.questions,endAtMs:endedAtMs,endAt:serverTimestamp(),endedAtMs,endedAt:serverTimestamp(),endedManually:true,updatedAt:serverTimestamp()});
        for(const attempt of active){
          const randomized=createRandomizedQuiz(exam.questions,attempt.randomSeed??`${exam.snapshotId}:${attempt.nis}`);
          const savedAnswers=attempt.answers??{};
          const correct=randomized.reduce((total,question,index)=>total+(savedAnswers[String(index)]===question.answerIndex?1:0),0);
          const score=randomized.length?Math.round(correct/randomized.length*100):0;
          const durationSeconds=Math.max(0,Math.min(Math.floor((endedAtMs-(attempt.startedAtMs??endedAtMs))/1000),(exam.durationMinutes??60)*60));
          batch.update(doc(db,"publicQuizAttempts",attempt.id),{status:"finished",correctCount:correct,score,durationSeconds,finishedAt:serverTimestamp(),finishReason:"ditutup_guru",updatedAt:serverTimestamp()});
        }
        await batch.commit();
      }
      setMonitor(null);
      setToast({message:`Ulangan dimatikan. Hasil ${related.length} peserta sekarang dapat dilihat.`,tone:"success"});
    }catch{setToast({message:"Ulangan belum dapat dimatikan. Periksa koneksi lalu coba lagi.",tone:"error"});}
    finally{setBusyId("");}
  }

  async function copyQuizLink(exam:ExamRecord){
    if(!exam.snapshotId||!["published","scheduled","finished"].includes(exam.status)){setToast({message:"Jadwalkan atau terapkan ulangan terlebih dahulu.",tone:"error"});return;}
    try{const accessCode=await ensureQuizAccessCode(exam);const link=accessCode==="DEMO"?`${location.origin}/link/demo`:buildQuizShortUrl(accessCode,location.origin);await navigator.clipboard.writeText(link);setToast({message:`Link pendek disalin. Kode ulangan: ${accessCode}`,tone:"success"});}
    catch{setToast({message:"Link tidak dapat disalin otomatis.",tone:"error"});}
  }

  async function copyQuizCode(exam:ExamRecord){
    if(!exam.snapshotId||!["published","scheduled","finished"].includes(exam.status)){setToast({message:"Jadwalkan atau terapkan ulangan terlebih dahulu.",tone:"error"});return;}
    try{const accessCode=await ensureQuizAccessCode(exam);await navigator.clipboard.writeText(accessCode);setToast({message:`Kode ${accessCode} berhasil disalin. Siswa memasukkannya di smart-att.web.id/link.`,tone:"success"});}
    catch{setToast({message:"Kode ulangan belum dapat dibuat atau disalin.",tone:"error"});}
  }

  function printExamPdf(exam:ExamRecord){
    const printWindow=window.open("","_blank");
    if(!printWindow){setToast({message:"Izinkan pop-up browser untuk menyimpan PDF.",tone:"error"});return;}
    const questionsHtml=exam.questions.map((question,index)=>`<section><h3>${index+1}. ${escapeHtml(question.question)}</h3><ol type="A">${question.choices.map((choice)=>`<li>${escapeHtml(choice)}</li>`).join("")}</ol><p><strong>Kunci:</strong> ${String.fromCharCode(65+question.answerIndex)}</p>${question.explanation?`<p><strong>Pembahasan:</strong> ${escapeHtml(question.explanation)}</p>`:""}</section>`).join("");
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(exam.title)}</title><style>body{font-family:Arial,sans-serif;color:#111;max-width:800px;margin:32px auto;line-height:1.5}header{border-bottom:2px solid #111;margin-bottom:24px}section{break-inside:avoid;margin:0 0 22px}h1{font-size:24px}h3{font-size:15px}li,p{font-size:13px}@media print{body{margin:0}button{display:none}}</style></head><body><header><h1>${escapeHtml(exam.title)}</h1><p>${escapeHtml(exam.subject)} · ${escapeHtml(exam.className)} · ${exam.questions.length} soal</p></header>${questionsHtml}<script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }

  async function removeExam(exam:ExamRecord){
    if(!window.confirm(`Hapus ulangan “${exam.title}”?`))return;
    try{if(demo||!user||!dataScope)setExams((current)=>current.filter((item)=>item.id!==exam.id));else{const accessCode=await existingQuizAccessCode(exam);const batch=writeBatch(db);batch.delete(workspaceDoc(dataScope,"exams",exam.id));if(exam.snapshotId)batch.delete(doc(db,"publicSnapshots",exam.snapshotId));if(accessCode)batch.delete(doc(db,"publicLinkCodes",accessCode));await batch.commit();}setToast({message:"Ulangan berhasil dihapus.",tone:"success"});}
    catch{setToast({message:"Ulangan gagal dihapus.",tone:"error"});}
  }

  async function unlockExamDevice(attempt:QuizAttempt){
    if(!window.confirm(`Buka kunci perangkat untuk ${attempt.studentName} (NIS ${attempt.nis})? Perangkat lama akan dihentikan dan siswa harus masuk kembali.`))return;
    try{
      if(!demo)await deleteDoc(doc(db,"publicQuizDeviceLocks",attempt.id));
      setToast({message:`Kunci perangkat ${attempt.studentName} berhasil dibuka.`,tone:"success"});
    }catch{setToast({message:"Kunci perangkat gagal dibuka.",tone:"error"});}
  }

  const activeCount=exams.filter((exam)=>exam.status==="published"||exam.status==="scheduled").length;
  const draftCount=exams.filter((exam)=>exam.status==="draft").length;
  const questionCount=exams.reduce((total,exam)=>total+(exam.questions?.length??0),0);

  function examAttempts(exam:ExamRecord){return attempts.filter((attempt)=>attempt.examId===exam.id);}

  return <>
    <SectionHeading eyebrow="Smart Quiz" title="Soal & ulangan" description="Tinjau draf, publikasikan ujian, dan pantau pengerjaan siswa secara langsung."/>
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <StatCard label="Ujian online" value={String(activeCount)} note="Link dapat dibuka siswa" icon={Timer} tone="bg-teal-50 text-teal-600"/>
      <StatCard label="Draf ditinjau" value={String(draftCount)} note="Siap diterapkan" icon={FileText} tone="bg-sky-50 text-sky-600"/>
      <StatCard label="Total butir soal" value={String(questionCount)} note="Tersimpan di Firebase" icon={ListChecks} tone="bg-violet-50 text-violet-600"/>
    </div>
    {loading?<div className="grid min-h-52 place-items-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={30}/></div>:exams.length===0?<div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><ClipboardCheck className="mx-auto text-teal-600" size={30}/><h3 className="mt-4 font-black">Belum ada draf soal</h3><p className="mt-1 text-sm text-slate-500">Buat dan simpan soal melalui Generator Soal AI.</p></div>:<div className="space-y-4">{exams.map((exam)=>{
      const online=exam.status==="published"||exam.status==="scheduled";
      const completed=exam.status==="finished";
      const related=examAttempts(exam);
      const finished=related.filter((item)=>item.status==="finished");
      const violations=related.reduce((total,item)=>total+(item.violations?.length??0),0);
      const canFinishNow=online&&(exam.startAtMs??0)<=Date.now();
      return <article key={exam.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><ClipboardCheck size={25}/></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{exam.title}</h3><span className={`rounded-full px-2 py-1 text-[9px] font-black ${completed?'bg-slate-100 text-slate-700':exam.status==="scheduled"?'bg-violet-50 text-violet-700':online?'bg-emerald-50 text-emerald-700':'bg-sky-50 text-sky-700'}`}>{completed?'SELESAI':exam.status==="scheduled"?'TERJADWAL':online?'ONLINE':'DRAF'}</span>{exam.source==="ai"&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700">DARI AI</span>}</div><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400"><span>{exam.className}</span><span>{exam.questions?.length??0} soal</span><span>{exam.durationMinutes??60} menit</span>{exam.accessCode&&<span className="font-black tracking-wider text-teal-700">Kode {exam.accessCode}</span>}{exam.startAtMs&&<span>Mulai {new Date(exam.startAtMs).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}</span>}{(online||completed)&&<><span>{finished.length}/{exam.targetStudentCount??targetStudents(exam).length} selesai</span><span className={violations?'font-bold text-rose-500':''}>{violations} pelanggaran</span></>}</div></div>
        <div className="flex flex-wrap gap-2">{online?<><button onClick={()=>void copyQuizLink(exam)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-xs font-bold text-white"><Link2 size={14}/>Link pendek</button><button onClick={()=>void copyQuizCode(exam)} className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs font-bold text-teal-800"><KeyRound size={14}/>{exam.accessCode||"Buat kode"}</button><button onClick={()=>setMonitor(exam)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><Activity size={14}/>Monitor</button>{canFinishNow&&<button disabled={busyId===exam.id} onClick={()=>void finishExamNow(exam)} className="flex items-center gap-2 rounded-xl bg-rose-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busyId===exam.id?<Loader2 className="animate-spin" size={14}/>:<XCircle size={14}/>}Matikan ulangan</button>}<button disabled={busyId===exam.id} onClick={()=>void unpublishExam(exam)} title="Nonaktifkan link tanpa membuka hasil" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><XCircle size={15}/></button></>:completed?<><button onClick={()=>void copyQuizLink(exam)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-xs font-bold text-white"><Link2 size={14}/>Link pendek</button><button onClick={()=>void copyQuizCode(exam)} className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs font-bold text-teal-800"><KeyRound size={14}/>{exam.accessCode||"Buat kode"}</button><button onClick={()=>setMonitor(exam)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><Activity size={14}/>Lihat hasil</button></>:<button onClick={()=>{setReview(exam);setDurationMinutes(String(exam.durationMinutes??60));if(exam.startAtMs){const date=new Date(exam.startAtMs);setScheduleDate(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`);setScheduleTime(date.toTimeString().slice(0,5))}}} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><FileText size={14}/>Tinjau & terapkan</button>}<button onClick={()=>printExamPdf(exam)} title="Simpan PDF" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><Download size={15}/></button><button onClick={()=>void removeExam(exam)} title="Hapus" className="rounded-xl border border-rose-100 p-2.5 text-rose-500"><Trash2 size={15}/></button></div>
      </article>})}</div>}
    {review&&<Modal title="Tinjau & terapkan ulangan" subtitle={`${review.title} · ${review.questions.length} soal`} onClose={()=>setReview(null)}><div className="mb-5 grid gap-3 sm:grid-cols-2"><Field label="Tanggal ujian" type="date" value={scheduleDate} onChange={setScheduleDate}/><Field label="Jam mulai" type="time" value={scheduleTime} onChange={setScheduleTime}/><Field label="Durasi ujian (menit)" type="number" value={durationMinutes} onChange={setDurationMinutes}/><div className="rounded-xl bg-teal-50 p-4"><p className="text-[10px] font-black text-teal-600">AKSES UJIAN</p><p className="mt-1 text-sm font-black text-teal-950">Semua NIS terdaftar · melalui link</p></div></div><div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">{review.questions.map((question,index)=><article key={`${index}-${question.question}`} className="rounded-xl border border-slate-200 p-4"><h4 className="text-sm font-black">{index+1}. {question.question}</h4><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{question.choices.map((choice,choiceIndex)=><p key={choiceIndex} className={`rounded-lg px-2.5 py-2 text-xs ${choiceIndex===question.answerIndex?'bg-emerald-50 font-bold text-emerald-800':'bg-slate-50 text-slate-600'}`}>{String.fromCharCode(65+choiceIndex)}. {choice}</p>)}</div></article>)}</div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button onClick={()=>printExamPdf(review)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-xs font-extrabold"><Download size={15}/>Simpan PDF</button><button disabled={busyId===review.id} onClick={()=>void publishExam(review)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white disabled:opacity-60">{busyId===review.id?<Loader2 className="animate-spin" size={16}/>:<Send size={16}/>}Jadwalkan / terapkan</button></div></Modal>}
    {monitor&&(()=>{const related=examAttempts(monitor);const finished=related.filter((item)=>item.status==="finished");const top=[...finished].sort((a,b)=>(b.score??0)-(a.score??0)||(a.durationSeconds??Infinity)-(b.durationSeconds??Infinity)).slice(0,5);const target=monitor.targetStudentCount??targetStudents(monitor).length;const allDone=target>0&&finished.length>=target;return <Modal title="Monitoring & peringkat" subtitle={`${monitor.title} · ${finished.length}/${target} siswa selesai`} onClose={()=>setMonitor(null)}>{allDone&&<div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 className="mr-2 inline" size={18}/>Semua siswa telah menyelesaikan ujian.</div>}<h4 className="mb-3 text-sm font-black">5 nilai tertinggi dan tercepat</h4>{top.length?<div className="space-y-2">{top.map((attempt,index)=><div key={attempt.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{index+1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{attempt.studentName}</p><p className="text-[10px] text-slate-400">NIS {attempt.nis} · {formatCountdown(attempt.durationSeconds??0)}</p></div><p className="text-xl font-black text-teal-700">{attempt.score??0}</p></div>)}</div>:<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada siswa yang menyelesaikan ujian.</p>}<h4 className="mb-3 mt-6 text-sm font-black">Aktivitas pengawasan</h4><div className="space-y-2">{related.map((attempt)=><div key={attempt.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><div><p className="text-sm font-bold">{attempt.studentName}</p><p className="text-[10px] text-slate-400">{attempt.status==="finished"?'Selesai':'Mengerjakan'} · Login ulang {attempt.reloginCount??0}x</p></div><div className="flex flex-col items-end gap-1.5"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${(attempt.violations?.length??0)>0?'bg-rose-100 text-rose-700':'bg-emerald-100 text-emerald-700'}`}>{attempt.violations?.length??0} pelanggaran</span>{attempt.status==="active"&&<button onClick={()=>void unlockExamDevice(attempt)} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-black text-amber-700"><KeyRound className="mr-1 inline" size={12}/>Buka kunci perangkat</button>}</div></div>)}</div></Modal>})()}
  </>;
}

function ExamsView({user,demo,setToast}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void}){
  const demoExams:ExamRecord[]=[
    {id:"demo-exam-1",title:"Kuis Matematika — Persamaan Linear",subject:"Matematika",className:"V-A",chapter:"Persamaan linear",status:"draft",source:"ai",questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}]},
  ];
  const [exams,setExams]=useState<ExamRecord[]>(demo?demoExams:[]);
  const [loading,setLoading]=useState(!demo);
  const [review,setReview]=useState<ExamRecord|null>(null);

  useEffect(()=>{
    if(demo){setExams(demoExams);setLoading(false);return;}
    if(!user){setExams([]);setLoading(false);return;}
    setLoading(true);
    return onSnapshot(collection(db,"users",user.uid,"exams"),(snapshot)=>{
      const next=snapshot.docs.map((item)=>({id:item.id,...item.data()} as ExamRecord));
      next.sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
      setExams(next);setLoading(false);
    },()=>{setLoading(false);setToast({message:"Draf soal belum dapat dibaca.",tone:"error"});});
  },[user,demo,setToast]);

  async function removeExam(exam:ExamRecord){
    if(!window.confirm(`Hapus draf “${exam.title}”?`))return;
    try{
      if(demo||!user)setExams((current)=>current.filter((item)=>item.id!==exam.id));
      else await deleteDoc(doc(db,"users",user.uid,"exams",exam.id));
      setToast({message:"Draf ulangan berhasil dihapus.",tone:"success"});
    }catch{setToast({message:"Draf ulangan gagal dihapus.",tone:"error"});}
  }

  const statusStyle:Record<ExamRecord["status"],{label:string;tone:string}>={draft:{label:"Draf",tone:"bg-sky-50 text-sky-700"},scheduled:{label:"Terjadwal",tone:"bg-violet-50 text-violet-700"},published:{label:"Aktif",tone:"bg-emerald-50 text-emerald-700"},finished:{label:"Selesai",tone:"bg-slate-100 text-slate-600"}};
  const draftCount=exams.filter((exam)=>exam.status==="draft").length;

  const activeCount=exams.filter((exam)=>exam.status==="published"||exam.status==="scheduled").length;
  const questionCount=exams.reduce((total,exam)=>total+(Array.isArray(exam.questions)?exam.questions.length:0),0);

  return <><SectionHeading eyebrow="Smart Quiz" title="Soal & ulangan" description="Draf dari Generator Soal AI otomatis muncul di halaman ini." action={<button onClick={()=>setToast({message:"Untuk membuat soal otomatis, buka menu Generator Soal AI.",tone:"success"})} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><Plus size={17}/>Buat ulangan</button>}/><div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Ujian aktif" value={String(activeCount)} note="Terjadwal atau dipublikasikan" icon={Timer} tone="bg-teal-50 text-teal-600"/><StatCard label="Draf soal" value={String(draftCount)} note="Siap ditinjau guru" icon={FileText} tone="bg-sky-50 text-sky-600"/><StatCard label="Total butir soal" value={String(questionCount)} note="Dari semua draf dan ujian" icon={ListChecks} tone="bg-violet-50 text-violet-600"/></div>{loading?<div className="grid min-h-52 place-items-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={30}/></div>:exams.length===0?<div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-50 text-sky-700"><ClipboardCheck size={26}/></div><h3 className="mt-4 font-black">Belum ada draf soal</h3><p className="mt-1 text-sm text-slate-500">Buat soal di Generator Soal AI, lalu simpan sebagai draf ulangan.</p></div>:<div className="space-y-4">{exams.map((exam)=>{const status=statusStyle[exam.status]??statusStyle.draft;const total=Array.isArray(exam.questions)?exam.questions.length:0;return <article key={exam.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#e7f6f5] text-teal-700"><ClipboardCheck size={25}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{exam.title}</h3><span className={`rounded-full px-2 py-1 text-[9px] font-black ${status.tone}`}>{status.label}</span>{exam.source==="ai"&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700">DARI AI</span>}</div><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400"><span>{exam.className}</span><span>{exam.subject}</span><span>{total} soal</span>{exam.chapter&&<span>{exam.chapter}</span>}</div></div><div className="flex flex-wrap gap-2"><button onClick={()=>setReview(exam)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><FileText size={14}/>Tinjau soal</button>{exam.status!=="published"&&<button onClick={()=>void removeExam(exam)} title="Hapus draf" className="rounded-xl border border-rose-100 p-2.5 text-rose-500 hover:bg-rose-50"><Trash2 size={15}/></button>}</div></article>})}</div>}{review&&<Modal title={review.title} subtitle={`${review.className} · ${review.questions?.length??0} soal`} onClose={()=>setReview(null)}><div className="space-y-4">{(review.questions??[]).map((question,index)=><article key={`${index}-${question.question}`} className="rounded-2xl border border-slate-200 p-4"><div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{index+1}</span><div className="min-w-0 flex-1"><h4 className="text-sm font-black leading-6">{question.question}</h4><div className="mt-3 space-y-2">{question.choices.map((choice,choiceIndex)=><div key={`${choiceIndex}-${choice}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${choiceIndex===question.answerIndex?'bg-emerald-50 text-emerald-800':'bg-slate-50 text-slate-600'}`}><span className={`grid h-6 w-6 place-items-center rounded-md text-[10px] font-black ${choiceIndex===question.answerIndex?'bg-emerald-600 text-white':'bg-slate-200 text-slate-500'}`}>{String.fromCharCode(65+choiceIndex)}</span>{choice}</div>)}</div>{question.explanation&&<p className="mt-3 text-xs leading-5 text-sky-800"><span className="font-black">Pembahasan:</span> {question.explanation}</p>}</div></div></article>)}{(!review.questions||review.questions.length===0)&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Draf ini belum memiliki butir soal.</p>}</div></Modal>}</>;
}

function AiGenerator({user,demo,setToast,scope,allowedClassNames,allowedSubjectNames}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void;scope?:WorkspaceScope;allowedClassNames?:string[];allowedSubjectNames?:string[]}){
  const [subject,setSubject]=useState(allowedSubjectNames?.[0]||"Matematika");
  const [grade,setGrade]=useState(allowedClassNames?.[0]||"VII");
  const [chapter,setChapter]=useState("Persamaan linear satu variabel");
  const [count,setCount]=useState("20");
  const [choices,setChoices]=useState("4");
  const [aiOutput,setAiOutput]=useState("");
  const [questions,setQuestions]=useState<QuizQuestion[]>([]);
  const [parseError,setParseError]=useState("");
  const [saving,setSaving]=useState(false);
  const prompt=`Buat ${count} soal pilihan ganda mata pelajaran ${subject} untuk kelas ${grade}, bab ${chapter}. Setiap soal memiliki ${choices} pilihan, tepat satu jawaban benar, dan pembahasan singkat. Buat semua pilihan pengecoh masuk akal, mirip satu sama lain, tidak mudah ditebak, dan membutuhkan ketelitian. Untuk soal hitungan, gunakan hasil dari kesalahan hitung yang umum sebagai pengecoh dan pastikan hanya satu hasil yang benar. Hindari pilihan yang terlalu berbeda, lucu, atau jelas salah. Keluarkan JSON dengan struktur: {"questions":[{"question":"...","choices":["..."],"answerIndex":0,"explanation":"..."}]}. Pastikan answerIndex dimulai dari 0, kunci sesuai pilihan yang benar, dan seluruh soal lengkap.`;

  function readQuestions(text=aiOutput){
    const parsed=parseAiQuizText(text);
    if(!parsed.length){setQuestions([]);setParseError("Soal belum terbaca. Gunakan nomor soal, pilihan A/B/C/D, dan baris ‘Kunci: A’, atau tempel hasil JSON dari AI.");return;}
    setQuestions(parsed);setParseError("");setCount(String(parsed.length));
    setToast({message:`${parsed.length} soal berhasil dibuat dari hasil AI.`,tone:"success"});
  }

  async function pasteFromClipboard(){
    try{const text=await navigator.clipboard.readText();setAiOutput(text);readQuestions(text);}
    catch{setToast({message:"Tempel hasil AI secara manual pada kolom yang tersedia.",tone:"error"});}
  }

  async function importFile(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    try{const text=await file.text();setAiOutput(text);readQuestions(text);}
    catch{setToast({message:"File tidak dapat dibaca.",tone:"error"});}
  }

  async function saveDraft(){
    if(!questions.length){setToast({message:"Baca hasil AI terlebih dahulu.",tone:"error"});return;}
    if(allowedClassNames?.length&&!allowedClassNames.includes(grade.trim())){setToast({message:"Kelas soal harus berasal dari kelas yang ditugaskan.",tone:"error"});return;}
    if(allowedSubjectNames?.length&&!allowedSubjectNames.includes(subject.trim())){setToast({message:"Mapel soal belum diizinkan untuk guru ini.",tone:"error"});return;}
    setSaving(true);
    try{
      if(!demo&&user)await addDoc(scope?workspaceCollection(scope,"exams"):collection(db,"users",user.uid,"exams"),{...(scope?.root==="schools"?{schoolId:scope.id}:{ownerUid:user.uid}),title:`${subject} — ${chapter}`,subject,className:grade,chapter,questions,status:"draft",source:"ai",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      setToast({message:`Draf ulangan dengan ${questions.length} soal berhasil disimpan.`,tone:"success"});
    }catch{setToast({message:"Draf soal gagal disimpan.",tone:"error"});}
    finally{setSaving(false);}
  }

  return <><SectionHeading eyebrow="Asisten AI" title="Generator soal AI" description="Salin prompt, lalu tempel hasil AI untuk langsung mengubahnya menjadi soal."/><div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-5 font-black">1. Atur kebutuhan soal</h3><div className="space-y-4"><Field label="Mata pelajaran" value={subject} onChange={setSubject}/><Field label="Kelas" value={grade} onChange={setGrade}/><Field label="Bab / materi" value={chapter} onChange={setChapter}/><div className="grid grid-cols-2 gap-3"><Field label="Jumlah soal" type="number" value={count} onChange={setCount}/><Field label="Pilihan jawaban" type="number" value={choices} onChange={setChoices}/></div></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">2. Salin prompt ke AI</h3><p className="mt-1 text-xs text-slate-400">Gunakan di ChatGPT, Gemini, atau AI lainnya.</p></div><Sparkles className="text-teal-600" size={22}/></div><pre className="min-h-64 whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-300">{prompt}</pre><button onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setToast({message:'Prompt AI disalin.',tone:'success'})).catch(()=>setToast({message:'Prompt gagal disalin.',tone:'error'}))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white"><Copy size={16}/>Salin prompt</button></section></div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-black">3. Tempel hasil dari AI</h3><p className="mt-1 text-xs leading-5 text-slate-500">Boleh berupa JSON, blok kode Markdown, atau tulisan soal bernomor dengan pilihan A/B/C/D dan baris Kunci.</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>void pasteFromClipboard()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><ClipboardCheck size={15}/>Tempel otomatis</button><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><Upload size={15}/>Pilih file<input type="file" accept=".json,.txt,text/plain,application/json" className="hidden" onChange={(event)=>void importFile(event)}/></label></div></div><textarea value={aiOutput} onChange={(event)=>{setAiOutput(event.target.value);setParseError("");}} className="mt-4 min-h-72 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" placeholder={'Tempel hasil AI di sini...\n\nContoh:\n1. Berapakah 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nKunci: B\nPembahasan: 2 + 2 = 4.'}/>{parseError&&<p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold leading-5 text-rose-700">{parseError}</p>}<button disabled={!aiOutput.trim()} onClick={()=>readQuestions()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white disabled:opacity-40"><Sparkles size={17}/>Baca hasil & buat soal</button></section>
    {questions.length>0&&<section className="mt-6 rounded-2xl border border-teal-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Soal berhasil dibuat</p><h3 className="mt-1 text-xl font-black">{questions.length} soal siap digunakan</h3><p className="mt-1 text-xs text-slate-500">Periksa kunci jawaban sebelum menyimpan sebagai draf ulangan.</p></div><button disabled={saving} onClick={()=>void saveDraft()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-xs font-extrabold text-white disabled:opacity-60">{saving?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Simpan draf ulangan</button></div><div className="mt-5 space-y-4">{questions.map((question,index)=><article key={`${index}-${question.question}`} className="rounded-2xl border border-slate-200 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{index+1}</span><div className="min-w-0 flex-1"><h4 className="text-sm font-black leading-6">{question.question}</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.choices.map((choice,choiceIndex)=><div key={`${choiceIndex}-${choice}`} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${choiceIndex===question.answerIndex?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 text-slate-600'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black ${choiceIndex===question.answerIndex?'bg-emerald-600 text-white':'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65+choiceIndex)}</span>{choice}</div>)}</div>{question.explanation&&<p className="mt-3 rounded-xl bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-800"><span className="font-black">Pembahasan:</span> {question.explanation}</p>}</div></div></article>)}</div></section>}
  </>;
}

function AiGeneratorConnected({user,demo,activeSession,setToast}:{user:User|null;demo:boolean;activeSession:ActiveTeachingSession;setToast:(t:Toast)=>void}){
  const [subject,setSubject]=useState(activeSession.subjectName || "Matematika");
  const [grade,setGrade]=useState(activeSession.className || "V-A");
  const [gradeCategory,setGradeCategory]=useState<"quiz"|"summative"|"midterm"|"final">("summative");
  const [chapter,setChapter]=useState("Persamaan linear satu variabel");
  const [count,setCount]=useState("20");
  const [choices,setChoices]=useState("4");
  const [aiOutput,setAiOutput]=useState("");
  const [parseError,setParseError]=useState("");
  const [saving,setSaving]=useState(false);
  const [savedExamId,setSavedExamId]=useState("");
  const prompt=`Buat ${count} soal pilihan ganda mata pelajaran ${subject} untuk kelas ${grade}, bab ${chapter}. Setiap soal memiliki ${choices} pilihan, tepat satu jawaban benar, dan pembahasan singkat. Buat semua pilihan pengecoh masuk akal, mirip satu sama lain, tidak mudah ditebak, dan membutuhkan ketelitian. Untuk soal hitungan, gunakan hasil dari kesalahan hitung yang umum sebagai pengecoh dan pastikan hanya satu hasil yang benar. Hindari pilihan yang terlalu berbeda, lucu, atau jelas salah. Keluarkan JSON dengan struktur: {"questions":[{"question":"...","choices":["..."],"answerIndex":0,"explanation":"..."}]}. Pastikan answerIndex dimulai dari 0, kunci sesuai pilihan yang benar, dan seluruh soal lengkap.`;

  useEffect(()=>{setSubject(activeSession.subjectName || "Matematika");setGrade(activeSession.className || "V-A");},[activeSession.subjectName,activeSession.className]);

  async function persistDraft(items:QuizQuestion[]){
    setSaving(true);
    try{
      if(!demo&&user){
        const examRef=savedExamId?doc(db,"users",user.uid,"exams",savedExamId):doc(collection(db,"users",user.uid,"exams"));
        const normalizedSubject=subject.trim().toLocaleLowerCase("id-ID");
        const activeSubjectMatches=normalizedSubject===activeSession.subjectName.trim().toLocaleLowerCase("id-ID");
        const subjectId=activeSubjectMatches&&activeSession.subjectId?activeSession.subjectId:`subject-${normalizedSubject.replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"lainnya"}`;
        const assessmentType=gradeCategory==="quiz"?"quiz":gradeCategory==="midterm"?"pts_sts":gradeCategory==="final"?"pas_sas":"daily_test";
        await setDoc(examRef,{title:`${subject} — ${chapter}`,subjectId,subject:subject.trim(),className:grade.trim(),chapter:chapter.trim(),gradeCategory,assessmentType,questions:items,status:"draft",source:"ai",...(!savedExamId?{createdAt:serverTimestamp()}:{}),updatedAt:serverTimestamp()},{merge:true});
        setSavedExamId(examRef.id);
      }else if(!demo){
        throw new Error("Sesi login tidak tersedia");
      }else setSavedExamId("demo-ai-draft");
      setToast({message:`${items.length} soal otomatis tersimpan di Soal & Ulangan.`,tone:"success"});
      return true;
    }catch{
      setToast({message:"Soal terbaca, tetapi gagal disimpan. Silakan login ulang lalu coba lagi.",tone:"error"});
      return false;
    }finally{setSaving(false);}
  }

  async function readAndSave(text=aiOutput){
    const parsed=parseAiQuizText(text);
    if(!parsed.length){setParseError("Soal belum terbaca. Gunakan nomor soal, pilihan A/B/C/D, dan baris Kunci: A, atau tempel hasil JSON dari AI.");return;}
    setParseError("");setCount(String(parsed.length));
    await persistDraft(parsed);
  }

  async function pasteFromClipboard(){
    try{const text=await navigator.clipboard.readText();setAiOutput(text);await readAndSave(text);}
    catch{setToast({message:"Tempel hasil AI secara manual pada kolom yang tersedia.",tone:"error"});}
  }

  async function importFile(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    try{const text=await file.text();setAiOutput(text);await readAndSave(text);}
    catch{setToast({message:"File tidak dapat dibaca.",tone:"error"});}
  }

  return <><SectionHeading eyebrow="Asisten AI" title="Generator soal AI" description="Soal mengikuti mata pelajaran aktif dan nilai siswa otomatis masuk ke Rekap Nilai setelah ujian selesai."/><div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-bold text-teal-800"><CheckCircle2 size={16}/><span>Mata pelajaran aktif: <strong>{subject}</strong></span><span className="text-teal-500">·</span><span>Kelas: <strong>{grade}</strong></span><span className="text-teal-500">·</span><span>Nilai tersinkron otomatis per siswa.</span></div><div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-5 font-black">1. Atur kebutuhan soal</h3><div className="space-y-4"><Field label="Mata pelajaran" value={subject} onChange={(value)=>{setSubject(value)}}/><Field label="Kelas" value={grade} onChange={(value)=>{setGrade(value)}}/><Field label="Bab / materi" value={chapter} onChange={(value)=>{setChapter(value)}}/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Masuk ke komponen nilai</span><select value={gradeCategory} onChange={(event)=>setGradeCategory(event.target.value as typeof gradeCategory)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-teal-500"><option value="summative">Ulangan Harian / Sumatif</option><option value="quiz">Kuis / Formatif</option><option value="midterm">PTS / STS</option><option value="final">PAS / SAS</option></select><span className="mt-1.5 block text-[10px] leading-4 text-slate-400">Setelah siswa menekan selesai, nilainya otomatis tercatat pada mata pelajaran dan komponen ini.</span></label><div className="grid grid-cols-2 gap-3"><Field label="Jumlah soal" type="number" value={count} onChange={setCount}/><Field label="Pilihan jawaban" type="number" value={choices} onChange={setChoices}/></div></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">2. Salin prompt ke AI</h3><p className="mt-1 text-xs text-slate-400">Gunakan di ChatGPT, Gemini, atau AI lainnya.</p></div><Sparkles className="text-teal-600" size={22}/></div><pre className="min-h-64 whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-300">{prompt}</pre><button onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setToast({message:"Prompt AI disalin.",tone:"success"})).catch(()=>setToast({message:"Prompt gagal disalin.",tone:"error"}))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white"><Copy size={16}/>Salin prompt</button></section></div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-black">3. Tempel dan simpan hasil AI</h3><p className="mt-1 text-xs leading-5 text-slate-500">Mendukung JSON, blok Markdown, dan tulisan soal bernomor dengan pilihan A/B/C/D.</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>void pasteFromClipboard()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><ClipboardCheck size={15}/>Tempel otomatis</button><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><Upload size={15}/>Pilih file<input type="file" accept=".json,.txt,text/plain,application/json" className="hidden" onChange={(event)=>void importFile(event)}/></label></div></div><textarea value={aiOutput} onChange={(event)=>{setAiOutput(event.target.value);setParseError("")}} className="mt-4 min-h-72 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" placeholder={'Tempel hasil AI di sini...\n\n1. Berapakah 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nKunci: B'}/>{parseError&&<p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold leading-5 text-rose-700">{parseError}</p>}<button disabled={!aiOutput.trim()||saving} onClick={()=>void readAndSave()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white disabled:opacity-40">{saving?<Loader2 className="animate-spin" size={17}/>:<Sparkles size={17}/>}Baca hasil & simpan ke Soal & Ulangan</button></section>
  </>;
}

function LegacyScoresView({students}:{students:Student[]}){return <><SectionHeading eyebrow="Evaluasi" title="Rekap nilai siswa" description="Gabungkan nilai ulangan dan nilai manual sesuai bobot semester." action={<button className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><PencilLine size={16}/>Input nilai manual</button>}/><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option>V-A</option><option>V-B</option></select><select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option>Matematika</option><option>IPA</option></select><span className="ml-auto rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-700">KKM 75</span></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Tugas</th><th className="px-4 py-3">Ulangan</th><th className="px-4 py-3">Nilai manual</th><th className="px-4 py-3">Rata-rata</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{students.slice(0,5).map((s,i)=>{const avg=[88,72,94,80,76][i]??80;return <tr key={s.id}><td className="px-5 py-4 text-sm font-extrabold">{s.name}<p className="text-[10px] font-normal text-slate-400">{s.nis}</p></td><td className="px-4 py-4 text-sm font-bold">{avg+2}</td><td className="px-4 py-4 text-sm font-bold">{avg-3}</td><td className="px-4 py-4 text-sm font-bold">{avg+1}</td><td className="px-4 py-4"><span className="text-base font-black">{avg}</span></td><td className="px-5 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${avg>=75?'bg-emerald-50 text-emerald-700':'bg-rose-50 text-rose-700'}`}>{avg>=75?'Tuntas':'Remedial'}</span></td></tr>})}</tbody></table></div></section></>}

function LegacyAcademicView(){return <><SectionHeading eyebrow="Konfigurasi" title="Data akademik" description="Atur sekolah, tahun ajaran, semester, dan kelas aktif."/><div className="grid gap-5 lg:grid-cols-2"><ConfigCard icon={School} title="Sekolah utama" value="SMP Harapan Bangsa" detail="NPSN 12345678 · Kota Bandung"/><ConfigCard icon={CalendarDays} title="Periode aktif" value="2026/2027 · Ganjil" detail="13 Juli — 18 Desember 2026"/><ConfigCard icon={GraduationCap} title="Kelas aktif" value="2 kelas · 32 siswa" detail="V-A dan V-B"/><ConfigCard icon={AlarmClock} title="Aturan jam masuk" value="07:00 WIB" detail="Setelah 07:00 tercatat terlambat"/></div></>}
function ConfigCard({icon:Icon,title,value,detail}:{icon:typeof School;title:string;value:string;detail:string}){return <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="rounded-2xl bg-teal-50 p-4 text-teal-700"><Icon size={23}/></div><div className="flex-1"><p className="text-xs font-bold text-slate-400">{title}</p><h3 className="mt-1 font-black">{value}</h3><p className="mt-1 text-xs text-slate-500">{detail}</p></div><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><PencilLine size={17}/></button></div>}

function ProfileView({user,demo,setToast}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void}){
  const [name,setName]=useState(demo?"Tomi Guru":"");
  const [school,setSchool]=useState(demo?"SMP Harapan Bangsa":"");
  const [phone,setPhone]=useState(demo?"62812xxxx":"");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    if(demo){setName("Tomi Guru");setSchool("SMP Harapan Bangsa");setPhone("62812xxxx");return;}
    if(!user)return;
    void getDoc(doc(db,"users",user.uid)).then((profile)=>{
      if(!profile.exists())return;
      const data=profile.data();
      setName(typeof data.name==="string"?data.name:"");
      setSchool(typeof data.schoolName==="string"?data.schoolName:"");
      setPhone(typeof data.phone==="string"?data.phone:"");
    }).catch(()=>setToast({message:"Profil guru belum dapat dibaca.",tone:"error"}));
  },[user,demo,setToast]);

  async function saveProfile(){
    if(name.trim().length<3){setToast({message:"Nama guru minimal 3 karakter.",tone:"error"});return;}
    setSaving(true);
    try{
      if(!demo&&user)await updateDoc(doc(db,"users",user.uid),{name:name.trim(),schoolName:school.trim(),phone:phone.trim(),updatedAt:serverTimestamp()});
      setName(name.trim());
      setToast({message:"Profil guru berhasil diperbarui.",tone:"success"});
    }catch{setToast({message:"Profil guru gagal disimpan.",tone:"error"});}
    finally{setSaving(false);}
  }

  const initials=name.trim().split(/\s+/).slice(0,2).map((part)=>part[0]).join("").toUpperCase()||"GR";
  return <><SectionHeading eyebrow="Akun" title="Profil guru" description="Nama guru ini tampil pada dokumen, tugas, dan halaman publik."/><div className="grid gap-6 xl:grid-cols-[1fr_.45fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-6 flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-teal-100 text-xl font-black text-teal-700">{initials}</div><div><h3 className="font-black">{name||"Nama guru belum diisi"}</h3><p className="text-sm text-slate-400">{demo?'tolimur@gmail.com':user?.email}</p></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nama guru" value={name} onChange={setName} placeholder="Nama lengkap guru" required/><Field label="Email login" value={demo?'tolimur@gmail.com':user?.email??''} onChange={()=>{}}/><Field label="Nomor WhatsApp" value={phone} onChange={setPhone} placeholder="62812xxxx"/><Field label="Sekolah utama" value={school} onChange={setSchool}/></div><button disabled={saving} onClick={()=>void saveProfile()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white disabled:opacity-60">{saving&&<Loader2 className="animate-spin" size={16}/>}Simpan profil</button></section><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Status paket</p><h3 className="mt-2 text-xl font-black">Trial aktif</h3><p className="mt-1 text-xs text-slate-400">Berakhir 27 Juli 2026</p><div className="mt-5 h-2 rounded-full bg-slate-100"><div className="h-full w-1/2 rounded-full bg-teal-500"/></div><p className="mt-2 text-[10px] text-slate-400">7 dari 14 hari telah digunakan</p><button className="mt-6 w-full rounded-xl bg-slate-950 py-3 text-xs font-extrabold text-white">Masukkan token aktivasi</button></section></div></>}

function PublicQuizAdvanced(){
  const pathname=usePathname();
  const snapshotId=decodeURIComponent(pathname.split("/").filter(Boolean).at(-1)??"demo");
  const [snapshot,setSnapshot]=useState<PublicQuizSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [nis,setNis]=useState("");
  const [student,setStudent]=useState<Pick<Student,"id"|"nis"|"name"|"className">|null>(null);
  const [phase,setPhase]=useState<"login"|"quiz"|"done">("login");
  const [quiz,setQuiz]=useState<RandomizedQuestion[]>([]);
  const [answers,setAnswers]=useState<Record<string,number>>({});
  const [current,setCurrent]=useState(0);
  const [attemptId,setAttemptId]=useState("");
  const [startedAtMs,setStartedAtMs]=useState(0);
  const [deadlineMs,setDeadlineMs]=useState(0);
  const [remaining,setRemaining]=useState(0);
  const [warning,setWarning]=useState("");
  const [violationCount,setViolationCount]=useState(0);
  const [result,setResult]=useState({score:0,correct:0,duration:0});
  const submittingRef=useRef(false);
  const lastViolationRef=useRef({type:"",at:0});

  useEffect(()=>{
    if(snapshotId==="demo"){
      setSnapshot({type:"quiz",ownerUid:"demo",examId:"demo-exam",published:true,title:"Kuis Matematika — Persamaan Linear",subject:"Matematika",className:"V-A",chapter:"Persamaan linear",durationMinutes:60,questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}],students:demoStudents.filter((item)=>item.className==="V-A").map(({id,nis,name,className})=>({id,nis,name,className}))});setLoading(false);return;
    }
    void getDoc(doc(db,"publicSnapshots",snapshotId)).then((result)=>{
      if(!result.exists()||result.data().type!=="quiz"||result.data().published!==true)throw new Error("Ulangan tidak ditemukan atau sudah dinonaktifkan.");
      setSnapshot(result.data() as PublicQuizSnapshot);
    }).catch((reason)=>setError(reason instanceof Error?reason.message:"Ulangan tidak dapat dibuka.")).finally(()=>setLoading(false));
  },[snapshotId]);

  async function enterFullscreen(){
    if(document.fullscreenElement)return true;
    if(!document.documentElement.requestFullscreen){setError("Browser ini belum mendukung mode fullscreen. Gunakan Chrome atau Edge terbaru.");return false;}
    try{await document.documentElement.requestFullscreen();setWarning("");return true;}
    catch{setError("Izinkan mode fullscreen untuk memulai atau melanjutkan ujian.");return false;}
  }

  async function startQuiz(){
    if(!snapshot)return;
    const match=snapshot.students.find((item)=>item.nis.trim().toLowerCase()===nis.trim().toLowerCase());
    if(!match){setError("NIS tidak ditemukan pada kelas ulangan ini.");return;}
    setError("");
    if(!await enterFullscreen())return;
    const randomized=createRandomizedQuiz(snapshot.questions,`${snapshotId}:${match.nis}`);
    const id=`${snapshotId}_${match.id}`.replace(/[^a-zA-Z0-9_-]/g,"_");
    const attemptRef=doc(db,"publicQuizAttempts",id);
    const now=Date.now();
    let start=now;let deadline=now+snapshot.durationMinutes*60000;let savedAnswers:Record<string,number>={};
    if(snapshotId!=="demo"){
      const existing=await getDoc(attemptRef);
      if(existing.exists()){
        const data=existing.data() as QuizAttempt;
        if(data.status==="finished"){setStudent(match);setResult({score:data.score??0,correct:data.correctCount??0,duration:data.durationSeconds??0});setPhase("done");if(document.fullscreenElement)void document.exitFullscreen();return;}
        start=data.startedAtMs??now;deadline=data.deadlineMs??deadline;savedAnswers=data.answers??{};setViolationCount(data.violations?.length??0);
      }else await setDoc(attemptRef,{snapshotId,examId:snapshot.examId,ownerUid:snapshot.ownerUid,studentId:match.id,nis:match.nis,studentName:match.name,className:match.className,status:"active",answers:{},violations:[],startedAtMs:start,deadlineMs:deadline,startedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    setStudent(match);setQuiz(randomized);setAnswers(savedAnswers);setAttemptId(id);setStartedAtMs(start);setDeadlineMs(deadline);setRemaining(Math.max(0,Math.ceil((deadline-Date.now())/1000)));setPhase("quiz");
  }

  async function recordViolation(type:string){
    if(phase!=="quiz"||!attemptId||snapshotId==="demo")return;
    const now=Date.now();
    if(lastViolationRef.current.type===type&&now-lastViolationRef.current.at<1500)return;
    lastViolationRef.current={type,at:now};setViolationCount((value)=>value+1);
    try{await updateDoc(doc(db,"publicQuizAttempts",attemptId),{violations:arrayUnion({type,atMs:now}),updatedAt:serverTimestamp()});}catch{}
  }

  useEffect(()=>{
    if(phase!=="quiz")return;
    const visibility=()=>{if(document.hidden){setWarning("Anda terdeteksi berpindah tab atau membuka aplikasi lain. Aktivitas ini sudah dicatat untuk guru.");void recordViolation("pindah_tab_atau_aplikasi");}};
    const fullscreen=()=>{if(!document.fullscreenElement){setWarning("Anda keluar dari fullscreen. Kembali ke fullscreen untuk melanjutkan; kejadian ini tercatat untuk guru.");void recordViolation("keluar_fullscreen");}};
    const blur=()=>{if(!document.hidden)void recordViolation("jendela_tidak_aktif");};
    document.addEventListener("visibilitychange",visibility);document.addEventListener("fullscreenchange",fullscreen);window.addEventListener("blur",blur);
    return()=>{document.removeEventListener("visibilitychange",visibility);document.removeEventListener("fullscreenchange",fullscreen);window.removeEventListener("blur",blur);};
  },[phase,attemptId]);

  useEffect(()=>{
    if(phase!=="quiz"||!deadlineMs)return;
    const tick=()=>{const next=Math.max(0,Math.ceil((deadlineMs-Date.now())/1000));setRemaining(next);if(next===0)void finishQuiz(true);};
    tick();const interval=setInterval(tick,1000);return()=>clearInterval(interval);
  },[phase,deadlineMs,quiz,answers]);

  async function selectAnswer(originalChoiceIndex:number){
    const next={...answers,[String(current)]:originalChoiceIndex};setAnswers(next);
    if(snapshotId!=="demo"&&attemptId)try{await updateDoc(doc(db,"publicQuizAttempts",attemptId),{answers:next,updatedAt:serverTimestamp()});}catch{}
  }

  async function finishQuiz(auto=false){
    if(submittingRef.current||phase!=="quiz"||!quiz.length)return;
    submittingRef.current=true;
    const correct=quiz.reduce((total,question,index)=>total+(answers[String(index)]===question.answerIndex?1:0),0);
    const score=Math.round(correct/quiz.length*100);const duration=Math.max(0,Math.floor((Date.now()-startedAtMs)/1000));
    try{if(snapshotId!=="demo"&&attemptId)await updateDoc(doc(db,"publicQuizAttempts",attemptId),{status:"finished",answers,correctCount:correct,score,durationSeconds:duration,finishedAt:serverTimestamp(),finishReason:auto?"waktu_habis":"dikirim_siswa",updatedAt:serverTimestamp()});setResult({score,correct,duration});setPhase("done");setWarning("");if(document.fullscreenElement)await document.exitFullscreen();}
    catch{setError("Jawaban belum dapat dikirim. Periksa koneksi lalu coba lagi.");submittingRef.current=false;}
  }

  if(loading)return <PublicFrame><div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-teal-600" size={34}/></div></PublicFrame>;
  if(!snapshot)return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={40}/><h1 className="mt-4 text-2xl font-black">Ulangan tidak tersedia</h1><p className="mt-2 text-sm text-slate-500">{error||"Minta link terbaru kepada guru."}</p></div></PublicFrame>;
  if(phase==="done")return <PublicFrame><div className="mx-auto max-w-xl text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-emerald-100 text-emerald-600"><CheckCircle2 size={40}/></div><h1 className="mt-6 text-3xl font-black">Ujian selesai</h1><p className="mt-2 text-slate-500">Jawaban {student?.name} telah tersimpan.</p><div className="mx-auto mt-8 max-w-sm rounded-2xl bg-slate-950 p-6 text-white"><p className="text-xs text-slate-400">Nilai</p><p className="mt-2 text-5xl font-black text-teal-300">{result.score}</p><p className="mt-2 text-xs text-slate-400">{result.correct} benar dari {snapshot.questions.length} soal · {formatCountdown(result.duration)}</p></div></div></PublicFrame>;
  if(phase==="login")return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700">ULANGAN ONLINE</span><h1 className="mt-5 text-2xl font-black">{snapshot.title}</h1><p className="mt-2 text-sm text-slate-500">{snapshot.subject} · {snapshot.className}</p><div className="mt-5 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-3"><p className="font-black">{snapshot.questions.length}</p><p className="text-[10px] text-slate-400">Soal</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="font-black">{snapshot.durationMinutes}</p><p className="text-[10px] text-slate-400">Menit</p></div></div><label className="mt-6 block"><span className="mb-2 block text-xs font-extrabold">Masukkan NIS</span><input value={nis} onChange={(event)=>{setNis(event.target.value);setError("")}} placeholder="Nomor induk siswa" className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-teal-500"/></label>{error&&<p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}<div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><ShieldCheck className="mr-1 inline" size={15}/>Soal dan pilihan jawaban diacak secara konsisten. Ujian wajib fullscreen; perpindahan tab atau aplikasi dicatat untuk guru.</div><button disabled={!nis.trim()} onClick={()=>void startQuiz()} className="mt-5 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">Masuk fullscreen & mulai</button></div></PublicFrame>;
  const question=quiz[current];const answeredCount=Object.keys(answers).length;
  return <PublicFrame><div className="mx-auto max-w-3xl"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-white"><div><p className="text-[10px] text-slate-400">SOAL {current+1} DARI {quiz.length} · {answeredCount} TERJAWAB</p><p className="text-xs font-bold">{student?.name} · NIS {student?.nis}</p></div><div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${remaining<=300?'bg-rose-500/20 text-rose-200':'bg-white/10 text-teal-300'}`}><Timer size={17}/>{formatCountdown(remaining)}</div></div><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-xs font-black text-teal-600">PERTANYAAN {String(current+1).padStart(2,"0")}</p><h1 className="mt-4 text-xl font-black leading-relaxed">{question.question}</h1><div className="mt-7 space-y-3">{question.choices.map((choice,index)=>{const selected=answers[String(current)]===choice.originalChoiceIndex;return <button key={`${choice.originalChoiceIndex}-${choice.text}`} onClick={()=>void selectAnswer(choice.originalChoiceIndex)} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left text-sm font-bold transition ${selected?'border-teal-500 bg-teal-50 text-teal-800':'border-slate-200 hover:border-slate-300'}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${selected?'bg-teal-600 text-white':'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65+index)}</span>{choice.text}</button>})}</div><div className="mt-7 flex flex-wrap items-center justify-between gap-3"><button disabled={current===0} onClick={()=>setCurrent((value)=>Math.max(0,value-1))} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold disabled:opacity-30"><ArrowLeft className="mr-2 inline" size={15}/>Sebelumnya</button>{current<quiz.length-1?<button onClick={()=>setCurrent((value)=>Math.min(quiz.length-1,value+1))} className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-extrabold text-white">Berikutnya<ChevronRight className="ml-2 inline" size={15}/></button>:<button onClick={()=>void finishQuiz(false)} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-extrabold text-white">Kirim semua jawaban</button>}</div></section><p className={`mt-4 text-center text-xs font-bold ${violationCount?'text-rose-600':'text-slate-400'}`}>{violationCount} aktivitas keluar/pindah tab tercatat</p></div>{warning&&<div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/80 p-5"><div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl"><ShieldCheck className="mx-auto text-rose-600" size={42}/><h2 className="mt-4 text-2xl font-black">Peringatan ujian</h2><p className="mt-3 text-sm leading-6 text-slate-600">{warning}</p><button onClick={()=>void enterFullscreen()} className="mt-6 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white">Kembali ke fullscreen</button></div></div>}</PublicFrame>;
}

function PublicQuiz(){const [started,setStarted]=useState(false);const [nis,setNis]=useState("");const [answer,setAnswer]=useState<number|null>(null);const [done,setDone]=useState(false);if(done)return <PublicFrame><div className="mx-auto max-w-xl text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-emerald-100 text-emerald-600"><CheckCircle2 size={40}/></div><h1 className="mt-6 text-3xl font-black">Ujian selesai!</h1><p className="mt-2 text-slate-500">Jawaban Anda telah tersimpan.</p><div className="mx-auto mt-8 max-w-sm rounded-2xl bg-slate-950 p-6 text-white"><p className="text-xs text-slate-400">Nilai sementara</p><p className="mt-2 text-5xl font-black text-teal-300">85</p><p className="mt-2 text-xs text-slate-400">17 benar dari 20 soal</p></div></div></PublicFrame>;if(!started)return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><span className="rounded-full bg-sky-50 px-3 py-1.5 text-[10px] font-black text-sky-700">ULANGAN AKTIF</span><h1 className="mt-5 text-2xl font-black">Kuis Matematika — Persamaan Linear</h1><div className="mt-5 grid grid-cols-3 gap-2 text-center">{[['20','Soal'],['60','Menit'],['75','KKM']].map(([v,l])=><div key={l} className="rounded-xl bg-slate-50 p-3"><p className="font-black">{v}</p><p className="text-[10px] text-slate-400">{l}</p></div>)}</div><label className="mt-6 block"><span className="mb-2 block text-xs font-extrabold">Masukkan NIS</span><input value={nis} onChange={(e)=>setNis(e.target.value)} placeholder="Contoh: 24001" className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-teal-500"/></label><div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><ShieldCheck className="mr-1 inline" size={15}/>Ujian wajib fullscreen. Perpindahan tab dan perangkat akan dicatat.</div><button disabled={!nis} onClick={()=>setStarted(true)} className="mt-5 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">Mulai ujian</button></div></PublicFrame>;return <PublicFrame><div className="mx-auto max-w-3xl"><div className="mb-5 flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white"><div><p className="text-[10px] text-slate-400">SOAL 1 DARI 20</p><p className="text-xs font-bold">NIS {nis}</p></div><div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-teal-300"><Timer size={17}/>59:42</div></div><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-xs font-black text-teal-600">PERTANYAAN 01</p><h1 className="mt-4 text-xl font-black leading-relaxed">Nilai x yang memenuhi persamaan 3x + 5 = 20 adalah...</h1><div className="mt-7 space-y-3">{['3','5','7','15'].map((item,i)=><button key={item} onClick={()=>setAnswer(i)} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left text-sm font-bold transition ${answer===i?'border-teal-500 bg-teal-50 text-teal-800':'border-slate-200 hover:border-slate-300'}`}><span className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-black ${answer===i?'bg-teal-600 text-white':'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65+i)}</span>{item}</button>)}</div><div className="mt-7 flex justify-end"><button disabled={answer===null} onClick={()=>setDone(true)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-40">Simpan & lanjutkan<ChevronRight size={16}/></button></div></section></div></PublicFrame>}
function PublicTask(){
  const pathname=usePathname();
  const snapshotId=decodeURIComponent(pathname.split("/").filter(Boolean).at(-1)??"demo");
  const [task,setTask]=useState<TaskRecord|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{
    setLoading(true);setError("");
    if(snapshotId.startsWith("demo")){setTask(demoTasks.find((item)=>item.snapshotId===snapshotId)??demoTasks[0]);setLoading(false);return;}
    void getDoc(doc(db,"publicSnapshots",snapshotId)).then((result)=>{
      if(!result.exists()||result.data().type!=="task"||result.data().published!==true)throw new Error("Tugas tidak ditemukan atau link sudah dinonaktifkan.");
      const data=result.data() as Omit<TaskRecord,"id">;
      setTask({id:data.snapshotId??snapshotId,...data});
    }).catch((reason)=>setError(reason instanceof Error?reason.message:"Tugas tidak dapat dibuka.")).finally(()=>setLoading(false));
  },[snapshotId]);

  if(loading)return <PublicFrame><div className="grid min-h-64 place-items-center"><div className="text-center"><Loader2 className="mx-auto animate-spin text-teal-600" size={34}/><p className="mt-3 text-sm font-bold text-slate-500">Memuat tugas...</p></div></div></PublicFrame>;
  if(error||!task)return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-600"><XCircle size={30}/></div><h1 className="mt-5 text-2xl font-black">Link tugas tidak tersedia</h1><p className="mt-2 text-sm leading-6 text-slate-500">{error||"Silakan minta link terbaru kepada guru."}</p></div></PublicFrame>;
  const expired=new Date(task.deadline).getTime()<Date.now();
  return <PublicFrame><div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-9"><div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-lg bg-violet-50 px-3 py-1.5 text-[10px] font-black uppercase text-violet-700">{task.subject} · {task.className}</span><span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${expired?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700'}`}>{expired?'TENGGAT BERAKHIR':'TUGAS AKTIF'}</span></div><h1 className="mt-5 text-3xl font-black leading-tight">{task.title}</h1><div className="mt-6 rounded-2xl bg-slate-50 p-5"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Instruksi tugas</p><p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">{task.description}</p></div><div className="mt-7 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">DIBUAT OLEH</p><p className="mt-1 text-sm font-black">{task.teacherName||"Guru"}</p></div><div className={`rounded-2xl p-4 ${expired?'bg-rose-50':'bg-teal-50'}`}><p className={`text-[10px] font-bold ${expired?'text-rose-400':'text-teal-500'}`}>TENGGAT</p><p className={`mt-1 text-sm font-black ${expired?'text-rose-700':'text-teal-800'}`}>{taskDeadlineLabel(task.deadline)}</p></div></div><div className="mt-7 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm leading-6 text-sky-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><p>Catat instruksi ini dan kumpulkan pekerjaan sesuai arahan guru sebelum tenggat waktu.</p></div></div></PublicFrame>
}
function AbsenceConfirmationForm(){
  const pathname=usePathname();
  const snapshotId=decodeURIComponent(pathname.split("/").filter(Boolean).at(-1)??"demo-1");
  const [snapshot,setSnapshot]=useState<AbsenceSnapshot|null>(null);
  const [attendanceStatus,setAttendanceStatus]=useState<"sick"|"permission"|"">("");
  const [reason,setReason]=useState("");
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    if(snapshotId.startsWith("demo-")){
      const studentId=snapshotId.slice("demo-".length);
      const student=demoStudents.find((item)=>item.id===studentId)??demoStudents[0];
      setSnapshot({type:"absence",ownerUid:"demo",sessionId:"demo-session",published:true,schoolName:"SMP Harapan Bangsa",dateLabel:new Intl.DateTimeFormat("id-ID",{dateStyle:"full"}).format(new Date()),student:{id:student.id,nis:student.nis,name:student.name,className:student.className}});
      setLoading(false);return;
    }
    void getDoc(doc(db,"publicSnapshots",snapshotId)).then((result)=>{
      if(!result.exists()||result.data().published!==true||result.data().type!=="absence")throw new Error("Link konfirmasi tidak tersedia atau sudah digunakan.");
      setSnapshot(result.data() as AbsenceSnapshot);
    }).catch((reason)=>setError(reason instanceof Error?reason.message:"Link konfirmasi tidak dapat dibuka.")).finally(()=>setLoading(false));
  },[snapshotId]);

  async function submit(event:React.FormEvent){
    event.preventDefault();
    if(!snapshot||!attendanceStatus)return;
    if(reason.trim().length<3){setError("Tuliskan keterangan sakit atau alasan izin dengan jelas.");return;}
    setSubmitting(true);setError("");
    try{
      if(!snapshotId.startsWith("demo-"))await addDoc(collection(db,"publicAbsenceResponses"),{
        snapshotId,
        ...(snapshot.schoolId?{schoolId:snapshot.schoolId}:{}),
        ownerUid:snapshot.ownerUid,
        sessionId:snapshot.sessionId,
        studentId:snapshot.student.id,
        nis:snapshot.student.nis,
        studentName:snapshot.student.name,
        className:snapshot.student.className,
        attendanceStatus,
        reason:reason.trim(),
        status:"pending",
        createdAt:serverTimestamp(),
      });
      setDone(true);
    }catch{setError("Konfirmasi belum dapat dikirim. Silakan coba lagi.");}
    finally{setSubmitting(false)}
  }

  if(loading)return <PublicFrame><div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-teal-600" size={32}/></div></PublicFrame>;
  if(done)return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-xl"><CheckCircle2 className="mx-auto text-emerald-600" size={58}/><h1 className="mt-5 text-2xl font-black">Konfirmasi berhasil dikirim</h1><p className="mt-2 text-sm leading-6 text-slate-500">Status {attendanceStatus==="sick"?"Sakit":"Izin"} dan keterangannya otomatis masuk ke absensi {snapshot?.student.name}.</p></div></PublicFrame>;
  if(!snapshot)return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={55}/><h1 className="mt-5 text-xl font-black">Link tidak tersedia</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></PublicFrame>;

  return <PublicFrame><form onSubmit={submit} className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
    <p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Konfirmasi Ketidakhadiran</p>
    <h1 className="mt-2 text-2xl font-black">Sakit atau izin?</h1>
    <p className="mt-2 text-sm leading-6 text-slate-500">Silakan konfirmasi status kehadiran siswa kepada {snapshot.schoolName}.</p>
    <div className="mt-6 rounded-2xl bg-slate-50 p-4"><p className="font-black">{snapshot.student.name}</p><p className="mt-1 text-xs text-slate-500">NIS {snapshot.student.nis} · Kelas {snapshot.student.className}</p><p className="mt-1 text-[10px] font-bold text-slate-400">Absensi {snapshot.dateLabel}</p></div>
    <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={()=>setAttendanceStatus("sick")} className={`rounded-2xl border p-4 text-left transition ${attendanceStatus==="sick"?"border-sky-500 bg-sky-50 text-sky-800":"border-slate-200"}`}><p className="font-black">Sakit</p><p className="mt-1 text-[10px]">Isi sakit yang dialami.</p></button><button type="button" onClick={()=>setAttendanceStatus("permission")} className={`rounded-2xl border p-4 text-left transition ${attendanceStatus==="permission"?"border-violet-500 bg-violet-50 text-violet-800":"border-slate-200"}`}><p className="font-black">Izin</p><p className="mt-1 text-[10px]">Isi alasan tidak masuk.</p></button></div>
    {attendanceStatus&&<label className="mt-5 block"><span className="mb-2 block text-xs font-extrabold">{attendanceStatus==="sick"?"Sakit apa?":"Apa alasan izinnya?"}</span><textarea value={reason} onChange={(event)=>{setReason(event.target.value);setError("")}} rows={4} maxLength={300} placeholder={attendanceStatus==="sick"?"Contoh: demam dan batuk, sedang istirahat di rumah.":"Contoh: menghadiri acara keluarga di luar kota."} className="w-full resize-none rounded-xl border border-slate-200 p-4 text-sm outline-none focus:border-teal-500"/><p className="mt-1 text-right text-[10px] text-slate-400">{reason.length}/300</p></label>}
    {error&&<p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}
    <button disabled={!attendanceStatus||reason.trim().length<3||submitting} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">{submitting&&<Loader2 className="animate-spin" size={17}/>}Kirim konfirmasi</button>
  </form></PublicFrame>;
}

function GuardianDataForm() {
  const pathname = usePathname();
  const snapshotId = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "demo");
  const [snapshot, setSnapshot] = useState<{ ownerUid: string; schoolName: string; academicYear: string; className: string; students: Student[] } | null>(null);
  const [nis, setNis] = useState("");
  const [guardian, setGuardian] = useState("");
  const [phone, setPhone] = useState("");
  const [student, setStudent] = useState<any>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoThumbnail, setPhotoThumbnail] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  useEffect(() => {
    if (snapshotId === "demo") {
      setSnapshot({ ownerUid: "demo", schoolName: "Sekolah Demo SMART-ATT", academicYear: "2026/2027", className: "V-A", students: demoStudents.filter((item) => item.className === "V-A") });
      setLoading(false);
      return;
    }
    void getDoc(doc(db, "publicSnapshots", snapshotId)).then((result) => {
      if (!result.exists() || result.data().published !== true || result.data().type !== "guardian") throw new Error("Link pendataan tidak ditemukan atau sudah dinonaktifkan.");
      const data = result.data() as { ownerUid: string; schoolName?: string; academicYear?: string; className: string; students: Student[] };
      setSnapshot({ ownerUid: data.ownerUid, schoolName: data.schoolName ?? "SMART-ATT", academicYear: data.academicYear ?? "-", className: data.className, students: data.students ?? [] });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Link tidak dapat dibuka."))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  function findStudent() {
    setError(""); setStudent(null); setGuardian(""); setPhone(""); setPhoto(null); setPhotoThumbnail(null); setPhotoPreview("");
    if (!snapshot) return;
    const match = snapshot.students.find((item) => item.nis.trim() === nis.trim());
    if (!match) { setError("NIS tidak ditemukan pada data kelas ini."); return; }
    setStudent(match);
  }

  async function chooseGuardianPhoto(file: File | null) {
    if (!file) return;
    const supported = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!supported) { setError("Gunakan foto JPG, PNG, atau WebP."); return; }
    if (file.size > 15 * 1024 * 1024) { setError("Ukuran foto awal maksimal 15 MB."); return; }
    setPhotoBusy(true); setError("");
    try {
      const resized = await resizeStudentPhoto(file, 500 * 1024);
      const thumbnail = await createStudentThumbnail(resized, "3:4", 1, 0, 0, 120 * 1024);
      setPhoto(resized); setPhotoThumbnail(thumbnail); setPhotoPreview(URL.createObjectURL(thumbnail));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Foto gagal diproses."); }
    finally { setPhotoBusy(false); }
  }

  async function uploadGuardianPhoto(file: File, variant: "photo" | "thumbnail") {
    if (!student) throw new Error("Data siswa belum dipilih.");
    const form = new FormData(); form.append("file", file); form.append("snapshotId", snapshotId); form.append("studentId", student.id); form.append("variant", variant);
    const response = await fetch("/api/storage/public-guardian-photo", { method: "POST", body: form });
    if (!response.ok) { const result = await response.json().catch(() => null) as { error?: string } | null; throw new Error(result?.error ?? "Foto gagal diunggah."); }
    return (await response.json() as { key: string }).key;
  }

  async function submitGuardian(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || !student) return;
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0/, "62");
    if (guardian.trim().length < 3) { setError("Nama orang tua / wali belum lengkap."); return; }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 15) { setError("Nomor WhatsApp tidak valid."); return; }
    setSubmitting(true); setError("");
    try {
      if (snapshotId !== "demo") {
        const photoPayload = photo && photoThumbnail ? await Promise.all([uploadGuardianPhoto(photo, "photo"), uploadGuardianPhoto(photoThumbnail, "thumbnail")]).then(([photoKey, photoThumbnailKey]) => ({ photoKey, photoThumbnailKey, photoAspect: "3:4" as const })) : {};
        await addDoc(collection(db, "publicResponses"), {
          snapshotId, ownerUid: snapshot.ownerUid, studentId: student.id, attendanceNumber: student.attendanceNumber ?? "", nis: student.nis, studentName: student.name, className: student.className,
          guardian: guardian.trim(), phone: normalizedPhone, ...photoPayload, status: "pending", createdAt: serverTimestamp(),
        });
      }
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Data belum dapat dikirim. Silakan coba kembali."); }
    finally { setSubmitting(false); }
  }

  if (loading) return <PublicFrame><div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-teal-600" size={30}/></div></PublicFrame>;
  if (done) return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-xl"><CheckCircle2 className="mx-auto text-emerald-600" size={60}/><h1 className="mt-5 text-2xl font-black">Data berhasil dikirim</h1><p className="mt-2 text-sm leading-6 text-slate-500">Terima kasih. Data wali{photo ? " dan foto siswa" : ""} akan otomatis masuk setelah guru membuka SMART-ATT.</p></div></PublicFrame>;
  if (!snapshot) return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={55}/><h1 className="mt-5 text-xl font-black">Link tidak tersedia</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></PublicFrame>;
  if (student && error) return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={55}/><h1 className="mt-5 text-xl font-black">Data belum terkirim</h1><p className="mt-2 text-sm leading-6 text-slate-600">{error}</p><button type="button" onClick={() => setError("")} className="mt-6 w-full rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white">Kembali ke formulir</button></div></PublicFrame>;
  if (student) return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-wider text-teal-600">Pendataan Wali Murid · {snapshot.className}</p><h1 className="mt-2 text-2xl font-black">Lengkapi data wali siswa</h1><p className="mt-2 text-sm leading-6 text-slate-500">Periksa kartu siswa, lalu lengkapi nama wali dan nomor WhatsApp.</p><div className="mt-6"><Field label="NIS" value={nis} onChange={setNis} placeholder="Contoh: 20260101" required/></div><button onClick={findStudent} className="mt-3 w-full rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white">Cari ulang siswa</button><form onSubmit={submitGuardian} className="mt-6 space-y-5 border-t border-slate-100 pt-6"><StudentQrCard student={student} schoolName={snapshot.schoolName} academicYear={snapshot.academicYear} template="photo" photoSrc={photoPreview}/><div><p className="text-xs font-extrabold text-slate-700">Foto siswa <span className="font-normal text-slate-400">(opsional)</span></p><div className="mt-2 grid grid-cols-2 gap-3"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-black text-slate-700"><ImagePlus size={16}/>Pilih dari galeri<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void chooseGuardianPhoto(event.target.files?.[0] ?? null)}/></label><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-3 text-xs font-black text-white"><Camera size={16}/>Foto langsung<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void chooseGuardianPhoto(event.target.files?.[0] ?? null)}/></label></div>{photoBusy&&<p className="mt-2 flex items-center gap-2 text-[10px] font-bold text-sky-700"><Loader2 className="animate-spin" size={13}/>Memproses foto...</p>}</div><Field label="Nama orang tua / wali" value={guardian} onChange={setGuardian} placeholder="Nama lengkap wali" required/><Field label="Nomor WhatsApp aktif" value={phone} onChange={setPhone} placeholder="Contoh: 081234567890" required/><p className="rounded-xl bg-sky-50 p-3 text-[11px] leading-5 text-sky-700">Nomor WhatsApp digunakan sekolah untuk informasi kehadiran dan komunikasi wali kelas.</p><button disabled={submitting||photoBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{submitting?<Loader2 className="animate-spin" size={17}/>:<Send size={17}/>}Kirim data wali</button></form></div></PublicFrame>;

  return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-wider text-teal-600">Pendataan Wali Murid · {snapshot.className}</p><h1 className="mt-2 text-2xl font-black">Lengkapi data wali siswa</h1><p className="mt-2 text-sm leading-6 text-slate-500">Masukkan NIS sesuai data sekolah untuk menemukan siswa.</p><div className="mt-6"><Field label="NIS" value={nis} onChange={setNis} placeholder="Contoh: 20260101" required/></div><button onClick={findStudent} className="mt-3 w-full rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white">Cari data siswa</button>{error&&<p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}{student&&<form onSubmit={submitGuardian} className="mt-6 space-y-5 border-t border-slate-100 pt-6"><section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-300 via-sky-200 to-white p-4 shadow-sm"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src="/logo.png" alt="SMART-ATT" className="h-8 w-8 object-contain"/><div><p className="text-[10px] font-black tracking-wide text-sky-950">KARTU SISWA</p><p className="max-w-48 truncate text-[9px] font-bold text-sky-800">{snapshot.schoolName}</p></div></div><span className="text-[9px] font-black text-sky-900">SMART-ATT</span></div><div className="mt-4 grid grid-cols-[86px_1fr] gap-4"><div className="grid aspect-[3/4] overflow-hidden border-2 border-white bg-white/70 shadow-sm">{photoPreview?<img src={photoPreview} alt={`Foto ${student.name}`} className="h-full w-full object-cover"/>:<div className="grid place-items-center text-center text-sky-700"><CircleUserRound size={35}/><span className="px-1 text-[8px] font-bold">Belum ada foto</span></div>}</div><div className="min-w-0 self-center"><p className="text-lg font-black leading-tight text-slate-950">{student.name}</p><dl className="mt-3 grid grid-cols-[42px_1fr] gap-y-1 text-[10px] text-slate-700"><dt className="font-black">NIS</dt><dd>: {student.nis}</dd><dt className="font-black">Kelas</dt><dd>: {student.className}</dd>{student.attendanceNumber&&<><dt className="font-black">Absen</dt><dd>: {student.attendanceNumber}</dd></>}</dl></div></div></section><div><p className="text-xs font-extrabold text-slate-700">Foto siswa <span className="font-normal text-slate-400">(opsional)</span></p><div className="mt-2 grid grid-cols-2 gap-3"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-black text-slate-700"><ImagePlus size={16}/>Pilih dari galeri<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void chooseGuardianPhoto(event.target.files?.[0] ?? null)}/></label><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-3 text-xs font-black text-white"><Camera size={16}/>Foto langsung<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void chooseGuardianPhoto(event.target.files?.[0] ?? null)}/></label></div>{photoBusy&&<p className="mt-2 flex items-center gap-2 text-[10px] font-bold text-sky-700"><Loader2 className="animate-spin" size={13}/>Memproses foto...</p>}</div><Field label="Nama orang tua / wali" value={guardian} onChange={setGuardian} placeholder="Nama lengkap wali" required/><Field label="Nomor WhatsApp aktif" value={phone} onChange={setPhone} placeholder="Contoh: 081234567890" required/><p className="rounded-xl bg-sky-50 p-3 text-[11px] leading-5 text-sky-700">Nomor WhatsApp digunakan sekolah untuk informasi kehadiran dan komunikasi wali kelas.</p><button disabled={submitting||photoBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{submitting?<Loader2 className="animate-spin" size={17}/>:<Send size={17}/>}Kirim data wali</button></form>}</div></PublicFrame>;
}
function PublicFrame({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8faf7,transparent_35%),linear-gradient(135deg,#f7fbff,#fffaf0)] px-4 py-8 sm:py-12"><header className="mx-auto mb-10 flex max-w-5xl items-center justify-between"><Logo/><span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 sm:block">Portal Publik Siswa</span></header>{children}</main>}

export default SmartAttApp;
