import { describe, it, expect } from 'vitest';
import { nextSelectedId } from '../../client/lib/messageSelection';

describe('nextSelectedId', () => {
  it('selects a message when nothing is selected', () => {
    expect(nextSelectedId(null, 'm1')).toBe('m1');
  });
  it('moves selection to a different message', () => {
    expect(nextSelectedId('m1', 'm2')).toBe('m2');
  });
  it('toggles off when the selected message is tapped again', () => {
    expect(nextSelectedId('m1', 'm1')).toBeNull();
  });
});
