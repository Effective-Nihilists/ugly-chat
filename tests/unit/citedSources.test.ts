import { describe, expect, it } from 'vitest';
import { trimToCitedSources } from '../../server/searchBot';

const S = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `s${i + 1}` }));

describe('trimToCitedSources', () => {
  // The regression: the answer cited [1][2] but 4 source cards showed (2 unread
  // padding). Trim to cited, renumbering so [n] still points at the right card.
  it('keeps only cited sources and renumbers the citations', () => {
    const { text, sources } = trimToCitedSources('Iceland: 389,450 [2]; earlier 383,726 [1].', S(4));
    // cited {1,2} → sorted → source[0], source[1]; numbers unchanged since they were 1,2
    expect(sources?.map((s) => s.url)).toEqual(['s1', 's2']);
    expect(text).toContain('[2]');
    expect(text).toContain('[1]');
  });

  it('renumbers non-contiguous citations to 1..k', () => {
    // cites [4] and [1] out of 4 read → keep sources 1 & 4, renumber 4→2.
    const { text, sources } = trimToCitedSources('A [4] and B [1].', S(4));
    expect(sources?.map((s) => s.url)).toEqual(['s1', 's4']);
    expect(text).toBe('A [2] and B [1].'); // [4]→[2] (s4 is now card 2), [1] stays
  });

  it('leaves it alone when every read source is cited', () => {
    const src = S(2);
    const { text, sources } = trimToCitedSources('X [1] Y [2]', src);
    expect(sources).toBe(src);
    expect(text).toBe('X [1] Y [2]');
  });

  it('leaves it alone when nothing is cited', () => {
    const src = S(3);
    expect(trimToCitedSources('no citations here', src).sources).toBe(src);
  });

  it('ignores an out-of-range citation without crashing', () => {
    const { sources } = trimToCitedSources('only [1] real, [9] bogus', S(3));
    expect(sources?.map((s) => s.url)).toEqual(['s1']);
  });

  it('handles no sources', () => {
    expect(trimToCitedSources('text [1]', undefined).sources).toBeUndefined();
  });
});
