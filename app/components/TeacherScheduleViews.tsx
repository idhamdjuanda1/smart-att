"use client";
/* eslint-disable react-hooks/rules-of-hooks -- useSchedule is an event handler for selecting a teaching slot, not a React hook. */

import { useEffect, useMemo, useState } from "react";
import {
  AlarmClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, FileText, Loader2, MapPin, PencilLine, Plus, Save, Trash2,
} from "lucide-react";
import type { User } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

type Toast = { message: string; tone: "success" | "error" } | null;
type TeachingSession = { subjectId: string; subjectName: string; className: string; startTime: string; endTime: string };
type Schedule = TeachingSession & { id: string; day: number; dayName: string; updatedAtMs: number };
type Agenda = { id: string; date: string; title: string; category: string; startTime: string; endTime: string; location: string; description: string; updatedAtMs: number };

const DAYS = [
  { value: 1, label: "Senin" }, { value: 2, label: "Selasa" }, { value: 3, label: "Rabu" },
  { value: 4, label: "Kamis" }, { value: 5, label: "Jumat" }, { value: 6, label: "Sabtu" },
];
const DEFAULT_SUBJECTS = ["Pendidikan Pancasila", "Pendidikan Agama", "Bahasa Indonesia", "Matematika", "IPA", "IPS", "Bahasa Inggris", "Seni Budaya", "PJOK", "Informatika"];
const AGENDA_CATEGORIES = ["Rapat Guru", "Workshop / Diklat", "Studi Banding", "Kunjungan Wisata", "Agenda Sekolah", "Lainnya"];

const HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "Tahun Baru 2026 Masehi", "2026-01-16": "Isra Mikraj Nabi Muhammad SAW",
  "2026-02-17": "Tahun Baru Imlek 2577 Kongzili", "2026-03-19": "Hari Suci Nyepi",
  "2026-03-21": "Hari Raya Idulfitri 1447 H", "2026-03-22": "Hari Raya Idulfitri 1447 H",
  "2026-04-03": "Wafat Yesus Kristus", "2026-04-05": "Kebangkitan Yesus Kristus (Paskah)",
  "2026-05-01": "Hari Buruh Internasional", "2026-05-14": "Kenaikan Yesus Kristus",
  "2026-05-27": "Hari Raya Iduladha 1447 H", "2026-05-31": "Hari Raya Waisak 2570 BE",
  "2026-06-01": "Hari Lahir Pancasila", "2026-06-16": "1 Muharam 1448 H",
  "2026-08-17": "Hari Proklamasi Kemerdekaan", "2026-08-25": "Maulid Nabi Muhammad SAW",
  "2026-12-25": "Kelahiran Yesus Kristus",
};
const COLLECTIVE_LEAVE_2026: Record<string, string> = {
  "2026-02-16": "Cuti Bersama Imlek", "2026-03-18": "Cuti Bersama Nyepi",
  "2026-03-20": "Cuti Bersama Idulfitri", "2026-03-23": "Cuti Bersama Idulfitri",
  "2026-03-24": "Cuti Bersama Idulfitri", "2026-05-15": "Cuti Bersama Kenaikan Yesus Kristus",
  "2026-05-28": "Cuti Bersama Iduladha", "2026-12-24": "Cuti Bersama Natal",
};

function dateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function dayName(day: number) { return DAYS.find((item) => item.value === day)?.label ?? "Senin"; }
function safeId(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export function TeachingScheduleView({ user, demo, classes, setActiveSession, setToast, onView }: { user: User | null; demo: boolean; classes: string[]; setActiveSession: (value: TeachingSession) => void; setToast: (toast: Toast) => void; onView: (view: "scan" | "subjects" | "tasks" | "exams" | "scores") => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>(demo ? [{ id: "demo-monday-math", day: 1, dayName: "Senin", startTime: "08:00", endTime: "09:00", subjectId: "mandatory-mathematics", subjectName: "Matematika", className: classes[0] || "V-A", updatedAtMs: 0 }] : []);
  const [optionalSubjects, setOptionalSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ day: 1, startTime: "07:00", endTime: "08:00", subjectName: "Matematika", className: classes[0] || "" });
  const subjects = useMemo(() => Array.from(new Set([...DEFAULT_SUBJECTS, ...optionalSubjects.map((item) => item.name)])).sort((a, b) => a.localeCompare(b, "id-ID")), [optionalSubjects]);
  const rows = useMemo(() => [...schedules].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.day - b.day), [schedules]);
  const timeSlots = useMemo(() => Array.from(new Set(rows.map((item) => `${item.startTime}|${item.endTime}`))).sort(), [rows]);
  const now = new Date(); const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const current = schedules.find((item) => item.day === now.getDay() && item.startTime <= nowTime && item.endTime >= nowTime);

  useEffect(() => {
    if (demo || !user) return;
    const stops = [
      onSnapshot(collection(db, "users", user.uid, "teachingSchedule"), (snapshot) => setSchedules(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Schedule))), () => setToast({ message: "Jadwal pelajaran belum dapat dibaca.", tone: "error" })),
      onSnapshot(collection(db, "users", user.uid, "subjects"), (snapshot) => setOptionalSubjects(snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name || "") })).filter((item) => item.name))),
    ];
    return () => stops.forEach((stop) => stop());
  }, [demo, user, setToast]);

  function reset() { setEditing(null); setForm({ day: 1, startTime: "07:00", endTime: "08:00", subjectName: subjects[0] || "Matematika", className: classes[0] || "" }); }
  function edit(item: Schedule) { setEditing(item); setForm({ day: item.day, startTime: item.startTime, endTime: item.endTime, subjectName: item.subjectName, className: item.className }); }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.className || !form.subjectName || !form.startTime || !form.endTime) { setToast({ message: "Hari, jam, mata pelajaran, dan kelas wajib diisi.", tone: "error" }); return; }
    if (form.endTime <= form.startTime) { setToast({ message: "Jam selesai harus setelah jam mulai.", tone: "error" }); return; }
    const conflict = schedules.find((item) => item.id !== editing?.id && item.day === form.day && form.startTime < item.endTime && form.endTime > item.startTime);
    if (conflict) { setToast({ message: `Jadwal bertabrakan dengan ${conflict.subjectName} ${conflict.startTime}–${conflict.endTime}.`, tone: "error" }); return; }
    const subjectId = optionalSubjects.find((item) => item.name === form.subjectName)?.id || `subject-${safeId(form.subjectName)}`;
    const id = editing?.id || `${form.day}-${form.startTime}-${form.endTime}-${safeId(form.className)}-${safeId(form.subjectName)}`;
    const payload: Schedule = { id, ...form, dayName: dayName(form.day), subjectId, updatedAtMs: Date.now() };
    setSaving(true);
    try {
      if (demo || !user) setSchedules((items) => [payload, ...items.filter((item) => item.id !== id)]);
      else await setDoc(doc(db, "users", user.uid, "teachingSchedule", id), { ...payload, updatedAt: serverTimestamp(), ...(!editing ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
      reset(); setToast({ message: "Jadwal mingguan berhasil disimpan.", tone: "success" });
    } catch { setToast({ message: "Jadwal gagal disimpan.", tone: "error" }); }
    finally { setSaving(false); }
  }
  async function remove(item: Schedule) {
    if (!window.confirm(`Hapus jadwal ${item.subjectName} hari ${item.dayName}?`)) return;
    try { if (demo || !user) setSchedules((items) => items.filter((row) => row.id !== item.id)); else await deleteDoc(doc(db, "users", user.uid, "teachingSchedule", item.id)); setToast({ message: "Jadwal dihapus.", tone: "success" }); } catch { setToast({ message: "Jadwal belum dapat dihapus.", tone: "error" }); }
  }
  function useSchedule(item: Schedule, destination: "scan" | "subjects" | "tasks" | "exams" | "scores" = "subjects") {
    setActiveSession({ subjectId: item.subjectId, subjectName: item.subjectName, className: item.className, startTime: item.startTime, endTime: item.endTime });
    setToast({ message: `${item.subjectName} · ${item.className} dijadikan sesi aktif.`, tone: "success" }); onView(destination);
  }

  return <>
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Pembelajaran Mingguan</p><h2 className="mt-1 text-2xl font-black">Jadwal Pelajaran</h2><p className="mt-1 text-sm text-slate-500">Atur jadwal berulang sebagai acuan absensi, catatan, tugas, kuis, dan penilaian.</p></div>{current && <button onClick={() => useSchedule(current)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white"><CheckCircle2 size={16}/>Gunakan sesi sekarang</button>}</div>
    {current && <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase text-emerald-600">Sedang berlangsung</p><h3 className="mt-1 font-black text-emerald-950">{current.subjectName} · {current.className}</h3><p className="mt-1 text-xs text-emerald-700">{current.dayName}, {current.startTime}–{current.endTime}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => useSchedule(current, "scan")} className="rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-black text-white">Buka Absensi</button><button onClick={() => useSchedule(current, "subjects")} className="rounded-xl bg-white px-3 py-2 text-[10px] font-black text-emerald-700">Catatan Pembelajaran</button></div></section>}
    <div className="grid gap-5 xl:grid-cols-[1.45fr_.55fr]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase text-slate-400"><tr><th className="px-4 py-3">Jam</th>{DAYS.slice(0, 5).map((item) => <th key={item.value} className="px-3 py-3">{item.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{timeSlots.map((slot) => { const [start, end] = slot.split("|"); return <tr key={slot}><td className="whitespace-nowrap px-4 py-4 text-xs font-black text-slate-600">{start}–{end}</td>{DAYS.slice(0, 5).map((day) => { const items = rows.filter((item) => item.day === day.value && item.startTime === start && item.endTime === end); return <td key={day.value} className="min-w-36 px-2 py-3">{items.map((item) => <button key={item.id} onClick={() => useSchedule(item)} className="mb-1 w-full rounded-xl border border-teal-100 bg-teal-50 p-2 text-left"><span className="block text-[11px] font-black text-teal-900">{item.subjectName}</span><span className="mt-1 block text-[9px] font-bold text-teal-600">{item.className}</span></button>)}</td>; })}</tr>; })}{!timeSlots.length && <tr><td colSpan={6} className="px-5 py-16 text-center text-sm font-bold text-slate-400">Belum ada jadwal. Tambahkan sesi pertama melalui formulir.</td></tr>}</tbody></table></div><div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><Clock3 size={17}/></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{item.dayName} · {item.subjectName}</p><p className="mt-1 text-[10px] text-slate-400">{item.startTime}–{item.endTime} · {item.className}</p></div><button onClick={() => edit(item)} className="p-2 text-sky-600"><PencilLine size={14}/></button><button onClick={() => void remove(item)} className="p-2 text-rose-600"><Trash2 size={14}/></button></article>)}</div></section>
      <form onSubmit={save} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-3 text-teal-700"><AlarmClock size={20}/></div><div><h3 className="font-black">{editing ? "Edit jadwal" : "Tambah jadwal"}</h3><p className="text-[10px] text-slate-400">Berulang setiap minggu</p></div></div><div className="mt-5 space-y-3"><Select label="Hari" value={String(form.day)} onChange={(value) => setForm({ ...form, day: Number(value) })} options={DAYS.map((item) => ({ value: String(item.value), label: item.label }))}/><div className="grid grid-cols-2 gap-3"><Input label="Jam mulai" type="time" value={form.startTime} onChange={(value) => setForm({ ...form, startTime: value })}/><Input label="Jam selesai" type="time" value={form.endTime} onChange={(value) => setForm({ ...form, endTime: value })}/></div><Select label="Mata pelajaran" value={form.subjectName} onChange={(value) => setForm({ ...form, subjectName: value })} options={subjects.map((item) => ({ value: item, label: item }))}/><Select label="Kelas" value={form.className} onChange={(value) => setForm({ ...form, className: value })} options={classes.map((item) => ({ value: item, label: item }))}/><div className="flex gap-2"><button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={15}/> : <Save size={15}/>}Simpan</button>{editing && <button type="button" onClick={reset} className="rounded-xl border border-slate-200 px-4 text-xs font-black">Batal</button>}</div></div></form>
    </div>
  </>;
}

export function TeacherCalendarView({ user, demo, setToast }: { user: User | null; demo: boolean; setToast: (toast: Toast) => void }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [note, setNote] = useState(""); const [savingNote, setSavingNote] = useState(false); const [savingAgenda, setSavingAgenda] = useState(false);
  const [editing, setEditing] = useState<Agenda | null>(null);
  const [form, setForm] = useState({ title: "", category: AGENDA_CATEGORIES[0], startTime: "08:00", endTime: "09:00", location: "", description: "" });
  const today = dateKey(new Date());
  const cells = useMemo(() => { const first = new Date(month.getFullYear(), month.getMonth(), 1); const mondayOffset = (first.getDay() + 6) % 7; const start = new Date(first); start.setDate(first.getDate() - mondayOffset); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }, [month]);
  const selectedAgendas = agendas.filter((item) => item.date === selectedDate).sort((a, b) => a.startTime.localeCompare(b.startTime));

  useEffect(() => { if (demo || !user) return; return onSnapshot(collection(db, "users", user.uid, "teacherAgendas"), (snapshot) => setAgendas(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Agenda))), () => setToast({ message: "Agenda guru belum dapat dibaca.", tone: "error" })); }, [demo, user, setToast]);
  useEffect(() => { if (demo || !user) return; return onSnapshot(doc(db, "users", user.uid, "teacherDateNotes", selectedDate), (snapshot) => setNote(snapshot.exists() ? String(snapshot.data().content || "") : "")); }, [demo, user, selectedDate]);

  function resetAgenda() { setEditing(null); setForm({ title: "", category: AGENDA_CATEGORIES[0], startTime: "08:00", endTime: "09:00", location: "", description: "" }); }
  async function saveAgenda(event: React.FormEvent) { event.preventDefault(); if (!form.title.trim()) { setToast({ message: "Nama agenda wajib diisi.", tone: "error" }); return; } const id = editing?.id || crypto.randomUUID(); const payload: Agenda = { id, date: selectedDate, ...form, title: form.title.trim(), updatedAtMs: Date.now() }; setSavingAgenda(true); try { if (demo || !user) setAgendas((items) => [payload, ...items.filter((item) => item.id !== id)]); else await setDoc(doc(db, "users", user.uid, "teacherAgendas", id), { ...payload, updatedAt: serverTimestamp(), ...(!editing ? { createdAt: serverTimestamp() } : {}) }, { merge: true }); resetAgenda(); setToast({ message: "Agenda guru tersimpan.", tone: "success" }); } catch { setToast({ message: "Agenda belum dapat disimpan.", tone: "error" }); } finally { setSavingAgenda(false); } }
  async function removeAgenda(item: Agenda) { if (!window.confirm(`Hapus agenda ${item.title}?`)) return; try { if (demo || !user) setAgendas((items) => items.filter((row) => row.id !== item.id)); else await deleteDoc(doc(db, "users", user.uid, "teacherAgendas", item.id)); setToast({ message: "Agenda dihapus.", tone: "success" }); } catch { setToast({ message: "Agenda belum dapat dihapus.", tone: "error" }); } }
  async function saveNote() { setSavingNote(true); try { if (!demo && user) await setDoc(doc(db, "users", user.uid, "teacherDateNotes", selectedDate), { date: selectedDate, content: note.trim(), updatedAtMs: Date.now(), updatedAt: serverTimestamp() }, { merge: true }); setToast({ message: "Catatan guru tersimpan.", tone: "success" }); } catch { setToast({ message: "Catatan belum dapat disimpan.", tone: "error" }); } finally { setSavingNote(false); } }

  return <>
    <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Agenda Pribadi</p><h2 className="mt-1 text-2xl font-black">Kalender Guru</h2><p className="mt-1 text-sm text-slate-500">Kalender bulanan, tanggal merah nasional, agenda sekolah, dan catatan pribadi guru.</p></div>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b border-slate-100 p-4"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><ChevronLeft size={17}/></button><div className="text-center"><p className="text-lg font-black">{new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(month)}</p><button onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(today); }} className="mt-1 text-[10px] font-black text-teal-700">Kembali ke hari ini</button></div><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><ChevronRight size={17}/></button></header><div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[9px] font-black uppercase text-slate-400">{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((item) => <div key={item} className="py-3">{item}</div>)}</div><div className="grid grid-cols-7">{cells.map((date) => { const key = dateKey(date); const inMonth = date.getMonth() === month.getMonth(); const holiday = HOLIDAYS_2026[key]; const leave = COLLECTIVE_LEAVE_2026[key]; const count = agendas.filter((item) => item.date === key).length; const selected = key === selectedDate; return <button key={key} onClick={() => setSelectedDate(key)} title={holiday || leave || ""} className={`relative min-h-20 border-b border-r border-slate-100 p-2 text-left transition sm:min-h-24 ${selected ? "bg-teal-50 ring-2 ring-inset ring-teal-500" : key === today ? "bg-sky-50" : "bg-white"} ${!inMonth ? "opacity-35" : ""}`}><span className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-black ${holiday || date.getDay() === 0 ? "bg-rose-100 text-rose-700" : key === today ? "bg-sky-600 text-white" : "text-slate-700"}`}>{date.getDate()}</span>{holiday && <span className="mt-1 line-clamp-2 block text-[8px] font-black leading-3 text-rose-600">{holiday}</span>}{leave && !holiday && <span className="mt-1 line-clamp-2 block text-[8px] font-black leading-3 text-amber-600">{leave}</span>}{count > 0 && <span className="absolute bottom-2 right-2 grid h-5 min-w-5 place-items-center rounded-full bg-teal-600 px-1 text-[8px] font-black text-white">{count}</span>}</button>; })}</div><footer className="flex flex-wrap gap-4 p-3 text-[10px] font-bold text-slate-500"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-500"/>Libur nasional</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-amber-500"/>Cuti bersama</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-teal-500"/>Agenda guru</span></footer></section>
      <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><p className="text-[10px] font-black uppercase text-teal-600">Tanggal terpilih</p><h3 className="mt-1 text-lg font-black">{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`))}</h3>{(HOLIDAYS_2026[selectedDate] || COLLECTIVE_LEAVE_2026[selectedDate]) && <p className="mt-2 rounded-xl bg-rose-50 p-2 text-xs font-black text-rose-700">{HOLIDAYS_2026[selectedDate] || COLLECTIVE_LEAVE_2026[selectedDate]}</p>}</div><div className="space-y-2">{selectedAgendas.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start gap-3"><div className="rounded-lg bg-violet-50 p-2 text-violet-700"><CalendarDays size={15}/></div><div className="min-w-0 flex-1"><p className="text-xs font-black">{item.title}</p><p className="mt-1 text-[10px] text-slate-400">{item.category} · {item.startTime}–{item.endTime}</p>{item.location && <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500"><MapPin size={11}/>{item.location}</p>}</div><button onClick={() => { setEditing(item); setForm({ title: item.title, category: item.category, startTime: item.startTime, endTime: item.endTime, location: item.location, description: item.description }); }} className="p-1.5 text-sky-600"><PencilLine size={13}/></button><button onClick={() => void removeAgenda(item)} className="p-1.5 text-rose-600"><Trash2 size={13}/></button></div></article>)}{!selectedAgendas.length && <p className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs font-bold text-slate-400">Belum ada agenda.</p>}</div></section><form onSubmit={saveAgenda} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-black">{editing ? "Edit agenda" : "Tambah agenda"}</h3><Plus size={17} className="text-teal-600"/></div><div className="mt-4 space-y-3"><Input label="Nama agenda" value={form.title} onChange={(value) => setForm({ ...form, title: value })} placeholder="Contoh: Rapat evaluasi"/><Select label="Jenis agenda" value={form.category} onChange={(value) => setForm({ ...form, category: value })} options={AGENDA_CATEGORIES.map((item) => ({ value: item, label: item }))}/><div className="grid grid-cols-2 gap-3"><Input label="Mulai" type="time" value={form.startTime} onChange={(value) => setForm({ ...form, startTime: value })}/><Input label="Selesai" type="time" value={form.endTime} onChange={(value) => setForm({ ...form, endTime: value })}/></div><Input label="Lokasi" value={form.location} onChange={(value) => setForm({ ...form, location: value })} placeholder="Ruang guru"/><label className="block"><span className="mb-1.5 block text-xs font-extrabold">Keterangan</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal-500"/></label><div className="flex gap-2"><button disabled={savingAgenda} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-xs font-black text-white">{savingAgenda ? <Loader2 className="animate-spin" size={15}/> : <Save size={15}/>}Simpan agenda</button>{editing && <button type="button" onClick={resetAgenda} className="rounded-xl border border-slate-200 px-4 text-xs font-black">Batal</button>}</div></div></form></div>
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-50 p-3 text-amber-700"><FileText size={19}/></div><div><h3 className="font-black">Catatan Guru</h3><p className="mt-1 text-[10px] text-slate-400">Pribadi untuk {selectedDate}; hanya dapat dilihat dan diedit oleh akun Anda.</p></div></div><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tulis catatan, pengingat, atau evaluasi pribadi untuk tanggal ini..." className="mt-4 min-h-36 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-teal-500"/><div className="mt-3 flex justify-end"><button disabled={savingNote} onClick={() => void saveNote()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-xs font-black text-white">{savingNote ? <Loader2 className="animate-spin" size={15}/> : <Save size={15}/>}Simpan catatan</button></div></section>
  </>;
}

function Input({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className="block"><span className="mb-1.5 block text-xs font-extrabold">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500"/></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="block"><span className="mb-1.5 block text-xs font-extrabold">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-teal-500"><option value="">Pilih</option>{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>; }
