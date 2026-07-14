import type { QuizQuestion } from "./quiz";

export type RandomizedQuestion = {
  originalQuestionIndex: number;
  question: string;
  explanation: string;
  answerIndex: number;
  choices: { text: string; originalChoiceIndex: number }[];
};

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  if (result.length > 1 && result.every((item, index) => Object.is(item, items[index]))) {
    result.push(result.shift() as T);
  }
  return result;
}

export function createRandomizedQuiz(questions: QuizQuestion[], seed: string) {
  const random = seededRandom(seed);
  return shuffle(questions.map((question, originalQuestionIndex) => ({
    originalQuestionIndex,
    question: question.question,
    explanation: question.explanation,
    answerIndex: question.answerIndex,
    choices: shuffle(question.choices.map((text, originalChoiceIndex) => ({ text, originalChoiceIndex })), random),
  })), random) satisfies RandomizedQuestion[];
}

export function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}
