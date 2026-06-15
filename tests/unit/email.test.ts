import { describe, it, expect } from 'vitest';
import { normalizeEmail, isValidEmail } from '../../shared/email';

describe('email', () => {
  it('lowercases + trims', () => { expect(normalizeEmail('  Dana@Studio.Dev ')).toBe('dana@studio.dev'); });
  it('validates shape', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});
