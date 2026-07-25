"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { ArrowLeft, ExternalLink, FileText, ImagePlus, Loader2, PencilLine, Plus, Save, Trash2 } from "lucide-react";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../lib/firebase";

export type ArticleRecord = {
  id: string; slug: string; title: string; excerpt: string; body: string; tags: string[];
  coverKey?: string; coverUrl?: string; externalLink?: string; published: boolean;
  publishedAtMs?: number; updatedAtMs?: number; publishedAt?: unknown; updatedAt?: unknown;
};

export const DEFAULT_ARTICLE: ArticleRecord = {
  id: "kebiasaan-hadir-tepat-waktu", slug: "kebiasaan-hadir-tepat-waktu",
  title: "Membangun Kebiasaan Hadir Tepat Waktu Tanpa Membebani Guru",
  excerpt: "Pendekatan sederhana untuk menjadikan data kehadiran sebagai bahan pendampingan, bukan sekadar angka administrasi.",
  tags: ["Pendidikan", "Manajemen Kelas", "Absensi Digital"], published: true,
  publishedAtMs: new Date("2026-07-15T07:00:00+07:00").getTime(),
  body: `Kehadiran tepat waktu bukan hanya persoalan disiplin. Bagi guru, pola kedatangan siswa dapat menjadi petunjuk awal tentang kesiapan belajar, dukungan keluarga, jarak perjalanan, bahkan kondisi kesehatan siswa.

Langkah pertama adalah membuat proses pencatatan sesederhana mungkin. Guru sebaiknya dapat membuka pemindai, membaca kartu siswa, lalu langsung melanjutkan ke siswa berikutnya. Teknologi yang baik mengurangi pekerjaan berulang dan memberi guru lebih banyak waktu untuk menyambut kelas.

Data harian kemudian dibaca sebagai pola, bukan sebagai alasan untuk cepat menghukum. Siswa yang terlambat sekali membutuhkan respons berbeda dari siswa yang terlambat berulang kali. Rekap mingguan membantu guru memulai percakapan berdasarkan fakta yang jelas.

Komunikasi dengan orang tua juga perlu singkat dan manusiawi. Pesan yang menjelaskan bahwa siswa belum tercatat hadir, disertai tautan konfirmasi sakit atau izin, lebih membantu daripada pesan yang bernada menuduh. Orang tua dapat memberi konteks dan guru memperoleh data yang lebih akurat.

Yang terpenting, sistem harus tetap memberi ruang bagi kebijakan sekolah. Batas waktu, kategori kehadiran, serta tindak lanjut dapat disesuaikan dengan kondisi kelas. Teknologi berfungsi sebagai alat bantu keputusan; hubungan guru, siswa, dan keluarga tetap menjadi pusat pendidikan.

Jika dilakukan konsisten, kebiasaan hadir tepat waktu tumbuh melalui rutinitas yang mudah dipahami: siswa tahu kapan kehadiran dicatat, orang tua tahu cara memberi konfirmasi, dan guru memiliki laporan yang siap digunakan untuk pendampingan.`
};

function usePublishedArticles() {
  const [articles,setArticles]=useState<ArticleRecord[]>([DEFAULT_ARTICLE]);
  useEffect(()=>onSnapshot(query(collection(db,"articles"),where("published","==",true)),(snapshot)=>{
    const rows=snapshot.docs.map((item)=>({id:item.id,...item.data()} as ArticleRecord));
    setArticles((rows.length?rows:[DEFAULT_ARTICLE]).sort((a,b)=>articleDateMs(b)-articleDateMs(a)));
  },()=>setArticles([DEFAULT_ARTICLE])),[]);
  return articles;
}

function articleDateMs(article:ArticleRecord){
  const read=(value:unknown)=>{
    if(typeof value==="number"&&Number.isFinite(value))return value;
    if(typeof value==="string"){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:0;}
    if(value&&typeof value==="object"){
      const candidate=value as {toMillis?:()=>number;seconds?:number;_seconds?:number};
      if(typeof candidate.toMillis==="function"){const parsed=candidate.toMillis();if(Number.isFinite(parsed))return parsed;}
      const seconds=candidate.seconds??candidate._seconds;if(typeof seconds==="number")return seconds*1000;
    }
    return 0;
  };
  return read(article.publishedAtMs)||read(article.publishedAt)||read(article.updatedAtMs)||read(article.updatedAt);
}

function coverUrl(article:ArticleRecord){
  const value=article.coverKey||article.coverUrl||"";
  if(!value)return "";
  return /^https?:\/\//i.test(value)?value:`/api/storage/article/${encodeURIComponent(value)}`;
}

export function LoginArticlePreview({variant="dark"}:{variant?:"dark"|"light"}){
  const article=usePublishedArticles()[0]??DEFAULT_ARTICLE; const light=variant==="light";
  return <a href={`/articles/${article.slug}`} className={`group block rounded-2xl border p-4 transition ${light?"border-slate-200 bg-white shadow-sm hover:border-teal-300":"mt-8 border-white/10 bg-white/[.07] hover:bg-white/[.11]"}`}>
    <div className="flex gap-4">{coverUrl(article)?<img src={coverUrl(article)} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover"/>:<div className={`grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${light?"from-teal-100 to-sky-100":"from-teal-400/30 to-sky-400/20"}`}><FileText className={light?"text-teal-700":"text-teal-200"}/></div>}<div className="min-w-0"><p className={`text-[9px] font-black uppercase tracking-[.15em] ${light?"text-teal-600":"text-teal-300"}`}>Artikel pendidikan</p><h2 className={`mt-1 line-clamp-2 text-sm font-black leading-5 ${light?"text-slate-900":"text-white"}`}>{article.title}</h2><p className={`mt-2 text-[10px] font-bold ${light?"text-teal-700":"text-teal-200"}`}>Baca artikel <span aria-hidden>→</span></p></div></div>
  </a>;
}
export function PublicArticles({slug}:{slug?:string}){
  const articles=usePublishedArticles(); const article=slug?articles.find((item)=>item.slug===slug):undefined;
  useEffect(()=>{const title=article?`${article.title} | SMART-ATT`:"Artikel Pendidikan | SMART-ATT";const description=article?.excerpt??"Artikel praktis untuk guru, sekolah, dan pengelolaan pembelajaran.";const image=article?.coverKey?`${window.location.origin}/api/storage/article/${encodeURIComponent(article.coverKey)}`:`${window.location.origin}/logo.png`;const url=window.location.href;document.title=title;const tags=[{key:"name",value:"description",content:description},{key:"property",value:"og:title",content:title},{key:"property",value:"og:description",content:description},{key:"property",value:"og:image",content:image},{key:"property",value:"og:url",content:url},{key:"property",value:"og:type",content:"article"},{key:"name",value:"twitter:card",content:"summary_large_image"},{key:"name",value:"twitter:title",content:title},{key:"name",value:"twitter:description",content:description},{key:"name",value:"twitter:image",content:image}];for(const tag of tags){let meta=document.head.querySelector(`meta[${tag.key}="${tag.value}"]`) as HTMLMetaElement|null;if(!meta){meta=document.createElement("meta");meta.setAttribute(tag.key,tag.value);document.head.appendChild(meta)}meta.content=tag.content;}},[article]);
  if(slug&&article)return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5"><a href="/" className="flex items-center gap-3"><img src="/logo.png" className="h-10 w-10 rounded-xl" alt="SMART-ATT"/><b>SMART-ATT</b></a><a href="/articles" className="flex items-center gap-2 text-xs font-black text-teal-700"><ArrowLeft size={15}/>Semua artikel</a></div></header><article className="mx-auto max-w-3xl px-4 py-10 sm:py-16">{coverUrl(article)&&<img src={coverUrl(article)} alt={`Sampul ${article.title}`} className="mb-8 aspect-[16/8] w-full rounded-3xl object-cover shadow-sm"/>}<div className="flex flex-wrap gap-2">{article.tags.map((tag)=><span key={tag} className="rounded-full bg-teal-50 px-3 py-1 text-[10px] font-black text-teal-700">{tag}</span>)}</div><h1 className="mt-5 text-3xl font-black leading-tight sm:text-5xl">{article.title}</h1><p className="mt-5 text-lg leading-8 text-slate-500">{article.excerpt}</p><div className="mt-9 space-y-5 text-[15px] leading-8 text-slate-700">{article.body.split(/\n\s*\n/).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>{article.externalLink&&<a href={article.externalLink} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-xs font-black text-white">Sumber terkait <ExternalLink size={14}/></a>}</article></main>;
  if(slug)return <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center"><div><h1 className="text-2xl font-black">Artikel tidak ditemukan</h1><a href="/articles" className="mt-4 inline-block font-bold text-teal-700">Kembali ke artikel</a></div></main>;
  return <main className="min-h-screen bg-slate-50"><section className="mx-auto max-w-6xl px-4 py-12"><a href="/" className="flex items-center gap-3"><img src="/logo.png" className="h-11 w-11 rounded-xl" alt="SMART-ATT"/><b>SMART-ATT</b></a><h1 className="mt-12 text-4xl font-black">Artikel untuk guru dan sekolah</h1><p className="mt-3 text-slate-500">Gagasan praktis untuk kelas yang lebih tertib, aman, dan mudah dikelola.</p><div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{articles.map((item)=><a key={item.id} href={`/articles/${item.slug}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1">{coverUrl(item)?<img src={coverUrl(item)} alt="" className="aspect-video w-full object-cover"/>:<div className="grid aspect-video place-items-center bg-gradient-to-br from-[#07363b] to-teal-700"><FileText size={40} className="text-teal-200"/></div>}<div className="p-5"><div className="flex flex-wrap gap-1.5">{item.tags.slice(0,3).map((tag)=><span key={tag} className="text-[9px] font-black uppercase text-teal-600">#{tag}</span>)}</div><h2 className="mt-3 text-lg font-black leading-6">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500">{item.excerpt}</p></div></a>)}</div></section></main>;
}

export function ArticleManager({user}:{user:User}){
  const empty={...DEFAULT_ARTICLE,id:"",slug:"",title:"",excerpt:"",body:"",tags:[],published:false,publishedAtMs:undefined};
  const [articles,setArticles]=useState<ArticleRecord[]>([]); const [form,setForm]=useState<ArticleRecord>(empty); const [tags,setTags]=useState(""); const [busy,setBusy]=useState(false);
  useEffect(()=>onSnapshot(collection(db,"articles"),(snapshot)=>setArticles(snapshot.docs.map((item)=>({id:item.id,...item.data()} as ArticleRecord)).sort((a,b)=>articleDateMs(b)-articleDateMs(a)))),[]);
  const editing=useMemo(()=>Boolean(form.id),[form.id]);
  function edit(item:ArticleRecord){setForm(item);setTags(item.tags.join(", "));}
  function useExample(){setForm({...DEFAULT_ARTICLE,id:DEFAULT_ARTICLE.slug});setTags(DEFAULT_ARTICLE.tags.join(", "));}
  async function upload(file:File){setBusy(true);try{const data=new FormData();data.append("file",file);const token=await user.getIdToken();const response=await fetch("/api/storage/articles",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:data});if(!response.ok)throw new Error("Upload sampul gagal");const result=await response.json() as {key:string};setForm((current)=>({...current,coverKey:result.key}));}finally{setBusy(false)}}
  async function save(){if(!form.title.trim()||!form.slug.trim()||!form.excerpt.trim()||!form.body.trim())return;setBusy(true);try{const slug=form.slug.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");const now=Date.now();await setDoc(doc(db,"articles",slug),{...form,id:slug,slug,title:form.title.trim(),excerpt:form.excerpt.trim(),body:form.body.trim(),tags:tags.split(",").map((tag)=>tag.trim()).filter(Boolean),published:form.published,publishedAtMs:form.published?(form.publishedAtMs??now):null,updatedAtMs:now,updatedAt:serverTimestamp()},{merge:true});setForm(empty);setTags("");}finally{setBusy(false)}}
  async function remove(item:ArticleRecord){if(confirm(`Hapus artikel ${item.title}?`))await deleteDoc(doc(db,"articles",item.id));}
  return <div className="grid gap-5 xl:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">{editing?"Edit artikel":"Artikel baru"}</h2><p className="text-xs text-slate-500">Foto sampul, tag, link, isi, dan status publikasi.</p></div><div className="flex gap-2"><button onClick={useExample} className="rounded-xl bg-violet-50 px-3 py-2 text-[10px] font-black text-violet-700">Gunakan contoh</button><button onClick={()=>{setForm(empty);setTags("")}} className="rounded-xl bg-slate-100 px-3 py-2 text-[10px] font-black"><Plus size={14}/></button></div></div><div className="mt-5 space-y-3"><AdminField label="Judul" value={form.title} onChange={(value)=>setForm({...form,title:value,slug:form.slug||value.toLowerCase().replace(/[^a-z0-9]+/g,"-")})}/><AdminField label="Slug URL" value={form.slug} onChange={(value)=>setForm({...form,slug:value})}/><label className="block text-xs font-black">Ringkasan<textarea value={form.excerpt} onChange={(e)=>setForm({...form,excerpt:e.target.value})} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal"/></label><label className="block text-xs font-black">Isi artikel<textarea value={form.body} onChange={(e)=>setForm({...form,body:e.target.value})} className="mt-2 min-h-64 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal leading-6"/></label><AdminField label="Tags (pisahkan koma)" value={tags} onChange={setTags}/><AdminField label="Link terkait (opsional)" value={form.externalLink??""} onChange={(value)=>setForm({...form,externalLink:value})}/><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-xs font-black text-slate-600"><ImagePlus size={17}/>Unggah foto sampul<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e)=>{const file=e.target.files?.[0];if(file)void upload(file)}}/></label>{form.coverKey&&<img src={coverUrl(form)} alt="Pratinjau sampul" className="aspect-[16/7] w-full rounded-xl object-cover"/>}<label className="flex items-center gap-2 text-xs font-black"><input type="checkbox" checked={form.published} onChange={(e)=>setForm({...form,published:e.target.checked})}/>Publikasikan di halaman login</label><button disabled={busy||!form.title||!form.slug||!form.excerpt||!form.body} onClick={()=>void save()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-xs font-black text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Simpan artikel</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Daftar artikel</h2><div className="mt-4 space-y-3">{articles.map((item)=><article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.published?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700"}`}>{item.published?"PUBLIK":"DRAFT"}</span><h3 className="mt-2 text-sm font-black">{item.title}</h3><p className="mt-1 text-[10px] text-slate-400">/articles/{item.slug}</p></div><div className="flex gap-1"><button onClick={()=>edit(item)} className="rounded-lg bg-sky-50 p-2 text-sky-700"><PencilLine size={14}/></button><button onClick={()=>void remove(item)} className="rounded-lg bg-rose-50 p-2 text-rose-700"><Trash2 size={14}/></button></div></div></article>)}{!articles.length&&<button onClick={useExample} className="w-full rounded-xl bg-teal-50 p-5 text-xs font-black text-teal-700">Belum ada artikel. Gunakan artikel contoh realistis.</button>}</div></section></div>;
}
function AdminField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <label className="block text-xs font-black">{label}<input value={value} onChange={(e)=>onChange(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal"/></label>}
