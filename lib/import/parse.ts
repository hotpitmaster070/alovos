import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  validateRows,
  type ImportError,
  type ImportField,
  type ImportRow,
  type RawImportRow,
} from "./validation";

export const IMPORT_FILE_ERRORS = ["empty", "unsupported", "too_large", "too_many_rows", "no_name_column", "unreadable"] as const;
export type ImportFileError = (typeof IMPORT_FILE_ERRORS)[number];

export type ParsedCatalog =
  | {
      ok: true;
      /** Recognised columns, in file order. */
      columns: ImportField[];
      /** Header texts that match no column; their cells are ignored. */
      ignored: string[];
      rows: RawImportRow[];
      valid: ImportRow[];
      errors: ImportError[];
    }
  | { ok: false; error: ImportFileError };

const normalizeHeader = (value: string): string =>
  value
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-./()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Header texts a file may use for each column, in the three languages; the key itself always matches. */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  name: ["название", "наименование", "товар", "продукт", "ad", "adı", "məhsul", "mehsul", "product", "product name"],
  unit: ["ед", "ед изм", "единица", "единица измерения", "vahid", "ölçü vahidi", "uom"],
  barcode: ["штрихкод", "штрих код", "ean", "barkod", "barcode ean"],
  category: ["категория", "группа", "kateqoriya", "qrup", "group"],
  price: ["цена", "себестоимость", "закупочная цена", "qiymət", "qiymet", "cost", "unit price"],
  shelf_life_days: ["срок хранения", "срок хранения дней", "дней хранения", "saxlama müddəti", "shelf life", "shelf life days"],
  min_stock: ["минимум", "мин остаток", "минимальный остаток", "par", "par level", "minimum", "minimal qalıq"],
  initial_stock: ["остаток", "количество", "кол во", "начальный остаток", "qalıq", "miqdar", "qty", "quantity", "stock"],
  location: ["место", "место хранения", "склад", "saxlama yeri", "yer", "storage", "storage location"],
  expiry_date: ["годен до", "срок годности", "срок до", "son istifadə tarixi", "son tarix", "expiry", "expiry date", "use by"],
};

const HEADER_INDEX = new Map<string, ImportField>();
for (const field of IMPORT_FIELDS) {
  HEADER_INDEX.set(normalizeHeader(field), field);
  for (const alias of HEADER_ALIASES[field]) HEADER_INDEX.set(normalizeHeader(alias), field);
}

export const headerField = (header: string): ImportField | null => HEADER_INDEX.get(normalizeHeader(header)) ?? null;

const pad = (value: number) => String(value).padStart(2, "0");

/** Text of an Excel cell; dates become YYYY-MM-DD (Excel dates carry no time zone). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return String(value.text ?? "");
  if ("formula" in value || "sharedFormula" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
  return "";
}

async function excelLines(bytes: Uint8Array): Promise<string[][] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const lines: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, number) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cellText(cell.value);
    });
    lines[number - 1] = Array.from(cells, (cell) => cell ?? "");
  });
  return Array.from(lines, (line) => line ?? []);
}

function csvLines(bytes: Uint8Array): string[][] {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimitersToGuess: [",", ";", "\t", "|"] });
  return parsed.data;
}

const extension = (fileName: string) => fileName.toLowerCase().split(".").pop() ?? "";

/** File lines -> recognised columns and rows (line numbers kept), then the per-row checks. */
export function readLines(lines: string[][]): ParsedCatalog {
  const headerAt = lines.findIndex((line) => line.some((cell) => cell.trim() !== ""));
  if (headerAt < 0) return { ok: false, error: "empty" };

  const header = lines[headerAt];
  const columns: { index: number; field: ImportField }[] = [];
  const ignored: string[] = [];
  const seen = new Set<ImportField>();
  header.forEach((text, index) => {
    const field = headerField(text);
    if (field && !seen.has(field)) {
      seen.add(field);
      columns.push({ index, field });
    } else if (text.trim() !== "") {
      ignored.push(text.trim());
    }
  });
  if (!seen.has("name")) return { ok: false, error: "no_name_column" };

  const rows: RawImportRow[] = [];
  for (let at = headerAt + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? [];
    if (!line.some((cell) => (cell ?? "").trim() !== "")) continue;
    const values: RawImportRow["values"] = {};
    for (const { index, field } of columns) values[field] = (line[index] ?? "").trim();
    rows.push({ row: at + 1, values });
  }
  if (rows.length === 0) return { ok: false, error: "empty" };
  if (rows.length > IMPORT_MAX_ROWS) return { ok: false, error: "too_many_rows" };

  return { ok: true, columns: columns.map((column) => column.field), ignored, rows, ...validateRows(rows) };
}

/** A CSV (UTF-8, comma / semicolon / tab) or XLSX catalog file: first sheet, first non-empty line is the header. */
export async function parseCatalogFile(bytes: Uint8Array, fileName: string): Promise<ParsedCatalog> {
  if (bytes.byteLength === 0) return { ok: false, error: "empty" };
  if (bytes.byteLength > IMPORT_MAX_BYTES) return { ok: false, error: "too_large" };
  const kind = extension(fileName);
  if (kind === "csv" || kind === "txt") return readLines(csvLines(bytes));
  if (kind === "xlsx") {
    const lines = await excelLines(bytes);
    return lines === null ? { ok: false, error: "unreadable" } : readLines(lines);
  }
  return { ok: false, error: "unsupported" };
}
