/**
 * Subtitle overlay — the last 1-2 transcript turns rendered as captions over
 * the (always-dark) video stage. Used in the desktop-collapsed layout and as
 * the mobile default. Fixed light-on-dark styling (.uc-subs / .uc-sub-line),
 * NOT themed, since it sits on the dark stage in every theme.
 *
 * Visual source: mockups/call-bot.html / call-2p.html (.subs / .sub-line).
 */
import React from 'react';
import type { Turn } from '../../shared/transcript';
import type { SpeakerProfiles } from './TranscriptPanel';

function speakerName(id: string, meId: string, profiles: SpeakerProfiles): string {
  if (id === meId) return 'You';
  return profiles[id]?.name ?? id.slice(0, 8);
}

export function SubtitleOverlay({
  turns,
  meId,
  profiles,
  bottom = 24,
}: {
  turns: Turn[];
  meId: string;
  profiles: SpeakerProfiles;
  /** Distance from the bottom of the stage (px). */
  bottom?: number;
}): React.ReactElement | null {
  // Show the last two turns; the final one is "active".
  const recent = turns.slice(-2);
  if (recent.length === 0) return null;

  return (
    <div className="uc-subs" style={{ bottom }}>
      {recent.map((turn, i) => {
        const active = i === recent.length - 1;
        const name = speakerName(turn.speaker, meId, profiles);
        return (
          <div
            key={`${turn.speaker}-${turn.at}-${i}`}
            className={`uc-sub-line${active ? ' active' : ' past'}`}
          >
            <span className="who">{name}</span>
            {turn.text}
          </div>
        );
      })}
    </div>
  );
}
