export type CsvStudent = {
  attendanceNumber: string;
  nis: string;
  nisn: string;
  name: string;
  className: string;
  guardian: string;
  phone: string;
};

export type CsvParseResult = {
  students: CsvStudent[];
  skippedRows: number;
  delimiter: string;
  error?: string;
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

export function parseStudentsCsv(text: string, defaultClassName = "VII A"): CsvParseResult {
  const cleanText = text.replace(/^\uFEFF/, "").trim();
  if (!cleanText) return { students: [], skippedRows: 0, delimiter: ",", error: "File CSV kosong." };

  const delimiter = detectDelimiter(cleanText);
  const rows = parseRows(cleanText, delimiter);
  if (rows.length < 2) return { students: [], skippedRows: 0, delimiter, error: "CSV tidak memiliki baris data." };

  const headers = rows[0].map(normalizeHeader);
  const nisIndex = findColumn(headers, ["nis", "nomorinduksiswa", "nomorinduk"]);
  const nisnIndex = findColumn(headers, ["nisn", "nomorinduksiswanasional", "nomorinduknasional"]);
  const attendanceNumberIndex = findColumn(headers, ["no", "nomor", "noabsen", "nomorabsen"]);
  const nameIndex = findColumn(headers, ["nama", "namasiswa", "namalengkap"]);
  const classIndex = findColumn(headers, ["kelas", "rombel", "classname"]);
  const guardianIndex = findColumn(headers, ["wali", "walimurid", "namawali", "namaorangtua", "namaorangtuawali"]);
  const phoneIndex = findColumn(headers, ["nowa", "nomorwa", "whatsapp", "nomorwhatsapp", "telepon", "hp"]);

  if (nisIndex < 0 || nisnIndex < 0 || nameIndex < 0) {
    return {
      students: [],
      skippedRows: rows.length - 1,
      delimiter,
      error: "Header wajib NIS, NISN, dan Nama Siswa tidak ditemukan.",
    };
  }

  const seenNis = new Set<string>();
  const seenNisn = new Set<string>();
  const students: CsvStudent[] = [];
  let skippedRows = 0;

  for (const row of rows.slice(1)) {
    const nis = (row[nisIndex] ?? "").trim();
    const nisn = (row[nisnIndex] ?? "").trim();
    const name = (row[nameIndex] ?? "").trim();
    if (!nis || !nisn || !name || seenNis.has(nis) || seenNisn.has(nisn)) {
      skippedRows += 1;
      continue;
    }
    seenNis.add(nis);
    seenNisn.add(nisn);
    students.push({
      attendanceNumber: (attendanceNumberIndex >= 0 ? row[attendanceNumberIndex] : "")?.trim() || String(students.length + 1),
      nis,
      nisn,
      name,
      className: (classIndex >= 0 ? row[classIndex] : "")?.trim() || defaultClassName,
      guardian: (guardianIndex >= 0 ? row[guardianIndex] : "")?.trim() || "",
      phone: (phoneIndex >= 0 ? row[phoneIndex] : "")?.trim() || "",
    });
  }

  return { students, skippedRows, delimiter };
}
