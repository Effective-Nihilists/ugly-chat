/**
 * Server-side ingest of an attached PDF, and retrieval of its passages.
 *
 * Attachments used to reach the model as a bare markdown link with no fetch tool
 * behind it, so the bot's only honest answer was "I can't fetch that PDF". This
 * extracts the text once on attach and retrieves only the passages a question
 * needs — the reported document was 416 pages, which no context window holds.
 */
import type { CollectionDef, GetDocsOptions } from "ugly-app/shared";
import { collections, type ChatFileFragment } from "../shared/collections";
import { extractPdfPages, chunkPages, isPdfName } from "./pdfText";

/** Attachments live under `/public/` on our own origin; nothing else is fetched. */
const PUBLIC_PATH = "/public/";
/** A PDF larger than this is refused rather than parsed inside a Worker. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Passages handed to the model for one question. */
export const RETRIEVE_LIMIT = 6;

/** The app's own origin, matching the `PUBLIC_APP_URL` convention in callNotify. */
export function selfOrigin(): string {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.PUBLIC_APP_URL ?? "https://ugly.chat"
  );
}

export interface IngestResult {
  ok: boolean;
  pageCount: number;
  chunks: number;
  reason?: string;
}

/**
 * Platform hosts whose `/public/` objects may be fetched.
 *
 * NOT just our own origin: the reported case was a PDF open in Ugly File and
 * shared into chat, so the attachment lives on `file.ugly.bot`. Restricting to
 * ugly.chat would reject the exact document this fix exists for. These are all
 * our own apps serving already-public objects, so widening to them adds no
 * disclosure — what it must still exclude is everything else, or the endpoint
 * becomes an SSRF primitive any signed-in user can point at an internal address.
 */
const ALLOWED_HOST_SUFFIXES = [".ugly.bot", ".ugly.chat"] as const;
const ALLOWED_HOSTS = ["ugly.bot", "ugly.chat"] as const;

export function isAllowedAttachmentUrl(
  raw: string,
  selfOrigin: string,
): boolean {
  let url: URL;
  let self: URL;
  try {
    url = new URL(raw, selfOrigin);
    self = new URL(selfOrigin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  // Plain http is only ever acceptable against a local dev server.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    return false;
  }
  const onPlatform =
    host === self.hostname.toLowerCase() ||
    ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number]) ||
    ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s));
  if (!onPlatform && !isLocal) return false;
  return url.pathname.includes(PUBLIC_PATH);
}

/** Deterministic id so re-ingesting a file replaces its rows instead of doubling them. */
export function fragmentId(fileUrl: string, chunkIndex: number): string {
  // The URL already contains the storage key, which is unique per upload.
  return `${hashKey(fileUrl)}:${chunkIndex}`;
}

/** Small, stable, non-cryptographic hash — ids must be short and filename-safe. */
function hashKey(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * Fetch, extract and store one attachment's passages.
 *
 * Returns `ok:true, chunks:0` for a PDF with no text layer (a scan) — that is a
 * real outcome the caller should surface differently from a failure.
 */
/**
 * Attachment links in a message body, matching the same `/public/` shape the
 * client's `extractFiles` renders as a file card (`client/components/ChatMedia.tsx`).
 * Kept in sync deliberately: if it renders as an attachment, it should be readable.
 */
const FILE_LINK_RE =
  /\[([^\]]*)\]\(\s*<?((?:https?:)?\/\/[^)\s>]*\/public\/[^)\s>]+|\/public\/[^)\s>]+)>?\s*\)/g;

export interface LinkedFile {
  name: string;
  url: string;
}

/** PDF attachment links in `markdown`, deduped by url, newest-caller-wins order. */
export function extractPdfLinks(markdown: string): LinkedFile[] {
  const seen = new Set<string>();
  const out: LinkedFile[] = [];
  for (const m of markdown.matchAll(FILE_LINK_RE)) {
    const name = m[1] ?? "";
    const url = m[2] ?? "";
    if (!url || seen.has(url)) continue;
    if (!isPdfName(name) && !isPdfName(url)) continue;
    seen.add(url);
    // `??` is wrong here: an empty link text ("[](…)") must fall through to the
    // filename, and "" is not nullish.
    const fromUrl = url.split("/").pop();
    const label =
      name.trim() !== "" ? name : (fromUrl ?? "").trim() || "document.pdf";
    out.push({ name: label, url });
  }
  return out;
}

/** The read + single-doc write that ingest needs — narrower than a full db. */
export interface IngestDb extends ReadOnlyDb {
  setDoc<T>(
    collection: CollectionDef<T>,
    doc: T,
    options?: { skipIfExists?: boolean },
  ): Promise<boolean>;
}

/**
 * Ingest `fileUrl` unless this conversation already has passages for it.
 *
 * This is the path that actually fixes the report: the user did not upload the
 * PDF through chat, they shared a link to a document open in Ugly File. Nothing
 * on the client attach path would ever have fired. Ids are deterministic, so a
 * concurrent double-trigger converges instead of duplicating.
 */
export async function ensureIngested(
  db: IngestDb,
  args: {
    conversationId: string;
    fileUrl: string;
    fileName: string;
    selfOrigin: string;
  },
): Promise<IngestResult> {
  const existing = await db.getDocs<ChatFileFragment>(
    collections.chatFileFragment,
    { conversationId: args.conversationId, fileUrl: args.fileUrl },
    { limit: 1 },
  );
  if (existing.length > 0) {
    return {
      ok: true,
      pageCount: 0,
      chunks: existing.length,
      reason: "cached",
    };
  }
  const built = await buildFragments(args);
  if (!built.ok) return built;
  for (const f of built.fragments) {
    await db.setDoc(collections.chatFileFragment, f);
  }
  return {
    ok: true,
    pageCount: built.pageCount,
    chunks: built.fragments.length,
    ...(built.fragments.length === 0 ? { reason: "no-text-layer" } : {}),
  };
}

interface BuildResult extends IngestResult {
  fragments: ChatFileFragment[];
}

/** Fetch + extract + chunk. No writes, so it is safe to call before any db work. */
async function buildFragments(args: {
  conversationId: string;
  fileUrl: string;
  fileName: string;
  selfOrigin: string;
}): Promise<BuildResult> {
  const fail = (reason: string): BuildResult => ({
    ok: false,
    pageCount: 0,
    chunks: 0,
    reason,
    fragments: [],
  });
  const { conversationId, fileUrl, fileName, selfOrigin } = args;

  if (!isPdfName(fileName) && !isPdfName(fileUrl)) return fail("not-a-pdf");
  if (!isAllowedAttachmentUrl(fileUrl, selfOrigin)) {
    return fail("url-not-allowed");
  }

  let bytes: Uint8Array;
  try {
    const res = await fetch(new URL(fileUrl, selfOrigin).toString());
    if (!res.ok) return fail(`fetch-${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(len) && len > MAX_PDF_BYTES) return fail("too-large");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES) return fail("too-large");
    bytes = new Uint8Array(buf);
  } catch (e) {
    console.error("[chatFileIngest] fetch failed", fileUrl, e);
    return fail("fetch-failed");
  }

  try {
    const { pages, pageCount } = await extractPdfPages(bytes);
    const fragments = chunkPages(pages).map(
      (c): ChatFileFragment =>
        ({
          _id: fragmentId(fileUrl, c.chunkIndex),
          conversationId,
          fileUrl,
          fileName,
          page: c.page,
          chunkIndex: c.chunkIndex,
          text: c.text,
        }) as ChatFileFragment,
    );
    return { ok: true, pageCount, chunks: fragments.length, fragments };
  } catch (e) {
    console.error("[chatFileIngest] extract failed", fileUrl, e);
    return fail("extract-failed");
  }
}

/**
 * Force a re-ingest of one attachment, replacing whatever was stored before.
 *
 * The explicit endpoint's path. Unlike `ensureIngested` this always re-reads the
 * document, so a re-upload under the same URL or a fixed extraction can be
 * applied; `deleteQuery` first so a shorter second pass leaves no stale tail.
 */

export interface RetrievedPassage {
  fileName: string;
  page: number;
  text: string;
}

/**
 * The passages most relevant to `question`, scoped to one conversation.
 *
 * FTS5 over the passage text (the collection's `search` config). A keyword-ish
 * question — "where is Iran mentioned" — is exactly what this answers well. A
 * semantic vector index would widen recall but costs an embedding per chunk at
 * upload; that is a deliberate follow-up, not part of this fix.
 */
/**
 * Just the read `bots.ts` already has — retrieval must not force the bot path to
 * widen its `MinimalDb` to a full writable db it has no business holding.
 */
export interface ReadOnlyDb {
  getDocs<T>(
    collection: CollectionDef<T>,
    filter?: Record<string, unknown>,
    options?: GetDocsOptions,
  ): Promise<T[]>;
}

export async function retrievePassages(
  db: ReadOnlyDb,
  args: { conversationId: string; question: string; limit?: number },
): Promise<RetrievedPassage[]> {
  const query = args.question.trim();
  if (!query) return [];
  let rows: ChatFileFragment[];
  try {
    rows = await db.getDocs<ChatFileFragment>(
      collections.chatFileFragment,
      { conversationId: args.conversationId },
      { search: query, limit: args.limit ?? RETRIEVE_LIMIT },
    );
  } catch (e) {
    // Retrieval must never take the whole turn down — a bot that answers
    // without the document beats a bot that 500s.
    console.error("[chatFileIngest] retrieval failed", e);
    return [];
  }
  return rows
    .slice()
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((r) => ({ fileName: r.fileName, page: r.page, text: r.text }));
}

/**
 * Render passages as a prompt block the model can cite from.
 *
 * Empty string when nothing was retrieved, so the caller can append it
 * unconditionally without inserting a stray heading.
 */
export function formatPassages(passages: readonly RetrievedPassage[]): string {
  if (passages.length === 0) return "";
  const body = passages
    .map((p) => `[${p.fileName} · p.${p.page}]\n${p.text}`)
    .join("\n\n");
  return [
    "Relevant excerpts from the attached document(s). Cite the page when you use one.",
    "If the answer is not in these excerpts, say so — do not guess, and do not claim you cannot open the file.",
    "",
    body,
  ].join("\n");
}
