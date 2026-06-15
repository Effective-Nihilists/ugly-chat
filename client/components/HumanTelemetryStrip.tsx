import React from 'react';
import { computeHumanStats, type StatMsg } from '../../shared/humanStats';
import { formatDuration } from '../../shared/duration';

export function HumanTelemetryStrip({ msgs, meId, leftOnRead }: { msgs: StatMsg[]; meId: string; leftOnRead: number }): React.ReactElement {
  const s = computeHumanStats(msgs, meId);
  const cell = (k: string, v: React.ReactNode, accent = false): React.ReactElement => (
    <div className="uc-tel-cell"><span className="k">{k}</span><span className={`v${accent ? ' cost' : ''}`}>{v}</span></div>
  );
  return (
    <div className="uc-telemetry">
      {cell('avg reply', s.theirAvgReplyMs ? formatDuration(s.theirAvgReplyMs) : '—')}
      {cell('fastest', s.theirFastestMs ? formatDuration(s.theirFastestMs) : '—')}
      {cell('left on read', `${leftOnRead}×`, true)}
      {cell('your share', `${s.yourSharePct}%`, true)}
      <span className="uc-tel-note">the data doesn't lie</span>
    </div>
  );
}
