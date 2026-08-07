import { describe, expect, it } from 'vitest';
import {
  browserShareMarkdown,
  normalizeBrowserShare,
} from '../../client/lib/browserShare';

describe('browser share', () => {
  it('accepts only bounded web URLs', () => {
    expect(
      normalizeBrowserShare({
        id: '1',
        title: '',
        url: 'https://example.com/a',
      }),
    ).toEqual({
      id: '1',
      title: 'example.com',
      url: 'https://example.com/a',
    });
    expect(
      normalizeBrowserShare({
        id: '2',
        title: 'Private',
        url: 'file:///tmp/a',
      }),
    ).toBeNull();
  });

  it('creates an escaped markdown link for the unsent draft', () => {
    expect(
      browserShareMarkdown({
        id: '1',
        title: 'A [useful] page',
        url: 'https://example.com/a_(b)',
      }),
    ).toBe('[A \\[useful\\] page](https://example.com/a_%28b%29)');
  });

  it('adds selected text as a bounded blockquote', () => {
    const share = normalizeBrowserShare({
      id: '3',
      title: 'Source',
      url: 'https://example.com',
      excerpt: ` first line\nsecond line ${'x'.repeat(1300)}`,
    });
    expect(share?.excerpt?.length).toBe(1200);
    expect(browserShareMarkdown(share!)).toContain(
      '[Source](https://example.com/)\n\n> first line\n> second line',
    );
  });

  it('accepts only a bounded JPEG screenshot', () => {
    const jpeg = 'data:image/jpeg;base64,abc';
    expect(
      normalizeBrowserShare({
        id: '4',
        title: 'Page',
        url: 'https://example.com',
        screenshot: { dataUrl: jpeg, name: 'capture.jpg' },
      })?.screenshot,
    ).toEqual({ dataUrl: jpeg, name: 'capture.jpg' });
    expect(
      normalizeBrowserShare({
        id: '5',
        title: 'Page',
        url: 'https://example.com',
        screenshot: {
          dataUrl: 'data:image/png;base64,abc',
          name: 'capture.png',
        },
      }),
    ).not.toHaveProperty('screenshot');
  });
});
