"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Clock3, Loader2,
  ShieldCheck, Timer, Trophy, XCircle,
} from "lucide-react";
import {
  arrayUnion, collection, doc, getDoc, increment, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { QuizQuestion } from "../lib/quiz";
import { createRandomizedQuiz, formatCountdown, type RandomizedQuestion } from "../lib/quizRuntime";

type StudentIdentity = { id: string; nis: string; name: string; className: string };
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
  startAtMs: number;
  endAtMs: number;
  students: StudentIdentity[];
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
  randomSeed?: string;
};

const EXAM_DEVICE_COOKIE = "smartatt_exam_device";

function getExamDeviceSessionId() {
  const saved = document.cookie.split("; ").find((part) => part.startsWith(`${EXAM_DEVICE_COOKIE}=`))?.split("=").slice(1).join("=");
  if (saved) return decodeURIComponent(saved);
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.cookie = `${EXAM_DEVICE_COOKIE}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
  return id;
}

function getExamClientSessionId() {
  const prefix = "smartatt-exam-client:";
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const canResume = navigation?.type === "reload" || navigation?.type === "back_forward";
  if (canResume && window.name.startsWith(prefix)) return window.name.slice(prefix.length);
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.name = `${prefix}${id}`;
  return id;
}

function createAttemptRandomSeed() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getDeviceLabel() {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(agent)) return "iPhone/iPad";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Macintosh/i.test(agent)) return "Mac";
  return "Perangkat lain";
}

function firebaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8faf7,transparent_35%),linear-gradient(135deg,#f7fbff,#fffaf0)] px-4 py-7 sm:py-12"><header className="mx-auto mb-8 flex max-w-5xl items-center justify-between"><div className="flex items-center gap-3"><img src="/logo.png" alt="Logo SMART-ATT" className="h-11 w-11 rounded-xl object-cover"/><div><p className="text-sm font-black">SMART-ATT</p><p className="text-[10px] text-slate-400">Portal Ujian Online</p></div></div><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-500">AUTO-SAVE AKTIF</span></header>{children}</main>;
}

function startCountdown(targetMs: number, nowMs: number) {
  const total = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds };
}

export function PublicQuizProfessional() {
  const pathname = usePathname();
  const snapshotId = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "demo");
  const [snapshot, setSnapshot] = useState<PublicQuizSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [nis, setNis] = useState("");
  const [student, setStudent] = useState<StudentIdentity | null>(null);
  const [phase, setPhase] = useState<"login" | "quiz" | "waiting" | "result">("login");
  const [quiz, setQuiz] = useState<RandomizedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [attemptId, setAttemptId] = useState("");
  const [startedAtMs, setStartedAtMs] = useState(0);
  const [deadlineMs, setDeadlineMs] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [warning, setWarning] = useState("");
  const [violationCount, setViolationCount] = useState(0);
  const [result, setResult] = useState({ score: 0, correct: 0, duration: 0 });
  const [rankings, setRankings] = useState<QuizAttempt[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const submittingRef = useRef(false);
  const lastViolationRef = useRef({ type: "", at: 0 });
  const deviceSessionRef = useRef("");
  const lockAttemptRef = useRef("");
  const clientSessionRef = useRef("");

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (snapshotId === "demo") {
      const now = Date.now();
      setSnapshot({ type: "quiz", ownerUid: "demo", examId: "demo-exam", published: true, title: "Quiz Matematika — Persamaan Linear", subject: "Matematika", className: "VII A", chapter: "Persamaan linear", durationMinutes: 1, startAtMs: now - 5000, endAtMs: now + 55000, questions: [{ question: "Nilai x yang memenuhi 3x + 5 = 20 adalah...", choices: ["3", "5", "7", "15"], answerIndex: 1, explanation: "3x = 15, sehingga x = 5." }], students: [{ id: "1", nis: "24001", name: "Alya Putri Ramadhani", className: "VII A" }] });
      setLoading(false); return;
    }
    return onSnapshot(doc(db, "publicSnapshots", snapshotId), (resultSnapshot) => {
      const data = resultSnapshot.data();
      if (!resultSnapshot.exists() || data?.type !== "quiz" || data.published !== true) { setSnapshot(null); setError("Ujian tidak ditemukan atau sudah dinonaktifkan."); }
      else setSnapshot(data as PublicQuizSnapshot);
      setLoading(false);
    }, () => { setError("Ujian tidak dapat dibuka."); setLoading(false); });
  }, [snapshotId]);
  useEffect(() => {
    if (!snapshot || clock < snapshot.endAtMs || phase !== "result" || snapshotId === "demo") return;
    const rankingsQuery = query(collection(db, "publicQuizAttempts"), where("snapshotId", "==", snapshotId));
    return onSnapshot(rankingsQuery, (resultSnapshot) => {
      const next = resultSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as QuizAttempt)).filter((item) => item.status === "finished");
      next.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity));
      setRankings(next.slice(0, 5));
    }, () => setError("Ranking belum dapat dimuat. Muat ulang setelah waktu ujian berakhir."));
  }, [snapshot, snapshotId, phase, clock >= (snapshot?.endAtMs ?? Infinity)]);
  useEffect(() => {
    if (phase === "waiting" && snapshot && clock >= snapshot.endAtMs) setPhase("result");
  }, [phase, snapshot, clock]);

  async function enterFullscreen() {
    if (document.fullscreenElement) return true;
    if (!document.documentElement.requestFullscreen) { setError("Gunakan Chrome atau Edge terbaru yang mendukung fullscreen."); return false; }
    try { await document.documentElement.requestFullscreen(); setWarning(""); return true; }
    catch { setError("Izinkan mode fullscreen untuk memulai atau melanjutkan ujian."); return false; }
  }

  async function claimDeviceLock(id: string, match: StudentIdentity) {
    if (!snapshot || snapshotId === "demo") return true;
    const sessionId = getExamDeviceSessionId();
    if (!clientSessionRef.current) clientSessionRef.current = getExamClientSessionId();
    try {
      await setDoc(doc(db, "publicQuizDeviceLocks", id), {
        attemptId: id,
        snapshotId,
        examId: snapshot.examId,
        ownerUid: snapshot.ownerUid,
        studentId: match.id,
        nis: match.nis,
        sessionId,
        clientSessionId: clientSessionRef.current,
        deviceLabel: getDeviceLabel(),
        claimedAtMs: Date.now(),
        heartbeatAtMs: Date.now(),
        expiresAtMs: snapshot.endAtMs,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      deviceSessionRef.current = sessionId;
      lockAttemptRef.current = id;
      return true;
    } catch (lockError) {
      if (document.fullscreenElement) void document.exitFullscreen();
      if (firebaseErrorCode(lockError).includes("permission-denied")) {
        setError(`NIS ${match.nis} sedang login di perangkat/sesi lain (Perangkat A). Tidak bisa melanjutkan atau mengikuti ujian. Hubungi guru untuk membuka kunci jika memang harus pindah perangkat.`);
      } else {
        setError("Perangkat belum dapat diverifikasi. Periksa koneksi lalu coba lagi.");
      }
      return false;
    }
  }

  function applyAttempt(match: StudentIdentity, randomized: RandomizedQuestion[], id: string, data: QuizAttempt) {
    const savedAnswers = data.answers ?? {};
    setStudent(match); setQuiz(randomized); setAnswers(savedAnswers); setAttemptId(id);
    setStartedAtMs(data.startedAtMs ?? Date.now()); setDeadlineMs(data.deadlineMs ?? snapshot?.endAtMs ?? Date.now());
    setRemaining(Math.max(0, Math.ceil(((data.deadlineMs ?? snapshot?.endAtMs ?? Date.now()) - Date.now()) / 1000)));
    setViolationCount(data.violations?.length ?? 0);
    setResult({ score: data.score ?? 0, correct: data.correctCount ?? 0, duration: data.durationSeconds ?? 0 });
  }

  async function calculateAndFinish(id: string, randomized: RandomizedQuestion[], savedAnswers: Record<string, number>, startMs: number, auto: boolean) {
    const correct = randomized.reduce((total, question, index) => total + (savedAnswers[String(index)] === question.answerIndex ? 1 : 0), 0);
    const score = Math.round(correct / randomized.length * 100);
    const duration = Math.max(0, Math.min(Math.floor((Date.now() - startMs) / 1000), snapshot?.durationMinutes ? snapshot.durationMinutes * 60 : Infinity));
    if (snapshotId !== "demo") await updateDoc(doc(db, "publicQuizAttempts", id), { status: "finished", answers: savedAnswers, correctCount: correct, score, durationSeconds: duration, finishedAt: serverTimestamp(), finishReason: auto ? "waktu_habis" : "dikirim_siswa", updatedAt: serverTimestamp() });
    setResult({ score, correct, duration });
  }

  async function startQuiz() {
    if (!snapshot) return;
    const match = snapshot.students.find((item) => item.nis.trim().toLowerCase() === nis.trim().toLowerCase());
    if (!match) { setError("NIS tidak ditemukan pada daftar peserta ujian."); return; }
    const id = `${snapshotId}_${match.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const attemptRef = doc(db, "publicQuizAttempts", id);
    const now = Date.now();
    setError("");
    if (now < snapshot.startAtMs) { setError("Ujian belum dimulai."); return; }
    if (snapshotId === "demo") {
      if (now >= snapshot.endAtMs) { setError("Sesi demo telah berakhir. Buka ulang link untuk membuat sesi baru."); return; }
      if (!await enterFullscreen()) return;
      const randomSeed = createAttemptRandomSeed();
      const randomized = createRandomizedQuiz(snapshot.questions, randomSeed);
      applyAttempt(match, randomized, id, { id, snapshotId, examId: snapshot.examId, ownerUid: snapshot.ownerUid, studentId: match.id, nis: match.nis, studentName: match.name, className: match.className, status: "active", answers: {}, startedAtMs: now, deadlineMs: snapshot.endAtMs, randomSeed });
      setPhase("quiz"); return;
    }
    try {
      const existing = await getDoc(attemptRef);
      if (existing.exists()) {
        const data = { id, ...existing.data() } as QuizAttempt;
        let randomSeed = data.randomSeed ?? `${snapshotId}:${match.nis}`;
        let randomized = createRandomizedQuiz(snapshot.questions, randomSeed);
        if (data.status === "finished") { applyAttempt(match, randomized, id, data); setPhase(now >= snapshot.endAtMs ? "result" : "waiting"); return; }
        if (now >= snapshot.endAtMs) { applyAttempt(match, randomized, id, data); await calculateAndFinish(id, randomized, data.answers ?? {}, data.startedAtMs ?? now, true); setPhase("result"); return; }
        if (!await enterFullscreen()) return;
        if (!await claimDeviceLock(id, match)) return;
        if (!data.randomSeed && Object.keys(data.answers ?? {}).length === 0) {
          randomSeed = createAttemptRandomSeed();
          data.randomSeed = randomSeed;
          randomized = createRandomizedQuiz(snapshot.questions, randomSeed);
          await updateDoc(attemptRef, { randomSeed, updatedAt: serverTimestamp() });
        }
        applyAttempt(match, randomized, id, data);
        await updateDoc(attemptRef, { reloginCount: increment(1), loginEvents: arrayUnion({ type: "login_ulang", atMs: now }), updatedAt: serverTimestamp() });
        setPhase("quiz"); return;
      }
      if (now >= snapshot.endAtMs) { setError("Anda tidak memiliki hasil karena tidak mengikuti ujian sebelum waktunya berakhir."); return; }
      if (!await enterFullscreen()) return;
      if (!await claimDeviceLock(id, match)) return;
      const randomSeed = createAttemptRandomSeed();
      const randomized = createRandomizedQuiz(snapshot.questions, randomSeed);
      const initial: QuizAttempt = { id, snapshotId, examId: snapshot.examId, ownerUid: snapshot.ownerUid, studentId: match.id, nis: match.nis, studentName: match.name, className: match.className, status: "active", answers: {}, violations: [], startedAtMs: now, deadlineMs: snapshot.endAtMs, reloginCount: 0, randomSeed };
      const { id: _localId, ...initialPayload } = initial;
      await setDoc(attemptRef, { ...initialPayload, loginEvents: [{ type: "login_awal", atMs: now }], startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      applyAttempt(match, randomized, id, initial); setPhase("quiz");
    } catch (quizError) {
      setError(firebaseErrorCode(quizError).includes("permission-denied") ? "Akses ujian ditolak. Muat ulang lalu coba kembali." : "Data ujian belum dapat dibuka. Periksa koneksi lalu coba lagi.");
    }
  }

  async function recordViolation(type: string) {
    if (phase !== "quiz" || !attemptId || snapshotId === "demo") return;
    const now = Date.now();
    if (lastViolationRef.current.type === type && now - lastViolationRef.current.at < 1500) return;
    lastViolationRef.current = { type, at: now }; setViolationCount((value) => value + 1);
    try { await updateDoc(doc(db, "publicQuizAttempts", attemptId), { violations: arrayUnion({ type, atMs: now }), updatedAt: serverTimestamp() }); } catch {}
  }
  useEffect(() => {
    if (phase !== "quiz") return;
    const visibility = () => { if (document.hidden) { setWarning("Anda terdeteksi berpindah tab atau membuka aplikasi lain. Aktivitas ini dicatat untuk guru."); void recordViolation("pindah_tab_atau_aplikasi"); } };
    const fullscreen = () => { if (!document.fullscreenElement) { setWarning("Anda keluar dari fullscreen. Kembali ke fullscreen untuk melanjutkan."); void recordViolation("keluar_fullscreen"); } };
    const blur = () => { if (!document.hidden) void recordViolation("jendela_tidak_aktif"); };
    document.addEventListener("visibilitychange", visibility); document.addEventListener("fullscreenchange", fullscreen); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("visibilitychange", visibility); document.removeEventListener("fullscreenchange", fullscreen); window.removeEventListener("blur", blur); };
  }, [phase, attemptId]);
  useEffect(() => {
    if (phase !== "quiz" || snapshotId === "demo" || !attemptId || lockAttemptRef.current !== attemptId || !deviceSessionRef.current) return;
    const heartbeat = async () => {
      try {
        await updateDoc(doc(db, "publicQuizDeviceLocks", attemptId), { heartbeatAtMs: Date.now(), updatedAt: serverTimestamp() });
      } catch (heartbeatError) {
        const code = firebaseErrorCode(heartbeatError);
        if (!code.includes("permission-denied") && !code.includes("not-found")) return;
        setError("Sesi perangkat ini sudah dibuka atau dipindahkan oleh guru. Masukkan NIS kembali untuk melanjutkan.");
        setPhase("login");
        if (document.fullscreenElement) void document.exitFullscreen();
      }
    };
    const interval = setInterval(() => void heartbeat(), 10000);
    return () => clearInterval(interval);
  }, [phase, snapshotId, attemptId]);
  useEffect(() => {
    if (phase !== "quiz" || !deadlineMs) return;
    const tick = () => { const next = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)); setRemaining(next); if (next === 0) void finishQuiz(true); };
    tick(); const interval = setInterval(tick, 1000); return () => clearInterval(interval);
  }, [phase, deadlineMs, quiz, answers]);

  async function selectAnswer(originalChoiceIndex: number) {
    const next = { ...answers, [String(current)]: originalChoiceIndex }; setAnswers(next);
    if (snapshotId !== "demo" && attemptId) try { await updateDoc(doc(db, "publicQuizAttempts", attemptId), { answers: next, lastAnsweredAtMs: Date.now(), updatedAt: serverTimestamp() }); } catch { setError("Jawaban tersimpan di layar, tetapi sinkronisasi tertunda. Periksa koneksi."); }
  }
  async function finishQuiz(auto = false) {
    if (submittingRef.current || phase !== "quiz" || !quiz.length) return;
    submittingRef.current = true;
    try { await calculateAndFinish(attemptId, quiz, answers, startedAtMs, auto); setPhase(snapshot && Date.now() >= snapshot.endAtMs ? "result" : "waiting"); setWarning(""); if (document.fullscreenElement) await document.exitFullscreen(); }
    catch { setError("Jawaban belum dapat dikirim. Periksa koneksi lalu coba lagi."); submittingRef.current = false; }
  }

  const beforeStart = snapshot ? clock < snapshot.startAtMs : false;
  const ended = snapshot ? clock >= snapshot.endAtMs : false;
  const countdown = snapshot ? startCountdown(snapshot.startAtMs, clock) : { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const top = rankings;
  const reviewRows = useMemo(() => quiz.map((question, index) => ({ question, selected: answers[String(index)] })), [quiz, answers]);

  if (loading) return <PublicFrame><div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-teal-600" size={34}/></div></PublicFrame>;
  if (!snapshot) return <PublicFrame><div className="mx-auto max-w-lg rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-xl"><XCircle className="mx-auto text-rose-600" size={40}/><h1 className="mt-4 text-2xl font-black">Ujian tidak tersedia</h1><p className="mt-2 text-sm text-slate-500">{error || "Minta link terbaru kepada guru."}</p></div></PublicFrame>;
  if (beforeStart) return <PublicFrame><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl sm:p-10"><span className="rounded-full bg-violet-50 px-3 py-1.5 text-[10px] font-black text-violet-700">UJIAN TERJADWAL</span><h1 className="mt-5 text-3xl font-black">{snapshot.title}</h1><p className="mt-2 text-sm text-slate-500">{snapshot.subject} · {snapshot.className}</p><div className="mt-8 rounded-3xl bg-slate-950 p-6 text-white"><p className="text-xs font-bold text-slate-400">Ujian dimulai dalam</p><div className="mt-5 grid grid-cols-4 gap-2">{[[countdown.days, "Hari"], [countdown.hours, "Jam"], [countdown.minutes, "Menit"], [countdown.seconds, "Detik"]].map(([value, label]) => <div key={String(label)} className="rounded-2xl bg-white/10 p-3"><p className="text-2xl font-black text-teal-300">{String(value).padStart(2, "0")}</p><p className="mt-1 text-[9px] uppercase text-slate-400">{label}</p></div>)}</div></div><p className="mt-6 text-xs leading-5 text-slate-400">Soal akan terbuka otomatis pada {new Date(snapshot.startAtMs).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}.</p></section></PublicFrame>;
  if (phase === "waiting") return <PublicFrame><section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl sm:p-10"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-emerald-100 text-emerald-600"><CheckCircle2 size={40}/></div><h1 className="mt-6 text-3xl font-black">Ujian telah selesai</h1><p className="mt-3 text-sm leading-6 text-slate-500">Silakan menunggu hingga seluruh peserta menyelesaikan ujian.<br/>Hasil akan diumumkan setelah waktu ujian berakhir.</p><div className="mt-7 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-[10px] font-black uppercase text-slate-400">Hasil dibuka dalam</p><p className="mt-2 text-3xl font-black text-teal-300">{formatCountdown(Math.ceil((snapshot.endAtMs - clock) / 1000))}</p></div></section></PublicFrame>;
  if (phase === "result") return <PublicFrame><div className="mx-auto max-w-4xl"><section className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8"><div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><span className="rounded-full bg-emerald-400/15 px-3 py-1.5 text-[10px] font-black text-emerald-300">HASIL RESMI</span><h1 className="mt-4 text-3xl font-black">{student?.name}</h1><p className="mt-1 text-sm text-slate-400">NIS {student?.nis} · {snapshot.title}</p></div><div className="text-left sm:text-right"><p className="text-xs text-slate-400">Nilai</p><p className="text-6xl font-black text-teal-300">{result.score}</p></div></div><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><ResultStat label="Benar" value={String(result.correct)}/><ResultStat label="Salah" value={String(snapshot.questions.length - result.correct)}/><ResultStat label="Persentase" value={`${result.score}%`}/><ResultStat label="Waktu" value={formatCountdown(result.duration)}/></div></section><section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-center gap-3"><Trophy className="text-amber-500"/><div><h2 className="font-black">Top 5 Ranking</h2><p className="text-xs text-slate-400">Nilai tertinggi, lalu waktu tercepat.</p></div></div><div className="mt-5 space-y-2">{top.map((attempt, index) => <div key={attempt.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3"><span className={`grid h-10 w-10 place-items-center rounded-xl font-black ${index < 3 ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{attempt.studentName}</p><p className="text-[10px] text-slate-400">{formatCountdown(attempt.durationSeconds ?? 0)}</p></div><p className="text-xl font-black text-teal-700">{attempt.score ?? 0}</p></div>)}{!top.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ranking sedang dimuat.</p>}</div></section><button onClick={() => setReviewOpen((value) => !value)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3.5 text-sm font-extrabold text-white">Review jawaban <ChevronDown size={17}/></button>{reviewOpen&&<section className="mt-4 space-y-4">{reviewRows.map(({ question, selected }, index) => <article key={`${question.originalQuestionIndex}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[10px] font-black text-teal-600">SOAL {index + 1}</p><h3 className="mt-2 text-sm font-black leading-6">{question.question}</h3><div className="mt-4 space-y-2">{question.choices.map((choice, choiceIndex) => { const correct = choice.originalChoiceIndex === question.answerIndex; const chosen = choice.originalChoiceIndex === selected; return <div key={choice.originalChoiceIndex} className={`rounded-xl border p-3 text-xs font-bold ${correct ? "border-emerald-200 bg-emerald-50 text-emerald-800" : chosen ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-100 bg-slate-50 text-slate-500"}`}><span className="mr-2 font-black">{String.fromCharCode(65 + choiceIndex)}.</span>{choice.text}{correct&&<span className="ml-2 text-[9px] font-black">JAWABAN BENAR</span>}{chosen&&!correct&&<span className="ml-2 text-[9px] font-black">JAWABAN ANDA</span>}</div>; })}</div><p className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-800"><strong>Pembahasan:</strong> {question.explanation || "Pembahasan belum ditambahkan oleh guru."}</p></article>)}</section>}</div></PublicFrame>;
  if (phase === "login") return <PublicFrame><section className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"><span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${ended ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>{ended ? "HASIL UJIAN" : "UJIAN SEDANG BERLANGSUNG"}</span><h1 className="mt-5 text-2xl font-black">{snapshot.title}</h1><p className="mt-2 text-sm text-slate-500">{snapshot.subject} · {snapshot.className}</p><div className="mt-5 grid grid-cols-3 gap-2 text-center"><ResultStat label="Soal" value={String(snapshot.questions.length)} light/><ResultStat label="Durasi" value={`${snapshot.durationMinutes} mnt`} light/><ResultStat label={ended ? "Status" : "Sisa waktu"} value={ended ? "Selesai" : formatCountdown(Math.ceil((snapshot.endAtMs - clock) / 1000))} light/></div><label className="mt-6 block"><span className="mb-2 block text-xs font-extrabold">Masukkan NIS</span><input value={nis} onChange={(event) => { setNis(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void startQuiz(); }} placeholder="Nomor induk siswa" className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-teal-500"/></label>{error&&<p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}<div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><ShieldCheck className="mr-1 inline" size={15}/>{ended ? "Masukkan NIS yang digunakan saat ujian untuk membuka nilai, ranking, dan review." : "Satu NIS hanya dapat aktif di satu perangkat/sesi. Refresh pada tab yang sama tetap dapat melanjutkan jawaban terakhir."}</div><button disabled={!nis.trim()} onClick={() => void startQuiz()} className="mt-5 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">{ended ? "Lihat hasil ujian" : "Masuk fullscreen & mulai"}</button></section></PublicFrame>;
  const question = quiz[current]; const answeredCount = Object.keys(answers).length;
  return <PublicFrame><div className="mx-auto max-w-3xl"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-white"><div><p className="text-[10px] text-slate-400">SOAL {current + 1} DARI {quiz.length} · {answeredCount} TERJAWAB</p><p className="text-xs font-bold">{student?.name} · NIS {student?.nis}</p></div><div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${remaining <= 300 ? "bg-rose-500/20 text-rose-200" : "bg-white/10 text-teal-300"}`}><Timer size={17}/>{formatCountdown(remaining)}</div></div><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"><p className="text-xs font-black text-teal-600">PERTANYAAN {String(current + 1).padStart(2, "0")}</p><h1 className="mt-4 text-xl font-black leading-relaxed">{question.question}</h1><div className="mt-7 space-y-3">{question.choices.map((choice, index) => { const selected = answers[String(current)] === choice.originalChoiceIndex; return <button key={`${choice.originalChoiceIndex}-${choice.text}`} onClick={() => void selectAnswer(choice.originalChoiceIndex)} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left text-sm font-bold transition ${selected ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-200 hover:border-slate-300"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${selected ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500"}`}>{String.fromCharCode(65 + index)}</span>{choice.text}</button>; })}</div><div className="mt-7 flex flex-wrap items-center justify-between gap-3"><button disabled={current === 0} onClick={() => setCurrent((value) => Math.max(0, value - 1))} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold disabled:opacity-30"><ArrowLeft className="mr-2 inline" size={15}/>Sebelumnya</button>{current < quiz.length - 1 ? <button onClick={() => setCurrent((value) => Math.min(quiz.length - 1, value + 1))} className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-extrabold text-white">Berikutnya<ChevronRight className="ml-2 inline" size={15}/></button> : <button onClick={() => void finishQuiz(false)} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-extrabold text-white">Kirim semua jawaban</button>}</div></section><p className={`mt-4 text-center text-xs font-bold ${violationCount ? "text-rose-600" : "text-slate-400"}`}>{violationCount} aktivitas keluar/pindah tab tercatat</p></div>{warning&&<div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/90 p-5"><div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl"><ShieldCheck className="mx-auto text-rose-600" size={42}/><h2 className="mt-4 text-2xl font-black">Peringatan ujian</h2><p className="mt-3 text-sm leading-6 text-slate-600">{warning}</p><button onClick={() => void enterFullscreen()} className="mt-6 w-full rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white">Kembali ke fullscreen</button></div></div>}</PublicFrame>;
}

function ResultStat({ label, value, light = false }: { label: string; value: string; light?: boolean }) {
  return <div className={`rounded-2xl p-3 ${light ? "bg-slate-50" : "bg-white/10"}`}><p className={`text-[9px] font-black uppercase ${light ? "text-slate-400" : "text-slate-400"}`}>{label}</p><p className={`mt-1 font-black ${light ? "text-slate-900" : "text-white"}`}>{value}</p></div>;
}
