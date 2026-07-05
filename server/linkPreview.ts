/**
 * OpenGraph link unfurling. When a message contains a URL, we fetch the page
 * server-side, parse its OG/Twitter meta tags, and attach a `linkPreviews`
 * array to the message doc (clients render it as a card). Best-effort and
 * fire-and-forget — failures never affect message delivery.
 *
 * Runs on Cloudflare Workers (global fetch only). Caps work to keep it cheap:
 * at most 2 URLs/message, 5s timeout, 512 KB of HTML scanned.
 */
import type { DbSurface } from './handlers';
import { collections } from '../shared/collections';

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  // De-dupe, strip trailing punctuation, cap at 2.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const u = raw.replace(/[.,!?]+$/, '');
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
    if (out.length >= 2) break;
  }
  return out;
}

/** Pull a meta tag's content by property/name, tolerant of attribute order. */
function metaContent(html: string, key: string): string | undefined {
  const k = key.replace(/[:]/g, '\\:');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*\\bcontent=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function titleTag(html: string): string | undefined {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1].trim()) : undefined;
}

export async function fetchOpenGraph(url: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UglyChatBot/1.0 (+https://ugly.chat)', Accept: 'text/html' },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    // Read at most ~512 KB.
    const html = (await res.text()).slice(0, 512 * 1024);

    const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? titleTag(html);
    const image = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
    const description =
      metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
    const siteName = metaContent(html, 'og:site_name');

    if (!title && !image) return null; // nothing worth showing
    const preview: LinkPreview = { url };
    if (title) preview.title = title.slice(0, 200);
    if (description) preview.description = description.slice(0, 300);
    if (image) preview.image = absolutize(image, url);
    if (siteName) preview.siteName = siteName.slice(0, 80);
    return preview;
  } catch {
    return null;
  }
}

/** Resolve a possibly-relative og:image against the page URL. */
function absolutize(image: string, base: string): string {
  try {
    return new URL(image, base).toString();
  } catch {
    return image;
  }
}

/**
 * Unfurl any links in a freshly-created message and patch `linkPreviews` onto
 * the message doc. Call via `waitUntil` after the message is created.
 */
export async function unfurlMessageLinks(
  db: DbSurface,
  msg: { _id?: string; text?: string | null; markdown?: string | null; linkPreviews?: unknown },
): Promise<void> {
  if (!msg._id) return;
  if (Array.isArray(msg.linkPreviews) && msg.linkPreviews.length > 0) return; // already done
  const urls = extractUrls(msg.markdown ?? msg.text ?? '');
  if (urls.length === 0) return;

  const previews = (await Promise.all(urls.map((u) => fetchOpenGraph(u)))).filter(
    (p): p is LinkPreview => p !== null,
  );
  if (previews.length === 0) return;

  // Patch only `linkPreviews` (dot-path partial update) so we never clobber a
  // concurrent edit — no read-modify-write of the whole message doc.
  await db.setDocFields(collections.message, msg._id, { linkPreviews: previews });
}
