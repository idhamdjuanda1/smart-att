type AttendanceLookupStudent = {
  id: string;
  nis: unknown;
};

export function canonicalNis(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text.toLowerCase();
}

export function findStudentByQrOrNis<T extends AttendanceLookupStudent>(students: T[], raw: string) {
  const input = raw.trim();
  if (!input) return undefined;

  let qrStudentId = "";
  let qrNis = "";
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === "object") {
      const qr = parsed as { studentId?: unknown; nis?: unknown };
      qrStudentId = typeof qr.studentId === "string" ? qr.studentId.trim() : "";
      qrNis = qr.nis == null ? "" : String(qr.nis).trim();
    }
  } catch {
    // Input non-JSON dapat berupa Student ID dari QR baru atau NIS manual biasa.
  }

  const directStudent = students.find((student) => student.id === (qrStudentId || input));
  if (directStudent) return directStudent;

  const expectedNis = canonicalNis(qrNis || input);
  return students.find((student) =>
    (Boolean(qrStudentId) && student.id === qrStudentId) ||
    canonicalNis(student.nis) === expectedNis
  );
}
