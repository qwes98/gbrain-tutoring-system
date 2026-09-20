export const MAX_PDF_FILE_BYTES = 20 * 1024 * 1024;

export type PdfFileValidation =
  | { ok: true }
  | { ok: false; message: string };

const decoder = new TextDecoder("latin1");
const MAX_PDF_PREAMBLE_BYTES = 1_023;
const MAX_STARTXREF_CANDIDATES = 128;
const TRAILER_SCAN_CHUNK_BYTES = 64 * 1_024;
const TRAILER_SCAN_OVERLAP_BYTES = 512;

async function hasPlausibleXrefTarget(file: File, offset: number): Promise<boolean> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= file.size) return false;
  const target = decoder.decode(await file.slice(offset, Math.min(file.size, offset + 1_024)).arrayBuffer());
  const table = /^xref[ \t]*(?:\r\n|\r|\n)[ \t]*\d+[ \t]+\d+[ \t]*(?:\r\n|\r|\n)/;
  const stream = /^\d+[ \t]+\d+[ \t]+obj\b[\s\S]{0,768}\/Type[ \t]*\/XRef\b/;
  return table.test(target) || stream.test(target);
}

async function hasValidFinalTrailer(file: File, headerOffset: number): Promise<boolean> {
  let end = file.size;
  let laterPrefix = "";
  const checkedOffsets = new Set<number>();

  while (end > 0) {
    const start = Math.max(0, end - TRAILER_SCAN_CHUNK_BYTES);
    const chunk = decoder.decode(await file.slice(start, end).arrayBuffer());
    const window = chunk + laterPrefix;
    const candidates = Array.from(window.matchAll(/startxref\s+(\d+)\s+%%EOF/g));
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const offset = Number(candidates[index]![1]);
      if (checkedOffsets.has(offset)) continue;
      if (checkedOffsets.size >= MAX_STARTXREF_CANDIDATES) return false;
      checkedOffsets.add(offset);
      if (await hasPlausibleXrefTarget(file, offset + headerOffset)) return true;
      if (headerOffset !== 0 && await hasPlausibleXrefTarget(file, offset)) return true;
    }
    laterPrefix = window.slice(0, TRAILER_SCAN_OVERLAP_BYTES);
    end = start;
  }

  return false;
}

export async function validatePdfFile(file: File): Promise<PdfFileValidation> {
  if (file.size > MAX_PDF_FILE_BYTES) {
    return { ok: false, message: "PDF files must be 20 MB or smaller." };
  }
  const mediaType = file.type.trim().toLowerCase();
  if ((mediaType !== "" && mediaType !== "application/pdf") || !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Choose a valid PDF file." };
  }

  const headerWindow = decoder.decode(await file.slice(
    0,
    Math.min(file.size, MAX_PDF_PREAMBLE_BYTES + 16),
  ).arrayBuffer());
  const header = /%PDF-\d\.\d[ \t]*(?:\r\n|\r|\n)/.exec(headerWindow);
  if (!header) {
    if (headerWindow.includes("%PDF-")) {
      return { ok: false, message: "Choose a complete, valid PDF file." };
    }
    return { ok: false, message: "Choose a valid PDF file." };
  }
  if (header.index > MAX_PDF_PREAMBLE_BYTES || !await hasValidFinalTrailer(file, header.index)) {
    return { ok: false, message: "Choose a complete, valid PDF file." };
  }

  return { ok: true };
}
