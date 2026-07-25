"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { CheckCircle2, Loader2, School, ShieldCheck } from "lucide-react";
import { auth, db } from "../lib/firebase";

type Invite = {
  schoolId: string;
  schoolName: string;
  schoolLevel: "SD" | "SMP" | "SMA" | "SMK";
  primarySubjectIds?: string[];
  additionalSubjectIds?: string[];
  subjects?: { id: string; name: string; code?: string }[];
  status?: "open" | "closed";
};

function Input({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-xs font-black text-slate-700">{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" /></label>;
}

export function PublicTeacherRegistration() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const schoolId = decodeURIComponent(parts.at(-2) || "");
  const inviteId = decodeURIComponent(parts.at(-1) || "");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [willingCrossSubject, setWillingCrossSubject] = useState(false);

  useEffect(() => {
    if (!schoolId || !inviteId) { setError("Link pendaftaran guru tidak lengkap."); setLoading(false); return; }
    void getDoc(doc(db, "schools", schoolId, "teacherInvites", inviteId)).then((snapshot) => {
      if (!snapshot.exists()) throw new Error("Link pendaftaran guru tidak ditemukan.");
      const data = snapshot.data() as Invite;
      if (data.status === "closed") throw new Error("Link pendaftaran ini sudah ditutup oleh admin sekolah.");
      setInvite({ ...data, schoolId });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Link pendaftaran tidak dapat dibuka.")).finally(() => setLoading(false));
  }, [schoolId, inviteId]);

  const primarySubjects = useMemo(() => invite?.primarySubjectIds || [], [invite]);
  const additionalSubjects = useMemo(() => invite?.additionalSubjectIds || [], [invite]);
  const subjectName = (id: string) => invite?.subjects?.find((subject) => subject.id === id)?.name || id;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invite) return;
    if (password.length < 6) { setError("Password minimal 6 karakter."); return; }
    if (password !== confirmation) { setError("Konfirmasi password tidak sama."); return; }
    setBusy(true); setError("");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const userPayload = {
        accountType: "school", role: "teacher", schoolRole: "teacher", schoolId: invite.schoolId,
        schoolLevel: invite.schoolLevel, name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(),
        subjectIds: [...new Set([...primarySubjects, ...(willingCrossSubject ? additionalSubjects : [])])],
        primarySubjectIds: primarySubjects, additionalSubjectIds: willingCrossSubject ? additionalSubjects : [],
        assignedClassIds: [], assignedClassNames: [], status: "pending", disabled: false, pendingApproval: true,
        inviteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, "users", credential.user.uid), userPayload);
      batch.set(doc(db, "schools", invite.schoolId, "members", credential.user.uid), {
        uid: credential.user.uid, role: "teacher", schoolRole: "teacher", name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(),
        schoolLevel: invite.schoolLevel, subjectIds: userPayload.subjectIds, primarySubjectIds: primarySubjects,
        additionalSubjectIds: userPayload.additionalSubjectIds, assignedClassIds: [], assignedClassNames: [], active: false,
        pendingApproval: true, inviteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await batch.commit();
      await signOut(auth).catch(() => undefined);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace("Firebase: ", "").replace(/\(auth\/.+\)\.?/, "") : "Pendaftaran guru gagal.");
    } finally { setBusy(false); }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50"><Loader2 className="animate-spin text-teal-600" size={34}/></main>;
  if (done) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl border border-emerald-100 bg-white p-8 text-center shadow-xl"><CheckCircle2 className="mx-auto text-emerald-600" size={56}/><h1 className="mt-5 text-2xl font-black">Pendaftaran terkirim</h1><p className="mt-3 text-sm leading-6 text-slate-500">Akun guru Anda sudah dibuat sebagai pengajuan. Tunggu Kepala Sekolah/TU mengaktifkan akun dan menetapkan kelas.</p><a href="/" className="mt-6 inline-flex rounded-xl bg-teal-600 px-5 py-3 text-xs font-black text-white">Kembali ke SMART-ATT</a></section></main>;
  if (error && !invite) return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl"><ShieldCheck className="mx-auto text-rose-600" size={45}/><h1 className="mt-5 text-xl font-black">Link tidak dapat digunakan</h1><p className="mt-3 text-sm text-slate-500">{error}</p></section></main>;
  if (!invite) return null;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dff9f3,transparent_35%),linear-gradient(135deg,#f8fbff,#fff9ed)] p-5 sm:p-8"><section className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"><header className="bg-[#07363b] p-7 text-white"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><School size={23}/></div><div><p className="text-lg font-black">SMART-ATT</p><p className="text-xs text-teal-200">Pendaftaran Guru Sekolah</p></div></div><h1 className="mt-7 text-2xl font-black">Bergabung dengan {invite.schoolName}</h1><p className="mt-2 text-sm text-slate-300">Jenjang {invite.schoolLevel} · Kurikulum default 2026</p></header><form onSubmit={submit} className="space-y-4 p-7"><Input label="Nama lengkap" value={name} onChange={setName} required/><Input label="Email" type="email" value={email} onChange={setEmail} required/><Input label="Nomor WhatsApp" value={phone} onChange={setPhone}/><Input label="Password" type="password" value={password} onChange={setPassword} required/><Input label="Konfirmasi password" type="password" value={confirmation} onChange={setConfirmation} required/><section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black">Bidang yang disiapkan admin</p><p className="mt-2 text-xs text-slate-500">Mapel utama: {primarySubjects.map(subjectName).join(", ") || "Belum ditentukan"}</p>{additionalSubjects.length > 0 && <label className="mt-3 flex items-start gap-2 text-xs font-bold"><input type="checkbox" checked={willingCrossSubject} onChange={(event) => setWillingCrossSubject(event.target.checked)} className="mt-0.5 accent-teal-600"/>Saya bersedia membantu mengajar mapel lain yang disetujui sekolah: {additionalSubjects.map(subjectName).join(", ")}</label>}</section>{error && <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}<button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-black text-white disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={17}/>}Kirim pendaftaran guru</button><p className="text-center text-[10px] leading-4 text-slate-400">Akun baru aktif setelah disetujui admin sekolah dan kelas mengajar ditetapkan.</p></form></section></main>;
}
