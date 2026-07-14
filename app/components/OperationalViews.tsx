"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, CalendarDays, Camera, CheckCircle2, CircleUserRound, Download,
  Loader2, LockKeyhole, MessageCircle, ScanLine, X,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { findStudentByQrOrNis } from "../lib/attendance";

type Student = {
  id: string;
  nis: string;
  name: string;
  className: string;
  guardian?: string;
  phone?: string;
  photoKey?: string;
  photoThumbnailKey?: string;
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
type AttendanceHit = { sessionId: string; className: string; record: AttendanceRecord };
type Toast = { message: string; tone: "success" | "error" } | null;
type CommonProps = { user: User | null; demo: boolean; students: Student[]; setToast: (toast: Toast) => void };

function localDateKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function StudentPhoto({ user, photoKey, name, className }: { user: User | null; photoKey?: string; name: string; className: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!user || !photoKey) { setUrl(""); return; }
    let active = true;
    let objectUrl = "";
    void user.getIdToken().then((token) => fetch(`/api/storage/file/${encodeURIComponent(photoKey)}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then((response) => { if (!response.ok) throw new Error(); return response.blob(); })
      .then((blob) => { if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (active) setUrl(""); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user, photoKey]);
  if (!url) return <div className={`${className} grid place-items-center bg-slate-100 text-slate-400`}><CircleUserRound size={54}/></div>;
  return <img src={url} alt={`Foto ${name}`} className={className}/>;
}

type ScannerProps = CommonProps & { configuredClasses?: string[] };

export function ScannerViewPro({ user, demo, students, setToast, configuredClasses = [] }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<AttendanceSession | null>(null);
  const studentsRef = useRef(students);
  const attendanceTodayRef = useRef<Map<string, AttendanceHit>>(new Map());
  const pendingRef = useRef(false);
  const missingListRef = useRef<HTMLElement>(null);
  const classes = useMemo(() => Array.from(new Set([...configuredClasses, ...students.map((item) => item.className)].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id")), [configuredClasses, students]);
  const [schoolName, setSchoolName] = useState(demo ? "SMP Harapan Bangsa" : "Sekolah");
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [todaySessions, setTodaySessions] = useState<AttendanceSession[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [starting, setStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualNis, setManualNis] = useState("");
  const [pending, setPending] = useState<{ student: Student; source: "qr" | "manual"; scannedAtMs: number; existing?: AttendanceHit } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [sharingId, setSharingId] = useState("");

  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { pendingRef.current = Boolean(pending); }, [pending]);
  useEffect(() => {
    if (!pending) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => { document.body.style.overflow = previousOverflow; document.body.style.overscrollBehavior = previousOverscroll; };
  }, [pending]);
  useEffect(() => {
    if (demo || !user) return;
    return onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      const value = snapshot.data()?.schoolName;
      if (typeof value === "string" && value.trim()) setSchoolName(value.trim());
    });
  }, [demo, user]);
  useEffect(() => {
    if (demo || !user) return;
    return onSnapshot(collection(db, "users", user.uid, "attendanceSessions"), (snapshot) => {
      const sessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), records: item.data().records ?? {} } as AttendanceSession));
      sessions.sort((a, b) => b.startedAtMs - a.startedAtMs);
      const today = localDateKey(Date.now());
      const attendanceToday = new Map<string, AttendanceHit>();
      sessions.filter((item) => localDateKey(item.startedAtMs) === today).forEach((item) => {
        Object.values(item.records).forEach((record) => {
          const previous = attendanceToday.get(record.studentId);
          if (!previous || previous.record.recordedAtMs < record.recordedAtMs) attendanceToday.set(record.studentId, { sessionId: item.id, className: item.className, record });
        });
      });
      attendanceTodayRef.current = attendanceToday;
      const sessionsToday = sessions.filter((item) => localDateKey(item.startedAtMs) === today);
      setTodaySessions(sessionsToday);
    }, () => setToast({ message: "Sesi absensi belum dapat dimuat.", tone: "error" }));
  }, [demo, user, setToast]);

  useEffect(() => {
    setSelectedClass((current) => classes.includes(current) ? current : (todaySessions.find((item) => item.status === "open")?.className ?? todaySessions[0]?.className ?? classes[0] ?? ""));
  }, [classes, todaySessions]);

  useEffect(() => {
    const current = todaySessions.find((item) => item.className === selectedClass) ?? null;
    setSession(current);
    sessionRef.current = current;
    if (current?.status !== "open") stopCamera();
  }, [selectedClass, todaySessions]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (detectorTimerRef.current) clearInterval(detectorTimerRef.current);
    detectorTimerRef.current = null;
    setCameraActive(false);
  }

  function dismissPending() {
    setPending(null);
    pendingRef.current = false;
  }

  function findAttendanceToday(studentId: string, current: AttendanceSession | null) {
    const today = localDateKey(Date.now());
    const indexed = attendanceTodayRef.current.get(studentId);
    if (indexed && localDateKey(indexed.record.recordedAtMs) === today) return indexed;
    const currentRecord = current?.records[studentId];
    if (currentRecord && current && localDateKey(currentRecord.recordedAtMs) === today) return { sessionId: current.id, className: current.className, record: currentRecord };
    return undefined;
  }

  async function beginSession() {
    if (!selectedClass || starting) {
      if (!selectedClass) setToast({ message: "Pilih kelas terlebih dahulu.", tone: "error" });
      return;
    }
    const otherOpen = todaySessions.find((item) => item.status === "open" && item.className !== selectedClass);
    if (otherOpen) {
      setToast({ message: `Absensi ${otherOpen.className} masih berlangsung. Tutup sesi tersebut sebelum memulai ${selectedClass}.`, tone: "error" });
      return;
    }
    const existing = todaySessions.find((item) => item.className === selectedClass);
    if (existing?.status === "open") {
      setSession(existing); sessionRef.current = existing;
      void startCamera();
      return;
    }
    setStarting(true);
    try {
      if (existing?.status === "closed") {
        if (!demo && user) await updateDoc(doc(db, "users", user.uid, "attendanceSessions", existing.id), { status: "open", closedAtMs: deleteField(), closedAt: deleteField(), updatedAt: serverTimestamp() });
        const reopened: AttendanceSession = { ...existing, status: "open" };
        delete reopened.closedAtMs;
        setTodaySessions((items) => items.map((item) => item.id === existing.id ? reopened : item));
        setSession(reopened); sessionRef.current = reopened;
        setToast({ message: `Absensi ${selectedClass} hari ini dibuka kembali, bukan membuat sesi baru.`, tone: "success" });
      } else {
        const startedAtMs = Date.now();
        const id = `${localDateKey(startedAtMs)}__${encodeURIComponent(selectedClass)}`;
        const payload = { className: selectedClass, schoolName, status: "open" as const, startedAtMs, records: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (!demo && user) await setDoc(doc(db, "users", user.uid, "attendanceSessions", id), payload);
        const created: AttendanceSession = { id, className: selectedClass, schoolName, status: "open", startedAtMs, records: {} };
        setTodaySessions((items) => [created, ...items.filter((item) => item.className !== selectedClass)]);
        setSession(created); sessionRef.current = created;
        setToast({ message: `Absensi ${selectedClass} dimulai. Kamera siap memindai.`, tone: "success" });
      }
      void startCamera();
    } catch {
      setToast({ message: "Sesi absensi belum dapat dimulai. Periksa koneksi Firebase.", tone: "error" });
    } finally { setStarting(false); }
  }

  function stageScan(raw: string, source: "qr" | "manual") {
    if (pendingRef.current) return;
    const current = sessionRef.current;
    if (!current || current.status !== "open") {
      setToast({ message: "Pilih kelas lalu tekan Mulai Absensi terlebih dahulu.", tone: "error" });
      return;
    }
    const value = raw.trim();
    if (!value) { setToast({ message: "Masukkan NIS terlebih dahulu.", tone: "error" }); return; }
    const student = findStudentByQrOrNis(studentsRef.current, value);
    if (!student) { setToast({ message: `QR/NIS ${value} tidak ditemukan.`, tone: "error" }); return; }
    if (current.className !== student.className) {
      setToast({ message: `Sesi aktif untuk ${current.className}. ${student.name} terdaftar di ${student.className}.`, tone: "error" });
      return;
    }
    const existing = findAttendanceToday(student.id, current);
    pendingRef.current = true;
    setPending({ student, source, scannedAtMs: Date.now(), ...(existing ? { existing } : {}) });
    setManualNis("");
  }
  async function startCamera() {
    if (!sessionRef.current || sessionRef.current.status !== "open") { setToast({ message: "Pilih kelas lalu tekan Mulai Absensi terlebih dahulu.", tone: "error" }); return; }
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraActive(true);
      const Detector = (window as unknown as { BarcodeDetector?: new(options: { formats: string[] }) => { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!Detector) { setToast({ message: "Pemindai QR browser tidak tersedia. Gunakan Chrome terbaru atau input NIS manual.", tone: "error" }); return; }
      const detector = new Detector({ formats: ["qr_code"] });
      detectorTimerRef.current = setInterval(async () => {
        if (!videoRef.current || pendingRef.current || videoRef.current.readyState < 2) return;
        const codes = await detector.detect(videoRef.current).catch(() => []);
        if (codes[0]?.rawValue) stageScan(codes[0].rawValue, "qr");
      }, 450);
    } catch {
      setToast({ message: "Kamera tidak dapat dibuka. Izinkan akses kamera atau gunakan input NIS manual.", tone: "error" });
    }
  }


  useEffect(() => () => stopCamera(), []);

  async function confirmAttendance() {
    if (!pending || confirming) return;
    setConfirming(true);
    const { student, source, scannedAtMs } = pending;
    try {
      const current = sessionRef.current;
      if (!current || current.status !== "open" || current.className !== student.className) {
        setToast({ message: "Sesi kelas tidak aktif. Pilih kelas dan mulai absensi lagi.", tone: "error" });
        dismissPending();
        return;
      }
      const existing = pending.existing ?? findAttendanceToday(student.id, current);
      if (existing) {
        setToast({ message: `${student.name} sudah absen. Data tidak disimpan dua kali.`, tone: "error" });
        dismissPending();
        return;
      }
      const record: AttendanceRecord = { studentId: student.id, status: "present", source, recordedAtMs: scannedAtMs };
      if (!demo && user) await updateDoc(doc(db, "users", user.uid, "attendanceSessions", current.id), { [`records.${student.id}`]: record, updatedAt: serverTimestamp() });
      const next = { ...current, records: { ...current.records, [student.id]: record } };
      attendanceTodayRef.current.set(student.id, { sessionId: current.id, className: current.className, record });
      setTodaySessions((items) => items.map((item) => item.id === current.id ? next : item));
      setSession(next); sessionRef.current = next;
      setToast({ message: `${student.name} tercatat hadir. Kamera siap untuk siswa berikutnya.`, tone: "success" });
      dismissPending();
      if (!streamRef.current) void startCamera();
    } catch {
      setToast({ message: "Absensi belum dapat disimpan ke Firebase. Periksa koneksi lalu konfirmasi lagi.", tone: "error" });
    } finally { setConfirming(false); }
  }
  async function closeSession() {
    const current = sessionRef.current;
    if (!current || current.status !== "open") return;
    const missingCount = students.filter((student) => student.className === current.className && !current.records[student.id]).length;
    if (!window.confirm(`Tutup absensi kelas ${current.className}? ${missingCount} siswa yang belum memiliki status akan tercatat Alpha di rekap. Tautan WA Sakit/Izin tetap dapat dikirim setelah sesi ditutup.`)) return;
    setClosing(true);
    try {
      const closedAtMs = Date.now();
      if (!demo && user) await updateDoc(doc(db, "users", user.uid, "attendanceSessions", current.id), { status: "closed", closedAtMs, closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const closed: AttendanceSession = { ...current, status: "closed", closedAtMs };
      stopCamera(); setTodaySessions((items) => items.map((item) => item.id === current.id ? closed : item)); setSession(closed); sessionRef.current = closed;
      setToast({ message: `Absensi ${current.className} selesai. ${missingCount} siswa masuk Alpha sampai wali mengonfirmasi Sakit/Izin.`, tone: "success" });
    } catch { setToast({ message: "Sesi absensi belum dapat ditutup.", tone: "error" }); }
    finally { setClosing(false); }
  }

  async function reopenSession() {
    const current = sessionRef.current;
    if (!current || current.status !== "closed") return;
    setReopening(true);
    try {
      if (!demo && user) await updateDoc(doc(db, "users", user.uid, "attendanceSessions", current.id), { status: "open", closedAtMs: deleteField(), closedAt: deleteField(), updatedAt: serverTimestamp() });
      const reopened: AttendanceSession = { ...current, status: "open" };
      delete reopened.closedAtMs;
      setTodaySessions((items) => items.map((item) => item.id === current.id ? reopened : item));
      setSession(reopened); sessionRef.current = reopened;
      setToast({ message: `Absensi ${current.className} dibuka kembali. Kamera siap digunakan.`, tone: "success" });
      void startCamera();
    } catch { setToast({ message: "Absensi belum dapat dibuka kembali.", tone: "error" }); }
    finally { setReopening(false); }
  }

  async function sendAbsenceWhatsapp(student: Student) {
    const current = sessionRef.current;
    if (!current) { setToast({ message: "Belum ada sesi absensi hari ini.", tone: "error" }); return; }
    const phone = (student.phone ?? "").replace(/\D/g, "").replace(/^0/, "62");
    if (phone.length < 10) { setToast({ message: `Nomor WhatsApp wali ${student.name} belum lengkap. Lengkapi di Data Siswa.`, tone: "error" }); return; }
    setSharingId(student.id);
    const popup = window.open("about:blank", "_blank");
    try {
      const snapshotId = demo ? `demo-${student.id}` : `absence-${user?.uid}-${current.id}-${student.id}`;
      const dateLabel = new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(new Date(current.startedAtMs));
      if (!demo && user) await setDoc(doc(db, "publicSnapshots", snapshotId), { type: "absence", ownerUid: user.uid, sessionId: current.id, published: true, schoolName, dateLabel, student: { id: student.id, nis: student.nis, name: student.name, className: student.className }, updatedAt: serverTimestamp() }, { merge: true });
      const confirmationLink = `${window.location.origin}/public/absence/${encodeURIComponent(snapshotId)}`;
      const message = `Yth. Bapak/Ibu ${student.guardian || "wali murid"}, ${student.name} belum tercatat hadir pada absensi ${dateLabel}. Mohon konfirmasi Sakit atau Izin beserta keterangannya melalui tautan SMART-ATT berikut: ${confirmationLink}`;
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if (popup) { popup.opener = null; popup.location.href = whatsappUrl; } else window.location.assign(whatsappUrl);
      setToast({ message: `Konfirmasi WhatsApp untuk ${student.name} siap dikirim.`, tone: "success" });
    } catch { popup?.close(); setToast({ message: "Tautan konfirmasi WhatsApp belum dapat dibuat.", tone: "error" }); }
    finally { setSharingId(""); }
  }
  const sessionStudents = session ? students.filter((item) => item.className === session.className) : [];
  const presentCount = sessionStudents.filter((item) => session?.records[item.id]?.status === "present").length;
  const sickCount = sessionStudents.filter((item) => session?.records[item.id]?.status === "sick").length;
  const permissionCount = sessionStudents.filter((item) => session?.records[item.id]?.status === "permission").length;
  const absentStudents = sessionStudents.filter((item) => !session?.records[item.id]);
  const selectedSession = todaySessions.find((item) => item.className === selectedClass);
  const openSession = todaySessions.find((item) => item.status === "open");
  const pendingRecord = pending?.existing?.record;
  const pendingDisplayMs = pendingRecord?.recordedAtMs ?? pending?.scannedAtMs ?? Date.now();
  const pendingStatusLabel = pendingRecord ? `Sudah absen · ${pendingRecord.status === "present" ? "Hadir" : pendingRecord.status === "sick" ? "Sakit" : "Izin"}` : "Hadir";
  return <>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Absensi cepat</p><h2 className="mt-1 text-2xl font-black">Scan QR langsung</h2><p className="mt-1 text-sm text-slate-500">Tutup Absensi menyelesaikan sesi hari ini; siswa tanpa status menjadi Alpha dan tetap bisa dikonfirmasi wali.</p></div><div className="flex gap-2">{session?.status==="open"&&<button disabled={closing} onClick={() => void closeSession()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-extrabold text-white"><LockKeyhole size={16}/>{closing ? "Menutup..." : `Tutup ${session.className}`}</button>}{session?.status==="closed"&&<button disabled={reopening} onClick={() => void reopenSession()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-extrabold text-white"><ScanLine size={16}/>{reopening ? "Membuka..." : "Buka kembali absensi"}</button>}</div></div>
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <label><span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-400">Kelas yang diabsen</span><select value={selectedClass} disabled={Boolean(openSession)} onChange={(event) => { stopCamera(); setSelectedClass(event.target.value); }} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold disabled:bg-slate-100"><option value="">Pilih kelas</option>{classes.map((item) => <option key={item} value={item}>{item}</option>)}</select>{openSession&&<p className="mt-2 text-[10px] font-bold text-amber-600">Tutup absensi {openSession.className} untuk berpindah ke kelas lain.</p>}</label>
        <button disabled={!selectedClass || starting || selectedSession?.status === "open"} onClick={() => void beginSession()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-xs font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-500">{starting ? <Loader2 className="animate-spin" size={16}/> : <ScanLine size={16}/>} {selectedSession?.status === "open" ? `${selectedClass} sedang berlangsung` : selectedSession?.status === "closed" ? `Buka kembali ${selectedClass}` : `Mulai Absensi ${selectedClass || ""}`}</button>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{classes.map((item) => { const classSession = todaySessions.find((entry) => entry.className === item); return <button key={item} disabled={Boolean(openSession)} onClick={() => setSelectedClass(item)} className={`shrink-0 rounded-xl border px-3 py-2 text-left ${selectedClass === item ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white"}`}><span className="block text-xs font-black">{item}</span><span className={`mt-1 block text-[9px] font-bold ${classSession?.status === "open" ? "text-emerald-600" : classSession?.status === "closed" ? "text-slate-500" : "text-amber-600"}`}>{classSession?.status === "open" ? "Berlangsung" : classSession?.status === "closed" ? "Selesai hari ini" : "Belum dimulai"}</span></button>})}</div>
      {session&&absentStudents.length>0&&<button onClick={() => missingListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-left text-xs font-extrabold text-emerald-800"><span className="flex items-center gap-2"><MessageCircle size={17}/>WhatsApp wali siswa yang belum hadir</span><span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-white">{absentStudents.length}</span></button>}
    </section>    <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-3 shadow-xl sm:p-5"><div className="relative min-h-[58dvh] overflow-hidden rounded-2xl bg-[#061e24] sm:aspect-video sm:min-h-0"><video ref={videoRef} muted playsInline className={`absolute inset-0 h-full w-full object-cover ${cameraActive ? "block" : "hidden"}`}/><div className="pointer-events-none absolute inset-[12%] rounded-3xl border border-dashed border-white/40"><span className="absolute -left-px -top-px h-12 w-12 rounded-tl-2xl border-l-4 border-t-4 border-teal-300"/><span className="absolute -right-px -top-px h-12 w-12 rounded-tr-2xl border-r-4 border-t-4 border-teal-300"/><span className="absolute -bottom-px -left-px h-12 w-12 rounded-bl-2xl border-b-4 border-l-4 border-teal-300"/><span className="absolute -bottom-px -right-px h-12 w-12 rounded-br-2xl border-b-4 border-r-4 border-teal-300"/></div>{!cameraActive&&<div className="absolute inset-0 grid place-items-center p-6 text-center text-white"><div><Camera className="mx-auto text-teal-300" size={48}/><p className="mt-4 font-black">Kamera belum aktif</p><button onClick={() => void startCamera()} disabled={session?.status !== "open"} className="mt-4 rounded-xl bg-teal-300 px-5 py-3 text-xs font-extrabold text-slate-950 disabled:bg-slate-600 disabled:text-slate-300">{session?.status === "open" ? "Buka kamera" : "Pilih kelas & mulai absensi"}</button></div></div>}<div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2"><span className="rounded-full bg-slate-950/70 px-3 py-1.5 text-[10px] font-black text-white backdrop-blur">{cameraActive ? "KAMERA AKTIF" : "KAMERA NONAKTIF"}</span><span className="rounded-full bg-teal-400/90 px-3 py-1.5 text-[10px] font-black text-slate-950">{session ? `${session.className} · ${presentCount}/${sessionStudents.length}` : "Pilih kelas sebelum scan"}</span></div></div></section>
      <div className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-3 text-teal-700"><ScanLine size={20}/></div><div><h3 className="font-black">Input NIS manual</h3><p className="text-xs text-slate-400">Tetap melalui konfirmasi identitas.</p></div></div><div className="mt-4 flex gap-2"><input disabled={session?.status !== "open"} value={manualNis} onChange={(event) => setManualNis(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") stageScan(manualNis, "manual"); }} placeholder="Masukkan NIS" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/><button disabled={session?.status !== "open" || !manualNis.trim()} onClick={() => stageScan(manualNis, "manual")} className="rounded-xl bg-slate-950 px-4 text-xs font-extrabold text-white disabled:opacity-40">Cari</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">Status sesi</p><h3 className="mt-2 text-lg font-black">{session ? (session.status === "open" ? `${session.className} sedang berlangsung` : `${session.className} selesai`) : "Pilih kelas terlebih dahulu"}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{session ? `${presentCount} hadir, ${sickCount} sakit, ${permissionCount} izin, dan ${absentStudents.length} ${session.status === "closed" ? "Alpha" : "belum absen"}.` : "Pilih kelas dan tekan Mulai Absensi. Satu kelas hanya mempunyai satu sesi untuk tanggal hari ini."}</p></section></div>
    </div>
    {session&&<>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700"><p className="text-[10px] font-black uppercase tracking-wider">Hadir</p><p className="mt-2 text-2xl font-black">{presentCount}</p></div><div className="rounded-2xl bg-sky-50 p-4 text-sky-700"><p className="text-[10px] font-black uppercase tracking-wider">Sakit</p><p className="mt-2 text-2xl font-black">{sickCount}</p></div><div className="rounded-2xl bg-violet-50 p-4 text-violet-700"><p className="text-[10px] font-black uppercase tracking-wider">Izin</p><p className="mt-2 text-2xl font-black">{permissionCount}</p></div><div className={`rounded-2xl p-4 ${session.status === "closed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}><p className="text-[10px] font-black uppercase tracking-wider">{session.status === "closed" ? "Alpha" : "Belum absen"}</p><p className="mt-2 text-2xl font-black">{absentStudents.length}</p></div></div>
      <section ref={missingListRef} className="mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5"><div><h3 className="font-black">{session.status === "closed" ? "Siswa Alpha — tindak lanjut wali" : "Siswa belum absen"}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Kirim tautan WhatsApp agar wali memilih Sakit atau Izin dan menuliskan alasannya. Jawaban otomatis masuk ke rekap.</p></div><span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">{absentStudents.length} siswa</span></div><div className="divide-y divide-slate-100">{absentStudents.map((student) => <div key={student.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><StudentPhoto user={user} photoKey={student.photoThumbnailKey ?? student.photoKey} name={student.name} className="h-11 w-11 shrink-0 rounded-xl object-cover"/><div className="min-w-0"><p className="truncate text-sm font-extrabold">{student.name}</p><p className="mt-1 text-[10px] text-slate-400">NIS {student.nis} · Wali: {student.guardian || "belum diisi"}</p></div></div><button disabled={sharingId === student.id || !student.phone} onClick={() => void sendAbsenceWhatsapp(student)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-500">{sharingId === student.id ? <Loader2 className="animate-spin" size={15}/> : <MessageCircle size={15}/>} {student.phone ? "Kirim konfirmasi WA" : "No. WA belum ada"}</button></div>)}{!absentStudents.length&&<div className="py-10 text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={36}/><p className="mt-3 text-sm font-black text-emerald-700">Semua siswa sudah memiliki status kehadiran.</p></div>}</div></section>
    </>}
    {pending&&<div role="dialog" aria-modal="true" aria-labelledby="scan-result-title" className="fixed inset-0 z-[160] flex items-center justify-center overflow-hidden bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-5">
      <section className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white text-slate-950 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${pendingRecord ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{pendingRecord ? "SUDAH ABSEN" : "SIAP DIKONFIRMASI"}</span>
          <button onClick={dismissPending} aria-label="Tutup popup" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><X size={18}/></button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
          <div className="grid grid-cols-[92px_1fr] items-center gap-3 sm:grid-cols-[112px_1fr] sm:gap-4">
            <StudentPhoto user={user} photoKey={pending.student.photoKey} name={pending.student.name} className="h-28 w-[92px] rounded-2xl bg-[#07363b] object-contain sm:h-36 sm:w-28"/>
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Hasil scan siswa</p><h1 id="scan-result-title" className="mt-1 line-clamp-2 text-xl font-black leading-tight sm:text-2xl">{pending.student.name}</h1><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-black text-slate-700">NIS {pending.student.nis}</span><span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-[10px] font-black text-sky-700">Kelas {pending.student.className}</span></div></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2"><Detail label="Status absen" value={pendingStatusLabel}/><Detail label={pendingRecord ? "Jam tercatat" : "Jam scan"} value={new Date(pendingDisplayMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}/><div className="col-span-2"><Detail label="Tanggal" value={new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(new Date(pendingDisplayMs))}/></div></div>
          {pendingRecord&&<p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-[11px] font-bold leading-5 text-amber-800">Siswa ini sudah tercatat hari ini. Sistem tidak akan menyimpan absensi dua kali.</p>}
        </div>
        <footer className="shrink-0 border-t border-slate-100 bg-white p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {pendingRecord?<button onClick={dismissPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-extrabold text-white"><CheckCircle2 size={18}/>OK, lanjut scan</button>:<div className="grid grid-cols-2 gap-2 sm:gap-3"><button disabled={confirming} onClick={dismissPending} className="h-12 rounded-xl border border-slate-200 text-sm font-extrabold text-slate-600">Batal</button><button disabled={confirming} onClick={() => void confirmAttendance()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-extrabold text-white disabled:opacity-60">{confirming ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>}OK</button></div>}
        </footer>
      </section>
    </div>}
  </>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-black text-slate-900 sm:text-base">{value}</p></div>;
}

type RecapStatus = AttendanceStatus | "alpha" | "not_recorded";
type RecapRow = { key: string; student: Student; session: AttendanceSession | null; record?: AttendanceRecord; status: RecapStatus; dateMs: number };

export function AttendanceViewPro({ user, demo, students, setToast }: CommonProps) {
  const today = localDateKey(new Date());
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [range, setRange] = useState<"day" | "month">("day");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [className, setClassName] = useState("all");
  const classes = useMemo(() => Array.from(new Set(students.map((item) => item.className).filter(Boolean))).sort(), [students]);

  useEffect(() => {
    if (demo) {
      const startedAtMs = new Date(`${today}T06:45:00`).getTime();
      setSessions([{ id: "demo", className: "VII A", schoolName: "SMP Harapan Bangsa", status: "closed", startedAtMs, records: Object.fromEntries(students.filter((item) => item.className === "VII A").slice(0, 3).map((item, index) => [item.id, { studentId: item.id, status: "present", source: "qr", recordedAtMs: startedAtMs + (index + 2) * 60000 }])) }]);
      return;
    }
    if (!user) return;
    return onSnapshot(collection(db, "users", user.uid, "attendanceSessions"), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), records: item.data().records ?? {} } as AttendanceSession));
      next.sort((a, b) => b.startedAtMs - a.startedAtMs); setSessions(next);
    }, () => setToast({ message: "Rekap absensi belum dapat dimuat.", tone: "error" }));
  }, [demo, user, students, today, setToast]);

  const filteredSessions = useMemo(() => sessions.filter((item) => {
    const classMatch = className === "all" || item.className === className;
    const dateKey = localDateKey(item.startedAtMs);
    return classMatch && (range === "day" ? dateKey === day : dateKey.startsWith(month));
  }), [sessions, className, range, day, month]);
  const rows = useMemo<RecapRow[]>(() => {
    if (!filteredSessions.length) {
      return students.filter((item) => className === "all" || item.className === className).map((student) => ({ key: `empty-${student.id}`, student, session: null, status: "not_recorded", dateMs: range === "day" ? new Date(`${day}T12:00:00`).getTime() : new Date(`${month}-01T12:00:00`).getTime() }));
    }
    return filteredSessions.flatMap((sessionItem) => students.filter((student) => student.className === sessionItem.className).map((student) => {
      const record = sessionItem.records[student.id];
      const status: RecapStatus = record?.status ?? (sessionItem.status === "closed" ? "alpha" : "not_recorded");
      return { key: `${sessionItem.id}-${student.id}`, student, session: sessionItem, record, status, dateMs: sessionItem.startedAtMs };
    }));
  }, [filteredSessions, students, className, range, day, month]);

  const totals = useMemo(() => ({
    present: rows.filter((item) => item.status === "present").length,
    permission: rows.filter((item) => item.status === "permission").length,
    sick: rows.filter((item) => item.status === "sick").length,
    alpha: rows.filter((item) => item.status === "alpha").length,
    notRecorded: rows.filter((item) => item.status === "not_recorded").length,
  }), [rows]);

  function exportCsv() {
    const csv = [["Tanggal", "Nama", "NIS", "Kelas", "Status", "Jam masuk", "Keterangan"], ...rows.map((row) => [localDateKey(row.dateMs), row.student.name, row.student.nis, row.student.className, statusLabel(row.status), row.record ? new Date(row.record.recordedAtMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "", row.record?.reason ?? ""])].map((cells) => cells.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); link.download = `rekap-absensi-${range === "day" ? day : month}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  return <>
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Laporan Firebase</p><h2 className="mt-1 text-2xl font-black">Rekap absensi</h2><p className="mt-1 text-sm text-slate-500">Seluruh siswa tetap muncul, termasuk yang belum melakukan absensi.</p></div><button onClick={exportCsv} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-extrabold"><Download size={16}/>Export CSV</button></div>
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label><span className="mb-2 block text-[10px] font-black uppercase text-slate-400">Rentang</span><select value={range} onChange={(event) => setRange(event.target.value as "day" | "month")} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="day">Hari</option><option value="month">Bulan</option></select></label><label><span className="mb-2 block text-[10px] font-black uppercase text-slate-400">{range === "day" ? "Tanggal" : "Bulan"}</span><input type={range === "day" ? "date" : "month"} value={range === "day" ? day : month} onChange={(event) => range === "day" ? setDay(event.target.value) : setMonth(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold"/></label><label><span className="mb-2 block text-[10px] font-black uppercase text-slate-400">Kelas</span><select value={className} onChange={(event) => setClassName(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="all">Semua kelas</option>{classes.map((item) => <option key={item}>{item}</option>)}</select></label><div className="flex items-end"><div className="flex h-11 w-full items-center gap-2 rounded-xl bg-teal-50 px-3 text-xs font-black text-teal-700"><CalendarDays size={16}/>{rows.length} baris data</div></div></div></section>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Summary label="Hadir" value={totals.present} tone="text-emerald-600"/><Summary label="Izin" value={totals.permission} tone="text-violet-600"/><Summary label="Sakit" value={totals.sick} tone="text-sky-600"/><Summary label="Alpha" value={totals.alpha} tone="text-rose-600"/><Summary label="Belum absen" value={totals.notRecorded} tone="text-amber-600"/></div>
    <div className="space-y-3 lg:hidden">{rows.map((row) => <article key={row.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.student.name}</p><p className="mt-1 text-[10px] text-slate-400">NIS {row.student.nis} · {row.student.className}</p></div><StatusBadge status={row.status}/></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Detail label="Tanggal" value={new Date(row.dateMs).toLocaleDateString("id-ID")}/><Detail label="Jam masuk" value={row.record ? new Date(row.record.recordedAtMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—"}/></div></article>)}</div>
    <section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block"><div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Kelas</th><th className="px-4 py-3">Jam masuk</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Keterangan</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.key}><td className="px-5 py-4 text-sm font-extrabold">{row.student.name}<p className="text-[10px] font-normal text-slate-400">NIS {row.student.nis}</p></td><td className="px-4 py-4 text-xs">{new Date(row.dateMs).toLocaleDateString("id-ID")}</td><td className="px-4 py-4 text-xs font-bold">{row.student.className}</td><td className="px-4 py-4 text-xs">{row.record ? new Date(row.record.recordedAtMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td className="px-4 py-4"><StatusBadge status={row.status}/></td><td className="px-5 py-4 text-xs text-slate-500">{row.record?.reason ?? (row.status === "not_recorded" ? "Menunggu absensi" : "—")}</td></tr>)}</tbody></table></div>{!rows.length&&<div className="py-12 text-center text-sm text-slate-400">Tidak ada data pada filter ini.</div>}</section>
  </>;
}

function statusLabel(status: RecapStatus) { return status === "present" ? "Hadir" : status === "permission" ? "Izin" : status === "sick" ? "Sakit" : status === "alpha" ? "Alpha" : "Belum Absen"; }
function StatusBadge({ status }: { status: RecapStatus }) { const tone = status === "present" ? "bg-emerald-50 text-emerald-700" : status === "permission" ? "bg-violet-50 text-violet-700" : status === "sick" ? "bg-sky-50 text-sky-700" : status === "alpha" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"; return <span className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-black ${tone}`}>{statusLabel(status)}</span>; }
function Summary({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p></div>; }
