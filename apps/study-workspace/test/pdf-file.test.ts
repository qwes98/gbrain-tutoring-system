import { describe, expect, test } from "bun:test";
import { MAX_PDF_FILE_BYTES, validatePdfFile } from "../src/pdf-file.ts";

interface PdfFixtureOptions {
  preamble?: string;
  header?: string;
  trailing?: string;
  xrefLineEnding?: "\r" | "\n" | "\r\n";
  xrefOffsetMode?: "header-relative" | "absolute";
  xrefSubsectionWhitespace?: string;
}

function validPdfBytes(options: PdfFixtureOptions = {}): string {
  const preamble = options.preamble ?? "";
  const header = options.header ?? "%PDF-1.4\n";
  const chunks = [
    `${preamble}${header}`,
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  const offsets: number[] = [];
  let cursor = header.length;
  for (const chunk of chunks.slice(1)) {
    offsets.push(cursor);
    cursor += chunk.length;
  }
  const offsetBase = options.xrefOffsetMode === "absolute" ? preamble.length : 0;
  const xrefOffset = cursor + offsetBase;
  const entries = offsets.map((offset) => `${String(offset + offsetBase).padStart(10, "0")} 00000 n \n`).join("");
  const xrefLineEnding = options.xrefLineEnding ?? "\n";
  const subsectionWhitespace = options.xrefSubsectionWhitespace ?? "";
  return `${chunks.join("")}xref${xrefLineEnding}0 5${subsectionWhitespace}${xrefLineEnding}0000000000 65535 f \n${entries}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n${options.trailing ?? ""}`;
}

function xrefStreamPdf(preambleLength: number): string {
  const preamble = "P".repeat(preambleLength);
  const header = "%PDF-1.7\n";
  const body = "1 0 obj\n<< /Type /Catalog >>\nendobj\n";
  const xrefOffset = header.length + body.length;
  return `${preamble}${header}${body}5 0 obj\n<< /Type /XRef /Size 6 /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`;
}

function incrementallyUpdatedPdf(): string {
  const original = validPdfBytes();
  const objectOffset = original.length;
  const object = "5 0 obj\n<< /Producer (incremental update) >>\nendobj\n";
  const xrefOffset = objectOffset + object.length;
  return `${original}${object}xref\n5 1\n${String(objectOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\ntrailing transport bytes`;
}

const validPdf = validPdfBytes();

class SliceCountingFile extends File {
  sliceCalls = 0;

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.sliceCalls += 1;
    return super.slice(start, end, contentType);
  }
}

describe("PDF file intake", () => {
  test("accepts a bounded PDF whose media type and bytes identify a complete PDF", async () => {
    const file = new File([validPdf], "chapter.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("accepts pdf.js-compatible preamble, header whitespace, and trailing bytes", async () => {
    const file = new File([validPdfBytes({
      preamble: "P".repeat(512),
      header: "%PDF-1.7 \t\n",
      trailing: "transport padding after the final marker",
    })], "chapter.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("resolves classic xref offsets relative to the PDF header", async () => {
    for (const preambleLength of [1, 512]) {
      const file = new File([validPdfBytes({ preamble: "P".repeat(preambleLength) })], `classic-${preambleLength}.pdf`, {
        type: "application/pdf",
      });

      await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
    }
  });

  test("resolves xref-stream-like offsets relative to the PDF header", async () => {
    const file = new File([xrefStreamPdf(512)], "stream.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("accepts a header at byte 1023 and rejects one at byte 1024", async () => {
    const accepted = new File([validPdfBytes({ preamble: "P".repeat(1_023) })], "accepted.pdf", {
      type: "application/pdf",
    });
    const rejected = new File([validPdfBytes({ preamble: "P".repeat(1_024) })], "rejected.pdf", {
      type: "application/pdf",
    });

    await expect(validatePdfFile(accepted)).resolves.toEqual({ ok: true });
    await expect(validatePdfFile(rejected)).resolves.toEqual({
      ok: false,
      message: "Choose a complete, valid PDF file.",
    });
  });

  test("falls back to an absolute startxref offset for compatibility", async () => {
    const file = new File([validPdfBytes({
      preamble: "P",
      xrefOffsetMode: "absolute",
    })], "absolute.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("accepts the final valid trailer in an incrementally updated PDF", async () => {
    const file = new File([incrementallyUpdatedPdf()], "chapter.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("accepts classic xref subsection whitespace before CR, LF, and CRLF", async () => {
    for (const lineEnding of ["\r", "\n", "\r\n"] as const) {
      const file = new File([validPdfBytes({
        xrefLineEnding: lineEnding,
        xrefSubsectionWhitespace: " \t",
      })], `classic-${lineEnding.length}.pdf`, { type: "application/pdf" });

      await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
    }
  });

  test("accepts an empty picker MIME when the extension and bytes validate", async () => {
    const file = new File([validPdf], "chapter.pdf", { type: "" });

    await expect(validatePdfFile(file)).resolves.toEqual({ ok: true });
  });

  test("rejects spoofed and non-PDF files even when the picker metadata looks plausible", async () => {
    const spoofed = new File(["not really a PDF"], "chapter.pdf", { type: "application/pdf" });
    const wrongType = new File([validPdf], "chapter.pdf", { type: "text/plain" });
    const wrongExtension = new File([validPdf], "chapter.txt", { type: "application/pdf" });

    await expect(validatePdfFile(spoofed)).resolves.toEqual({
      ok: false,
      message: "Choose a valid PDF file.",
    });
    await expect(validatePdfFile(wrongType)).resolves.toEqual({
      ok: false,
      message: "Choose a valid PDF file.",
    });
    await expect(validatePdfFile(wrongExtension)).resolves.toEqual({
      ok: false,
      message: "Choose a valid PDF file.",
    });
  });

  test("rejects a truncated PDF before it reaches the renderer", async () => {
    const truncated = new File(["%PDF-1.7\n1 0 obj\n<<>>"], "chapter.pdf", { type: "application/pdf" });

    await expect(validatePdfFile(truncated)).resolves.toEqual({
      ok: false,
      message: "Choose a complete, valid PDF file.",
    });
  });

  test("rejects malformed bytes that merely imitate PDF boundary markers", async () => {
    const malformed = new File(["%PDF-garbage\n1 0 obj\nno structure\nendobj\nstartxref\n0\n%%EOF\n"], "bad.pdf", {
      type: "application/pdf",
    });

    await expect(validatePdfFile(malformed)).resolves.toEqual({
      ok: false,
      message: "Choose a complete, valid PDF file.",
    });
  });

  test("bounds distinct startxref candidates without accepting adversarial decoys", async () => {
    const decoys = Array.from({ length: 300 }, (_, index) => `startxref\n${index + 1}\n%%EOF\n`).join("");
    const adversarial = new SliceCountingFile([`%PDF-1.7\n${decoys}`], "decoys.pdf", {
      type: "application/pdf",
    });

    await expect(validatePdfFile(adversarial)).resolves.toEqual({
      ok: false,
      message: "Choose a complete, valid PDF file.",
    });
    expect(adversarial.sliceCalls).toBeLessThanOrEqual(130);
  });

  test("rejects files above the documented application limit", async () => {
    const oversized = new File(
      [validPdf, new Uint8Array(MAX_PDF_FILE_BYTES)],
      "large.pdf",
      { type: "application/pdf" },
    );

    await expect(validatePdfFile(oversized)).resolves.toEqual({
      ok: false,
      message: "PDF files must be 20 MB or smaller.",
    });
  });
});
