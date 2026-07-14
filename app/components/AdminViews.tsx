"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Ban, CheckCircle2, Clock3, KeyRound, LayoutDashboard, Loader2,
  LogOut, Plus, RefreshCcw, School, Search, ShieldCheck, Trash2, UserCheck, Users,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  collection, collectionGroup, deleteDoc, doc, getDocs, onSnapshot, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

type Toast = { message: string; tone: "success" | "error" } | null;
type Account = {
  id: string;
  email?: string;
  name?: string;
  schoolName?: string;
  role?: string;
  status?: string;
  disabled?: boolean;
  createdAt?: { toMillis?: () => number } | null;
  trialEndsAt?: { toMillis?: () => number } | null;
  activeUntilMs?: number;
  activeTokenId?: string;
  tokenActivatedAtMs?: number;
  lastLoginAtMs?: number;
  lastSeenAtMs?: number;
};
type ActivationToken = {
  id: string;
  code: string;
  durationDays: number;
  status: "active" | "used" | "disabled" | "expired";
  createdAtMs: number;
  tokenExpiresAtMs: number;
  usedAtMs?: number;
  usedBy?: string;
  usedByEmail?: string;
  accountExpiresAtMs?: number;
};
type ProfileStudent = { id: string; className: string };
type ClassDraft = { id: string; original: string | null; name: string };

function Logo() {
  return <div className="flex items-center gap-3"><img src="/logo.png" alt="Logo SMART-ATT" className="h-11 w-11 rounded-xl object-cover"/><div><p className="text-sm font-black tracking-wide">SMART-ATT</p><p className="text-[10px] text-slate-400">Super Admin Control Center</p></div></div>;
}

function dateTime(value?: number) {
  return value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function accountExpiry(account: Account) {
  return account.activeUntilMs ?? account.trialEndsAt?.toMillis?.() ?? 0;
}

function accountStatus(account: Account, now: number) {
  if (account.disabled || account.status === "disabled") return "disabled";
  const expiry = accountExpiry(account);
  if (expiry && expiry <= now) return "expired";
  if (account.activeUntilMs && account.activeUntilMs > now) return "active";
  if (account.status === "trial" && expiry > now) return "trial";
  return account.status === "active" ? "active" : "expired";
}

export function SuperAdminProfessional({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"dashboard" | "users" | "tokens" | "monitor">("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tokens, setTokens] = useState<ActivationToken[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [durationDays, setDurationDays] = useState("30");
  const [generated, setGenerated] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(interval); }, []);
  useEffect(() => onSnapshot(collection(db, "users"), (snapshot) => {
    const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Account));
    next.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)); setAccounts(next);
  }, () => setError("Daftar user belum dapat dibaca. Pastikan rules super admin sudah diterapkan.")), []);
  useEffect(() => onSnapshot(collection(db, "activationTokens"), (snapshot) => {
    const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ActivationToken));
    next.sort((a, b) => b.createdAtMs - a.createdAtMs); setTokens(next);
  }, () => setError("Riwayat token belum dapat dibaca.")), []);
  useEffect(() => onSnapshot(collectionGroup(db, "students"), (snapshot) => setStudentCount(snapshot.size), () => setError("Total siswa belum dapat dihitung.")), []);

  const teacherAccounts = accounts.filter((item) => item.role !== "superadmin");
  const schools = new Set(teacherAccounts.map((item) => item.schoolName?.trim()).filter(Boolean));
  const activeUsers = teacherAccounts.filter((item) => accountStatus(item, now) === "active" || accountStatus(item, now) === "trial");
  const onlineUsers = teacherAccounts.filter((item) => (item.lastSeenAtMs ?? 0) >= now - 120000);
  const activeTokens = tokens.filter((item) => item.status === "active" && item.tokenExpiresAtMs > now);
  const filteredAccounts = teacherAccounts.filter((item) => `${item.name ?? ""} ${item.email ?? ""} ${item.schoolName ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  async function generateToken() {
    const days = Math.max(1, Math.min(365, Number(durationDays) || 30));
    const code = `SATT-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    setBusy("generate"); setError("");
    try {
      const createdAtMs = Date.now();
      await setDoc(doc(db, "activationTokens", code), { code, durationDays: days, status: "active", createdAtMs, tokenExpiresAtMs: createdAtMs + 90 * 86400000, tokenExpiresAt: new Date(createdAtMs + 90 * 86400000), createdAt: serverTimestamp() });
      setGenerated(code);
    } catch { setError("Token gagal dibuat."); }
    finally { setBusy(""); }
  }

  async function disableToken(token: ActivationToken) {
    setBusy(token.id);
    try { await updateDoc(doc(db, "activationTokens", token.id), { status: "disabled", disabledAtMs: Date.now(), updatedAt: serverTimestamp() }); }
    catch { setError("Token gagal dinonaktifkan."); }
    finally { setBusy(""); }
  }
  async function removeToken(token: ActivationToken) {
    if (!window.confirm(`Hapus token ${token.code}?`)) return;
    setBusy(token.id);
    try { await deleteDoc(doc(db, "activationTokens", token.id)); }
    catch { setError("Token gagal dihapus."); }
    finally { setBusy(""); }
  }
  async function toggleAccount(account: Account) {
    const disabled = !(account.disabled || account.status === "disabled");
    setBusy(account.id);
    try { await updateDoc(doc(db, "users", account.id), { disabled, status: disabled ? "disabled" : (account.activeUntilMs && account.activeUntilMs > Date.now() ? "active" : "trial"), updatedAt: serverTimestamp() }); }
    catch { setError("Status akun gagal diperbarui."); }
    finally { setBusy(""); }
  }

  const nav = [
    { key: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { key: "users" as const, label: "Manajemen User", icon: Users },
    { key: "tokens" as const, label: "Manajemen Token", icon: KeyRound },
    { key: "monitor" as const, label: "Monitoring", icon: Activity },
  ];
  return <main className="min-h-screen bg-[#f4f7f9] text-slate-900"><header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex min-h-20 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-7"><Logo/><div className="flex items-center gap-2"><span className="hidden rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black text-white sm:block">SUPER ADMIN</span><button onClick={onLogout} aria-label="Keluar" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><LogOut size={18}/></button></div></div></header><div className="mx-auto grid max-w-[1500px] gap-5 p-4 sm:p-7 lg:grid-cols-[250px_1fr]"><aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-24"><nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">{nav.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => setTab(item.key)} className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-xs font-extrabold ${tab === item.key ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={17}/>{item.label}</button>; })}</nav></aside><section className="min-w-0"><div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Control Center</p><h1 className="mt-1 text-2xl font-black">{nav.find((item) => item.key === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">Data real-time dari Firebase seluruh tenant SMART-ATT.</p></div>{error&&<div className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</div>}
      {tab === "dashboard"&&<><div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><AdminStat label="Total sekolah" value={schools.size} icon={School} tone="bg-violet-50 text-violet-600"/><AdminStat label="Total guru" value={teacherAccounts.length} icon={Users} tone="bg-sky-50 text-sky-600"/><AdminStat label="Total siswa" value={studentCount} icon={UserCheck} tone="bg-teal-50 text-teal-600"/><AdminStat label="User aktif" value={activeUsers.length} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600"/><AdminStat label="Token aktif" value={activeTokens.length} icon={KeyRound} tone="bg-amber-50 text-amber-600"/></div><div className="mt-5 grid gap-5 xl:grid-cols-2"><Panel title="Aktivitas login terbaru" description="Urut berdasarkan login terakhir."><div className="space-y-2">{[...teacherAccounts].sort((a, b) => (b.lastLoginAtMs ?? 0) - (a.lastLoginAtMs ?? 0)).slice(0, 8).map((account) => <ActivityRow key={account.id} account={account} now={now}/>)}</div></Panel><Panel title="Ringkasan token" description="Status semua token aktivasi."><div className="grid grid-cols-2 gap-3"><MiniStat label="Aktif" value={activeTokens.length}/><MiniStat label="Digunakan" value={tokens.filter((item) => item.status === "used").length}/><MiniStat label="Expired" value={tokens.filter((item) => item.status === "expired" || item.tokenExpiresAtMs <= now).length}/><MiniStat label="Disabled" value={tokens.filter((item) => item.status === "disabled").length}/></div></Panel></div></>}
      {tab === "users"&&<><div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><Search size={17} className="text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, email, atau sekolah..." className="min-w-0 flex-1 text-sm outline-none"/></div><div className="space-y-3 sm:hidden">{filteredAccounts.map((account) => <AccountCard key={account.id} account={account} now={now} busy={busy === account.id} onToggle={() => void toggleAccount(account)}/>)}</div><section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:block"><div className="overflow-x-auto"><table className="w-full min-w-[1050px]"><thead className="bg-slate-50 text-left text-[9px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Admin</th><th className="px-4 py-3">Sekolah</th><th className="px-4 py-3">Tanggal daftar</th><th className="px-4 py-3">Status akun</th><th className="px-4 py-3">Status token</th><th className="px-4 py-3">Expired</th><th className="px-4 py-3">Login terakhir</th><th className="px-5 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredAccounts.map((account) => <tr key={account.id}><td className="px-5 py-4"><p className="text-sm font-black">{account.name || "Belum diisi"}</p><p className="text-[10px] text-slate-400">{account.email}</p></td><td className="px-4 py-4 text-xs font-bold">{account.schoolName || "—"}</td><td className="px-4 py-4 text-xs">{dateTime(account.createdAt?.toMillis?.())}</td><td className="px-4 py-4"><AccountBadge status={accountStatus(account, now)}/></td><td className="px-4 py-4 text-xs font-bold">{account.activeTokenId ? "Aktif" : "Belum ada"}</td><td className="px-4 py-4 text-xs">{dateTime(accountExpiry(account))}</td><td className="px-4 py-4 text-xs">{dateTime(account.lastLoginAtMs)}</td><td className="px-5 py-4"><button disabled={busy === account.id} onClick={() => void toggleAccount(account)} className={`rounded-lg px-3 py-2 text-[10px] font-black ${account.disabled ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{account.disabled ? "Aktifkan" : "Disable"}</button></td></tr>)}</tbody></table></div></section></>}
      {tab === "tokens"&&<><div className="grid gap-5 xl:grid-cols-[.6fr_1.4fr]"><Panel title="Generate token" description="Token satu kali pakai; valid dipakai selama 90 hari."><label className="block"><span className="mb-2 block text-xs font-extrabold">Durasi akun</span><select value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="1">1 hari</option><option value="14">14 hari</option><option value="30">1 bulan</option><option value="90">3 bulan</option><option value="365">1 tahun</option></select></label><button disabled={busy === "generate"} onClick={() => void generateToken()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white">{busy === "generate" ? <Loader2 className="animate-spin" size={17}/> : <RefreshCcw size={17}/>}Generate token</button>{generated&&<div className="mt-4 rounded-xl bg-slate-950 p-4 text-center"><p className="text-[9px] font-black text-slate-400">TOKEN BARU</p><p className="mt-2 break-all font-mono text-lg font-black text-teal-300">{generated}</p><button onClick={() => void navigator.clipboard.writeText(generated)} className="mt-3 text-[10px] font-black text-white">Salin token</button></div>}</Panel><Panel title="Riwayat token" description="Aktif, digunakan, expired, dan dinonaktifkan."><div className="max-h-[65vh] space-y-2 overflow-y-auto">{tokens.map((token) => <div key={token.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-mono text-xs font-black">{token.code}</p><p className="mt-1 text-[10px] text-slate-400">{token.durationDays} hari · dibuat {dateTime(token.createdAtMs)}</p></div><TokenBadge token={token} now={now}/></div>{token.usedByEmail&&<p className="mt-2 text-[10px] text-slate-500">Dipakai {token.usedByEmail} · {dateTime(token.usedAtMs)}</p>}<div className="mt-3 flex gap-2"><button disabled={token.status !== "active" || busy === token.id} onClick={() => void disableToken(token)} className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-2 text-[9px] font-black text-amber-700 disabled:opacity-40"><Ban size={12}/>Disable</button><button disabled={busy === token.id} onClick={() => void removeToken(token)} className="flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-2 text-[9px] font-black text-rose-700"><Trash2 size={12}/>Hapus</button></div></div>)}</div></Panel></div></>}
      {tab === "monitor"&&<><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><AdminStat label="User online" value={onlineUsers.length} icon={Activity} tone="bg-emerald-50 text-emerald-600"/><AdminStat label="User offline" value={Math.max(0, teacherAccounts.length - onlineUsers.length)} icon={Clock3} tone="bg-slate-100 text-slate-600"/><AdminStat label="Login hari ini" value={teacherAccounts.filter((item) => (item.lastLoginAtMs ?? 0) >= new Date().setHours(0, 0, 0, 0)).length} icon={UserCheck} tone="bg-sky-50 text-sky-600"/><AdminStat label="Aktivitas terbaru" value={teacherAccounts.filter((item) => (item.lastSeenAtMs ?? 0) >= now - 86400000).length} icon={RefreshCcw} tone="bg-violet-50 text-violet-600"/></div><Panel title="Monitoring user" description="Online dihitung dari heartbeat dua menit terakhir."><div className="mt-4 space-y-2">{[...teacherAccounts].sort((a, b) => (b.lastSeenAtMs ?? 0) - (a.lastSeenAtMs ?? 0)).map((account) => <ActivityRow key={account.id} account={account} now={now}/>)}</div></Panel></>}
    </section></div></main>;
}

export function ProfileProfessional({ user, demo, students, setToast }: { user: User | null; demo: boolean; students: ProfileStudent[]; setToast: (toast: Toast) => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState(demo ? "Tomi Guru" : "");
  const [school, setSchool] = useState(demo ? "SMP Harapan Bangsa" : "");
  const [phone, setPhone] = useState(demo ? "62812xxxx" : "");
  const [token, setToken] = useState("");
  const [classDrafts, setClassDrafts] = useState<ClassDraft[]>([]);
  const [newClass, setNewClass] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingClasses, setSavingClasses] = useState(false);
  const [activating, setActivating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const studentClassesKey = useMemo(() => Array.from(new Set(students.map((student) => student.className.trim()).filter(Boolean))).sort().join("\u0001"), [students]);
  const studentCounts = useMemo(() => students.reduce<Record<string, number>>((result, student) => {
    const className = student.className.trim();
    if (className) result[className] = (result[className] ?? 0) + 1;
    return result;
  }, {}), [students]);

  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    if (demo) { setAccount({ id: "demo", status: "trial", activeUntilMs: Date.now() + 7 * 86400000 }); return; }
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = { id: snapshot.id, ...snapshot.data() } as Account; setAccount(data);
      setName(data.name ?? ""); setSchool(data.schoolName ?? ""); setPhone((snapshot.data().phone as string | undefined) ?? "");
    }, () => setToast({ message: "Profil guru belum dapat dibaca.", tone: "error" }));
  }, [demo, user, setToast]);
  useEffect(() => {
    const studentClassNames = studentClassesKey ? studentClassesKey.split("\u0001") : [];
    const applyClasses = (configured: string[]) => {
      const merged = Array.from(new Set([...configured, ...studentClassNames].map(normalizeClassName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
      setClassDrafts(merged.map((className) => ({ id: crypto.randomUUID(), original: className, name: className })));
    };
    if (demo) { applyClasses(["VII A", "VII B"]); return; }
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid, "settings", "academic"), (snapshot) => {
      const configured = snapshot.exists() && Array.isArray(snapshot.data().classNames)
        ? snapshot.data().classNames.filter((item: unknown): item is string => typeof item === "string")
        : [];
      applyClasses(configured);
    }, () => setToast({ message: "Daftar kelas belum dapat dibaca.", tone: "error" }));
  }, [demo, user, studentClassesKey, setToast]);

  function normalizeClassName(value: string) { return value.trim().replace(/\s+/g, " "); }
  function addClass() {
    const className = normalizeClassName(newClass);
    if (!className) { setToast({ message: "Masukkan nama kelas, contoh V-A.", tone: "error" }); return; }
    if (classDrafts.some((item) => normalizeClassName(item.name).toLocaleLowerCase("id-ID") === className.toLocaleLowerCase("id-ID"))) {
      setToast({ message: `Kelas ${className} sudah ada.`, tone: "error" }); return;
    }
    setClassDrafts((current) => [...current, { id: crypto.randomUUID(), original: null, name: className }]);
    setNewClass("");
  }
  function removeClass(item: ClassDraft) {
    const used = item.original ? studentCounts[item.original] ?? 0 : 0;
    if (used) { setToast({ message: `Kelas ${item.original} masih dipakai ${used} siswa. Ubah namanya lalu simpan, atau pindahkan siswanya terlebih dahulu.`, tone: "error" }); return; }
    setClassDrafts((current) => current.filter((row) => row.id !== item.id));
  }

  async function saveProfile() {
    if (name.trim().length < 3) { setToast({ message: "Nama guru minimal 3 karakter.", tone: "error" }); return; }
    setSaving(true);
    try { if (!demo && user) await updateDoc(doc(db, "users", user.uid), { name: name.trim(), schoolName: school.trim(), phone: phone.trim(), updatedAt: serverTimestamp() }); setToast({ message: "Profil guru berhasil diperbarui.", tone: "success" }); }
    catch { setToast({ message: "Profil guru gagal disimpan.", tone: "error" }); }
    finally { setSaving(false); }
  }

  async function saveClasses() {
    const rows = classDrafts.map((item) => ({ ...item, name: normalizeClassName(item.name) }));
    const names = rows.map((item) => item.name).filter(Boolean);
    if (!names.length || names.length !== rows.length) { setToast({ message: "Nama kelas tidak boleh kosong.", tone: "error" }); return; }
    const uniqueNames = new Set(names.map((item) => item.toLocaleLowerCase("id-ID")));
    if (uniqueNames.size !== names.length) { setToast({ message: "Nama kelas tidak boleh sama.", tone: "error" }); return; }
    const renames = rows.filter((item): item is ClassDraft & { original: string } => Boolean(item.original && item.original !== item.name));
    setSavingClasses(true);
    try {
      if (!demo && user) {
        const collectionNames = ["students", "tasks", "exams", "attendanceSessions", "manualGrades"];
        for (const rename of renames) {
          const snapshots = await Promise.all(collectionNames.map((collectionName) => getDocs(query(collection(db, "users", user.uid, collectionName), where("className", "==", rename.original)))));
          const references = snapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.ref));
          for (let offset = 0; offset < references.length; offset += 400) {
            const batch = writeBatch(db);
            references.slice(offset, offset + 400).forEach((reference) => batch.update(reference, { className: rename.name, updatedAt: serverTimestamp() }));
            await batch.commit();
          }
        }
        await setDoc(doc(db, "users", user.uid, "settings", "academic"), { classNames: names, updatedAt: serverTimestamp() }, { merge: true });
      }
      setClassDrafts(rows.map((item) => ({ ...item, original: item.name })));
      setToast({ message: renames.length ? "Daftar kelas dan data terkait berhasil diperbarui." : "Daftar kelas berhasil disimpan.", tone: "success" });
    } catch { setToast({ message: "Daftar kelas gagal disimpan.", tone: "error" }); }
    finally { setSavingClasses(false); }
  }

  async function activateToken() {
    if (!user || demo) { setToast({ message: "Aktivasi token tersedia pada akun asli.", tone: "error" }); return; }
    const code = token.trim().toUpperCase();
    if (!code) { setToast({ message: "Masukkan token aktivasi.", tone: "error" }); return; }
    setActivating(true);
    try {
      await runTransaction(db, async (transaction) => {
        const tokenRef = doc(db, "activationTokens", code);
        const userRef = doc(db, "users", user.uid);
        const [tokenSnapshot, userSnapshot] = await Promise.all([transaction.get(tokenRef), transaction.get(userRef)]);
        if (!tokenSnapshot.exists()) throw new Error("Token tidak ditemukan.");
        const tokenData = tokenSnapshot.data() as ActivationToken;
        const currentMs = Date.now();
        if (tokenData.status !== "active") throw new Error(tokenData.status === "used" ? "Token sudah digunakan." : "Token tidak aktif.");
        if (tokenData.tokenExpiresAtMs <= currentMs) throw new Error("Token sudah kedaluwarsa.");
        const userData = userSnapshot.data() as Account | undefined;
        const base = Math.max(currentMs, userData?.activeUntilMs ?? userData?.trialEndsAt?.toMillis?.() ?? 0);
        const activeUntilMs = base + tokenData.durationDays * 86400000;
        transaction.update(tokenRef, { status: "used", usedBy: user.uid, usedByEmail: user.email ?? "", usedAtMs: currentMs, accountExpiresAtMs: activeUntilMs, usedAt: serverTimestamp() });
        transaction.update(userRef, { status: "active", disabled: false, activeTokenId: code, tokenActivatedAtMs: currentMs, activeUntilMs, updatedAt: serverTimestamp() });
      });
      setToken(""); setToast({ message: "Token berhasil diaktifkan dan masa akun telah diperpanjang.", tone: "success" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Aktivasi token gagal.", tone: "error" }); }
    finally { setActivating(false); }
  }

  const expiry = account ? accountExpiry(account) : 0;
  const remainingDays = expiry > now ? Math.ceil((expiry - now) / 86400000) : 0;
  const status = account ? accountStatus(account, now) : "expired";
  return <>
    <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Akun</p><h2 className="mt-1 text-2xl font-black">Profil & aktivasi token</h2><p className="mt-1 text-sm text-slate-500">Kelola identitas guru, kelas aktif, dan masa aktif akun.</p></div>
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Nama guru" value={name} onChange={setName}/><Input label="Email login" value={demo ? "tolimur@gmail.com" : user?.email ?? ""} disabled/><Input label="Nomor WhatsApp" value={phone} onChange={setPhone}/><Input label="Sekolah utama" value={school} onChange={setSchool}/></div>
        <button disabled={saving} onClick={() => void saveProfile()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white">{saving&&<Loader2 className="animate-spin" size={15}/>}Simpan profil</button>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Aktivasi token</p><h3 className="mt-1 text-xl font-black">Status akun</h3></div><AccountBadge status={status}/></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><MiniStat label="Tanggal aktif" value={account?.tokenActivatedAtMs ? new Date(account.tokenActivatedAtMs).toLocaleDateString("id-ID") : "—"}/><MiniStat label="Tanggal berakhir" value={expiry ? new Date(expiry).toLocaleDateString("id-ID") : "—"}/><div className="col-span-2"><MiniStat label="Sisa masa aktif" value={`${remainingDays} hari`}/></div></div>
        <label className="mt-5 block"><span className="mb-2 block text-xs font-extrabold">Input Token</span><input value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} placeholder="SATT-XXXXXXXXXXXX" className="h-12 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm uppercase outline-none focus:border-teal-500"/></label>
        <button disabled={activating || !token.trim()} onClick={() => void activateToken()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-xs font-extrabold text-white disabled:opacity-40">{activating ? <Loader2 className="animate-spin" size={16}/> : <ShieldCheck size={16}/>}Aktivasi</button>
      </section>
    </div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Kelas aktif</p><h3 className="mt-1 text-xl font-black">Kelola kelas</h3><p className="mt-1 text-xs leading-5 text-slate-500">Tambah kelas seperti V-A. Nama kelas juga dapat diedit langsung di bawah.</p></div><span className="w-fit rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-700">{classDrafts.length} kelas</span></div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row"><input value={newClass} onChange={(event) => setNewClass(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addClass(); } }} placeholder="Contoh: V-A" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-teal-500"/><button onClick={addClass} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-extrabold text-white"><Plus size={16}/>Tambah kelas</button></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{classDrafts.map((item) => {
        const used = item.original ? studentCounts[item.original] ?? 0 : 0;
        const changed = Boolean(item.original && normalizeClassName(item.name) !== item.original);
        return <div key={item.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-center gap-2"><input aria-label={`Nama kelas ${item.original ?? "baru"}`} value={item.name} onChange={(event) => setClassDrafts((current) => current.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row))} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-black outline-none focus:border-teal-500"/><button onClick={() => removeClass(item)} title={used ? "Kelas masih dipakai siswa" : "Hapus kelas"} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><Trash2 size={16}/></button></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]"><span className="font-bold text-slate-400">{used} siswa</span>{changed&&<span className="rounded-lg bg-amber-50 px-2 py-1 font-black text-amber-700">{item.original} → {normalizeClassName(item.name) || "?"}</span>}</div></div>;
      })}</div>
      {!classDrafts.length&&<div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm font-bold text-slate-400">Belum ada kelas. Tambahkan kelas pertama di atas.</div>}
      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-xs leading-5 text-slate-500">Saat nama kelas diubah, data siswa, tugas, ujian, absensi, dan nilai manual pada kelas tersebut ikut diperbarui.</p><button disabled={savingClasses} onClick={() => void saveClasses()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-xs font-extrabold text-white disabled:opacity-50">{savingClasses ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}Simpan kelas</button></div>
    </section>
  </>;
}
function AdminStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Users; tone: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon size={19}/></div><p className="mt-4 text-2xl font-black">{value}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{label}</p></div>; }
function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">{title}</h3><p className="mt-1 text-xs text-slate-400">{description}</p><div className="mt-4">{children}</div></section>; }
function MiniStat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>; }
function ActivityRow({ account, now }: { account: Account; now: number }) { const online = (account.lastSeenAtMs ?? 0) >= now - 120000; return <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`}/><div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{account.name || account.email}</p><p className="truncate text-[10px] text-slate-400">{account.schoolName || "Sekolah belum diisi"}</p></div><div className="text-right"><p className={`text-[9px] font-black ${online ? "text-emerald-600" : "text-slate-400"}`}>{online ? "ONLINE" : "OFFLINE"}</p><p className="mt-1 text-[9px] text-slate-400">{dateTime(account.lastSeenAtMs)}</p></div></div>; }
function AccountBadge({ status }: { status: string }) { const label = status === "active" ? "Aktif" : status === "trial" ? "Trial" : status === "disabled" ? "Disabled" : "Expired"; const tone = status === "active" ? "bg-emerald-50 text-emerald-700" : status === "trial" ? "bg-amber-50 text-amber-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-rose-50 text-rose-700"; return <span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${tone}`}>{label}</span>; }
function TokenBadge({ token, now }: { token: ActivationToken; now: number }) { const status = token.status === "active" && token.tokenExpiresAtMs <= now ? "expired" : token.status; const label = status === "active" ? "Aktif" : status === "used" ? "Digunakan" : status === "disabled" ? "Disabled" : "Expired"; const tone = status === "active" ? "bg-emerald-50 text-emerald-700" : status === "used" ? "bg-sky-50 text-sky-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-rose-50 text-rose-700"; return <span className={`rounded-lg px-2.5 py-1.5 text-[9px] font-black ${tone}`}>{label}</span>; }
function AccountCard({ account, now, busy, onToggle }: { account: Account; now: number; busy: boolean; onToggle: () => void }) { return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{account.name || "Belum diisi"}</h3><p className="text-xs text-slate-400">{account.email}</p></div><AccountBadge status={accountStatus(account, now)}/></div><div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Sekolah" value={account.schoolName || "—"}/><MiniStat label="Expired" value={accountExpiry(account) ? new Date(accountExpiry(account)).toLocaleDateString("id-ID") : "—"}/><MiniStat label="Token" value={account.activeTokenId || "Belum ada"}/><MiniStat label="Login" value={dateTime(account.lastLoginAtMs)}/></div><button disabled={busy} onClick={onToggle} className={`mt-3 w-full rounded-xl py-2.5 text-xs font-black ${account.disabled ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{account.disabled ? "Aktifkan akun" : "Disable akun"}</button></article>; }
function Input({ label, value, onChange, disabled = false }: { label: string; value: string; onChange?: (value: string) => void; disabled?: boolean }) { return <label><span className="mb-2 block text-xs font-extrabold">{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange?.(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-400"/></label>; }
