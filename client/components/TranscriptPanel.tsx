/**
 * Live call transcript panel (desktop right rail + mobile expanded sheet).
 *
 * Shows the merged transcript turns (mic STT + relayed peer captions + typed
 * messages) styled like subtitles, with a header (live dot) and a composer that
 * posts a real message during the call. Themed with --app-* tokens — this panel
 * lives on the themed app surface, NOT over the dark video stage.
 *
 * Visual source: mockups/call-bot.html / call-2p.html (.tpanel / .tp-turn /
 * .tp-cbox).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Captions, Keyboard, SendHorizonal, ChevronRight } from 'lucide-react';
import type { Turn } from '../../shared/transcript';

export interface SpeakerProfile {
  name?: string;
  avatarUrl?: string;
}
export type SpeakerProfiles = Record<string, SpeakerProfile>;

function speakerName(id: string, meId: string, profiles: SpeakerProfiles): string {
  if (id === meId) return 'You';
  return profiles[id]?.name ?? id.slice(0, 8);
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function TranscriptPanel({
  turns,
  meId,
  profiles,
  onSend,
  onCollapse,
}: {
  turns: Turn[];
  meId: string;
  profiles: SpeakerProfiles;
  onSend: (text: string) => void;
  /** Optional collapse control (desktop). Hidden when omitted. */
  onCollapse?: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest turn.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = (): void => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  };

  // The last non-final turn is the live one (emphasized).
  const lastLiveIdx = (() => {
    for (let i = turns.length - 1; i >= 0; i--) if (!turns[i]?.final) return i;
    return -1;
  })();

  return (
    <div
      style={{
        width: 332,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--app-main)',
        borderLeft: '1px solid var(--app-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '13px 16px',
          borderBottom: '1px solid var(--app-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          flexShrink: 0,
        }}
      >
        <Captions size={15} style={{ color: 'var(--app-foreground-muted)' }} />
        <span className="uc-mono-label" style={{ letterSpacing: '0.18em', fontSize: 10 }}>
          Transcript
        </span>
        <span
          className="uc-mono-label"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--app-success)',
            fontSize: 9,
            letterSpacing: '0.14em',
          }}
        >
          <span className="uc-tp-livedot" />
          Live
        </span>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse transcript"
            title="Collapse transcript"
            style={{
              marginLeft: 6,
              display: 'grid',
              placeItems: 'center',
              width: 24,
              height: 24,
              border: '1px solid var(--app-border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--app-foreground-muted)',
              cursor: 'pointer',
            }}
          >
            <ChevronRight size={15} />
          </button>
        ) : null}
      </div>

      {/* Turns */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 15,
          minHeight: 0,
        }}
      >
        {turns.length === 0 ? (
          <span
            style={{
              fontSize: 12.5,
              color: 'var(--app-foreground-muted)',
              fontFamily: 'var(--app-font-body)',
            }}
          >
            Listening… captions appear here as people speak.
          </span>
        ) : (
          turns.map((turn, i) => {
            const name = speakerName(turn.speaker, meId, profiles);
            const active = i === lastLiveIdx;
            return (
              <div key={`${turn.speaker}-${turn.at}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--app-tertiary)',
                      color: 'var(--app-foreground)',
                      fontSize: 8.5,
                      fontWeight: 700,
                      fontFamily: 'var(--app-font-mono)',
                    }}
                  >
                    {initial(name)}
                  </span>
                  <span
                    className="uc-mono-label"
                    style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--app-foreground-muted)' }}
                  >
                    {name}
                  </span>
                  {turn.typed ? (
                    <Keyboard size={11} style={{ color: 'var(--app-foreground-muted)' }} aria-label="typed" />
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    paddingLeft: 27,
                    fontFamily: 'var(--app-font-body)',
                    color: active ? 'var(--app-foreground)' : 'var(--app-foreground-muted)',
                  }}
                >
                  {turn.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--app-border)', flexShrink: 0 }}>
        <div className="uc-tp-cbox">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Type during the call…"
            aria-label="Type a message during the call"
          />
          <button
            type="button"
            className="send"
            onClick={submit}
            aria-label="Send"
            title="Send"
            style={{
              width: 30,
              height: 30,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              borderRadius: 8,
              background: 'var(--app-primary)',
              color: 'var(--app-on-primary)',
              cursor: 'pointer',
            }}
          >
            <SendHorizonal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
