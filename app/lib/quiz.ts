export type QuizQuestion = {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function answerToIndex(value: unknown, choices: string[]) {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 0 && value < choices.length) return value;
    if (value >= 1 && value <= choices.length) return value - 1;
  }
  const text = cleanText(value).replace(/[.\s]/g, "").toUpperCase();
  if (/^[A-H]$/.test(text)) return text.charCodeAt(0) - 65;
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    if (number >= 1 && number <= choices.length) return number - 1;
    if (number >= 0 && number < choices.length) return number;
  }
  const matchingChoice = choices.findIndex((choice) => choice.toLowerCase() === cleanText(value).toLowerCase());
  return matchingChoice;
}

function normalizeQuestion(value: unknown): QuizQuestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const question = cleanText(item.question ?? item.pertanyaan ?? item.soal ?? item.text);
  const rawChoices = item.choices ?? item.options ?? item.pilihan ?? item.jawaban;
  const choices = Array.isArray(rawChoices)
    ? rawChoices.map(cleanText).filter(Boolean)
    : rawChoices && typeof rawChoices === "object"
      ? Object.values(rawChoices as Record<string, unknown>).map(cleanText).filter(Boolean)
      : [];
  const answerIndex = answerToIndex(item.answerIndex ?? item.correctIndex ?? item.correctAnswer ?? item.correct_answer ?? item.answer ?? item.kunci ?? item.kunciJawaban ?? item.jawabanBenar, choices);
  const explanation = cleanText(item.explanation ?? item.pembahasan ?? item.penjelasan);
  if (!question || choices.length < 2 || answerIndex < 0 || answerIndex >= choices.length) return null;
  return { question, choices, answerIndex, explanation };
}

function parseJson(text: string) {
  const withoutFence = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const candidates = [withoutFence];
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(withoutFence.slice(objectStart, objectEnd + 1));
  const arrayStart = withoutFence.indexOf("[");
  const arrayEnd = withoutFence.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(withoutFence.slice(arrayStart, arrayEnd + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const source = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? ((parsed as Record<string, unknown>).questions ?? (parsed as Record<string, unknown>).soal ?? (parsed as Record<string, unknown>).items)
          : null;
      if (!Array.isArray(source)) continue;
      const questions = source.map(normalizeQuestion).filter((item): item is QuizQuestion => item !== null);
      if (questions.length) return questions;
    } catch {
      // Continue with another JSON candidate, then fall back to the plain-text parser.
    }
  }
  return [];
}

function stripMarkup(text: string) {
  return text.replace(/^\s*[-*>#]+\s*/, "").replace(/\*\*/g, "").trim();
}

function parsePlainText(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const questions: QuizQuestion[] = [];
  let current: { question: string; choices: string[]; answerLabel: string; explanation: string; mode: "question" | "explanation" } | null = null;

  function finish() {
    if (!current) return;
    const answerIndex = answerToIndex(current.answerLabel, current.choices);
    if (current.question.trim() && current.choices.length >= 2 && answerIndex >= 0 && answerIndex < current.choices.length) {
      questions.push({ question: current.question.trim(), choices: current.choices, answerIndex, explanation: current.explanation.trim() });
    }
  }

  for (const rawLine of lines) {
    const line = stripMarkup(rawLine);
    if (!line) continue;
    const questionStart = line.match(/^(?:soal\s*)?\d+\s*[.):=-]\s*(.+)$/i);
    if (questionStart) {
      finish();
      current = { question: questionStart[1].trim(), choices: [], answerLabel: "", explanation: "", mode: "question" };
      continue;
    }
    if (!current) continue;
    const option = line.match(/^([A-Ha-h])\s*[.)]\s*(.+)$/);
    if (option) { current.choices.push(option[2].trim()); current.mode = "question"; continue; }
    const answer = line.match(/^(?:kunci(?:\s+jawaban)?|jawaban(?:\s+benar)?|answer)\s*[:=-]\s*(.+)$/i);
    if (answer) { current.answerLabel = answer[1].trim(); current.mode = "question"; continue; }
    const explanation = line.match(/^(?:pembahasan|penjelasan|explanation)\s*[:=-]\s*(.*)$/i);
    if (explanation) { current.explanation = explanation[1].trim(); current.mode = "explanation"; continue; }
    if (current.mode === "explanation") current.explanation += `${current.explanation ? " " : ""}${line}`;
    else if (current.choices.length === 0) current.question += ` ${line}`;
  }
  finish();
  return questions;
}

export function parseAiQuizText(text: string) {
  const input = text.trim();
  if (!input) return [];
  const jsonQuestions = parseJson(input);
  return jsonQuestions.length ? jsonQuestions : parsePlainText(input);
}
