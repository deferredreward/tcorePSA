import { describe, it, expect } from 'vitest';
import { getVerseText } from './verses.js';

const project = {
  chapters: {
    1: { 1: 'In the beginning', 2: 'And the earth', '4-5': 'bridged text' },
  },
};

describe('getVerseText', () => {
  it('returns the text for a direct verse hit', () => {
    expect(getVerseText(project, 1, 1)).toBe('In the beginning');
  });

  it('resolves a verse inside a bridged key like "4-5"', () => {
    expect(getVerseText(project, 1, 4)).toBe('bridged text');
    expect(getVerseText(project, 1, 5)).toBe('bridged text');
  });

  it('returns null for a missing chapter', () => {
    expect(getVerseText(project, 9, 1)).toBeNull();
  });

  it('returns null for a verse outside any bridge', () => {
    expect(getVerseText(project, 1, 3)).toBeNull();
  });
});
