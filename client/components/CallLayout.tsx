/**
 * CallLayout — wraps the existing VideoCall stage with a live transcript.
 *
 * VideoCall keeps ALL of its SFU / track / renegotiation logic; this component
 * only (a) provides the surrounding layout, (b) feeds it the transcript via
 * useCallTranscript, and (c) renders the TranscriptPanel / SubtitleOverlay.
 *
 * Desktop: flex row — VideoCall stage (flex 1, dark) + TranscriptPanel (fixed
 * width). Collapse hides the panel, the stage goes full width, and the
 * SubtitleOverlay shows over the video (mockups/call-bot.html collapsed).
 *
 * Mobile (< SIDEBAR_MIN_WIDTH): the stage fills with a SubtitleOverlay + a slim
 * compose bar; an expand control grows the chat into a full TranscriptPanel
 * below a compact video band (mockups/call-2p.html expanded).
 *
 * VideoCall self-hides (returns null) when there's no active call, so this
 * wrapper renders nothing visible until a call starts.
 */
import React, { forwardRef, useEffect, useState } from 'react';
import { Captions, MessageSquare, ChevronDown } from 'lucide-react';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall, type VideoCallHandle } from './VideoCall';
import { TranscriptPanel, type SpeakerProfiles } from './TranscriptPanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { useCallTranscript } from '../lib/useCallTranscript';
import type { useApp } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';

type AppSocketT = ReturnType<typeof useApp>['socket'];

// Mirrors AppShell's SIDEBAR_MIN_WIDTH breakpoint.
const SIDEBAR_MIN_WIDTH = 820;

interface CallConvDoc extends DBObject {
  call?: { active?: boolean };
}

export interface CallLayoutProps {
  conversationId: string;
  meId: string;
  socket: AppSocketT;
  uglyBotSocket: UglyBotSocket | null;
  profiles: SpeakerProfiles;
}

// Reusable dark "stage" wrapper so the SubtitleOverlay can sit over the video.
function Stage({
  children,
  overlay,
  style,
}: {
  children: React.ReactNode;
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        background: '#0a0a0a',
        overflow: 'auto',
        ...style,
      }}
    >
      {children}
      {overlay}
    </div>
  );
}

export const CallLayout = forwardRef<VideoCallHandle, CallLayoutProps>(function CallLayout(
  { conversationId, meId, socket, uglyBotSocket, profiles },
  ref,
) {
  const [active, setActive] = useState(false);
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= SIDEBAR_MIN_WIDTH,
  );
  const [collapsed, setCollapsed] = useState(false); // desktop: hide panel → overlay
  const [expanded, setExpanded] = useState(false); // mobile: grow chat below video

  // Track call activity off the conversation doc (same source as the roster).
  useEffect(() => {
    const unsub = socket.trackDoc<CallConvDoc>('conversation', conversationId, (doc) => {
      setActive(!!doc?.call?.active);
    });
    return () => {
      unsub();
    };
  }, [socket, conversationId]);

  useEffect(() => {
    const onResize = (): void => {
      setWide(window.innerWidth >= SIDEBAR_MIN_WIDTH);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const { turns, appendTyped, upsertExternalTurn } = useCallTranscript(
    socket,
    uglyBotSocket,
    conversationId,
    meId,
    active,
  );

  const stage = (
    <VideoCall
      ref={ref}
      conversationId={conversationId}
      uglyBotSocket={uglyBotSocket}
      onBotTurn={(botId, text, final) => {
        upsertExternalTurn(botId, text, final);
      }}
    />
  );

  // No call → render just the (null-rendering) VideoCall so its start() ref and
  // roster subscription stay mounted; no layout chrome.
  if (!active) return stage;

  if (!wide) {
    // ── Mobile ──────────────────────────────────────────────────────────────
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--app-main)',
        }}
      >
        <Stage
          style={{
            flex: expanded ? 'none' : 1,
            ...(expanded ? { height: 296 } : {}),
          }}
          overlay={
            expanded ? null : (
              <>
                <SubtitleOverlay turns={turns} meId={meId} profiles={profiles} bottom={64} />
                <div
                  className="uc-mcompose"
                  style={{ position: 'absolute', left: 16, right: 16, bottom: 14, zIndex: 4 }}
                >
                  <MobileCompose onSend={appendTyped} />
                  <button
                    type="button"
                    data-id="call-open-chat"
                    onClick={() => {
                      setExpanded(true);
                    }}
                    aria-label="Open chat"
                    title="Open chat"
                    style={{
                      width: 30,
                      height: 30,
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      border: 'none',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.16)',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <MessageSquare size={15} />
                  </button>
                </div>
              </>
            )
          }
        >
          {stage}
        </Stage>
        {expanded ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            <button
              type="button"
              data-id="call-collapse-chat"
              onClick={() => {
                setExpanded(false);
              }}
              aria-label="Collapse chat"
              title="Collapse chat"
              style={{
                position: 'absolute',
                top: 4,
                right: 8,
                zIndex: 5,
                width: 28,
                height: 28,
                display: 'grid',
                placeItems: 'center',
                border: 'none',
                background: 'transparent',
                color: 'var(--app-foreground-muted)',
                cursor: 'pointer',
              }}
            >
              <ChevronDown size={18} />
            </button>
            <TranscriptPanel turns={turns} meId={meId} profiles={profiles} onSend={appendTyped} fill />
          </div>
        ) : null}
      </div>
    );
  }

  // ── Desktop ─────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
      <Stage
        overlay={
          collapsed ? (
            <>
              <SubtitleOverlay turns={turns} meId={meId} profiles={profiles} bottom={24} />
              <button
                type="button"
                data-id="call-show-transcript"
                onClick={() => {
                  setCollapsed(false);
                }}
                aria-label="Show transcript"
                title="Show transcript"
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'var(--app-font-mono)',
                }}
              >
                <Captions size={14} /> Transcript
              </button>
            </>
          ) : null
        }
      >
        {stage}
      </Stage>
      {collapsed ? null : (
        <TranscriptPanel
          turns={turns}
          meId={meId}
          profiles={profiles}
          onSend={appendTyped}
          onCollapse={() => {
            setCollapsed(true);
          }}
        />
      )}
    </div>
  );
});

// Slim mobile compose input (light-on-dark, lives inside .uc-mcompose).
function MobileCompose({ onSend }: { onSend: (text: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  };
  return (
    <input
      data-id="call-mobile-input"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
      placeholder="Type during the call…"
      aria-label="Type a message during the call"
    />
  );
}
