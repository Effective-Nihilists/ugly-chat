import { useEffect, useState } from 'react';

export interface BrowserShare {
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  screenshot?: {
    dataUrl: string;
    name: string;
  };
}

const STORAGE_KEY = 'ugly-chat:browser-share';
const LAST_ACCEPTED_KEY = 'ugly-chat:last-browser-share-id';
const MOBILE_SHARE_PREFIX = '#ugly-browser-share?';
const listeners = new Set<() => void>();
let pending: BrowserShare | null = null;
let installed = false;

declare global {
  interface Window {
    uglyBrowser?: {
      onShare(callback: (share: BrowserShare) => void): () => void;
    };
  }
}

export function normalizeBrowserShare(raw: unknown): BrowserShare | null {
  const value = raw as Partial<BrowserShare> | null;
  if (!value || typeof value.id !== 'string' || typeof value.url !== 'string')
    return null;
  if (value.id.length === 0 || value.id.length > 100 || value.url.length > 2048)
    return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const title = (
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : url.hostname
    ).slice(0, 200);
    const excerpt =
      typeof value.excerpt === 'string'
        ? value.excerpt.trim().slice(0, 1200)
        : '';
    const rawShot = value.screenshot as
      Partial<NonNullable<BrowserShare['screenshot']>> | undefined;
    const screenshot =
      typeof rawShot?.dataUrl === 'string' &&
      rawShot.dataUrl.startsWith('data:image/jpeg;base64,') &&
      rawShot.dataUrl.length <= 220 * 1024
        ? {
            dataUrl: rawShot.dataUrl,
            name: (typeof rawShot.name === 'string' && rawShot.name.trim()
              ? rawShot.name.trim()
              : 'browser-page.jpg'
            ).slice(0, 120),
          }
        : undefined;
    return {
      id: value.id,
      title,
      url: url.href,
      ...(excerpt ? { excerpt } : {}),
      ...(screenshot ? { screenshot } : {}),
    };
  } catch {
    return null;
  }
}

export function browserShareMarkdown(share: BrowserShare): string {
  const title = share.title
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
  const url = share.url.replaceAll('(', '%28').replaceAll(')', '%29');
  const link = `[${title}](${url})`;
  if (!share.excerpt) return link;
  const quote = share.excerpt
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  return `${link}\n\n${quote}`;
}

export function browserShareFromHash(hash: string): BrowserShare | null {
  if (!hash.startsWith(MOBILE_SHARE_PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(MOBILE_SHARE_PREFIX.length));
  return normalizeBrowserShare({
    id: params.get('id'),
    title: params.get('title'),
    url: params.get('url'),
    excerpt: params.get('excerpt') ?? undefined,
  });
}

function publish(value: BrowserShare | null): void {
  pending = value;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked storage API should not prevent the in-memory draft handoff.
  }
  for (const listener of listeners) listener();
}

export function installBrowserShareBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    pending = normalizeBrowserShare(
      JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null'),
    );
  } catch {
    pending = null;
  }
  let lastAccepted = '';
  try {
    lastAccepted = sessionStorage.getItem(LAST_ACCEPTED_KEY) ?? '';
  } catch {
    // Continue with in-memory duplicate protection.
  }
  const accept = (raw: unknown) => {
    const share = normalizeBrowserShare(raw);
    if (!share || share.id === lastAccepted) return;
    lastAccepted = share.id;
    try {
      sessionStorage.setItem(LAST_ACCEPTED_KEY, share.id);
    } catch {
      // The in-memory id still prevents duplicates for this document lifetime.
    }
    publish(share);
  };
  const consumeMobileHash = () => {
    const share = browserShareFromHash(location.hash);
    if (!share) return;
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}`,
    );
    accept(share);
  };
  consumeMobileHash();
  window.addEventListener('hashchange', consumeMobileHash);
  window.uglyBrowser?.onShare(accept);
}

export function clearBrowserShare(): void {
  publish(null);
}

export function useBrowserShare(): BrowserShare | null {
  const [value, setValue] = useState(pending);
  useEffect(() => {
    const update = () => {
      setValue(pending);
    };
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}
