import React, { useEffect, useState } from 'react';
import { sumTelemetry, formatTokens, formatCost, type MsgTelemetry } from '../../shared/telemetry';
import { modelLabel } from '../lib/bots';

export function TelemetryStrip({ telemetry, openedAt }: { telemetry: MsgTelemetry[]; openedAt: number }): React.ReactElement {
  const t = sumTelemetry(telemetry);
  // SESSION is derived from wall-clock, so it only advanced when something else
  // happened to re-render — it sat at "0m" through an entire conversation. Tick
  // it ourselves; a meter this product sells on has to actually be true.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { tick((n) => n + 1); }, 30_000);
    return () => { clearInterval(id); };
  }, []);
  const mins = Math.floor((Date.now() - openedAt) / 60000);
  const cell = (k: string, v: React.ReactNode, cost = false): React.ReactElement => (
    <div className="uc-tel-cell" key={k}>
      <span className="k">{k}</span>
      <span className={`v${cost ? ' cost' : ''}`}>{v}</span>
    </div>
  );
  return (
    <div className="uc-telemetry">
      {cell('session', `${mins}m`)}
      {cell('messages', String(t.messages))}
      {cell('tokens', formatTokens(t.totalTokens))}
      {cell('model', modelLabel(t.model) || '—')}
      {cell('spent', formatCost(t.totalCostUsd), true)}
      <span className="uc-tel-note">billed to your key</span>
    </div>
  );
}
