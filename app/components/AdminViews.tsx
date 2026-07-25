"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Ban, Camera, CheckCircle2, ChevronDown, Clock3, FileText, ImagePlus, KeyRound, LayoutDashboard, Loader2,
  LogOut, Plus, RefreshCcw, School, Search, ShieldCheck, Sparkles, Trash2, UserCheck, Users,
} from "lucide-react";
import { updateEmail, type User } from "firebase/auth";
import {
  collection, collectionGroup, deleteDoc, doc, getDocs, onSnapshot, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { createActivationTokenCode, tokenAccountTypeLabel, tokenMatchesAccountType, type TokenAccountType } from "../lib/tokenAccess";
import { ArticleManager } from "./ArticleViews";
import { DemoGeneratorPanel } from "./DemoGeneratorPanel";

type Toast = { message: string; tone: "success" | "error" } | null;
type Account = {
  id: string;
  email?: string;
  name?: string;
  schoolName?: string;
  teacherRole?: string;
  profilePhotoKey?: string;
  schoolLogoKey?: string;
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
  accountType?: TokenAccountType;
  schoolId?: string;
  schoolRole?: "principal" | "administration" | "teacher";
};
type SchoolTenant = { id: string; name?: string; schoolName?: string; ownerUid?: string; level?: string };
type SchoolGroup = { id: string; name: string; ownerUid?: string; level?: string; accounts: Account[] };
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
  accountType?: TokenAccountType;
};
type ProfileStudent = { id: string; className: string };
type ClassDraft = { id: string; original: string | null; name: string };

function Logo() {
  return <div className="flex items-center gap-3"><img src="/logo.png" alt="Logo SMART-ATT" className="h-11 w-11 rounded-xl object-cover"/><div><p className="text-sm font-black tracking-wide">SMART-ATT</p><p className="text-[10px] text-slate-400">Pusat Kendali Admin Utama</p></div></div>;
}

function dateTime(value?: number) {
  return value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function PrivateProfileImage({ user, assetKey, alt, className, fallback }: { user: User | null; assetKey?: string; alt: string; className: string; fallback: React.ReactNode }) {
  const [result, setResult] = useState({ key: "", url: "" });
  useEffect(() => { if (!user || !assetKey) return; let active = true; let objectUrl = ""; void user.getIdToken().then((token) => fetch(`/api/storage/file/${encodeURIComponent(assetKey)}`, { headers: { Authorization: `Bearer ${token}` } })).then((response) => { if (!response.ok) throw new Error(); return response.blob(); }).then((blob) => { if (!active) return; objectUrl = URL.createObjectURL(blob); setResult({ key: assetKey, url: objectUrl }); }).catch(() => undefined); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [user, assetKey]);
  return assetKey && result.key === assetKey && result.url ? <img src={result.url} alt={alt} className={className}/> : <>{fallback}</>;
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

function accountRoleLabel(account: Account) {
  if (account.accountType !== "school" && !account.schoolId) return "Guru SD Individual";
  if (account.schoolRole === "principal") return "Kepala Sekolah";
  if (account.schoolRole === "administration") return "Tata Usaha";
  if (account.schoolRole === "teacher") return "Guru Sekolah";
  return "Admin Sekolah (belum lengkap)";
}

export function SuperAdminProfessional({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState<"dashboard" | "users" | "tokens" | "monitor" | "articles" | "demo">("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schoolTenants, setSchoolTenants] = useState<SchoolTenant[]>([]);
  const [tokens, setTokens] = useState<ActivationToken[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [durationDays, setDurationDays] = useState("30");
  const [tokenAccountType, setTokenAccountType] = useState<TokenAccountType>("individual");
  const [generated, setGenerated] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteSchoolTarget, setDeleteSchoolTarget] = useState<SchoolGroup | null>(null);
  const [deleteSchoolName, setDeleteSchoolName] = useState("");
  const [deleteSchoolPhrase, setDeleteSchoolPhrase] = useState("");
  const [deleteSchoolError, setDeleteSchoolError] = useState("");
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
  useEffect(() => onSnapshot(collection(db, "schools"), (snapshot) => {
    const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SchoolTenant));
    next.sort((a, b) => (a.name || a.schoolName || a.id).localeCompare(b.name || b.schoolName || b.id, "id"));
    setSchoolTenants(next);
  }, () => setError("Daftar sekolah belum dapat dibaca.")), []);
  useEffect(() => onSnapshot(collectionGroup(db, "students"), (snapshot) => setStudentCount(snapshot.size), () => setError("Total siswa belum dapat dihitung.")), []);

  const teacherAccounts = accounts.filter((item) => item.role !== "superadmin");
  const activeUsers = teacherAccounts.filter((item) => accountStatus(item, now) === "active" || accountStatus(item, now) === "trial");
  const onlineUsers = teacherAccounts.filter((item) => (item.lastSeenAtMs ?? 0) >= now - 120000);
  const activeTokens = tokens.filter((item) => item.status === "active" && item.tokenExpiresAtMs > now);
  const filteredAccounts = teacherAccounts.filter((item) => `${item.name ?? ""} ${item.email ?? ""} ${item.schoolName ?? ""} ${accountRoleLabel(item)}`.toLowerCase().includes(search.toLowerCase()));
  const individualAccounts = filteredAccounts.filter((item) => item.accountType !== "school" && !item.schoolId);
  const schoolGroups = useMemo(() => {
    const tenantMap = new Map(schoolTenants.map((item) => [item.id, item]));
    const groups = new Map<string, SchoolGroup>();
    for (const account of filteredAccounts.filter((item) => item.accountType === "school" || Boolean(item.schoolId))) {
      const fallbackName = account.schoolName?.trim() || "Sekolah belum diberi nama";
      const key = account.schoolId || `unlinked:${fallbackName.toLowerCase()}`;
      const tenant = account.schoolId ? tenantMap.get(account.schoolId) : undefined;
      const current = groups.get(key) || { id: account.schoolId || "Belum terhubung", name: tenant?.name || tenant?.schoolName || fallbackName, ownerUid: tenant?.ownerUid, level: tenant?.level, accounts: [] };
      current.accounts.push(account); groups.set(key, current);
    }
    return [...groups.values()].map((group) => ({ ...group, accounts: [...group.accounts].sort((a, b) => {
      const ownerOrder = Number(b.id === group.ownerUid) - Number(a.id === group.ownerUid);
      return ownerOrder || accountRoleLabel(a).localeCompare(accountRoleLabel(b), "id") || (a.name || a.email || "").localeCompare(b.name || b.email || "", "id");
    }) })).sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [filteredAccounts, schoolTenants]);
  const schoolAccountCount = schoolGroups.reduce((total, group) => total + group.accounts.length, 0);
  const totalSchoolCount = Math.max(schoolTenants.length, schoolGroups.length);

  async function generateToken() {
    const days = Math.max(1, Math.min(365, Number(durationDays) || 30));
    const code = createActivationTokenCode(tokenAccountType);
    setBusy("generate"); setError("");
    try {
      const createdAtMs = Date.now();
      await setDoc(doc(db, "activationTokens", code), { code, accountType: tokenAccountType, durationDays: days, status: "active", createdAtMs, tokenExpiresAtMs: createdAtMs + 90 * 86400000, tokenExpiresAt: new Date(createdAtMs + 90 * 86400000), createdAt: serverTimestamp() });
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
  function openPermanentDelete(account: Account) {
    setError(""); setNotice(""); setDeleteError(""); setDeleteTarget(account); setDeleteEmail(""); setDeletePhrase("");
  }
  async function permanentlyDeleteAccount() {
    const target = deleteTarget;
    if (!target?.email) return;
    const normalizedPhrase = deletePhrase.trim().toUpperCase();
    if (deleteEmail.trim().toLowerCase() !== target.email.toLowerCase() || normalizedPhrase !== "HAPUS PERMANEN") {
      setDeleteError("Ketik email akun dan frasa HAPUS PERMANEN dengan tepat."); return;
    }
    setBusy(`delete:${target.id}`); setError(""); setDeleteError(""); setNotice("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: JSON.stringify({ email: deleteEmail.trim().toLowerCase(), confirmation: normalizedPhrase }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; authDeleted?: boolean; warnings?: string[] };
      if (!response.ok) throw new Error(result.error || "Akun gagal dihapus permanen.");
      const warning = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
      setNotice(result.authDeleted === false
        ? `Sisa data akun ${target.email} berhasil dibersihkan permanen.${warning}`
        : `Akun ${target.email} dan akses Firebase Authentication telah dihapus permanen.${warning}`);
      setDeleteTarget(null); setDeleteEmail(""); setDeletePhrase(""); setDeleteError("");
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : "Akun gagal dihapus permanen."); }
    finally { setBusy(""); }
  }
  function openPermanentSchoolDelete(group: SchoolGroup) {
    setError(""); setNotice(""); setDeleteSchoolError(""); setDeleteSchoolTarget(group); setDeleteSchoolName(""); setDeleteSchoolPhrase("");
  }
  async function permanentlyDeleteSchool() {
    const target = deleteSchoolTarget;
    if (!target) return;
    const normalizedPhrase = deleteSchoolPhrase.trim().toUpperCase();
    if (deleteSchoolName.trim().toLowerCase() !== target.name.trim().toLowerCase() || normalizedPhrase !== "HAPUS SEKOLAH PERMANEN") {
      setDeleteSchoolError("Ketik nama sekolah dan frasa HAPUS SEKOLAH PERMANEN dengan tepat."); return;
    }
    setBusy(`delete-school:${target.id}`); setError(""); setDeleteSchoolError(""); setNotice("");
    try {
      const idToken = await user.getIdToken();
      let result: { error?: string; deleted?: boolean; pending?: boolean; memberCount?: number; authDeleted?: number; remainingAuth?: number; warnings?: string[] } = {};
      let totalAuthDeleted = 0;
      const warnings = new Set<string>();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch(`/api/admin/schools/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
          body: JSON.stringify({ schoolName: deleteSchoolName.trim(), confirmation: normalizedPhrase }),
        });
        result = await response.json().catch(() => ({})) as typeof result;
        if (!response.ok) throw new Error(result.error || "Sekolah gagal dihapus permanen.");
        totalAuthDeleted += result.authDeleted ?? 0;
        for (const warning of result.warnings ?? []) warnings.add(warning);
        if (result.deleted) break;
        if (!result.pending || !(result.authDeleted ?? 0)) throw new Error("Proses penghapusan sekolah tidak dapat dilanjutkan.");
      }
      if (!result.deleted) throw new Error("Jumlah akun sekolah terlalu banyak untuk diselesaikan. Jalankan penghapusan sekali lagi.");
      const warning = warnings.size ? ` ${[...warnings].join(" ")}` : "";
      setNotice(`Sekolah ${target.name} beserta ${result.memberCount ?? target.accounts.length} akun anggotanya berhasil dihapus permanen. ${totalAuthDeleted} akun Firebase Authentication dibersihkan.${warning}`);
      setDeleteSchoolTarget(null); setDeleteSchoolName(""); setDeleteSchoolPhrase(""); setDeleteSchoolError("");
    } catch (reason) { setDeleteSchoolError(reason instanceof Error ? reason.message : "Sekolah gagal dihapus permanen."); }
    finally { setBusy(""); }
  }  const nav = [
    { key: "dashboard" as const, label: "Dasbor", icon: LayoutDashboard },
    { key: "users" as const, label: "Manajemen Pengguna", icon: Users },
    { key: "tokens" as const, label: "Manajemen Token", icon: KeyRound },
    { key: "monitor" as const, label: "Pemantauan", icon: Activity },
    { key: "articles" as const, label: "Artikel & SEO", icon: FileText },
    { key: "demo" as const, label: "Generate Demo School", icon: Sparkles },
  ];
  return <main className="min-h-screen bg-[#f4f7f9] text-slate-900"><header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex min-h-20 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-7"><Logo/><div className="flex items-center gap-2"><span className="hidden rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black text-white sm:block">ADMIN UTAMA</span><button onClick={onLogout} aria-label="Keluar" className="rounded-xl border border-slate-200 p-2.5 text-slate-500"><LogOut size={18}/></button></div></div></header><div className="mx-auto grid max-w-[1500px] gap-5 p-4 sm:p-7 lg:grid-cols-[250px_1fr]"><aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-24"><nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">{nav.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => setTab(item.key)} className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-xs font-extrabold ${tab === item.key ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={17}/>{item.label}</button>; })}</nav></aside><section className="min-w-0"><div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Pusat Kendali</p><h1 className="mt-1 text-2xl font-black">{nav.find((item) => item.key === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">Data real-time dari Firebase seluruh tenant SMART-ATT.</p></div>{error&&<div className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</div>}{notice&&<div className="mb-4 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{notice}</div>}
      {tab === "dashboard"&&<><div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><AdminStat label="Total sekolah" value={totalSchoolCount} icon={School} tone="bg-violet-50 text-violet-600"/><AdminStat label="Total pengguna" value={teacherAccounts.length} icon={Users} tone="bg-sky-50 text-sky-600"/><AdminStat label="Total siswa" value={studentCount} icon={UserCheck} tone="bg-teal-50 text-teal-600"/><AdminStat label="Pengguna aktif" value={activeUsers.length} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600"/><AdminStat label="Token aktif" value={activeTokens.length} icon={KeyRound} tone="bg-amber-50 text-amber-600"/></div><div className="mt-5 grid gap-5 xl:grid-cols-2"><Panel title="Aktivitas login terbaru" description="Urut berdasarkan login terakhir."><div className="space-y-2">{[...teacherAccounts].sort((a, b) => (b.lastLoginAtMs ?? 0) - (a.lastLoginAtMs ?? 0)).slice(0, 8).map((account) => <ActivityRow key={account.id} account={account} now={now}/>)}</div></Panel><Panel title="Ringkasan token" description="Status semua token aktivasi."><div className="grid grid-cols-2 gap-3"><MiniStat label="Aktif" value={activeTokens.length}/><MiniStat label="Digunakan" value={tokens.filter((item) => item.status === "used").length}/><MiniStat label="Kedaluwarsa" value={tokens.filter((item) => item.status === "expired" || item.tokenExpiresAtMs <= now).length}/><MiniStat label="Nonaktif" value={tokens.filter((item) => item.status === "disabled").length}/></div></Panel></div></>}
      {tab === "users"&&<><div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><Search size={17} className="text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, email, sekolah, atau role..." className="min-w-0 flex-1 text-sm outline-none"/></div><section className="mb-7"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-sky-600">Akun mandiri</p><h2 className="mt-1 text-lg font-black">Guru SD Individual</h2><p className="mt-1 text-xs text-slate-500">Satu email mengelola ruang kerja dan datanya sendiri.</p></div><span className="rounded-full bg-sky-50 px-3 py-1.5 text-[10px] font-black text-sky-700">{individualAccounts.length} AKUN</span></div><AccountList accounts={individualAccounts} now={now} busy={busy} onToggle={toggleAccount} onDelete={openPermanentDelete}/></section><section><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">Workspace sekolah</p><h2 className="mt-1 text-lg font-black">Akun dikelompokkan per sekolah</h2><p className="mt-1 text-xs text-slate-500">Klik nama sekolah untuk membuka atau menutup daftar emailnya.</p></div><span className="rounded-full bg-violet-50 px-3 py-1.5 text-[10px] font-black text-violet-700">{schoolGroups.length} SEKOLAH · {schoolAccountCount} AKUN</span></div><div className="space-y-3">{schoolGroups.map((group)=><details key={group.id} className="group overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-violet-50/70 px-5 py-4 outline-none transition hover:bg-violet-100/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 [&::-webkit-details-marker]:hidden"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white"><School size={19}/></div><div className="min-w-0"><h3 className="truncate font-black">{group.name}</h3><p className="truncate text-[10px] text-slate-500">{group.level?`${group.level} · `:""}ID {group.id}</p></div></div><div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-violet-700">{group.accounts.length} EMAIL</span><ChevronDown size={18} className="text-violet-600 transition-transform group-open:rotate-180"/></div></summary><div className="border-t border-violet-100"><div className="flex flex-col gap-3 border-b border-rose-100 bg-rose-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[10px] font-bold leading-4 text-rose-800">Hapus workspace sekaligus akan menghapus seluruh akun anggota dan data sekolah secara permanen.</p>{group.id!=="Belum terhubung"&&<button disabled={Boolean(busy)} onClick={()=>openPermanentSchoolDelete(group)} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[10px] font-black text-white disabled:opacity-40"><Trash2 size={14}/>Hapus sekolah + {group.accounts.length} akun</button>}</div><div className="p-3 sm:p-0"><AccountList accounts={group.accounts} now={now} busy={busy} ownerUid={group.ownerUid} onToggle={toggleAccount} onDelete={openPermanentDelete}/></div></div></details>)}{!schoolGroups.length&&<EmptyAccounts text={search?"Tidak ada akun sekolah yang cocok dengan pencarian.":"Belum ada akun sekolah."}/>}</div></section></>}
      {tab === "tokens"&&<><div className="grid gap-5 xl:grid-cols-[.6fr_1.4fr]">
        <Panel title="Buat token" description="Token satu kali pakai; tipe akun tidak dapat dipertukarkan.">
          <div className="mb-4"><span className="mb-2 block text-xs font-extrabold">Jenis akun</span><div className="grid grid-cols-2 gap-2">{([['individual','Guru SD','Perorangan'],['school','Per Sekolah','SD / SMP / SMA / SMK']] as const).map(([value,label,note])=><button type="button" key={value} onClick={()=>{setTokenAccountType(value);setGenerated("")}} className={`rounded-xl border-2 p-3 text-left ${tokenAccountType===value?'border-teal-600 bg-teal-50':'border-slate-200 bg-white'}`}><span className="block text-xs font-black">{label}</span><span className="mt-1 block text-[9px] text-slate-400">{note}</span></button>)}</div></div>
          <label className="block"><span className="mb-2 block text-xs font-extrabold">Durasi akun</span><select value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="1">1 hari</option><option value="14">14 hari</option><option value="30">1 bulan</option><option value="90">3 bulan</option><option value="365">1 tahun</option></select></label>
          <button disabled={busy === "generate"} onClick={() => void generateToken()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white">{busy === "generate" ? <Loader2 className="animate-spin" size={17}/> : <RefreshCcw size={17}/>}Buat token {tokenAccountType==='school'?'sekolah':'perorangan'}</button>
          {generated&&<div className="mt-4 rounded-xl bg-slate-950 p-4 text-center"><p className="text-[9px] font-black text-slate-400">TOKEN {tokenAccountTypeLabel(tokenAccountType).toUpperCase()}</p><p className="mt-2 break-all font-mono text-lg font-black text-teal-300">{generated}</p><button onClick={() => void navigator.clipboard.writeText(generated)} className="mt-3 text-[10px] font-black text-white">Salin token</button></div>}
        </Panel>
        <Panel title="Riwayat token" description="Token lama tanpa tipe dianggap token Guru SD Perorangan."><div className="max-h-[65vh] space-y-2 overflow-y-auto">{tokens.map((token) => <div key={token.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-black">{token.code}</p><span className={`rounded-lg px-2 py-1 text-[8px] font-black ${token.accountType==='school'?'bg-violet-50 text-violet-700':'bg-sky-50 text-sky-700'}`}>{tokenAccountTypeLabel(token.accountType).toUpperCase()}</span></div><p className="mt-1 text-[10px] text-slate-400">{token.durationDays} hari · dibuat {dateTime(token.createdAtMs)}</p></div><TokenBadge token={token} now={now}/></div>{token.usedByEmail&&<p className="mt-2 text-[10px] text-slate-500">Dipakai {token.usedByEmail} · {dateTime(token.usedAtMs)}</p>}<div className="mt-3 flex gap-2"><button disabled={token.status !== "active" || busy === token.id} onClick={() => void disableToken(token)} className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-2 text-[9px] font-black text-amber-700 disabled:opacity-40"><Ban size={12}/>Nonaktif</button><button disabled={busy === token.id} onClick={() => void removeToken(token)} className="flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-2 text-[9px] font-black text-rose-700"><Trash2 size={12}/>Hapus</button></div></div>)}</div></Panel>
      </div></>}
      {tab === "monitor"&&<><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><AdminStat label="Pengguna online" value={onlineUsers.length} icon={Activity} tone="bg-emerald-50 text-emerald-600"/><AdminStat label="Pengguna offline" value={Math.max(0, teacherAccounts.length - onlineUsers.length)} icon={Clock3} tone="bg-slate-100 text-slate-600"/><AdminStat label="Login hari ini" value={teacherAccounts.filter((item) => (item.lastLoginAtMs ?? 0) >= new Date().setHours(0, 0, 0, 0)).length} icon={UserCheck} tone="bg-sky-50 text-sky-600"/><AdminStat label="Aktivitas terbaru" value={teacherAccounts.filter((item) => (item.lastSeenAtMs ?? 0) >= now - 86400000).length} icon={RefreshCcw} tone="bg-violet-50 text-violet-600"/></div><Panel title="Pemantauan pengguna" description="Online dihitung dari pembaruan status dua menit terakhir."><div className="mt-4 space-y-2">{[...teacherAccounts].sort((a, b) => (b.lastSeenAtMs ?? 0) - (a.lastSeenAtMs ?? 0)).map((account) => <ActivityRow key={account.id} account={account} now={now}/>)}</div></Panel></>}
      {tab === "articles"&&<ArticleManager user={user}/>}
      {tab === "demo"&&<DemoGeneratorPanel />}
    </section></div>{deleteTarget&&<div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4"><section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-rose-100 text-rose-700"><Trash2 size={25}/></div><h2 id="delete-account-title" className="mt-5 text-2xl font-black">Hapus akun permanen?</h2><p className="mt-2 text-sm leading-6 text-slate-500">Firebase Authentication, data akun, dan file milik <strong>{deleteTarget.email}</strong> akan dihapus. Tindakan ini tidak dapat dibatalkan.</p>{deleteTarget.accountType==="school"&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">Jika akun ini pemilik workspace sekolah dan masih mempunyai anggota lain, gunakan tombol Hapus sekolah pada kelompok sekolah.</p>}<label className="mt-5 block"><span className="mb-2 block text-xs font-black">Ketik email akun</span><input autoFocus value={deleteEmail} onChange={(event)=>{setDeleteEmail(event.target.value);setDeleteError("")}} placeholder={deleteTarget.email} className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500"/></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black">Ketik HAPUS PERMANEN</span><input value={deletePhrase} onChange={(event)=>{setDeletePhrase(event.target.value);setDeleteError("")}} placeholder="HAPUS PERMANEN" className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-black outline-none focus:border-rose-500"/><span className="mt-1 block text-[10px] text-slate-400">Huruf kecil/besar dan spasi awal/akhir akan disesuaikan otomatis.</span></label>{deleteError&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700">{deleteError}</p>}<div className="mt-6 grid grid-cols-2 gap-3"><button disabled={busy===`delete:${deleteTarget.id}`} onClick={()=>{setDeleteTarget(null);setDeleteError("")}} className="rounded-xl border border-slate-200 py-3 text-xs font-black text-slate-600">Batal</button><button disabled={busy===`delete:${deleteTarget.id}`||deleteEmail.trim().toLowerCase()!==deleteTarget.email?.toLowerCase()||deletePhrase.trim().toUpperCase()!=="HAPUS PERMANEN"} onClick={()=>void permanentlyDeleteAccount()} className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-xs font-black text-white disabled:opacity-40">{busy===`delete:${deleteTarget.id}`?<Loader2 className="animate-spin" size={15}/>:<Trash2 size={15}/>}Hapus permanen</button></div></section></div>}{deleteSchoolTarget&&<div role="dialog" aria-modal="true" aria-labelledby="delete-school-title" className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/80 p-4"><section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-rose-600 text-white"><School size={25}/></div><h2 id="delete-school-title" className="mt-5 text-2xl font-black">Hapus seluruh sekolah?</h2><p className="mt-2 text-sm leading-6 text-slate-500">Workspace <strong>{deleteSchoolTarget.name}</strong>, seluruh data sekolah, dan <strong>{deleteSchoolTarget.accounts.length} akun</strong> anggotanya akan dihapus dari Firebase Authentication. Tindakan ini tidak dapat dibatalkan.</p><div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-800">Jangan gunakan fitur ini untuk pergantian tahun ajaran. Gunakan hanya untuk akun percobaan atau sekolah yang benar-benar harus dihapus.</div><label className="mt-5 block"><span className="mb-2 block text-xs font-black">Ketik nama sekolah</span><input autoFocus value={deleteSchoolName} onChange={(event)=>{setDeleteSchoolName(event.target.value);setDeleteSchoolError("")}} placeholder={deleteSchoolTarget.name} className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500"/></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black">Ketik HAPUS SEKOLAH PERMANEN</span><input value={deleteSchoolPhrase} onChange={(event)=>{setDeleteSchoolPhrase(event.target.value);setDeleteSchoolError("")}} placeholder="HAPUS SEKOLAH PERMANEN" className="h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-black outline-none focus:border-rose-500"/><span className="mt-1 block text-[10px] text-slate-400">Huruf kecil/besar dan spasi awal/akhir akan disesuaikan otomatis.</span></label>{deleteSchoolError&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700">{deleteSchoolError}</p>}<div className="mt-6 grid grid-cols-2 gap-3"><button disabled={busy===`delete-school:${deleteSchoolTarget.id}`} onClick={()=>{setDeleteSchoolTarget(null);setDeleteSchoolError("")}} className="rounded-xl border border-slate-200 py-3 text-xs font-black text-slate-600">Batal</button><button disabled={busy===`delete-school:${deleteSchoolTarget.id}`||deleteSchoolName.trim().toLowerCase()!==deleteSchoolTarget.name.trim().toLowerCase()||deleteSchoolPhrase.trim().toUpperCase()!=="HAPUS SEKOLAH PERMANEN"} onClick={()=>void permanentlyDeleteSchool()} className="flex items-center justify-center gap-2 rounded-xl bg-rose-700 py-3 text-xs font-black text-white disabled:opacity-40">{busy===`delete-school:${deleteSchoolTarget.id}`?<Loader2 className="animate-spin" size={15}/>:<Trash2 size={15}/>}Hapus sekolah</button></div></section></div>}</main>;
}

export function ProfileProfessional({ user, demo, students, setToast }: { user: User | null; demo: boolean; students: ProfileStudent[]; setToast: (toast: Toast) => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState(demo ? "Tomi Guru" : "");
  const [school, setSchool] = useState(demo ? "SDN Papandayan 1" : "");
  const [email, setEmail] = useState(demo ? "tolimur@gmail.com" : user?.email ?? "");
  const [phone, setPhone] = useState(demo ? "62812xxxx" : "");
  const [teacherRole, setTeacherRole] = useState(demo ? "Guru Kelas V-A" : "Guru Kelas");
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [schoolLogo, setSchoolLogo] = useState<File | null>(null);
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
      setName(data.name ?? ""); setSchool(data.schoolName ?? ""); setPhone((snapshot.data().phone as string | undefined) ?? ""); setTeacherRole(data.teacherRole ?? "Guru Kelas"); setEmail(data.email ?? user?.email ?? "");
    }, () => setToast({ message: "Profil guru belum dapat dibaca.", tone: "error" }));
  }, [demo, user, setToast]);
  useEffect(() => {
    const studentClassNames = studentClassesKey ? studentClassesKey.split("\u0001") : [];
    const applyClasses = (configured: string[]) => {
      const merged = Array.from(new Set([...configured, ...studentClassNames].map(normalizeClassName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
      setClassDrafts(merged.map((className) => ({ id: crypto.randomUUID(), original: className, name: className })));
    };
    if (demo) { applyClasses(["V-A", "V-B"]); return; }
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid, "settings", "academic"), (snapshot) => {
      const configured = snapshot.exists() && Array.isArray(snapshot.data().classNames)
        ? snapshot.data().classNames.filter((item: unknown): item is string => typeof item === "string")
        : [];
      applyClasses(configured);
    }, () => setToast({ message: "Daftar kelas belum dapat dibaca.", tone: "error" }));
  }, [demo, user, studentClassesKey, setToast]);

  function normalizeClassName(value: string) { return value.trim().replace(/\s+/g, " "); }
  async function persistClassNames(names: string[], successMessage: string) {
    if (demo || !user) { setToast({ message: successMessage, tone: "success" }); return true; }
    setSavingClasses(true);
    try {
      await setDoc(doc(db, "users", user.uid, "settings", "academic"), { classNames: names, updatedAt: serverTimestamp() }, { merge: true });
      setToast({ message: successMessage, tone: "success" });
      return true;
    } catch {
      setToast({ message: "Perubahan kelas gagal disimpan ke Firebase.", tone: "error" });
      return false;
    } finally { setSavingClasses(false); }
  }
  async function addClass() {
    const className = normalizeClassName(newClass);
    if (!className) { setToast({ message: "Masukkan nama kelas, contoh V-A.", tone: "error" }); return; }
    if (classDrafts.some((item) => normalizeClassName(item.name).toLocaleLowerCase("id-ID") === className.toLocaleLowerCase("id-ID"))) {
      setToast({ message: `Kelas ${className} sudah ada.`, tone: "error" }); return;
    }
    const next = [...classDrafts, { id: crypto.randomUUID(), original: className, name: className }];
    setClassDrafts(next); setNewClass("");
    await persistClassNames(next.map((item) => normalizeClassName(item.name)), `Kelas ${className} ditambahkan dan tersimpan permanen.`);
  }
  async function removeClass(item: ClassDraft) {
    const used = item.original ? studentCounts[item.original] ?? 0 : 0;
    if (used) { setToast({ message: `Kelas ${item.original} masih dipakai ${used} siswa. Ubah namanya lalu simpan, atau pindahkan siswanya terlebih dahulu.`, tone: "error" }); return; }
    const next = classDrafts.filter((row) => row.id !== item.id);
    setClassDrafts(next);
    await persistClassNames(next.map((row) => normalizeClassName(row.name)), `Kelas ${item.name} dihapus dan perubahan tersimpan.`);
  }

  async function saveProfile() {
    if (name.trim().length < 3) { setToast({ message: "Nama guru minimal 3 karakter.", tone: "error" }); return; }
    if (teacherRole.trim().length < 3) { setToast({ message: "Role guru minimal 3 karakter.", tone: "error" }); return; }
    const cleanEmail = email.trim().toLowerCase();
    setSaving(true);
    try {
      if (!demo && user) {
        const uploadAsset = async (file: File, kind: "profile" | "school-logo") => {
          const token = await user.getIdToken();
          const form = new FormData();
          form.append("file", file);
          form.append("kind", kind);
          const response = await fetch("/api/storage/profile-assets", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
          const body = await response.json().catch(() => ({})) as { key?: string; error?: string };
          if (!response.ok || !body.key) throw new Error(body.error || "Gambar gagal diunggah");
          return body.key;
        };
        const [profilePhotoKey, schoolLogoKey] = await Promise.all([
          profilePhoto ? uploadAsset(profilePhoto, "profile") : Promise.resolve(account?.profilePhotoKey || ""),
          schoolLogo ? uploadAsset(schoolLogo, "school-logo") : Promise.resolve(account?.schoolLogoKey || ""),
        ]);
        const nextSchool = school.trim();
        const profileData = { name: name.trim(), email: cleanEmail, schoolName: nextSchool, phone: phone.trim(), teacherRole: teacherRole.trim(), profilePhotoKey, schoolLogoKey, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, "users", user.uid), profileData);
        await setDoc(doc(db, "users", user.uid, "settings", "academic"), { schoolName: nextSchool, schoolLogoKey, updatedAt: serverTimestamp() }, { merge: true });
        if (cleanEmail && cleanEmail !== user.email) {
          try { await updateEmail(user, cleanEmail); } catch { /* Auth update optional if recent-login required */ }
        }
        setProfilePhoto(null); setSchoolLogo(null);
      }
      setToast({ message: "Profil, email pengiriman kartu, dan logo sekolah berhasil disimpan.", tone: "success" });
    }
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
        if (!tokenMatchesAccountType(tokenData.accountType, userData?.accountType)) {
          throw new Error(userData?.accountType === "school" ? "Token Guru SD tidak dapat dipakai untuk akun sekolah." : "Token sekolah tidak dapat dipakai untuk akun Guru SD perorangan.");
        }
        const base = Math.max(currentMs, userData?.activeUntilMs ?? userData?.trialEndsAt?.toMillis?.() ?? 0);
        const activeUntilMs = base + tokenData.durationDays * 86400000;
        transaction.update(tokenRef, { status: "used", usedBy: user.uid, usedByEmail: user.email ?? "", usedAtMs: currentMs, accountExpiresAtMs: activeUntilMs, usedAt: serverTimestamp() });
        transaction.update(userRef, { status: "active", nonaktif: false, activeTokenId: code, tokenActivatedAtMs: currentMs, activeUntilMs, updatedAt: serverTimestamp() });
      });
      setToken(""); setToast({ message: "Token berhasil diaktifkan dan masa akun telah diperpanjang.", tone: "success" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Aktivasi token gagal.", tone: "error" }); }
    finally { setActivating(false); }
  }

  const expiry = account ? accountExpiry(account) : 0;
  const remainingDays = expiry > now ? Math.ceil((expiry - now) / 86400000) : 0;
  const status = account ? accountStatus(account, now) : "kedaluwarsa";
  return <>
    <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-teal-600">Akun</p><h2 className="mt-1 text-2xl font-black">Profil & aktivasi token</h2><p className="mt-1 text-sm text-slate-500">Kelola identitas guru, kelas aktif, dan masa aktif akun.</p></div>
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 grid gap-4 sm:grid-cols-2"><label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4"><PrivateProfileImage user={user} assetKey={account?.profilePhotoKey} alt="Foto guru" className="h-20 w-20 shrink-0 rounded-2xl object-cover" fallback={<div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-teal-100 text-teal-700"><Camera size={26}/></div>}/><span><span className="block text-xs font-black">Foto profil guru</span><span className="mt-1 block text-[10px] leading-4 text-slate-400">{profilePhoto ? profilePhoto.name : "Klik untuk upload JPG/PNG/WebP"}</span></span><input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setProfilePhoto(event.target.files?.[0] || null)}/></label><label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4"><PrivateProfileImage user={user} assetKey={account?.schoolLogoKey} alt="Logo sekolah" className="h-20 w-20 shrink-0 rounded-2xl object-contain bg-white p-1" fallback={<div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-700"><ImagePlus size={26}/></div>}/><span><span className="block text-xs font-black">Logo sekolah</span><span className="mt-1 block text-[10px] leading-4 text-slate-400">{schoolLogo ? schoolLogo.name : "Muncul pada kartu pelajar"}</span></span><input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setSchoolLogo(event.target.files?.[0] || null)}/></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Nama guru" value={name} onChange={setName}/><Input label="Role / jabatan" value={teacherRole} onChange={setTeacherRole}/><Input label="Email pengiriman kartu & login" value={email} onChange={setEmail} placeholder="email@sekolah.sch.id"/><Input label="Nomor WhatsApp" value={phone} onChange={setPhone}/><Input label="Sekolah utama" value={school} onChange={setSchool}/></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">✉️ <strong>Email Pengiriman:</strong> Digunakan untuk menerima hasil cetak PDF kartu pelajar siswa dan laporan ke inbox email Anda.</p>
        <button disabled={saving} onClick={() => void saveProfile()} className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-xs font-extrabold text-white">{saving&&<Loader2 className="animate-spin" size={15}/>}Simpan profil</button>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Aktivasi token</p><h3 className="mt-1 text-xl font-black">Status akun</h3></div><AccountBadge status={status}/></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><MiniStat label="Tanggal aktif" value={account?.tokenActivatedAtMs ? new Date(account.tokenActivatedAtMs).toLocaleDateString("id-ID") : "—"}/><MiniStat label="Tanggal berakhir" value={expiry ? new Date(expiry).toLocaleDateString("id-ID") : "—"}/><div className="col-span-2"><MiniStat label="Sisa masa aktif" value={`${remainingDays} hari`}/></div></div>
        <label className="mt-5 block"><span className="mb-2 block text-xs font-extrabold">Masukkan Token</span><input value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} placeholder="SATT-XXXXXXXXXXXX" className="h-12 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm uppercase outline-none focus:border-teal-500"/></label>
        <button disabled={activating || !token.trim()} onClick={() => void activateToken()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-xs font-extrabold text-white disabled:opacity-40">{activating ? <Loader2 className="animate-spin" size={16}/> : <ShieldCheck size={16}/>}Aktivasi</button>
      </section>
    </div>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-teal-600">Kelas aktif</p><h3 className="mt-1 text-xl font-black">Kelola kelas</h3><p className="mt-1 text-xs leading-5 text-slate-500">Tambah dan hapus kelas langsung tersimpan ke Firebase. Untuk mengubah nama kelas, edit lalu tekan Simpan kelas.</p></div><span className="w-fit rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-700">{classDrafts.length} kelas</span></div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row"><input value={newClass} onChange={(event) => setNewClass(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addClass(); } }} placeholder="Contoh: V-A" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-teal-500"/><button disabled={savingClasses} onClick={() => void addClass()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-extrabold text-white"><Plus size={16}/>Tambah kelas</button></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{classDrafts.map((item) => {
        const used = item.original ? studentCounts[item.original] ?? 0 : 0;
        const changed = Boolean(item.original && normalizeClassName(item.name) !== item.original);
        return <div key={item.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-center gap-2"><input aria-label={`Nama kelas ${item.original ?? "baru"}`} value={item.name} onChange={(event) => setClassDrafts((current) => current.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row))} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-black outline-none focus:border-teal-500"/><button onClick={() => void removeClass(item)} title={used ? "Kelas masih dipakai siswa" : "Hapus kelas"} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><Trash2 size={16}/></button></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]"><span className="font-bold text-slate-400">{used} siswa</span>{changed&&<span className="rounded-lg bg-amber-50 px-2 py-1 font-black text-amber-700">{item.original} → {normalizeClassName(item.name) || "?"}</span>}</div></div>;
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
function AccountBadge({ status }: { status: string }) { const label = status === "active" ? "Aktif" : status === "trial" ? "Trial" : status === "disabled" ? "Nonaktif" : "Kedaluwarsa"; const tone = status === "active" ? "bg-emerald-50 text-emerald-700" : status === "trial" ? "bg-amber-50 text-amber-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-rose-50 text-rose-700"; return <span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${tone}`}>{label}</span>; }
function TokenBadge({ token, now }: { token: ActivationToken; now: number }) { const status = token.status === "active" && token.tokenExpiresAtMs <= now ? "kedaluwarsa" : token.status; const label = status === "active" ? "Aktif" : status === "used" ? "Digunakan" : status === "disabled" ? "Nonaktif" : "Kedaluwarsa"; const tone = status === "active" ? "bg-emerald-50 text-emerald-700" : status === "used" ? "bg-sky-50 text-sky-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-rose-50 text-rose-700"; return <span className={`rounded-lg px-2.5 py-1.5 text-[9px] font-black ${tone}`}>{label}</span>; }
function EmptyAccounts({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm font-bold text-slate-400">{text}</div>; }
function AccountList({ accounts, now, busy, ownerUid, onToggle, onDelete }: { accounts: Account[]; now: number; busy: string; ownerUid?: string; onToggle: (account: Account) => Promise<void>; onDelete: (account: Account) => void }) {
  if (!accounts.length) return <EmptyAccounts text="Belum ada akun pada kelompok ini."/>;
  const deletionState = (account: Account) => {
    const owner = account.id === ownerUid;
    return { owner, canDelete: !owner || accounts.length === 1, reason: owner && accounts.length > 1 ? `Hapus ${accounts.length - 1} anggota lain lebih dahulu` : "" };
  };
  return <><div className="space-y-3 sm:hidden">{accounts.map((account) => { const state = deletionState(account); return <AccountCard key={account.id} account={account} now={now} busy={busy === account.id || busy === `delete:${account.id}`} owner={state.owner} canDelete={state.canDelete} deleteReason={state.reason} onToggle={() => void onToggle(account)} onDelete={() => onDelete(account)}/>; })}</div><div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[1000px]"><thead className="bg-slate-50 text-left text-[9px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Nama & email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Tanggal daftar</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Kedaluwarsa</th><th className="px-4 py-3">Login terakhir</th><th className="px-5 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{accounts.map((account) => { const state = deletionState(account); const accountBusy = busy === account.id || busy === `delete:${account.id}`; return <tr key={account.id}><td className="px-5 py-4"><p className="text-sm font-black">{account.name || "Belum diisi"}</p><p className="text-[10px] text-slate-400">{account.email}</p></td><td className="px-4 py-4"><p className="text-xs font-black text-slate-700">{accountRoleLabel(account)}</p>{state.owner&&<span className="mt-1 inline-flex rounded-full bg-violet-50 px-2 py-1 text-[8px] font-black text-violet-700">PEMILIK · HAPUS TERAKHIR</span>}</td><td className="px-4 py-4 text-xs">{dateTime(account.createdAt?.toMillis?.())}</td><td className="px-4 py-4"><AccountBadge status={accountStatus(account, now)}/></td><td className="px-4 py-4 text-xs">{dateTime(accountExpiry(account))}</td><td className="px-4 py-4 text-xs">{dateTime(account.lastLoginAtMs)}</td><td className="px-5 py-4"><div className="flex gap-2"><button disabled={accountBusy} onClick={() => void onToggle(account)} className={`rounded-lg px-3 py-2 text-[10px] font-black ${account.disabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{account.disabled ? "Aktifkan" : "Nonaktif"}</button><button title={state.reason || "Hapus akun dan seluruh aksesnya"} disabled={!state.canDelete || !account.email || Boolean(busy)} onClick={() => onDelete(account)} className="rounded-lg bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">{state.canDelete ? "Hapus permanen" : "Hapus anggota dulu"}</button></div>{state.reason&&<p className="mt-1 max-w-40 text-[8px] font-bold text-slate-400">{state.reason}</p>}</td></tr>; })}</tbody></table></div></>;
}
function AccountCard({ account, now, busy, owner, canDelete, deleteReason, onToggle, onDelete }: { account: Account; now: number; busy: boolean; owner: boolean; canDelete: boolean; deleteReason: string; onToggle: () => void; onDelete: () => void }) { return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{account.name || "Belum diisi"}</h3>{owner&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[8px] font-black text-violet-700">PEMILIK</span>}</div><p className="text-xs text-slate-400">{account.email}</p><p className="mt-1 text-[10px] font-black text-slate-600">{accountRoleLabel(account)}</p></div><AccountBadge status={accountStatus(account, now)}/></div><div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Kedaluwarsa" value={accountExpiry(account) ? new Date(accountExpiry(account)).toLocaleDateString("id-ID") : "—"}/><MiniStat label="Login" value={dateTime(account.lastLoginAtMs)}/></div><div className="mt-3 grid grid-cols-2 gap-2"><button disabled={busy} onClick={onToggle} className={`rounded-xl py-2.5 text-xs font-black ${account.disabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{account.disabled ? "Aktifkan" : "Nonaktif"}</button><button title={deleteReason} disabled={busy||!account.email||!canDelete} onClick={onDelete} className="rounded-xl bg-rose-50 py-2.5 text-xs font-black text-rose-700 disabled:bg-slate-100 disabled:text-slate-400">{canDelete?"Hapus permanen":"Hapus anggota dulu"}</button></div>{deleteReason&&<p className="mt-2 text-[9px] font-bold text-slate-400">{deleteReason}</p>}</article>; }
function Input({ label, value, onChange, placeholder, nonaktif = false }: { label: string; value: string; onChange?: (value: string) => void; placeholder?: string; nonaktif?: boolean }) { return <label><span className="mb-2 block text-xs font-extrabold">{label}</span><input value={value} placeholder={placeholder} disabled={nonaktif} onChange={(event) => onChange?.(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-400"/></label>; }
