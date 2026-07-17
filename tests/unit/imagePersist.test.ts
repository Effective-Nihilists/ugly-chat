import { describe, expect, it } from 'vitest';
import { imageKey, parseDataUrl, parseImageGenResponse } from '../../server/bots';

describe('parseDataUrl', () => {
  // The regression this supports: generated images were embedded in the message
  // markdown as ~570KB base64 data URLs, so the picture lived in the message ROW
  // and was re-sent on every conversation load. They go to R2 now; this is the
  // decoder that gets the bytes out of what the image endpoint hands back.
  it('decodes a base64 data url to bytes + mime', () => {
    // 1x1 transparent GIF.
    const b64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const out = parseDataUrl(`data:image/gif;base64,${b64}`);
    expect(out?.mime).toBe('image/gif');
    // GIF magic number — proves we decoded real bytes, not a string length.
    expect([...(out?.bytes.slice(0, 3) ?? [])]).toEqual([0x47, 0x49, 0x46]); // "GIF"
  });

  it('returns null for a hosted url so it is left alone', () => {
    // An endpoint that already returns a URL must pass through untouched.
    expect(parseDataUrl('https://blob.ugly.bot/x/y.webp')).toBeNull();
  });

  it('returns null for junk rather than throwing into the reply path', () => {
    expect(parseDataUrl('data:image/png;base64,!!!not-base64!!!')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
  });

  it('round-trips what parseImageGenResponse produces from an inline image', () => {
    // The two halves must agree: the parser builds the data URL, this reads it.
    const b64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const src = parseImageGenResponse({ base64: b64, mime: 'image/gif' });
    expect(src.startsWith('data:image/gif;base64,')).toBe(true);
    expect(parseDataUrl(src)?.bytes.length).toBeGreaterThan(0);
  });

  it('leaves a hosted url from the endpoint as a url', () => {
    const src = parseImageGenResponse({ url: 'https://blob.ugly.bot/a.png' });
    expect(parseDataUrl(src)).toBeNull();
  });
});

describe('imageKey', () => {
  // Keyed by the person who asked for the image, so one prefix holds everything
  // a given user generated (listable, deletable) — not by the bot that drew it.
  it('keys by user with the right extension', () => {
    expect(imageKey('u123', 'image/webp', 'img1')).toBe('user/u123/img1.webp');
    expect(imageKey('u123', 'image/jpeg', 'img1')).toBe('user/u123/img1.jpg');
  });

  it('falls back to png for an unknown mime rather than an extensionless key', () => {
    expect(imageKey('u123', 'image/tiff', 'img1')).toBe('user/u123/img1.png');
  });

  it('gives every image its own id', () => {
    expect(imageKey('u1', 'image/webp')).not.toBe(imageKey('u1', 'image/webp'));
  });
});

import { sanitizeHistoryContent } from '../../server/bots';

describe('sanitizeHistoryContent', () => {
  // The trigger: a bot image reply stored as ![alt](data:...572KB...) fed back
  // as text context tokenized to ~400k input tokens EVERY turn — inflating both
  // the telemetry and the real bill.
  it('collapses a base64 image data-URI to a tiny placeholder', () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(500000);
    const out = sanitizeHistoryContent(`![a red apple](${big})`);
    expect(out).toBe('[image: a red apple]');
    expect(out.length).toBeLessThan(40);
  });

  it('collapses a hosted-URL image too (a text model cannot use the URL)', () => {
    expect(sanitizeHistoryContent('![](https://blob.ugly.bot/x/y.webp)')).toBe('[image]');
  });

  it('nukes a bare base64 data-URI not wrapped in markdown', () => {
    const out = sanitizeHistoryContent('here: data:image/png;base64,' + 'Q'.repeat(1000));
    expect(out).toBe('here: [image]');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeHistoryContent('what is 17 * 23?')).toBe('what is 17 * 23?');
  });

  it('handles mixed text + image in one message', () => {
    const out = sanitizeHistoryContent('here you go ![sunset](data:image/png;base64,ZZZZ) enjoy');
    expect(out).toBe('here you go [image: sunset] enjoy');
  });
});

import { imageFailureReply } from '../../server/bots';

describe('imageFailureReply', () => {
  it('names a rejected prompt and says to rephrase', () => {
    const r = imageFailureReply(new Error('imageGen HTTP 400: content policy'));
    expect(r.reply).toMatch(/rejected/i);
    expect(r.reply).toMatch(/rephras/i);
  });

  it('names a busy service', () => {
    expect(imageFailureReply(new Error('HTTP 429 rate limit')).reply).toMatch(/busy/i);
  });

  it('routes a 402 to the payment reply', () => {
    const err = Object.assign(new Error('nope'), { status: 402 });
    expect(imageFailureReply(err).color).toBe('error');
  });

  it('always gives a retry path, even for an unknown error', () => {
    expect(imageFailureReply(new Error('weird')).reply).toMatch(/send your prompt again/i);
    expect(imageFailureReply(null).reply).toMatch(/again/i);
  });
});
