import React, { createContext, useCallback, useContext, useState } from 'react';
import { useTTS } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';

// Read a message aloud via ugly.bot's WebSocket TTS (InWorld). Exposed through
// context so the many message bubbles share ONE `useTTS` instance instead of
// each opening its own. `enabled` is false when there's no ugly.bot socket, so
// consumers can hide the speaker affordance entirely.
interface VoiceCtx {
  enabled: boolean;
  /** The message id currently playing, or null. */
  playingId: string | null;
  speak: (id: string, text: string) => void;
  stop: () => void;
}

const VoiceContext = createContext<VoiceCtx>({
  enabled: false,
  playingId: null,
  speak: () => undefined,
  stop: () => undefined,
});

export function useVoice(): VoiceCtx {
  return useContext(VoiceContext);
}

// Mounted only when `uglyBotSocket` is non-null, so `useTTS` always gets a real
// socket (hooks can't be called conditionally).
export function VoiceProvider({
  socket,
  children,
}: {
  socket: UglyBotSocket;
  children: React.ReactNode;
}): React.ReactElement {
  const tts = useTTS(socket);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const speak = useCallback(
    (id: string, text: string) => {
      const t = text.trim();
      if (!t) return;
      setSpeakingId(id);
      void tts.play(t).catch(() => { setSpeakingId(null); });
    },
    [tts],
  );

  const stop = useCallback(() => {
    tts.stop();
    setSpeakingId(null);
  }, [tts]);

  // Derive the active id from the live playing flag so it self-clears when
  // playback ends — no effect/race to reset it.
  const playingId = tts.playing ? speakingId : null;

  return (
    <VoiceContext.Provider value={{ enabled: true, playingId, speak, stop }}>
      {children}
    </VoiceContext.Provider>
  );
}
