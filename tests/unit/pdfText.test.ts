import { describe, it, expect } from "vitest";
import {
  chunkPages,
  normalizePageText,
  looksLikePdf,
  isPdfName,
  type PdfPage,
} from "../../server/pdfText";

describe("normalizePageText", () => {
  it("collapses the ragged whitespace pdf.js emits", () => {
    expect(normalizePageText("a  \t b \r\n c")).toBe("a b\nc");
  });

  it("keeps paragraph breaks but caps the run", () => {
    expect(normalizePageText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("never joins two words into one", () => {
    expect(normalizePageText("hello   world")).toBe("hello world");
  });
});

describe("chunkPages", () => {
  const page = (n: number, text: string): PdfPage => ({ page: n, text });

  it("keeps one true page number per chunk — never merges across pages", () => {
    const chunks = chunkPages([page(1, "alpha"), page(2, "beta")]);
    expect(chunks.map((c) => [c.page, c.text])).toEqual([
      [1, "alpha"],
      [2, "beta"],
    ]);
  });

  it("numbers chunks continuously across the whole document", () => {
    const chunks = chunkPages(
      [page(1, "a".repeat(900)), page(2, "b".repeat(900))],
      { chunkChars: 400, overlap: 0 },
    );
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    );
    expect(chunks.length).toBeGreaterThan(2);
  });

  it("drops pages with no text layer", () => {
    expect(chunkPages([page(1, "   "), page(2, "real")])).toEqual([
      { page: 2, chunkIndex: 0, text: "real" },
    ]);
  });

  it("overlaps neighbours so a sentence split at the seam survives", () => {
    const body = `${"x".repeat(500)}. The needle sits here. ${"y".repeat(500)}`;
    const chunks = chunkPages([page(1, body)], {
      chunkChars: 520,
      overlap: 120,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // The phrase must survive intact in at least one chunk, not be halved.
    expect(chunks.some((c) => c.text.includes("The needle sits here."))).toBe(
      true,
    );
  });

  it("always makes forward progress when overlap approaches chunk size", () => {
    const chunks = chunkPages([page(1, "z".repeat(5000))], {
      chunkChars: 300,
      overlap: 299,
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(600); // terminated, did not spin
  });

  it("hard-cuts a script with no spaces rather than emitting one giant chunk", () => {
    // Arabic without spaces — the reported document is Arabic.
    const chunks = chunkPages([page(1, "ا".repeat(3000))], {
      chunkChars: 400,
      overlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(7);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(400);
  });

  it("honours maxChunks so a runaway PDF cannot fill the table", () => {
    const chunks = chunkPages([page(1, "w".repeat(100000))], {
      chunkChars: 200,
      overlap: 0,
      maxChunks: 5,
    });
    expect(chunks).toHaveLength(5);
  });

  it("returns nothing for an empty document", () => {
    expect(chunkPages([])).toEqual([]);
  });
});

describe("file sniffing", () => {
  it("accepts the PDF magic number", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
  });

  it("rejects HTML served in place of a PDF (an R2 404 page)", () => {
    expect(looksLikePdf(new TextEncoder().encode("<!doctype html>"))).toBe(
      false,
    );
  });

  it("rejects a truncated file", () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });

  it("matches a .pdf url even with a query string", () => {
    expect(isPdfName("https://x/public/a%20b.pdf?v=2")).toBe(true);
    expect(isPdfName("notes.PDF")).toBe(true);
    expect(isPdfName("image.png")).toBe(false);
  });
});
