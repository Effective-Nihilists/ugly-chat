import React from 'react';
import { sumTelemetry, formatTokens, formatCost, type MsgTelemetry } from '../../shared/telemetry';

export function TelemetryStrip({ telemetry, openedAt }: { telemetry: MsgTelemetry[]; openedAt: number }): React.ReactElement {
  const t = sumTelemetry(telemetry);
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
      {cell('model', t.model || '—')}
      {cell('spent', formatCost(t.totalCostUsd), true)}
      <span className="uc-tel-note">billed to your key</span>
    </div>
  );
}
