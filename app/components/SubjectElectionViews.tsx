"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { BookOpen, Check, ChevronDown, ChevronRight, Clock, Edit2, Filter, FlaskConical, Globe, Languages, Loader2, Music, RefreshCcw, Search, Send, Shield, Star, User, Users, X, XCircle, CheckCircle2, AlertCircle, BookMarked, GraduationCap } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubjectElectionConfig {
  isOpen: boolean;
  deadline: Timestamp | null;
  minChoices: number;
  maxChoices: number;
  updatedAtMs: number;
}

export interface SubjectElection {
  studentId: string;
  studentName: string;
  nis: string;
  className: string;
  selectedSubjectIds: string[];
  selectedSubjectNames: string[];
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  submittedAtMs: number;
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAtMs?: number;
  schoolId: string;
  schoolName: string;
}

export interface ElectiveSubject {
  id: string;
  name: string;
  isElective?: boolean;
  quota?: number;
  electiveCategory?: "sains" | "sosial" | "bahasa" | "seni-vokasi";
  electiveDescription?: string;
}

const DEFAULT_CONFIG: SubjectElectionConfig = { isOpen: false, deadline: null, minChoices: 4, maxChoices: 5, updatedAtMs: 0 };

const ELECTIVE_CATEGORIES: { key: ElectiveSubject["electiveCategory"]; label: string; color: string; icon: React.ElementType }[] = [
  { key: "sains", label: "Sains & Teknologi", color: "bg-sky-50 text-sky-700 border-sky-200", icon: FlaskConical },
  { key: "sosial", label: "Sosial & Humaniora", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Globe },
  { key: "bahasa", label: "Bahasa & Sastra", color: "bg-violet-50 text-violet-700 border-violet-200", icon: Languages },
  { key: "seni-vokasi", label: "Seni & Vokasi", color: "bg-rose-50 text-rose-700 border-rose-200", icon: Music },
];

function categoryStyle(cat?: ElectiveSubject["electiveCategory"]) {
  return ELECTIVE_CATEGORIES.find((c) => c.key === cat)?.color ?? "bg-slate-50 text-slate-600 border-slate-200";
}
function categoryLabel(cat?: ElectiveSubject["electiveCategory"]) {
  return ELECTIVE_CATEGORIES.find((c) => c.key === cat)?.label ?? "Umum";
}
function categoryIcon(cat?: ElectiveSubject["electiveCategory"]): React.ElementType {
  return ELECTIVE_CATEGORIES.find((c) => c.key === cat)?.icon ?? BookOpen;
}

export function isHighSchool(level?: string) {
  return level === "SMA" || level === "SMK" || level === "MA";
}

function isEligibleClass(className: string) {
  const upper = className.toUpperCase();
  return upper.startsWith("XI") || upper.startsWith("XII") || upper.startsWith("11") || upper.startsWith("12");
}

function deadlineLabel(deadline: Timestamp | null) {
  if (!deadline) return "Tidak ada deadline";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(deadline.toDate());
}

// ─── SubjectElectionConfigPanel ──────────────────────────────────────────────

export function SubjectElectionConfigPanel({ schoolId, schoolName, subjects, setToast }: {
  schoolId: string; schoolName: string;
  subjects: ElectiveSubject[];
  setToast: (t: { message: string; tone: "success" | "error" }) => void;
}) {
  const [config, setConfig] = useState<SubjectElectionConfig>(DEFAULT_CONFIG);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [subjectEdits, setSubjectEdits] = useState<Record<string, Partial<ElectiveSubject>>>({});
  const configRef = doc(db, "schools", schoolId, "subjectElectionConfig", "config");

  useEffect(() => {
    const unsub = onSnapshot(configRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as SubjectElectionConfig;
        setConfig(data);
        if (data.deadline) setDeadlineInput(data.deadline.toDate().toISOString().slice(0, 16));
      }
    });
    return unsub;
  }, [schoolId]);

  async function saveConfig() {
    setSaving(true);
    try {
      const deadline = deadlineInput ? Timestamp.fromDate(new Date(deadlineInput)) : null;
      await setDoc(configRef, { ...config, deadline, updatedAtMs: Date.now() }, { merge: true });
      setToast({ message: "Konfigurasi pemilihan mapel berhasil disimpan.", tone: "success" });
    } catch { setToast({ message: "Gagal menyimpan konfigurasi.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function toggleOpen() {
    setSaving(true);
    try {
      await setDoc(configRef, { ...config, isOpen: !config.isOpen, updatedAtMs: Date.now() }, { merge: true });
      setToast({ message: config.isOpen ? "Periode pemilihan mapel ditutup." : "Periode pemilihan mapel dibuka.", tone: "success" });
    } catch { setToast({ message: "Gagal mengubah status.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function saveSubject(subjectId: string) {
    const edits = subjectEdits[subjectId] ?? {};
    setSaving(true);
    try {
      await setDoc(doc(db, "schools", schoolId, "subjects", subjectId), edits, { merge: true });
      setEditingSubjectId(null);
      setSubjectEdits((prev) => { const next = { ...prev }; delete next[subjectId]; return next; });
      setToast({ message: "Pengaturan mapel berhasil disimpan.", tone: "success" });
    } catch { setToast({ message: "Gagal menyimpan pengaturan mapel.", tone: "error" }); }
    finally { setSaving(false); }
  }

  const electiveCount = subjects.filter((s) => s.isElective).length;
  const totalQuota = subjects.filter((s) => s.isElective).reduce((sum, s) => sum + (s.quota ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[.16em] text-teal-600">Pemilihan Mapel Pilihan</p>
            <h2 className="mt-1 text-xl font-black">Konfigurasi Periode</h2>
            <p className="mt-1 text-sm text-slate-500">Atur mapel yang dapat dipilih siswa Kelas XI & XII, kuota, dan periode pendaftaran.</p>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-extrabold ${config.isOpen ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            <div className={`h-2 w-2 rounded-full ${config.isOpen ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`}/>
            {config.isOpen ? "Periode Buka" : "Periode Tutup"}
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[{label:"Mapel Pilihan Aktif",value:electiveCount},{label:"Total Kuota",value:totalQuota},{label:"Status",value:config.isOpen?"Pendaftaran Dibuka":"Pendaftaran Ditutup"}].map(({label,value})=>(
            <div key={label} className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-bold text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-black">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold text-slate-700">Batas Waktu Pendaftaran</span>
            <input type="datetime-local" value={deadlineInput} onChange={(e)=>setDeadlineInput(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
            <span className="mt-1 block text-[10px] text-slate-400">Kosongkan jika tidak ada deadline otomatis.</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-2 block text-xs font-extrabold text-slate-700">Min Pilihan</span>
              <input type="number" min={1} max={10} value={config.minChoices} onChange={(e)=>setConfig({...config,minChoices:Number(e.target.value)})} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-extrabold text-slate-700">Max Pilihan</span>
              <input type="number" min={1} max={10} value={config.maxChoices} onChange={(e)=>setConfig({...config,maxChoices:Number(e.target.value)})} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
            </label>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button disabled={saving} onClick={()=>void saveConfig()} className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">
            {saving?<Loader2 className="animate-spin" size={14}/>:<Check size={14}/>}Simpan Konfigurasi
          </button>
          <button disabled={saving} onClick={()=>void toggleOpen()} className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold disabled:opacity-50 ${config.isOpen?"bg-rose-50 text-rose-700 border border-rose-200":"bg-emerald-600 text-white"}`}>
            {config.isOpen?"Tutup Periode Pendaftaran":"Buka Periode Pendaftaran"}
          </button>
        </div>
        {config.isOpen && (
          <div className="mt-4 rounded-xl bg-sky-50 p-4">
            <p className="text-xs font-extrabold text-sky-800">🔗 Link Pendaftaran Siswa</p>
            <p className="mt-1 break-all text-xs text-sky-700">{typeof window!=="undefined"?window.location.origin:""}/public/pilih-mapel?school={schoolId}</p>
            <p className="mt-2 text-[10px] text-sky-600">Bagikan link ini ke siswa Kelas XI & XII. Siswa masukkan NIS untuk mendaftar.</p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-black">Daftar Mata Pelajaran Pilihan</h3>
        <p className="mt-1 text-xs text-slate-500">Tandai mapel yang masuk pilihan siswa, set kuota dan kategori. Kelas XI & XII dapat memilih mapel yang ditandai.</p>
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
          {subjects.length === 0 && <p className="p-5 text-sm text-slate-400 text-center">Belum ada mata pelajaran. Tambahkan di menu Mata Pelajaran.</p>}
          {subjects.map((subject) => {
            const isEditing = editingSubjectId === subject.id;
            const edits = subjectEdits[subject.id] ?? {};
            const effective = { ...subject, ...edits };
            const CatIcon = categoryIcon(effective.electiveCategory);
            return (
              <div key={subject.id} className="p-4">
                <div className="flex items-center gap-3">
                  <button onClick={()=>{ const next = !effective.isElective; setSubjectEdits(prev=>({...prev,[subject.id]:{...prev[subject.id],isElective:next}})); void setDoc(doc(db,"schools",schoolId,"subjects",subject.id),{isElective:next},{merge:true}); }} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${effective.isElective?"border-teal-600 bg-teal-600":"border-slate-300 bg-white"}`}>
                    {effective.isElective && <Check className="text-white" size={13}/>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold">{subject.name}</p>
                    {effective.isElective && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${categoryStyle(effective.electiveCategory)}`}>
                          <CatIcon className="mr-1 inline" size={10}/>{categoryLabel(effective.electiveCategory)}
                        </span>
                        <span className="text-[10px] text-slate-400">Kuota: {effective.quota ?? 0} siswa</span>
                      </div>
                    )}
                  </div>
                  {effective.isElective && (
                    <button onClick={()=>setEditingSubjectId(isEditing?null:subject.id)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                      <Edit2 size={14}/>
                    </button>
                  )}
                </div>
                {isEditing && effective.isElective && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-extrabold text-slate-600">Kategori</span>
                        <select value={effective.electiveCategory??""} onChange={(e)=>setSubjectEdits(p=>({...p,[subject.id]:{...p[subject.id],electiveCategory:e.target.value as ElectiveSubject["electiveCategory"]}}))} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                          <option value="">Pilih kategori</option>
                          {ELECTIVE_CATEGORIES.map(c=><option key={c.key} value={c.key??""}>{ c.label}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-extrabold text-slate-600">Kuota Siswa</span>
                        <input type="number" min={1} max={500} value={effective.quota??36} onChange={(e)=>setSubjectEdits(p=>({...p,[subject.id]:{...p[subject.id],quota:Number(e.target.value)}}))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-extrabold text-slate-600">Deskripsi untuk Siswa</span>
                      <input type="text" placeholder="Cocok untuk yang berminat ke SNBP bidang sains..." value={effective.electiveDescription??""} onChange={(e)=>setSubjectEdits(p=>({...p,[subject.id]:{...p[subject.id],electiveDescription:e.target.value}}))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"/>
                    </label>
                    <div className="flex gap-2">
                      <button disabled={saving} onClick={()=>void saveSubject(subject.id)} className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50"><Check size={13}/>Simpan</button>
                      <button onClick={()=>{setEditingSubjectId(null);setSubjectEdits(p=>{const n={...p};delete n[subject.id];return n;});}} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-extrabold text-slate-600">Batal</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SubjectElectionReviewPanel ───────────────────────────────────────────────

export function SubjectElectionReviewPanel({ schoolId, schoolName, students, subjects, reviewerName, setToast }: {
  schoolId: string; schoolName: string;
  students: { id: string; name: string; nis: string; className: string; phone?: string }[];
  subjects: ElectiveSubject[];
  reviewerName: string;
  setToast: (t: { message: string; tone: "success" | "error" }) => void;
}) {
  const [elections, setElections] = useState<SubjectElection[]>([]);
  const [config, setConfig] = useState<SubjectElectionConfig>(DEFAULT_CONFIG);
  const [filter, setFilter] = useState<"all"|"pending"|"approved"|"rejected"|"not-submitted">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [saving, setSaving] = useState<string|null>(null);

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "schools", schoolId, "subjectElections"), (snap) =>
      setElections(snap.docs.map((d) => ({ ...d.data() } as SubjectElection)))
    );
    const unsub2 = onSnapshot(doc(db, "schools", schoolId, "subjectElectionConfig", "config"), (snap) => {
      if (snap.exists()) setConfig(snap.data() as SubjectElectionConfig);
    });
    return () => { unsub1(); unsub2(); };
  }, [schoolId]);

  const eligibleStudents = useMemo(() => students.filter((s) => isEligibleClass(s.className)), [students]);
  const electionMap = useMemo(() => new Map(elections.map((e) => [e.studentId, e])), [elections]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const rows = useMemo(() => {
    const list = eligibleStudents.map((s) => ({ student: s, election: electionMap.get(s.id) ?? null }));
    const q = search.trim().toLowerCase();
    return list.filter(({ student, election }) => {
      if (q && !student.name.toLowerCase().includes(q) && !student.nis.includes(q) && !student.className.toLowerCase().includes(q)) return false;
      if (filter === "pending") return election?.status === "pending";
      if (filter === "approved") return election?.status === "approved";
      if (filter === "rejected") return election?.status === "rejected";
      if (filter === "not-submitted") return !election;
      return true;
    });
  }, [eligibleStudents, electionMap, filter, search]);

  const counts = useMemo(() => ({
    all: eligibleStudents.length,
    pending: elections.filter(e=>e.status==="pending").length,
    approved: elections.filter(e=>e.status==="approved").length,
    rejected: elections.filter(e=>e.status==="rejected").length,
    notSubmitted: eligibleStudents.length - elections.length,
  }), [eligibleStudents, elections]);

  async function approve(studentId: string) {
    setSaving(studentId);
    try {
      await setDoc(doc(db, "schools", schoolId, "subjectElections", studentId), {
        status: "approved", reviewedByName: reviewerName, reviewedAtMs: Date.now(),
      }, { merge: true });
      setToast({ message: "Pilihan mapel siswa disetujui.", tone: "success" });
      setSelectedId(null);
    } catch { setToast({ message: "Gagal menyetujui pilihan.", tone: "error" }); }
    finally { setSaving(null); }
  }

  async function reject(studentId: string) {
    if (!rejectReason.trim()) { setToast({ message: "Isi alasan penolakan terlebih dahulu.", tone: "error" }); return; }
    setSaving(studentId);
    try {
      await setDoc(doc(db, "schools", schoolId, "subjectElections", studentId), {
        status: "rejected", rejectionReason: rejectReason.trim(), reviewedByName: reviewerName, reviewedAtMs: Date.now(),
      }, { merge: true });
      setToast({ message: "Pilihan mapel siswa ditolak.", tone: "success" });
      setSelectedId(null); setRejectReason("");
    } catch { setToast({ message: "Gagal menolak pilihan.", tone: "error" }); }
    finally { setSaving(null); }
  }

  async function reopen(studentId: string) {
    setSaving(studentId);
    try {
      await setDoc(doc(db, "schools", schoolId, "subjectElections", studentId), {
        status: "pending", rejectionReason: null, reviewedByName: null, reviewedAtMs: null,
      }, { merge: true });
      setToast({ message: "Pilihan mapel dikembalikan ke status menunggu.", tone: "success" });
    } catch { setToast({ message: "Gagal mengubah status.", tone: "error" }); }
    finally { setSaving(null); }
  }

  function sendWhatsApp(student: { name: string; phone?: string; nis: string }) {
    const phone = (student.phone ?? "").replace(/\D/g, "").replace(/^0/, "62");
    if (phone.length < 10) { setToast({ message: `Nomor HP ${student.name} belum tersedia.`, tone: "error" }); return; }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${origin}/public/pilih-mapel?school=${encodeURIComponent(schoolId)}`;
    const msg = `Yth. ${student.name} (NIS: ${student.nis}), Anda belum melakukan pemilihan Mata Pelajaran Pilihan untuk Kelas XI/XII. Silakan segera daftar melalui: ${link}`;
    const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    if (popup) popup.opener = null;
  }

  const statusBadge = (election: SubjectElection | null) => {
    if (!election) return <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">Belum Daftar</span>;
    if (election.status === "approved") return <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">✅ Disetujui</span>;
    if (election.status === "rejected") return <span className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">❌ Ditolak</span>;
    return <span className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">⏳ Menunggu</span>;
  };

  const filterTabs: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: counts.all },
    { key: "pending", label: "Menunggu", count: counts.pending },
    { key: "approved", label: "Disetujui", count: counts.approved },
    { key: "rejected", label: "Ditolak", count: counts.rejected },
    { key: "not-submitted", label: "Belum Daftar", count: counts.notSubmitted },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-black">Review Pilihan Mapel Siswa</h3>
            <p className="mt-1 text-xs text-slate-500">Hanya siswa Kelas XI & XII yang muncul di sini. Setujui, tolak, atau kirim pengingat WA.</p>
          </div>
          <div className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${config.isOpen ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {config.isOpen ? "Pendaftaran Buka" : "Pendaftaran Tutup"}
            {config.deadline && <span className="ml-2 text-[10px]">s/d {deadlineLabel(config.deadline)}</span>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {filterTabs.map((tab) => (
            <button key={tab.key} onClick={() => setFilter(tab.key)} className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${filter === tab.key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {tab.label} <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter===tab.key?"bg-white/20 text-white":"bg-slate-200 text-slate-600"}`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-3 text-slate-400" size={15}/>
          <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Cari nama, NIS, atau kelas..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-sm outline-none focus:border-teal-500"/>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <Users className="mx-auto text-slate-300" size={36}/>
          <p className="mt-3 text-sm font-bold text-slate-500">Tidak ada siswa yang sesuai filter</p>
        </div>
      )}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.map(({ student, election }) => {
          const isExpanded = selectedId === student.id;
          return (
            <div key={student.id}>
              <div className="flex items-center gap-3 p-4 hover:bg-slate-50">
                <div className="h-9 w-9 rounded-xl bg-teal-50 flex items-center justify-center text-teal-700 font-black text-sm shrink-0">{student.name.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold truncate">{student.name}</p>
                  <p className="text-[10px] text-slate-400">{student.nis} · {student.className}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(election)}
                  {!election && (
                    <button onClick={()=>sendWhatsApp(student)} className="rounded-lg bg-green-50 border border-green-200 px-2 py-1 text-[10px] font-bold text-green-700 hover:bg-green-100">
                      <Send size={10} className="inline mr-1"/>WA
                    </button>
                  )}
                  <button onClick={() => setSelectedId(isExpanded ? null : student.id)} className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-100">
                    {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
                  {!election && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-xs font-extrabold text-amber-800">Siswa belum mendaftar</p>
                      <p className="mt-1 text-[11px] text-amber-700">Kirim pengingat WhatsApp agar siswa segera melakukan pemilihan mapel.</p>
                      <button onClick={()=>sendWhatsApp(student)} className="mt-3 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-extrabold text-white">
                        <Send size={13}/>Kirim Pengingat WA
                      </button>
                    </div>
                  )}
                  {election && (
                    <>
                      <div>
                        <p className="mb-2 text-xs font-extrabold text-slate-700">Mapel yang Dipilih ({election.selectedSubjectIds.length} mapel)</p>
                        <div className="flex flex-wrap gap-2">
                          {election.selectedSubjectIds.map((id, i) => {
                            const subj = subjectMap.get(id);
                            const name = subj?.name ?? election.selectedSubjectNames?.[i] ?? id;
                            return (
                              <span key={id} className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${categoryStyle(subj?.electiveCategory)}`}>
                                {name}
                              </span>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[10px] text-slate-400">
                          Didaftarkan: {new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(election.submittedAtMs))}
                          {election.reviewedByName && ` · Direview oleh: ${election.reviewedByName}`}
                        </p>
                      </div>
                      {election.status === "rejected" && election.rejectionReason && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                          <p className="text-xs font-bold text-rose-700">Alasan Ditolak: {election.rejectionReason}</p>
                        </div>
                      )}
                      {election.status === "pending" && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button disabled={saving===student.id} onClick={()=>void approve(student.id)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">
                              {saving===student.id?<Loader2 className="animate-spin" size={13}/>:<Check size={13}/>}Setujui
                            </button>
                            <div className="flex-1 space-y-2">
                              <input value={rejectReason} onChange={(e)=>setRejectReason(e.target.value)} placeholder="Alasan penolakan..." className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-rose-400"/>
                              <button disabled={saving===student.id||!rejectReason.trim()} onClick={()=>void reject(student.id)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">
                                {saving===student.id?<Loader2 className="animate-spin" size={13}/>:<XCircle size={13}/>}Tolak
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {election.status !== "pending" && (
                        <button disabled={saving===student.id} onClick={()=>void reopen(student.id)} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                          <RefreshCcw size={13}/>Kembalikan ke Menunggu
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PublicSubjectElection ────────────────────────────────────────────────────

export function PublicSubjectElection() {
  const schoolId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("school") ?? "" : "";
  const [nis, setNis] = useState("");
  const [step, setStep] = useState<"login"|"select"|"done">("login");
  const [loading, setLoading] = useState(false);
  const [student, setStudent] = useState<{ id: string; name: string; nis: string; className: string } | null>(null);
  const [existingElection, setExistingElection] = useState<SubjectElection | null>(null);
  const [electiveSubjects, setElectiveSubjects] = useState<ElectiveSubject[]>([]);
  const [config, setConfig] = useState<SubjectElectionConfig>(DEFAULT_CONFIG);
  const [schoolName, setSchoolName] = useState("Sekolah");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    void (async () => {
      try {
        const [configSnap, schoolSnap] = await Promise.all([
          getDoc(doc(db, "schools", schoolId, "subjectElectionConfig", "config")),
          getDoc(doc(db, "schools", schoolId)),
        ]);
        if (configSnap.exists()) setConfig(configSnap.data() as SubjectElectionConfig);
        if (schoolSnap.exists()) setSchoolName(schoolSnap.data().name ?? "Sekolah");
        const subjSnap = await getDocs(query(collection(db, "schools", schoolId, "subjects"), where("isElective", "==", true)));
        setElectiveSubjects(subjSnap.docs.map(d=>({id:d.id,...d.data()} as ElectiveSubject)).sort((a,b)=>(a.electiveCategory??"").localeCompare(b.electiveCategory??"")));
      } catch { setError("Gagal memuat data. Periksa koneksi internet."); }
    })();
  }, [schoolId]);

  const isDeadlinePassed = config.deadline ? config.deadline.toDate() < new Date() : false;
  const isOpen = config.isOpen && !isDeadlinePassed;

  async function login() {
    const nisClean = nis.trim();
    if (!nisClean) { setError("Masukkan NIS terlebih dahulu."); return; }
    setLoading(true); setError("");
    try {
      const snap = await getDocs(query(collection(db, "schools", schoolId, "students"), where("nis", "==", nisClean)));
      if (snap.empty) { setError("NIS tidak ditemukan. Pastikan NIS yang dimasukkan benar."); setLoading(false); return; }
      const studentDoc = snap.docs[0];
      const studentData = { id: studentDoc.id, ...studentDoc.data() } as { id: string; name: string; nis: string; className: string };
      if (!isEligibleClass(studentData.className)) {
        setError(`Kelas ${studentData.className} belum menggunakan sistem pemilihan mapel. Pemilihan hanya untuk Kelas XI & XII.`);
        setLoading(false); return;
      }
      setStudent(studentData);
      const electionSnap = await getDoc(doc(db, "schools", schoolId, "subjectElections", studentDoc.id));
      if (electionSnap.exists()) {
        const existing = electionSnap.data() as SubjectElection;
        setExistingElection(existing);
        setSelected(existing.selectedSubjectIds);
      }
      setStep("select");
    } catch { setError("Gagal memverifikasi NIS. Coba lagi."); }
    finally { setLoading(false); }
  }

  async function submit() {
    if (!student) return;
    if (selected.length < config.minChoices) { setError(`Pilih minimal ${config.minChoices} mapel.`); return; }
    if (selected.length > config.maxChoices) { setError(`Maksimal ${config.maxChoices} mapel.`); return; }
    setSubmitting(true); setError("");
    try {
      const subjectNames = selected.map(id => electiveSubjects.find(s=>s.id===id)?.name ?? id);
      const quotaChecks = await Promise.all(
        selected.map(async (subjectId) => {
          const subj = electiveSubjects.find(s=>s.id===subjectId);
          if (!subj?.quota) return { subjectId, ok: true };
          const approvedSnap = await getDocs(query(collection(db,"schools",schoolId,"subjectElections"), where("selectedSubjectIds","array-contains",subjectId), where("status","==","approved")));
          const alreadyEnrolled = !existingElection?.selectedSubjectIds.includes(subjectId);
          const count = approvedSnap.size - (alreadyEnrolled ? 0 : 1);
          return { subjectId, name: subj.name, ok: count < subj.quota };
        })
      );
      const fullSubject = quotaChecks.find(q=>!q.ok);
      if (fullSubject) {
        setError(`Maaf, kuota untuk ${fullSubject.name} sudah penuh. Pilih mapel lain.`);
        setSubmitting(false); return;
      }
      const payload: SubjectElection = {
        studentId: student.id, studentName: student.name, nis: student.nis, className: student.className,
        selectedSubjectIds: selected, selectedSubjectNames: subjectNames, status: "pending",
        submittedAtMs: Date.now(), schoolId, schoolName,
      };
      await setDoc(doc(db, "schools", schoolId, "subjectElections", student.id), payload);
      setStep("done");
    } catch (e) { setError("Gagal menyimpan pilihan. Coba lagi."); }
    finally { setSubmitting(false); }
  }

  function toggleSubject(id: string) {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(s=>s!==id);
      if (prev.length >= config.maxChoices) { setError(`Maksimal ${config.maxChoices} mapel yang dapat dipilih.`); return prev; }
      setError(""); return [...prev, id];
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ElectiveSubject[]>();
    for (const cat of ELECTIVE_CATEGORIES) map.set(cat.key!, []);
    map.set("other", []);
    for (const s of electiveSubjects) {
      const key = s.electiveCategory ?? "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [electiveSubjects]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-teal-950 to-slate-950 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-teal-600 text-white shadow-lg">
            <BookMarked size={26}/>
          </div>
          <h1 className="text-2xl font-black text-white">Pemilihan Mapel Pilihan</h1>
          <p className="mt-1 text-sm text-slate-400">{schoolName}</p>
        </div>

        {step === "login" && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            {!isOpen && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                <AlertCircle className="mx-auto text-amber-400" size={24}/>
                <p className="mt-2 text-sm font-extrabold text-amber-300">
                  {!config.isOpen ? "Periode pendaftaran belum dibuka." : "Periode pendaftaran telah berakhir."}
                </p>
                {isDeadlinePassed && config.deadline && <p className="mt-1 text-xs text-amber-400">Deadline: {deadlineLabel(config.deadline)}</p>}
                <p className="mt-1 text-xs text-amber-400">Hubungi Wali Kelas atau TU untuk informasi lebih lanjut.</p>
              </div>
            )}
            <h2 className="mb-4 text-lg font-black text-white">Masuk dengan NIS</h2>
            <input value={nis} onChange={(e)=>{setNis(e.target.value);setError("");}} onKeyDown={(e)=>e.key==="Enter"&&void login()} placeholder="Masukkan NIS kamu" className="h-12 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-sm text-white placeholder-slate-400 outline-none focus:border-teal-400"/>
            {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            <button disabled={loading||!isOpen} onClick={()=>void login()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white disabled:opacity-40">
              {loading?<Loader2 className="animate-spin" size={16}/>:<ChevronRight size={16}/>}Lanjut
            </button>
            <p className="mt-4 text-center text-xs text-slate-400">
              Sudah daftar? <button onClick={()=>setStep("login")} className="text-teal-400 underline">Cek status</button> di{" "}
              <span className="text-teal-300">/public/status-mapel?school={schoolId}</span>
            </p>
          </div>
        )}

        {step === "select" && student && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white font-black">{student.name.charAt(0)}</div>
                <div>
                  <p className="font-extrabold text-white">{student.name}</p>
                  <p className="text-xs text-slate-400">NIS {student.nis} · {student.className}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xs font-bold text-teal-400">{selected.length}/{config.maxChoices} dipilih</p>
                  <p className="text-[10px] text-slate-500">min {config.minChoices} mapel</p>
                </div>
              </div>
              {existingElection && (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold ${existingElection.status==="approved"?"border-emerald-500/30 bg-emerald-500/10 text-emerald-400":existingElection.status==="rejected"?"border-rose-500/30 bg-rose-500/10 text-rose-400":"border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
                  {existingElection.status==="approved"?"✅ Pilihan kamu sudah disetujui. Mengubah pilihan akan mengembalikan ke status menunggu.":existingElection.status==="rejected"?`❌ Pilihan ditolak: ${existingElection.rejectionReason ?? "-"}. Ubah pilihan dan kirim ulang.`:"⏳ Pilihan kamu sedang menunggu persetujuan. Kamu bisa mengubah pilihan selama periode masih buka."}
                </div>
              )}
            </div>

            {Array.from(grouped.entries()).map(([catKey, subjects]) => {
              if (!subjects.length) return null;
              const cat = ELECTIVE_CATEGORIES.find(c=>c.key===catKey);
              const CatIcon = cat?.icon ?? BookOpen;
              return (
                <div key={catKey} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <CatIcon className="text-teal-400" size={16}/>
                    <p className="text-xs font-extrabold text-teal-300">{cat?.label ?? "Lainnya"}</p>
                  </div>
                  <div className="space-y-2">
                    {subjects.map((subj) => {
                      const isSelected = selected.includes(subj.id);
                      return (
                        <button key={subj.id} onClick={()=>toggleSubject(subj.id)} className={`w-full rounded-xl border p-3 text-left transition ${isSelected?"border-teal-400 bg-teal-600/20":"border-white/10 bg-white/5 hover:bg-white/10"}`}>
                          <div className="flex items-center gap-3">
                            <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition ${isSelected?"border-teal-400 bg-teal-600":"border-white/30 bg-transparent"}`}>
                              {isSelected && <Check className="text-white" size={12}/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-extrabold text-white">{subj.name}</p>
                              {subj.electiveDescription && <p className="mt-0.5 text-[11px] text-slate-400">{subj.electiveDescription}</p>}
                            </div>
                            {subj.quota && <span className="shrink-0 text-[10px] text-slate-400">Kuota: {subj.quota}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-400">{error}</div>}

            <button disabled={submitting||selected.length<config.minChoices} onClick={()=>void submit()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 py-4 text-sm font-extrabold text-white disabled:opacity-40 shadow-lg">
              {submitting?<Loader2 className="animate-spin" size={16}/>:<Check size={16}/>}
              {submitting?"Menyimpan...":"Kirim Pilihan Mapel"}
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center backdrop-blur-sm">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 text-white">
              <CheckCircle2 size={32}/>
            </div>
            <h2 className="text-xl font-black text-white">Pilihan Berhasil Dikirim!</h2>
            <p className="mt-2 text-sm text-emerald-300">Pilihan mapelmu sedang menunggu persetujuan dari Wali Kelas / TU sekolah.</p>
            <div className="mt-4 rounded-xl bg-white/5 p-4">
              <p className="text-xs font-bold text-emerald-400">Mapel yang kamu pilih:</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {selected.map(id=><span key={id} className="rounded-lg bg-emerald-600/30 px-2.5 py-1 text-xs font-bold text-emerald-300">{electiveSubjects.find(s=>s.id===id)?.name??id}</span>)}
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-400">Cek status persetujuan kapan saja di link status mapelmu.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PublicElectionStatus ─────────────────────────────────────────────────────

export function PublicElectionStatus() {
  const schoolId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("school") ?? "" : "";
  const [nis, setNis] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ student: { name: string; className: string }; election: SubjectElection } | null>(null);
  const [error, setError] = useState("");
  const [schoolName, setSchoolName] = useState("Sekolah");

  useEffect(() => {
    if (!schoolId) return;
    void getDoc(doc(db, "schools", schoolId)).then(snap => { if (snap.exists()) setSchoolName(snap.data().name ?? "Sekolah"); });
  }, [schoolId]);

  async function check() {
    const nisClean = nis.trim();
    if (!nisClean) { setError("Masukkan NIS terlebih dahulu."); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const snap = await getDocs(query(collection(db, "schools", schoolId, "students"), where("nis", "==", nisClean)));
      if (snap.empty) { setError("NIS tidak ditemukan."); setLoading(false); return; }
      const studentDoc = snap.docs[0];
      const studentData = studentDoc.data() as { name: string; className: string };
      const electionSnap = await getDoc(doc(db, "schools", schoolId, "subjectElections", studentDoc.id));
      if (!electionSnap.exists()) { setError(`${studentData.name} belum melakukan pemilihan mapel.`); setLoading(false); return; }
      setResult({ student: studentData, election: electionSnap.data() as SubjectElection });
    } catch { setError("Gagal memuat status. Coba lagi."); }
    finally { setLoading(false); }
  }

  const statusConfig = (status: string) => ({
    approved: { label: "Disetujui ✅", bg: "border-emerald-500/30 bg-emerald-500/10", text: "text-emerald-300", desc: "Pilihan mata pelajaranmu sudah resmi disetujui oleh sekolah." },
    pending: { label: "Menunggu Persetujuan ⏳", bg: "border-amber-500/30 bg-amber-500/10", text: "text-amber-300", desc: "Pilihan sedang dalam proses review oleh Wali Kelas / TU." },
    rejected: { label: "Ditolak ❌", bg: "border-rose-500/30 bg-rose-500/10", text: "text-rose-300", desc: "Pilihan tidak disetujui. Silakan hubungi Wali Kelas atau revisi pilihan." },
  }[status] ?? { label: status, bg: "border-slate-500/30 bg-slate-500/10", text: "text-slate-300", desc: "" });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-teal-950 to-slate-950 p-4 sm:p-6">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-teal-600 text-white shadow-lg"><GraduationCap size={26}/></div>
          <h1 className="text-2xl font-black text-white">Status Pemilihan Mapel</h1>
          <p className="mt-1 text-sm text-slate-400">{schoolName}</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
          <h2 className="mb-4 text-sm font-extrabold text-white">Masukkan NIS untuk Cek Status</h2>
          <div className="flex gap-2">
            <input value={nis} onChange={(e)=>{setNis(e.target.value);setError("");}} onKeyDown={(e)=>e.key==="Enter"&&void check()} placeholder="NIS kamu" className="h-11 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 text-sm text-white placeholder-slate-400 outline-none focus:border-teal-400"/>
            <button disabled={loading} onClick={()=>void check()} className="flex h-11 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-extrabold text-white disabled:opacity-40">
              {loading?<Loader2 className="animate-spin" size={15}/>:<Search size={15}/>}Cek
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          {result && (() => {
            const sc = statusConfig(result.election.status);
            return (
              <div className={`mt-5 rounded-2xl border p-5 ${sc.bg}`}>
                <p className={`text-base font-black ${sc.text}`}>{sc.label}</p>
                <p className="mt-1 text-xs text-slate-400">{result.student.name} · {result.student.className}</p>
                <p className="mt-2 text-xs text-slate-300">{sc.desc}</p>
                {result.election.rejectionReason && (
                  <p className="mt-2 text-xs text-rose-400">Alasan: {result.election.rejectionReason}</p>
                )}
                <div className="mt-4">
                  <p className="mb-2 text-[10px] font-extrabold text-slate-400">Mapel yang Dipilih:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.election.selectedSubjectNames.map((name, i) => (
                      <span key={i} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white">{name}</span>
                    ))}
                  </div>
                </div>
                {result.election.reviewedByName && (
                  <p className="mt-3 text-[10px] text-slate-500">Direview oleh: {result.election.reviewedByName} · {result.election.reviewedAtMs ? new Intl.DateTimeFormat("id-ID",{dateStyle:"short"}).format(new Date(result.election.reviewedAtMs)) : "-"}</p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
