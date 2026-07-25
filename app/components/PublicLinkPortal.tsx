"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { parseQuizLinkInput } from "../lib/publicLink";

function routeIdentifier(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? decodeURIComponent(segments[1]) : "";
}

export function PublicLinkPortal() {
  const pathname = usePathname();
  const initialIdentifier = routeIdentifier(pathname);
  const [value, setValue] = useState(initialIdentifier);
  const [loading, setLoading] = useState(Boolean(initialIdentifier));
  const [error, setError] = useState("");

  async function openQuiz(rawValue: string) {
    const parsed = parseQuizLinkInput(rawValue);
    if (!parsed) { setError("Kode atau link tidak valid. Periksa kembali tulisan yang diberikan guru."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      if (parsed.kind === "snapshotId") {
        if (parsed.value === "demo") { window.location.replace("/public/quiz/demo"); return; }
        const snapshot = await getDoc(doc(db, "publicSnapshots", parsed.value));
        if (!snapshot.exists() || snapshot.data().type !== "quiz" || snapshot.data().published !== true) throw new Error("inactive");
        window.location.replace(`/public/quiz/${encodeURIComponent(parsed.value)}`);
        return;
      }
      const link = await getDoc(doc(db, "publicLinkCodes", parsed.value));
      const data = link.data();
      if (!link.exists() || data?.type !== "quiz" || data.published !== true || typeof data.snapshotId !== "string") throw new Error("inactive");
      window.location.replace(`/public/quiz/${encodeURIComponent(data.snapshotId)}`);
    } catch {
      setError("Kode tidak ditemukan atau ulangan sudah dinonaktifkan. Minta kode terbaru kepada guru.");
      setLoading(false);
    }
  }

  useEffect(() => { if (initialIdentifier) void openQuiz(initialIdentifier); }, [initialIdentifier]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void openQuiz(value);
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ccfbf1,transparent_35%),linear-gradient(135deg,#f8fafc,#fff7ed)] px-4 py-8 sm:py-14">
    <header className="mx-auto mb-8 flex max-w-4xl items-center gap-3">
      <img src="/logo.png" alt="Logo SMART-ATT" className="h-12 w-12 rounded-2xl object-cover shadow-sm"/>
      <div><p className="font-black text-slate-950">SMART-ATT</p><p className="text-[11px] font-bold text-slate-400">Portal Link Sekolah</p></div>
    </header>
    <section className="mx-auto max-w-lg rounded-[2rem] border border-white/80 bg-white p-7 shadow-2xl shadow-slate-900/10 sm:p-10">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700"><KeyRound size={27}/></div>
        <h1 className="mt-5 text-center text-2xl font-black text-slate-950">Masukkan kode unik dari guru</h1>
        <form onSubmit={submit} className="mt-7">
          <label className="block"><span className="mb-2 block text-xs font-black text-slate-700">Kode atau link ulangan</span><input autoFocus autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={300} value={value} onChange={(event)=>{setValue(event.target.value);setError("")}} placeholder="Ketik kode di sini" className="h-16 w-full rounded-2xl border-2 border-slate-200 px-5 text-center text-xl font-black uppercase tracking-[.16em] text-slate-950 outline-none transition placeholder:text-sm placeholder:font-bold placeholder:normal-case placeholder:tracking-normal focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"/></label>
          {error&&<p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700">{error}</p>}
          <button disabled={loading||!value.trim()} className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 px-5 text-sm font-black text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{loading?<><Loader2 className="animate-spin" size={18}/>Memeriksa kode...</>:<>Buka ulangan<ArrowRight size={18}/></>}</button>
        </form>
    </section>
  </main>;
}
