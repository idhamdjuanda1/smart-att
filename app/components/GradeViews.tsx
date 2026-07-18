"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { BarChart3, Check, Download, GraduationCap, ListChecks, Loader2, PencilLine, Plus, Printer, RefreshCcw, School, Search, Settings, Share2, Trash2, Users } from "lucide-react";
import { db } from "../lib/firebase";

type Student = { id: string; nis: string; name: string; className: string };
type Toast = { message: string; tone: "success" | "error" } | null;
type GradeCategory = "task" | "quiz" | "summative" | "midterm" | "final" | "practice" | "project" | "attitude";
type GradeWeights = Record<GradeCategory, { enabled: boolean; weight: number }>;
type ManualGrade = { id: string; className: string; subject?: string; category: GradeCategory; assessmentType: string; name: string; studentId: string; studentName: string; nis: string; score: number; notes?: string; createdAtMs: number };
type Exam = { id: string; title: string; subjectId?: string; subject?: string; className: string; status?: string; gradeCategory?: GradeCategory; assessmentType?: string; createdAt?: { toMillis?: () => number } | null };
type Subject = { id: string; name: string; category?: string; color?: string };
type Attempt = { id: string; examId: string; studentId: string; nis: string; studentName: string; className: string; status: string; score?: number };
type AcademicSettings = { schoolName: string; academicYear: string; semester: "Ganjil" | "Genap"; classNames: string[]; entryTime: string; kkm: number };
type CommonProps = { user: User | null; demo: boolean; students: Student[]; setToast: (value: Toast) => void };

const categories: { key: GradeCategory; label: string; description: string }[] = [
  { key: "task", label: "Tugas", description: "Tugas aplikasi dan tugas offline" },
  { key: "quiz", label: "Kuis", description: "Kuis singkat dan evaluasi formatif" },
  { key: "summative", label: "Ulangan Harian / Sumatif", description: "Soal & Ulangan reguler" },
  { key: "midterm", label: "PTS / STS", description: "Penilaian tengah semester" },
  { key: "final", label: "PAS / SAS", description: "Penilaian akhir semester" },
  { key: "practice", label: "Praktik", description: "Praktik, lisan, hafalan, presentasi" },
  { key: "project", label: "Proyek", description: "Proyek individu atau kelompok" },
  { key: "attitude", label: "Sikap", description: "Observasi dan penilaian sikap" },
];
const defaultWeights: GradeWeights = {
  task: { enabled: true, weight: 15 }, quiz: { enabled: true, weight: 15 },
  summative: { enabled: true, weight: 25 }, midterm: { enabled: true, weight: 20 },
  final: { enabled: true, weight: 25 }, practice: { enabled: false, weight: 0 },
  project: { enabled: false, weight: 0 }, attitude: { enabled: false, weight: 0 },
};
const manualTypes: { value: string; label: string; category: GradeCategory }[] = [
  { value: "task_offline", label: "Tugas luring", category: "task" },
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
const defaultAcademic: AcademicSettings = { schoolName: "SDN Papandayan 1", academicYear: "2026/2027", semester: "Ganjil", classNames: ["V-A", "V-B"], entryTime: "07:00", kkm: 75 };
const defaultSubjects: Subject[] = [{ id: "pancasila", name: "Pendidikan Pancasila" }, { id: "agama", name: "Pendidikan Agama" }, { id: "indonesia", name: "Bahasa Indonesia" }, { id: "matematika", name: "Matematika" }, { id: "ipa", name: "IPA" }, { id: "ips", name: "IPS" }, { id: "inggris", name: "Bahasa Inggris" }, { id: "seni", name: "Seni Budaya" }, { id: "pjok", name: "PJOK" }, { id: "informatika", name: "Informatika" }];

function normalizeWeights(value?: Partial<GradeWeights>): GradeWeights {
  const result = { ...defaultWeights } as GradeWeights;
  for (const item of categories) {
    const source = value?.[item.key];
    result[item.key] = { enabled: typeof source?.enabled === "boolean" ? source.enabled : defaultWeights[item.key].enabled, weight: Number.isFinite(source?.weight) ? Math.max(0, Number(source?.weight)) : defaultWeights[item.key].weight };
  }
  return result;
}
function normalizeAcademic(value?: Partial<AcademicSettings>): AcademicSettings {
  return {
    schoolName: typeof value?.schoolName === "string" ? value.schoolName : defaultAcademic.schoolName,
    academicYear: typeof value?.academicYear === "string" ? value.academicYear : defaultAcademic.academicYear,
    semester: value?.semester === "Genap" ? "Genap" : "Ganjil",
    classNames: Array.isArray(value?.classNames) ? value.classNames.filter((item): item is string => typeof item === "string") : defaultAcademic.classNames,
    entryTime: typeof value?.entryTime === "string" ? value.entryTime : defaultAcademic.entryTime,
    kkm: typeof value?.kkm === "number" ? value.kkm : defaultAcademic.kkm,
  };
}
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function examCategory(exam?: Exam): GradeCategory {
  if (exam?.gradeCategory && categories.some((item) => item.key === exam.gradeCategory)) return exam.gradeCategory;
  const title = (exam?.title ?? "").toUpperCase();
  if (/\b(PAS|SAS|UAS)\b/.test(title)) return "final";
  if (/\b(PTS|STS|UTS)\b/.test(title)) return "midterm";
  if (/QUIZ|KUIS/.test(title)) return "quiz";
  return "summative";
}
function selectClassNames(students: Student[], academic: AcademicSettings) { return Array.from(new Set([...academic.classNames, ...students.map((item) => item.className)].filter(Boolean))).sort(); }
function FieldLabel({ children }: { children: React.ReactNode }) { return <span className="mb-2 block text-xs font-extrabold text-slate-700">{children}</span>; }

export function ScoresView({ user, demo, students, setToast }: CommonProps) {
  const [tab, setTab] = useState<"dashboard" | "student" | "subject" | "manual" | "settings" | "recap">("dashboard");
  const [weights, setWeights] = useState<GradeWeights>(defaultWeights);
  const [academic, setAcademic] = useState<AcademicSettings>(defaultAcademic);
  const [manualGrades, setManualGrades] = useState<ManualGrade[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>(defaultSubjects);
  const [saving, setSaving] = useState(false);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("Matematika");
  const [studentSearch, setStudentSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [sortMode, setSortMode] = useState<"highest" | "lowest" | "name">("highest");  const [form, setForm] = useState({ className: "", subject: "Matematika", assessmentType: "task_offline", name: "", studentId: "", score: "", notes: "" });
  const classNames = useMemo(() => selectClassNames(students, academic), [students, academic]);
  const subjectNames = useMemo(() => Array.from(new Set([...defaultSubjects.map((item) => item.name), ...subjects.map((item) => item.name), ...exams.map((item) => item.subject ?? ""), ...manualGrades.map((item) => item.subject ?? "")].map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), [subjects, exams, manualGrades]);
  const classStudents = useMemo(() => students.filter((student) => student.className === (selectedClass || classNames[0])), [students, selectedClass, classNames]);
  const visibleStudents = useMemo(() => classStudents.filter((student) => `${student.name} ${student.nis}`.toLowerCase().includes(studentSearch.trim().toLowerCase())), [classStudents, studentSearch]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? visibleStudents[0] ?? classStudents[0];
  const manualStudents = useMemo(() => students.filter((student) => student.className === form.className), [students, form.className]);
  const totalWeight = categories.reduce((sum, item) => sum + (weights[item.key].enabled ? weights[item.key].weight : 0), 0);
  const activeCategories = categories.filter((item) => weights[item.key].enabled);
  useEffect(() => {
    if (!selectedClass && classNames[0]) setSelectedClass(classNames[0]);
    if (!form.className && classNames[0]) setForm((current) => ({ ...current, className: classNames[0] }));
  }, [classNames, selectedClass, form.className]);
  useEffect(() => {
    if (form.studentId && manualStudents.some((student) => student.id === form.studentId)) return;
    setForm((current) => ({ ...current, studentId: manualStudents[0]?.id ?? "" }));
  }, [manualStudents, form.studentId]);
  const effectiveSelectedSubject = subjectNames.includes(selectedSubject) ? selectedSubject : subjectNames[0] ?? "";
  useEffect(() => {
    if (demo) { const demoGrades = students.flatMap((student, studentIndex) => defaultSubjects.map((subject, subjectIndex) => ({ id: `${student.id}-${subject.id}`, className: student.className, subject: subject.name, category: "summative" as GradeCategory, assessmentType: "daily_test", name: `Nilai ${subject.name}`, studentId: student.id, studentName: student.name, nis: student.nis, score: 82 + ((studentIndex + subjectIndex * 3) % 14), notes: "", createdAtMs: Date.now() - subjectIndex * 86400000 }))); setWeights(defaultWeights); setAcademic(defaultAcademic); setManualGrades(demoGrades); setExams([]); setAttempts([]); setSubjects(defaultSubjects); return; }
    if (!user) return;
    const stops = [
      onSnapshot(doc(db, "users", user.uid, "settings", "grades"), (snapshot) => setWeights(normalizeWeights(snapshot.exists() ? snapshot.data().weights as Partial<GradeWeights> : undefined))),
      onSnapshot(doc(db, "users", user.uid, "settings", "academic"), (snapshot) => setAcademic(normalizeAcademic(snapshot.exists() ? snapshot.data() as Partial<AcademicSettings> : undefined))),
      onSnapshot(collection(db, "users", user.uid, "manualGrades"), (snapshot) => setManualGrades(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ManualGrade)).sort((a, b) => b.createdAtMs - a.createdAtMs))),
      onSnapshot(collection(db, "users", user.uid, "exams"), (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Exam)))),
      onSnapshot(collection(db, "users", user.uid, "subjects"), (snapshot) => setSubjects([...defaultSubjects, ...snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Subject))])),
      onSnapshot(query(collection(db, "publicQuizAttempts"), where("ownerUid", "==", user.uid)), (snapshot) => setAttempts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Attempt)).filter((item) => item.status === "finished" && typeof item.score === "number"))),
    ];
    return () => stops.forEach((stop) => stop());
  }, [user, demo]);
  const rows = useMemo(() => classStudents.map((student) => {
    const categoryScores = {} as Record<GradeCategory, number | null>; const cbtScores: number[] = [];
    for (const item of categories) {
      const manual = manualGrades.filter((grade) => grade.studentId === student.id && grade.category === item.key).map((grade) => grade.score);
      const cbt = attempts.filter((attempt) => attempt.studentId === student.id && examCategory(exams.find((exam) => exam.id === attempt.examId)) === item.key).map((attempt) => Number(attempt.score));
      cbtScores.push(...cbt); categoryScores[item.key] = average([...manual, ...cbt]);
    }
    let weightedSum = 0; let usedWeight = 0;
    for (const item of activeCategories) { const value = categoryScores[item.key]; if (value !== null) { weightedSum += value * weights[item.key].weight; usedWeight += weights[item.key].weight; } }
    return { student, categoryScores, cbtAverage: average(cbtScores), finalScore: usedWeight ? weightedSum / usedWeight : null };
  }), [classStudents, manualGrades, attempts, exams, activeCategories, weights]);
  const classAverage = average(rows.map((row) => row.finalScore).filter((value): value is number => value !== null));
  const latestExams = useMemo(() => exams.filter((exam) => !selectedClass || exam.className === selectedClass).sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 5), [exams, selectedClass]);
  const subjectScore = (student: Student, subject: string) => average([
    ...manualGrades.filter((grade) => grade.studentId === student.id && (grade.subject || "Mata Pelajaran") === subject).map((grade) => Number(grade.score)),
    ...attempts.filter((attempt) => attempt.studentId === student.id && (exams.find((exam) => exam.id === attempt.examId)?.subject || "Kuis") === subject).map((attempt) => Number(attempt.score)),
  ].filter((value) => Number.isFinite(value)));
  const studentSubjectRows = subjectNames.map((subject) => ({ subject, score: selectedStudent ? subjectScore(selectedStudent, subject) : null }));
  const selectedStudentScores = studentSubjectRows.map((row) => row.score).filter((value): value is number => value !== null);
  const rankedRows = rows.map((row, index) => ({ ...row, rank: row.finalScore === null ? null : index + 1 }));
  const selectedStudentRank = selectedStudent ? rankedRows.find((row) => row.student.id === selectedStudent.id)?.rank ?? null : null;
  const subjectRows = classStudents.map((student) => ({ student, score: subjectScore(student, effectiveSelectedSubject) })).filter((row) => `${row.student.name} ${row.student.nis}`.toLowerCase().includes(subjectSearch.trim().toLowerCase())).sort((a, b) => sortMode === "name" ? a.student.name.localeCompare(b.student.name, "id-ID") : sortMode === "lowest" ? (a.score ?? 999) - (b.score ?? 999) : (b.score ?? -1) - (a.score ?? -1));
  const finalScores = rows.map((row) => row.finalScore).filter((value): value is number => value !== null);
  const subjectAverages = subjectNames.map((subject) => ({ subject, value: average(classStudents.map((student) => subjectScore(student, subject)).filter((value): value is number => value !== null)) })).filter((item) => item.value !== null);
  const unfinishedAssessments = Math.max(0, subjectNames.length * classStudents.length - manualGrades.filter((grade) => grade.className === (selectedClass || classNames[0])).length);
  async function saveWeights() {
    if (Math.round(totalWeight * 100) / 100 !== 100) { setToast({ message: "Total bobot harus tepat 100%.", tone: "error" }); return; }
    setSaving(true);
    try { if (!demo && user) await setDoc(doc(db, "users", user.uid, "settings", "grades"), { weights, updatedAt: serverTimestamp() }, { merge: true }); setToast({ message: "Bobot penilaian berhasil disimpan.", tone: "success" }); }
    catch { setToast({ message: "Bobot penilaian gagal disimpan.", tone: "error" }); } finally { setSaving(false); }
  }
  async function saveManualGrade() {
    const student = students.find((item) => item.id === form.studentId); const type = manualTypes.find((item) => item.value === form.assessmentType); const score = Number(form.score);
    if (!student || !type || !form.subject.trim() || !form.name.trim() || !Number.isFinite(score) || score < 0 || score > 100) { setToast({ message: "Lengkapi siswa, mata pelajaran, nama penilaian, dan nilai 0-100.", tone: "error" }); return; }
    const payload: Omit<ManualGrade, "id"> = { className: student.className, subject: form.subject.trim(), category: type.category, assessmentType: type.value, name: form.name.trim(), studentId: student.id, studentName: student.name, nis: student.nis, score, notes: form.notes.trim(), createdAtMs: Date.now() };
    setSaving(true);
    try { if (!demo && user) await addDoc(collection(db, "users", user.uid, "manualGrades"), { ...payload, createdAt: serverTimestamp() }); else setManualGrades((current) => [{ id: crypto.randomUUID(), ...payload }, ...current]); setForm((current) => ({ ...current, name: "", score: "", notes: "" })); setToast({ message: "Nilai manual berhasil disimpan.", tone: "success" }); }
    catch { setToast({ message: "Nilai manual gagal disimpan.", tone: "error" }); } finally { setSaving(false); }
  }
  async function removeManualGrade(item: ManualGrade) {
    try { if (!demo && user) await deleteDoc(doc(db, "users", user.uid, "manualGrades", item.id)); else setManualGrades((current) => current.filter((grade) => grade.id !== item.id)); setToast({ message: "Nilai manual dihapus.", tone: "success" }); }
    catch { setToast({ message: "Nilai manual gagal dihapus.", tone: "error" }); }
  }
  function exportExcel() {
    const headers = ["Nama siswa", "NIS", ...activeCategories.map((item) => item.label + " (" + weights[item.key].weight + "%)"), "Rata-rata Kuis", "Nilai akhir"];
    const lines = [headers, ...rows.map((row) => [row.student.name, row.student.nis, ...activeCategories.map((item) => row.categoryScores[item.key]?.toFixed(1) ?? ""), row.cbtAverage?.toFixed(1) ?? "", row.finalScore?.toFixed(1) ?? ""])];
    const csv = "\uFEFF" + lines.map((line) => line.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "rekap-nilai-" + (selectedClass || "kelas") + ".csv"; link.click(); URL.revokeObjectURL(url);
  }
  const dashboardContent = <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {([{ Icon: Users, label: "Jumlah siswa", value: classStudents.length }, { Icon: BarChart3, label: "Nilai tertinggi", value: finalScores.length ? Math.max(...finalScores).toFixed(1) : "-" }, { Icon: BarChart3, label: "Nilai terendah", value: finalScores.length ? Math.min(...finalScores).toFixed(1) : "-" }, { Icon: ListChecks, label: "Rata-rata kelas", value: classAverage === null ? "-" : classAverage.toFixed(1) }, { Icon: PencilLine, label: "Kuis selesai", value: attempts.filter((item) => item.className === (selectedClass || classNames[0])).length }, { Icon: Settings, label: "Belum selesai", value: unfinishedAssessments }]).map(({ Icon, label, value }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Icon className="text-teal-600" size={20}/><p className="mt-3 text-2xl font-black">{String(value)}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{label}</p></div>)}
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Rata-rata per mata pelajaran</h3><div className="mt-4 space-y-3">{subjectAverages.length ? subjectAverages.map((item) => <div key={item.subject}><div className="mb-1 flex justify-between text-xs font-bold"><span>{item.subject}</span><span>{item.value?.toFixed(1)}</span></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.min(100, item.value ?? 0)}%` }}/></div></div>) : <EmptyState message="Belum ada nilai untuk ditampilkan pada dasbor."/>}</div></section>
  </div>;
  const studentContent = <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Daftar siswa</h3><div className="relative mt-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15}/><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Cari nama atau NIS" className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm"/></div><div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">{visibleStudents.length ? visibleStudents.map((student) => <button key={student.id} onClick={() => setSelectedStudentId(student.id)} className={"w-full rounded-xl border px-4 py-3 text-left " + (selectedStudent?.id === student.id ? "border-teal-500 bg-teal-50" : "border-slate-100 hover:bg-slate-50")}><p className="text-sm font-black">{student.name}</p><p className="mt-1 text-[10px] text-slate-400">NIS {student.nis} - {student.className}</p></button>) : <EmptyState message="Belum ada siswa pada kelas ini."/>}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{selectedStudent ? <><div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-xl font-black">{selectedStudent.name}</h3><p className="mt-1 text-xs text-slate-500">NIS {selectedStudent.nis} - {selectedStudent.className}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black"><Printer size={14}/>Cetak PDF</button><button onClick={exportExcel} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"><Download size={14}/>Ekspor Excel</button><button onClick={() => void navigator.clipboard.writeText(`Rekap nilai ${selectedStudent.name}`).then(() => setToast({ message: "Teks berbagi rekap nilai disalin.", tone: "success" }))} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><Share2 size={14}/>Bagikan</button></div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px]"><thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-400"><tr><th className="px-4 py-3">Mata Pelajaran</th><th className="px-4 py-3">Nilai</th></tr></thead><tbody className="divide-y divide-slate-100">{studentSubjectRows.map((row) => <tr key={row.subject}><td className="px-4 py-3 text-sm font-bold">{row.subject}</td><td className="px-4 py-3"><span className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-black text-teal-700">{row.score === null ? "-" : row.score.toFixed(1)}</span></td></tr>)}</tbody></table></div><div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><MiniStat label="Rata-rata" value={average(selectedStudentScores)?.toFixed(1) ?? "-"}/><MiniStat label="Tertinggi" value={selectedStudentScores.length ? Math.max(...selectedStudentScores).toFixed(1) : "-"}/><MiniStat label="Terendah" value={selectedStudentScores.length ? Math.min(...selectedStudentScores).toFixed(1) : "-"}/><MiniStat label="Mata pelajaran" value={subjectNames.length}/><MiniStat label="Peringkat" value={selectedStudentRank ? `#${selectedStudentRank}` : "-"}/></div></> : <EmptyState message="Pilih siswa untuk melihat rekap nilai."/>}</section></div>;
  const subjectContent = <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-black">{effectiveSelectedSubject || "Mata pelajaran"}</h3><p className="mt-1 text-xs text-slate-500">Nilai siswa berdasarkan mata pelajaran dan kelas terpilih.</p></div><div className="flex flex-wrap gap-2"><select value={effectiveSelectedSubject} onChange={(event) => setSelectedSubject(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold" aria-label="Pilih mata pelajaran">{subjectNames.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><option value="highest">Urut nilai tertinggi</option><option value="lowest">Urut nilai terendah</option><option value="name">Urut nama siswa</option></select><button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black"><Printer size={14}/>Ekspor PDF</button><button onClick={exportExcel} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"><Download size={14}/>Ekspor Excel</button></div></div><div className="relative mt-4 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15}/><input value={subjectSearch} onChange={(event) => setSubjectSearch(event.target.value)} placeholder="Cari nama siswa" className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm"/></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-400"><tr><th className="px-5 py-3">Nama Siswa</th><th className="px-4 py-3">NIS</th><th className="px-4 py-3">Kelas</th><th className="px-5 py-3">Nilai</th></tr></thead><tbody className="divide-y divide-slate-100">{subjectRows.length ? subjectRows.map((row) => <tr key={row.student.id}><td className="px-5 py-4 text-sm font-extrabold">{row.student.name}</td><td className="px-4 py-4 text-xs text-slate-500">{row.student.nis}</td><td className="px-4 py-4 text-xs font-bold">{row.student.className}</td><td className="px-5 py-4"><span className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-black text-teal-700">{row.score === null ? "-" : row.score.toFixed(1)}</span></td></tr>) : <tr><td colSpan={4}><EmptyState message="Belum ada nilai pada mata pelajaran ini."/></td></tr>}</tbody></table></div></section>;
  const settingsContent = <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-black">Pengaturan penilaian</h3><p className="mt-1 text-xs text-slate-500">Centang komponen yang digunakan lalu tentukan persentasenya.</p></div><span className={"rounded-xl px-4 py-2 text-sm font-black " + (totalWeight === 100 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>Total {totalWeight}%</span></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{categories.map((item) => <div key={item.key} className={"flex items-center gap-4 rounded-2xl border p-4 " + (weights[item.key].enabled ? "border-teal-200 bg-teal-50/40" : "border-slate-200")}>
      <button aria-label={"Aktifkan " + item.label} onClick={() => setWeights((current) => ({ ...current, [item.key]: { enabled: !current[item.key].enabled, weight: !current[item.key].enabled ? current[item.key].weight : 0 } }))} className={"grid h-6 w-6 shrink-0 place-items-center rounded-md border " + (weights[item.key].enabled ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 text-transparent")}><Check size={15}/></button>
      <div className="min-w-0 flex-1"><p className="text-sm font-black">{item.label}</p><p className="mt-1 text-[11px] text-slate-400">{item.description}</p></div>
      <div className="relative w-24"><input disabled={!weights[item.key].enabled} type="number" min="0" max="100" value={weights[item.key].weight} onChange={(event) => setWeights((current) => ({ ...current, [item.key]: { ...current[item.key], weight: Math.max(0, Math.min(100, Number(event.target.value))) } }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-right text-sm font-black outline-none disabled:bg-slate-100 disabled:text-slate-400"/><span className="absolute right-3 top-3 text-xs font-bold text-slate-400">%</span></div>
    </div>)}</div>
    <p className="mt-4 text-xs leading-5 text-slate-500">Saran awal: Tugas 15%, Kuis 15%, Ulangan 25%, PTS/STS 20%, PAS/SAS 25%. Bobot dapat disesuaikan dengan kebijakan sekolah.</p>
    <button disabled={saving || totalWeight !== 100} onClick={() => void saveWeights()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white disabled:opacity-40">{saving ? <Loader2 className="animate-spin" size={16}/> : <Check size={16}/>}Simpan bobot</button>
  </section>;
  const manualContent = <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h3 className="font-black">Tambah nilai manual</h3><p className="mt-1 text-xs text-slate-500">Untuk PAS, PTS, praktik, lisan, hafalan, presentasi, atau tugas offline.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label><FieldLabel>Kelas</FieldLabel><select value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value, studentId: "" }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{classNames.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><FieldLabel>Mata pelajaran</FieldLabel><select value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{subjectNames.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><FieldLabel>Jenis nilai</FieldLabel><select value={form.assessmentType} onChange={(event) => setForm((current) => ({ ...current, assessmentType: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{manualTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><FieldLabel>Nama penilaian / kegiatan</FieldLabel><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Contoh: Praktik Bab 1" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>Siswa</FieldLabel><select value={form.studentId} onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Pilih siswa</option>{manualStudents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.nis}</option>)}</select></label>
        <label><FieldLabel>Nilai</FieldLabel><input type="number" min="0" max="100" value={form.score} onChange={(event) => setForm((current) => ({ ...current, score: event.target.value }))} placeholder="0–100" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>Keterangan</FieldLabel><input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Opsional" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
      </div>
      <button disabled={saving} onClick={() => void saveManualGrade()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>}Simpan nilai manual</button>
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h3 className="font-black">Daftar nilai manual</h3><p className="mt-1 text-xs text-slate-400">{manualGrades.length} nilai tersimpan</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Siswa</th><th className="px-4 py-3">Mata Pelajaran</th><th className="px-4 py-3">Jenis</th><th className="px-4 py-3">Nama</th><th className="px-4 py-3">Nilai</th><th className="px-4 py-3">Keterangan</th><th className="px-5 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{manualGrades.length ? manualGrades.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="text-sm font-extrabold">{item.studentName}</p><p className="text-[10px] text-slate-400">{item.nis} · {item.className}</p></td><td className="px-4 py-4 text-xs font-bold">{item.subject || "Mata Pelajaran"}</td><td className="px-4 py-4 text-xs font-bold">{manualTypes.find((type) => type.value === item.assessmentType)?.label ?? categories.find((type) => type.key === item.category)?.label}</td><td className="px-4 py-4 text-xs">{item.name}</td><td className="px-4 py-4 text-base font-black">{item.score}</td><td className="px-4 py-4 text-xs text-slate-500">{item.notes || "—"}</td><td className="px-5 py-4 text-right"><button onClick={() => void removeManualGrade(item)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16}/></button></td></tr>) : <tr><td colSpan={7} className="px-5 py-12 text-center text-sm font-bold text-slate-400">Belum ada nilai manual.</td></tr>}</tbody></table></div></section>
  </div>;
  const recapContent = <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="font-black">Rekap Nilai</h3><p className="mt-1 text-xs text-slate-500">Nilai akhir mengikuti bobot aktif pada Semester {academic.semester}.</p></div><div className="flex flex-wrap gap-2"><span className="rounded-xl bg-teal-50 px-4 py-2.5 text-xs font-black text-teal-700">Rata-rata kelas: {classAverage === null ? "—" : classAverage.toFixed(1)}</span><button onClick={exportExcel} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white"><Download size={15}/>Ekspor Excel</button></div></div>
      <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-5"><label className="min-w-52"><FieldLabel>Kelas</FieldLabel><select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">{classNames.map((item) => <option key={item}>{item}</option>)}</select></label><button onClick={() => setToast({ message: "Hasil ujian tersinkron otomatis secara real-time.", tone: "success" })} className="mt-auto flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-slate-600"><RefreshCcw size={15}/>Ambil ujian</button><span className="mt-auto rounded-xl bg-slate-100 px-4 py-3 text-xs font-black text-slate-600">KKM {academic.kkm}</span></div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="sticky left-0 bg-slate-50 px-5 py-3">Nama siswa</th><th className="px-4 py-3">NIS</th>{activeCategories.map((item) => <th key={item.key} className="min-w-32 px-4 py-3">{item.label} ({weights[item.key].weight}%)</th>)}<th className="px-4 py-3">Rata-rata Kuis</th><th className="px-5 py-3">Nilai akhir</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.length ? rows.map((row) => <tr key={row.student.id}><td className="sticky left-0 bg-white px-5 py-4 text-sm font-extrabold">{row.student.name}</td><td className="px-4 py-4 text-xs text-slate-500">{row.student.nis}</td>{activeCategories.map((item) => <td key={item.key} className="px-4 py-4 text-sm font-bold">{row.categoryScores[item.key] === null ? "—" : row.categoryScores[item.key]?.toFixed(1)}</td>)}<td className="px-4 py-4 text-sm font-bold">{row.cbtAverage === null ? "—" : row.cbtAverage.toFixed(1)}</td><td className="px-5 py-4"><span className={"rounded-lg px-3 py-2 text-sm font-black " + (row.finalScore === null ? "bg-slate-100 text-slate-400" : row.finalScore >= academic.kkm ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{row.finalScore === null ? "—" : row.finalScore.toFixed(1)}</span></td></tr>) : <tr><td colSpan={activeCategories.length + 4} className="px-5 py-12 text-center text-sm font-bold text-slate-400">Belum ada siswa di kelas ini.</td></tr>}</tbody></table></div><div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-[11px] leading-5 text-slate-500">Kategori yang belum memiliki nilai diabaikan sementara. Setelah nilainya masuk, bobot aktif otomatis ikut dihitung.</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">5 ujian terakhir</h3><div className="mt-4 space-y-2">{latestExams.length ? latestExams.map((exam) => <div key={exam.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"><div><p className="text-sm font-extrabold">{exam.title}</p><p className="mt-1 text-[10px] text-slate-400">{exam.subject || "Mata pelajaran"} · {exam.className}</p></div><span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-black uppercase text-slate-500">{exam.status || "draft"}</span></div>) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">Belum ada ujian untuk kelas ini.</p>}</div></section>
  </div>;
  return <div>
    <div className="mb-6"><p className="text-[11px] font-black uppercase tracking-[.16em] text-teal-600">Evaluasi</p><h2 className="mt-1 text-2xl font-black">Rekap Nilai</h2><p className="mt-1 text-sm text-slate-500">Gabungkan nilai aplikasi dan penilaian offline dalam satu perhitungan.</p></div>
    <div className="mb-6 grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-5">
      {[["dashboard", BarChart3, "Dasbor Nilai"], ["student", Users, "Per Siswa"], ["subject", ListChecks, "Per Mata Pelajaran"], ["manual", PencilLine, "Input Nilai"], ["settings", Settings, "Bobot"]].map(([key, Icon, label]) => <button key={String(key)} onClick={() => setTab(key as typeof tab)} className={"flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-extrabold transition " + (tab === key ? "bg-teal-600 text-white shadow" : "text-slate-500 hover:bg-slate-50")}><Icon size={16}/>{String(label)}</button>)}
    </div>
    {tab === "dashboard" ? dashboardContent : tab === "student" ? studentContent : tab === "subject" ? subjectContent : tab === "settings" ? settingsContent : tab === "manual" ? manualContent : recapContent}
  </div>;
}

function EmptyState({ message }: { message: string }) { return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm font-bold text-slate-400">{message}</div>; }
function MiniStat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>; }
export function AcademicView({ user, demo, students, setToast }: CommonProps) {
  const studentClasses = useMemo(() => Array.from(new Set(students.map((item) => item.className).filter(Boolean))).sort(), [students]);
  const initialClasses = studentClasses.length ? studentClasses : defaultAcademic.classNames;
  const [form, setForm] = useState({ ...defaultAcademic, classNames: initialClasses });
  const [classText, setClassText] = useState(initialClasses.join(", "));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (demo || !user) return;
    return onSnapshot(doc(db, "users", user.uid, "settings", "academic"), (snapshot) => {
      if (!snapshot.exists()) return;
      const next = normalizeAcademic(snapshot.data() as Partial<AcademicSettings>);
      setForm(next); setClassText(next.classNames.join(", "));
    });
  }, [user, demo]);
  async function saveAcademic() {
    const classNames = Array.from(new Set(classText.split(",").map((item) => item.trim()).filter(Boolean)));
    if (!form.schoolName.trim() || !form.academicYear.trim() || !classNames.length || form.kkm < 0 || form.kkm > 100) { setToast({ message: "Lengkapi sekolah, tahun ajaran, kelas, dan KKM 0–100.", tone: "error" }); return; }
    const payload = { ...form, schoolName: form.schoolName.trim(), academicYear: form.academicYear.trim(), classNames };
    setSaving(true);
    try {
      if (!demo && user) {
        await setDoc(doc(db, "users", user.uid, "settings", "academic"), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
        await updateDoc(doc(db, "users", user.uid), { schoolName: payload.schoolName, updatedAt: serverTimestamp() });
      }
      setForm(payload); setClassText(classNames.join(", ")); setToast({ message: "Data akademik aktif berhasil disimpan.", tone: "success" });
    } catch { setToast({ message: "Data akademik gagal disimpan.", tone: "error" }); } finally { setSaving(false); }
  }
  return <div>
    <div className="mb-6"><p className="text-[11px] font-black uppercase tracking-[.16em] text-teal-600">Konfigurasi</p><h2 className="mt-1 text-2xl font-black">Data Akademik</h2><p className="mt-1 text-sm text-slate-500">Atur identitas sekolah, periode, kelas aktif, jam masuk, dan KKM.</p></div>
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[[School, "Sekolah utama", form.schoolName], [GraduationCap, "Periode aktif", form.academicYear + " · " + form.semester], [ListChecks, "Kelas aktif", form.classNames.length + " kelas"], [Settings, "KKM", String(form.kkm)]].map(([Icon, label, value]) => <div key={String(label)} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={21}/></div><div><p className="text-[10px] font-bold text-slate-400">{String(label)}</p><p className="mt-1 text-sm font-black">{String(value)}</p></div></div>)}
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center gap-3 border-b border-slate-100 pb-5"><div className="rounded-xl bg-teal-50 p-3 text-teal-700"><School size={20}/></div><div><h3 className="font-black">Pengaturan aktif</h3><p className="mt-1 text-xs text-slate-400">Perubahan langsung dipakai pada header dan Rekap Nilai.</p></div></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label><FieldLabel>Nama sekolah</FieldLabel><input value={form.schoolName} onChange={(event) => setForm((current) => ({ ...current, schoolName: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>Tahun ajaran</FieldLabel><input value={form.academicYear} onChange={(event) => setForm((current) => ({ ...current, academicYear: event.target.value }))} placeholder="2026/2027" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>Semester</FieldLabel><select value={form.semester} onChange={(event) => setForm((current) => ({ ...current, semester: event.target.value === "Genap" ? "Genap" : "Ganjil" }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option>Ganjil</option><option>Genap</option></select></label>
        <label><FieldLabel>Kelas aktif (pisahkan dengan koma)</FieldLabel><input value={classText} onChange={(event) => setClassText(event.target.value)} placeholder="VII A, VII B" className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>Jam masuk</FieldLabel><input type="time" value={form.entryTime} onChange={(event) => setForm((current) => ({ ...current, entryTime: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
        <label><FieldLabel>KKM</FieldLabel><input type="number" min="0" max="100" value={form.kkm} onChange={(event) => setForm((current) => ({ ...current, kkm: Number(event.target.value) }))} className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-teal-500"/></label>
      </div>
      <button disabled={saving} onClick={() => void saveAcademic()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16}/> : <Check size={16}/>}Simpan data akademik</button>
    </section>
  </div>;
}
