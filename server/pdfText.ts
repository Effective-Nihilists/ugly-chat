/**
 * PDF text extraction + chunking for chat attachments.
 *
 * Why this exists: a chat attachment only ever reached the model as a markdown
 * link. `ChatFile` rendered a download card, and `bots.ts` special-cased images
 * only — so a PDF arrived as a bare URL with no fetch tool behind it, and the
 * bot answered "ugly.chat links are still just decorative wallpaper to me".
 *
 * The chunker is deliberately separate from the fetch/extract step so it can be
 * unit-tested without a PDF or a network: `chunkPages` is pure.
 *
 * Runtime note: ugly-chat deploys to Cloudflare Workers, so this cannot shell
 * out to `pdftotext` the way bahai-app's offline ingest scripts do. `unpdf`
 * bundles a serverless build of pdf.js and runs in the Workers runtime.
 */

/** A chunk small enough that several fit a prompt, large enough to read as prose. */
export const CHUNK_CHARS = 1200;
/** Carried between neighbouring chunks so a sentence split across the seam survives. */
export const CHUNK_OVERLAP = 150;
/** Hard ceiling on stored chunks per document — a runaway PDF must not fill D1. */
export const MAX_CHUNKS = 4000;

export interface PdfPage {
  /** 1-based, matching what a reader sees in a viewer. */
  page: number;
  text: string;
}

export interface PdfChunk {
  page: number;
  chunkIndex: number;
  text: string;
}

/** Collapse the ragged whitespace pdf.js emits without joining separate words. */
export function normalizePageText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // `[^\S\n]` = any whitespace except a newline — spaces, tabs and the
      // NBSP pdf.js emits. A negated class because a literal \u00a0 inside a
      // character class is what prettier collapses the escape to, and that
      // trips no-irregular-whitespace.
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Split pages into overlapping chunks, never merging across a page boundary so
 * every chunk keeps one true page number to cite.
 *
 * Splitting prefers a paragraph break, then a sentence end, then a space, and
 * only hard-cuts mid-word when a "page" is one unbroken run of characters (CJK
 * and Arabic without spaces both do this — the reported document is Arabic).
 */
export function chunkPages(
  pages: readonly PdfPage[],
  opts: { chunkChars?: number; overlap?: number; maxChunks?: number } = {},
): PdfChunk[] {
  const size = Math.max(200, opts.chunkChars ?? CHUNK_CHARS);
  // Cap the overlap at HALF the chunk, so every step advances at least size/2.
  // An overlap near `size` technically terminates (the cursor is nudged forward
  // by one) but degenerates into one chunk per character — 5000 chars became
  // 4000 chunks before this clamp.
  const overlap = Math.max(
    0,
    Math.min(opts.overlap ?? CHUNK_OVERLAP, Math.floor(size / 2)),
  );
  const maxChunks = Math.max(1, opts.maxChunks ?? MAX_CHUNKS);
  const out: PdfChunk[] = [];

  for (const { page, text } of pages) {
    const body = normalizePageText(text);
    if (!body) continue;
    let cursor = 0;
    while (cursor < body.length) {
      if (out.length >= maxChunks) return out;
      const hardEnd = Math.min(cursor + size, body.length);
      const end =
        hardEnd === body.length
          ? hardEnd
          : preferredBreak(body, cursor, hardEnd);
      const slice = body.slice(cursor, end).trim();
      if (slice) out.push({ page, chunkIndex: out.length, text: slice });
      if (end >= body.length) break;
      // Step back by the overlap, but always make forward progress.
      cursor = Math.max(end - overlap, cursor + 1);
    }
  }
  return out;
}

/**
 * The latest pleasant break at or before `hardEnd`, searching only the back
 * quarter of the window so a chunk never collapses to a few characters.
 */
function preferredBreak(text: string, start: number, hardEnd: number): number {
  const floor = start + Math.floor((hardEnd - start) * 0.75);
  for (const marker of ["\n\n", ". ", "。", "؟ ", "? ", "! ", "\n", " "]) {
    const at = text.lastIndexOf(marker, hardEnd);
    if (at >= floor) return at + marker.length;
  }
  return hardEnd;
}

/** True when the bytes begin with the PDF magic number. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

/** A filename or URL that ends in .pdf, ignoring any query string. */
export function isPdfName(nameOrUrl: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(nameOrUrl);
}

export interface ExtractResult {
  pages: PdfPage[];
  /** Total pages the document reports, even where some yielded no text. */
  pageCount: number;
}

/**
 * Pull per-page text out of PDF bytes.
 *
 * Returns pages with their real 1-based numbers; pages that yield nothing (a
 * scan with no text layer) are dropped from `pages` but still counted in
 * `pageCount`, so a caller can tell "no text layer" from "empty document".
 */
export async function extractPdfPages(
  bytes: Uint8Array,
): Promise<ExtractResult> {
  if (!looksLikePdf(bytes)) {
    throw new Error("not a PDF (missing %PDF header)");
  }
  // Imported lazily so the Workers bundle only pays for pdf.js on an actual
  // extraction, not on every cold start of an unrelated request.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  const perPage = Array.isArray(text) ? text : [text];
  const pages: PdfPage[] = [];
  perPage.forEach((raw, i) => {
    const body = normalizePageText(typeof raw === "string" ? raw : "");
    if (body) pages.push({ page: i + 1, text: body });
  });
  return { pages, pageCount: perPage.length };
}
