/**
 * CallLayout — wraps the immersive VideoCall stage with a live transcript.
 *
 * VideoCall keeps ALL of its SFU / track / renegotiation logic; this component
 * only (a) provides the surrounding layout, (b) feeds it the transcript via
 * useCallTranscript, and (c) renders the TranscriptPanel / SubtitleOverlay.
 *
 * Desktop: flex row — VideoCall stage (flex 1, full-bleed dark with its own HUD /
 * tiles / control bar / self-PiP) + TranscriptPanel (fixed width). Collapse hides
 * the panel, the stage goes full width, and the SubtitleOverlay shows over the
 * video (mockups/call-bot.html collapsed). The control bar's captions button (in
 * VideoCall) drives the same collapse.
 *
 * Mobile (< SIDEBAR_MIN_WIDTH): the stage fills with a SubtitleOverlay + a slim
 * compose bar; an expand control grows the chat into a full TranscriptPanel
 * below a compact video band (mockups/call-2p.html expanded).
 *
 * VideoCall self-hides (returns null) when there's no active call, so this
 * wrapper renders nothing visible until a call starts.
 */
import React, { forwardRef, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall, type VideoCallHandle, type CallProfiles } from './VideoCall';
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
  /** The bot's configured model label, for the HUD stat line. */
  botModel?: string | null;
  /**
   * The conversation's bot id (bot DMs / custom-bot rooms). When set, the bot
   * auto-joins the call once the local user has joined, so its 3D avatar tile
   * mounts. Null for human DMs / groups (manual "Add ugly-bot" still works).
   */
  autoJoinBotId?: string | null;
  /** Notifies the host (ChatPage) so it can hide the thread + composer. */
  onActiveChange?: (active: boolean) => void;
}

export const CallLayout = forwardRef<VideoCallHandle, CallLayoutProps>(function CallLayout(
  { conversationId, meId, socket, uglyBotSocket, profiles, botModel = null, autoJoinBotId = null, onActiveChange },
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
    onActiveChange?.(active);
  }, [active, onActiveChange]);

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

  // SpeakerProfiles → CallProfiles (same shape; explicit cast keeps the contract
  // narrow and avoids `any`).
  const callProfiles: CallProfiles = profiles;

  // Build the VideoCall stage. `subtitleSlot` shows over the video when the
  // transcript is collapsed (desktop) or always on mobile (overlay below).
  const stage = (
    showSubs: boolean,
    subBottom: number,
    onToggle: (() => void) | undefined,
    transcriptCollapsed: boolean,
  ): React.ReactElement => (
    <VideoCall
      ref={ref}
      conversationId={conversationId}
      uglyBotSocket={uglyBotSocket}
      profiles={callProfiles}
      botModel={botModel}
      autoJoinBotId={autoJoinBotId}
      transcriptCollapsed={transcriptCollapsed}
      {...(onToggle ? { onToggleTranscript: onToggle } : {})}
      subtitleSlot={
        showSubs ? <SubtitleOverlay turns={turns} meId={meId} profiles={profiles} bottom={subBottom} /> : null
      }
      onBotTurn={(botId, text, final) => {
        upsertExternalTurn(botId, text, final);
      }}
    />
  );

  // No call → render the (null-rendering) VideoCall so its start() ref and
  // roster subscription stay mounted; no layout chrome.
  if (!active) {
    return stage(false, 24, undefined, false);
  }

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
        <div
          style={{
            position: 'relative',
            flex: expanded ? 'none' : 1,
            minHeight: 0,
            overflow: 'hidden',
            ...(expanded ? { height: 296 } : {}),
          }}
        >
          {/* Subtitles + slim compose are rendered over the stage only when the
              chat sheet is NOT expanded. The control bar lives inside VideoCall. */}
          {stage(!expanded, 124, () => setExpanded((v) => !v), expanded)}
          {!expanded ? (
            <div
              className="uc-mcompose"
              style={{ position: 'absolute', left: 16, right: 16, bottom: 78, zIndex: 4 }}
            >
              <MobileCompose onSend={appendTyped} />
            </div>
          ) : null}
        </div>
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
      <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {stage(collapsed, 96, () => setCollapsed((v) => !v), collapsed)}
      </div>
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
