import { describe, expect, it } from 'vitest';
import { pickSpeaker } from '../../client/components/VideoCall';

const L = (id: string, rms: number) => ({ id, rms });

describe('pickSpeaker', () => {
  // The regression this guards: the first cut took the loudest peer above a low
  // floor, so on a real call every open mic cleared it and EVERY tile lit at
  // once. An indicator that is on for everyone is not an indicator.
  it('never lights two peers on comparable levels', () => {
    expect(pickSpeaker([L('ana', 0.42), L('ben', 0.40)])).toBeNull();
  });

  it('picks the one who is clearly loudest', () => {
    expect(pickSpeaker([L('ana', 0.55), L('ben', 0.06)])).toBe('ana');
  });

  it('stays silent on room tone below the floor', () => {
    expect(pickSpeaker([L('ana', 0.05), L('ben', 0.02)])).toBeNull();
    // Loudest-of-the-quiet must NOT win: this is what lit an idle 1:1 tile
    // orange while the transcript still said nobody had spoken.
    expect(pickSpeaker([L('ana', 0.09)])).toBeNull();
  });

  it('lights a single loud peer with no runner-up to beat', () => {
    expect(pickSpeaker([L('ana', 0.4)])).toBe('ana');
  });

  it('returns null for an empty roster', () => {
    expect(pickSpeaker([])).toBeNull();
  });

  it('is order-independent', () => {
    const loud = L('ben', 0.6);
    const quiet = L('ana', 0.05);
    expect(pickSpeaker([loud, quiet])).toBe('ben');
    expect(pickSpeaker([quiet, loud])).toBe('ben');
  });
});
