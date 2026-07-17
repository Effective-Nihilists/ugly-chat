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
