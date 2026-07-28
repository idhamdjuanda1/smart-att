"use client";

import React, { useEffect, useState, useMemo } from "react";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Trophy, Zap, CheckCircle2, XCircle, Clock, Users, Sparkles, ArrowRight, Loader2 } from "lucide-react";

export type LiveQuizParticipant = {
  id: string;
  name: string;
  totalScore: number;
  joinedAtMs: number;
  answers?: Record<string, {
    choiceIndex: number;
    isCorrect: boolean;
    pointsEarned: number;
    timeSpentMs: number;
    answeredAtMs: number;
  }>;
};

export type LiveQuizSnapshotData = {
  id: string;
  type: "live_quiz";
  title: string;
  subject?: string;
  className?: string;
  accessCode: string;
  published: boolean;
  gameStatus: "lobby" | "question" | "reveal" | "podium";
  currentQuestionIndex: number;
  questionDurationSec: number;
  questionStartAtMs?: number;
  questions: Array<{
    question: string;
    choices: string[];
    answerIndex: number;
    explanation?: string;
  }>;
  participants?: Record<string, LiveQuizParticipant>;
  updatedAtMs?: number;
};

const KAHOOT_COLORS = [
  { bg: "bg-rose-600 hover:bg-rose-700 text-white border-rose-700", symbol: "▲", label: "A", ring: "ring-rose-400" },
  { bg: "bg-sky-600 hover:bg-sky-700 text-white border-sky-700", symbol: "◆", label: "B", ring: "ring-sky-400" },
  { bg: "bg-amber-500 hover:bg-amber-600 text-white border-amber-600", symbol: "●", label: "C", ring: "ring-amber-300" },
  { bg: "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700", symbol: "■", label: "D", ring: "ring-emerald-400" },
];

export function LiveQuizPlayer({ snapshotId }: { snapshotId: string }) {
  const [quizData, setQuizData] = useState<LiveQuizSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(15);

  // Sync snapshot
  useEffect(() => {
    if (!snapshotId) return;
    const unsubscribe = onSnapshot(
      doc(db, "publicSnapshots", snapshotId),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setError("Kuis live tidak ditemukan.");
          return;
        }
        const data = { id: snap.id, ...snap.data() } as LiveQuizSnapshotData;
        if (data.type !== "live_quiz" || !data.published) {
          setError("Kuis ini sedang tidak aktif.");
          return;
        }
        setQuizData(data);
      },
      () => {
        setLoading(false);
        setError("Gagal menghubungkan ke kuis live.");
      }
    );
    return () => unsubscribe();
  }, [snapshotId]);

  // Restore stored participant from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(`live_quiz_pid_${snapshotId}`);
    if (stored) setParticipantId(stored);
  }, [snapshotId]);

  // Current participant object
  const currentParticipant = useMemo(() => {
    if (!quizData?.participants || !participantId) return null;
    return quizData.participants[participantId] || null;
  }, [quizData?.participants, participantId]);

  // List of all participants sorted by score
  const sortedParticipants = useMemo(() => {
    if (!quizData?.participants) return [];
    return Object.values(quizData.participants).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  }, [quizData?.participants]);

  // Current Rank
  const currentRank = useMemo(() => {
    if (!participantId || !sortedParticipants.length) return 0;
    const idx = sortedParticipants.findIndex((p) => p.id === participantId);
    return idx >= 0 ? idx + 1 : 0;
  }, [sortedParticipants, participantId]);

  // Current Question
  const currentQuestion = useMemo(() => {
    if (!quizData || quizData.currentQuestionIndex == null) return null;
    return quizData.questions[quizData.currentQuestionIndex] || null;
  }, [quizData]);

  // Handle Question Timer
  useEffect(() => {
    if (!quizData || quizData.gameStatus !== "question" || !quizData.questionStartAtMs) return;

    const duration = (quizData.questionDurationSec || 15) * 1000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - (quizData.questionStartAtMs || Date.now());
      const remainingSec = Math.max(0, Math.ceil((duration - elapsed) / 1000));
      setTimeRemaining(remainingSec);
    }, 200);

    return () => clearInterval(interval);
  }, [quizData?.gameStatus, quizData?.questionStartAtMs, quizData?.questionDurationSec, quizData?.currentQuestionIndex]);

  // Reset selected choice on question change
  useEffect(() => {
    if (quizData?.currentQuestionIndex != null && currentParticipant?.answers) {
      const ans = currentParticipant.answers[String(quizData.currentQuestionIndex)];
      if (ans) setSelectedChoice(ans.choiceIndex);
      else setSelectedChoice(null);
    } else {
      setSelectedChoice(null);
    }
  }, [quizData?.currentQuestionIndex, currentParticipant?.answers]);

  // Action: Join Game
  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = playerName.trim();
    if (!cleanName || !quizData) return;

    setJoining(true);
    const pid = `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newParticipant: LiveQuizParticipant = {
      id: pid,
      name: cleanName,
      totalScore: 0,
      joinedAtMs: Date.now(),
      answers: {},
    };

    try {
      await updateDoc(doc(db, "publicSnapshots", quizData.id), {
        [`participants.${pid}`]: newParticipant,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
      setParticipantId(pid);
      if (typeof window !== "undefined") {
        localStorage.setItem(`live_quiz_pid_${quizData.id}`, pid);
      }
    } catch {
      setError("Gagal bergabung ke kuis. Coba lagi.");
    } finally {
      setJoining(false);
    }
  }

  // Action: Submit Answer
  async function handleAnswerSelect(choiceIdx: number) {
    if (!quizData || !participantId || !currentParticipant || quizData.gameStatus !== "question" || selectedChoice !== null) return;

    const qIdx = quizData.currentQuestionIndex;
    const qObj = quizData.questions[qIdx];
    if (!qObj) return;

    setSelectedChoice(choiceIdx);

    const isCorrect = choiceIdx === qObj.answerIndex;
    const startMs = quizData.questionStartAtMs || Date.now();
    const nowMs = Date.now();
    const timeSpentMs = Math.max(0, nowMs - startMs);
    const durationMs = (quizData.questionDurationSec || 15) * 1000;

    // Speed Score calculation: Correct answer gives up to 1000 pts (min 500 for last second)
    let pointsEarned = 0;
    if (isCorrect) {
      const speedRatio = Math.max(0, Math.min(1, 1 - timeSpentMs / durationMs));
      pointsEarned = Math.round(500 + 500 * speedRatio);
    }

    const newTotalScore = (currentParticipant.totalScore || 0) + pointsEarned;

    try {
      await updateDoc(doc(db, "publicSnapshots", quizData.id), {
        [`participants.${participantId}.answers.${qIdx}`]: {
          choiceIndex: choiceIdx,
          isCorrect,
          pointsEarned,
          timeSpentMs,
          answeredAtMs: nowMs,
        },
        [`participants.${participantId}.totalScore`]: newTotalScore,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to submit answer:", err);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-white p-4">
        <div className="text-center">
          <Loader2 className="mx-auto animate-spin text-teal-400" size={42} />
          <p className="mt-4 text-sm font-bold text-slate-300">Menghubungkan ke Kuis Live...</p>
        </div>
      </main>
    );
  }

  if (error || !quizData) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-white p-4">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-8 text-center shadow-2xl">
          <XCircle className="mx-auto text-rose-500" size={48} />
          <h1 className="mt-4 text-xl font-black">{error || "Kuis Tidak Tersedia"}</h1>
          <p className="mt-2 text-xs text-slate-400">Pastikan kode yang dimasukkan sudah benar atau minta link kuis dari guru.</p>
          <button onClick={() => window.location.assign("/link")} className="mt-6 w-full rounded-2xl bg-teal-600 py-3.5 text-xs font-black text-white hover:bg-teal-500">
            Kembali ke Portal Link
          </button>
        </div>
      </main>
    );
  }

  // STEP 1: Name Entry Form
  if (!currentParticipant) {
    return (
      <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-teal-950 to-slate-950 p-4 text-white">
        <div className="w-full max-w-md overflow-hidden rounded-[2.5rem] border border-teal-500/20 bg-slate-900/90 p-8 backdrop-blur-xl shadow-2xl shadow-teal-950/50">
          <div className="text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-400 text-slate-950 shadow-lg shadow-teal-500/30">
              <Zap size={32} className="fill-slate-950" />
            </div>
            <span className="mt-4 inline-block rounded-full bg-teal-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-400 border border-teal-500/20">
              Kuis Live Interaktif
            </span>
            <h1 className="mt-2 text-2xl font-black text-white">{quizData.title}</h1>
            <p className="mt-1 text-xs text-slate-400">{quizData.className ? `Kelas ${quizData.className}` : "Kuis Intermezo"} · Kode: <strong className="font-mono text-teal-300">{quizData.accessCode}</strong></p>
          </div>

          <form onSubmit={handleJoin} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-black text-slate-300">Masukkan Nama Kamu</span>
              <input
                autoFocus
                required
                maxLength={30}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Contoh: Budi, Aisyah, Rendy..."
                className="h-14 w-full rounded-2xl border-2 border-slate-700 bg-slate-800 px-5 text-center text-lg font-black text-white outline-none transition placeholder:text-sm placeholder:font-semibold placeholder:text-slate-500 focus:border-teal-400 focus:ring-4 focus:ring-teal-400/20"
              />
            </label>

            <button
              disabled={joining || !playerName.trim()}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 text-base font-black text-slate-950 shadow-lg shadow-teal-500/25 transition hover:brightness-110 disabled:opacity-50"
            >
              {joining ? <Loader2 className="animate-spin" size={20} /> : <>Bergabung Sekarang <ArrowRight size={18} /></>}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // STEP 2: Waiting Lobby
  if (quizData.gameStatus === "lobby") {
    return (
      <main className="min-h-screen bg-slate-950 text-white p-4 sm:p-6">
        <div className="mx-auto max-w-md text-center pt-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/10 px-4 py-2 text-xs font-black text-teal-400 border border-teal-500/20 animate-pulse">
            <Sparkles size={16} /> Menunggu Guru Memulai Kuis...
          </div>

          <h1 className="mt-6 text-3xl font-black text-white">Halo, {currentParticipant.name}! 👋</h1>
          <p className="mt-2 text-xs text-slate-400">Kamu sudah masuk di lobby. Bersiaplah menjawab soal dengan cepat!</p>

          <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-left shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2 text-slate-300 font-bold text-xs">
                <Users size={16} className="text-teal-400" /> Peserta Bergabung ({sortedParticipants.length})
              </div>
              <span className="font-mono text-xs font-black text-teal-400">#Kode: {quizData.accessCode}</span>
            </div>

            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
              {sortedParticipants.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 text-xs font-bold ${
                    p.id === currentParticipant.id ? "bg-teal-500/20 border border-teal-500/40 text-teal-300" : "bg-slate-800/60 text-slate-300"
                  }`}
                >
                  <span className="truncate">{p.name} {p.id === currentParticipant.id ? "(Kamu)" : ""}</span>
                  <span className="text-[10px] text-slate-500">Ready ⚡</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // STEP 5: Final Podium & Game Over
  if (quizData.gameStatus === "podium") {
    const top3 = sortedParticipants.slice(0, 3);
    const p1 = top3[0];
    const p2 = top3[1];
    const p3 = top3[2];

    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-950 via-teal-950 to-slate-950 text-white p-4 sm:p-6">
        <div className="mx-auto max-w-lg text-center pt-6">
          <Trophy size={56} className="mx-auto text-amber-400 animate-bounce" />
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Panggung Juara! 🏆</h1>
          <p className="mt-1 text-xs text-slate-300">Kuis Selesai · Hasil Akhir Pertandingan</p>

          {/* Podium Visual */}
          <div className="mt-8 flex items-end justify-center gap-3 px-2">
            {/* Rank 2 */}
            <div className="flex-1 text-center">
              {p2 ? (
                <>
                  <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-slate-300 text-slate-950 font-black text-sm shadow-md">
                    2
                  </div>
                  <p className="truncate text-xs font-black text-slate-200">{p2.name}</p>
                  <p className="text-[10px] font-extrabold text-amber-300">{p2.totalScore} pts</p>
                  <div className="mt-2 h-24 rounded-t-2xl bg-gradient-to-t from-slate-700 to-slate-500 border-t-2 border-slate-300 flex items-center justify-center font-black text-xl text-slate-950 shadow-lg">
                    🥈
                  </div>
                </>
              ) : (
                <div className="h-24" />
              )}
            </div>

            {/* Rank 1 */}
            <div className="flex-1 text-center">
              {p1 ? (
                <>
                  <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-amber-400 text-slate-950 font-black text-base shadow-xl ring-4 ring-amber-400/30">
                    1
                  </div>
                  <p className="truncate text-sm font-black text-amber-300">{p1.name}</p>
                  <p className="text-xs font-black text-amber-400">{p1.totalScore} pts</p>
                  <div className="mt-2 h-36 rounded-t-2xl bg-gradient-to-t from-amber-600 to-amber-400 border-t-2 border-amber-200 flex items-center justify-center font-black text-3xl text-slate-950 shadow-2xl">
                    👑
                  </div>
                </>
              ) : (
                <div className="h-36" />
              )}
            </div>

            {/* Rank 3 */}
            <div className="flex-1 text-center">
              {p3 ? (
                <>
                  <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-amber-700 text-white font-black text-sm shadow-md">
                    3
                  </div>
                  <p className="truncate text-xs font-black text-amber-200">{p3.name}</p>
                  <p className="text-[10px] font-extrabold text-amber-300">{p3.totalScore} pts</p>
                  <div className="mt-2 h-16 rounded-t-2xl bg-gradient-to-t from-amber-900 to-amber-700 border-t-2 border-amber-500 flex items-center justify-center font-black text-lg text-white shadow-lg">
                    🥉
                  </div>
                </>
              ) : (
                <div className="h-16" />
              )}
            </div>
          </div>

          {/* Student's Personal Rank Card */}
          <div className="mt-8 rounded-3xl border border-teal-500/30 bg-teal-950/40 p-5 text-center shadow-xl backdrop-blur-md">
            <p className="text-xs font-bold text-slate-400">Hasil Kamu:</p>
            <p className="mt-1 text-2xl font-black text-teal-300">
              Peringkat ke-{currentRank} dari {sortedParticipants.length} Peserta!
            </p>
            <p className="mt-1 text-sm font-bold text-white">Total Skor: {currentParticipant.totalScore} Poin ⚡</p>
          </div>

          <button onClick={() => window.location.assign("/link")} className="mt-6 w-full rounded-2xl bg-teal-600 py-3.5 text-xs font-black text-white hover:bg-teal-500">
            Kembali ke Portal Link
          </button>
        </div>
      </main>
    );
  }

  // STEP 3 & 4: Active Question / Reveal State
  const qIdx = quizData.currentQuestionIndex;
  const totalQ = quizData.questions.length;
  const answeredCurrent = currentParticipant?.answers?.[String(qIdx)];

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 flex flex-col justify-between">
      {/* Top Header Bar */}
      <div>
        <div className="flex items-center justify-between rounded-2xl bg-slate-900 border border-slate-800 px-4 py-3 shadow-md">
          <div>
            <p className="text-[10px] font-black tracking-wider text-teal-400 uppercase">
              SOAL {qIdx + 1} DARI {totalQ}
            </p>
            <p className="text-xs font-black truncate max-w-[180px] sm:max-w-none text-white">
              {currentParticipant.name} (Peringkat #{currentRank})
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-xl bg-teal-500/20 border border-teal-500/40 px-3 py-1.5 text-xs font-black text-teal-300">
              <Zap size={14} className="fill-teal-300" /> {currentParticipant.totalScore} pts
            </div>

            {quizData.gameStatus === "question" && (
              <div
                className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black ${
                  timeRemaining <= 5 ? "bg-rose-600 text-white animate-bounce" : "bg-slate-800 text-amber-400"
                }`}
              >
                <Clock size={14} /> {timeRemaining}s
              </div>
            )}
          </div>
        </div>

        {/* Question Text Box on Student's Phone */}
        <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Pertanyaan:</p>
          <h2 className="text-lg sm:text-xl font-black leading-relaxed text-white">
            {currentQuestion?.question || "Memuat Soal..."}
          </h2>
        </div>
      </div>

      {/* Answer Feedback in Reveal Mode */}
      {quizData.gameStatus === "reveal" && (
        <div className="my-4 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center shadow-2xl animate-fade-in">
          {answeredCurrent ? (
            answeredCurrent.isCorrect ? (
              <div className="text-emerald-400 space-y-2">
                <CheckCircle2 size={48} className="mx-auto" />
                <h3 className="text-2xl font-black">+ {answeredCurrent.pointsEarned} Poin! ⚡</h3>
                <p className="text-xs text-emerald-200">Hebat! Jawabanmu Benar dan Cepat!</p>
              </div>
            ) : (
              <div className="text-rose-400 space-y-2">
                <XCircle size={48} className="mx-auto" />
                <h3 className="text-2xl font-black">Jawaban Kurang Tepat</h3>
                <p className="text-xs text-rose-200">
                  Jawaban Benar: <strong>{currentQuestion?.choices[currentQuestion.answerIndex]}</strong>
                </p>
              </div>
            )
          ) : (
            <div className="text-amber-400 space-y-2">
              <Clock size={48} className="mx-auto" />
              <h3 className="text-2xl font-black">Waktu Habis!</h3>
              <p className="text-xs text-amber-200">Kamu belum sempat menekan jawaban di soal ini.</p>
            </div>
          )}
        </div>
      )}

      {/* 4 Kahoot-Style Colored Choice Buttons on Student's Phone */}
      <div className="my-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {currentQuestion?.choices.map((choiceText, index) => {
          const style = KAHOOT_COLORS[index % KAHOOT_COLORS.length];
          const isSelected = selectedChoice === index;
          const isCorrectChoice = quizData.gameStatus === "reveal" && index === currentQuestion.answerIndex;
          const isWrongSelected = quizData.gameStatus === "reveal" && isSelected && !isCorrectChoice;

          return (
            <button
              key={index}
              disabled={quizData.gameStatus !== "question" || selectedChoice !== null}
              onClick={() => handleAnswerSelect(index)}
              className={`relative flex items-center gap-4 rounded-2xl border-2 p-4 text-left font-black transition-all transform active:scale-95 disabled:opacity-80 ${style.bg} ${
                isSelected ? `ring-4 ${style.ring} shadow-xl scale-[1.02]` : ""
              } ${isCorrectChoice ? "ring-4 ring-emerald-400 bg-emerald-600" : ""} ${
                isWrongSelected ? "opacity-40 grayscale" : ""
              }`}
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/20 text-lg font-black text-white">
                {style.symbol}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold opacity-80 uppercase tracking-wider">
                  Pilihan {style.label}
                </span>
                <span className="text-base sm:text-lg leading-snug break-words">{choiceText}</span>
              </div>
              {isSelected && (
                <div className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-950 font-black text-xs shadow">
                  ✓
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Status Bar */}
      <div className="text-center py-2 text-xs font-bold text-slate-400">
        {quizData.gameStatus === "question" ? (
          selectedChoice !== null ? (
            <span className="text-teal-400">✓ Jawaban tersimpan! Menunggu waktu habis...</span>
          ) : (
            <span>Pilih jawaban secepat mungkin di layar HP kamu!</span>
          )
        ) : (
          <span className="text-slate-400">Menunggu guru melanjutkan ke soal berikutnya...</span>
        )}
      </div>
    </main>
  );
}
