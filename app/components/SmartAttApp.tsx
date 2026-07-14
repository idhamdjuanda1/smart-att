"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity, AlarmClock, ArrowLeft, BarChart3, Bell, BookOpen, Bot, CalendarDays,
  Camera, Check, CheckCircle2, ChevronDown, ChevronRight, CircleUserRound, ClipboardCheck,
  Clock3, Copy, Download, FileDown, FileText, GraduationCap, HelpCircle, Home, KeyRound,
  LayoutDashboard, Link2, ListChecks, Loader2, LockKeyhole, LogOut, Menu, MessageCircle,
  MoreHorizontal, PencilLine, Plus, Printer, QrCode, RefreshCcw, ScanLine, School,
  Search, Send, Settings, ShieldCheck, Sparkles, Timer, Trash2, Upload, UserCheck,
  UserPlus, Users, X, XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, type User,
} from "firebase/auth";
import {
  addDoc, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { parseStudentsCsv } from "../lib/csv";
import { parseAiQuizText, type QuizQuestion } from "../lib/quiz";
import { createRandomizedQuiz, escapeHtml, formatCountdown, type RandomizedQuestion } from "../lib/quizRuntime";
import { createStudentThumbnail, drawStudentCrop, loadPhoto, resizeStudentPhoto, type PhotoAspect } from "../lib/studentPhoto";
import { findStudentByQrOrNis } from "../lib/attendance";
import { AcademicView, ScoresView } from "./GradeViews";
import { AttendanceViewPro, ScannerViewPro } from "./OperationalViews";
import { PublicQuizProfessional } from "./ExamPortal";
import { ProfileProfessional, SuperAdminProfessional } from "./AdminViews";

type Student = {
  id: string;
  attendanceNumber?: string;
  nis: string;
  name: string;
  className: string;
  guardian?: string;
  phone?: string;
  photoKey?: string;
  photoThumbnailKey?: string;
  photoAspect?: PhotoAspect;
};

type AttendanceStatus = "present" | "sick" | "permission";

type AttendanceRecord = {
  studentId: string;
  status: AttendanceStatus;
  recordedAtMs: number;
  source: "qr" | "manual" | "guardian";
  reason?: string;
};

type AttendanceSession = {
  id: string;
  className: string;
  schoolName: string;
  status: "open" | "closed";
  startedAtMs: number;
  closedAtMs?: number;
  records: Record<string, AttendanceRecord>;
};

type AbsenceSnapshot = {
  type: "absence";
  ownerUid: string;
  sessionId: string;
  published: boolean;
  schoolName: string;
  dateLabel: string;
  student: Pick<Student, "id" | "nis" | "name" | "className">;
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
  subject: string;
  className: string;
  chapter?: string;
  questions: QuizQuestion[];
  status: "draft" | "scheduled" | "published" | "finished";
  source?: "ai" | "manual";
  snapshotId?: string;
durationMinutes?: number;
  startAtMs?: number;
  endAtMs?: number;
  targetStudentCount?: number;
  createdAt?: { toMillis?: () => number; toDate?: () => Date } | null;
};

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
  students: Pick<Student, "id" | "nis" | "name" | "className">[];
};

type NavKey = "dashboard" | "students" | "scan" | "attendance" | "tasks" | "exams" | "ai" | "scores" | "profile" | "academic";
type Toast = { message: string; tone: "success" | "error" } | null;

const SUPERADMIN_EMAIL = (process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL ?? "idhamdjuanda@gmail.com").toLowerCase();

const GRADE_CATEGORIES: { key: GradeCategory; label: string; description: string }[] = [
  { key: "task", label: "Tugas", description: "Tugas aplikasi dan tugas offline" },
  { key: "quiz", label: "Quiz", description: "Kuis singkat dan evaluasi formatif" },
  { key: "summative", label: "Ulangan Harian / Sumatif", description: "Soal & Ulangan reguler" },
  { key: "midterm", label: "PTS / STS", description: "Penilaian tengah semester" },
  { key: "final", label: "PAS / SAS", description: "Penilaian akhir semester" },
  { key: "practice", label: "Praktik", description: "Praktik, lisan, hafalan, dan presentasi" },
  { key: "project", label: "Project", description: "Proyek individu atau kelompok" },
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
  { value: "quiz", label: "Quiz", category: "quiz" },
  { value: "daily_test", label: "Soal & Ulangan", category: "summative" },
  { value: "pts_sts", label: "PTS / STS", category: "midterm" },
  { value: "pas_sas", label: "PAS / SAS", category: "final" },
  { value: "practice", label: "Praktik", category: "practice" },
  { value: "oral", label: "Lisan", category: "practice" },
  { value: "memorization", label: "Hafalan", category: "practice" },
  { value: "presentation", label: "Presentasi", category: "practice" },
  { value: "project", label: "Project", category: "project" },
  { value: "attitude", label: "Sikap", category: "attitude" },
];

const DEFAULT_ACADEMIC_SETTINGS: AcademicSettings = {
  schoolName: "SMP Harapan Bangsa",
  academicYear: "2026/2027",
  semester: "Ganjil",
  classNames: ["VII A", "VII B"],
  entryTime: "07:00",
  kkm: 75,
};

const demoStudents: Student[] = [
  { id: "1", attendanceNumber: "1", nis: "24001", name: "Alya Putri Ramadhani", className: "VII A", guardian: "Dian Ramadhani", phone: "628123456781" },
  { id: "2", attendanceNumber: "2", nis: "24002", name: "Bima Arya Pratama", className: "VII A", guardian: "Rudi Pratama", phone: "628123456782" },
  { id: "3", attendanceNumber: "3", nis: "24003", name: "Citra Lestari", className: "VII A", guardian: "Siti Lestari", phone: "628123456783" },
  { id: "4", attendanceNumber: "1", nis: "24004", name: "Daffa Maulana", className: "VII B", guardian: "Hendra Maulana", phone: "628123456784" },
  { id: "5", attendanceNumber: "2", nis: "24005", name: "Eka Nuraini", className: "VII B", guardian: "Nur Hasanah", phone: "628123456785" },
];

const demoTasks: TaskRecord[] = [
  { id: "demo-task-1", subject: "Matematika", className: "VII A", title: "Persamaan Linear Satu Variabel", description: "Kerjakan soal latihan pada buku paket halaman 42 nomor 1–10. Tuliskan cara penyelesaian dengan lengkap di buku tugas.", deadline: "2026-07-15T23:59", published: true, snapshotId: "demo", teacherName: "Tomi Guru" },
  { id: "demo-task-2", subject: "Bahasa Indonesia", className: "VII B", title: "Meringkas Teks Eksplanasi", description: "Baca teks eksplanasi yang dibagikan, lalu buat ringkasan sebanyak tiga paragraf menggunakan bahasa sendiri.", deadline: "2026-07-18T20:00", published: true, snapshotId: "demo-2", teacherName: "Tomi Guru" },
  { id: "demo-task-3", subject: "IPA", className: "VII A", title: "Pengamatan Ekosistem Sekolah", description: "Catat lima komponen biotik dan abiotik yang ditemukan di lingkungan sekolah.", deadline: "2026-07-10T15:00", published: false, teacherName: "Tomi Guru" },
];

const navGroups: { label: string; items: { key: NavKey; label: string; icon: typeof Home }[] }[] = [
  { label: "UTAMA", items: [
    { key: "dashboard", label: "Ringkasan", icon: LayoutDashboard },
    { key: "students", label: "Data Siswa", icon: Users },
    { key: "scan", label: "Scan Absensi", icon: ScanLine },
    { key: "attendance", label: "Rekap Absensi", icon: BarChart3 },
  ] },
  { label: "PEMBELAJARAN", items: [
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
        <p className="text-[11px] font-medium text-slate-500">Absensi QR & Smart Quiz</p>
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
          <div className="mt-10 grid grid-cols-3 gap-4">
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
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && <>
              <Field label="Nama lengkap" value={name} onChange={setName} placeholder="Nama guru" required />
              <Field label="Nama sekolah" value={schoolName} onChange={setSchoolName} placeholder="SMP Harapan Bangsa" required />
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
          <button onClick={onDemo} className="h-12 w-full rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700">Lihat demo dashboard guru</button>
          <p className="mt-8 text-center text-xs leading-5 text-slate-400">Dengan masuk, Anda menyetujui ketentuan layanan dan kebijakan privasi SMART-ATT.</p>
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">{label}</span><input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" /></label>;
}

function SmartAttApp() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<NavKey>("dashboard");
  const [students, setStudents] = useState<Student[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [accountDisabled, setAccountDisabled] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true); }), []);
  useEffect(() => {
    if (!user) { setAccountDisabled(false); return; }
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
    const unsubscribe = onSnapshot(userRef, (snapshot) => setAccountDisabled(snapshot.data()?.disabled === true || snapshot.data()?.status === "disabled"));
    return () => {
      clearInterval(heartbeat); document.removeEventListener("visibilitychange", visibility); unsubscribe();
      void updateDoc(userRef, { online: false, lastSeenAtMs: Date.now(), updatedAt: serverTimestamp() }).catch(() => undefined);
    };
  }, [user]);
  useEffect(() => {
    if (!user) { setStudents(demoStudents); return; }
    setStudents([]);
    const q = query(collection(db, "users", user.uid, "students"), orderBy("name"));
    return onSnapshot(q, (snap) => setStudents(snap.docs.map((item) => ({ id: item.id, ...item.data() } as Student))), () => setToast({ message: "Firestore belum siap. Periksa rules dan konfigurasi proyek.", tone: "error" }));
  }, [user, demo]);
  useEffect(() => {
    if (!user) return;
    const responsesQuery = query(collection(db, "publicResponses"), where("ownerUid", "==", user.uid));
    return onSnapshot(responsesQuery, (snapshot) => {
      for (const response of snapshot.docs) {
        const data = response.data() as { studentId?: string; guardian?: string; phone?: string; status?: string };
        if (data.status !== "pending" || !data.studentId || !data.guardian || !data.phone) continue;
        void updateDoc(doc(db, "users", user.uid, "students", data.studentId), {
          guardian: data.guardian,
          phone: data.phone,
          guardianUpdatedAt: serverTimestamp(),
        }).then(() => updateDoc(response.ref, { status: "applied", appliedAt: serverTimestamp() }))
          .catch(() => setToast({ message: "Kiriman wali diterima, tetapi belum dapat disinkronkan.", tone: "error" }));
      }
    }, () => setToast({ message: "Kiriman data wali belum dapat dibaca.", tone: "error" }));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const responsesQuery = query(collection(db, "publicAbsenceResponses"), where("ownerUid", "==", user.uid));
    return onSnapshot(responsesQuery, (snapshot) => {
      for (const response of snapshot.docs) {
        const data = response.data() as { snapshotId?: string; sessionId?: string; studentId?: string; attendanceStatus?: AttendanceStatus; reason?: string; status?: string };
        if (data.status !== "pending" || !data.snapshotId || !data.sessionId || !data.studentId || !data.attendanceStatus || !data.reason) continue;
        const batch = writeBatch(db);
        batch.update(doc(db, "users", user.uid, "attendanceSessions", data.sessionId), {
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
  }, [user]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);

  if (pathname.startsWith("/public/quiz")) return <PublicQuizProfessional />;
  if (pathname.startsWith("/public/task")) return <PublicTask />;
  if (pathname.startsWith("/public/absence")) return <AbsenceConfirmationForm />;
  if (pathname.startsWith("/public/guardian-data")) return <GuardianDataForm />;
  if (pathname.startsWith("/public/guardian")) return <GuardianDataForm />;
  if (!authReady) return <div className="grid min-h-screen place-items-center bg-slate-50"><div className="text-center"><img src="/logo.png" alt="SMART-ATT" className="mx-auto h-20 w-20 animate-pulse rounded-3xl object-cover" /><p className="mt-4 text-sm font-bold text-slate-500">Menyiapkan SMART-ATT...</p></div></div>;
  if (!user && !demo) return <AuthScreen onDemo={() => setDemo(true)} />;
  const isSuperAdmin = user?.email?.toLowerCase() === SUPERADMIN_EMAIL;
  if (isSuperAdmin && (pathname === "/" || pathname.startsWith("/superadmin"))) return <SuperAdminProfessional onLogout={async () => { if (user) await signOut(auth); setDemo(false); window.location.assign("/"); }} />;
  if (pathname.startsWith("/superadmin")) return <SuperAdminDenied onLogout={async () => { if (user) await signOut(auth); setDemo(false); window.location.assign("/"); }} />;
  if (accountDisabled) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-xl"><LockKeyhole className="mx-auto text-rose-600" size={42}/><h1 className="mt-5 text-2xl font-black">Akun dinonaktifkan</h1><p className="mt-2 text-sm leading-6 text-slate-500">Hubungi administrator SMART-ATT untuk mengaktifkan kembali akun sekolah Anda.</p><button onClick={async () => { if (user) await signOut(auth); }} className="mt-6 w-full rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white">Keluar</button></section></main>;

  return <><DashboardShell user={user} demo={demo} view={view} onView={setView} onLogout={async () => { if (user) await signOut(auth); setDemo(false); }} students={students} setStudents={setStudents} setToast={setToast} /><ToastMessage toast={toast} /></>;
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
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5"><Logo/><div className="flex items-center gap-3"><span className="rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black text-white">SUPER ADMIN</span><button onClick={onLogout} className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><LogOut size={18}/></button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 sm:p-8"><SectionHeading eyebrow="Control Center" title="Panel superadmin" description="Kelola aktivasi, trial, dan akun sekolah SMART-ATT."/>
      <div className="grid gap-4 sm:grid-cols-3"><StatCard label="Total akun guru" value="128" note="12 pendaftar bulan ini" icon={Users} tone="bg-sky-50 text-sky-600"/><StatCard label="Akun aktif" value="104" note="81,2% dari total akun" icon={UserCheck} tone="bg-emerald-50 text-emerald-600"/><StatCard label="Trial berjalan" value="17" note="5 berakhir minggu ini" icon={Clock3} tone="bg-amber-50 text-amber-600"/></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[.65fr_1.35fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-3 text-teal-700"><KeyRound size={21}/></div><div><h3 className="font-black">Token aktivasi</h3><p className="text-xs text-slate-400">Buat token sekali pakai.</p></div></div><label className="block"><span className="mb-2 block text-xs font-extrabold">Masa aktif</span><select value={tokenDuration} onChange={(e)=>setTokenDuration(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"><option>1 hari</option><option>14 hari</option><option>1 bulan</option></select></label><button onClick={generateToken} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white"><RefreshCcw size={16}/>Generate token</button>{generatedToken&&<div className="mt-4 rounded-xl bg-slate-950 p-4 text-center"><p className="text-[10px] font-bold text-slate-400">TOKEN · {tokenDuration.toUpperCase()}</p><p className="mt-2 font-mono text-lg font-black tracking-wider text-teal-300">{generatedToken}</p></div>}</section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h3 className="font-black">Akun sekolah</h3><p className="mt-1 text-xs text-slate-400">Status langganan dan masa berlaku.</p></div><div className="relative hidden sm:block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15}/><input placeholder="Cari akun..." className="h-10 rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none"/></div></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Guru</th><th className="px-4 py-3">Sekolah</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sisa aktif</th><th className="px-5 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{accounts.map((account)=><tr key={account.email}><td className="px-5 py-4"><p className="text-sm font-extrabold">{account.name}</p><p className="text-[10px] text-slate-400">{account.email}</p></td><td className="px-4 py-4 text-xs font-bold text-slate-600">{account.school}</td><td className="px-4 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${account.status==='Aktif'?'bg-emerald-50 text-emerald-700':account.status==='Trial'?'bg-amber-50 text-amber-700':'bg-rose-50 text-rose-700'}`}>{account.status}</span></td><td className="px-4 py-4 text-xs font-bold">{account.remaining}</td><td className="px-5 py-4 text-right"><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section></div>
    </div>
  </main>;
}

function DashboardShell({ user, demo, view, onView, onLogout, students, setStudents, setToast }: { user: User | null; demo: boolean; view: NavKey; onView: (v: NavKey) => void; onLogout: () => void; students: Student[]; setStudents: React.Dispatch<React.SetStateAction<Student[]>>; setToast: (t: Toast) => void }) {
  const [mobileNav, setMobileNav] = useState(false);
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
  return (
    <div className="min-h-screen bg-[#f4f7f9] text-slate-900">
      {mobileNav && <button aria-label="Tutup menu" className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(86vw,300px)] flex-col border-r border-slate-200 bg-white px-4 pb-5 pt-6 transition-transform duration-300 sm:w-[270px] lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-7 flex items-center justify-between px-2"><Logo /><button onClick={() => setMobileNav(false)} className="rounded-lg p-2 text-slate-500 lg:hidden"><X size={20} /></button></div>
        <nav className="scrollbar-none flex-1 overflow-y-auto">
          {navGroups.map((group) => <div key={group.label} className="mb-5"><p className="mb-2 px-3 text-[10px] font-black tracking-[.16em] text-slate-400">{group.label}</p>{group.items.map((item) => { const Icon = item.icon; const active = view === item.key; return <button key={item.key} onClick={() => { onView(item.key); setMobileNav(false); }} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${active ? "bg-teal-600 text-white shadow-md shadow-teal-600/15" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon size={18} strokeWidth={active ? 2.4 : 1.8} /><span className="flex-1">{item.label}</span>{active && <ChevronRight size={15} />}</button>; })}</div>)}
        </nav>
        <div className="rounded-2xl bg-slate-950 p-4 text-white"><div className="mb-3 flex items-center justify-between"><span className="rounded-lg bg-teal-400/15 p-2 text-teal-300"><HelpCircle size={18} /></span><span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[9px] font-black text-emerald-300">AKTIF</span></div><p className="text-sm font-extrabold">Butuh bantuan?</p><p className="mt-1 text-[11px] leading-4 text-slate-400">Panduan penggunaan tersedia untuk setiap modul.</p></div>
      </aside>
      <div className="min-w-0 max-w-full overflow-x-clip lg:pl-[270px]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 sm:h-[74px] sm:px-7 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 lg:hidden"><Menu size={20} /></button><div><p className="text-[11px] font-bold text-slate-400">Tahun Ajaran {academicHeader.academicYear} · {academicHeader.semester}</p><h1 className="text-lg font-black tracking-tight sm:text-xl">{title}</h1></div></div>
          <div className="flex items-center gap-2 sm:gap-3"><button aria-label="Notifikasi" className="relative hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 sm:block"><Bell size={18} /><span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-rose-500" /></button><div className="hidden h-9 w-px bg-slate-200 sm:block" /><button className="hidden items-center gap-3 rounded-xl px-1.5 py-1 transition hover:bg-slate-50 sm:flex"><div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-100 text-sm font-black text-teal-700">TG</div><div className="hidden text-left md:block"><p className="text-xs font-extrabold">{demo ? "Tomi Guru" : user?.email?.split("@")[0]}</p><p className="text-[10px] text-slate-400">Guru · Administrator</p></div><ChevronDown className="hidden text-slate-400 md:block" size={15} /></button><button onClick={onLogout} title="Keluar" className="rounded-xl p-2.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><LogOut size={18} /></button></div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-clip p-3 pb-28 sm:p-7 lg:pb-7">
          {view === "dashboard" && <Overview user={user} demo={demo} students={students} onView={onView} setToast={setToast} />}
          {view === "students" && <StudentsView user={user} demo={demo} students={students} configuredClasses={academicHeader.classNames} setStudents={setStudents} setToast={setToast} />}
          {view === "scan" && <ScannerViewPro user={user} demo={demo} students={students} configuredClasses={academicHeader.classNames} setToast={setToast} />}
          {view === "attendance" && <AttendanceViewPro user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "tasks" && <TasksView user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "exams" && <ExamsViewWithManual user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "ai" && <AiGeneratorConnected user={user} demo={demo} setToast={setToast} />}
          {view === "scores" && <ScoresView user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "academic" && <AcademicView user={user} demo={demo} students={students} setToast={setToast} />}
          {view === "profile" && <ProfileProfessional user={user} demo={demo} students={students} setToast={setToast} />}
        </main>
      </div>
      <nav aria-label="Navigasi cepat mobile" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,.08)] backdrop-blur-xl lg:hidden">
        {[{key:"dashboard" as NavKey,label:"Beranda",icon:Home},{key:"students" as NavKey,label:"Siswa",icon:Users},{key:"scan" as NavKey,label:"Scan",icon:ScanLine},{key:"scores" as NavKey,label:"Nilai",icon:ListChecks}].map((item)=>{const Icon=item.icon;const active=view===item.key;return <button key={item.key} onClick={()=>onView(item.key)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-extrabold transition ${active?"bg-teal-50 text-teal-700":"text-slate-400"}`}><Icon size={20} strokeWidth={active?2.5:1.8}/><span>{item.label}</span></button>})}
      </nav>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0">{eyebrow && <p className="mb-1 text-[10px] font-black uppercase tracking-[.16em] text-teal-600 sm:text-[11px]">{eyebrow}</p>}<h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></div>{action&&<div className="section-action w-full sm:w-auto">{action}</div>}</div>;
}

function StatCard({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Users; tone: string }) {
  return <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p></div><div className={`rounded-2xl p-3 ${tone}`}><Icon size={21} /></div></div><p className="mt-4 flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Activity size={13} className="text-emerald-500" />{note}</p></div>;
}

function Overview({user,demo,students,onView,setToast}:{user:User|null;demo:boolean;students:Student[];onView:(view:NavKey)=>void;setToast:(toast:Toast)=>void}){
  const [sessions,setSessions]=useState<AttendanceSession[]>([]);
  const [tasks,setTasks]=useState<TaskRecord[]>(demo?demoTasks:[]);
  const [exams,setExams]=useState<ExamRecord[]>([]);
  const [academic,setAcademic]=useState<AcademicSettings>(DEFAULT_ACADEMIC_SETTINGS);
  const [teacherName,setTeacherName]=useState(demo?"Tomi Guru":user?.email?.split("@")[0]??"Guru");
  const now=new Date();
  const today=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now);
  const dateKey=(value:number|Date)=>{const date=value instanceof Date?value:new Date(value);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-")};

  useEffect(()=>{
    if(demo){
      const demoRecords:Record<string,AttendanceRecord>={
        "1":{studentId:"1",status:"present",recordedAtMs:Date.now(),source:"manual"},
        "2":{studentId:"2",status:"present",recordedAtMs:Date.now(),source:"qr"},
        "3":{studentId:"3",status:"sick",recordedAtMs:Date.now(),source:"guardian",reason:"Demam"},
      };
      setSessions([{id:"demo-today",className:"VII A",schoolName:"SMP Harapan Bangsa",status:"open",startedAtMs:Date.now(),records:demoRecords}]);
      setTasks(demoTasks);setExams([]);setAcademic(DEFAULT_ACADEMIC_SETTINGS);setTeacherName("Tomi Guru");return;
    }
    if(!user)return;
    const fail=()=>setToast({message:"Sebagian data Ringkasan belum dapat disinkronkan.",tone:"error"});
    const stops=[
      onSnapshot(collection(db,"users",user.uid,"attendanceSessions"),(snapshot)=>setSessions(snapshot.docs.map((item)=>{const data=item.data() as Omit<AttendanceSession,"id">;return{id:item.id,...data,records:data.records??{}}}).sort((a,b)=>b.startedAtMs-a.startedAtMs)),fail),
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
    const latestByClass=new Map<string,AttendanceSession>();
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
    <SectionHeading eyebrow="Dashboard Guru" title={greeting+", "+teacherName} description={today+" · "+academic.schoolName} action={<button onClick={()=>onView("scan")} className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/20 hover:bg-teal-700"><ScanLine size={18}/>Mulai absensi</button>}/>
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
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 font-black">Aksi cepat</h3><div className="grid grid-cols-2 gap-3">{[{label:"Tambah siswa",icon:UserPlus,key:"students"},{label:"Buat tugas",icon:PencilLine,key:"tasks"},{label:"Buat ulangan",icon:ClipboardCheck,key:"exams"},{label:"Generate soal AI",icon:Bot,key:"ai"}].map((item)=>{const Icon=item.icon;return <button key={item.label} onClick={()=>onView(item.key as NavKey)} className="group min-h-28 rounded-xl border border-slate-200 p-4 text-left transition hover:border-teal-300 hover:bg-teal-50/40"><Icon size={21} className="mb-3 text-teal-600"/><p className="text-sm font-extrabold">{item.label}</p><p className="mt-1 text-[10px] text-slate-400">Buka modul <ChevronRight className="inline" size={11}/></p></button>})}</div></section>
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

function StudentQrCard({student,schoolName,academicYear}:{student:Student;schoolName:string;academicYear:string}){
  return <article className="student-qr-card relative mx-auto aspect-[85.6/54] w-full max-w-[342px] overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-950 shadow-sm">
    <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-b from-teal-500 to-sky-500"/>
    <div className="flex h-full flex-col p-3 pl-5">
      <header className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <img src="/logo.png" alt="Logo SMART-ATT" className="student-qr-logo h-8 w-8 rounded-lg object-cover"/>
        <div className="min-w-0 flex-1"><p className="text-[11px] font-black tracking-wide">SMART-ATT</p><p className="truncate text-[7px] font-semibold text-slate-500">{schoolName} · Tahun Ajaran {academicYear}</p></div>
      </header>
      <div className="flex min-h-0 flex-1 items-center gap-3 pt-2">
        <QRCodeSVG value={JSON.stringify({app:"SMART-ATT",studentId:student.id,nis:student.nis})} size={112} level="H" includeMargin={false} className="student-qr-code h-[86px] w-[86px] shrink-0"/>
        <div className="min-w-0 text-left">
          <p className="text-[7px] font-black uppercase tracking-wider text-teal-600">Kartu QR Siswa</p>
          <h3 className="mt-1 line-clamp-2 text-[13px] font-black leading-4">{student.name}</h3>
          <div className="mt-2 space-y-0.5 text-[8px] font-bold text-slate-600"><p>NIS <span className="text-slate-950">{student.nis}</span></p><p>Kelas <span className="text-slate-950">{student.className}</span></p></div>
        </div>
      </div>
    </div>
  </article>;
}
function StudentsView({ user, demo, students, configuredClasses, setStudents, setToast }: { user: User | null; demo: boolean; students: Student[]; configuredClasses: string[]; setStudents: React.Dispatch<React.SetStateAction<Student[]>>; setToast: (t: Toast) => void }) {
  const classOptions = Array.from(new Set([...configuredClasses, ...students.map((student) => student.className)].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
  const defaultClass = classOptions[0] ?? "V-A";
  const emptyForm = { nis: "", name: "", className: defaultClass, guardian: "", phone: "" };
  const [search, setSearch] = useState(""); const [classFilter, setClassFilter] = useState("Semua kelas"); const [modal, setModal] = useState(false); const [qrStudent, setQrStudent] = useState<Student | null>(null); const [qrBatch, setQrBatch] = useState(false); const [pdfDownloading, setPdfDownloading] = useState(false); const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm); const [photo, setPhoto] = useState<File | null>(null); const [thumbnail, setThumbnail] = useState<File | null>(null); const [photoAspect,setPhotoAspect]=useState<PhotoAspect>("3:4"); const [photoProcessing,setPhotoProcessing]=useState(false); const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [guardianModal, setGuardianModal] = useState(false); const [guardianClass, setGuardianClass] = useState(defaultClass); const [guardianLink, setGuardianLink] = useState(""); const [publishingLink, setPublishingLink] = useState(false);
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  const [academicYear,setAcademicYear]=useState("2026/2027");
  useEffect(()=>{if(demo){setSchoolName("SMP Harapan Bangsa");setAcademicYear("2026/2027");return;}if(!user)return;void Promise.all([getDoc(doc(db,"users",user.uid)),getDoc(doc(db,"users",user.uid,"settings","academic"))]).then(([profile,academic])=>{const profileSchool=profile.data()?.schoolName;const academicData=academic.data();const academicSchool=academicData?.schoolName;if(typeof academicSchool==="string"&&academicSchool.trim())setSchoolName(academicSchool.trim());else if(typeof profileSchool==="string"&&profileSchool.trim())setSchoolName(profileSchool.trim());if(typeof academicData?.academicYear==="string"&&academicData.academicYear.trim())setAcademicYear(academicData.academicYear.trim());});},[demo,user]);
  useEffect(() => { if (classOptions.length && !classOptions.includes(guardianClass)) setGuardianClass(classOptions[0]); }, [classOptions.join("\u0001"), guardianClass]);
  const visible = students.filter((s) => (classFilter === "Semua kelas" || s.className === classFilter) && `${s.name} ${s.nis}`.toLowerCase().includes(search.toLowerCase()));
  function openAddStudent() { setEditingStudent(null); setForm(emptyForm); setPhoto(null); setThumbnail(null); setPhotoAspect("3:4"); setModal(true); }
  function openEditStudent(student: Student) { setEditingStudent(student); setForm({ nis: student.nis, name: student.name, className: student.className, guardian: student.guardian ?? "", phone: student.phone ?? "" }); setPhoto(null); setThumbnail(null); setPhotoAspect(student.photoAspect??"3:4"); setModal(true); }
  function closeStudentModal() { setModal(false); setEditingStudent(null); setForm(emptyForm); setPhoto(null); setThumbnail(null); setPhotoProcessing(false); }
  async function choosePhoto(file:File|null){if(!file)return;const supportedType=["image/jpeg","image/png","image/webp"].includes(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);if(!supportedType){setToast({message:"Gunakan foto JPG, PNG, atau WebP. Kamera HP biasanya menghasilkan JPG.",tone:"error"});return;}if(file.size>15*1024*1024){setToast({message:"Foto awal maksimal 15 MB.",tone:"error"});return;}setPhotoProcessing(true);try{const resized=await resizeStudentPhoto(file);setPhoto(resized);setThumbnail(null);setToast({message:`Foto di-resize menjadi ${Math.ceil(resized.size/1024)} KB. Atur crop thumbnail.`,tone:"success"});}catch(error){setToast({message:error instanceof Error?error.message:"Foto gagal diproses.",tone:"error"});}finally{setPhotoProcessing(false);}}
  async function uploadStudentPhoto(file:File,token:string){const data=new FormData();data.append("file",file);const response=await fetch("/api/storage/photos",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:data});if(!response.ok)throw new Error("Upload foto ke R2 gagal");return (await response.json() as {key:string}).key;}
  async function saveStudent(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      let photoKey = editingStudent?.photoKey ?? ""; let photoThumbnailKey=editingStudent?.photoThumbnailKey??"";
      if(photo&&!thumbnail)throw new Error("Terapkan crop thumbnail sebelum menyimpan.");
      if (photo && thumbnail && user) {const token=await user.getIdToken();[photoKey,photoThumbnailKey]=await Promise.all([uploadStudentPhoto(photo,token),uploadStudentPhoto(thumbnail,token)]);}
      const payload = { ...form, photoKey, photoThumbnailKey, photoAspect, updatedAt: serverTimestamp() };
      if (editingStudent) {
        if (user) await updateDoc(doc(db, "users", user.uid, "students", editingStudent.id), payload);
        else setStudents((items) => items.map((student) => student.id === editingStudent.id ? { ...student, ...form, photoKey, photoThumbnailKey, photoAspect } : student));
      } else if (user) {
        await addDoc(collection(db, "users", user.uid, "students"), { ...payload, createdAt: serverTimestamp() });
      } else {
        const local = { ...form, photoKey, photoThumbnailKey, photoAspect, id: crypto.randomUUID() };
        setStudents((items) => [...items, local].sort((a, b) => a.name.localeCompare(b.name)));
      }
      closeStudentModal();
      setToast({ message: editingStudent ? "Data siswa berhasil diperbarui." : demo ? "Siswa ditambahkan dalam mode demo." : "Data siswa tersimpan di Firestore.", tone: "success" });
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
          className: guardianClass,
          published: true,
          students: classStudents.map((student) => ({ id: student.id, nis: student.nis, name: student.name, className: student.className })),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        setGuardianLink(`${window.location.origin}/public/guardian-data/${snapshotId}`);
      }
      setToast({ message: `Link data wali kelas ${guardianClass} siap dibagikan.`, tone: "success" });
    } catch (error) { setToast({ message: error instanceof Error ? error.message : "Gagal membuat link wali murid.", tone: "error" }); }
    finally { setPublishingLink(false); }
  }
  async function removeStudent(student: Student) { if (!confirm(`Hapus data ${student.name}?`)) return; if (user) await deleteDoc(doc(db,"users",user.uid,"students",student.id)); else setStudents((items)=>items.filter((s)=>s.id!==student.id)); setToast({message:"Data siswa dihapus.",tone:"success"}); }
  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseStudentsCsv(await file.text());
      if (parsed.error) throw new Error(parsed.error);

      const existingByNis = new Map(students.map((student) => [student.nis, student]));
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
            } else {
              const current = existingByNis.get(operation.student.nis)!;
              batch.set(doc(db, "users", user.uid, "students", current.id), {
                attendanceNumber: operation.student.attendanceNumber,
                name: operation.student.name,
                className: operation.student.className,
                ...(operation.student.guardian ? { guardian: operation.student.guardian } : {}),
                ...(operation.student.phone ? { phone: operation.student.phone } : {}),
                updatedAt: serverTimestamp(),
              }, { merge: true });
            }
          }
          await batch.commit();
        }
      } else {
        const demoRows = newStudents.map((student) => ({ ...student, id: crypto.randomUUID() }));
        setStudents((items) => [...items.map((item) => {
          const update = existingUpdates.find((student) => student.nis === item.nis);
          return update ? { ...item, attendanceNumber: update.attendanceNumber, name: update.name, className: update.className, ...(update.guardian ? { guardian: update.guardian } : {}), ...(update.phone ? { phone: update.phone } : {}) } : item;
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
  async function downloadQrPdf(){
    if(!visible.length){setToast({message:"Tidak ada siswa untuk dibuatkan PDF.",tone:"error"});return;}
    setPdfDownloading(true);
    try{
      const {jsPDF}=await import("jspdf");
      const qrElements=Array.from(document.querySelectorAll<SVGSVGElement>(".qr-print-root .student-qr-code"));
      if(qrElements.length<visible.length)throw new Error("Pratinjau QR belum siap. Tutup lalu buka kembali Cetak Semua QR.");
      const logoData=await fetch("/logo.png").then((response)=>{if(!response.ok)throw new Error("Logo tidak dapat dimuat");return response.blob()}).then((blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Logo tidak dapat dibaca"));reader.readAsDataURL(blob)}));
      const qrImages=await Promise.all(qrElements.slice(0,visible.length).map((svg)=>new Promise<string>((resolve,reject)=>{
        const clone=svg.cloneNode(true) as SVGSVGElement;clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width","1024");clone.setAttribute("height","1024");
        const source=new XMLSerializer().serializeToString(clone);const url=URL.createObjectURL(new Blob([source],{type:"image/svg+xml;charset=utf-8"}));const image=new Image();
        image.onload=()=>{try{const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=1024;const context=canvas.getContext("2d");if(!context)throw new Error("Canvas tidak tersedia");context.fillStyle="#ffffff";context.fillRect(0,0,1024,1024);context.drawImage(image,0,0,1024,1024);resolve(canvas.toDataURL("image/png"));}catch(error){reject(error)}finally{URL.revokeObjectURL(url)}};
        image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("QR tidak dapat dirender"))};image.src=url;
      })));
      const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
      const cardWidth=85.6,cardHeight=54,gapX=8,gapY=6,startX=(210-(cardWidth*2+gapX))/2,startY=18;
      visible.forEach((student,index)=>{
        if(index>0&&index%8===0)pdf.addPage("a4","portrait");
        const pageIndex=index%8,col=pageIndex%2,row=Math.floor(pageIndex/2),x=startX+col*(cardWidth+gapX),y=startY+row*(cardHeight+gapY);
        pdf.setFillColor(255,255,255);pdf.setDrawColor(148,163,184);pdf.setLineWidth(.3);pdf.roundedRect(x,y,cardWidth,cardHeight,2.5,2.5,"FD");
        pdf.setFillColor(20,184,166);pdf.roundedRect(x,y,2.5,cardHeight,1.2,1.2,"F");
        pdf.addImage(logoData,"PNG",x+5,y+3,8,8);
        pdf.setTextColor(15,23,42);pdf.setFont("helvetica","bold");pdf.setFontSize(9);pdf.text("SMART-ATT",x+15,y+6.5);
        pdf.setFont("helvetica","normal");pdf.setFontSize(5.5);pdf.setTextColor(100,116,139);
        const schoolLine=String((pdf.splitTextToSize(schoolName+" - Tahun Ajaran "+academicYear,61) as string[])[0]??"");pdf.text(schoolLine,x+15,y+10.5);
        pdf.setDrawColor(226,232,240);pdf.line(x+5,y+14,x+cardWidth-5,y+14);
        pdf.addImage(qrImages[index],"PNG",x+6,y+19,27,27);
        pdf.setTextColor(13,148,136);pdf.setFont("helvetica","bold");pdf.setFontSize(5.5);pdf.text("KARTU QR SISWA",x+38,y+21.5);
        pdf.setTextColor(15,23,42);pdf.setFontSize(9);
        const nameLines=(pdf.splitTextToSize(student.name,41) as string[]).slice(0,2);pdf.text(nameLines,x+38,y+27,{lineHeightFactor:1.05});
        pdf.setFontSize(6.5);pdf.setTextColor(71,85,105);pdf.text("NIS",x+38,y+40);pdf.setTextColor(15,23,42);pdf.text(student.nis,x+47,y+40);
        pdf.setTextColor(71,85,105);pdf.text("Kelas",x+38,y+45);pdf.setTextColor(15,23,42);pdf.text(student.className,x+47,y+45);
      });
      const suffix=classFilter==="Semua kelas"?"semua-kelas":classFilter.toLowerCase().replace(/[^a-z0-9]+/g,"-");
      pdf.save("kartu-qr-smart-att-"+suffix+".pdf");setToast({message:"PDF A4 kartu QR berhasil diunduh.",tone:"success"});
    }catch(error){setToast({message:error instanceof Error?error.message:"PDF gagal dibuat.",tone:"error"});}
    finally{setPdfDownloading(false);}
  }
  return <>
<SectionHeading eyebrow="Master Data" title="Data siswa" description="Kelola identitas, wali murid, foto, dan kartu QR siswa." action={<div className="flex flex-wrap gap-2">
<button onClick={()=>{setGuardianLink("");setGuardianModal(true)}} className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-extrabold text-teal-700">
<MessageCircle size={16}/>Link data wali</button>
<button disabled={!visible.length} onClick={()=>setQrBatch(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-700 shadow-sm disabled:opacity-40">
<Printer size={16}/>Cetak semua QR ({visible.length})</button>
<label title="Mendukung pemisah koma atau titik koma. Header wajib: NIS dan Nama Siswa." className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-700 shadow-sm">
<Upload size={16}/>Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv}/>
</label>
<button onClick={openAddStudent} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-teal-600/20">
<Plus size={17}/>Tambah siswa</button>
</div>} />
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
<div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
<div className="relative w-full max-w-md">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/>
<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Cari nama atau NIS..." className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm outline-none focus:border-teal-500"/>
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
      <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-black text-slate-900">{student.name}</h3><p className="mt-1 text-xs font-bold text-slate-500">NIS {student.nis}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-lg bg-sky-50 px-2.5 py-1 text-[10px] font-extrabold text-sky-700">{student.className}</span><span className={"rounded-lg px-2.5 py-1 text-[10px] font-extrabold "+(student.guardian?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700")}>{student.guardian?"Data lengkap":"Wali belum lengkap"}</span></div></div>
    </div>
    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Orang tua / wali</p><p className="mt-1 text-xs font-bold text-slate-700">{student.guardian||"Belum diisi"} <span className="font-normal text-slate-400">· {student.phone||"No. WA belum ada"}</span></p></div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <button onClick={()=>setQrStudent(student)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-teal-50 text-xs font-extrabold text-teal-700"><QrCode size={16}/>QR</button>
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
<th className="px-4 py-3">NIS</th>
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
<td className="px-4 py-4 text-sm font-black text-slate-700">{student.nis}</td>
<td className="px-4 py-4">
<span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-extrabold text-sky-700">{student.className}</span>
</td>
<td className="px-4 py-4">
<p className="text-xs font-bold text-slate-700">{student.guardian||"Belum diisi"}</p>
<p className="mt-1 text-[10px] text-slate-400">{student.phone||"—"}</p>
</td>
<td className="px-4 py-4">
<span className={`inline-flex items-center gap-1.5 text-xs font-bold ${student.guardian?"text-emerald-600":"text-amber-600"}`}>
<span className={`h-1.5 w-1.5 rounded-full ${student.guardian?"bg-emerald-500":"bg-amber-500"}`}/>{student.guardian?"Lengkap":"Perlu dilengkapi"}</span>
</td>
<td className="px-5 py-4">
<div className="flex justify-end gap-1">
<button onClick={()=>setQrStudent(student)} title="Kartu QR" className="rounded-lg p-2 text-slate-400 hover:bg-teal-50 hover:text-teal-700">
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
  {modal&&<Modal title={editingStudent?"Edit data siswa":"Tambah siswa baru"} subtitle="Lengkapi identitas siswa dan data wali murid." onClose={closeStudentModal}>
<form onSubmit={saveStudent} className="space-y-4">
<Field label="NIS" value={form.nis} onChange={(v)=>setForm({...form,nis:v})} placeholder="Contoh: 20260101" required/>
<Field label="Nama lengkap siswa" value={form.name} onChange={(v)=>setForm({...form,name:v})} placeholder="Nama siswa" required/>
<label className="block">
<span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>
<select value={form.className} onChange={(e)=>setForm({...form,className:e.target.value})} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none">{classOptions.length?classOptions.map((className)=>
<option key={className}>{className}</option>):<>
<option>VII A</option>
<option>VII B</option>
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
<option key={className}>{className}</option>):<option>VII A</option>}</select>
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
  {qrStudent&&<Modal title="Kartu QR siswa" subtitle="Standar KTP 85,6 × 54 mm · tanpa foto siswa." onClose={()=>setQrStudent(null)}>
    <div className="qr-print-root"><div className="qr-print-page rounded-2xl bg-slate-100 p-4"><StudentQrCard student={qrStudent} schoolName={schoolName} academicYear={academicYear}/></div></div>
    <div className="mt-4 rounded-xl bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-800">Kartu hanya menampilkan logo SMART-ATT, sekolah, tahun ajaran, QR, nama, NIS, dan kelas.</div>
    <button onClick={()=>window.print()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white"><Printer size={17}/>Cetak kartu QR</button>
  </Modal>}
  {qrBatch&&<Modal title="Cetak semua kartu QR" subtitle={visible.length+" siswa · 8 kartu ukuran KTP per lembar A4."} onClose={()=>setQrBatch(false)}>
    <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">Daftar mengikuti pencarian dan filter kelas yang sedang aktif. Pilih ukuran kertas <strong>A4</strong>, orientasi potret, skala 100%, dan margin tidak ada pada dialog printer.</div>
    <div className="qr-print-root max-h-[55vh] space-y-4 overflow-y-auto rounded-2xl bg-slate-100 p-4">
      {Array.from({length:Math.ceil(visible.length/8)},(_,pageIndex)=><section key={pageIndex} className="qr-print-page space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-3">
        {visible.slice(pageIndex*8,pageIndex*8+8).map((student)=><StudentQrCard key={student.id} student={student} schoolName={schoolName} academicYear={academicYear}/>)}
      </section>)}
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button disabled={pdfDownloading} onClick={()=>void downloadQrPdf()} className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60">{pdfDownloading?<Loader2 className="animate-spin" size={17}/>:<Download size={17}/>}Download PDF A4</button>
      <button onClick={()=>window.print()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-extrabold text-white"><Printer size={17}/>Print {visible.length} kartu</button>
    </div>
  </Modal>}</>;
}

function Modal({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:React.ReactNode}) { return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"><div className="mobile-modal-panel max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6"><div className="mb-5 flex items-start justify-between gap-4 sm:mb-6"><div className="min-w-0"><h3 className="text-lg font-black sm:text-xl">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p></div><button onClick={onClose} aria-label="Tutup" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><X size={18}/></button></div>{children}</div></div> }

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
  const sessionRef=useRef<AttendanceSession|null>(null);
  const studentsRef=useRef(students);
  const classes=useMemo(()=>Array.from(new Set(students.map((student)=>student.className).filter(Boolean))).sort(),[students]);
  const [selectedClass,setSelectedClass]=useState(classes[0]??"");
  const [schoolName,setSchoolName]=useState(demo?"SMP Harapan Bangsa":"Sekolah");
  const [session,setSession]=useState<AttendanceSession|null>(null);
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
      const sessions=snapshot.docs.map((item)=>({id:item.id,...item.data(),records:item.data().records??{}} as AttendanceSession)).sort((a,b)=>b.startedAtMs-a.startedAtMs);
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
    const attendanceRecord:AttendanceRecord={studentId:student.id,status:"present",source,recordedAtMs:Date.now()};
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
      const nextSession:AttendanceSession={id,className:selectedClass,schoolName,status:"open",startedAtMs,records:{}};
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

function AttendanceView({students}:{students:Student[]}){return <><SectionHeading eyebrow="Laporan" title="Rekap absensi" description="Pantau kehadiran per hari, minggu, semester, atau tahun." action={<button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold"><FileDown size={16}/>Ekspor Excel</button>}/><div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Hadir','28','text-emerald-600'],['Terlambat','2','text-amber-600'],['Sakit','1','text-sky-600'],['Izin','0','text-violet-600'],['Tanpa keterangan','1','text-rose-600']].map(([label,value,color])=><div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p></div>)}</div><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="flex gap-2"><button className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white">Harian</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Mingguan</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">6 Bulan</button><button className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Tahunan</button></div><button className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><CalendarDays size={15}/>13 Juli 2026</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Kelas</th><th className="px-4 py-3">Jam scan</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Keterangan</th></tr></thead><tbody className="divide-y divide-slate-100">{students.slice(0,5).map((s,i)=><tr key={s.id}><td className="px-5 py-4 text-sm font-extrabold">{s.name}<p className="text-[10px] font-normal text-slate-400">NIS {s.nis}</p></td><td className="px-4 py-4 text-xs font-bold">{s.className}</td><td className="px-4 py-4 text-xs text-slate-500">{i===4?'—':`06:${47+i*4}`}</td><td className="px-4 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${i===3?'bg-amber-50 text-amber-700':i===4?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700'}`}>{i===3?'Terlambat':i===4?'Belum hadir':'Hadir'}</span></td><td className="px-5 py-4 text-xs text-slate-400">{i===3?'Terlambat 3 menit':i===4?<a className="font-bold text-teal-700" href={`https://wa.me/${s.phone}?text=${encodeURIComponent('Mohon konfirmasi ketidakhadiran melalui tautan SMART-ATT.')}`}>Kirim konfirmasi WA</a>:'—'}</td></tr>)}</tbody></table></div></section></>}

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

function TasksView({ user, demo, students, setToast }: { user: User | null; demo: boolean; students: Student[]; setToast: (t: Toast) => void }) {
  const classes = useMemo(() => Array.from(new Set(students.map((student) => student.className).filter(Boolean))).sort(), [students]);
  const blankForm = (): TaskForm => ({ subject: "", className: classes[0] ?? "", title: "", description: "", deadline: "", published: true });
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
    {open&&<Modal title={editing?"Edit tugas":"Buat tugas baru"} subtitle="Simpan sebagai draf atau publikasikan agar dapat dibuka siswa." onClose={()=>!saving&&setOpen(false)}><form onSubmit={saveTask} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Mata pelajaran" value={form.subject} onChange={(subject)=>setForm((current)=>({...current,subject}))} placeholder="Contoh: Matematika" required/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>{classes.length?<select required value={form.className} onChange={(event)=>setForm((current)=>({...current,className:event.target.value}))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-teal-500">{classes.map((className)=><option key={className}>{className}</option>)}</select>:<input required value={form.className} onChange={(event)=>setForm((current)=>({...current,className:event.target.value}))} placeholder="Contoh: VII A" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/>}</label></div><Field label="Judul tugas" value={form.title} onChange={(title)=>setForm((current)=>({...current,title}))} placeholder="Contoh: Latihan aljabar" required/><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Deskripsi / instruksi</span><textarea required value={form.description} onChange={(event)=>setForm((current)=>({...current,description:event.target.value}))} className="min-h-32 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" placeholder="Tuliskan materi, nomor soal, dan petunjuk pengerjaan..."/></label><Field label="Tenggat waktu" type="datetime-local" value={form.deadline} onChange={(deadline)=>setForm((current)=>({...current,deadline}))} required/><label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><input type="checkbox" checked={form.published} onChange={(event)=>setForm((current)=>({...current,published:event.target.checked}))} className="mt-0.5 h-4 w-4 accent-teal-600"/><span><span className="block text-sm font-extrabold">Publikasikan sekarang</span><span className="mt-1 block text-xs leading-5 text-slate-500">Siswa dapat membuka tugas tanpa login melalui link publik.</span></span></label><div className="flex gap-3"><button type="button" disabled={saving} onClick={()=>setOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-extrabold text-slate-600">Batal</button><button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{saving&&<Loader2 className="animate-spin" size={17}/>}Simpan tugas</button></div></form></Modal>}
  </>;
}

function ExamsViewWithManual({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void}){
  const [manualOpen,setManualOpen]=useState(false);
  return <><div className="mb-4 flex justify-end"><button onClick={()=>setManualOpen(true)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-xs font-extrabold text-white shadow-lg shadow-teal-600/15"><PencilLine size={16}/>Buat soal manual</button></div><ExamsViewAdvanced user={user} demo={demo} students={students} setToast={setToast}/>{manualOpen&&<ManualExamModal user={user} demo={demo} students={students} setToast={setToast} onClose={()=>setManualOpen(false)}/>}</>;
}

function ManualExamModal({user,demo,students,setToast,onClose}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void;onClose:()=>void}){
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
      if(!demo&&user)await addDoc(collection(db,"users",user.uid,"exams"),{title:title.trim(),subject:subject.trim(),className:className.trim(),chapter:chapter.trim(),durationMinutes:Math.max(1,Math.min(300,Number(duration)||60)),questions,status:"draft",source:"manual",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      else if(!demo)throw new Error("Sesi login tidak tersedia");
      setToast({message:`Draf manual dengan ${questions.length} soal berhasil disimpan.`,tone:"success"});onClose();
    }catch{setToast({message:"Draf soal manual gagal disimpan.",tone:"error"});}
    finally{setSaving(false);}
  }

  return <Modal title="Buat soal manual" subtitle="Tambahkan soal satu per satu, tentukan kunci, lalu simpan sebagai draf." onClose={onClose}><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Judul ulangan" value={title} onChange={setTitle} placeholder="Contoh: Ulangan Harian Bab 1" required/><Field label="Mata pelajaran" value={subject} onChange={setSubject} placeholder="Matematika" required/></div><div className="grid gap-4 sm:grid-cols-3"><label className="block"><span className="mb-2 block text-xs font-extrabold text-slate-700">Kelas</span>{classes.length?<select value={className} onChange={(event)=>setClassName(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500">{classes.map((item)=><option key={item}>{item}</option>)}</select>:<input value={className} onChange={(event)=>setClassName(event.target.value)} placeholder="VII A" className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>}</label><Field label="Bab / materi" value={chapter} onChange={setChapter} placeholder="Materi ujian"/><Field label="Durasi (menit)" type="number" value={duration} onChange={setDuration}/></div><div className="my-5 border-t border-slate-100"/><div className="rounded-2xl bg-slate-50 p-4"><div className="mb-4 flex items-center justify-between"><div><h4 className="text-sm font-black">{editingIndex===null?`Soal ${questions.length+1}`:`Edit soal ${editingIndex+1}`}</h4><p className="mt-1 text-[10px] text-slate-400">Pilih satu jawaban yang benar.</p></div>{editingIndex!==null&&<button onClick={()=>{setDraft(emptyQuestion());setEditingIndex(null)}} className="text-xs font-bold text-slate-500">Batal edit</button>}</div><label className="block"><span className="mb-2 block text-xs font-extrabold">Pertanyaan</span><textarea value={draft.question} onChange={(event)=>setDraft((current)=>({...current,question:event.target.value}))} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-500" placeholder="Tuliskan pertanyaan..."/></label><div className="mt-4 grid gap-3 sm:grid-cols-2">{draft.choices.map((choice,index)=><label key={index} className={`flex items-center gap-2 rounded-xl border p-2 ${draft.answerIndex===index?'border-emerald-300 bg-emerald-50':'border-slate-200 bg-white'}`}><input type="radio" name="correct-answer" checked={draft.answerIndex===index} onChange={()=>setDraft((current)=>({...current,answerIndex:index}))} className="accent-emerald-600"/><span className="text-xs font-black text-slate-500">{String.fromCharCode(65+index)}</span><input value={choice} onChange={(event)=>updateChoice(index,event.target.value)} placeholder={`Pilihan ${String.fromCharCode(65+index)}`} className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"/></label>)}</div><label className="mt-4 block"><span className="mb-2 block text-xs font-extrabold">Pembahasan (opsional)</span><textarea value={draft.explanation} onChange={(event)=>setDraft((current)=>({...current,explanation:event.target.value}))} className="min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-500" placeholder="Jelaskan alasan jawaban yang benar..."/></label><button type="button" onClick={saveQuestion} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-xs font-extrabold text-white"><Plus size={15}/>{editingIndex===null?'Tambahkan soal':'Simpan perubahan soal'}</button></div>{questions.length>0&&<div><h4 className="mb-3 text-sm font-black">Daftar soal · {questions.length} butir</h4><div className="max-h-56 space-y-2 overflow-y-auto pr-1">{questions.map((question,index)=><div key={`${index}-${question.question}`} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-50 text-xs font-black text-teal-700">{index+1}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-bold leading-5">{question.question}</p><p className="mt-1 text-[10px] text-emerald-600">Kunci {String.fromCharCode(65+question.answerIndex)} · {question.choices[question.answerIndex]}</p></div><button onClick={()=>editQuestion(index)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><PencilLine size={14}/></button><button onClick={()=>removeQuestion(index)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={14}/></button></div>)}</div></div>}<div className="flex gap-3 border-t border-slate-100 pt-4"><button disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-extrabold text-slate-600">Batal</button><button disabled={saving||!questions.length} onClick={()=>void saveExam()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white disabled:opacity-40">{saving?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Simpan sebagai draf</button></div></div></Modal>;
}

function ExamsViewAdvanced({user,demo,students,setToast}:{user:User|null;demo:boolean;students:Student[];setToast:(t:Toast)=>void}){
  const sampleExam:ExamRecord={id:"demo-exam",title:"Quiz Matematika — Persamaan Linear",subject:"Matematika",className:"VII A",chapter:"Persamaan linear",status:"draft",source:"ai",durationMinutes:60,questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}]};
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
    if(!user){setExams([]);setLoading(false);return;}
    setLoading(true);
    return onSnapshot(collection(db,"users",user.uid,"exams"),(snapshot)=>{
      const next=snapshot.docs.map((item)=>({id:item.id,...item.data()} as ExamRecord));
      next.sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
      setExams(next);setLoading(false);
    },()=>{setLoading(false);setToast({message:"Data ulangan belum dapat dibaca.",tone:"error"});});
  },[user,demo,setToast]);

  useEffect(()=>{
    if(demo||!user){setAttempts([]);return;}
    const attemptsQuery=query(collection(db,"publicQuizAttempts"),where("ownerUid","==",user.uid));
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
  },[user,demo,setToast]);

  function targetStudents(exam:ExamRecord){
    if(exam.status!=="published")return students;
    const participantIds=new Set(attempts.filter((attempt)=>attempt.examId===exam.id).map((attempt)=>attempt.studentId));
    return students.filter((student)=>participantIds.has(student.id));
  }

  async function publishExam(exam:ExamRecord){
    if(!exam.questions?.length){setToast({message:"Ulangan belum memiliki soal.",tone:"error"});return;}
    const duration=Math.max(1,Math.min(300,Number(durationMinutes)||60));
    const startAtMs=new Date(`${scheduleDate}T${scheduleTime}:00`).getTime();
    if(!Number.isFinite(startAtMs)){setToast({message:"Tanggal atau jam ujian tidak valid.",tone:"error"});return;}
    const endAtMs=startAtMs+duration*60000;
    const status:ExamRecord["status"]=startAtMs>Date.now()?"scheduled":"published";
    const participants=students;
    setBusyId(exam.id);
    try{
      if(demo||!user){setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status,snapshotId:"demo",durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:undefined}:item));setReview(null);setToast({message:status==="scheduled"?"Ulangan demo berhasil dijadwalkan.":"Ulangan demo sudah online.",tone:"success"});return;}
      const snapshotRef=exam.snapshotId?doc(db,"publicSnapshots",exam.snapshotId):doc(collection(db,"publicSnapshots"));
      const batch=writeBatch(db);
      batch.update(doc(db,"users",user.uid,"exams",exam.id),{status,snapshotId:snapshotRef.id,durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:deleteField(),updatedAt:serverTimestamp()});
      batch.set(snapshotRef,{type:"quiz",ownerUid:user.uid,examId:exam.id,published:true,title:exam.title,subject:exam.subject,className:exam.className,chapter:exam.chapter??"",questions:exam.questions,durationMinutes:duration,startAtMs,endAtMs,startAt:new Date(startAtMs),endAt:new Date(endAtMs),students:participants.map(({id,nis,name,className})=>({id,nis,name,className})),updatedAt:serverTimestamp()},{merge:true});
      await batch.commit();setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status,snapshotId:snapshotRef.id,durationMinutes:duration,startAtMs,endAtMs,targetStudentCount:undefined}:item));setReview(null);setToast({message:status==="scheduled"?"Ulangan dijadwalkan dan link countdown siap dibagikan.":"Ulangan sudah online dan link siswa siap dibagikan.",tone:"success"});
    }catch{setToast({message:"Ulangan gagal dipublikasikan.",tone:"error"});}
    finally{setBusyId("");}
  }
  async function unpublishExam(exam:ExamRecord){
    if(!exam.snapshotId){return;}
    setBusyId(exam.id);
    try{
      if(demo||!user)setExams((current)=>current.map((item)=>item.id===exam.id?{...item,status:"draft"}:item));
      else{const batch=writeBatch(db);batch.update(doc(db,"users",user.uid,"exams",exam.id),{status:"draft",updatedAt:serverTimestamp()});batch.update(doc(db,"publicSnapshots",exam.snapshotId),{published:false,updatedAt:serverTimestamp()});await batch.commit();}
      setToast({message:"Ulangan dinonaktifkan dan link siswa ditutup.",tone:"success"});
    }catch{setToast({message:"Ulangan gagal dinonaktifkan.",tone:"error"});}
    finally{setBusyId("");}
  }

  async function copyQuizLink(exam:ExamRecord){
    if(!exam.snapshotId||(exam.status!=="published"&&exam.status!=="scheduled")){setToast({message:"Jadwalkan atau terapkan ulangan terlebih dahulu.",tone:"error"});return;}
    try{await navigator.clipboard.writeText(`${location.origin}/public/quiz/${encodeURIComponent(exam.snapshotId)}`);setToast({message:"Link ulangan berhasil disalin.",tone:"success"});}
    catch{setToast({message:"Link tidak dapat disalin otomatis.",tone:"error"});}
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
    try{if(demo||!user)setExams((current)=>current.filter((item)=>item.id!==exam.id));else{const batch=writeBatch(db);batch.delete(doc(db,"users",user.uid,"exams",exam.id));if(exam.snapshotId)batch.delete(doc(db,"publicSnapshots",exam.snapshotId));await batch.commit();}setToast({message:"Ulangan berhasil dihapus.",tone:"success"});}
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

  return <><SectionHeading eyebrow="Smart Quiz" title="Soal & ulangan" description="Tinjau draf, publikasikan ujian, dan pantau pengerjaan siswa secara langsung."/><div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Ujian online" value={String(activeCount)} note="Link dapat dibuka siswa" icon={Timer} tone="bg-teal-50 text-teal-600"/><StatCard label="Draf ditinjau" value={String(draftCount)} note="Siap diterapkan" icon={FileText} tone="bg-sky-50 text-sky-600"/><StatCard label="Total butir soal" value={String(questionCount)} note="Tersimpan di Firebase" icon={ListChecks} tone="bg-violet-50 text-violet-600"/></div>{loading?<div className="grid min-h-52 place-items-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={30}/></div>:exams.length===0?<div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><ClipboardCheck className="mx-auto text-teal-600" size={30}/><h3 className="mt-4 font-black">Belum ada draf soal</h3><p className="mt-1 text-sm text-slate-500">Buat dan simpan soal melalui Generator Soal AI.</p></div>:<div className="space-y-4">{exams.map((exam)=>{const online=exam.status==="published"||exam.status==="scheduled";const related=examAttempts(exam);const finished=related.filter((item)=>item.status==="finished");const violations=related.reduce((total,item)=>total+(item.violations?.length??0),0);return <article key={exam.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><ClipboardCheck size={25}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{exam.title}</h3><span className={`rounded-full px-2 py-1 text-[9px] font-black ${exam.status==="scheduled"?'bg-violet-50 text-violet-700':online?'bg-emerald-50 text-emerald-700':'bg-sky-50 text-sky-700'}`}>{exam.status==="scheduled"?'TERJADWAL':online?'ONLINE':'DRAF'}</span>{exam.source==="ai"&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700">DARI AI</span>}</div><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400"><span>{exam.className}</span><span>{exam.questions?.length??0} soal</span><span>{exam.durationMinutes??60} menit</span>{exam.startAtMs&&<span>Mulai {new Date(exam.startAtMs).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}</span>}{online&&<><span>{finished.length}/{exam.targetStudentCount??targetStudents(exam).length} selesai</span><span className={violations?'font-bold text-rose-500':''}>{violations} pelanggaran</span></>}</div></div><div className="flex flex-wrap gap-2">{online?<><button onClick={()=>void copyQuizLink(exam)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-xs font-bold text-white"><Link2 size={14}/>Link siswa</button><button onClick={()=>setMonitor(exam)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><Activity size={14}/>Monitor</button><button disabled={busyId===exam.id} onClick={()=>void unpublishExam(exam)} title="Nonaktifkan" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><XCircle size={15}/></button></>:<button onClick={()=>{setReview(exam);setDurationMinutes(String(exam.durationMinutes??60));if(exam.startAtMs){const date=new Date(exam.startAtMs);setScheduleDate(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`);setScheduleTime(date.toTimeString().slice(0,5))}}} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"><FileText size={14}/>Tinjau & terapkan</button>}<button onClick={()=>printExamPdf(exam)} title="Simpan PDF" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><Download size={15}/></button><button onClick={()=>void removeExam(exam)} title="Hapus" className="rounded-xl border border-rose-100 p-2.5 text-rose-500"><Trash2 size={15}/></button></div></article>})}</div>}
    {review&&<Modal title="Tinjau & terapkan ulangan" subtitle={`${review.title} · ${review.questions.length} soal`} onClose={()=>setReview(null)}><div className="mb-5 grid gap-3 sm:grid-cols-2"><Field label="Tanggal ujian" type="date" value={scheduleDate} onChange={setScheduleDate}/><Field label="Jam mulai" type="time" value={scheduleTime} onChange={setScheduleTime}/><Field label="Durasi ujian (menit)" type="number" value={durationMinutes} onChange={setDurationMinutes}/><div className="rounded-xl bg-teal-50 p-4"><p className="text-[10px] font-black text-teal-600">AKSES UJIAN</p><p className="mt-1 text-sm font-black text-teal-950">Semua NIS terdaftar · melalui link</p></div></div><div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">{review.questions.map((question,index)=><article key={`${index}-${question.question}`} className="rounded-xl border border-slate-200 p-4"><h4 className="text-sm font-black">{index+1}. {question.question}</h4><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{question.choices.map((choice,choiceIndex)=><p key={choiceIndex} className={`rounded-lg px-2.5 py-2 text-xs ${choiceIndex===question.answerIndex?'bg-emerald-50 font-bold text-emerald-800':'bg-slate-50 text-slate-600'}`}>{String.fromCharCode(65+choiceIndex)}. {choice}</p>)}</div></article>)}</div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button onClick={()=>printExamPdf(review)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-xs font-extrabold"><Download size={15}/>Simpan PDF</button><button disabled={busyId===review.id} onClick={()=>void publishExam(review)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white disabled:opacity-60">{busyId===review.id?<Loader2 className="animate-spin" size={16}/>:<Send size={16}/>}Jadwalkan / terapkan</button></div></Modal>}
    {monitor&&(()=>{const related=examAttempts(monitor);const finished=related.filter((item)=>item.status==="finished");const top=[...finished].sort((a,b)=>(b.score??0)-(a.score??0)||(a.durationSeconds??Infinity)-(b.durationSeconds??Infinity)).slice(0,5);const target=monitor.targetStudentCount??targetStudents(monitor).length;const allDone=target>0&&finished.length>=target;return <Modal title="Monitoring & peringkat" subtitle={`${monitor.title} · ${finished.length}/${target} siswa selesai`} onClose={()=>setMonitor(null)}>{allDone&&<div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 className="mr-2 inline" size={18}/>Semua siswa telah menyelesaikan ujian.</div>}<h4 className="mb-3 text-sm font-black">5 nilai tertinggi dan tercepat</h4>{top.length?<div className="space-y-2">{top.map((attempt,index)=><div key={attempt.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{index+1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{attempt.studentName}</p><p className="text-[10px] text-slate-400">NIS {attempt.nis} · {formatCountdown(attempt.durationSeconds??0)}</p></div><p className="text-xl font-black text-teal-700">{attempt.score??0}</p></div>)}</div>:<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada siswa yang menyelesaikan ujian.</p>}<h4 className="mb-3 mt-6 text-sm font-black">Aktivitas pengawasan</h4><div className="space-y-2">{related.map((attempt)=><div key={attempt.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><div><p className="text-sm font-bold">{attempt.studentName}</p><p className="text-[10px] text-slate-400">{attempt.status==="finished"?'Selesai':'Mengerjakan'} · Login ulang {attempt.reloginCount??0}x</p></div><div className="flex flex-col items-end gap-1.5"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${(attempt.violations?.length??0)>0?'bg-rose-100 text-rose-700':'bg-emerald-100 text-emerald-700'}`}>{attempt.violations?.length??0} pelanggaran</span>{attempt.status==="active"&&<button onClick={()=>void unlockExamDevice(attempt)} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-black text-amber-700"><KeyRound className="mr-1 inline" size={12}/>Buka kunci perangkat</button>}</div></div>)}</div></Modal>})()}
  </>;
}

function ExamsView({user,demo,setToast}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void}){
  const demoExams:ExamRecord[]=[
    {id:"demo-exam-1",title:"Quiz Matematika — Persamaan Linear",subject:"Matematika",className:"VII A",chapter:"Persamaan linear",status:"draft",source:"ai",questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}]},
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

function AiGenerator({user,demo,setToast}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void}){
  const [subject,setSubject]=useState("Matematika");
  const [grade,setGrade]=useState("VII");
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
    setSaving(true);
    try{
      if(!demo&&user)await addDoc(collection(db,"users",user.uid,"exams"),{title:`${subject} — ${chapter}`,subject,className:grade,chapter,questions,status:"draft",source:"ai",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      setToast({message:`Draf ulangan dengan ${questions.length} soal berhasil disimpan.`,tone:"success"});
    }catch{setToast({message:"Draf soal gagal disimpan.",tone:"error"});}
    finally{setSaving(false);}
  }

  return <><SectionHeading eyebrow="Asisten AI" title="Generator soal AI" description="Salin prompt, lalu tempel hasil AI untuk langsung mengubahnya menjadi soal."/><div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-5 font-black">1. Atur kebutuhan soal</h3><div className="space-y-4"><Field label="Mata pelajaran" value={subject} onChange={setSubject}/><Field label="Kelas" value={grade} onChange={setGrade}/><Field label="Bab / materi" value={chapter} onChange={setChapter}/><div className="grid grid-cols-2 gap-3"><Field label="Jumlah soal" type="number" value={count} onChange={setCount}/><Field label="Pilihan jawaban" type="number" value={choices} onChange={setChoices}/></div></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">2. Salin prompt ke AI</h3><p className="mt-1 text-xs text-slate-400">Gunakan di ChatGPT, Gemini, atau AI lainnya.</p></div><Sparkles className="text-teal-600" size={22}/></div><pre className="min-h-64 whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-300">{prompt}</pre><button onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setToast({message:'Prompt AI disalin.',tone:'success'})).catch(()=>setToast({message:'Prompt gagal disalin.',tone:'error'}))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white"><Copy size={16}/>Salin prompt</button></section></div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-black">3. Tempel hasil dari AI</h3><p className="mt-1 text-xs leading-5 text-slate-500">Boleh berupa JSON, blok kode Markdown, atau tulisan soal bernomor dengan pilihan A/B/C/D dan baris Kunci.</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>void pasteFromClipboard()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><ClipboardCheck size={15}/>Tempel otomatis</button><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><Upload size={15}/>Pilih file<input type="file" accept=".json,.txt,text/plain,application/json" className="hidden" onChange={(event)=>void importFile(event)}/></label></div></div><textarea value={aiOutput} onChange={(event)=>{setAiOutput(event.target.value);setParseError("");}} className="mt-4 min-h-72 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" placeholder={'Tempel hasil AI di sini...\n\nContoh:\n1. Berapakah 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nKunci: B\nPembahasan: 2 + 2 = 4.'}/>{parseError&&<p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold leading-5 text-rose-700">{parseError}</p>}<button disabled={!aiOutput.trim()} onClick={()=>readQuestions()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white disabled:opacity-40"><Sparkles size={17}/>Baca hasil & buat soal</button></section>
    {questions.length>0&&<section className="mt-6 rounded-2xl border border-teal-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Soal berhasil dibuat</p><h3 className="mt-1 text-xl font-black">{questions.length} soal siap digunakan</h3><p className="mt-1 text-xs text-slate-500">Periksa kunci jawaban sebelum menyimpan sebagai draf ulangan.</p></div><button disabled={saving} onClick={()=>void saveDraft()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-xs font-extrabold text-white disabled:opacity-60">{saving?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Simpan draf ulangan</button></div><div className="mt-5 space-y-4">{questions.map((question,index)=><article key={`${index}-${question.question}`} className="rounded-2xl border border-slate-200 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{index+1}</span><div className="min-w-0 flex-1"><h4 className="text-sm font-black leading-6">{question.question}</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.choices.map((choice,choiceIndex)=><div key={`${choiceIndex}-${choice}`} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${choiceIndex===question.answerIndex?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 text-slate-600'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black ${choiceIndex===question.answerIndex?'bg-emerald-600 text-white':'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65+choiceIndex)}</span>{choice}</div>)}</div>{question.explanation&&<p className="mt-3 rounded-xl bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-800"><span className="font-black">Pembahasan:</span> {question.explanation}</p>}</div></div></article>)}</div></section>}
  </>;
}

function AiGeneratorConnected({user,demo,setToast}:{user:User|null;demo:boolean;setToast:(t:Toast)=>void}){
  const [subject,setSubject]=useState("Matematika");
  const [grade,setGrade]=useState("VII A");
  const [chapter,setChapter]=useState("Persamaan linear satu variabel");
  const [count,setCount]=useState("20");
  const [choices,setChoices]=useState("4");
  const [aiOutput,setAiOutput]=useState("");
  const [parseError,setParseError]=useState("");
  const [saving,setSaving]=useState(false);
  const [savedExamId,setSavedExamId]=useState("");
  const prompt=`Buat ${count} soal pilihan ganda mata pelajaran ${subject} untuk kelas ${grade}, bab ${chapter}. Setiap soal memiliki ${choices} pilihan, tepat satu jawaban benar, dan pembahasan singkat. Buat semua pilihan pengecoh masuk akal, mirip satu sama lain, tidak mudah ditebak, dan membutuhkan ketelitian. Untuk soal hitungan, gunakan hasil dari kesalahan hitung yang umum sebagai pengecoh dan pastikan hanya satu hasil yang benar. Hindari pilihan yang terlalu berbeda, lucu, atau jelas salah. Keluarkan JSON dengan struktur: {"questions":[{"question":"...","choices":["..."],"answerIndex":0,"explanation":"..."}]}. Pastikan answerIndex dimulai dari 0, kunci sesuai pilihan yang benar, dan seluruh soal lengkap.`;

  async function persistDraft(items:QuizQuestion[]){
    setSaving(true);
    try{
      if(!demo&&user){
        const examRef=savedExamId?doc(db,"users",user.uid,"exams",savedExamId):doc(collection(db,"users",user.uid,"exams"));
        await setDoc(examRef,{title:`${subject} — ${chapter}`,subject,className:grade,chapter,questions:items,status:"draft",source:"ai",...(!savedExamId?{createdAt:serverTimestamp()}:{}),updatedAt:serverTimestamp()},{merge:true});
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

  return <><SectionHeading eyebrow="Asisten AI" title="Generator soal AI" description="Tempel hasil AI, lalu SMART-ATT langsung membuat dan menyimpan draf soal."/><div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-5 font-black">1. Atur kebutuhan soal</h3><div className="space-y-4"><Field label="Mata pelajaran" value={subject} onChange={(value)=>{setSubject(value)}}/><Field label="Kelas" value={grade} onChange={(value)=>{setGrade(value)}}/><Field label="Bab / materi" value={chapter} onChange={(value)=>{setChapter(value)}}/><div className="grid grid-cols-2 gap-3"><Field label="Jumlah soal" type="number" value={count} onChange={setCount}/><Field label="Pilihan jawaban" type="number" value={choices} onChange={setChoices}/></div></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">2. Salin prompt ke AI</h3><p className="mt-1 text-xs text-slate-400">Gunakan di ChatGPT, Gemini, atau AI lainnya.</p></div><Sparkles className="text-teal-600" size={22}/></div><pre className="min-h-64 whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-300">{prompt}</pre><button onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setToast({message:"Prompt AI disalin.",tone:"success"})).catch(()=>setToast({message:"Prompt gagal disalin.",tone:"error"}))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-extrabold text-white"><Copy size={16}/>Salin prompt</button></section></div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-black">3. Tempel dan simpan hasil AI</h3><p className="mt-1 text-xs leading-5 text-slate-500">Mendukung JSON, blok Markdown, dan tulisan soal bernomor dengan pilihan A/B/C/D.</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>void pasteFromClipboard()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><ClipboardCheck size={15}/>Tempel otomatis</button><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold text-slate-600"><Upload size={15}/>Pilih file<input type="file" accept=".json,.txt,text/plain,application/json" className="hidden" onChange={(event)=>void importFile(event)}/></label></div></div><textarea value={aiOutput} onChange={(event)=>{setAiOutput(event.target.value);setParseError("")}} className="mt-4 min-h-72 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" placeholder={'Tempel hasil AI di sini...\n\n1. Berapakah 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nKunci: B'}/>{parseError&&<p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold leading-5 text-rose-700">{parseError}</p>}<button disabled={!aiOutput.trim()||saving} onClick={()=>void readAndSave()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white disabled:opacity-40">{saving?<Loader2 className="animate-spin" size={17}/>:<Sparkles size={17}/>}Baca hasil & simpan ke Soal & Ulangan</button></section>
  </>;
}

function LegacyScoresView({students}:{students:Student[]}){return <><SectionHeading eyebrow="Evaluasi" title="Rekap nilai siswa" description="Gabungkan nilai ulangan dan nilai manual sesuai bobot semester." action={<button className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-extrabold text-white"><PencilLine size={16}/>Input nilai manual</button>}/><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option>VII A</option><option>VII B</option></select><select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option>Matematika</option><option>IPA</option></select><span className="ml-auto rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-700">KKM 75</span></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Tugas</th><th className="px-4 py-3">Ulangan</th><th className="px-4 py-3">Nilai manual</th><th className="px-4 py-3">Rata-rata</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{students.slice(0,5).map((s,i)=>{const avg=[88,72,94,80,76][i]??80;return <tr key={s.id}><td className="px-5 py-4 text-sm font-extrabold">{s.name}<p className="text-[10px] font-normal text-slate-400">{s.nis}</p></td><td className="px-4 py-4 text-sm font-bold">{avg+2}</td><td className="px-4 py-4 text-sm font-bold">{avg-3}</td><td className="px-4 py-4 text-sm font-bold">{avg+1}</td><td className="px-4 py-4"><span className="text-base font-black">{avg}</span></td><td className="px-5 py-4"><span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${avg>=75?'bg-emerald-50 text-emerald-700':'bg-rose-50 text-rose-700'}`}>{avg>=75?'Tuntas':'Remedial'}</span></td></tr>})}</tbody></table></div></section></>}

function LegacyAcademicView(){return <><SectionHeading eyebrow="Konfigurasi" title="Data akademik" description="Atur sekolah, tahun ajaran, semester, dan kelas aktif."/><div className="grid gap-5 lg:grid-cols-2"><ConfigCard icon={School} title="Sekolah utama" value="SMP Harapan Bangsa" detail="NPSN 12345678 · Kota Bandung"/><ConfigCard icon={CalendarDays} title="Periode aktif" value="2026/2027 · Ganjil" detail="13 Juli — 18 Desember 2026"/><ConfigCard icon={GraduationCap} title="Kelas aktif" value="2 kelas · 32 siswa" detail="VII A dan VII B"/><ConfigCard icon={AlarmClock} title="Aturan jam masuk" value="07:00 WIB" detail="Setelah 07:00 tercatat terlambat"/></div></>}
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
      setSnapshot({type:"quiz",ownerUid:"demo",examId:"demo-exam",published:true,title:"Quiz Matematika — Persamaan Linear",subject:"Matematika",className:"VII A",chapter:"Persamaan linear",durationMinutes:60,questions:[{question:"Nilai x yang memenuhi 3x + 5 = 20 adalah...",choices:["3","5","7","15"],answerIndex:1,explanation:"3x = 15, sehingga x = 5."}],students:demoStudents.filter((item)=>item.className==="VII A").map(({id,nis,name,className})=>({id,nis,name,className}))});setLoading(false);return;
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

function PublicQuiz(){const [started,setStarted]=useState(false);const [nis,setNis]=useState("");const [answer,setAnswer]=useState<number|null>(null);const [done,setDone]=useState(false);if(done)return <PublicFrame><div className="mx-auto max-w-xl text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-emerald-100 text-emerald-600"><CheckCircle2 size={40}/></div><h1 className="mt-6 text-3xl font-black">Ujian selesai!</h1><p className="mt-2 text-slate-500">Jawaban Anda telah tersimpan.</p><div className="mx-auto mt-8 max-w-sm rounded-2xl bg-slate-950 p-6 text-white"><p className="text-xs text-slate-400">Nilai sementara</p><p className="mt-2 text-5xl font-black text-teal-300">85</p><p className="mt-2 text-xs text-slate-400">17 benar dari 20 soal</p></div></div></PublicFrame>;if(!started)return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><span className="rounded-full bg-sky-50 px-3 py-1.5 text-[10px] font-black text-sky-700">ULANGAN AKTIF</span><h1 className="mt-5 text-2xl font-black">Quiz Matematika — Persamaan Linear</h1><div className="mt-5 grid grid-cols-3 gap-2 text-center">{[['20','Soal'],['60','Menit'],['75','KKM']].map(([v,l])=><div key={l} className="rounded-xl bg-slate-50 p-3"><p className="font-black">{v}</p><p className="text-[10px] text-slate-400">{l}</p></div>)}</div><label className="mt-6 block"><span className="mb-2 block text-xs font-extrabold">Masukkan NIS</span><input value={nis} onChange={(e)=>setNis(e.target.value)} placeholder="Contoh: 24001" className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-teal-500"/></label><div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><ShieldCheck className="mr-1 inline" size={15}/>Ujian wajib fullscreen. Perpindahan tab dan perangkat akan dicatat.</div><button disabled={!nis} onClick={()=>setStarted(true)} className="mt-5 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">Mulai ujian</button></div></PublicFrame>;return <PublicFrame><div className="mx-auto max-w-3xl"><div className="mb-5 flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white"><div><p className="text-[10px] text-slate-400">SOAL 1 DARI 20</p><p className="text-xs font-bold">NIS {nis}</p></div><div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-teal-300"><Timer size={17}/>59:42</div></div><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-xs font-black text-teal-600">PERTANYAAN 01</p><h1 className="mt-4 text-xl font-black leading-relaxed">Nilai x yang memenuhi persamaan 3x + 5 = 20 adalah...</h1><div className="mt-7 space-y-3">{['3','5','7','15'].map((item,i)=><button key={item} onClick={()=>setAnswer(i)} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left text-sm font-bold transition ${answer===i?'border-teal-500 bg-teal-50 text-teal-800':'border-slate-200 hover:border-slate-300'}`}><span className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-black ${answer===i?'bg-teal-600 text-white':'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65+i)}</span>{item}</button>)}</div><div className="mt-7 flex justify-end"><button disabled={answer===null} onClick={()=>setDone(true)} className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-40">Simpan & lanjutkan<ChevronRight size={16}/></button></div></section></div></PublicFrame>}
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
  const [snapshot, setSnapshot] = useState<{ ownerUid: string; className: string; students: Student[] } | null>(null);
  const [nis, setNis] = useState("");
  const [guardian, setGuardian] = useState("");
  const [phone, setPhone] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (snapshotId === "demo") {
      setSnapshot({ ownerUid: "demo", className: "VII A", students: demoStudents.filter((item) => item.className === "VII A") });
      setLoading(false);
      return;
    }
    void getDoc(doc(db, "publicSnapshots", snapshotId)).then((result) => {
      if (!result.exists() || result.data().published !== true || result.data().type !== "guardian") throw new Error("Link pendataan tidak ditemukan atau sudah dinonaktifkan.");
      const data = result.data() as { ownerUid: string; className: string; students: Student[] };
      setSnapshot({ ownerUid: data.ownerUid, className: data.className, students: data.students ?? [] });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Link tidak dapat dibuka."))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  function findStudent() {
    setError(""); setStudent(null);
    if (!snapshot) return;
    const match = snapshot.students.find((item) => item.nis.trim() === nis.trim());
    if (!match) { setError("NIS tidak ditemukan pada data kelas ini."); return; }
    setStudent(match);
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
        await addDoc(collection(db, "publicResponses"), {
          snapshotId,
          ownerUid: snapshot.ownerUid,
          studentId: student.id,
          nis: student.nis,
          studentName: student.name,
          className: student.className,
          guardian: guardian.trim(),
          phone: normalizedPhone,
          status: "pending",
          createdAt: serverTimestamp(),
        });
      }
      setDone(true);
    } catch { setError("Data belum dapat dikirim. Silakan coba kembali."); }
    finally { setSubmitting(false); }
  }

  if (loading) return <PublicFrame><div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-teal-600" size={30}/></div></PublicFrame>;
  if (done) return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-xl"><CheckCircle2 className="mx-auto text-emerald-600" size={60}/><h1 className="mt-5 text-2xl font-black">Data berhasil dikirim</h1><p className="mt-2 text-sm leading-6 text-slate-500">Terima kasih. Nama wali dan nomor WhatsApp akan otomatis masuk ke data siswa.</p></div></PublicFrame>;
  if (!snapshot) return <PublicFrame><div className="mx-auto max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={55}/><h1 className="mt-5 text-xl font-black">Link tidak tersedia</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></PublicFrame>;

  return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-wider text-teal-600">Pendataan Wali Murid · {snapshot.className}</p><h1 className="mt-2 text-2xl font-black">Lengkapi data wali siswa</h1><p className="mt-2 text-sm leading-6 text-slate-500">Masukkan NIS sesuai data sekolah untuk menemukan nama siswa.</p><div className="mt-6"><Field label="NIS" value={nis} onChange={setNis} placeholder="Contoh: 20260101" required/></div><button onClick={findStudent} className="mt-3 w-full rounded-xl bg-slate-950 py-3 text-sm font-extrabold text-white">Cari data siswa</button>{error&&<p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}{student&&<form onSubmit={submitGuardian} className="mt-6 space-y-4 border-t border-slate-100 pt-6"><div className="rounded-xl bg-teal-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Data ditemukan</p><p className="mt-1 font-black text-teal-950">{student.name}</p><p className="mt-1 text-xs text-teal-700">NIS {student.nis} · {student.className}</p></div><Field label="Nama orang tua / wali" value={guardian} onChange={setGuardian} placeholder="Nama lengkap wali" required/><Field label="Nomor WhatsApp aktif" value={phone} onChange={setPhone} placeholder="Contoh: 081234567890" required/><p className="rounded-xl bg-sky-50 p-3 text-[11px] leading-5 text-sky-700">Nomor WhatsApp digunakan sekolah untuk informasi kehadiran dan komunikasi wali kelas.</p><button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-60">{submitting&&<Loader2 className="animate-spin" size={17}/>}Kirim data wali</button></form>}</div></PublicFrame>;
}
function PublicFrame({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8faf7,transparent_35%),linear-gradient(135deg,#f7fbff,#fffaf0)] px-4 py-8 sm:py-12"><header className="mx-auto mb-10 flex max-w-5xl items-center justify-between"><Logo/><span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 sm:block">Portal Publik Siswa</span></header>{children}</main>}

export default SmartAttApp;
