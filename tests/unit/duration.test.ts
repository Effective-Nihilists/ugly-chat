import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../shared/duration';
describe('formatDuration', () => {
  it('formats sub-minute as seconds', () => { expect(formatDuration(8000)).toBe('8s'); });
  it('formats minutes+seconds', () => { expect(formatDuration(134000)).toBe('2m 14s'); });
  it('formats hours+minutes', () => { expect(formatDuration(11520000)).toBe('3h 12m'); });
  it('clamps negatives to 0s', () => { expect(formatDuration(-5)).toBe('0s'); });
});
