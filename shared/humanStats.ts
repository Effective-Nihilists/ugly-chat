export interface StatMsg { userId: string; created: number }

export interface HumanStats {
  myCount: number; theirCount: number; yourSharePct: number;
  theirAvgReplyMs: number; theirFastestMs: number; myDoubleTexts: number;
}

// A "reply" = a message from the other side whose immediately-preceding message
// was from me. Reply latency = their.created - myLast.created.
export function computeHumanStats(msgs: StatMsg[], meId: string): HumanStats {
  const sorted = [...msgs].sort((a, b) => a.created - b.created);
  let myCount = 0, theirCount = 0, myDoubleTexts = 0;
  const replyGaps: number[] = [];
  let prevMineAt: number | null = null;
  let lastSenderMine = false;
  for (const m of sorted) {
    const mine = m.userId === meId;
    if (mine) {
      myCount++;
      if (lastSenderMine) myDoubleTexts++;
      prevMineAt = m.created;
      lastSenderMine = true;
    } else {
      theirCount++;
      if (lastSenderMine && prevMineAt != null) replyGaps.push(m.created - prevMineAt);
      lastSenderMine = false;
    }
  }
  const total = myCount + theirCount;
  const theirAvgReplyMs = replyGaps.length ? Math.round(replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length) : 0;
  const theirFastestMs = replyGaps.length ? Math.min(...replyGaps) : 0;
  return {
    myCount, theirCount,
    yourSharePct: total ? Math.round((myCount / total) * 100) : 0,
    theirAvgReplyMs, theirFastestMs, myDoubleTexts,
  };
}

// Per-message: latency of THIS message if it's a reply to the other side.
export function replyLatencyMs(sorted: StatMsg[], index: number, _meId: string): number | null {
  const m = sorted[index];
  if (!m || index === 0) return null;
  const prev = sorted[index - 1];
  if (!prev || prev.userId === m.userId) return null; // not a reply (same sender)
  return m.created - prev.created;
}
