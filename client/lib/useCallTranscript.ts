/**
 * Live call transcript: local mic STT + relayed peer captions + typed messages.
 *
 * - `useSTT(uglyBotSocket, { mode: 'realtime' })` streams the local speaker's
 *   partial/final transcript; each update upserts the local turn (speaker=meId)
 *   AND is relayed to peers via `conversationCaption`.
 * - Incoming peer captions arrive on `conversation.call.captions` and are
 *   merged via the existing `trackDoc('conversation')` subscription — the same
 *   transport the call roster and typing indicator use (no new socket channel).
 * - `appendTyped(text)` posts a real message (`conversationMessageCreate`) and
 *   appends a typed, final turn so what you type shows in the transcript too.
 *
 * NOTE: the framework `useSTT` signature is `(socket, { mode?, lang? })` — it
 * does NOT accept a `conversationId` option (the plan assumed one). The
 * conversationId is only used here for the caption relay + message create.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSTT } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';
import { useApp } from 'ugly-app/client';
import type { DBObject } from 'ugly-app/shared';
import { isSilenceHallucination, upsertTurn, type Turn } from '../../shared/transcript';
import type { CallCaption } from '../../server/video';

type AppSocketT = ReturnType<typeof useApp>['socket'];

interface CallTranscript {
  turns: Turn[];
  appendTyped: (text: string) => void;
  /**
   * Inject/replace a turn from an external source (e.g. the bot's TTS caption
   * revealed word-by-word). Follows the same partial/final upsert semantics as
   * STT: a non-final turn for `speaker` is replaced until `final` flips true.
   */
  upsertExternalTurn: (speaker: string, text: string, final: boolean) => void;
  /** True while the local mic STT is actively listening. */
  listening: boolean;
}

interface ConversationCallDoc extends DBObject {
  call?: { captions?: Record<string, CallCaption> };
}

export function useCallTranscript(
  socket: AppSocketT,
  uglyBotSocket: UglyBotSocket | null,
  conversationId: string,
  meId: string,
  active: boolean,
): CallTranscript {
  const [turns, setTurns] = useState<Turn[]>([]);
  // useSTT is a hook → must be called unconditionally. When there's no ugly.bot
  // socket we still call it (with a never-started instance) and simply never
  // invoke start(); the realtime stream stays dormant.
  const stt = useSTT(uglyBotSocket!, { mode: 'realtime' });

  // Start/stop the mic stream with the call.
  const startRef = useRef(stt.start);
  const stopRef = useRef(stt.stop);
  startRef.current = stt.start;
  stopRef.current = stt.stop;
  useEffect(() => {
    if (active && uglyBotSocket) {
      void startRef.current();
      return () => {
        stopRef.current();
      };
    }
    return undefined;
  }, [active, uglyBotSocket]);

  // Local transcript → local turns + relay to peers.
  const lastRelayed = useRef<string>('');
  useEffect(() => {
    const text = stt.transcript;
    if (!text) return;
    // Drop a FINAL turn that's just an STT silence-hallucination ("Thank you."
    // on a quiet mic) — it's not something the speaker said, and relaying it
    // would put it in the peers' transcripts too. Partials still show live.
    if (stt.isFinal && isSilenceHallucination(text)) {
      lastRelayed.current = `${text}|true`;
      return;
    }
    setTurns((t) => upsertTurn(t, { speaker: meId, text, final: stt.isFinal, at: Date.now() }));
    // Avoid re-relaying an identical partial (the hook can re-render without a
    // text change); always relay finals so peers freeze the row.
    const key = `${text}|${stt.isFinal}`;
    if (key === lastRelayed.current) return;
    lastRelayed.current = key;
    void socket
      .request('conversationCaption', { conversationId, text, final: stt.isFinal })
      .catch(() => undefined);
  }, [stt.transcript, stt.isFinal, meId, conversationId, socket]);

  // Incoming peer captions via the conversation doc (same channel as typing).
  const seen = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!active) return undefined;
    const unsub = socket.trackDoc<ConversationCallDoc>('conversation', conversationId, (doc) => {
      const captions = doc?.call?.captions;
      if (!captions) return;
      for (const cap of Object.values(captions)) {
        if (cap.userId === meId) continue; // our own turns are handled locally
        // Skip captions we've already merged (the doc re-emits on every field
        // change, e.g. roster updates).
        if (seen.current[cap.userId] === cap.at) continue;
        seen.current[cap.userId] = cap.at;
        setTurns((t) =>
          upsertTurn(t, { speaker: cap.userId, text: cap.text, final: cap.final, at: cap.at }),
        );
      }
    });
    return () => {
      unsub();
    };
  }, [active, socket, conversationId, meId]);

  // Reset the transcript when a call ends so the next call starts fresh.
  useEffect(() => {
    if (!active) {
      setTurns([]);
      seen.current = {};
      lastRelayed.current = '';
    }
  }, [active]);

  const appendTyped = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setTurns((cur) =>
        upsertTurn(cur, { speaker: meId, text: t, final: true, typed: true, at: Date.now() }),
      );
      // Relay to peers IN-CALL so it shows in their transcript AND their client
      // speaks it via TTS (typed=true; STT captions are typed=false so they're
      // not double-spoken — peers already hear live mic audio over the SFU).
      void socket
        .request('conversationCaption', { conversationId, text: t, final: true, typed: true })
        .catch(() => undefined);
      // Also persist as a real message (history + bot replies in bot rooms).
      void socket
        .request('conversationMessageCreate', {
          conversationId,
          message: { markdown: t, text: t },
        })
        .catch((err: unknown) => {
          console.error('[useCallTranscript] send failed', err);
        });
    },
    [socket, conversationId, meId],
  );

  const upsertExternalTurn = useCallback(
    (speaker: string, text: string, final: boolean) => {
      if (!text) return;
      setTurns((t) => upsertTurn(t, { speaker, text, final, at: Date.now() }));
    },
    [],
  );

  return { turns, appendTyped, upsertExternalTurn, listening: stt.listening };
}
