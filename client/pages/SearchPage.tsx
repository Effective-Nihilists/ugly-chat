import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';

interface SearchHit {
  _id: string;
  conversationId: string;
  userId: string;
  text?: string | null;
  markdown?: string | null;
  created?: unknown;
}

// Global full-text message search across all of the caller's conversations
// (backed by the engine's `conversationMessageSearch`). Results link to the
// owning conversation. Rendered inside the app shell (sidebar provided by
// AppShell), themed with the app tokens like ChatHomePage.
export default function SearchPage(): React.ReactElement {
  const { socket } = useApp();
  const router = useRouter();
  const { conversations } = useConversations();
  const initialQ = new URLSearchParams(window.location.search).get('q') ?? '';
  const [query, setQuery] = useState(initialQ);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  // conversationId → display title, for labelling each hit.
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of conversations) m.set(c.conversationId, c.title || 'Conversation');
    return m;
  }, [conversations]);

  const runSearch = useCallback(
    async (q: string): Promise<void> => {
      const trimmed = q.trim();
      const mine = ++seq.current;
      if (trimmed.length < 2) {
        setHits([]);
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = (await socket.request('conversationMessageSearch', {
          search: trimmed,
          limit: 50,
        })) as { items?: SearchHit[] };
        if (mine !== seq.current) return; // a newer query superseded this one
        setHits(res.items ?? []);
        setSearched(true);
      } catch (err) {
        if (mine !== seq.current) return;
        console.error('[search] failed', err);
        setHits([]);
        setSearched(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [socket],
  );

  // Debounced search as the user types; keep `?q=` in the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url.toString());
    const t = setTimeout(() => void runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--app-main)' }}>
      <div
        style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid var(--app-border)',
        }}
      >
        <span style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 17, color: 'var(--app-foreground)' }}>
          Search messages
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 14px',
              height: 48,
              borderRadius: 16,
              border: '2px solid var(--app-primary)',
              background: 'var(--app-main)',
            }}
          >
            <SearchIcon />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all messages…"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 16, color: 'var(--app-foreground)' }}
            />
          </div>

          {loading ? (
            <Hint text="Searching…" />
          ) : query.trim().length < 2 ? (
            <Hint text="Type at least 2 characters to search." />
          ) : hits.length === 0 && searched ? (
            <Hint text={`No messages matching "${query.trim()}".`} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {hits.map((h) => (
                <button
                  key={h._id}
                  type="button"
                  className="uc-row"
                  onClick={() => router.push('chat/:conversationId', { conversationId: h.conversationId })}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    width: '100%',
                    padding: '10px 8px',
                    border: 'none',
                    borderBottom: '1px solid var(--app-border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--app-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {titleById.get(h.conversationId) ?? 'Conversation'}
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--app-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {highlight(snippet(h.markdown ?? h.text ?? ''), query.trim())}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Collapse markdown/whitespace to a single-line preview.
function snippet(s: string): string {
  return s.replace(/[#*_`>~\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Bold the matched substring(s) within the preview.
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let from = 0;
  while ((i = lower.indexOf(ql, from)) !== -1) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(
      <mark key={i} style={{ background: 'var(--app-secondary)', color: 'inherit', padding: 0 }}>
        {text.slice(i, i + q.length)}
      </mark>,
    );
    from = i + q.length;
  }
  parts.push(text.slice(from));
  return parts;
}

function Hint({ text }: { text: string }): React.ReactElement {
  return <div style={{ padding: '32px 8px', textAlign: 'center', fontSize: 14, color: 'var(--app-foreground)', opacity: 0.45 }}>{text}</div>;
}

function SearchIcon(): React.ReactElement {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--app-primary)" strokeWidth={2} style={{ flexShrink: 0 }}>
      <circle cx={11} cy={11} r={7} />
      <line x1={21} y1={21} x2={16.65} y2={16.65} />
    </svg>
  );
}
