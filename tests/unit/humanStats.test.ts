import { describe, it, expect } from 'vitest';
import { computeHumanStats, type StatMsg } from '../../shared/humanStats';

// me = 'u_me', them = 'u_dana'. timestamps in ms.
const msgs: StatMsg[] = [
  { userId: 'u_me',   created: 0 },
  { userId: 'u_me',   created: 1000 },     // double-text (no reply between)
  { userId: 'u_dana', created: 8000 },     // dana replies 7s after my last
  { userId: 'u_me',   created: 20000 },
  { userId: 'u_dana', created: 20000 + 134000 }, // dana replies 2m14s later
];

describe('computeHumanStats', () => {
  const s = computeHumanStats(msgs, 'u_me');
  it('counts messages per side and your share', () => {
    expect(s.myCount).toBe(3);
    expect(s.theirCount).toBe(2);
    expect(s.yourSharePct).toBe(60); // 3/5
  });
  it('computes their avg + fastest reply to me', () => {
    expect(s.theirFastestMs).toBe(7000);
    expect(s.theirAvgReplyMs).toBe((7000 + 134000) / 2);
  });
  it('counts my double-texts (consecutive mine with no reply)', () => {
    expect(s.myDoubleTexts).toBe(1);
  });
});
