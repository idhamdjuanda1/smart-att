export const PUBLIC_APP_ORIGIN = "https://smart-att.web.id";
export const QUIZ_ACCESS_CODE_LENGTH = 4;

const QUIZ_CODE_ALPHABET = "0123456789";
const QUIZ_ACCESS_CODE_PATTERN = /^(?:\d{4}|[A-HJ-NP-Z2-9]{10})$/;

export type ParsedQuizLinkInput =
  | { kind: "accessCode"; value: string }
  | { kind: "snapshotId"; value: string };

function decodePathSegment(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function normalizeQuizAccessCode(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  return QUIZ_ACCESS_CODE_PATTERN.test(normalized) ? normalized : "";
}

export function generateQuizAccessCode(randomBytes?: Uint8Array) {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(QUIZ_ACCESS_CODE_LENGTH));
  if (bytes.length < QUIZ_ACCESS_CODE_LENGTH) throw new Error("Random bytes tidak mencukupi untuk kode quiz.");
  return Array.from(bytes.slice(0, QUIZ_ACCESS_CODE_LENGTH), (value) => QUIZ_CODE_ALPHABET[value % QUIZ_CODE_ALPHABET.length]).join("");
}

export function parseQuizLinkInput(rawValue: string): ParsedQuizLinkInput | null {
  let value = rawValue.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
    try {
      const url = new URL(value, PUBLIC_APP_ORIGIN);
      const segments = url.pathname.split("/").filter(Boolean).map(decodePathSegment);
      if (segments[0] === "public" && segments[1] === "quiz" && segments[2]) {
        return { kind: "snapshotId", value: segments[2] };
      }
      if (["link", "quiz", "soal"].includes(segments[0] ?? "") && segments[1]) value = segments[1];
      else return null;
    } catch { return null; }
  }

  const accessCode = normalizeQuizAccessCode(value);
  if (accessCode) return { kind: "accessCode", value: accessCode };
  if (/^[A-Za-z0-9_-]{1,250}$/.test(value)) return { kind: "snapshotId", value };
  return null;
}

export function publicQuizPortalOrigin(currentOrigin?: string) {
  if (!currentOrigin) return PUBLIC_APP_ORIGIN;
  try {
    const url = new URL(currentOrigin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return url.origin;
  } catch {}
  return PUBLIC_APP_ORIGIN;
}

export function buildQuizShortUrl(accessCode: string, currentOrigin?: string) {
  const normalized = normalizeQuizAccessCode(accessCode);
  if (!normalized) throw new Error("Kode quiz tidak valid.");
  return `${publicQuizPortalOrigin(currentOrigin)}/link/${normalized}`;
}
