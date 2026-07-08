import { describe, it, expect } from 'vitest';
import { BOOKS, usfmFileNumber } from './books.js';

describe('BOOKS', () => {
  it('contains all 66 canonical books', () => {
    expect(Object.keys(BOOKS)).toHaveLength(66);
  });
});

describe('usfmFileNumber', () => {
  it('numbers OT books starting at 01', () => {
    expect(usfmFileNumber('GEN')).toBe('01');
    expect(usfmFileNumber('MAL')).toBe('39');
  });

  it('skips 40 so NT numbering starts at 41', () => {
    expect(usfmFileNumber('MAT')).toBe('41');
    expect(usfmFileNumber('REV')).toBe('67');
  });

  it('returns null for an unknown book code', () => {
    expect(usfmFileNumber('XYZ')).toBeNull();
  });
});
